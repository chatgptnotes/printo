// Pure synthesis: ElectricalProcedureResult → 2D SVG building-elevation model.
// No React/DOM — unit-testable. See ./types.ts for the data contract.
import type { ElectricalProcedureResult } from '@/lib/ai/ai-provider';
import { bucketFor } from './cost';
import type { ExtractionSummary, SvgCable, SvgFloor, SvgPanel, SvgPlanModel } from './types';

// ── Layout constants (px, SVG space) ──────────────────────────────────────
const HEADER_H = 16;
const FOOTER_H = 16;
const FLOOR_H = 128;
const GUTTER_W = 104;           // left floor-label gutter
const RISER_X = GUTTER_W + 44;  // vertical feeder lane centre
const SMDB_X = RISER_X + 40;    // first panel column (right of the lane)
const PW = 96;                  // panel box width
const PH = 40;                  // panel box height
const GAP = 42;                 // horizontal gap between panels on a floor
const MIN_W = 920;

// ── Floor ranking ────────────────────────────────────────────────────────
function floorRank(label: string): number {
  const s = (label || '').toUpperCase().replace(/\./g, '').trim();
  if (!s) return 500;
  if (/PENTHOUSE|UPPER\s*ROOF/.test(s)) return 950;     // above the main roof
  if (/POOL\s*DECK|\bDECK\b/.test(s)) return 920;       // deck level, below penthouse
  if (/ROOF|^RF\b|RF$/.test(s)) return 900;
  if (/BASEMENT|UNDERGROUND|^B\d|^B-?\d|^LG\b|LOWER\s*GROUND|\bUG\b/.test(s)) {
    const m = s.match(/(\d+)/);
    if (m) return -parseInt(m[1], 10);
    // No level number: keep underground distinct from (just below) basement so the
    // two never collide on the same rank — that collapse blanked a floor row before.
    return /UNDERGROUND|\bUG\b/.test(s) ? -1.5 : -1;
  }
  if (/MEZZ|^MZ\b/.test(s)) return 0.5;
  if (/GROUND|^GF\b|^G\b|^G\/?F\b/.test(s)) return 0;
  if (/PODIUM|^P\d/.test(s)) {
    const m = s.match(/(\d+)/);
    return 0.3 + (m ? parseInt(m[1], 10) : 1) * 0.01;
  }
  const num = s.match(/(\d+)\s*F\b/) || s.match(/^(\d+)/);
  if (num) return parseInt(num[1], 10);
  const words: Record<string, number> = { FIRST: 1, SECOND: 2, THIRD: 3, FOURTH: 4, FIFTH: 5, SIXTH: 6, SEVENTH: 7, EIGHTH: 8, NINTH: 9, TENTH: 10 };
  for (const [w, n] of Object.entries(words)) if (s.includes(w)) return n;
  return 500;
}

function normTag(tag: string): string {
  // Strip a trailing floor-qualifier parenthetical ("DB-T01 (odd floors)") from the
  // MATCH KEY only (panel.tag keeps it for display). Bids scanned before the
  // scan-time strip (derive-cable-paths.ts) stored "DB-T01 (odd floors)" ≠
  // "DB-T01 (even floors)" as distinct tags, so the plain "DB-T01" cable prefix-
  // matched the odd box first → every DB-T cable piled onto odd floors and even
  // floors drew no wire/chip. Collapsing both to "DB-T01" lets find(to, sourceFloor)
  // disambiguate by floor instead. Non-floor parentheticals ("(1500 kVA)") survive.
  const cleaned = (tag || '').replace(
    /\s*\([^)]*\b(?:odd|even|all|each|typical|floors?)\b[^)]*\)\s*$/i,
    '',
  );
  return cleaned.toUpperCase().replace(/[\s.]/g, '');
}

// Normalize a floor label for equality comparison (mirrors floorRank's cleanup).
function normFloor(s: string | null | undefined): string {
  return (s || '').toUpperCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
}

// Split a multi-floor board label ("1F/3F/5F/7F") into its individual floors so a
// typical board renders one box per floor. Single-floor labels pass through
// unchanged (returned as-is, including null, so `place` keeps its default row).
function splitFloors(floor: string | null | undefined): Array<string | null | undefined> {
  const parts = String(floor ?? '').split('/').map((s) => s.trim()).filter(Boolean);
  return parts.length > 1 ? parts : [floor];
}

