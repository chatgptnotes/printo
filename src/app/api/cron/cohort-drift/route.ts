/**
 * GET /api/cron/cohort-drift
 *
 * Daily scan for sudden shifts in cohort multipliers — catches market-rate
 * changes early, before they accumulate as systematic over/under-quoting.
 *
 * Per (service_type, building_type) we compute:
 *   recent  — weighted median ratio of corrections in the last 7 days
 *   baseline— weighted median ratio of corrections in the prior 30 days
 *
 * When |recent - baseline| / baseline > DRIFT_PCT_THRESHOLD AND BOTH
 * windows have ≥ MIN_SAMPLES corrections, fires a WhatsApp alert. Throttled
 * (one per cohort per 12 h) so a sustained shift doesn't spam.
 *
 * Auth: CRON_SECRET via Authorization: Bearer header.
 *
 * Same data source as rate-adjuster.ts (sabi_corrections rate rows). The
 * multiplier maths is intentionally duplicated here rather than reusing the
 * adjuster cache — the adjuster cache aggregates across all-time, this
 * route needs explicit time-window slices that the cache doesn't expose.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { sendApiAlert } from '@/lib/notifications/api-alert';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DRIFT_PCT_THRESHOLD = 0.15; // 15 %
const MIN_SAMPLES = 5;
const RECENT_DAYS = 7;
const BASELINE_DAYS = 30;
const ALERT_THROTTLE_MS = 12 * 60 * 60 * 1000;

const lastAlertAt = new Map<string, number>();

interface RawCorrection {
  field_path: string | null;
  ai_value: unknown;
  human_value: unknown;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = Date.now();
  const recentSinceIso = new Date(now - RECENT_DAYS * 86_400_000).toISOString();
  const baselineSinceIso = new Date(now - (RECENT_DAYS + BASELINE_DAYS) * 86_400_000).toISOString();

  // Pull every rate-correction within the union window. Tag each with which
  // bucket it falls into so we can split them locally without two queries.
  const { data, error } = await supabaseAdmin
    .from('sabi_corrections')
    .select('field_path, ai_value, human_value, metadata, created_at')
    .like('field_path', 'service.%.unit_rate_aed')
    .gte('created_at', baselineSinceIso)
    .limit(5000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Bucket = { recent: number[]; baseline: number[] };
  const byCohort = new Map<string, Bucket>();

  for (const row of (data ?? []) as RawCorrection[]) {
    const path = row.field_path ?? '';
    const m = path.match(/^service\.([a-z_]+)\.unit_rate_aed$/);
    if (!m) continue;
    const serviceType = m[1];
    const buildingType = (row.metadata?.building_type as string | null) ?? 'unknown';
    const ai = Number(row.ai_value);
    const human = Number(row.human_value);
    if (!Number.isFinite(ai) || ai <= 0 || !Number.isFinite(human) || human <= 0) continue;
    const ratio = human / ai;
    if (ratio < 0.2 || ratio > 5) continue;

    const key = `${serviceType}::${buildingType}`;
    let b = byCohort.get(key);
    if (!b) { b = { recent: [], baseline: [] }; byCohort.set(key, b); }
    if ((row.created_at ?? '') >= recentSinceIso) b.recent.push(ratio);
    else b.baseline.push(ratio);
  }

  const drifted: Array<{ cohort: string; recent_median: number; baseline_median: number; shift_pct: number; recent_n: number; baseline_n: number; alerted: boolean }> = [];
  let alertsFired = 0;
  let alertsThrottled = 0;

  for (const [key, b] of byCohort) {
    if (b.recent.length < MIN_SAMPLES || b.baseline.length < MIN_SAMPLES) continue;
    const recentMed = median(b.recent);
    const baselineMed = median(b.baseline);
    if (baselineMed <= 0) continue;
    const shift = (recentMed - baselineMed) / baselineMed;
    if (Math.abs(shift) < DRIFT_PCT_THRESHOLD) continue;

    const last = lastAlertAt.get(key) ?? 0;
    let alerted = false;
    if (now - last >= ALERT_THROTTLE_MS) {
      lastAlertAt.set(key, now);
      const direction = shift > 0 ? '↑' : '↓';
      const pct = (shift * 100).toFixed(1);
      void sendApiAlert(
        'cohort_drift',
        `📊 ERP Realsoft cohort drift: ${key.replace('::', ' / ')} multiplier ${direction}${pct}% over last ${RECENT_DAYS}d (${baselineMed.toFixed(3)} → ${recentMed.toFixed(3)}, n=${b.recent.length}/${b.baseline.length}). Investigate market shift — see /api/admin/rate-adjustments.`,
      );
      alerted = true;
      alertsFired++;
    } else {
      alertsThrottled++;
    }

    drifted.push({
      cohort: key,
      recent_median: round4(recentMed),
      baseline_median: round4(baselineMed),
      shift_pct: round4(shift),
      recent_n: b.recent.length,
      baseline_n: b.baseline.length,
      alerted,
    });
  }

  drifted.sort((a, b) => Math.abs(b.shift_pct) - Math.abs(a.shift_pct));

  // Persist findings so the UI can surface a per-project drift badge without
  // recomputing. Same pattern as nb_self_eval_history (Phase 8).
  try {
    await supabaseAdmin.from('sabi_settings').upsert(
      {
        key: 'cohort_drift_latest',
        value: {
          checked_at: new Date(now).toISOString(),
          drifted,
          cohorts_checked: byCohort.size,
        },
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' },
    );
  } catch (err) {
    console.warn('[cohort-drift] settings write failed:', (err as Error).message);
  }

  return NextResponse.json({
    ok: true,
    checked_at: new Date(now).toISOString(),
    cohorts_checked: byCohort.size,
    drifted: drifted.length,
    alerts_fired: alertsFired,
    alerts_throttled: alertsThrottled,
    samples: drifted,
  });
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
