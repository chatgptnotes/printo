// Specific drawing-reference resolver for Dubai industry BOQ.
//
// Replaces generic "SLD" / "P-200" placeholders in column 3 (Reference) with
// the actual P-XXX sheet from the project's drawing register, mapped per
// item type and location. Falls back to the existing value when no confident
// match — never overwrites a more specific reference the generator already set.
//
// Pure ESM, mirrors applyRatesToWorkbook / applyAvlToWorkbook signatures.
//
// P-379 drawing register (typical Dubai consultant sheet numbering):
//   P-001  General notes / legend / symbols
//   P-010  Cable tray / containment details
//   P-100  Site plan + external services
//   P-101  Underground (UG / basement)
//   P-102  Ground floor power layout
//   P-103  1st floor power layout (typical)
//   P-104  2nd floor (typical, alternates with P-103)
//   P-105  3rd floor
//   P-106  Roof / plant / mechanical
//   P-107  Roof ancillary (pool / water tanks)
//   P-108  Upper roof / lift machine room
//   P-200  LV Single-Line Diagram (main)
//   P-201  LV SLD (sub-main / SMDB schedule)
//   P-300  LV room layout / equipment plan
//
// Floor → drawing mapping rule: 1F→P-103, 2F→P-104, …, 8F→P-110 with cap.
// (Real consultants typically issue per-floor plans; cap at the highest sheet
// number that exists. This resolver caps at P-108 since the typical issue is
// 8 stacked typical floors → P-103…P-108 alternating odd/even pattern.)

const FLOOR_PLAN = {
  G:    'P-102 (Ground)',
  '1F': 'P-103 (1F)',
  '2F': 'P-104 (2F)',
  '3F': 'P-105 (3F)',
  '4F': 'P-104 (4F)',   // even floors share even sheet number in P-379 register
  '5F': 'P-105 (5F)',
  '6F': 'P-104 (6F)',
  '7F': 'P-105 (7F)',
  '8F': 'P-104 (8F)',
  RF:   'P-106 (Roof)',
  Roof: 'P-106 (Roof)',
  UR:   'P-108 (Upper Roof)',
  UG:   'P-101 (Basement)',
  Basement: 'P-101 (Basement)',
};

function resolveFloorPlan(floor) {
  if (!floor) return null;
  return FLOOR_PLAN[floor] || FLOOR_PLAN[String(floor).trim()] || null;
}

// ─── Public resolver ──────────────────────────────────────────────────────
/**
 * @param {{ item: string, desc: string, smdbId?: string, floor?: string, currentRef?: string }} row
 * @returns {string | null}
 */
