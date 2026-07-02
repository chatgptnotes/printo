/**
 * Brand-dictionary auto-harvest from project history.
 *
 * Every project that's run through `analyzeSpecifications` accumulates
 * `approved_makes` in `sabi_services.ai_extraction.spec_analysis`. Over time
 * this becomes a richer brand list than the static curated dictionary. This
 * module unions the static list with the harvested one and caches the
 * combined set in-process for 1 hour.
 *
 * No new AI calls. No new tables. Pure read.
 */

import { supabaseAdmin } from '@/lib/storage/supabase';
import { BRAND_DICTIONARY, type BrandEntry } from '@/lib/ai/brand-dictionary';

const HARVEST_TTL_MS = 60 * 60 * 1000;

interface HarvestCache {
  fetchedAt: number;
  brands: BrandEntry[];
  // Union of lowercased brand-name strings we already have, for dedup
  existingNames: Set<string>;
}

let cache: HarvestCache | null = null;

/**
 * Returns the static dictionary unioned with brands harvested from past
 * `sabi_services.ai_extraction.spec_analysis.approved_makes`. Falls back to
 * the static dictionary if the DB read fails for any reason.
 */
export async function getEffectiveBrandDictionary(): Promise<BrandEntry[]> {
  if (cache && Date.now() - cache.fetchedAt < HARVEST_TTL_MS) {
    return cache.brands;
  }

  const existing = new Set<string>();
  for (const b of BRAND_DICTIONARY) {
    existing.add(b.name.toLowerCase());
    for (const a of b.aliases ?? []) existing.add(a.toLowerCase());
  }

  let harvested: BrandEntry[] = [];
  try {
    // Pull only the slice we need; the JSON is selected from a single column.
    const { data } = await supabaseAdmin
      .from('sabi_services')
      .select('service_type, ai_extraction')
      .not('ai_extraction', 'is', null)
      .limit(2000);

    const counter = new Map<string, { service: string; count: number }>();

    for (const row of data || []) {
      const ext = row.ai_extraction as Record<string, unknown> | null;
      const spec = (ext?.spec_analysis as Record<string, unknown> | undefined) ?? null;
      const list = (spec?.approved_makes as unknown[] | undefined) ?? [];
      for (const raw of list) {
        if (typeof raw !== 'string') continue;
        const name = raw.trim();
        if (name.length < 2 || name.length > 60) continue;
        if (existing.has(name.toLowerCase())) continue;
        const key = name.toLowerCase();
        const prior = counter.get(key);
        if (prior) {
          prior.count += 1;
        } else {
          counter.set(key, { service: row.service_type ?? 'general', count: 1 });
        }
      }
    }

    // Only accept harvested brands seen in ≥2 distinct projects to avoid
    // typo / OCR-garbage inclusion.
    for (const [key, meta] of counter.entries()) {
      if (meta.count < 2) continue;
      harvested.push({
        name: prettifyName(key),
        service: normaliseService(meta.service),
        category: 'harvested',
      });
      existing.add(key);
    }
  } catch (err) {
    console.warn('[brand-harvest] read failed, using static dictionary only:', (err as Error).message);
    harvested = [];
  }

  const combined = [...BRAND_DICTIONARY, ...harvested];
  cache = { fetchedAt: Date.now(), brands: combined, existingNames: existing };
  if (harvested.length > 0) {
    console.log(`[brand-harvest] static=${BRAND_DICTIONARY.length} harvested=${harvested.length} total=${combined.length}`);
  }
  return combined;
}

function prettifyName(lower: string): string {
  return lower
    .split(/\s+/)
    .map(w => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(' ');
}

function normaliseService(s: string): BrandEntry['service'] {
  const lower = s.toLowerCase();
  if (lower === 'electrical') return 'electrical';
  if (lower === 'hvac') return 'hvac';
  if (lower === 'plumbing') return 'plumbing';
  if (lower === 'fire_fighting') return 'fire_fighting';
  if (lower === 'fire_alarm') return 'fire_alarm';
  if (lower === 'bms') return 'bms';
  return 'general';
}

/** Force the next call to re-fetch (e.g. after a manual brand-table seed). */
export function invalidateBrandHarvestCache(): void {
  cache = null;
}
