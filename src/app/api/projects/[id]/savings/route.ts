/**
 * GET /api/projects/[id]/savings
 *
 * Sums heuristic-saving + drawing-cache-hit rows for one project. Lets the
 * bid detail page show "Saved $X.XX via heuristics on this project" so the
 * operator sees per-project accountability for the cost-reduction work.
 *
 * Same data source as /api/admin/cost-trend (lifetime block) — filtered to
 * a single project_id.
 *
 * Response:
 *   {
 *     project_id: string,
 *     total_savings_usd: number,
 *     events: number,                          // total saving events on this project
 *     by_kind: { [kind]: { count, usd } },
 *     latest_event_at: ISO | null,
 *   }
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { requireAuth } from '@/lib/shared/api-auth';

export const dynamic = 'force-dynamic';

interface ActivityRow {
  step_name: string | null;
  details: Record<string, unknown> | null;
  created_at: string | null;
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { data, error } = await supabaseAdmin
    .from('sabi_activity_log')
    .select('step_name, details, created_at')
    .eq('project_id', params.id)
    .eq('step', 0)
    .in('step_name', ['Heuristic Saving', 'Drawing Cache Hit'])
    .limit(2000);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as ActivityRow[];
  let total = 0;
  let latestAt: string | null = null;
  const byKind: Record<string, { count: number; usd: number }> = {};

  for (const row of rows) {
    const d = row.details ?? {};
    const usd = Number(d.est_savings_usd) || 0;
    total += usd;
    const kind = String(d.kind ?? (row.step_name === 'Drawing Cache Hit' ? 'drawing-cache' : 'unknown'));
    const slot = byKind[kind] ??= { count: 0, usd: 0 };
    slot.count++;
    slot.usd += usd;
    if (!latestAt || (row.created_at ?? '') > latestAt) latestAt = row.created_at;
  }

  return NextResponse.json({
    project_id: params.id,
    total_savings_usd: round4(total),
    events: rows.length,
    by_kind: Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, { count: v.count, usd: round4(v.usd) }])),
    latest_event_at: latestAt,
  });
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