export function resolveDrawingRef(row) {
  const desc = String(row?.desc || '');
  const item = String(row?.item || '');
  const id   = String(row?.smdbId || '');

  // ── Bill 1 — Preliminaries / Authority Fees ──────────────────────────
  if (/^1\.5\./.test(item)) return 'DEWA / DM / DCD / RTA tariff';
  if (/^1\.[1-4]\./.test(item)) return null; // generic — leave as set

  // ── Bill 2 — HV / LV Main ────────────────────────────────────────────
  if (/^2\.1\./.test(item)) {
    if (/HV cable|RMU/i.test(desc)) return 'P-200 (SLD) / P-300 (LV room)';
    if (/transformer/i.test(desc))   return 'P-200 (SLD) / P-300 (LV room)';
    return 'P-200 (SLD) / P-300 (LV room)';
  }
  if (/^2\.2\./.test(item)) {
    if (/^LVP-?\d|LV switchboard/i.test(desc)) return 'P-200 (SLD) / P-300 (LV room)';
    if (/capacitor bank|kVAR/i.test(desc))     return 'P-200 (SLD) / P-300 (LV room)';
    return 'P-200 (SLD) / P-300 (LV room)';
  }
  if (/^2\.3\./.test(item)) {
    if (/Generator/i.test(desc))               return 'P-200 (SLD) / P-300 (LV room)';
    if (/ATS/i.test(desc))                     return 'P-200 (SLD) / P-300 (LV room)';
    return 'P-200 (SLD) / P-300 (LV room)';
  }

  // ── Bill 3 — SMDBs (per-location) ────────────────────────────────────
  if (/^3\./.test(item)) {
    // Try to extract floor from description: "SMDB-1F" / "ESMDB-RF" / "SMDB-G".
    let floor = null;
    const fm = desc.match(/SMDB-?([1-8]F|G|RF|EV)\b/i) || desc.match(/\b([1-8]F|RF)\b/);
    if (fm) {
      floor = fm[1].toUpperCase();
      if (floor === 'EV') floor = 'UG';
    }
    const fp = floor ? resolveFloorPlan(floor) : null;
    if (fp) return `P-201 (SLD) / ${fp}`;
    return 'P-201 (SLD)';
  }

  // ── Bill 4 — DBs ─────────────────────────────────────────────────────
  if (/^4\./.test(item)) {
    if (/apartment|typical floor/i.test(desc))           return 'P-103 … P-108 (Floor plans) / P-201 (SLD)';
    if (/common.?area|corridor/i.test(desc))             return 'P-103 … P-108 (Floor plans)';
    if (/lobby|car ?park|GF|ground/i.test(desc))         return 'P-102 (Ground) / P-201 (SLD)';
    if (/roof|RF/i.test(desc) && !/emergency/i.test(desc)) return 'P-106 (Roof) / P-201 (SLD)';
    if (/lift|elevator|EV-/i.test(desc))                 return 'P-108 (Upper Roof) / P-201';
    if (/emergency|EDB/i.test(desc))                     return 'P-201 (Emergency) / Floor plan';
    return 'P-201 (SLD) / Floor plan';
  }

  // ── Bill 5 — LV Power Cables ─────────────────────────────────────────
  if (/^5\.1\.|^5\.2\./.test(item)) return 'P-200 (SLD) / P-010 (Cable tray)'; // Main + FR rising mains
  if (/^5\.3\.|^5\.4\./.test(item)) return 'P-201 (SLD) / Floor plan';          // SMDB → DB distribution
  if (/^5\.5\./.test(item))         return 'P-103 … P-108 / P-201';             // LSZH escape route finals
  if (/^5\.6\./.test(item))         return 'P-103 … P-108 / BS 6004';            // Final-circuit bulk
  if (/^5\.7\./.test(item))         return 'P-200 (SLD) / BS 6004';              // ECC alongside

  // ── Bill 6 — Containment ─────────────────────────────────────────────
  if (/^6\./.test(item))            return 'P-010 (Cable tray detail) / P-201';

  // ── Bill 7 — Wiring Devices ──────────────────────────────────────────
  if (/^7\./.test(item))            return 'P-103 … P-108 (Floor plans)';

  // ── Bill 8 — Lighting Fixtures ───────────────────────────────────────
  if (/^8\.1\./.test(item))         return 'P-103 … P-108 (Floor plans)';
  if (/^8\.2\./.test(item))         return 'P-100 (Site / external)';
  if (/^8\.3\./.test(item))         return 'P-200 (SLD) / Lighting controls';

  // ── Bill 9 — Earthing & LP ───────────────────────────────────────────
  if (/^9\.1\./.test(item))         return 'P-300 (LV room) / P-001 (Notes)';
  if (/^9\.2\./.test(item))         return 'P-100 (Site) / P-108 (Roof)';

  // ── Bill 10 — Emergency Lighting + CBS + FA Integration ──────────────
  if (/^10\.1\./.test(item))        return 'P-103 … P-108 (Floor plans) / P-201';
  if (/^10\.2\./.test(item))        return 'P-200 (Essential) / P-201 (FR feeders)';
  if (/^10\.3\./.test(item))        return 'P-201 (Emergency loop) / P-300 (CBS cabinet)';
  if (/^10\.4\./.test(item))        return 'Coordinate with FA contractor (FA-001 series)';

  // ── Bill 11 — ELV Containment ────────────────────────────────────────
  if (/^11\./.test(item))           return 'P-010 / Specialist trade';

  // ── Bill 12 — Smart Metering ─────────────────────────────────────────
  if (/^12\./.test(item))           return 'P-300 (LV room) / DEWA Smart Grid spec';

  // ── Bill 13 — T&C and Authority Approvals ────────────────────────────
  if (/^13\./.test(item))           return 'DEWA / DM / DCD / IEC 60364-6';

  return null;
}

// ─── Apply to workbook (post-process) ─────────────────────────────────────
/**
 * Walks priceable rows and overwrites column 3 (Reference) with the resolved
 * specific drawing-no string when the resolver returns a confident match.
 * Skips when resolver returns null. Returns counts for diagnostic logging.
 */
export function applyDrawingRefsToWorkbook(wb, resolve = resolveDrawingRef) {
  let populated = 0, skipped = 0;
  wb.eachSheet(ws => {
    for (let r = 1; r <= ws.rowCount; r++) {
      const item = ws.getRow(r).getCell(1).value;
      if (typeof item !== 'string') continue;
      if (!/^\d+\.\d+\.\d+|^[A-Z]\d+\.\d+/.test(item)) continue;
      const desc = String(ws.getRow(r).getCell(2).value || '');
      const currentRef = String(ws.getRow(r).getCell(3).value || '');
      const resolved = resolve({ item, desc, currentRef });
      if (typeof resolved === 'string' && resolved.length > 0) {
        ws.getRow(r).getCell(3).value = resolved;
        populated++;
      } else {
        skipped++;
      }
    }
  });
  return { populated, skipped };
}
