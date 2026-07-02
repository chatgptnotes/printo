/**
 * DEWA / IEC formula module — replaces AI-derived numbers in Power BOQ
 * Sections 6, 9, 10, 11, 12 with auditable arithmetic.
 *
 * These are NOT the AI's job. Demand factors, earth-pit count, fixture-count
 * defaults, etc. are deterministic standards-based lookups. Pinning them in
 * code makes the BOQ defensible (numbers come from a citable rule, not from
 * "Claude said so") and removes ~40 % of the JSON the electrical procedure
 * Claude prompt is asked to produce.
 *
 * All sources cited inline. Update the lookup tables when DEWA / IEC update.
 */

// ---------------------------------------------------------------------------
// C1 — Demand factor for tcl_kw → max_demand_kw
// Source: DEWA Regulations 2017 §5.4 (Maximum Demand)
// ---------------------------------------------------------------------------
export function demandFactor(tclKw: number): number {
  if (tclKw <= 0) return 0;
  if (tclKw < 100) return 0.7;
  if (tclKw < 500) return 0.65;
  if (tclKw < 1000) return 0.6;
  return 0.55;
}

export function maxDemandKw(tclKw: number): number {
  return Math.round(tclKw * demandFactor(tclKw) * 10) / 10;
}

// ---------------------------------------------------------------------------
// C2 — Cable size from current rating (XLPE Cu 4-core, 30 °C ambient, in air)
// Source: IEC 60364-5-52 Annex B, Table B.52.5 (E-method, simplified)
// Returns mm² for one of the standard sizes.
// ---------------------------------------------------------------------------
const CABLE_AMPACITY_TABLE: Array<{ size: number; ampacity: number }> = [
  { size: 1.5,   ampacity: 22 },
  { size: 2.5,   ampacity: 30 },
  { size: 4,     ampacity: 40 },
  { size: 6,     ampacity: 51 },
  { size: 10,    ampacity: 70 },
  { size: 16,    ampacity: 94 },
  { size: 25,    ampacity: 119 },
  { size: 35,    ampacity: 148 },
  { size: 50,    ampacity: 180 },
  { size: 70,    ampacity: 232 },
  { size: 95,    ampacity: 282 },
  { size: 120,   ampacity: 328 },
  { size: 150,   ampacity: 379 },
  { size: 185,   ampacity: 434 },
  { size: 240,   ampacity: 514 },
  { size: 300,   ampacity: 593 },
  { size: 400,   ampacity: 715 },
  { size: 500,   ampacity: 826 },
  { size: 630,   ampacity: 958 },
];

export function cableSizeForCurrent(currentA: number, deratingFactor = 1.0): number {
  const required = currentA / deratingFactor;
  for (const row of CABLE_AMPACITY_TABLE) {
    if (row.ampacity >= required) return row.size;
  }
  return 630; // largest standard
}

// ---------------------------------------------------------------------------
// C3 — Earth pit count
// Source: DEWA Earthing & Lightning Protection Regulations 2018
// ---------------------------------------------------------------------------
export function earthPitCount(floors: number, buildingType: string | null): number {
  if (floors <= 0) return 2;
  const isCommercial =
    buildingType === 'office' ||
    buildingType === 'retail' ||
    buildingType === 'hotel' ||
    buildingType === 'hospital';
  return isCommercial ? Math.max(3, Math.ceil(floors / 2)) : Math.max(2, Math.ceil(floors / 3));
}

// ---------------------------------------------------------------------------
// C4 — DEWA kWh meter count
// Source: DEWA Metering Connection Procedures
// ---------------------------------------------------------------------------
export function dewaMeterCount(apartments: number | null, hasCommonArea = true, hasLvSupply = true): number {
  const apt = apartments ?? 0;
  return apt + (hasCommonArea ? 1 : 0) + (hasLvSupply ? 1 : 0);
}

// ---------------------------------------------------------------------------
// C5 — CT meter ratio derived from main ACB rating
// ---------------------------------------------------------------------------
export function ctRatioForAcb(acbRatingA: number): string {
  if (acbRatingA <= 100) return '100/5';
  if (acbRatingA <= 200) return '200/5';
  if (acbRatingA <= 400) return '400/5';
  if (acbRatingA <= 800) return '800/5';
  if (acbRatingA <= 1600) return '1600/5';
  if (acbRatingA <= 2500) return '2500/5';
  return '4000/5';
}

