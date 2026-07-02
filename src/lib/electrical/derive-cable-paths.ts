/**
 * When the AI (or a fixture) returns a complete cable_schedule but leaves
 * lv_to_smdb_cables / smdb_to_db_cables empty — or aggregates DB-T01..T15
 * into single rows — the bid detail page renders blank Steps 9-10 / 13 and
 * an undercount Step 11-12. Splitting the cable_schedule by from/to prefix
 * and expanding range-rows fills those without re-querying the AI.
 *
 * Only fills empty arrays / aggregated rows — AI output that already itemizes
 * is left alone.
 */
import type { ElectricalProcedureResult } from '@/lib/ai/ai-provider';
import { sortElectricalResult, canonTag, canonFloorKey } from './canonicalize';

type CableRow = ElectricalProcedureResult['cable_schedule'][number];
type LvCable = ElectricalProcedureResult['lv_to_smdb_cables'][number];
type SmdbDbCable = ElectricalProcedureResult['smdb_to_db_cables'][number];
type DbInv = ElectricalProcedureResult['db_inventory'][number];

const LV_PREFIX = /^LVP[-\s]/i;
const SMDB_PREFIX = /^E?SMDB[-\s]/i;
const DB_PREFIX = /^E?DB[-\s]/i;

function routeFor(to: string): string | null {
  const t = to.toUpperCase();
  if (/SMDB-?[1-9](?:F|$)|SMDB-?[1-9][0-9]F/.test(t)) return 'main riser shaft';
  if (/SMDB-?RF|ESMDB-?RF/.test(t)) return 'main riser to roof';
  if (/SMDB-?G|ESMDB-?G/.test(t)) return 'ground floor cable tray';
  if (/SMDB-?EV/.test(t)) return 'basement cable tray';
  if (/SMDB-?SH/.test(t)) return 'ground floor cable tray (retail loop)';
  if (/SMDB-?TF/.test(t)) return 'main riser shaft (typical floors)';
  return null;
}

/**
 * Read the floor a cable run belongs to from its endpoint tags. Already-itemised
 * rows (LVP-01 → SMDB-1F, SMDB-1F → DB-1F-01) encode the floor in the tag but
 * never carry it in the `floor` field, so the take-off table / Excel bill show a
 * blank floor. Prefer the destination (`to`) — for LV→SMDB and SMDB→DB the
 * downstream board is the one whose floor we want — and fall back to `from`.
 * Uses the same tag conventions as routeFor(). Returns null when no floor can be
 * read (generic typical-floor stacks, unrelated tags) so the UI keeps showing "—"
 * instead of guessing.
 */
export function floorForCable(from: string, to: string): string | null {
  const read = (tag: string): string | null => {
    const t = (tag || '').toUpperCase();
    const numF = t.match(/-?(\d+)\s*F\b/); // SMDB-1F, DB-1F-01
    if (numF) return `${parseInt(numF[1], 10)}F`;
    if (/-?RF\b|ROOF/.test(t)) return 'Roof';
    if (/-?SH\d/.test(t)) return 'Ground'; // retail loop sits on the ground floor
    if (/-?EV\b|BASEMENT|-?B\d/.test(t)) return 'Basement';
    if (/-?GF?\b|GROUND/.test(t)) return 'Ground';
    return null;
  };
  return read(to) ?? read(from);
}

function confidenceFor(scaleDetected: boolean, isFireRated: boolean): LvCable['confidence'] {
  if (scaleDetected) return 'high';
  if (isFireRated) return 'medium';
  return 'medium';
}

export function deriveLvToSmdbCables(
  cableSchedule: CableRow[],
  scaleDetected: boolean,
): LvCable[] {
  return cableSchedule
    .filter((c) => LV_PREFIX.test(c.from) && SMDB_PREFIX.test(c.to))
    .map((c) => ({
      from: c.from,
      to: c.to,
      size_mm2: c.size_mm2,
      length_m: c.length_m,
      route_via: routeFor(c.to),
      confidence: confidenceFor(scaleDetected, c.type === 'fire_rated'),
      // Carry the cable spec through so the BOQ size column reflects the real
      // cable (e.g. CU/PVC single-core wires vs XLPE/SWA), not a generic default.
      circuit_description: c.circuit_description ?? null,
      type: c.type ?? null,
    }));
}

