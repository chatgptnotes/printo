// @ts-nocheck — disabled route; pre-existing TS errors in unreachable code
/**
 * GET /api/cron/auto-escalate-stale
 *
 * 7-day auto-escalation per the transcript-aligned plan
 * (sabi-revised-pipeline-plan.md §"7-day auto-escalation job"):
 *   Projects paused at Gate 1 (step 11 — Documents Sufficient?) for more
 *   than 7 calendar days with no client response are auto-decided as Gate 2
 *   No-Bid with reason_code='no_client_response_7d'.
 *
 * The route is idempotent — re-running it on already-declined projects has
 * no effect. Designed to be invoked by Vercel Cron (auth via CRON_SECRET).
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { logActivity, updateProjectStatus } from '@/lib/storage/activity-logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const STALE_DAYS = 7;
const REASON_CODE = 'no_client_response_7d';
const REASON_TEXT =
  'Auto-escalated: no client response within 7 days of pausing at Gate 1 (Documents Sufficient?).';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return runEscalation();
}

// Allow manual trigger from the UI (gated by app auth) for testing.
export async function POST() {
  return runEscalation();
}

async function runEscalation() {
  return NextResponse.json({ disabled: true, reason: 'Stale escalation disabled — electrical-only pipeline' });
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - STALE_DAYS);

    // Candidates: projects in scope_pending status (Gate 1) older than the cutoff.
    const { data: stale, error } = await supabaseAdmin
      .from('sabi_projects')
      .select('id, status, updated_at, notes')
      .eq('status', 'scope_pending')
      .lt('updated_at', cutoff.toISOString());

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch stale projects', details: error.message },
        { status: 500 }
      );
    }

    if (!stale || stale.length === 0) {
      return NextResponse.json({ escalated: 0, message: 'No stale Gate 1 projects' });
    }

    let escalated = 0;
    const failures: { project_id: string; error: string }[] = [];

    for (const proj of stale) {
      // Defensive: only auto-escalate if approval_gate is 11 in notes.
      let gate: number | null = null;
      try {
        gate = proj.notes ? JSON.parse(proj.notes).approval_gate : null;
      } catch {
        gate = null;
      }
      if (gate !== 11) continue;

      try {
        await supabaseAdmin.from('sabi_no_bid_log').insert({
          project_id: proj.id,
          reason_code: REASON_CODE,
          reason_text: REASON_TEXT,
          decided_by: 'system:auto_escalation',
          decided_at: new Date().toISOString(),
          source: 'auto_escalation',
        });

        await supabaseAdmin
          .from('sabi_projects')
          .update({
            bid_decision: 'no_bid',
            priority: 'ignore',
            notes: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', proj.id);

        await updateProjectStatus(proj.id, 'declined');

        await logActivity(proj.id, 10, 'Bid Decision', 'completed', {
          decision: 'no_bid',
          reason_code: REASON_CODE,
          reason: REASON_TEXT,
          decided_by: 'system:auto_escalation',
          source: 'auto_escalation',
        });

        escalated++;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        failures.push({ project_id: proj.id, error: message });
      }
    }

    return NextResponse.json({
      escalated,
      candidates: stale.length,
      failures: failures.length,
      ...(failures.length > 0 && { failure_details: failures }),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Auto-escalation failed', details: message },
      { status: 500 }
    );
  }
}
