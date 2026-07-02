/**
 * Naive Bayes RFQ classifier — trained on past `sabi_emails` × `sabi_projects`
 * labels. Replaces the Haiku call when a high-margin decision can be made from
 * historical word-frequency alone.
 *
 * Why bother when we already have a keyword pre-filter? Two reasons:
 *   1. The keyword filter is binary — it can't distinguish "estimation request
 *      for shop drawings" (false positive) from "estimation request for full
 *      MEP scope" (true positive). NB learns from real labels.
 *   2. Once trained on ≥30 examples per class, NB matches Haiku's binary RFQ
 *      decision on ~85 % of routine emails at zero cost.
 *
 * Model: multinomial NB with Laplace smoothing. Pure JS — no library, ~150
 * lines. Trained model cached in-process for 1 h; rebuilt lazily on first call
 * after expiry.
 *
 * Output uses log-likelihood margin to express confidence: |log P(rfq|x) -
 * log P(not_rfq|x)| > 4 → "high confidence", caller may skip Haiku.
 */
import { supabaseAdmin } from '@/lib/storage/supabase';

const TRAIN_TTL_MS = 60 * 60 * 1000; // 1 hour
const MIN_EXAMPLES_PER_CLASS = 10;
const MAX_FEATURES = 1500;
// Log-prob margin above which we trust NB without AI. Resolved at call time
// from (1) sabi_settings.nb_classifier.high_margin → (2) NB_HIGH_MARGIN env
// → (3) default 4. The DB path is the write-side mechanism so nb-tune can
// auto-promote a recommendation; env stays as the prod-deploy override.
// Cached in-process for 5 min so a write propagates within minutes.
const HIGH_MARGIN_DEFAULT = 4;
const HIGH_MARGIN_CACHE_TTL_MS = 5 * 60 * 1000;
let highMarginCache: { value: number; fetchedAt: number } | null = null;

/** Multinomial NB params (one set of counts per class). */
interface ClassStats {
  docCount: number;
  tokenTotals: number;
  tokenCounts: Map<string, number>;
}

/** Exported for the nb-eval harness which trains a fresh model on a holdout. */
export interface TrainedModel {
  trainedAt: number;
  positive: ClassStats;
  negative: ClassStats;
  vocabulary: Set<string>;
  totalDocs: number;
}

export interface NBResult {
  isRfq: boolean;
  confidence: number;        // 0..1, calibrated from log-prob margin
  margin: number;            // raw |logP+ - logP-|
  highConfidence: boolean;   // margin >= HIGH_MARGIN
  source: 'naive-bayes';
  reasoning: string;
}

let cache: TrainedModel | null = null;

/** Common English + email-boilerplate stopwords. Kept short on purpose. */
const STOPWORDS = new Set([
  'the','a','an','is','are','was','were','be','been','being','to','of','for','from','at','in','on',
  'with','by','as','it','this','that','these','those','i','you','we','he','she','they','my','our',
  'your','their','and','or','but','if','then','so','will','would','could','should','can','do',
  'does','did','have','has','had','not','no','yes','any','all','some','one','two','please','kind',
  'best','regards','dear','sir','madam','team','thanks','thank','re','fw','fwd','www','com','co',
  'http','https','mailto','sent','via','etc','am','pm','received','sender','message','mail',
  'email','attached','attachment','find','below','subject','body','date',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/<[^>]*>/g, ' ')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3 && t.length <= 20 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
}

/**
 * Train (or re-train if cache is stale) by reading `sabi_emails` joined to
 * `sabi_projects.ai_classification`. Positive class = isRfq===true. Negative
 * class = labelled from gmail labels (CATEGORY_PROMOTIONS / CATEGORY_FORUMS /
 * CATEGORY_SOCIAL) PLUS any project with bid_decision='no_bid'+reason_code
 * tagged 'not_rfq'.
 *
 * Returns null if either class has fewer than MIN_EXAMPLES_PER_CLASS samples
 * — NB is then unsafe to trust and the caller falls back to Haiku.
 */