export function deriveSmdbToDbCables(
  cableSchedule: CableRow[],
  scaleDetected: boolean,
): SmdbDbCable[] {
  return cableSchedule
    .filter((c) => SMDB_PREFIX.test(c.from) && DB_PREFIX.test(c.to))
    .map((c) => ({
      from: c.from,
      to: c.to,
      size_mm2: c.size_mm2,
      length_m: c.length_m,
      confidence: scaleDetected ? 'medium' : 'low',
      // Carry the cable spec through so the BOQ size column reflects the real
      // cable (e.g. CU/PVC single-core wires vs XLPE/SWA), not a generic default.
      circuit_description: c.circuit_description ?? null,
      type: c.type ?? null,
    }));
}

const RANGE_RE = /^(.*?-?[A-Z]+)0*(\d+)\s*(?:to|–|—|-)\s*(?:[A-Z-]+)?0*(\d+)(.*)$/i;

/**
 * Expand "DB-T01 to DB-T15" / "DB-SHOP01 to DB-SHOP12" aggregated rows into
 * one entry per individual board. Pads numbers to two digits to match
 * project-standard tags. Untouched rows pass through unchanged.
 */
export function expandAggregatedDbInventory(dbInventory: DbInv[]): DbInv[] {
  const out: DbInv[] = [];
  for (const row of dbInventory) {
    const m = row.db_id.match(RANGE_RE);
    if (!m) {
      out.push(row);
      continue;
    }
    const [, prefix, startStr, endStr, suffix] = m;
    const start = parseInt(startStr, 10);
    const end = parseInt(endStr, 10);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 50) {
      out.push(row);
      continue;
    }
    const cleanSuffix = suffix.replace(/^\s*\(([^)]+)\)\s*$/, ' ($1)').trimEnd();
    // A floor-qualifier suffix ("(odd floors)") must NOT stay on the tag: it makes
    // "DB-T01 (odd floors)" ≠ "DB-T01 (even floors)" so the plain "DB-T01" cable
    // matches both and resolves onto the wrong floor (odd boxes get every chip,
    // even boxes get none). The floor distinction already lives in `floor`; keep
    // the tag clean. Non-floor suffixes (e.g. a location note) are preserved.
    const isFloorQualifier = /\b(?:odd|even|all|each|typical)\b|\bfloors?\b/i.test(cleanSuffix);
    const tagSuffix = isFloorQualifier ? '' : cleanSuffix;
    const floorFromSuffix = isFloorQualifier ? cleanSuffix.replace(/[()]/g, '').trim() : '';
    for (let n = start; n <= end; n++) {
      const padded = String(n).padStart(startStr.length, '0');
      out.push({
        ...row,
        db_id: `${prefix}${padded}${tagSuffix}`.trim(),
        // Preserve the qualifier in `floor` only if the row didn't already carry one.
        floor: row.floor || floorFromSuffix || row.floor,
      });
    }
  }
  return out;
}

// ── Floor-qualifier expansion (SMDB → DB cables) ──────────────────────────
// The AI is told to enumerate one row per (floor, DB), but non-deterministically
// still emits "SMDB-TF-odd → DB-T01 to DB-T15 odd floors @ 25 m" — 1 row for what
// is 15 DBs × 4 odd floors = 60 runs. These regexes recover the floor set and DB
// range so the Excel cable bill carries the real take-off quantity.
const FLOOR_ODD = /\bodd\s+floors?\b/i;
const FLOOR_EVEN = /\beven\s+floors?\b/i;
const FLOOR_TYPICAL = /\b(?:all\s+)?typical\s+floors?\b/i;
const FLOOR_RANGE = /\b(\d+)\s*F\s*(?:to|–|—|-)\s*(\d+)\s*F\b/i;
const TF_REF = /^E?SMDB-?TF/i;

