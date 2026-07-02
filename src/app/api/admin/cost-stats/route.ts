/**
 * GET /api/admin/cost-stats
 *
 * Surfaces rolling 7-day and 30-day AI spend + savings telemetry from the
 * `sabi_activity_log` rows that `logTokenUsage()` writes per Claude call.
 * Also counts cache-hit rows ('Drawing Cache Hit') and heuristic-savings
 * rows so the team can see whether Phase 1+2+3 cost-reduction work is
 * actually saving money.
 *
 * Response shape:
 *   {
 *     window: '7d' | '30d',
 *     ai_spend_usd: { total, by_model, by_day },
 *     ai_calls: { total, by_model },
 *     cache_hits: { count, est_savings_usd },
 *     heuristic_savings: { count, est_savings_usd, by_kind },
 *   }
 *
 * Query params:
 *   window — '7d' (default) or '30d'
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

export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const window = (request.nextUrl.searchParams.get('window') ?? '7d') as '7d' | '30d';
  const days = window === '30d' ? 30 : 7;
  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabaseAdmin
    .from('sabi_activity_log')
    .select('step_name, details, created_at')
    .eq('step', 0)
    .gte('created_at', sinceIso)
    .limit(20000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as ActivityRow[];

  let aiSpendTotal = 0;
  let aiCalls = 0;
  const byModel: Record<string, { calls: number; usd: number }> = {};
  const byDay: Record<string, number> = {};

  let cacheHits = 0;
  let cacheSavings = 0;

  let heuristicHits = 0;
  let heuristicSavings = 0;
  const heuristicByKind: Record<string, number> = {};

  for (const row of rows) {
    const name = row.step_name ?? '';
    const d = row.details ?? {};

    if (name === 'Claude Token Usage') {
      aiCalls++;
      const usd = Number(d.est_cost_usd) || 0;
      const model = String(d.model ?? 'unknown');
      aiSpendTotal += usd;
      const m = (byModel[model] ??= { calls: 0, usd: 0 });
      m.calls++;
      m.usd += usd;
      const day = (row.created_at ?? '').slice(0, 10);
      if (day) byDay[day] = (byDay[day] ?? 0) + usd;
    } else if (name === 'Drawing Cache Hit') {
      cacheHits++;
      cacheSavings += Number(d.est_savings_usd) || 0;
    } else if (name === 'Heuristic Saving') {
      heuristicHits++;
      heuristicSavings += Number(d.est_savings_usd) || 0;
      const kind = String(d.kind ?? 'unknown');
      heuristicByKind[kind] = (heuristicByKind[kind] ?? 0) + 1;
    }
  }

  return NextResponse.json({
    window,
    since: sinceIso,
    ai_spend_usd: {
      total: round4(aiSpendTotal),
      by_model: Object.fromEntries(
        Object.entries(byModel).map(([k, v]) => [k, { calls: v.calls, usd: round4(v.usd) }]),
      ),
      by_day: Object.fromEntries(Object.entries(byDay).map(([k, v]) => [k, round4(v)])),
    },
    ai_calls: { total: aiCalls, by_model: Object.fromEntries(Object.entries(byModel).map(([k, v]) => [k, v.calls])) },
    cache_hits: { count: cacheHits, est_savings_usd: round4(cacheSavings) },
    heuristic_savings: {
      count: heuristicHits,
      est_savings_usd: round4(heuristicSavings),
      by_kind: heuristicByKind,
    },
  });
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