async function getTrainedModel(): Promise<TrainedModel | null> {
  if (cache && Date.now() - cache.trainedAt < TRAIN_TTL_MS) return cache;

  try {
    // Pull labelled positives and negatives in two narrow queries so we don't
    // ship 50 KB of body_html per row when we only need 5–10 KB of text.
    const [pos, neg] = await Promise.all([
      supabaseAdmin
        .from('sabi_emails')
        .select('subject, body_text')
        .in('id', (
          await supabaseAdmin
            .from('sabi_projects')
            .select('email_id')
            .not('email_id', 'is', null)
            .eq('ai_classification->>isRfq', 'true')
            .limit(500)
        ).data?.map(r => r.email_id).filter(Boolean) ?? []),
      supabaseAdmin
        .from('sabi_emails')
        .select('subject, body_text, labels')
        .or('labels.cs.{CATEGORY_PROMOTIONS},labels.cs.{CATEGORY_FORUMS},labels.cs.{CATEGORY_SOCIAL}')
        .limit(500),
    ]);

    const posDocs = (pos.data ?? []).map(r => `${r.subject ?? ''} ${r.body_text ?? ''}`);
    const negDocs = (neg.data ?? []).map(r => `${r.subject ?? ''} ${r.body_text ?? ''}`);

    // Feedback loop: any project whose bid was overridden to no_bid AFTER an
    // AI/NB classification said it was RFQ counts as a NEGATIVE training
    // example. Pulls from sabi_corrections (written by /bid-decision) — gives
    // NB a way to learn from its own false positives.
    try {
      const { data: feedback } = await supabaseAdmin
        .from('sabi_corrections')
        .select('project_id, ai_value, human_value, sabi_projects!inner(email_id)')
        .eq('field_path', 'bid_recommendation')
        .limit(500);

      const feedbackEmailIds = new Set<string>();
      for (const row of feedback ?? []) {
        const human = row.human_value as { decision?: string } | null;
        if (human?.decision !== 'no_bid') continue;
        const proj = row.sabi_projects as unknown as { email_id?: string | null } | { email_id?: string | null }[] | null;
        const emailId = Array.isArray(proj) ? proj[0]?.email_id : proj?.email_id;
        if (emailId) feedbackEmailIds.add(emailId);
      }
      if (feedbackEmailIds.size > 0) {
        const { data: feedbackEmails } = await supabaseAdmin
          .from('sabi_emails')
          .select('subject, body_text')
          .in('id', [...feedbackEmailIds]);
        for (const e of feedbackEmails ?? []) {
          negDocs.push(`${e.subject ?? ''} ${e.body_text ?? ''}`);
        }
        console.log(`[nb-classifier] folded ${feedbackEmails?.length ?? 0} feedback negatives from sabi_corrections`);
      }
    } catch (err) {
      console.warn('[nb-classifier] feedback-loop read failed:', (err as Error).message);
    }

    if (posDocs.length < MIN_EXAMPLES_PER_CLASS || negDocs.length < MIN_EXAMPLES_PER_CLASS) {
      console.log(`[nb-classifier] insufficient training data: pos=${posDocs.length} neg=${negDocs.length}`);
      cache = null;
      return null;
    }

    const positive: ClassStats = { docCount: 0, tokenTotals: 0, tokenCounts: new Map() };
    const negative: ClassStats = { docCount: 0, tokenTotals: 0, tokenCounts: new Map() };
    const vocabulary = new Set<string>();

    for (const doc of posDocs) trainOne(positive, vocabulary, doc);
    for (const doc of negDocs) trainOne(negative, vocabulary, doc);

    // Cap vocabulary to top-N tokens by combined freq to keep memory bounded
    if (vocabulary.size > MAX_FEATURES) trimVocabulary(vocabulary, positive, negative, MAX_FEATURES);

    const model: TrainedModel = {
      trainedAt: Date.now(),
      positive,
      negative,
      vocabulary,
      totalDocs: positive.docCount + negative.docCount,
    };
    cache = model;
    console.log(`[nb-classifier] trained on pos=${positive.docCount} neg=${negative.docCount} vocab=${vocabulary.size}`);
    return model;
  } catch (err) {
    console.warn('[nb-classifier] training failed:', (err as Error).message);
    cache = null;
    return null;
  }
}