const ORDINAL_WORDS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8,
  ninth: 9, tenth: 10, eleventh: 11, twelfth: 12,
};

/**
 * Canonical typical-floor labels ("1F".."8F") for this project. Floor labels can
 * be numeric ("1F"), word-form ("First Floor"), or absent — so fall back to the
 * per-floor SMDB tags (SMDB-1F…8F), which are the most reliable signal.
 */
export function deriveTypicalFloors(result: ElectricalProcedureResult): string[] {
  const nums = new Set<number>();
  for (const s of result.smdb_inventory || []) {
    const m = (s.id || '').match(/SMDB-?(\d+)F\b/i);
    if (m) nums.add(parseInt(m[1], 10));
  }
  if (nums.size) return [...nums].sort((a, b) => a - b).map(n => `${n}F`);

  const numeric = (result.floor_labels || [])
    .map(l => (l || '').trim().replace(/\s+/g, ''))
    .filter(l => /^\d+F$/i.test(l));
  if (numeric.length) return numeric;

  const words: string[] = [];
  for (const l of result.floor_labels || []) {
    const m = (l || '').toLowerCase().match(/^(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)\s+floor$/);
    if (m) words.push(`${ORDINAL_WORDS[m[1]]}F`);
  }
  return words;
}

/** Resolve the set of floors a qualifier ("odd floors", "1F–8F", "typical") covers. */
function floorsForQualifier(text: string, typicalFloors: string[]): string[] | null {
  const floorNo = (l: string) => parseInt(l, 10);
  const rangeM = text.match(FLOOR_RANGE);
  if (rangeM) {
    const lo = parseInt(rangeM[1], 10), hi = parseInt(rangeM[2], 10);
    if (Number.isFinite(lo) && Number.isFinite(hi) && hi >= lo && hi - lo <= 60) {
      const within = typicalFloors.filter(l => floorNo(l) >= lo && floorNo(l) <= hi);
      return within.length ? within : Array.from({ length: hi - lo + 1 }, (_, i) => `${lo + i}F`);
    }
  }
  if (FLOOR_ODD.test(text)) return typicalFloors.filter(l => floorNo(l) % 2 === 1);
  if (FLOOR_EVEN.test(text)) return typicalFloors.filter(l => floorNo(l) % 2 === 0);
  if (FLOOR_TYPICAL.test(text)) return typicalFloors;
  return null;
}

/** Substitute a generic typical-floor SMDB tag with the concrete per-floor one. */
function smdbForFloor(from: string, floor: string): string {
  if (TF_REF.test(from)) return `${/^E/i.test(from) ? 'E' : ''}SMDB-${floor}`;
  return from;
}

/** Normalise a floor label to canonical "NF" ("3", "3 F", "3F" → "3F"); other
 *  labels (Ground/Roof/word-form) pass through trimmed. */
function normFloorLabel(f: string | null | undefined): string {
  const s = (f ?? '').toString().trim();
  const m = s.match(/(\d+)\s*F\b/i) || s.match(/^(\d+)$/);
  return m ? `${parseInt(m[1], 10)}F` : s;
}

/** Rewrite the floor token inside a tag to a target floor ("SMDB-7F" → "SMDB-3F",
 *  "DB-7F-01" → "DB-3F-01"). Floor-agnostic tags ("DB-T01") have no numeric-floor
 *  token and pass through unchanged — the caller still sets the `floor` field. */
function retagFloor(tag: string, floor: string): string {
  const target = floor.replace(/\s+/g, '');
  return (tag ?? '').replace(/(-?)(\d+)\s*F\b/i, (_m, dash) => `${dash}${target}`);
}

