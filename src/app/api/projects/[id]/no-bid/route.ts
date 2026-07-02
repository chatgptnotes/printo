/**
 * POST /api/projects/[id]/no-bid
 *
 * Gate 10 decline path. User picked "No-Bid" — tag the inquiry with a reason
 * and move it to the dedicated no-bid list. Per the 2026-04-16 demo (pg 35),
 * rejected inquiries MUST carry a reason so we can review what we turned down.
 *
 * Body: { reason: string, decided_by?: string }
 *
 * Writes:
 *   - sabi_projects.ai_classification.no_bid_reason   = reason
 *   - sabi_projects.ai_classification.no_bid_at       = ISO timestamp
 *   - sabi_projects.ai_classification.no_bid_decided_by = decided_by
 *   - sabi_projects.priority                          = 'ignore'
 *   - sabi_projects.status                            = 'declined'
 *   - sabi_activity_log                               = decision row
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { requireAuth } from '@/lib/shared/api-auth';
import { logActivity, updateProjectStatus } from '@/lib/storage/activity-logger';

export const dynamic = 'force-dynamic';

interface Body {
  reason?: string;
  decided_by?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const body = (await request.json().catch(() => ({}))) as Body;
    const reason = (body.reason ?? '').trim();
    const decidedBy = (body.decided_by ?? '').trim() || 'estimator';

    if (!reason) {
      return NextResponse.json(
        { error: 'reason is required — no-bid decisions must capture why (pg 35).' },
        { status: 400 }
      );
    }

    const { data: project, error } = await supabaseAdmin
      .from('sabi_projects')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const aiClassification = (project.ai_classification ?? {}) as Record<string, unknown>;
    const merged = {
      ...aiClassification,
      no_bid_reason: reason,
      no_bid_at: new Date().toISOString(),
      no_bid_decided_by: decidedBy,
    };

    const { error: updErr } = await supabaseAdmin
      .from('sabi_projects')
      .update({
        priority: 'ignore',
        ai_classification: merged,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (updErr) throw new Error(`Failed to persist no-bid: ${updErr.message}`);

    await updateProjectStatus(id, 'declined');

    await logActivity(id, 10, 'Bid Decision', 'completed', {
      decision: 'no_bid',
      reason,
      decided_by: decidedBy,
    });

    return NextResponse.json({
      ok: true,
      project_id: id,
      status: 'declined',
      reason,
      decided_by: decidedBy,
    });
  } catch (err: any) {
    console.error('No-bid error:', err);
    await logActivity(id, 10, 'Bid Decision', 'failed', { error: err.message });
    return NextResponse.json(
      { error: 'No-bid decision failed', details: err.message },
      { status: 500 }
    );
  }
}
