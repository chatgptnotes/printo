/**
 * Corrections-informed rate adjuster.
 *
 * Reads `sabi_corrections` rows where the human overrode an AI rate, computes
 * a per-cohort multiplier (median of human/ai), and exposes it so future
 * pricing can be nudged based on real override history.
 *
 * Cohort = (service_type, building_type). Multipliers are NOT applied to
 * historical rows — only to suggestions surfaced for new estimates. This way
 * the team sees "past 12 office HVAC corrections suggest 1.18x" and can choose
 * to accept, ignore, or refine before the quote goes out.
 *
 * Caching: 1-h in-process. The dataset is small (likely <1000 rows lifetime),
 * so we cache ALL cohorts in a single fetch and serve sync lookups thereafter.
 *
 * Why a separate module from corrections-logger: writes are fire-and-forget
 * (per route), reads are batched + cached. Different lifecycles.
 */
import { supabaseAdmin } from '@/lib/storage/supabase';

const ADJUSTER_TTL_MS = 60 * 60 * 1000;
const MIN_SAMPLES = 3;
// Auto-apply (no-human-review) requires a stricter bar than the suggestion
// surface — the multiplier rewrites a real rate, so we want lots of evidence
// AND tight agreement among the corrections before doing it silently.
const AUTO_APPLY_MIN_SAMPLES = 10;
const AUTO_APPLY_MAX_CV = 0.2; // coefficient of variation: stdev / mean
// Recency weighting — corrections decay with a 90-day half-life so the
// multiplier follows recent market shifts instead of averaging across
// year-old (possibly obsolete) corrections.
const RECENCY_HALF_LIFE_DAYS = 90;

export interface CohortMultiplier {
  serviceType: string;
  buildingType: string;
  multiplier: number; // median of human/ai per correction in the cohort
  samples: number;
  lastUpdated: string; // ISO of newest correction in the cohort
}

/** Internal — keep the raw ratios so we can compute CV at auto-apply time. */
interface CohortDetail extends CohortMultiplier {
  ratios: number[];
  cv: number;
}

interface AdjusterCache {
  fetchedAt: number;
  byCohort: Map<string, CohortDetail>;
}

let cache: AdjusterCache | null = null;

function cohortKey(serviceType: string, buildingType: string): string {
  return `${serviceType}::${buildingType}`;
}

async function refreshCache(): Promise<AdjusterCache> {
  const now = Date.now();
  const byCohort = new Map<string, { samples: Array<{ ratio: number; weight: number }>; latest: string }>();

  try {
    // Pull every rate-related correction. field_path 'service.<type>.unit_rate_aed'
    // is the canonical write from services PUT — match that prefix.
    const { data } = await supabaseAdmin
      .from('sabi_corrections')
      .select('field_path, ai_value, human_value, metadata, created_at')
      .like('field_path', 'service.%.unit_rate_aed')
      .order('created_at', { ascending: false })
      .limit(2000);

    for (const row of data ?? []) {
      const path = row.field_path as string;
      const m = path.match(/^service\.([a-z_]+)\.unit_rate_aed$/);
      if (!m) continue;
      const serviceType = m[1];
      const md = (row.metadata ?? {}) as Record<string, unknown>;
      const buildingType = (md.building_type as string | null) ?? 'unknown';

      const ai = Number(row.ai_value);
      const human = Number(row.human_value);
      if (!Number.isFinite(ai) || ai <= 0 || !Number.isFinite(human) || human <= 0) continue;

      const ratio = human / ai;
      // Reject obviously broken corrections (e.g. user typed "0" or 1000x)
      if (ratio < 0.2 || ratio > 5) continue;

      // Recency weight via exponential decay. created_at older than the
      // half-life still counts but at fractional weight.
      const createdMs = row.created_at ? Date.parse(row.created_at as string) : now;
      const ageDays = Math.max(0, (now - createdMs) / 86_400_000);
      const weight = Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS);

      const key = cohortKey(serviceType, buildingType);
      const bucket = byCohort.get(key);
      if (bucket) {
        bucket.samples.push({ ratio, weight });
        if ((row.created_at as string) > bucket.latest) bucket.latest = row.created_at as string;
      } else {
        byCohort.set(key, { samples: [{ ratio, weight }], latest: row.created_at as string });
      }
    }
  } catch (err) {
    console.warn('[rate-adjuster] read failed:', (err as Error).message);
  }

  const finalised = new Map<string, CohortDetail>();
  for (const [key, bucket] of byCohort) {
    if (bucket.samples.length < MIN_SAMPLES) continue;
    const [serviceType, buildingType] = key.split('::');
    const ratiosOnly = bucket.samples.map(s => s.ratio);
    const med = weightedMedian(bucket.samples);
    const cv = weightedCoefficientOfVariation(bucket.samples);
    finalised.set(key, {
      serviceType,
      buildingType,
      multiplier: med,
      samples: bucket.samples.length,
      lastUpdated: bucket.latest,
      ratios: ratiosOnly,
      cv,
    });
  }

  cache = { fetchedAt: Date.now(), byCohort: finalised };
  if (finalised.size > 0) {
    console.log(`[rate-adjuster] cached ${finalised.size} cohort multipliers from corrections`);
  }
  return cache;
}