/** DB tags from a `to` string after the floor qualifier is stripped. */
function dbTagsFromTo(to: string): string[] {
  const base = to
    .replace(FLOOR_ODD, '').replace(FLOOR_EVEN, '').replace(FLOOR_TYPICAL, '').replace(FLOOR_RANGE, '')
    .replace(/[(),]/g, ' ').replace(/\s+/g, ' ').trim();
  const m = base.match(RANGE_RE);
  if (m) {
    const [, prefix, startStr, endStr] = m;
    const start = parseInt(startStr, 10), end = parseInt(endStr, 10);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start && end - start <= 50) {
      return Array.from({ length: end - start + 1 }, (_, i) =>
        `${prefix}${String(start + i).padStart(startStr.length, '0')}`.trim());
    }
  }
  return [base];
}

/**
 * Expand SMDB → DB cable rows that aggregate by floor and/or DB range into one
 * row per (floor, DB). Rows with neither a floor qualifier nor a tag range pass
 * through untouched. Generic over cable_schedule and smdb_to_db_cables rows.
 */
export function expandAggregatedCables<T extends { from: string; to: string; floor?: string | null }>(
  cables: T[],
  typicalFloors: string[],
): T[] {
  const out: T[] = [];
  for (const row of cables) {
    const qualText = `${row.to} ${row.from}`;
    const floors = floorsForQualifier(qualText, typicalFloors);
    const tags = dbTagsFromTo(row.to);
    const hasRange = tags.length > 1 || tags[0] !== row.to.trim();
    if (!floors && !hasRange) { out.push(row); continue; }
    const floorSet = floors && floors.length ? floors : [row.floor ?? null];
    if (floorSet.length * tags.length > 2000) { out.push(row); continue; } // runaway guard (tall-tower bound)
    for (const fl of floorSet) {
      for (const tag of tags) {
        out.push({ ...row, from: fl ? smdbForFloor(row.from, fl) : row.from, to: tag, floor: fl ?? row.floor ?? null });
      }
    }
  }
  return out;
}

/**
 * Drop the generic typical-floor SMDB stack (SMDB-TF / -odd / -even) when the
 * inventory ALSO enumerates the same floors as per-floor boards (SMDB-1F…8F),
 * and strip its cable rows — otherwise the typical floors are counted twice.
 */
export function dedupeTypicalSmdb(result: ElectricalProcedureResult): ElectricalProcedureResult {
  const inv = result.smdb_inventory || [];
  const perFloor = inv.filter(s => /^E?SMDB-?\d+F$/i.test((s.id || '').trim()));
  const stacks = inv.filter(s => TF_REF.test((s.id || '').trim()));
  if (perFloor.length < 2 || !stacks.length) return result;

  result.smdb_inventory = inv.filter(s => !TF_REF.test((s.id || '').trim()));
  result.lv_to_smdb_cables = (result.lv_to_smdb_cables || []).filter(c => !TF_REF.test(c.to || ''));
  result.smdb_to_db_cables = (result.smdb_to_db_cables || []).filter(c => !TF_REF.test(c.from || ''));
  result.cable_schedule = (result.cable_schedule || []).filter(c => !TF_REF.test(c.from || '') && !TF_REF.test(c.to || ''));
  return result;
}

/** Canonical, FLOOR-AGNOSTIC key for a DB feeder/inventory row — strips the
 *  numeric-floor token from the DB tag so DB-7F-01 and DB-3F-01 share a key (the
 *  same DB replicated per floor), while a floor-agnostic tag (DB-T01, repeated on
 *  every floor via the `floor` field) keys to itself. Used to compare a floor's DB
 *  set against the template floor's so partial floors are topped up, not doubled. */
function dbKey(tag: string | null | undefined): string {
  return canonTag(String(tag ?? '').replace(/(-?)(\d+)\s*F\b/i, ''));
}

const TYPICAL_FILL_CAP = 2000; // tall-tower bound (mirror expandAggregatedCables)

// George's rule: only use the typical-floor multiply shortcut for tall buildings
// (more than 7 typical floors). Shorter buildings are read floor-by-floor, so we
// never auto-replicate a template across them — that keeps small-building take-offs
// faithful to what the scan actually read.
const TYPICAL_MULTIPLY_MIN_FLOORS = 7;