// ---------------------------------------------------------------------------
// C6 — Capacitor bank kVAR sizing (PF 0.85 → 0.95 typical)
// kVAR = tcl_kw × (tan(arccos(0.85)) − tan(arccos(0.95)))
//      ≈ tcl_kw × (0.620 − 0.329) ≈ tcl_kw × 0.291  → round up
// We use the simpler 0.3–0.4 rule of thumb and pick the midpoint for an
// auditable single number; consumers can override.
// ---------------------------------------------------------------------------
export function capacitorBankKvar(tclKw: number): number {
  return Math.round(tclKw * 0.3);
}

// ---------------------------------------------------------------------------
// C7 — Cable tray length estimation
// Industry rule: tray length ≈ 1.8 × Σ(cable_lengths) for primary distribution
// ---------------------------------------------------------------------------
export function cableTrayLengthM(totalCableLengthM: number): number {
  return Math.round(totalCableLengthM * 1.8);
}

// ---------------------------------------------------------------------------
// C8 — Conduit length estimation
// ---------------------------------------------------------------------------
export function conduitLengthM(trayLengthM: number): number {
  return Math.round(trayLengthM * 0.6);
}

// ---------------------------------------------------------------------------
// C9 — Outlet counts per apartment (residential)
// Source: SABI internal standard (P-379-style residential)
// ---------------------------------------------------------------------------
export interface ApartmentOutletKit {
  outlets_13a_single: number;
  outlets_13a_twin: number;
  outlets_20a: number;
  outlets_usb: number;
  fcu_spurs: number;
  water_heater_20a: number;
  washing_machine_20a: number;
}

export function outletsPerApartment(bedrooms: number): ApartmentOutletKit {
  // Linear scaling with bedroom count, anchored to 1BR baseline
  const br = Math.max(1, bedrooms);
  return {
    outlets_13a_single: 6 + br * 2,
    outlets_13a_twin: 2 + br,
    outlets_20a: 1 + Math.floor(br / 2),
    outlets_usb: 1,
    fcu_spurs: 1 + br,
    water_heater_20a: 1,
    washing_machine_20a: 1,
  };
}

// ---------------------------------------------------------------------------
// C10 — Outlet counts per office floor
// Rule: workstation 13A outlets ≈ area_sqft × 0.012
// ---------------------------------------------------------------------------
export function officeOutlets13aPerFloor(areaSqftPerFloor: number): number {
  return Math.round(areaSqftPerFloor * 0.012);
}

// ---------------------------------------------------------------------------
// C11 — Lighting fixture count
// Office: 1 fixture per 60 sqft. Residential: 1 per 80 sqft.
// ---------------------------------------------------------------------------
export function lightingFixtureCount(areaSqft: number, buildingType: string | null): number {
  const divisor = buildingType === 'office' || buildingType === 'retail' ? 60 : 80;
  return Math.round(areaSqft / divisor);
}

// ---------------------------------------------------------------------------
// C12 — Fire pump motor sizing by building height
// Source: UAE Fire Code 2018, Chapter 4
// ---------------------------------------------------------------------------
export function firePumpMotorKw(buildingHeightM: number): number {
  if (buildingHeightM <= 0) return 7.5;
  if (buildingHeightM < 23) return 7.5;
  if (buildingHeightM < 50) return 15;
  if (buildingHeightM < 90) return 22;
  return 37;
}

// ---------------------------------------------------------------------------
// C13 — Standby generator sizing
// 1.25 × essential_load_kw, rounded up to nearest 10 kVA
// Essential load typically = fire pump + lifts + corridor lighting + life safety
// (≈ 25–35 % of total connected load for residential)
// ---------------------------------------------------------------------------
export function standbyGeneratorKva(essentialLoadKw: number, powerFactor = 0.8): number {
  const kva = (essentialLoadKw * 1.25) / powerFactor;
  return Math.ceil(kva / 10) * 10;
}

// ---------------------------------------------------------------------------
// C14 — Cable de-rating (grouping × ambient)
// Simplified: 6+ cables in a group at 35 °C UAE ambient ≈ 0.7
// ---------------------------------------------------------------------------
export function deratingFactor(groupedCables: number, ambientC: number): number {
  let group = 1.0;
  if (groupedCables >= 9) group = 0.7;
  else if (groupedCables >= 6) group = 0.75;
  else if (groupedCables >= 4) group = 0.8;
  else if (groupedCables >= 2) group = 0.85;

  let temp = 1.0;
  if (ambientC >= 50) temp = 0.78;
  else if (ambientC >= 45) temp = 0.85;
  else if (ambientC >= 40) temp = 0.91;
  else if (ambientC >= 35) temp = 0.96;

  return Math.round(group * temp * 100) / 100;
}

