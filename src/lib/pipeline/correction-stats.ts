/**
 * Correction-stats — generic mining helpers over `sabi_corrections`.
 *
 * Rate corrections (numeric ai/human values) live in rate-adjuster.ts. This
 * module handles the OTHER kind: rejection signals where `human_value` is a
 * `{rejected: true, reason}` object — gate-12 rejections (cable schedule),
 * gate-14 rejections (final total), bid_recommendation no-bids, etc.
 *
 * Output is a per-cohort rejection rate that future code can use to:
 *   • lower the displayed AI confidence on a fresh project that matches a
 *     high-rejection cohort
 *   • surface a "this AI output is historically unreliable here, escalate to
 *     George early" hint in the UI
 *   • feed a future model that learns when to fire the AI vs ask a human
 *
 * No multipliers are auto-applied. This is signal only — applying it requires
 * product decisions about what to show users when AI is historically wrong.
 *
 * 1-h in-process cache. Same TTL as rate-adjuster.
 */
import { supabaseAdmin } from '@/lib/storage/supabase';

const STATS_TTL_MS = 60 * 60 * 1000;
const MIN_SAMPLES = 5;

export interface CohortRejectionStats {
  fieldPath: string;
  buildingType: string;
  serviceType: string | null;
  samples: number;        // total corrections in this cohort
  rejections: number;     // those whose human_value is a rejection-shaped object
  rejectionRate: number;  // rejections / samples
  lastUpdated: string;
  /** Top reasons by count, capped at 5. */
  topReasons: Array<{ reason: string; count: number }>;
}

interface StatsCache {
  fetchedAt: number;
  byKey: Map<string, CohortRejectionStats>;
}

let cache: StatsCache | null = null;

function key(fieldPath: string, buildingType: string, serviceType: string | null): string {
  return `${fieldPath}::${buildingType}::${serviceType ?? '*'}`;
}

interface RawCorrection {
  field_path: string | null;
  human_value: unknown;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
}

async function refresh(): Promise<StatsCache> {
  const buckets = new Map<string, { samples: number; rejections: number; reasons: Map<string, number>; latest: string }>();

  try {
    const { data } = await supabaseAdmin
      .from('sabi_corrections')
      .select('field_path, human_value, metadata, created_at')
      .order('created_at', { ascending: false })
      .limit(2000);

    for (const raw of (data ?? []) as RawCorrection[]) {
      const path = raw.field_path ?? '';
      if (!path) continue;
      const md = (raw.metadata ?? {}) as Record<string, unknown>;
      const buildingType = (md.building_type as string | null) ?? 'unknown';
      const serviceType = (md.service_type as string | null) ?? null;
      const k = key(path, buildingType, serviceType);

      const human = raw.human_value as { rejected?: boolean; decision?: string; reason?: string | null } | null;
      const isRejection = !!(human && (human.rejected === true || human.decision === 'no_bid'));
      const reason = (human?.reason ?? null) || null;

      const bucket = buckets.get(k) ?? { samples: 0, rejections: 0, reasons: new Map<string, number>(), latest: '' };
      bucket.samples += 1;
      if (isRejection) bucket.rejections += 1;
      if (reason) bucket.reasons.set(reason, (bucket.reasons.get(reason) ?? 0) + 1);
      if ((raw.created_at ?? '') > bucket.latest) bucket.latest = raw.created_at ?? '';
      buckets.set(k, bucket);
    }
  } catch (err) {
    console.warn('[correction-stats] read failed:', (err as Error).message);
  }

  const finalised = new Map<string, CohortRejectionStats>();
  for (const [k, b] of buckets) {
    if (b.samples < MIN_SAMPLES) continue;
    const [fieldPath, buildingType, serviceTypeRaw] = k.split('::');
    const topReasons = [...b.reasons.entries()]
      .sort((a, b2) => b2[1] - a[1])
      .slice(0, 5)
      .map(([reason, count]) => ({ reason, count }));
    finalised.set(k, {
      fieldPath,
      buildingType,
      serviceType: serviceTypeRaw === '*' ? null : serviceTypeRaw,
      samples: b.samples,
      rejections: b.rejections,
      rejectionRate: b.samples > 0 ? b.rejections / b.samples : 0,
      lastUpdated: b.latest,
      topReasons,
    });
  }

  cache = { fetchedAt: Date.now(), byKey: finalised };
  return cache;
}

export async function getRejectionStats(input: {
  fieldPath: string;
  buildingType?: string | null;
  serviceType?: string | null;
}): Promise<CohortRejectionStats | null> {
  if (!cache || Date.now() - cache.fetchedAt > STATS_TTL_MS) await refresh();
  const k = key(input.fieldPath, input.buildingType ?? 'unknown', input.serviceType ?? null);
  return cache?.byKey.get(k) ?? null;
}

export async function getAllRejectionStats(filterFieldPath?: string): Promise<CohortRejectionStats[]> {
  if (!cache || Date.now() - cache.fetchedAt > STATS_TTL_MS) await refresh();
  const all = [...(cache?.byKey.values() ?? [])];
  return filterFieldPath ? all.filter(s => s.fieldPath === filterFieldPath) : all;
}

export function invalidateCorrectionStatsCache(): void {
  cache = null;
}