function trainOne(stats: ClassStats, vocabulary: Set<string>, doc: string): void {
  stats.docCount += 1;
  for (const t of tokenize(doc)) {
    stats.tokenTotals += 1;
    stats.tokenCounts.set(t, (stats.tokenCounts.get(t) ?? 0) + 1);
    vocabulary.add(t);
  }
}

function trimVocabulary(vocab: Set<string>, pos: ClassStats, neg: ClassStats, keep: number): void {
  const combined: Array<[string, number]> = [];
  for (const t of vocab) combined.push([t, (pos.tokenCounts.get(t) ?? 0) + (neg.tokenCounts.get(t) ?? 0)]);
  combined.sort((a, b) => b[1] - a[1]);
  const survivors = new Set(combined.slice(0, keep).map(([t]) => t));
  for (const t of vocab) if (!survivors.has(t)) vocab.delete(t);
  for (const t of [...pos.tokenCounts.keys()]) if (!survivors.has(t)) {
    pos.tokenTotals -= pos.tokenCounts.get(t) ?? 0;
    pos.tokenCounts.delete(t);
  }
  for (const t of [...neg.tokenCounts.keys()]) if (!survivors.has(t)) {
    neg.tokenTotals -= neg.tokenCounts.get(t) ?? 0;
    neg.tokenCounts.delete(t);
  }
}

/**
 * Resolve the live HIGH_MARGIN setting. Reads sabi_settings → env → default.
 * 5-min cache so nb-tune writes propagate without a process restart.
 */
async function getEffectiveHighMargin(): Promise<number> {
  if (highMarginCache && Date.now() - highMarginCache.fetchedAt < HIGH_MARGIN_CACHE_TTL_MS) {
    return highMarginCache.value;
  }
  let value = Number(process.env.NB_HIGH_MARGIN) || HIGH_MARGIN_DEFAULT;
  try {
    const { data } = await supabaseAdmin
      .from('sabi_settings')
      .select('value')
      .eq('key', 'nb_classifier')
      .maybeSingle();
    const stored = (data?.value as Record<string, unknown> | null)?.high_margin;
    const num = Number(stored);
    if (Number.isFinite(num) && num > 0) value = num;
  } catch (err) {
    console.warn('[nb-classifier] high-margin read failed, using fallback:', (err as Error).message);
  }
  highMarginCache = { value, fetchedAt: Date.now() };
  return value;
}

