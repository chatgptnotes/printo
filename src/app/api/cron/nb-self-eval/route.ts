/**
 * GET /api/cron/nb-self-eval
 *
 * Nightly NB margin tuning. Runs the same sweep as /api/admin/nb-tune, then
 * records the recommended margin + winning F1 + skip-rate to sabi_activity_log
 * step=0 step_name='NB Self-Eval'. The /api/admin/cost-stats endpoint can
 * surface the trend over time so the operator sees NB quality trajectory
 * without having to run the eval manually.
 *
 * Auto-promote behaviour:
 *   NB_AUTO_PROMOTE=1 — write the recommendation to sabi_settings via the
 *                       same path as nb-tune?apply=1.
 *   else            — log only (default; safer until the operator has seen
 *                     a few cycles and trusts the recommendation).
 *
 * Auth: CRON_SECRET via Authorization: Bearer header. Same pattern as the
 * other cron routes (/auto-escalate-stale, /ai-cost-drift, /cohort-drift).
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { runNbTune } from '@/lib/ai/nb-tune-runner';
import { setNbHighMargin } from '@/lib/ai/naive-bayes-classifier';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await runNbTune();
  if (!result.ok) {
    // Still log the no-op so the trend chart shows "no data" days, not gaps
    await logSelfEval({ ok: false, reason: result.reason });
    return NextResponse.json({ ok: true, evaluated: false, reason: result.reason });
  }

  const winner = result.recommended;
  // Phase 12: stability-gated auto-promote. The opt-in env still acts as a
  // master switch; once enabled, we apply the recommendation ONLY when:
  //   • last 7 self-eval runs all had F1 >= STABLE_F1
  //   • the recommended margin has been the same for ≥ STABLE_MARGIN_RUNS
  //     of those runs (a single noisy run can't flip prod margin)
  // Otherwise we log the recommendation but leave the live margin alone.
  const STABLE_F1 = 0.95;
  const STABLE_RUNS = 7;
  const STABLE_MARGIN_RUNS = 3;

  const autoPromoteEnabled = process.env.NB_AUTO_PROMOTE === '1';
  let applied: { margin: number; written_at: string } | null = null;
  let stabilityGate: { passed: boolean; reason: string; recent_f1s: number[]; recent_margins: number[] } = {
    passed: false,
    reason: 'auto-promote disabled (NB_AUTO_PROMOTE != 1)',
    recent_f1s: [],
    recent_margins: [],
  };

  if (autoPromoteEnabled && winner) {
    const history = await readNbHistory();
    const recent = history.slice(0, STABLE_RUNS);
    const f1s = recent.map(h => Number(h.f1)).filter(n => Number.isFinite(n));
    const margins = recent.map(h => Number(h.recommended_margin)).filter(n => Number.isFinite(n));
    const allHighF1 = f1s.length === STABLE_RUNS && f1s.every(f => f >= STABLE_F1);
    const sameMarginCount = margins.filter(m => m === winner.margin).length;
    const marginStable = sameMarginCount >= STABLE_MARGIN_RUNS;

    stabilityGate = {
      passed: allHighF1 && marginStable,
      reason: !allHighF1
        ? `F1 not stable above ${STABLE_F1} for ${STABLE_RUNS} runs (have ${f1s.length}, lowest ${f1s.length ? Math.min(...f1s).toFixed(3) : 'n/a'})`
        : !marginStable
        ? `recommended margin ${winner.margin} only seen ${sameMarginCount}× in last ${STABLE_RUNS} runs (need ${STABLE_MARGIN_RUNS})`
        : 'stable',
      recent_f1s: f1s,
      recent_margins: margins,
    };

    if (stabilityGate.passed) {
      try {
        await setNbHighMargin(winner.margin, 'nb-self-eval-cron-stable');
        applied = { margin: winner.margin, written_at: new Date().toISOString() };
      } catch (err) {
        console.warn('[nb-self-eval] auto-promote failed:', (err as Error).message);
      }
    } else {
      console.log(`[nb-self-eval] auto-promote skipped: ${stabilityGate.reason}`);
    }
  }

  await logSelfEval({
    ok: true,
    recommended_margin: winner?.margin ?? null,
    precision: winner?.precision ?? null,
    recall: winner?.recall ?? null,
    f1: winner?.f1 ?? null,
    skip_rate: winner?.skipRate ?? null,
    cohort_size: result.cohort.total,
    test_size: result.cohort.test_size,
    auto_promoted: applied !== null,
    stability_gate: stabilityGate,
  });

  return NextResponse.json({
    ok: true,
    evaluated: true,
    recommended: winner,
    auto_promoted: applied,
    stability_gate: stabilityGate,
  });
}

/**
 * Read the live self-eval history (newest-first) from sabi_settings. Used
 * by the stability gate to decide whether the most recent recommendation
 * is well-supported by prior runs.
 */