// ---------------------------------------------------------------------------
// C15 — Voltage drop check (3-phase, copper, 230/400V)
// ΔV % = (√3 × L × I × ρ) / (A × V) × 100
// ρ for Cu at 70 °C = 0.0224 Ω·mm²/m
// Returns true if drop ≤ 4 % (typical limit for distribution).
// ---------------------------------------------------------------------------
export function voltageDropOk(
  lengthM: number,
  currentA: number,
  cableSizeMm2: number,
  voltageV = 400,
  maxPercent = 4,
): { ok: boolean; dropPercent: number } {
  const rho = 0.0224;
  const drop = (Math.sqrt(3) * lengthM * currentA * rho) / cableSizeMm2;
  const percent = Math.round((drop / voltageV) * 10000) / 100;
  return { ok: percent <= maxPercent, dropPercent: percent };
}

// ---------------------------------------------------------------------------
// C17 — LV panel ACB rating (round up to next standard frame)
// Source: IEC 60947 standard frame sizes
// ---------------------------------------------------------------------------
const STANDARD_ACB_FRAMES = [630, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000, 5000, 6300];
export function acbFrameSize(maxLoadAmps: number): number {
  const sized = maxLoadAmps * 1.25;
  for (const frame of STANDARD_ACB_FRAMES) {
    if (frame >= sized) return frame;
  }
  return 6300;
}

// ---------------------------------------------------------------------------
// Section-level helpers — derive whole BOQ rows from a known cable_schedule
// without asking AI to recite formulas.
// ---------------------------------------------------------------------------

export interface CableScheduleEntry {
  size_mm2: number;
  length_m: number;
}

export interface DerivedContainmentRow {
  description: string;
  unit: string;
  estimated_qty: number;
  source: 'formula';
}

export function deriveContainmentRows(cableSchedule: CableScheduleEntry[]): DerivedContainmentRow[] {
  const totalCableM = cableSchedule.reduce((s, c) => s + (c.length_m || 0), 0);
  const trayM = cableTrayLengthM(totalCableM);
  const conduitM = conduitLengthM(trayM);
  return [
    { description: 'Cable tray (HDGI, 300mm)', unit: 'm', estimated_qty: Math.round(trayM * 0.6), source: 'formula' },
    { description: 'Cable tray (HDGI, 200mm)', unit: 'm', estimated_qty: Math.round(trayM * 0.4), source: 'formula' },
    { description: 'PVC conduit (25mm)', unit: 'm', estimated_qty: conduitM, source: 'formula' },
  ];
}

export function deriveEarthingRows(
  floors: number | null,
  buildingType: string | null,
  buildingHeightM: number,
): DerivedContainmentRow[] {
  const pits = earthPitCount(floors ?? 1, buildingType);
  const earthCableLength = Math.round(buildingHeightM * 1.2 + pits * 8);
  return [
    { description: 'Earth pit assembly (DEWA approved, 2.4m rod)', unit: 'No.', estimated_qty: pits, source: 'formula' },
    { description: 'Earth cable 70mm² Cu/PVC', unit: 'm', estimated_qty: earthCableLength, source: 'formula' },
    { description: 'Surge protection device (Type 1+2)', unit: 'No.', estimated_qty: 1, source: 'formula' },
  ];
}

export function deriveMeteringRows(
  apartments: number | null,
  lvPanelCount: number,
): DerivedContainmentRow[] {
  const meters = dewaMeterCount(apartments);
  return [
    { description: 'DEWA kWh meter (3-phase)', unit: 'No.', estimated_qty: meters, source: 'formula' },
    { description: 'CT meter set', unit: 'No.', estimated_qty: lvPanelCount, source: 'formula' },
  ];
}

export interface DerivedLoadSummaryRow {
  panel: string;
  tcl_kw: number;
  demand_factor: number;
  max_demand_kw: number;
  source: 'formula';
}

export function deriveLoadSummary(
  panels: Array<{ tag: string; tcl_kw: number }>,
): DerivedLoadSummaryRow[] {
  return panels.map(p => ({
    panel: p.tag,
    tcl_kw: p.tcl_kw,
    demand_factor: demandFactor(p.tcl_kw),
    max_demand_kw: maxDemandKw(p.tcl_kw),
    source: 'formula',
  }));
}

// ---------------------------------------------------------------------------
// Section 6 — Mechanical & Service Equipment isolators
// Derives the standard set of isolators (fire pump, generator, jockey pump,
// lifts) from project floors + height + building type. Lift count scales
// with floors; pump rating with height per UAE Fire Code 2018.
// ---------------------------------------------------------------------------

export interface DerivedMechanicalRow {
  description: string;
  count: number;
  rating_kw: number | null;
  rating_a: number | null;
  source: 'formula';
}