/**
 * B3 fallback — invoked when NO typical floor carries any SMDB → DB feeder, so
 * there is no template floor to multiply. Rebuild the expected per-floor DB
 * *inventory* from the db_groups[] rollup (tag_pattern × the typical floors) so
 * Bill 4's DB count is right even though per-DB cable lengths can't be derived.
 * Only range-expandable tag patterns ("DB-T01 to DB-T15") are materialised — a
 * pattern we can't enumerate is left to the warning. Never invents cable
 * sizes/lengths. Returns the inventory rows to add (may be empty).
 */
function synthesizeDbsFromGroups(result: ElectricalProcedureResult, T: string[]): DbInv[] {
  const groups = result.db_groups || [];
  if (!groups.length) return [];
  const dbs = result.db_inventory || [];
  const existing = new Set(dbs.map((d) => `${normFloorLabel(d.floor)}|${canonTag(d.db_id)}`));
  const add: DbInv[] = [];
  for (const g of groups) {
    const tags = dbTagsFromTo(g.tag_pattern || '');
    if (tags.length <= 1) continue; // not enumerable — leave to the warning
    if (T.length * tags.length > TYPICAL_FILL_CAP) continue; // runaway guard
    for (const f of T) {
      for (const tag of tags) {
        const dbId = retagFloor(tag, f);
        const key = `${normFloorLabel(f)}|${canonTag(dbId)}`;
        if (existing.has(key)) continue;
        existing.add(key);
        add.push({ smdb_id: '', db_id: dbId, floor: f, rating_a: null, cable_size: null });
      }
    }
  }
  return add;
}

/**
 * Multiply the fully-read TYPICAL floor's SMDB → DB feeders (and its DBs) across
 * every identical floor. Buildings repeat the typical floor (e.g. 7F-22F
 * identical), but the AI often reads it ONCE — so the take-off under-counts the
 * floor power lines by the typical-floor multiple. This fills the gap
 * deterministically: pick the enumerated typical floor with the most distinct DBs
 * as the template, then top up every other typical floor with the template DBs it
 * is MISSING.
 *
 * Partial floors are handled (B1): a floor read with 8 of 15 DBs gets the other 7
 * added, not skipped. Comparison is by floor-agnostic DB key (dbKey) so a DB the
 * AI already read on that floor is never doubled. Floor-encoded tags (SMDB-7F,
 * DB-7F-01) are re-tagged to the target floor; floor-agnostic tags (DB-T01 each
 * floor) keep their tag and carry the per-floor `floor` field. Replicas are marked
 * low-confidence with a "(typical-floor replica)" note so they read as estimated.
 *
 * B3: if no typical floor carries any feeder (no template), rebuild the per-floor
 * DB inventory from db_groups[] when present and attach `typical_floor_warning`
 * instead of silently producing a low total.
 */