async function readNbHistory(): Promise<Array<Record<string, unknown>>> {
  try {
    const { data } = await supabaseAdmin
      .from('sabi_settings')
      .select('value')
      .eq('key', 'nb_self_eval_history')
      .maybeSingle();
    return ((data?.value as { history?: Array<Record<string, unknown>> } | null)?.history ?? []) as Array<Record<string, unknown>>;
  } catch {
    return [];
  }
}

const MAX_HISTORY = 90;

/**
 * Append the self-eval outcome to sabi_settings.nb_self_eval_history.
 * Activity_log requires a project_id (NOT NULL), and self-eval is a system-
 * level event — so it lives in settings instead.
 *
 * Phase 11: when the live key reaches MAX_HISTORY entries, the OLDEST entries
 * are spilled into a monthly archive key (`nb_self_eval_archive_yyyy_mm`)
 * before the live key is trimmed. Lossless rotation — long-range trend
 * analysis can stitch live + archive keys together when needed.
 */
async function logSelfEval(details: Record<string, unknown>): Promise<void> {
  try {
    const { data } = await supabaseAdmin
      .from('sabi_settings')
      .select('value')
      .eq('key', 'nb_self_eval_history')
      .maybeSingle();
    const prior = (data?.value as { history?: Array<Record<string, unknown>> } | null)?.history ?? [];
    const entry = { ...details, ran_at: new Date().toISOString() };
    const newestFirst = [entry, ...prior];

    if (newestFirst.length > MAX_HISTORY) {
      // Spill the overflow (oldest) into the archive bucket keyed by the
      // ran_at month of the FIRST overflowed entry. Group the whole overflow
      // chunk under one archive key — typically all from the same month.
      await rotateOverflow(newestFirst.slice(MAX_HISTORY));
    }

    const next = newestFirst.slice(0, MAX_HISTORY);
    await supabaseAdmin.from('sabi_settings').upsert(
      {
        key: 'nb_self_eval_history',
        value: { history: next, last_ran_at: entry.ran_at },
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' },
    );
  } catch (err) {
    console.warn('[nb-self-eval] settings write failed:', (err as Error).message);
  }
}

/**
 * Append `overflow` entries to a month-keyed archive row. Called only when
 * the live history overflows MAX_HISTORY. `overflow` is in newest-first order
 * (the slice tail of the live array) — same shape as the live history.
 *
 * Group key: 'nb_self_eval_archive_yyyy_mm' from the OLDEST entry in
 * the overflow batch. This keeps overflows from a single month in one row
 * rather than producing many partially-filled archive rows.
 */
async function rotateOverflow(overflow: Array<Record<string, unknown>>): Promise<void> {
  if (overflow.length === 0) return;
  const oldest = overflow[overflow.length - 1];
  const ranAt = (oldest.ran_at as string | undefined) ?? new Date().toISOString();
  const monthKey = `nb_self_eval_archive_${ranAt.slice(0, 7).replace('-', '_')}`;

  const { data } = await supabaseAdmin
    .from('sabi_settings')
    .select('value')
    .eq('key', monthKey)
    .maybeSingle();
  const archived = (data?.value as { history?: Array<Record<string, unknown>> } | null)?.history ?? [];
  // Concatenate keeping newest-first order
  const merged = [...archived, ...overflow];
  await supabaseAdmin.from('sabi_settings').upsert(
    {
      key: monthKey,
      value: { history: merged, archived_at: new Date().toISOString(), entries: merged.length },
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' },
  );
  console.log(`[nb-self-eval] rotated ${overflow.length} entries → ${monthKey} (${merged.length} total in archive)`);
}
