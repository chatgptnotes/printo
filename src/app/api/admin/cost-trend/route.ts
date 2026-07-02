/**
 * GET /api/admin/cost-trend
 *
 * Mirror of /api/admin/nb-trend but for AI spend + heuristic savings.
 * Reads `sabi_activity_log` step=0 rows (the same source as cost-stats),
 * buckets them by ISO date, returns sparkline-ready time series for the
 * dashboard.
 *
 * Three series:
 *   • daily_spend_usd — AI USD spent per day (Claude Token Usage rows)
 *   • daily_savings_usd — heuristic savings per day (Heuristic Saving + Drawing Cache Hit rows)
 *   • cumulative_savings_usd — running total since the start of the window
 *
 * Plus one summary block:
 *   • total_savings_usd  — lifetime sum (all-time, ignoring `days` window)
 *   • savings_by_kind    — lifetime breakdown by heuristic kind (nb-classify, spec-heuristic, etc.)
 *   • spend_slope_7d / spend_slope_30d  — mean(recent) − mean(prior)
 *
 * Query params:
 *   days — sparkline window in days (default 30, max 365)
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

  const sp = request.nextUrl.searchParams;
  const days = Math.min(Math.max(parseInt(sp.get('days') ?? '30', 10) || 30, 7), 365);
  const sinceIso = new Date(Date.now() - days * 86_400_000).toISOString();

  // Lifetime savings query is small + cheap because the savings rows are
  // sparse vs token-usage rows. Pull them across all time.
  const [windowed, lifetimeSavings] = await Promise.all([
    supabaseAdmin
      .from('sabi_activity_log')
      .select('step_name, details, created_at')
      .eq('step', 0)
      .gte('created_at', sinceIso)
      .limit(20000),
    supabaseAdmin
      .from('sabi_activity_log')
      .select('step_name, details')
      .eq('step', 0)
      .in('step_name', ['Heuristic Saving', 'Drawing Cache Hit'])
      .limit(20000),
  ]);

  if (windowed.error) return NextResponse.json({ error: windowed.error.message }, { status: 500 });

  const rows = (windowed.data ?? []) as ActivityRow[];

  // Build day buckets across the full window (zero-fill so the sparkline
  // doesn't have gaps when no events landed on a particular day).
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const dayKeys: string[] = [];
  const dailySpend = new Map<string, number>();
  const dailySavings = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    const k = new Date(today.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    dayKeys.push(k);
    dailySpend.set(k, 0);
    dailySavings.set(k, 0);
  }

  for (const row of rows) {
    const day = (row.created_at ?? '').slice(0, 10);
    if (!day || !dailySpend.has(day)) continue;
    const d = row.details ?? {};
    if (row.step_name === 'Claude Token Usage') {
      dailySpend.set(day, (dailySpend.get(day) ?? 0) + (Number(d.est_cost_usd) || 0));
    } else if (row.step_name === 'Heuristic Saving') {
      dailySavings.set(day, (dailySavings.get(day) ?? 0) + (Number(d.est_savings_usd) || 0));
    } else if (row.step_name === 'Drawing Cache Hit') {
      dailySavings.set(day, (dailySavings.get(day) ?? 0) + (Number(d.est_savings_usd) || 0));
    }
  }

  // Cumulative running total over the window
  const dailySpendArr = dayKeys.map(k => ({ at: k, value: round4(dailySpend.get(k) ?? 0) }));
  const dailySavingsArr = dayKeys.map(k => ({ at: k, value: round4(dailySavings.get(k) ?? 0) }));
  let cum = 0;
  const cumulativeSavingsArr = dayKeys.map(k => {
    cum += dailySavings.get(k) ?? 0;
    return { at: k, value: round4(cum) };
  });

  // Lifetime totals — independent of the sparkline window
  let lifetimeTotal = 0;
  const byKind: Record<string, { count: number; usd: number }> = {};
  for (const row of (lifetimeSavings.data ?? []) as ActivityRow[]) {
    const d = row.details ?? {};
    const usd = Number(d.est_savings_usd) || 0;
    lifetimeTotal += usd;
    const kind = String(d.kind ?? (row.step_name === 'Drawing Cache Hit' ? 'drawing-cache' : 'unknown'));
    const slot = byKind[kind] ??= { count: 0, usd: 0 };
    slot.count++;
    slot.usd += usd;
  }
  const savingsByKind = Object.fromEntries(
    Object.entries(byKind).map(([k, v]) => [k, { count: v.count, usd: round4(v.usd) }]),
  );

  return NextResponse.json({
    window_days: days,
    since: sinceIso,
    series: {
      daily_spend_usd: dailySpendArr,
      daily_savings_usd: dailySavingsArr,
      cumulative_savings_usd: cumulativeSavingsArr,
    },
    slopes: {
      spend_7d: slope(dailySpendArr.map(p => p.value), 7),
      spend_30d: slope(dailySpendArr.map(p => p.value), 30),
    },
    lifetime: {
      total_savings_usd: round4(lifetimeTotal),
      savings_by_kind: savingsByKind,
    },
  });
}

/** mean(last `window`) − mean(prior `window`). Newest-first arrays for parity with nb-trend. */
function slope(values: number[], window: number): number | null {
  if (values.length < window * 2) return null;
  // values is oldest-first here (we built dayKeys with i=days-1 → 0). Reverse so
  // the newest are first, matching nb-trend conventions.
  const reversed = [...values].reverse();
  const recent = reversed.slice(0, window);
  const prior = reversed.slice(window, window * 2);
  const meanRecent = recent.reduce((s, x) => s + x, 0) / recent.length;
  const meanPrior = prior.reduce((s, x) => s + x, 0) / prior.length;
  return Math.round((meanRecent - meanPrior) * 10000) / 10000;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
