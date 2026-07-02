/**
 * GET /api/admin/nb-tune
 *
 * Sweeps candidate HIGH_MARGIN thresholds and reports each one's precision /
 * recall / F1 / skip-rate over a chronological holdout. Recommends the
 * lowest margin that keeps precision above a target so the team can set
 * `NB_HIGH_MARGIN` to maximise Haiku calls skipped while not letting
 * misclassifications through.
 *
 * Skip rate = fraction of test emails that would hit the high-confidence
 * path (i.e. would skip Haiku) at this margin. A higher skip rate at the
 * same precision = more $ saved.
 *
 * Same data + chronological-split methodology as /api/admin/nb-eval — only
 * the post-processing differs.
 *
 * Query params:
 *   limit             — default 200, max 800
 *   train_pct         — train fraction (default 80)
 *   target_precision  — recommendation gate (default 0.95)
 *   apply             — '1' to write recommendation to sabi_settings
 *
 * Phase 8 refactor: heavy lifting moved to lib/ai/nb-tune-runner.ts so the
 * /api/cron/nb-self-eval cron can reuse the same logic without an HTTP
 * round-trip.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/shared/api-auth';
import { setNbHighMargin } from '@/lib/ai/naive-bayes-classifier';
import { runNbTune } from '@/lib/ai/nb-tune-runner';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const sp = request.nextUrl.searchParams;
  const limit = parseInt(sp.get('limit') ?? '200', 10);
  const trainPct = parseInt(sp.get('train_pct') ?? '80', 10);
  const targetPrecision = parseFloat(sp.get('target_precision') ?? '0.95');
  const apply = sp.get('apply') === '1';

  const result = await runNbTune({ limit, trainPct, targetPrecision });
  if (!result.ok) return NextResponse.json(result);

  let applied: { margin: number; written_at: string } | null = null;
  if (apply && result.recommended) {
    try {
      await setNbHighMargin(result.recommended.margin, auth.email ?? 'nb-tune');
      applied = { margin: result.recommended.margin, written_at: new Date().toISOString() };
    } catch (err) {
      console.warn('[nb-tune] failed to apply margin:', (err as Error).message);
    }
  }

  return NextResponse.json({
    ok: true,
    applied,
    cohort: result.cohort,
    model: result.model,
    target_precision: result.target_precision,
    sweep: result.sweep,
    recommended: result.recommended
      ? {
          ...result.recommended,
          rationale: `Lowest margin where precision ≥ ${result.target_precision} on ≥10 samples — would skip Haiku on ${(result.recommended.skipRate * 100).toFixed(0)}% of emails.`,
          env_var: `NB_HIGH_MARGIN=${result.recommended.margin}`,
        }
      : { rationale: `No margin in sweep hits target precision ${result.target_precision} with ≥10 samples — keep current margin and grow the dataset.` },
  });
}
