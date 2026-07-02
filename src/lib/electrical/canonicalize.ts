/**
 * Deterministic canonicalisation + ordering for the electrical scan result.
 *
 * Why: the gateway/Claude-CLI scan is non-deterministic run-to-run (temperature
 * is not a controllable lever on the current models). Two equivalent scans of the
 * SAME drawing come back with their rows in different orders, so the BOQ "looks
 * different every time" even when the content matches. Sorting every output array
 * by a stable canonical key makes equivalent scans render IDENTICALLY — killing the
 * apparent variance with zero AI cost.
 *
 * The canon* helpers are a faithful TS port of the reference implementation in
 * scripts/lib/ensemble-merge.mjs — KEEP IN SYNC with it (and with the worker JS
 * port in worker/server.js). They are used here as SORT KEYS only; this module
 * REORDERS rows and never drops, merges, or rewrites row data.
 */
import type { ElectricalProcedureResult } from '@/lib/ai/ai-provider';

const FLOOR_ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
  eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13,
  fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18,
  nineteenth: 19, twentieth: 20,
};

/** Faithful port of canonFloorKey() in scripts/lib/ensemble-merge.mjs — KEEP IN SYNC. */
export function canonFloorKey(raw: string | null | undefined): string {
  let t = String(raw ?? '').toLowerCase().trim();
  if (!t) return '';
  for (const w of Object.keys(FLOOR_ORDINALS)) {
    t = t.replace(new RegExp(`\\b${w}\\b`, 'g'), String(FLOOR_ORDINALS[w]));
  }
  if (/\broof\s*top\b|\bupper\s*roof\b|\broof\b|\bterrace\b/.test(t)) return 'roof';
  if (/penthouse|\bph\b/.test(t)) return 'penthouse';
  if (/mezz/.test(t)) return 'mezzanine';
  if (/sub.?basement|basement|cellar|\bb\d\b/.test(t)) { const m = t.match(/(\d+)/); return 'basement' + (m ? m[1] : '1'); }
  if (/lower\s*ground|\blg\b/.test(t)) return 'basement1';
  if (/\bground\b|\bgf\b|\bg\.?f\b|\blobby\b/.test(t) && !/upper\s*ground/.test(t)) return 'ground';
  if (/upper\s*ground|\bug\b/.test(t)) return 'ground';
  if (/podium|car\s*park|parking/.test(t)) { const m = t.match(/(\d+)/); return 'podium' + (m ? m[1] : '1'); }
  const num = t.match(/(\d{1,2})/);
  if (
    num &&
    /\b\d{1,2}\s*(?:st|nd|rd|th)?\s*(?:f|fl|flr|floor)\b|\b(?:f|fl|flr|floor|level|lvl|l)\s*\.?\s*\d{1,2}\b|^\s*\d{1,2}\s*$/.test(t)
  ) {
    return 'f' + num[1];
  }
  return 'n:' + t.replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Faithful port of canonTag() — uppercase, strip non-alphanumerics, keep digits
 *  so DB-T01 != DB-T10 != DB-T1. KEEP IN SYNC with ensemble-merge.mjs. */
export function canonTag(s: string | null | undefined): string {
  return String(s ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

const DESC_SYNONYMS: Array<[RegExp, string]> = [
  [/(\d+)\s*a(?:mp(?:ere)?s?)?\b/g, '$1a'],
  [/socket\s*outlets?\b|sockets?\b|\bsso\b/g, 'socket'],
  [/\btwin\b|\bdouble\b|\b2\s*g(?:ang)?\b/g, 'twin'],
  [/\bsingle\b|\b1\s*g(?:ang)?\b/g, 'single'],
  [/\bweather\s*proof\b|\bwp\b/g, 'wp'],
  [/\bluminaires?\b|\bfittings?\b|lighting\s*fixtures?|light\s*fixtures?|down\s*lights?\b/g, 'light'],
  [/cable\s*trays?\b|\btrays?\b/g, 'tray'],
  [/\bnos?\b|\bqty\b|\bpcs\b|\bpieces?\b|\bunits?\b/g, ''],
];
const STOPWORDS = new Set(['the', 'for', 'of', 'with', 'type', 'a', 'an', 'and', 'to']);

/** Faithful port of canonDesc() — word-order-independent canonical description.
 *  KEEP IN SYNC with ensemble-merge.mjs. */
export function canonDesc(s: string | null | undefined): string {
  let t = String(s ?? '').toLowerCase();
  for (const [re, rep] of DESC_SYNONYMS) t = t.replace(re, rep);
  t = t.replace(/[^a-z0-9]+/g, ' ').trim();
  const toks = t.split(/\s+/).filter((w) => w && !STOPWORDS.has(w));
  toks.sort();
  return toks.join(' ');
}

/** Faithful port of floorRank() — orders canonFloorKey() output basement→roof.
 *  KEEP IN SYNC with ensemble-merge.mjs. */
export function floorRank(key: string): number {
  if (key.startsWith('basement')) return -100 + (parseInt(key.slice(8), 10) || 1);
  if (key === 'ground') return 0;
  if (key === 'mezzanine') return 0.5;
  if (key.startsWith('podium')) return 1 + (parseInt(key.slice(6), 10) || 1) * 0.01;
  if (key.startsWith('f')) return parseInt(key.slice(1), 10) || 0;
  if (key === 'penthouse') return 900;
  if (key === 'roof') return 1000;
  return 800;
}

// ── Deterministic ordering ──────────────────────────────────────────────────

/** Stable, key-order-independent stringify — the final tiebreak so rows with an
 *  identical sort key still order deterministically (and equivalent rows compare
 *  equal regardless of object key insertion order). */
function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as Record<string, unknown>).sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

const floorKeyRank = (f: string | null | undefined) => floorRank(canonFloorKey(f));

/** Build a comparator from a key function. Equal keys fall back to a stable
 *  stringify of the whole row, so the order is total and reproducible. */
function by<T>(keyFn: (row: T) => string): (a: T, b: T) => number {
  return (a, b) => {
    const ka = keyFn(a);
    const kb = keyFn(b);
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    const sa = stableStringify(a);
    const sb = stableStringify(b);
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  };
}

/** Zero-padded floor rank prefix so numeric floors sort numerically inside the key string. */
function fr(f: string | null | undefined): string {
  return String(Math.round(floorKeyRank(f) * 100 + 100000)).padStart(8, '0');
}

/** Return a copy of the scan result with every array section deterministically
 *  ordered. Pure reorder — row data is untouched, nothing is dropped or merged. */
export function sortElectricalResult(result: ElectricalProcedureResult): ElectricalProcedureResult {
  const s = <T>(arr: T[] | undefined, cmp: (a: T, b: T) => number): T[] | undefined =>
    Array.isArray(arr) ? [...arr].sort(cmp) : arr;

  return {
    ...result,
    drawings_found: s(result.drawings_found, by((r) => `${canonDesc(r.filename)}`))!,
    smdb_inventory: s(result.smdb_inventory, by((r) => `${fr(r.floor)}|${canonTag(r.id)}`))!,
    lv_to_smdb_cables: s(result.lv_to_smdb_cables, by((r) => `${canonTag(r.from)}>${canonTag(r.to)}`))!,
    db_inventory: s(result.db_inventory, by((r) => `${fr(r.floor)}|${canonTag(r.smdb_id)}/${canonTag(r.db_id)}`))!,
    db_groups: s(result.db_groups, by((r) => canonDesc(r.tag_pattern))),
    smdb_to_db_cables: s(result.smdb_to_db_cables, by((r) => `${fr(r.floor)}|${canonTag(r.from)}>${canonTag(r.to)}`))!,
    cable_schedule: s(result.cable_schedule, by((r) => `${fr(r.floor)}|${canonTag(r.from)}>${canonTag(r.to)}`))!,
    bulk_cables: s(result.bulk_cables, by((r) => canonDesc(r.specification))),
    lv_panels: s(result.lv_panels, by((r) => canonTag(r.tag)))!,
    mechanical_equipment: s(result.mechanical_equipment, by((r) => canonDesc(r.description)))!,
    power_outlets: s(result.power_outlets, by((r) => `${fr(r.floor)}|${canonDesc(r.description)}`))!,
    lighting_fixtures: s(result.lighting_fixtures, by((r) => `${fr(r.floor)}|${r.type_ref ? canonTag(r.type_ref) : canonDesc(r.description)}`)),
    containment: s(result.containment, by((r) => canonDesc(r.description)))!,
    earthing: s(result.earthing, by((r) => canonDesc(r.description)))!,
    metering: s(result.metering, by((r) => canonDesc(r.description)))!,
    load_summary: s(result.load_summary, by((r) => canonDesc(r.panel)))!,
  };
}
