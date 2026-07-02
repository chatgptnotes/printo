// @ts-nocheck — ported from scripts/lib/*.mjs; logic identical, types enforced at API consumer.
import { billColumns } from './bill-columns';
// Data provenance — distinguishes line items MEASURED from project drawings
// (via the AI extraction in `electrical.cable_schedule` / `lv_panels` /
// `smdb_inventory` / `db_groups` / `incoming_supply`) from line items that are
// industry ALLOWANCE / template values (preliminaries, T&C, lighting fixtures,
// containment defaults, ELV containment, etc.).
//
// Marks each priceable row with one of two glyph prefixes in column 8
// (Origin / Brand), preserving the AVL hint after the marker:
//   📐  — MEASURED  — value pulled from the project's drawing-derived data
//   📋  — ALLOWANCE — industry-standard template value, NOT from drawings
//
// Pure ESM. Mirrors the post-process pattern of dubai-2026-rates.mjs etc.

const M  = '📐';   // measured
const A  = '📋';   // allowance

// ─── Provenance rules per Bill / sub-bill ─────────────────────────────────
// Items whose data IS extracted from the drawings (the AI procedure populates
// these from `cable_schedule`, `lv_panels`, `smdb_inventory`, `db_groups`,
// `incoming_supply`).
const MEASURED_PATTERNS = [
  /^2\.2\./,    // Bill 2.2 — LV panels (LVP-01/02 specs from lv_panels)
  /^2\.3\./,    // Bill 2.3 — Generator + ATS (from incoming_supply)
  /^3\./,       // Bill 3   — SMDBs (entire inventory from smdb_inventory)
  /^4\./,       // Bill 4   — DBs (from db_groups / db_inventory)
  /^5\.1\./,    // Bill 5.1 — XLPE LV→SMDB (from cable_schedule, LV-source filter)
  /^5\.2\./,    // Bill 5.2 — FR LV→SMDB
  /^5\.3\./,    // Bill 5.3 — XLPE SMDB→DB
  /^5\.4\./,    // Bill 5.4 — FR SMDB→DB
];

// Items whose data is industry allowance / template (no drawing-derived
// quantities). Includes fees, prelims, fixture defaults, etc.
const ALLOWANCE_PATTERNS = [
  /^1\./,       // Bill 1   — Preliminaries (mob, insurance, submittals, fees)
  /^2\.1\./,    // Bill 2.1 — HV scope (sized from MD but specs are template)
  /^5\.5\./,    // Bill 5.5 — LSZH escape-route bulk (template)
  /^5\.6\./,    // Bill 5.6 — final-circuit bulk (template)
  /^5\.7\./,    // Bill 5.7 — ECC allowance (derived)
  /^6\./,       // Bill 6   — Containment (fixture defaults)
  /^7\./,       // Bill 7   — Wiring devices (template counts)
  /^8\./,       // Bill 8   — Lighting fixtures (template)
  /^9\./,       // Bill 9   — Earthing & LP (fixture defaults)
  /^10\./,      // Bill 10  — Emergency + CBS + FA integration (template)
  /^11\./,      // Bill 11  — ELV containment (template, specialist)
  /^12\./,      // Bill 12  — Metering (template counts; provisional sums)
  /^13\./,      // Bill 13  — T&C (template)
];

/**
 * Returns 'M' (measured) or 'A' (allowance) for a priceable row.
 * Defaults to 'A' when the item ref doesn't match either pattern set.
 * @param {{ item: string }} row
 */
export function classifyProvenance({ item }, opts = {}) {
  const it = String(item || '');
  // Lighting (Bill 8) is measured ONLY when fixtures were read from the drawing
  // legend; the hardcoded fallback list stays an allowance.
  if (opts.measuredLighting && /^8\./.test(it)) return 'M';
  if (MEASURED_PATTERNS.some(re => re.test(it)))  return 'M';
  if (ALLOWANCE_PATTERNS.some(re => re.test(it))) return 'A';
  return 'A';
}

/**
 * Walks priceable rows and prefixes column 8 (Origin / Brand) with the
 * provenance glyph, preserving any existing AVL hint after the glyph.
 * Returns counts for diagnostic logging.
 */