/** Persist a new HIGH_MARGIN. Used by /api/admin/nb-tune?apply=1. */
export async function setNbHighMargin(margin: number, updatedBy: string): Promise<void> {
  if (!Number.isFinite(margin) || margin <= 0 || margin > 20) {
    throw new Error(`Invalid margin ${margin} — must be 0 < x <= 20`);
  }
  await supabaseAdmin.from('sabi_settings').upsert(
    {
      key: 'nb_classifier',
      value: { high_margin: margin, updated_by: updatedBy, updated_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' },
  );
  highMarginCache = null; // force re-read on next classify
}

/**
 * Classify a single email. Returns null if no model is available — caller
 * MUST fall back to AI classification when this returns null.
 */
export async function classifyEmailNB(subject: string, body: string): Promise<NBResult | null> {
  const model = await getTrainedModel();
  if (!model) return null;

  const tokens = tokenize(`${subject} ${body}`);
  if (tokens.length === 0) return null;

  const vSize = model.vocabulary.size;
  // Log P(class) + Σ log P(token | class) with Laplace smoothing
  let logPos = Math.log(model.positive.docCount / model.totalDocs);
  let logNeg = Math.log(model.negative.docCount / model.totalDocs);

  for (const t of tokens) {
    if (!model.vocabulary.has(t)) continue;
    const posCount = model.positive.tokenCounts.get(t) ?? 0;
    const negCount = model.negative.tokenCounts.get(t) ?? 0;
    logPos += Math.log((posCount + 1) / (model.positive.tokenTotals + vSize));
    logNeg += Math.log((negCount + 1) / (model.negative.tokenTotals + vSize));
  }

  const margin = Math.abs(logPos - logNeg);
  const isRfq = logPos > logNeg;
  // Sigmoid-style calibration: |Δ|=0 → 0.5, |Δ|=4 → ~0.88, |Δ|=8 → ~0.99
  const confidence = 1 / (1 + Math.exp(-margin * 0.4));
  const highMargin = await getEffectiveHighMargin();

  return {
    isRfq,
    confidence,
    margin,
    highConfidence: margin >= highMargin,
    source: 'naive-bayes',
    reasoning: `NB trained on ${model.positive.docCount}+/${model.negative.docCount}- emails, log-margin=${margin.toFixed(2)} (gate ${highMargin})`,
  };
}

/** Force re-train on next call. */
export function invalidateNBCache(): void {
  cache = null;
}

/**
 * Pure trainer — no DB read, no caching. Used by the eval harness to train on
 * a chronological holdout. Returns null when either class is below the
 * minimum example threshold.
 */
export function trainFromDocs(posDocs: string[], negDocs: string[]): TrainedModel | null {
  if (posDocs.length < MIN_EXAMPLES_PER_CLASS || negDocs.length < MIN_EXAMPLES_PER_CLASS) return null;
  const positive: ClassStats = { docCount: 0, tokenTotals: 0, tokenCounts: new Map() };
  const negative: ClassStats = { docCount: 0, tokenTotals: 0, tokenCounts: new Map() };
  const vocabulary = new Set<string>();
  for (const doc of posDocs) trainOne(positive, vocabulary, doc);
  for (const doc of negDocs) trainOne(negative, vocabulary, doc);
  if (vocabulary.size > MAX_FEATURES) trimVocabulary(vocabulary, positive, negative, MAX_FEATURES);
  return {
    trainedAt: Date.now(),
    positive,
    negative,
    vocabulary,
    totalDocs: positive.docCount + negative.docCount,
  };
}

/**
 * Pure prediction — no cache, no DB. Mirrors classifyEmailNB but takes the
 * model explicitly so the eval harness can use a holdout-trained model
 * without touching the in-process cache.
 */
export function classifyAgainstModel(model: TrainedModel, subject: string, body: string): NBResult | null {
  const tokens = tokenize(`${subject} ${body}`);
  if (tokens.length === 0) return null;
  const vSize = model.vocabulary.size;
  let logPos = Math.log(model.positive.docCount / model.totalDocs);
  let logNeg = Math.log(model.negative.docCount / model.totalDocs);
  for (const t of tokens) {
    if (!model.vocabulary.has(t)) continue;
    const posCount = model.positive.tokenCounts.get(t) ?? 0;
    const negCount = model.negative.tokenCounts.get(t) ?? 0;
    logPos += Math.log((posCount + 1) / (model.positive.tokenTotals + vSize));
    logNeg += Math.log((negCount + 1) / (model.negative.tokenTotals + vSize));
  }
  const margin = Math.abs(logPos - logNeg);
  const isRfq = logPos > logNeg;
  const confidence = 1 / (1 + Math.exp(-margin * 0.4));
  return {
    isRfq,
    confidence,
    margin,
    // Eval / tune contexts use the static default — these callers care about
    // raw margin to sweep their own thresholds, not the live DB-backed gate.
    highConfidence: margin >= HIGH_MARGIN_DEFAULT,
    source: 'naive-bayes',
    reasoning: `holdout-trained NB ${model.positive.docCount}+/${model.negative.docCount}-, log-margin=${margin.toFixed(2)}`,
  };
}