interface RankedFloor extends SvgFloor { rank: number; }

function buildFloors(elec: ElectricalProcedureResult | null, fallbackFloors: number | null | undefined): RankedFloor[] {
  let labels = (elec?.floor_labels || []).filter((l) => (l || '').trim().length > 0);
  // When the analyzer leaves floor_labels empty, recover the floor set from the
  // panel inventory (mdb/smdb/db .floor) — split multi-floor tags like "1F/3F/5F".
  if (labels.length === 0 && elec) {
    const set = new Set<string>();
    const add = (f: string | null | undefined) => {
      if (!f) return;
      for (const part of String(f).split('/')) { const t = part.trim(); if (t) set.add(t); }
    };
    add(elec.mdb_info?.floor);
    for (const s of elec.smdb_inventory || []) add(s.floor);
    for (const d of elec.db_inventory || []) add(d.floor);
    labels = [...set];
  }
  if (labels.length === 0) {
    const n = Math.max(1, Math.min(40, elec?.floors_identified || fallbackFloors || 3));
    labels = ['Ground', ...Array.from({ length: n - 1 }, (_, i) => `${i + 1}F`)];
  }
  const ranked = labels
    .map((label, ord) => ({ label, rank: floorRank(label), ord }))
    .sort((a, b) => a.rank - b.rank || a.ord - b.ord);
  const maxIndex = ranked.length - 1;
  return ranked.map((r, index) => ({
    index,
    label: r.label,
    rank: r.rank,
    yTop: HEADER_H + (maxIndex - index) * FLOOR_H,
    height: FLOOR_H,
  }));
}

function floorIndexFor(floors: RankedFloor[], label: string | null | undefined): number {
  if (!label) return 0;
  // A board's floor string comes from the same scan as floor_labels, so an exact
  // (normalized) match is authoritative — and immune to rank ties (e.g. Basement vs
  // Underground both ranking -1, which previously dumped every board on one row).
  const n = normFloor(label);
  if (n) {
    const exact = floors.find((f) => normFloor(f.label) === n);
    if (exact) return exact.index;
  }
  // Fallback for labels that aren't a row (e.g. multi-floor "1F/3F/5F"): nearest rank.
  const r = floorRank(label);
  let best = 0;
  let bestDelta = Infinity;
  for (const f of floors) {
    const delta = Math.abs(f.rank - r);
    if (delta < bestDelta) { bestDelta = delta; best = f.index; }
  }
  return best;
}

// ── Panel placement (left→right within each floor band) ───────────────────
function buildPanels(elec: ElectricalProcedureResult | null, floors: RankedFloor[]): SvgPanel[] {
  if (!elec) return [];
  const panels: SvgPanel[] = [];
  const slot: Record<number, number> = {};

  const place = (tag: string, kind: SvgPanel['kind'], floorLabel: string | null | undefined, rating: number | null): void => {
    const fi = floorIndexFor(floors, floorLabel);
    const f = floors[fi];
    const s = slot[fi] = (slot[fi] || 0);
    slot[fi] = s + 1;
    panels.push({
      tag,
      kind,
      floorIndex: fi,
      x: SMDB_X + s * (PW + GAP),
      y: f.yTop + (f.height - PH) / 2,
      w: PW,
      h: PH,
      rating_a: rating,
    });
  };

  // Place EVERY LV panel (LVP-01, LVP-02, …) as a main-panel box on the LV-room
  // floor — a building can have several, and feeders from a second LV panel had
  // no box to connect to (their wires went undrawn). Fall back to mdb_info when
  // lv_panels is empty or doesn't include the main tag.
  const mdb = elec.mdb_info;
  const mdbFloor = mdb?.floor ?? null;
  const placedMdb = new Set<string>();
  for (const lv of elec.lv_panels || []) {
    if (!lv.tag) continue;
    place(lv.tag, 'mdb', mdbFloor, lv.main_acb_rating_a ?? null);
    placedMdb.add(normTag(lv.tag));
  }
  if (mdb && (mdb.tag || mdb.floor) && !(mdb.tag && placedMdb.has(normTag(mdb.tag)))) {
    place(mdb.tag || 'MDB', 'mdb', mdb.floor, mdb.rating_a ?? null);
  }
  for (const s of elec.smdb_inventory || []) {
    for (const fl of splitFloors(s.floor)) place(s.id, 'smdb', fl, s.rating_a ?? null);
  }
  // A typical-floor DB carries a MULTI-floor label ("1F/3F/5F/7F"); place a box on
  // EACH listed floor so the apartment DBs spread across 1F–8F instead of all
  // piling onto the first floor (which left 3F–8F blank — big vertical gaps).
  for (const d of elec.db_inventory || []) {
    for (const fl of splitFloors(d.floor)) place(d.db_id, 'db', fl, d.rating_a ?? null);
  }

  return panels;
}