export function applyProvenanceToWorkbook(wb, opts = {}) {
  let measured = 0, allowance = 0;
  wb.eachSheet(ws => {
    const col = billColumns(ws);
    for (let r = 1; r <= ws.rowCount; r++) {
      const item = ws.getRow(r).getCell(col.item).value;
      if (typeof item !== 'string') continue;
      if (!/^\d+\.\d+\.\d+|^[A-Z]\d+\.\d+/.test(item)) continue;
      const tag = classifyProvenance({ item }, opts);
      const glyph = tag === 'M' ? M : A;
      const existing = String(ws.getRow(r).getCell(col.origin).value || '').trim();
      // Strip any existing glyph to avoid double-prefixing on re-runs.
      const cleaned = existing.replace(/^[📐📋]\s*/u, '');
      ws.getRow(r).getCell(col.origin).value = `${glyph}  ${cleaned}`.trim();
      if (tag === 'M') measured++; else allowance++;
    }
  });
  return { measured, allowance };
}

// ─── Cover-sheet block — data provenance summary ─────────────────────────
// Returns a structured array of [bill, label, source] tuples for rendering
// on the Cover sheet so reviewers see at-a-glance which sections are
// drawing-derived vs allowance.
export function provenanceMatrix(opts = {}) {
  const lighting = opts.measuredLighting
    ? ['Bill 8', 'Lighting fixtures', M, 'From drawing legend — fixture type tags counted per floor']
    : ['Bill 8', 'Lighting fixtures', A, 'Industry template — no fixture legend read from drawings'];
  return [
    ['Bill 1',    'Preliminaries + Authority Fees',         A,  'Industry allowance (mob, insurance, submittals, DEWA/RTA/DM/DCD fees)'],
    ['Bill 2.1',  'HV side (transformer / RMU / room civil)', A,  `Industry template — transformer kVA sized from MD only`],
    ['Bill 2.2',  'LV panels (LVP-01, LVP-02)',              M,  'From P-200 SLD — ACB ratings, MCCB schedules, capacitor banks'],
    ['Bill 2.3',  'Generator + ATS',                          M,  'From P-200 SLD — kVA + ATS rating'],
    ['Bill 3',    'Sub-Main Distribution Boards (26)',        M,  'From P-201 SLD — every SMDB tag, rating, floor, connected load'],
    ['Bill 4',    'Distribution Boards (107)',                M,  'From P-103…P-108 floor plans + P-201 SLD — DB groups, counts'],
    ['Bill 5.1',  'XLPE LV→SMDB risers',                      M,  'From cable_schedule — every run, size, length per AI extraction'],
    ['Bill 5.2',  'Fire-Rated LV→SMDB',                       M,  'From cable_schedule — with engineering corrections applied'],
    ['Bill 5.3',  'XLPE SMDB→DB distribution',                M,  'From smdb_to_db_cables / cable_schedule (non-LV-source filter)'],
    ['Bill 5.4',  'FR SMDB→DB distribution',                  M,  'From smdb_to_db_cables / cable_schedule'],
    ['Bill 5.5',  'LSZH escape-route final circuits',         A,  'Industry allowance — quantities by floor count × typical loop'],
    ['Bill 5.6',  'Final-circuit bulk wiring',                A,  'Industry allowance — by sqft / DB count'],
    ['Bill 5.7',  'ECC alongside risers',                     A,  'Allowance — derived as % of main-cable total length'],
    ['Bill 6',    'Cable containment',                        A,  'Industry allowance — tray / ladder / conduit lengths by sqft'],
    ['Bill 7',    'Wiring devices & accessories',             A,  'Industry template — sockets / switches / outlets per typical floor count'],
    lighting,
    ['Bill 9',    'Earthing & Lightning Protection',          A,  'Industry allowance — TN-S system + LP per IEC 62305'],
    ['Bill 10.1', 'Self-contained emergency luminaires',      A,  'Industry allowance — by floor count + escape route length'],
    ['Bill 10.2', 'Life-safety power feeders',                A,  'Industry allowance — fire pump / smoke / pressurisation'],
    ['Bill 10.3', 'Central Battery System (CBS)',             A,  'Industry option — provisional sum, sized to total emergency luminaire load'],
    ['Bill 10.4', 'Fire Alarm / MEP integration',             A,  'DCD requirement — shunt-trips, lift recall, dampers (specialist coord)'],
    ['Bill 11',   'ELV containment',                          A,  'Industry allowance — specialist trades (FA / BMS / CCTV / ACS / MATV)'],
    ['Bill 12',   'Smart metering',                           A,  'DEWA Smart Grid programme — meter counts per tenant + landlord schedule'],
    ['Bill 13',   'Testing, Commissioning & Authority',       A,  'Industry allowance — IR / continuity / ELI / RCD + DEWA + DM + DCD'],
  ];
}

export { M as MEASURED_GLYPH, A as ALLOWANCE_GLYPH };
