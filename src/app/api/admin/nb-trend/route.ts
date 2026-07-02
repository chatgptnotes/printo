/**
 * GET /api/admin/nb-trend
 *
 * Returns the NB self-eval history (Phase 8) as a sparkline-ready time
 * series — each entry has F1, recommended margin, and skip-rate. Also
 * computes 7-day and 30-day slopes so the operator sees the model-quality
 * trajectory at a glance:
 *
 *   • F1 trending up   → cohort growing, classifier learning new signal
 *   • F1 flat          → stable, recommended margin can be trusted
 *   • F1 trending down → cohort drifting away from training distribution
 *                        (alert via cohort-drift cron should already be
 *                        firing per-cohort)
 *
 * No body. Reads directly from sabi_settings.nb_self_eval_history written
 * by /api/cron/nb-self-eval.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { requireAuth } from '@/lib/shared/api-auth';

export const dynamic = 'force-dynamic';

interface HistoryEntry {
  ran_at?: string;
  ok?: boolean;
  reason?: string;
  recommended_margin?: number | null;
  precision?: number | null;
  recall?: number | null;
  f1?: number | null;
  skip_rate?: number | null;
  cohort_size?: number;
  test_size?: number;
  auto_promoted?: boolean;
}

export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { data } = await supabaseAdmin
    .from('sabi_settings')
    .select('value')
    .eq('key', 'nb_self_eval_history')
    .maybeSingle();

  const history = ((data?.value as { history?: HistoryEntry[] } | null)?.history ?? []) as HistoryEntry[];
  const ok = history.filter(h => h.ok !== false);

  return NextResponse.json({
    total_runs: history.length,
    ok_runs: ok.length,
    last_ran_at: history[0]?.ran_at ?? null,
    series: {
      f1: ok.map(h => ({ at: h.ran_at, value: h.f1 ?? null })),
      precision: ok.map(h => ({ at: h.ran_at, value: h.precision ?? null })),
      recall: ok.map(h => ({ at: h.ran_at, value: h.recall ?? null })),
      skip_rate: ok.map(h => ({ at: h.ran_at, value: h.skip_rate ?? null })),
      recommended_margin: ok.map(h => ({ at: h.ran_at, value: h.recommended_margin ?? null })),
      cohort_size: ok.map(h => ({ at: h.ran_at, value: h.cohort_size ?? null })),
    },
    slopes: {
      f1_7d: slope(ok.map(h => h.f1 ?? null), 7),
      f1_30d: slope(ok.map(h => h.f1 ?? null), 30),
      skip_rate_7d: slope(ok.map(h => h.skip_rate ?? null), 7),
      skip_rate_30d: slope(ok.map(h => h.skip_rate ?? null), 30),
    },
    latest: history[0] ?? null,
  });
}

/**
 * Mean of the last `window` values minus the prior `window` values. Positive
 * = trending up. `values` is in newest-first order (matches how the cron
 * appends history). Returns null when fewer than 2*window samples exist.
 */
function slope(values: Array<number | null>, window: number): number | null {
  const filtered = values.filter((v): v is number => Number.isFinite(v ?? NaN)) as number[];
  if (filtered.length < window * 2) return null;
  const recent = filtered.slice(0, window);
  const prior = filtered.slice(window, window * 2);
  const meanRecent = recent.reduce((s, x) => s + x, 0) / recent.length;
  const meanPrior = prior.reduce((s, x) => s + x, 0) / prior.length;
  return Math.round((meanRecent - meanPrior) * 10000) / 10000;
}