// ── Cable routing → orthogonal SVG paths ──────────────────────────────────
function buildCables(elec: ElectricalProcedureResult | null, panels: SvgPanel[]): { cables: SvgCable[]; unresolved: number; lengthByFloor: Record<number, number> } {
  if (!elec) return { cables: [], unresolved: 0, lengthByFloor: {} };

  // Typical-floor boards share a tag (e.g. DB-T01 exists on 7 floors), so a tag
  // can map to MANY panels. Keep them all and disambiguate by floor: resolve a
  // cable's destination to the box on the same floor as its source — otherwise
  // every same-tag cable collapses onto one box and the rest go unwired.
  const byTag = new Map<string, SvgPanel[]>();
  for (const p of panels) {
    const k = normTag(p.tag);
    (byTag.get(k) ?? byTag.set(k, []).get(k)!).push(p);
  }
  const pick = (list: SvgPanel[], preferFloor?: number): SvgPanel => {
    if (preferFloor == null || list.length === 1) return list[0];
    return list.find((p) => p.floorIndex === preferFloor)
      ?? [...list].sort((a, b) => Math.abs(a.floorIndex - preferFloor) - Math.abs(b.floorIndex - preferFloor))[0];
  };
  const find = (tag: string, preferFloor?: number): SvgPanel | null => {
    const k = normTag(tag);
    if (byTag.has(k)) return pick(byTag.get(k)!, preferFloor);
    for (const [key, list] of byTag) if (key.startsWith(k) || k.startsWith(key)) return pick(list, preferFloor);
    // Compound endpoints like "ATS/LVP-02" — try each slash-separated part.
    if (tag.includes('/')) {
      for (const part of tag.split('/')) {
        const p = find(part, preferFloor);
        if (p) return p;
      }
    }
    return null;
  };

  // Draw the panel-to-panel feeders (LVP→SMDB and SMDB→DB) — these are the
  // runs that actually connect the boxes, each with size_mm2 + length_m. Fall
  // back to cable_schedule for legacy scans that stored runs there. (The new
  // scan's cable_schedule is the main-distribution list — transformer→LV-panel
  // feeders whose endpoints match no box, so it can't drive the diagram.)
  const feeders = [...(elec.lv_to_smdb_cables ?? []), ...(elec.smdb_to_db_cables ?? [])];
  const source: Array<{ from: string; to: string; size_mm2: number | null; length_m: number | null }> =
    feeders.length > 0 ? feeders : (elec.cable_schedule ?? []);

  let unresolved = 0;
  const lengthByFloor: Record<number, number> = {};
  const wiredPanels = new Set<SvgPanel>();
  const cables: SvgCable[] = source.map((row) => {
    const size = typeof row.size_mm2 === 'number' && row.size_mm2 > 0 ? row.size_mm2 : 0;
    const lengthM = typeof row.length_m === 'number' && row.length_m > 0 ? row.length_m : 0;
    const bucket = bucketFor(size);
    const a = find(row.from);
    const b = find(row.to, a?.floorIndex);

    if (!a || !b) {
      unresolved += 1;
      return { from: row.from, to: row.to, sizeMm2: size, lengthM, bucket, path: '', labelX: 0, labelY: 0, segLabelX: 0, segLabelY: 0, resolved: false };
    }

    // Attribute the run's length to the floor it terminates on (per-floor total).
    lengthByFloor[b.floorIndex] = (lengthByFloor[b.floorIndex] || 0) + lengthM;
    wiredPanels.add(b);

    const aCy = a.y + a.h / 2;
    const bCy = b.y + b.h / 2;
    const aR = a.x + a.w;
    const bL = b.x;
    let path: string;

    if (a.floorIndex === b.floorIndex) {
      // same floor → horizontal run, right edge of A to left edge of B
      const midX = (aR + bL) / 2;
      path = Math.abs(aCy - bCy) < 0.5
        ? `M ${aR} ${aCy} H ${bL}`
        : `M ${aR} ${aCy} H ${midX} V ${bCy} H ${bL}`;
    } else {
      // vertical feeder → A centre into the riser lane, up/down, then into B
      const aCx = a.x + a.w / 2;
      path = `M ${aCx} ${aCy} H ${RISER_X} V ${bCy} H ${bL}`;
    }
    // Spec label sits just ABOVE THE DESTINATION box — one label per box, so
    // they spread out with the boxes instead of all piling into the riser lane
    // (a dense take-off has 100+ vertical feeders that previously stacked at the
    // same X). The band gap above each box is clear of the box above it.
    const labelX = b.x + b.w / 2;
    const labelY = b.y - 8;
    // "On wire" anchor: centred in the gap to the LEFT of the box, just above the
    // wire centreline — so the run length reads along the row instead of above it.
    const segLabelX = b.x - GAP / 2;
    const segLabelY = bCy - 10;
    return { from: row.from, to: row.to, sizeMm2: size, lengthM, bucket, path, labelX, labelY, segLabelX, segLabelY, resolved: true };
  });

  // Connect any DB box that received NO feeder to its parent SMDB on the same
  // floor — tenant/internal boards (e.g. retail DB-SHOP fed "by tenant") have no
  // cable in the schedule, so without this they render as floating boxes with no
  // wire. Pair by trailing number (DB-SHOP01 ↔ SMDB-SH01), else any SMDB on that
  // floor. These carry no spec (size/length 0), so PlanSvg draws no length chip.
  const smdbPanels = panels.filter((p) => p.kind === 'smdb');
  const trailingNum = (t: string): string | null => { const m = t.match(/(\d+)\s*$/); return m ? m[1] : null; };
  for (const d of panels) {
    if (d.kind !== 'db' || wiredPanels.has(d)) continue;
    const dn = trailingNum(d.tag);
    const parent =
      (dn ? smdbPanels.find((s) => s.floorIndex === d.floorIndex && trailingNum(s.tag) === dn) : undefined)
      ?? smdbPanels.find((s) => s.floorIndex === d.floorIndex);
    if (!parent) continue;
    const aCy = parent.y + parent.h / 2;
    const bCy = d.y + d.h / 2;
    const aR = parent.x + parent.w;
    const bL = d.x;
    const midX = (aR + bL) / 2;
    const path = Math.abs(aCy - bCy) < 0.5
      ? `M ${aR} ${aCy} H ${bL}`
      : `M ${aR} ${aCy} H ${midX} V ${bCy} H ${bL}`;
    cables.push({ from: parent.tag, to: d.tag, sizeMm2: 0, lengthM: 0, bucket: bucketFor(0), path, labelX: d.x + d.w / 2, labelY: d.y - 8, segLabelX: d.x - GAP / 2, segLabelY: bCy - 10, resolved: true });
  }

  return { cables, unresolved, lengthByFloor };
}

