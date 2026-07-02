/**
 * GET /api/admin/health
 *
 * Aggregates all the system-health signals into one response so the
 * /admin/health page can render a single traffic-light dashboard. Every
 * signal returns a `{ status: 'green' | 'yellow' | 'red' | 'gray', ... }`
 * shape with a uniform `last_at` timestamp so the page can age-shade them
 * without per-signal logic.
 *
 * Signals:
 *   nb_self_eval         — when did the cron last run + recent F1
 *   cohort_drift         — when did the drift cron last run + how many cohorts drifted
 *   nb_auto_promote      — current margin + when was it last auto-applied
 *   ai_spend_trend       — 7d/30d slope on AI spend (informational)
 *   savings_volume       — lifetime savings from the cost-trend lifetime block
 *
 * Pure read. No writes.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { requireAuth } from '@/lib/shared/api-auth';

export const dynamic = 'force-dynamic';

type Status = 'green' | 'yellow' | 'red' | 'gray';

interface Signal {
  status: Status;
  label: string;
  last_at: string | null;
  hours_since_last: number | null;
  details: Record<string, unknown>;
}

const HOUR_MS = 3600_000;

export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const [nbHistRes, driftRes, nbConfRes, costRows] = await Promise.all([
    supabaseAdmin.from('sabi_settings').select('value').eq('key', 'nb_self_eval_history').maybeSingle(),
    supabaseAdmin.from('sabi_settings').select('value').eq('key', 'cohort_drift_latest').maybeSingle(),
    supabaseAdmin.from('sabi_settings').select('value, updated_at').eq('key', 'nb_classifier').maybeSingle(),
    supabaseAdmin
      .from('sabi_activity_log')
      .select('details, created_at')
      .eq('step', 0)
      .eq('step_name', 'Claude Token Usage')
      .gte('created_at', new Date(Date.now() - 60 * 86_400_000).toISOString())
      .limit(20000),
  ]);

  const now = Date.now();
  const nbHistory = ((nbHistRes.data?.value as { history?: Array<Record<string, unknown>>; last_ran_at?: string } | null)) ?? null;
  const driftLatest = (driftRes.data?.value as { checked_at?: string; drifted?: Array<unknown>; cohorts_checked?: number } | null) ?? null;
  const nbConf = (nbConfRes.data?.value as { high_margin?: number; updated_by?: string; updated_at?: string } | null) ?? null;
  const nbConfUpdatedAt = (nbConfRes.data?.updated_at as string | undefined) ?? nbConf?.updated_at ?? null;

  // ── Signal 1: NB self-eval freshness × quality ────────────────────────────
  const nbLast = nbHistory?.last_ran_at ?? null;
  const latestEntry = nbHistory?.history?.[0] as { f1?: number; recommended_margin?: number; ok?: boolean } | undefined;
  const f1 = Number(latestEntry?.f1);
  const ageH = nbLast ? (now - Date.parse(nbLast)) / HOUR_MS : null;
  const nbStatus = computeNbStatus(ageH, f1, latestEntry?.ok !== false);
  const nbSelfEval: Signal = {
    status: nbStatus,
    label:
      nbStatus === 'green'
        ? `Fresh, F1 ${f1.toFixed(3)}`
        : nbStatus === 'yellow'
        ? `F1 ${Number.isFinite(f1) ? f1.toFixed(3) : 'n/a'} or stale`
        : nbStatus === 'red'
        ? 'Stale or low F1'
        : 'No runs yet',
    last_at: nbLast,
    hours_since_last: ageH != null ? Math.round(ageH * 10) / 10 : null,
    details: {
      total_runs: nbHistory?.history?.length ?? 0,
      latest_f1: Number.isFinite(f1) ? f1 : null,
      latest_margin: latestEntry?.recommended_margin ?? null,
    },
  };

  // ── Signal 2: cohort drift run freshness + drifted count ──────────────────
  const driftLast = driftLatest?.checked_at ?? null;
  const driftedCount = driftLatest?.drifted?.length ?? 0;
  const driftAgeH = driftLast ? (now - Date.parse(driftLast)) / HOUR_MS : null;
  const driftStatus = computeDriftStatus(driftAgeH, driftedCount);
  const cohortDrift: Signal = {
    status: driftStatus,
    label:
      driftStatus === 'green'
        ? 'No drift'
        : driftStatus === 'yellow'
        ? `${driftedCount} cohort(s) drifted`
        : driftStatus === 'red'
        ? 'Stale or many drifts'
        : 'No runs yet',
    last_at: driftLast,
    hours_since_last: driftAgeH != null ? Math.round(driftAgeH * 10) / 10 : null,
    details: {
      drifted: driftedCount,
      cohorts_checked: driftLatest?.cohorts_checked ?? 0,
    },
  };

  // ── Signal 3: NB auto-promote (current margin) ────────────────────────────
  const margin = nbConf?.high_margin ?? null;
  const promoteAgeH = nbConfUpdatedAt ? (now - Date.parse(nbConfUpdatedAt)) / HOUR_MS : null;
  const promotedRecently = (promoteAgeH != null && promoteAgeH < 168);
  const nbAutoPromote: Signal = {
    status: margin == null ? 'gray' : promotedRecently ? 'green' : 'yellow',
    label: margin == null ? 'Default margin (env or fallback)' : `NB_HIGH_MARGIN=${margin} (${nbConf?.updated_by ?? 'manual'})`,
    last_at: nbConfUpdatedAt,
    hours_since_last: promoteAgeH != null ? Math.round(promoteAgeH * 10) / 10 : null,
    details: { margin, updated_by: nbConf?.updated_by ?? null },
  };

  // ── Signal 4: AI spend trend (informational) ──────────────────────────────
  const dailySpend = bucketDailySpend(costRows.data ?? []);
  const slope7d = slope(dailySpend, 7);
  const slope30d = slope(dailySpend, 30);
  const aiSpendTrend: Signal = {
    status: slope7d == null ? 'gray' : slope7d > 0.1 ? 'red' : slope7d > 0 ? 'yellow' : 'green',
    label: slope7d == null ? 'Insufficient data' : `Spend ${formatSlope(slope7d)} (7d) · ${formatSlope(slope30d)} (30d)`,
    last_at: dailySpend[0]?.day ?? null,
    hours_since_last: null,
    details: { slope_7d_usd: slope7d, slope_30d_usd: slope30d, days_with_data: dailySpend.length },
  };

  return NextResponse.json({
    checked_at: new Date(now).toISOString(),
    signals: {
      nb_self_eval: nbSelfEval,
      cohort_drift: cohortDrift,
      nb_auto_promote: nbAutoPromote,
      ai_spend_trend: aiSpendTrend,
    },
  });
}

function computeNbStatus(ageH: number | null, f1: number, ok: boolean): Status {
  if (ageH == null) return 'gray';
  if (!ok) return 'red';
  // Stale > 72h regardless of F1 → red
  if (ageH > 72) return 'red';
  if (ageH > 30) return 'yellow';
  if (!Number.isFinite(f1)) return 'gray';
  if (f1 >= 0.95) return 'green';
  if (f1 >= 0.85) return 'yellow';
  return 'red';
}

function computeDriftStatus(ageH: number | null, drifted: number): Status {
  if (ageH == null) return 'gray';
  if (ageH > 72) return 'red';
  if (drifted >= 5) return 'red';
  if (drifted > 0) return 'yellow';
  return 'green';
}

interface DayBucket { day: string; usd: number }

function bucketDailySpend(rows: Array<{ details: Record<string, unknown> | null; created_at: string | null }>): DayBucket[] {
  const byDay = new Map<string, number>();
  for (const row of rows) {
    const day = (row.created_at ?? '').slice(0, 10);
    if (!day) continue;
    const usd = Number(row.details?.est_cost_usd) || 0;
    byDay.set(day, (byDay.get(day) ?? 0) + usd);
  }
  return [...byDay.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([day, usd]) => ({ day, usd }));
}

function slope(daily: DayBucket[], window: number): number | null {
  if (daily.length < window * 2) return null;
  const recent = daily.slice(0, window).map(d => d.usd);
  const prior = daily.slice(window, window * 2).map(d => d.usd);
  const meanRecent = recent.reduce((s, x) => s + x, 0) / recent.length;
  const meanPrior = prior.reduce((s, x) => s + x, 0) / prior.length;
  return Math.round((meanRecent - meanPrior) * 10000) / 10000;
}

function formatSlope(s: number | null): string {
  if (s == null) return 'n/a';
  const sign = s >= 0 ? '+' : '';
  return `${sign}$${s.toFixed(3)}/d`;
}