export function expandTypicalFloorFeeders(result: ElectricalProcedureResult): ElectricalProcedureResult {
  const T = deriveTypicalFloors(result); // canonical ["1F","2F",…]
  if (T.length <= 1) return result;
  // George's rule: only multiply for tall buildings (> 7 typical floors). Below that,
  // each floor is read individually and we leave the take-off as the scan produced it.
  if (T.length <= TYPICAL_MULTIPLY_MIN_FLOORS) return result;

  const cables = result.smdb_to_db_cables || [];
  const dbs = result.db_inventory || [];
  const inT = new Set(T);

  // Group existing feeders by floor (restricted to the typical-floor set) and
  // record which DBs (by floor-agnostic key) each floor already carries.
  const cableFloor = (c: SmdbDbCable) => normFloorLabel(c.floor ?? floorForCable(c.from, c.to) ?? '');
  const byFloor = new Map<string, SmdbDbCable[]>();
  const haveByFloor = new Map<string, Set<string>>();
  for (const c of cables) {
    const f = cableFloor(c);
    if (!inT.has(f)) continue;
    (byFloor.get(f) ?? byFloor.set(f, []).get(f)!).push(c);
    (haveByFloor.get(f) ?? haveByFloor.set(f, new Set<string>()).get(f)!).add(dbKey(c.to));
  }

  // Template = enumerated typical floor with the MOST distinct DBs (the fully-read one).
  let t0 = '';
  let best = 0;
  for (const [f, list] of byFloor) {
    const distinct = new Set(list.map((c) => dbKey(c.to))).size;
    if (distinct > best) { best = distinct; t0 = f; }
  }

  // B3 — no usable template floor: rebuild DB inventory from db_groups[] when
  // present, and flag it. Never silently leave the cable take-off under-counted.
  if (!t0) {
    const synthesized = synthesizeDbsFromGroups(result, T);
    const warning = synthesized.length
      ? `Typical-floor multiplication could not run — no fully-read template floor. Rebuilt ${synthesized.length} DBs across ${T.length} typical floors from the db_groups rollup; per-DB cable lengths are NOT derived — verify SMDB→DB cable take-off.`
      : `Typical-floor multiplication could not run — no fully-read template floor and no db_groups rollup to rebuild from. The SMDB→DB cable take-off for the ${T.length} typical floors is under-counted; re-scan one typical floor in full.`;
    return {
      ...result,
      db_inventory: synthesized.length ? [...dbs, ...synthesized] : dbs,
      typical_floor_warning: warning,
    };
  }

  const templateCables = byFloor.get(t0)!;
  // One representative feeder per distinct DB on the template floor (dedupe the
  // template itself so a doubly-read DB doesn't double every floor).
  const templateByDb = new Map<string, SmdbDbCable>();
  for (const c of templateCables) {
    const k = dbKey(c.to);
    if (!templateByDb.has(k)) templateByDb.set(k, c);
  }
  const templateDbsByKey = new Map<string, DbInv>();
  for (const d of dbs) {
    if (normFloorLabel(d.floor) !== t0) continue;
    const k = dbKey(d.db_id);
    if (!templateDbsByKey.has(k)) templateDbsByKey.set(k, d);
  }
  if (T.length * templateByDb.size > TYPICAL_FILL_CAP) return result; // runaway guard

  const addCables: SmdbDbCable[] = [];
  const addDbs: DbInv[] = [];
  for (const f of T) {
    if (f === t0) continue; // never top up the template floor itself
    const have = haveByFloor.get(f) ?? new Set<string>();
    for (const [k, c] of templateByDb) {
      if (have.has(k)) continue; // DB already read on this floor — never double-count
      addCables.push({
        ...c,
        from: retagFloor(c.from, f),
        to: retagFloor(c.to, f),
        floor: f,
        confidence: 'low',
        circuit_description: `${c.circuit_description ? `${c.circuit_description} ` : ''}(typical-floor replica)`,
      });
      const td = templateDbsByKey.get(k);
      if (td) addDbs.push({ ...td, smdb_id: retagFloor(td.smdb_id, f), db_id: retagFloor(td.db_id, f), floor: f });
    }
  }
  if (addCables.length === 0 && addDbs.length === 0) return result; // every typical floor already complete

  return { ...result, smdb_to_db_cables: [...cables, ...addCables], db_inventory: [...dbs, ...addDbs] };
}

/** LV→SMDB feeder-length formula parts, named so the UI can show the SAME numbers
 *  the take-off computes (no drift between the explanation and the result). */
export const LV_LEAD_IN_M = 4;  // MDB/LV-room → riser entry
export const LV_LOOP_M = 0.5;   // terminal loop allowance

/** Riser floor index for the LV→SMDB length formula: how many floor heights the
 *  feeder climbs from the LV room. Ground/Mezz = 0, NF = N, Basement-n = n,
 *  Podium-n = n, Roof/Penthouse = highest typical floor + 1. Returns null when the
 *  floor can't be resolved, so the caller flags the row instead of guessing. */
