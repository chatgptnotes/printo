/**
 * Shared core for NB margin tuning. Extracted from /api/admin/nb-tune so the
 * /api/cron/nb-self-eval route can call the same logic without an HTTP
 * round-trip or auth dance.
 *
 * Pure-ish: reads sabi_emails / sabi_projects (no caches), trains a fresh
 * model, sweeps margins, returns a structured result. Caller decides whether
 * to apply, log, or alert based on the output.
 */
import { supabaseAdmin } from '@/lib/storage/supabase';
import { trainFromDocs, classifyAgainstModel } from '@/lib/ai/naive-bayes-classifier';

const MARGIN_GRID = [1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 5.0, 6.0];

export interface NbTuneOptions {
  limit?: number;            // per-class cap (default 200, max 800)
  trainPct?: number;         // train fraction (50–90, default 80)
  targetPrecision?: number;  // recommendation gate (0.5–1.0, default 0.95)
}

export interface MarginSweepResult {
  margin: number;
  evaluated: number;
  skipRate: number;
  tp: number; fp: number; tn: number; fn: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface NbTuneOutcome {
  ok: true;
  cohort: { total: number; train_size: number; test_size: number; train_split_pct: number };
  model: { train_positives: number; train_negatives: number; vocab_size: number };
  sweep: MarginSweepResult[];
  recommended: { margin: number; precision: number; recall: number; skipRate: number; f1: number } | null;
  target_precision: number;
}

export interface NbTuneFailure {
  ok: false;
  reason: string;
  details?: Record<string, unknown>;
}

export type NbTuneResult = NbTuneOutcome | NbTuneFailure;

interface CohortEmail {
  text: string;
  created_at: string;
  isRfq: boolean;
}

export async function runNbTune(opts: NbTuneOptions = {}): Promise<NbTuneResult> {
  const limit = clamp(opts.limit ?? 200, 20, 800);
  const trainPct = clamp(opts.trainPct ?? 80, 50, 90);
  const targetPrecision = clampF(opts.targetPrecision ?? 0.95, 0.5, 1.0);

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
  for (const e of posEmails ?? []) {
    all.push({ text: `${e.subject ?? ''} ${e.body_text ?? ''}`, created_at: e.created_at ?? '', isRfq: true });
  }
  for (const e of negEmails.data ?? []) {
    all.push({ text: `${e.subject ?? ''} ${e.body_text ?? ''}`, created_at: e.created_at ?? '', isRfq: false });
  }

  if (all.length < 30) {
    return { ok: false, reason: 'Cohort too small (<30 labelled emails)', details: { cohort_size: all.length } };
  }

  all.sort((a, b) => a.created_at.localeCompare(b.created_at));
  const splitIdx = Math.floor((all.length * trainPct) / 100);
  const train = all.slice(0, splitIdx);
  const test = all.slice(splitIdx);
  const trainPos = train.filter(e => e.isRfq).map(e => e.text);
  const trainNeg = train.filter(e => !e.isRfq).map(e => e.text);
  const model = trainFromDocs(trainPos, trainNeg);
  if (!model) {
    return { ok: false, reason: 'Train slice has fewer than 10 examples in one class', details: { train_pos: trainPos.length, train_neg: trainNeg.length } };
  }

  // Score each test row once, sweep margins post-hoc
  const scored: Array<{ margin: number; isRfq: boolean; expected: boolean }> = [];
  for (const e of test) {
    const r = classifyAgainstModel(model, e.text.slice(0, 4000), '');
    if (!r) continue;
    scored.push({ margin: r.margin, isRfq: r.isRfq, expected: e.isRfq });
  }
  if (scored.length === 0) {
    return { ok: false, reason: 'No test rows scored', details: { train_size: train.length, test_size: test.length } };
  }

  const sweep: MarginSweepResult[] = MARGIN_GRID.map(margin => {
    let tp = 0, fp = 0, tn = 0, fn = 0;
    for (const s of scored) {
      if (s.margin < margin) continue;
      if (s.expected && s.isRfq) tp++;
      else if (!s.expected && !s.isRfq) tn++;
      else if (!s.expected && s.isRfq) fp++;
      else fn++;
    }
    const evaluated = tp + fp + tn + fn;
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    return {
      margin,
      evaluated,
      skipRate: evaluated / scored.length,
      tp, fp, tn, fn,
      precision: round4(precision),
      recall: round4(recall),
      f1: round4(f1),
    };
  });

  const eligible = sweep.filter(s => s.precision >= targetPrecision && s.evaluated >= 10);
  const winner = eligible.length > 0 ? eligible[0] : null;

  return {
    ok: true,
    cohort: { total: all.length, train_size: train.length, test_size: test.length, train_split_pct: trainPct },
    model: { train_positives: trainPos.length, train_negatives: trainNeg.length, vocab_size: model.vocabulary.size },
    sweep,
    recommended: winner
      ? { margin: winner.margin, precision: winner.precision, recall: winner.recall, skipRate: round4(winner.skipRate), f1: winner.f1 }
      : null,
    target_precision: targetPrecision,
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(Math.round(n), lo), hi);
}
function clampF(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
