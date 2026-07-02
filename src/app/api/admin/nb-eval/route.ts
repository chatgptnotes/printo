/**
 * GET /api/admin/nb-eval
 *
 * Evaluation harness for the Naive Bayes RFQ classifier — chronological
 * 80/20 holdout. Trains a fresh model on the older 80 % of labelled emails
 * and evaluates it against the newer 20 %. The returned F1 reflects
 * generalisation, not the train-on-everything overfit number the previous
 * harness produced.
 *
 * Cohort (same shape as the in-prod trainer in naive-bayes-classifier.ts):
 *   Positives — emails linked to projects with isRfq=true (Haiku-labelled)
 *   Negatives — emails labelled CATEGORY_PROMOTIONS / FORUMS / SOCIAL by
 *               Gmail, plus any sabi_corrections rows where the human
 *               overrode an AI/NB bid suggestion to no_bid (feedback loop)
 *
 * Both cohorts are joined to sabi_emails for `created_at`, then ordered by
 * date so the holdout is the newest slice — i.e. we predict the future from
 * the past, the only honest split.
 *
 * Query params:
 *   limit       — max emails per class (default 200, max 800)
 *   high_only   — '1' to evaluate only NB calls that hit highConfidence
 *   train_pct   — train fraction (default 80, range 50-90)
 *
 * No body — pure read.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { requireAuth } from '@/lib/shared/api-auth';
import { trainFromDocs, classifyAgainstModel } from '@/lib/ai/naive-bayes-classifier';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface CohortEmail {
  text: string;
  created_at: string;
  isRfq: boolean;
}

export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const sp = request.nextUrl.searchParams;
  const limit = Math.min(Math.max(parseInt(sp.get('limit') ?? '200', 10) || 200, 20), 800);
  const highOnly = sp.get('high_only') === '1';
  const trainPct = Math.min(Math.max(parseInt(sp.get('train_pct') ?? '80', 10) || 80, 50), 90);

  const [posIds, negEmails] = await Promise.all([
    supabaseAdmin
      .from('sabi_projects')
      .select('email_id')
      .not('email_id', 'is', null)
      .eq('ai_classification->>isRfq', 'true')
      .limit(limit),
    supabaseAdmin
      .from('sabi_emails')
      .select('subject, body_text, created_at')
      .or('labels.cs.{CATEGORY_PROMOTIONS},labels.cs.{CATEGORY_FORUMS},labels.cs.{CATEGORY_SOCIAL}')
      .order('created_at', { ascending: false })
      .limit(limit),
  ]);

  const posIdList = (posIds.data ?? []).map(r => r.email_id).filter(Boolean) as string[];
  const { data: posEmails } = await supabaseAdmin
    .from('sabi_emails')
    .select('subject, body_text, created_at')
    .in('id', posIdList);

  const all: CohortEmail[] = [];
  for (const e of (posEmails ?? [])) {
    all.push({ text: `${e.subject ?? ''} ${e.body_text ?? ''}`, created_at: e.created_at ?? '', isRfq: true });
  }
  for (const e of (negEmails.data ?? [])) {
    all.push({ text: `${e.subject ?? ''} ${e.body_text ?? ''}`, created_at: e.created_at ?? '', isRfq: false });
  }

  if (all.length < 30) {
    return NextResponse.json({
      ok: false,
      reason: 'Cohort too small for holdout split (<30 labelled emails)',
      cohort_size: all.length,
    });
  }

  // Chronological split — oldest trainPct% trains, newest 100-trainPct% tests
  all.sort((a, b) => a.created_at.localeCompare(b.created_at));
  const splitIdx = Math.floor((all.length * trainPct) / 100);
  const train = all.slice(0, splitIdx);
  const test = all.slice(splitIdx);

  const trainPos = train.filter(e => e.isRfq).map(e => e.text);
  const trainNeg = train.filter(e => !e.isRfq).map(e => e.text);
  const model = trainFromDocs(trainPos, trainNeg);
  if (!model) {
    return NextResponse.json({
      ok: false,
      reason: 'Train slice has fewer than 10 examples in one of the classes',
      train_pos: trainPos.length,
      train_neg: trainNeg.length,
    });
  }

  let tp = 0, fp = 0, tn = 0, fn = 0;
  let highConfHits = 0;
  let evaluated = 0;
  let testWindowStart: string | null = null;
  let testWindowEnd: string | null = null;

  for (const e of test) {
    if (!testWindowStart || e.created_at < testWindowStart) testWindowStart = e.created_at;
    if (!testWindowEnd || e.created_at > testWindowEnd) testWindowEnd = e.created_at;
    const r = classifyAgainstModel(model, e.text.slice(0, 4000), '');
    if (!r) continue;
    if (highOnly && !r.highConfidence) continue;
    if (r.highConfidence) highConfHits++;
    evaluated++;
    if (e.isRfq && r.isRfq) tp++;
    else if (!e.isRfq && !r.isRfq) tn++;
    else if (!e.isRfq && r.isRfq) fp++;
    else fn++;
  }

  if (evaluated === 0) {
    return NextResponse.json({
      ok: false,
      reason: 'No test rows evaluated — likely all below highConfidence threshold',
      train_size: train.length,
      test_size: test.length,
    });
  }

  const accuracy = (tp + tn) / evaluated;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return NextResponse.json({
    ok: true,
    cohort: {
      total: all.length,
      train_size: train.length,
      test_size: test.length,
      train_split_pct: trainPct,
      test_window: { start: testWindowStart, end: testWindowEnd },
    },
    model: {
      train_positives: trainPos.length,
      train_negatives: trainNeg.length,
      vocab_size: model.vocabulary.size,
    },
    eval: {
      evaluated,
      high_confidence_count: highConfHits,
      filter: highOnly ? 'high_confidence_only' : 'all',
    },
    confusion: { tp, fp, tn, fn },
    metrics: {
      accuracy: round4(accuracy),
      precision: round4(precision),
      recall: round4(recall),
      f1: round4(f1),
    },
  });
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
