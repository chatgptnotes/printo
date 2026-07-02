/**
 * GET /api/cron/ai-cost-drift
 *
 * Daily AI-spend drift detector. Compares yesterday's AI spend against the
 * trailing 30-day baseline (mean + stdev). When yesterday is more than
 * DRIFT_SIGMA standard deviations above the mean, fires a WhatsApp alert via
 * the existing api-alert.ts so the team sees a runaway spend BEFORE
 * MAX_DAILY_AI_USD trips the kill switch.
 *
 * Why this matters: budget-guard.ts (Phase 1) is binary — once the cap is
 * hit, all AI calls fail. This detector gives an early warning so a sudden
 * 3× regression (e.g. a new prompt forgot to cache) is caught the morning
 * after, not after a week of burn.
 *
 * Reads the same `sabi_activity_log` step=0 step_name='Claude Token Usage'
 * rows that /api/admin/cost-stats reads — single source of truth.
 *
 * Auth: CRON_SECRET via Authorization: Bearer header (Vercel cron pattern).
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { sendApiAlert } from '@/lib/notifications/api-alert';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BASELINE_DAYS = 30;
const DRIFT_SIGMA = 2;
const MIN_BASELINE_SAMPLES = 7; // need at least a week of data before alerting

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sinceIso = new Date(Date.now() - (BASELINE_DAYS + 1) * 86400_000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('sabi_activity_log')
    .select('details, created_at')
    .eq('step', 0)
    .eq('step_name', 'Claude Token Usage')
    .gte('created_at', sinceIso)
    .limit(20000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Bucket spend by ISO date (UTC). Day 0 = yesterday.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const byDay = new Map<string, number>();
  for (const row of data ?? []) {
    const usd = Number((row.details as Record<string, unknown> | null)?.est_cost_usd) || 0;
    const day = (row.created_at as string).slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + usd);
  }

  const yesterday = new Date(today.getTime() - 86400_000).toISOString().slice(0, 10);
  const yesterdaySpend = byDay.get(yesterday) ?? 0;

  // Baseline = trailing 30 days excluding yesterday
  const baseline: number[] = [];
  for (let i = 2; i <= BASELINE_DAYS + 1; i++) {
    const d = new Date(today.getTime() - i * 86400_000).toISOString().slice(0, 10);
    baseline.push(byDay.get(d) ?? 0);
  }

  if (baseline.length < MIN_BASELINE_SAMPLES) {
    return NextResponse.json({
      ok: true,
      checked: yesterday,
      yesterday_usd: round4(yesterdaySpend),
      decision: 'insufficient_baseline',
      baseline_samples: baseline.length,
    });
  }

  const mean = baseline.reduce((s, x) => s + x, 0) / baseline.length;
  const variance = baseline.reduce((s, x) => s + (x - mean) ** 2, 0) / baseline.length;
  const stdev = Math.sqrt(variance);
  const threshold = mean + DRIFT_SIGMA * stdev;

  let decision: 'ok' | 'alert' = 'ok';
  if (yesterdaySpend > threshold && yesterdaySpend > mean * 1.5) {
    decision = 'alert';
    const ratio = mean > 0 ? (yesterdaySpend / mean).toFixed(2) : '∞';
    void sendApiAlert(
      'cost_drift',
      `📈 ERP Realsoft AI cost drift: yesterday ($${yesterdaySpend.toFixed(2)}) is ${ratio}× the 30-day mean ($${mean.toFixed(2)} ±$${stdev.toFixed(2)}). Investigate recent deploy/cron changes — see /api/admin/cost-stats.`,
    );
  }

  return NextResponse.json({
    ok: true,
    checked: yesterday,
    yesterday_usd: round4(yesterdaySpend),
    baseline: {
      mean_usd: round4(mean),
      stdev_usd: round4(stdev),
      samples: baseline.length,
      threshold_usd: round4(threshold),
    },
    decision,
  });
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