// Power outlets are read per floor from the floor plans (same as lighting). Place
// each outlet row's qty on its matched floor so the diagram's per-floor counts
// agree with the Excel BOQ (Bill 7) and the Data tab; only outlets with no floor
// tag are spread across above-ground floors as a fallback.
function buildOutlets(elec: ElectricalProcedureResult | null, floors: RankedFloor[]): Record<number, number> {
  const out: Record<number, number> = {};
  if (!elec) return out;
  const outlets = elec.power_outlets || [];
  const floored = outlets.filter((o) => (o.floor || '').trim().length > 0);
  for (const o of floored) {
    const fi = floorIndexFor(floors, o.floor);
    out[fi] = (out[fi] || 0) + (o.estimated_qty || 0);
  }
  const unfloored = outlets
    .filter((o) => !(o.floor || '').trim())
    .reduce((s, o) => s + (o.estimated_qty || 0), 0);
  if (unfloored > 0) {
    const targets = floors.filter((f) => f.rank >= 0);
    const pool = targets.length > 0 ? targets : floors;
    const per = Math.max(1, Math.round(unfloored / pool.length));
    for (const f of pool) out[f.index] = (out[f.index] || 0) + per;
  }
  return out;
}

// Lighting fixtures are read per floor from the drawing legend. Place each fixture's
// qty on its matched floor; fixtures with no floor tag are spread across above-ground
// floors the same way outlets are, so the badges stay informative either way.
function buildLighting(elec: ElectricalProcedureResult | null, floors: RankedFloor[]): Record<number, number> {
  const out: Record<number, number> = {};
  if (!elec) return out;
  const fixtures = elec.lighting_fixtures || [];
  const floored = fixtures.filter((f) => (f.floor || '').trim().length > 0);
  for (const fx of floored) {
    const fi = floorIndexFor(floors, fx.floor);
    out[fi] = (out[fi] || 0) + (fx.qty || 0);
  }
  const unfloored = fixtures.filter((f) => !(f.floor || '').trim()).reduce((s, f) => s + (f.qty || 0), 0);
  if (unfloored > 0) {
    const targets = floors.filter((f) => f.rank >= 0);
    const pool = targets.length > 0 ? targets : floors;
    const per = Math.max(1, Math.round(unfloored / pool.length));
    for (const f of pool) out[f.index] = (out[f.index] || 0) + per;
  }
  return out;
}

