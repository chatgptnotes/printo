/**
 * POST /api/projects/[id]/bid-decision
 *
 * Gate 2 (step 10) — 2-way bid decision (No-Bid · Detailed). The legacy
 * Quick (rate × sqft) path was removed in favor of the INSTANT BOQ lane
 * which runs the full Detailed pipeline with auto-approved gates.
 *
 * Body:
 *   {
 *     decision: 'no_bid' | 'detailed',
 *     reason?: string,                            // required for no_bid
 *     reason_code?: string,                       // optional short tag for sabi_no_bid_log
 *     decided_by?: string,
 *   }
 *
 * Behaviour:
 *   no_bid   → write sabi_no_bid_log row + sabi_projects.bid_decision='no_bid' + status='declined'. Terminal.
 *   detailed → write bid_decision='detailed' + delegate to /api/projects/[id]/estimate
 *              (which runs Phase 3 take-off and pauses at Gate 3 / step 24).
 */

import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { requireAuth } from '@/lib/shared/api-auth';
import { logActivity, updateProjectStatus } from '@/lib/storage/activity-logger';
import { logCorrection } from '@/lib/storage/corrections-logger';
import type { BidDecision } from '@/lib/shared/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface Body {
  decision: BidDecision;
  reason?: string;
  reason_code?: string;
  decided_by?: string;
}

const STEP_NAME = 'Bid Decision';
const STEP = 10; // MAIN Gate 2 = step 10 per v6 PDF (was legacy 33-step "13")

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const body = (await request.json().catch(() => ({}))) as Partial<Body>;
    const decision = body.decision;
    const decidedBy = (body.decided_by ?? '').trim() || 'George Varkey M';

    if (!decision || !['no_bid', 'detailed'].includes(decision)) {
      return NextResponse.json(
        { error: 'decision must be one of: no_bid, detailed' },
        { status: 400 }
      );
    }

    const { data: project, error: projErr } = await supabaseAdmin
      .from('sabi_projects')
      .select('*')
      .eq('id', id)
      .single();

    if (projErr || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Idempotency guard: if a detailed estimate is already in flight for
    // this project, don't kick off a second run on a re-click. The original
    // run will continue and surface progress through the activity log.
    if (decision === 'detailed' && project.status === 'estimating') {
      return NextResponse.json({
        ok: true,
        decision,
        status: 'estimating',
        already_running: true,
      });
    }

    // Persist the decision on sabi_projects regardless of which path follows.
    await supabaseAdmin
      .from('sabi_projects')
      .update({
        bid_decision: decision,
        notes: null,                         // clear pending Gate 2 marker
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    // Capture human-vs-AI bid-recommendation disagreement. The AI's read of
    // the email is in ai_classification.priority — when AI said this looked
    // like a real RFQ (priority_top/priority_gen) but the human declined or
    // downgraded to quick, that's a meaningful correction signal.
    const aiClass = (project.ai_classification ?? {}) as Record<string, unknown>;
    const aiPriority = aiClass.priority as string | undefined;
    const aiSuggestedBid = aiPriority === 'priority_top' || aiPriority === 'priority_gen';
    if (aiSuggestedBid && decision !== 'detailed') {
      await logCorrection({
        projectId: id,
        fieldPath: 'bid_recommendation',
        aiValue: { priority: aiPriority, isRfq: aiClass.isRfq, confidence: aiClass.confidence },
        humanValue: { decision, reason: body.reason ?? null },
        aiProvider: (aiClass._provider as string | undefined) ?? null,
        metadata: {
          building_type: project.building_type,
          total_area_sqft: project.total_area_sqft,
          floors: project.floors,
        },
        createdBy: decidedBy,
      });
    }

    // -------------------- NO-BID --------------------
    if (decision === 'no_bid') {
      const reason = (body.reason ?? '').trim();
      if (!reason) {
        return NextResponse.json(
          { error: 'reason is required for no_bid (decisions must capture why)' },
          { status: 400 }
        );
      }
      const reasonCode = (body.reason_code ?? '').trim() || 'unspecified';

      // Insert into the dedicated audit log (sabi_no_bid_log).
      // The migration adds this table; if it does not yet exist the insert
      // will error — surface it but still complete the decline so we don't
      // leave the project in a half-decided state.
      const { error: logErr } = await supabaseAdmin.from('sabi_no_bid_log').insert({
        project_id: id,
        reason_code: reasonCode,
        reason_text: reason,
        decided_by: decidedBy,
        decided_at: new Date().toISOString(),
        source: 'human',
      });
      if (logErr) {
        console.error('sabi_no_bid_log insert failed:', logErr.message);
      }

      // Mirror to ai_classification for backwards-compat readers.
      const aiClassification = (project.ai_classification ?? {}) as Record<string, unknown>;
      const merged = {
        ...aiClassification,
        no_bid_reason: reason,
        no_bid_reason_code: reasonCode,
        no_bid_at: new Date().toISOString(),
        no_bid_decided_by: decidedBy,
      };
      await supabaseAdmin
        .from('sabi_projects')
        .update({
          priority: 'ignore',
          ai_classification: merged,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      await updateProjectStatus(id, 'declined');

      await logActivity(id, STEP, STEP_NAME, 'completed', {
        decision: 'no_bid',
        reason,
        reason_code: reasonCode,
        decided_by: decidedBy,
      });

      return NextResponse.json({
        ok: true,
        decision: 'no_bid',
        project_id: id,
        status: 'declined',
        no_bid_log_persisted: !logErr,
      });
    }

    // -------------------- DETAILED --------------------
    await logActivity(id, STEP, STEP_NAME, 'completed', {
      decision: 'detailed',
      decided_by: decidedBy,
    });

    await supabaseAdmin
      .from('sabi_projects')
      .update({ status: 'estimating', updated_at: new Date().toISOString() })
      .eq('id', id);

    const appUrl = request.nextUrl.origin;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (process.env.INTERNAL_API_SECRET) {
      headers['X-Internal-Secret'] = process.env.INTERNAL_API_SECRET;
    } else {
      const authToken = request.cookies.get('auth-token')?.value;
      if (authToken) headers['Cookie'] = `auth-token=${authToken}`;
    }

    waitUntil(
      fetch(`${appUrl}/api/projects/${id}/estimate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ mode: 'detailed' }),
      }).catch(err => {
        console.error(`[bid-decision] estimate dispatch failed for ${id}:`, err?.message ?? err);
      })
    );

    return NextResponse.json({
      ok: true,
      decision: 'detailed',
      status: 'estimating',
      async: true,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Bid decision error:', message);
    await logActivity(id, STEP, STEP_NAME, 'failed', { error: message });
    return NextResponse.json(
      { error: 'Bid decision failed', details: message },
      { status: 500 }
    );
  }
}