/**
 * Weighted median — sort by ratio, walk cumulatively summing weights, return
 * the ratio at the index where cumulative weight crosses half the total.
 * For tied weights this matches the unweighted median.
 */
function weightedMedian(samples: Array<{ ratio: number; weight: number }>): number {
  const sorted = [...samples].sort((a, b) => a.ratio - b.ratio);
  const total = sorted.reduce((s, x) => s + x.weight, 0);
  if (total <= 0) return sorted[Math.floor(sorted.length / 2)].ratio;
  const half = total / 2;
  let cum = 0;
  for (const s of sorted) {
    cum += s.weight;
    if (cum >= half) return s.ratio;
  }
  return sorted[sorted.length - 1].ratio;
}

/** Weighted CV — weighted mean + weighted stdev, both using the same weights. */
function weightedCoefficientOfVariation(samples: Array<{ ratio: number; weight: number }>): number {
  if (samples.length < 2) return Infinity;
  const totalW = samples.reduce((s, x) => s + x.weight, 0);
  if (totalW <= 0) return Infinity;
  const mean = samples.reduce((s, x) => s + x.ratio * x.weight, 0) / totalW;
  if (mean <= 0) return Infinity;
  const variance = samples.reduce((s, x) => s + x.weight * (x.ratio - mean) ** 2, 0) / totalW;
  return Math.sqrt(variance) / mean;
}

/**
 * Return a multiplier for the given cohort, or null if the cohort has fewer
 * than MIN_SAMPLES corrections. Callers should treat null as "no signal —
 * ship the AI/library rate as-is".
 */
export async function getCohortMultiplier(
  serviceType: string,
  buildingType: string | null,
): Promise<CohortMultiplier | null> {
  if (!cache || Date.now() - cache.fetchedAt > ADJUSTER_TTL_MS) await refreshCache();
  const bt = buildingType ?? 'unknown';
  const detail = cache?.byCohort.get(cohortKey(serviceType, bt));
  return detail ? toPublicShape(detail) : null;
}

/** Return every learned multiplier — for admin dashboards and tests. */
export async function getAllCohortMultipliers(): Promise<CohortMultiplier[]> {
  if (!cache || Date.now() - cache.fetchedAt > ADJUSTER_TTL_MS) await refreshCache();
  return [...(cache?.byCohort.values() ?? [])].map(toPublicShape);
}

function toPublicShape(d: CohortDetail): CohortMultiplier {
  return {
    serviceType: d.serviceType,
    buildingType: d.buildingType,
    multiplier: d.multiplier,
    samples: d.samples,
    lastUpdated: d.lastUpdated,
  };
}

/** Force re-fetch on next call. */
export function invalidateAdjusterCache(): void {
  cache = null;
}