export function buildPlanModel(
  inputElec: ElectricalProcedureResult | null,
  project?: { floors?: number | null; total_area_sqft?: number | null; building_name?: string | null },
): SvgPlanModel {
  // Callers pass the `ai_extraction` wrapper, which mirrors cable_schedule etc.
  // at the top level but OMITS lv_to_smdb_cables / smdb_to_db_cables — those
  // live only under `raw_electrical_procedure`. Unwrap to the full result so
  // the cable feeders are reachable. No-op when handed the bare result.
  const elec = ((inputElec as { raw_electrical_procedure?: ElectricalProcedureResult } | null)
    ?.raw_electrical_procedure ?? inputElec) as ElectricalProcedureResult | null;
  const floors = buildFloors(elec, project?.floors);
  const panels = buildPanels(elec, floors);
  const { cables, unresolved, lengthByFloor } = buildCables(elec, panels);
  const outletsByFloor = buildOutlets(elec, floors);
  const lightingByFloor = buildLighting(elec, floors);

  const maxSlots = panels.reduce((m, _p, _i, arr) => {
    const perFloor = arr.filter((q) => q.floorIndex === arr[_i].floorIndex).length;
    return Math.max(m, perFloor);
  }, 1);
  const width = Math.max(MIN_W, SMDB_X + maxSlots * (PW + GAP) + 40);
  const height = HEADER_H + floors.length * FLOOR_H + FOOTER_H;

  const smdbCount = panels.filter((p) => p.kind === 'smdb').length;
  const dbCount = panels.filter((p) => p.kind === 'db').length;
  const outletsTotal = (elec?.power_outlets || []).reduce((s, o) => s + (o.estimated_qty || 0), 0);
  const totalCableLengthM = cables.reduce((s, c) => s + c.lengthM, 0);
  const fixtures = elec?.lighting_fixtures || [];
  const lightingTotal = fixtures.reduce((s, f) => s + (f.qty || 0), 0);
  const lightingTypes = new Set(
    fixtures.map((f) => (f.type_ref || f.description || '').trim().toUpperCase()).filter(Boolean),
  ).size;

  const summary: ExtractionSummary = {
    buildingName: project?.building_name || elec?.mdb_info?.tag || 'Building',
    drawingScale: elec?.drawing_scale ?? null,
    scaleDetected: elec?.scale_detected ?? false,
    floorsIdentified: elec?.floors_identified ?? floors.length,
    mdbTag: elec?.mdb_info?.tag ?? null,
    mdbRatingA: elec?.mdb_info?.rating_a ?? null,
    smdbCount,
    dbCount,
    outletsTotal,
    lightingTotal,
    lightingTypes,
    totalCableLengthM,
    typicalFloorHeightM: typeof elec?.typical_floor_height_m === 'number' ? elec.typical_floor_height_m : null,
    confidence: typeof elec?.confidence === 'number' ? elec.confidence : null,
  };

  return {
    width,
    height,
    floors: floors.map(({ index, label, yTop, height: h }) => ({ index, label, yTop, height: h })),
    panels,
    cables,
    outletsByFloor,
    lightingByFloor,
    cableLengthByFloor: lengthByFloor,
    summary,
    unresolvedCount: unresolved,
    isDemo: false,
  };
}