export function riserFloorIndex(floorLabel: string | null | undefined, typicalFloors: string[]): number | null {
  const k = canonFloorKey(floorLabel);
  if (!k) return 0; // unknown endpoint → treat as the ground-level lead-in only
  if (k === 'ground' || k === 'mezzanine') return 0;
  if (k.startsWith('basement')) return parseInt(k.slice(8), 10) || 1;
  if (k.startsWith('podium')) return parseInt(k.slice(6), 10) || 1;
  if (k.startsWith('f')) return parseInt(k.slice(1), 10) || 0;
  if (k === 'roof' || k === 'penthouse') {
    const tops = (typicalFloors || []).map((f) => parseInt(f, 10)).filter((n) => Number.isFinite(n));
    return tops.length ? Math.max(...tops) + 1 : null;
  }
  return null;
}

/**
 * B4 — enforce the LV→SMDB feeder-length formula in code instead of trusting the
 * prompt. For each lv_to_smdb_cables row whose length is missing or low-confidence
 * AND the drawing scale was NOT detected, compute
 *   length ≈ 4 m lead-in + (riser floor index × typical_floor_height_m) + 0.5 m loop
 * from the SMDB's floor. Confident/scaled reads are never overwritten. When
 * typical_floor_height_m is unknown (or the floor can't be resolved) the row is
 * left as-is but marked provisional so a guessed length is never mistaken for read.
 */
export function backfillLvToSmdbLengths(result: ElectricalProcedureResult): ElectricalProcedureResult {
  if (result.scale_detected) return result; // a scaled scan's lengths are trusted
  const rows = result.lv_to_smdb_cables || [];
  if (rows.length === 0) return result;
  const h = Number(result.typical_floor_height_m);
  const hasHeight = Number.isFinite(h) && h > 0;
  const T = deriveTypicalFloors(result);

  const out = rows.map((c) => {
    const len = Number(c.length_m);
    const needs = !Number.isFinite(len) || len <= 0 || c.confidence === 'low';
    if (!needs) return c; // confident, real length — leave it
    if (!hasHeight) return { ...c, provisional: true };
    const idx = riserFloorIndex(floorForCable(c.from, c.to), T);
    if (idx == null) return { ...c, provisional: true };
    return { ...c, length_m: Math.round(LV_LEAD_IN_M + idx * h + LV_LOOP_M), provisional: true };
  });
  return { ...result, lv_to_smdb_cables: out };
}

/**
 * Explain WHERE a cable run's length came from, for the Plan "Data" tab. Driven by
 * the same inputs the take-off uses (scale_detected, typical_floor_height_m, the
 * riser formula, the typical-floor replica marker) so the shown text can never
 * disagree with the displayed number. Returns a short, one-clause `text`.
 */
export function explainCableLength(
  c: { from: string; to: string; length_m?: number | null; circuit_description?: string | null },
  result: ElectricalProcedureResult,
): { method: 'scaled' | 'estimated' | 'typical-replica' | 'horizontal' | 'unknown'; text: string } {
  // George's rule: repeating floors above the representative floor reuse its length
  // (expandTypicalFloorFeeders tags these). Check first — a replica is never re-measured.
  if (/typical-floor replica/i.test(c.circuit_description || '')) {
    return { method: 'typical-replica', text: 'copied from typical floor' };
  }
  if (result.scale_detected) {
    return { method: 'scaled', text: 'measured from drawing scale' };
  }
  const from = (c.from || '').toUpperCase();
  const to = (c.to || '').toUpperCase();
  // Vertical LV→SMDB riser run — the floor-height formula applies.
  if ((LV_PREFIX.test(from) || /^E?MDB/i.test(from)) && SMDB_PREFIX.test(to)) {
    const h = Number(result.typical_floor_height_m);
    const idx = riserFloorIndex(floorForCable(c.from, c.to), deriveTypicalFloors(result));
    if (Number.isFinite(h) && h > 0 && idx != null) {
      const len = Math.round(LV_LEAD_IN_M + idx * h + LV_LOOP_M);
      return { method: 'estimated', text: `est. from floor height: ${LV_LEAD_IN_M} + (${idx} × ${h}) + ${LV_LOOP_M} = ${len} m` };
    }
    return { method: 'unknown', text: 'verify against drawing' };
  }
  // On-floor SMDB→DB run — no riser formula; read off the plan.
  if (SMDB_PREFIX.test(from) && DB_PREFIX.test(to)) {
    return { method: 'horizontal', text: 'on-floor run from plan' };
  }
  return { method: 'unknown', text: 'verify against drawing' };
}