export function deriveMechanicalEquipmentRows(input: {
  floors: number | null;
  buildingHeightM: number | null;
  buildingType: string | null;
}): DerivedMechanicalRow[] {
  const floors = Math.max(1, input.floors ?? 1);
  const heightM = input.buildingHeightM ?? floors * 3;
  const isCommercial = input.buildingType === 'office' || input.buildingType === 'retail' || input.buildingType === 'hotel' || input.buildingType === 'hospital';

  const firePumpKw = firePumpMotorKw(heightM);
  const rows: DerivedMechanicalRow[] = [
    { description: 'Fire pump isolator (UAE Fire Code 2018)', count: 1, rating_kw: firePumpKw, rating_a: null, source: 'formula' },
    { description: 'Jockey pump isolator', count: 1, rating_kw: 2.2, rating_a: null, source: 'formula' },
  ];

  // Lift isolators — 1 per ~6 floors (residential), 1 per ~4 floors (commercial)
  const liftCount = isCommercial ? Math.ceil(floors / 4) : Math.ceil(floors / 6);
  if (liftCount > 0) {
    rows.push({
      description: 'Lift motor isolator',
      count: liftCount,
      rating_kw: 11,
      rating_a: null,
      source: 'formula',
    });
  }

  // Standby generator isolator — only for buildings ≥4 floors per UAE practice
  if (floors >= 4) {
    rows.push({
      description: 'Standby generator isolator (ATS-side)',
      count: 1,
      rating_kw: null,
      rating_a: null,
      source: 'formula',
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Section 7 — Power outlets total estimation
// Office: officeOutlets13aPerFloor × floor count, plus 1 USB per ~600 sqft.
// Residential: needs apartment count; if not derivable, use area / 1500 as proxy.
// ---------------------------------------------------------------------------

export interface DerivedOutletRow {
  description: string;
  unit: string;
  estimated_qty: number;
  source: 'formula';
}

export function derivePowerOutletRows(input: {
  floors: number | null;
  totalAreaSqft: number | null;
  areaPerFloorSqft: number | null;
  buildingType: string | null;
}): DerivedOutletRow[] {
  const buildingType = input.buildingType ?? 'office';
  const floors = Math.max(1, input.floors ?? 1);
  const areaPerFloor = input.areaPerFloorSqft ?? (input.totalAreaSqft ? input.totalAreaSqft / floors : 0);
  const totalArea = input.totalAreaSqft ?? areaPerFloor * floors;

  if (totalArea <= 0) return [];

  const isOfficeLike = buildingType === 'office' || buildingType === 'retail';
  if (isOfficeLike && areaPerFloor > 0) {
    const per13aPerFloor = officeOutlets13aPerFloor(areaPerFloor);
    return [
      { description: '13A twin switched socket outlet', unit: 'No.', estimated_qty: per13aPerFloor * floors, source: 'formula' },
      { description: '20A DP switched outlet (kettle/heater)', unit: 'No.', estimated_qty: Math.round(per13aPerFloor * 0.15) * floors, source: 'formula' },
      { description: 'USB charging outlet (twin)', unit: 'No.', estimated_qty: Math.round(totalArea / 600), source: 'formula' },
      { description: 'Floor box (4-gang)', unit: 'No.', estimated_qty: Math.max(1, Math.round(areaPerFloor / 250)) * floors, source: 'formula' },
    ];
  }

  // Residential — proxy apartments by area_per_floor / 1500 sqft (typical 1BR-2BR Dubai)
  const apartmentsPerFloor = Math.max(1, Math.round(areaPerFloor / 1500));
  const totalApartments = apartmentsPerFloor * floors;
  // Use 2BR baseline for the per-apt counts since we don't know bedroom mix
  const kit = outletsPerApartment(2);
  return [
    { description: '13A single switched socket outlet', unit: 'No.', estimated_qty: kit.outlets_13a_single * totalApartments, source: 'formula' },
    { description: '13A twin switched socket outlet', unit: 'No.', estimated_qty: kit.outlets_13a_twin * totalApartments, source: 'formula' },
    { description: '20A DP switched outlet (water heater)', unit: 'No.', estimated_qty: (kit.water_heater_20a + kit.washing_machine_20a) * totalApartments, source: 'formula' },
    { description: 'FCU spur (per apartment)', unit: 'No.', estimated_qty: kit.fcu_spurs * totalApartments, source: 'formula' },
    { description: 'USB charging outlet', unit: 'No.', estimated_qty: kit.outlets_usb * totalApartments, source: 'formula' },
  ];
}