export interface AutoAdjustResult {
  baseRateAed: number;
  finalRateAed: number;
  multiplier: number;
  applied: boolean;
  reason: 'no-signal' | 'too-few-samples' | 'too-noisy' | 'auto-applied';
  samples: number;
  cv: number | null;
  lastUpdated: string | null;
}

/**
 * Decide whether the adjuster's signal is strong enough to silently apply.
 * Auto-apply requires BOTH: ≥AUTO_APPLY_MIN_SAMPLES corrections AND CV below
 * AUTO_APPLY_MAX_CV. Anything weaker just echoes the base rate so the caller
 * can ship the AI/library number unchanged.
 *
 * The `applied` boolean is the action signal; `reason` is for the audit trail
 * stored alongside the rate (so a future reviewer sees why their rate was
 * adjusted or NOT adjusted).
 */
export async function applyAutoAdjustment(input: {
  serviceType: string;
  buildingType: string | null;
  baseRateAed: number;
}): Promise<AutoAdjustResult> {
  if (!cache || Date.now() - cache.fetchedAt > ADJUSTER_TTL_MS) await refreshCache();
  const cohort = cache?.byCohort.get(cohortKey(input.serviceType, input.buildingType ?? 'unknown'));

  if (!cohort) {
    return {
      baseRateAed: input.baseRateAed,
      finalRateAed: input.baseRateAed,
      multiplier: 1,
      applied: false,
      reason: 'no-signal',
      samples: 0,
      cv: null,
      lastUpdated: null,
    };
  }

  if (cohort.samples < AUTO_APPLY_MIN_SAMPLES) {
    return {
      baseRateAed: input.baseRateAed,
      finalRateAed: input.baseRateAed,
      multiplier: cohort.multiplier,
      applied: false,
      reason: 'too-few-samples',
      samples: cohort.samples,
      cv: cohort.cv,
      lastUpdated: cohort.lastUpdated,
    };
  }
  if (cohort.cv > AUTO_APPLY_MAX_CV) {
    return {
      baseRateAed: input.baseRateAed,
      finalRateAed: input.baseRateAed,
      multiplier: cohort.multiplier,
      applied: false,
      reason: 'too-noisy',
      samples: cohort.samples,
      cv: cohort.cv,
      lastUpdated: cohort.lastUpdated,
    };
  }

  const adjusted = Math.round(input.baseRateAed * cohort.multiplier * 100) / 100;
  return {
    baseRateAed: input.baseRateAed,
    finalRateAed: adjusted,
    multiplier: cohort.multiplier,
    applied: true,
    reason: 'auto-applied',
    samples: cohort.samples,
    cv: cohort.cv,
    lastUpdated: cohort.lastUpdated,
  };
}

/**
 * Suggested rate for a single service. Pure helper — applies the cohort
 * multiplier when one exists, otherwise echoes the input rate. Returns
 * structured output so the caller can show "1.18x suggested from 12 prior
 * corrections" alongside the suggestion.
 */
export async function suggestRateAdjustment(input: {
  serviceType: string;
  buildingType: string | null;
  baseRateAed: number;
}): Promise<{
  baseRateAed: number;
  suggestedRateAed: number;
  multiplier: number;
  samples: number;
  source: 'corrections' | 'no-signal';
  lastUpdated: string | null;
}> {
  const cohort = await getCohortMultiplier(input.serviceType, input.buildingType);
  if (!cohort) {
    return {
      baseRateAed: input.baseRateAed,
      suggestedRateAed: input.baseRateAed,
      multiplier: 1,
      samples: 0,
      source: 'no-signal',
      lastUpdated: null,
    };
  }
  return {
    baseRateAed: input.baseRateAed,
    suggestedRateAed: Math.round(input.baseRateAed * cohort.multiplier * 100) / 100,
    multiplier: cohort.multiplier,
    samples: cohort.samples,
    source: 'corrections',
    lastUpdated: cohort.lastUpdated,
  };
}