export function enrichElectricalResult(result: ElectricalProcedureResult): ElectricalProcedureResult {
  // Defensive: old projects may have stored partial extractions where one or
  // more arrays are missing entirely (undefined) rather than empty []. Reading
  // .length on undefined would crash the BOQ regeneration with a misleading
  // "Excel generation failed: Cannot read properties of undefined (reading
  // 'length')" — fix at the source by normalising to [] up-front.
  const enriched: ElectricalProcedureResult = {
    ...result,
    cable_schedule: Array.isArray(result.cable_schedule) ? result.cable_schedule : [],
    lv_to_smdb_cables: Array.isArray(result.lv_to_smdb_cables) ? result.lv_to_smdb_cables : [],
    smdb_to_db_cables: Array.isArray(result.smdb_to_db_cables) ? result.smdb_to_db_cables : [],
    db_inventory: Array.isArray(result.db_inventory) ? result.db_inventory : [],
    smdb_inventory: Array.isArray(result.smdb_inventory) ? result.smdb_inventory : [],
  };

  // Expand floor/range-aggregated SMDB → DB rows into one entry per (floor, DB)
  // BEFORE deriving/deduping, so downstream sees the real per-floor take-off.
  const typicalFloors = deriveTypicalFloors(enriched);
  enriched.cable_schedule = expandAggregatedCables(enriched.cable_schedule, typicalFloors)
    .map((c) => ({ ...c, floor: c.floor ?? floorForCable(c.from, c.to) }));
  if (enriched.smdb_to_db_cables.length > 0) {
    enriched.smdb_to_db_cables = expandAggregatedCables(enriched.smdb_to_db_cables, typicalFloors)
      .map((c) => ({ ...c, floor: c.floor ?? floorForCable(c.from, c.to) }));
  }

  if (enriched.lv_to_smdb_cables.length === 0 && enriched.cable_schedule.length > 0) {
    enriched.lv_to_smdb_cables = deriveLvToSmdbCables(enriched.cable_schedule, !!enriched.scale_detected);
  }
  if (enriched.smdb_to_db_cables.length === 0 && enriched.cable_schedule.length > 0) {
    enriched.smdb_to_db_cables = deriveSmdbToDbCables(enriched.cable_schedule, !!enriched.scale_detected);
  }
  if (enriched.db_inventory.length > 0) {
    enriched.db_inventory = expandAggregatedDbInventory(enriched.db_inventory);
  }

  // Compute LV→SMDB feeder lengths from the typical floor height when the scan
  // left them blank/low-confidence and no scale was detected (B4), so the length
  // is deterministic and out of the model's hands.
  enriched.lv_to_smdb_cables = backfillLvToSmdbLengths(enriched).lv_to_smdb_cables;

  // Multiply the fully-read typical floor's DB feeders + DBs across every other
  // typical floor — topping up partial floors, never doubling DBs already read
  // (B1). Carries the no-template warning (B3) through to the validator.
  const multiplied = expandTypicalFloorFeeders(enriched);
  enriched.smdb_to_db_cables = multiplied.smdb_to_db_cables;
  enriched.db_inventory = multiplied.db_inventory;
  enriched.typical_floor_warning = multiplied.typical_floor_warning;

  // Drop a typical-floor SMDB stack that duplicates per-floor boards.
  const deduped = dedupeTypicalSmdb(enriched);

  // Final: deterministically order every section. The scan is non-deterministic
  // run-to-run, so without this the same drawing renders rows in a different order
  // each time and the BOQ "looks different". Sorting last (after all the
  // tag/floor-regex passes above have consumed the raw tags) is safe — it only
  // reorders rows, never rewrites or drops them.
  return sortElectricalResult(deduped);
}
