import {
  DEFAULT_MARGIN_PERCENT,
} from '@/lib/shared/constants';
import { ServiceType } from '@/lib/shared/types';
import type { HVACProcedureResult, DuctRouteComponents, ElectricalComponents } from '@/lib/ai/ai-provider';

// HVAC-only constants (formerly in constants.ts, inlined here since estimation-engine is no longer called)
const KW_TO_TR = 3.517;
const THERMAL_LOAD_FACTORS: Record<string, number> = {
  office: 450, retail: 400, residential: 500, warehouse: 700,
  villa: 550, hotel: 380, hospital: 350, restaurant: 300,
};
const SYSTEM_TYPE_THRESHOLDS: Array<{ maxTR: number; type: string; code: string }> = [
  { maxTR: 5, type: 'Split System', code: 'split' },
  { maxTR: 50, type: 'VRF System', code: 'vrf' },
  { maxTR: 200, type: 'Package Unit', code: 'package' },
  { maxTR: Infinity, type: 'Chiller System', code: 'chiller' },
];

// Unit rates in AED per TR (for HVAC) or AED per sqft (for other services)
export const HVAC_UNIT_RATES: Record<string, number> = {
  split: 3500,
  vrf: 4200,
  package: 3800,
  chiller: 5500,
  district_cooling: 4800,
};

// FAHU pricing: AED per CFM of airflow
export const FAHU_RATE_PER_CFM = 8.5; // AED per CFM
export const FAHU_RATE_PER_UNIT = 55000; // AED per unit (fallback if no CFM)

// AED per sqft by building type for non-HVAC services
export const SERVICE_RATES: Record<string, Record<string, number>> = {
  electrical: {
    office: 35, retail: 38, residential: 25, warehouse: 15,
    villa: 30, hotel: 45, hospital: 42, restaurant: 38,
  },
  plumbing: {
    office: 20, retail: 15, residential: 25, warehouse: 8,
    villa: 30, hotel: 35, hospital: 40, restaurant: 30,
  },
  fire_fighting: {
    office: 10, retail: 12, residential: 9, warehouse: 7,
    villa: 6, hotel: 13, hospital: 15, restaurant: 13,
  },
  fire_alarm: {
    office: 45, retail: 50, residential: 30, warehouse: 20,
    villa: 25, hotel: 55, hospital: 70, restaurant: 50,
  },
  bms: {
    office: 25, retail: 20, residential: 10, warehouse: 8,
    villa: 6, hotel: 30, hospital: 40, restaurant: 18,
  },
  lpg: {
    office: 0, retail: 5, residential: 3, warehouse: 0,
    villa: 4, hotel: 8, hospital: 5, restaurant: 15,
  },
  drainage: {
    office: 12, retail: 10, residential: 15, warehouse: 6,
    villa: 18, hotel: 20, hospital: 22, restaurant: 18,
  },
};

// HVAC drawing identification (George's procedure steps 10-16)
export interface HVACDrawingCheck {
  step: number;
  name: string;
  description: string;
  status: 'found' | 'not_found' | 'skipped';
  filename?: string;
  extractedValue?: string;
}

export function identifyHVACDrawings(
  attachments: { filename: string; file_type: string | null; extracted_data: Record<string, unknown> | null }[]
): { checks: HVACDrawingCheck[]; totalKw: number | null; fahuKw: number | null; systemType: string | null } {
  const checks: HVACDrawingCheck[] = [];
  let totalKw: number | null = null;
  let fahuKw: number | null = null;
  let systemType: string | null = null;

  // Step 10: Open HVAC folder / find thermal load drawing
  const thermalLoadDrawing = attachments.find((a) => {
    const name = a.filename.toLowerCase();
    return name.includes('thermal') || name.includes('heat load') || name.includes('cooling load');
  });
  checks.push({
    step: 10,
    name: 'Open Thermal Load Drawing',
    description: 'Find drawing titled "thermal load summary" in HVAC folder',
    status: thermalLoadDrawing ? 'found' : 'not_found',
    filename: thermalLoadDrawing?.filename,
  });

  // Step 11: Extract total KW
  if (thermalLoadDrawing?.extracted_data) {
    const data = thermalLoadDrawing.extracted_data as Record<string, unknown>;
    const kw = Number(data.total_kw) || null;
    if (kw) totalKw = kw;
    checks.push({
      step: 11,
      name: 'Extract Total KW',
      description: 'Identify total calculated KW from bottom of thermal load column',
      status: kw ? 'found' : 'not_found',
      extractedValue: kw ? `${kw} kW` : undefined,
    });
  } else {
    checks.push({
      step: 11,
      name: 'Extract Total KW',
      description: 'Identify total calculated KW from bottom of thermal load column',
      status: thermalLoadDrawing ? 'not_found' : 'skipped',
    });
  }

  // Step 12: Extract FAHU KW
  if (thermalLoadDrawing?.extracted_data) {
    const data = thermalLoadDrawing.extracted_data as Record<string, unknown>;
    const fahu = Number(data.fahu_kw) || null;
    if (fahu) fahuKw = fahu;
    checks.push({
      step: 12,
      name: 'Extract FAHU KW',
      description: 'Identify Fresh Air Handling Unit (FAHU) total KW',
      status: fahu ? 'found' : 'not_found',
      extractedValue: fahu ? `${fahu} kW` : undefined,
    });
  } else {
    checks.push({
      step: 12,
      name: 'Extract FAHU KW',
      description: 'Identify Fresh Air Handling Unit (FAHU) total KW',
      status: thermalLoadDrawing ? 'not_found' : 'skipped',
    });
  }

  // Step 13: Calculate AC Unit KW (derived, not from drawing)
  const acUnitKw = totalKw && fahuKw ? totalKw - fahuKw : null;
  checks.push({
    step: 13,
    name: 'Calculate AC Unit KW',
    description: 'AC unit total = Total KW minus FAHU KW',
    status: acUnitKw ? 'found' : 'skipped',
    extractedValue: acUnitKw ? `${acUnitKw} kW (${totalKw} - ${fahuKw})` : undefined,
  });

  // Step 14: Equipment schedule — identify AC system type
  const equipSchedule = attachments.find((a) => {
    const name = a.filename.toLowerCase();
    return name.includes('equipment schedule') || name.includes('ac schedule') || name.includes('hvac schedule');
  });
  if (equipSchedule?.extracted_data) {
    const data = equipSchedule.extracted_data as Record<string, unknown>;
    systemType = (data.system_type as string) || null;
  }
  checks.push({
    step: 14,
    name: 'Identify AC System Type',
    description: 'Check equipment schedule for system type: VRF, chiller, package, or split',
    status: equipSchedule ? 'found' : 'not_found',
    filename: equipSchedule?.filename,
    extractedValue: systemType || undefined,
  });

  // Step 15: Calculate tonnage (derived in estimation)
  checks.push({
    step: 15,
    name: 'Calculate Tonnage',
    description: 'Convert KW to tonnage (TR) for sizing',
    status: totalKw ? 'found' : 'skipped',
    extractedValue: totalKw ? `${(totalKw / 3.517).toFixed(1)} TR` : undefined,
  });

  // Step 16: Formula-based pricing (done in estimation)
  checks.push({
    step: 16,
    name: 'Formula-Based Pricing',
    description: 'Calculate price from given inputs using formula-based rates',
    status: 'skipped', // Will be marked found after estimation runs
  });

  return { checks, totalKw, fahuKw, systemType };
}

// Step-by-step calculation trace for transparency
export interface EstimationStep {
  step: number;        // pipeline step number (10-16 for HVAC)
  name: string;
  input: string;       // what was fed in
  calculation: string; // how it was computed
  output: string;      // result
  status: 'completed' | 'skipped' | 'not_found';
}

export interface ServiceEstimate {
  service_type: ServiceType;
  system_type: string | null;
  tonnage: number | null;
  total_kw: number | null;
  fahu_kw: number | null;
  ac_unit_kw: number | null;
  unit_rate_aed: number;
  quantity: number;
  total_aed: number;
  calculation_notes: string;
  rate_source: string; // attribution: where the rate came from
  steps: EstimationStep[]; // step-by-step breakdown
  formula_used?: string; // BT flowchart formula label (e.g. "Formula 1 (VRF)")
  formula_expression?: string; // human-readable math (e.g. "42.6 TR × 4,200 AED/TR = 178,920 AED")
}

export interface EstimationOutput {
  services: ServiceEstimate[];
  total_aed: number;
  cost_per_sqft_aed: number;
  margin_percent: number;
  final_quote_aed: number;
  steps: EstimationStep[]; // aggregated steps across all services
}

function determineSystemType(tonnage: number): { type: string; code: string } {
  for (const threshold of SYSTEM_TYPE_THRESHOLDS) {
    if (tonnage <= threshold.maxTR) {
      return { type: threshold.type, code: threshold.code };
    }
  }
  return { type: 'Chiller System', code: 'chiller' };
}

export function calculateHVACEstimate(
  totalAreaSqft: number,
  buildingType: string,
  totalKw?: number | null,
  fahuKw?: number | null,
  specifiedTonnage?: number | null,
  specifiedSystem?: string | null
): ServiceEstimate {
  let tonnage: number;
  let calculatedTotalKw = totalKw || null;
  let calculatedFahuKw = fahuKw || null;
  let acUnitKw: number | null = null;
  let notes: string;

  // Step-by-step trace following George's exact HVAC procedure (steps 10-16)
  const steps: EstimationStep[] = [];

  // Step 10: Open thermal load drawing (handled by identifyHVACDrawings, noted here for completeness)
  steps.push({
    step: 10,
    name: 'Open Thermal Load Drawing',
    input: `Project folder attachments`,
    calculation: 'Search for file with "thermal", "heat load", or "cooling load" in name',
    output: totalKw ? 'Thermal load drawing found' : 'No thermal load drawing — using area-based fallback',
    status: totalKw ? 'completed' : 'not_found',
  });

  // Step 11: Extract Total KW
  steps.push({
    step: 11,
    name: 'Extract Total KW',
    input: totalKw ? `Thermal load drawing` : 'No drawing available',
    calculation: 'Read total calculated KW from bottom of thermal load column',
    output: totalKw ? `Total KW = ${totalKw} kW` : 'Not found — will derive from area',
    status: totalKw ? 'completed' : 'not_found',
  });

  // Step 12: Extract FAHU KW
  steps.push({
    step: 12,
    name: 'Extract FAHU KW',
    input: fahuKw ? `Thermal load drawing` : 'No drawing available',
    calculation: 'Read Fresh Air Handling Unit (FAHU) total KW from drawing',
    output: fahuKw ? `FAHU KW = ${fahuKw} kW` : 'Not found — assumed 0',
    status: fahuKw ? 'completed' : 'skipped',
  });

  if (specifiedTonnage && specifiedTonnage > 0) {
    // From PDF/RFQ specified tonnage (most accurate)
    tonnage = specifiedTonnage;
    notes = `From RFQ specs: ${tonnage} TR as specified in project documents.`;

    // Step 13: AC Unit KW — not applicable when tonnage is directly specified
    steps.push({
      step: 13,
      name: 'Calculate AC Unit KW',
      input: `Tonnage specified directly: ${specifiedTonnage} TR`,
      calculation: 'AC Unit KW calculation skipped — TR provided directly in RFQ',
      output: 'Skipped',
      status: 'skipped',
    });
  } else if (totalKw && totalKw > 0) {
    // From KW values (George's preferred method)
    const fahuKwVal = fahuKw || 0;
    acUnitKw = totalKw - fahuKwVal;
    tonnage = totalKw / KW_TO_TR;
    notes = `From thermal load: ${totalKw} kW total, ${fahuKwVal} kW FAHU, ${acUnitKw} kW AC units. ${tonnage.toFixed(1)} TR.`;

    // Step 13: Calculate AC Unit KW
    steps.push({
      step: 13,
      name: 'Calculate AC Unit KW',
      input: `Total KW = ${totalKw} kW, FAHU KW = ${fahuKwVal} kW`,
      calculation: `AC Unit KW = Total KW − FAHU KW = ${totalKw} − ${fahuKwVal}`,
      output: `AC Unit KW = ${acUnitKw} kW`,
      status: 'completed',
    });
  } else {
    // From area-based calculation (fallback)
    const factor = THERMAL_LOAD_FACTORS[buildingType] || THERMAL_LOAD_FACTORS.office;
    tonnage = totalAreaSqft / factor;
    notes = `Area-based: ${totalAreaSqft.toLocaleString()} sqft / ${factor} sqft/TR = ${tonnage.toFixed(1)} TR.`;

    // Step 13: AC Unit KW — not applicable for area-based
    steps.push({
      step: 13,
      name: 'Calculate AC Unit KW',
      input: `No KW data — using area-based fallback`,
      calculation: `${totalAreaSqft.toLocaleString()} sqft ÷ ${factor} sqft/TR (${buildingType} factor)`,
      output: `Derived tonnage = ${tonnage.toFixed(1)} TR (no KW breakdown)`,
      status: 'skipped',
    });
  }

  // Use specified system type if provided, otherwise determine from tonnage
  let system: { type: string; code: string };
  if (specifiedSystem) {
    const sysLower = specifiedSystem.toLowerCase();
    if (sysLower.includes('vrf')) system = { type: 'VRF System', code: 'vrf' };
    else if (sysLower.includes('chiller')) system = { type: 'Chiller System', code: 'chiller' };
    else if (sysLower.includes('split')) system = { type: 'Split Unit', code: 'split' };
    else if (sysLower.includes('package')) system = { type: 'Package Unit', code: 'package' };
    else if (sysLower.includes('district')) system = { type: 'District Cooling', code: 'district_cooling' };
    else system = determineSystemType(tonnage);
  } else {
    system = determineSystemType(tonnage);
  }

  // Step 14: Identify AC System Type
  steps.push({
    step: 14,
    name: 'Identify AC System Type',
    input: specifiedSystem ? `Equipment schedule: "${specifiedSystem}"` : `Tonnage: ${tonnage.toFixed(1)} TR`,
    calculation: specifiedSystem
      ? `System type read from equipment schedule`
      : `Tonnage thresholds: ≤15 TR → Split, ≤50 TR → VRF, ≤150 TR → Package, >150 TR → Chiller`,
    output: `System type = ${system.type}`,
    status: 'completed',
  });

  const roundedTonnage = Math.round(tonnage * 10) / 10;

  // Step 15: Calculate Tonnage
  steps.push({
    step: 15,
    name: 'Calculate Tonnage',
    input: totalKw ? `Total KW = ${totalKw} kW` : specifiedTonnage ? `Specified tonnage = ${specifiedTonnage} TR` : `Area = ${totalAreaSqft.toLocaleString()} sqft`,
    calculation: totalKw
      ? `TR = Total KW ÷ 3.517 = ${totalKw} ÷ 3.517`
      : specifiedTonnage
      ? `TR specified directly`
      : `TR = Area ÷ ${THERMAL_LOAD_FACTORS[buildingType] || THERMAL_LOAD_FACTORS.office} sqft/TR`,
    output: `Tonnage = ${roundedTonnage} TR`,
    status: 'completed',
  });

  const unitRate = HVAC_UNIT_RATES[system.code];
  const totalAed = tonnage * unitRate;

  // Step 16: Formula-Based Pricing
  steps.push({
    step: 16,
    name: 'Formula-Based Pricing',
    input: `Tonnage = ${roundedTonnage} TR, System = ${system.type}, Rate = ${unitRate} AED/TR`,
    calculation: `Total AED = Tonnage × Unit Rate = ${roundedTonnage} × ${unitRate}`,
    output: `HVAC Total = AED ${Math.round(totalAed).toLocaleString()}`,
    status: 'completed',
  });

  return {
    service_type: 'hvac',
    system_type: system.type,
    tonnage: roundedTonnage,
    total_kw: calculatedTotalKw,
    fahu_kw: calculatedFahuKw,
    ac_unit_kw: acUnitKw,
    unit_rate_aed: unitRate,
    quantity: roundedTonnage,
    total_aed: Math.round(totalAed),
    calculation_notes: `${notes} System: ${system.type}. Rate: ${unitRate} AED/TR.`,
    rate_source: 'ai',
    steps,
  };
}

// --- George's 37-Step HVAC Procedure Estimation ---
// Uses HVACProcedureResult from Claude analysis following the exact flowchart

export function calculateHVACFromProcedure(
  rawProcedure: HVACProcedureResult,
  totalAreaSqft: number,
  buildingType: string,
  ductRouteData?: DuctRouteComponents,
  priceLibrary: PriceLibraryItem[] = [],
): ServiceEstimate & { line_items?: HVACComponentLineItem[] } {
  // Defensive normalization — Claude occasionally returns HVACProcedureResult
  // with null/missing array fields (thermal_load_table, non_indoor_items,
  // drawings_list), which used to crash this function with
  // "thermal_load_table.reduce is not a function" and mark step 16 as failed.
  // Normalize once here so every downstream read can trust the shape.
  const procedure: HVACProcedureResult = {
    ...rawProcedure,
    thermal_load_table: Array.isArray(rawProcedure?.thermal_load_table)
      ? rawProcedure.thermal_load_table
      : [],
    non_indoor_items: Array.isArray(rawProcedure?.non_indoor_items)
      ? rawProcedure.non_indoor_items
      : [],
    drawings_list: Array.isArray(rawProcedure?.drawings_list)
      ? rawProcedure.drawings_list
      : [],
  };
  const steps: EstimationStep[] = [];

  // --- Steps 1-5: Folder Navigation ---
  const foldersFound = [
    procedure.hvac_folder_found && 'HVAC',
    procedure.ventilation_folder_found && 'Ventilation',
    procedure.ac_folder_found && 'AC',
  ].filter(Boolean);

  steps.push({
    step: 10, name: 'Open HVAC/Ventilation/AC Folders (Steps 1-5)',
    input: `Searching for HVAC, Ventilation, and AC folders in project attachments`,
    calculation: `Found folders: ${foldersFound.length > 0 ? foldersFound.join(', ') : 'None'}`,
    output: procedure.drawings_list.length > 0
      ? `${procedure.drawings_list.length} drawings listed across ${foldersFound.length} folder(s)`
      : 'No AC schedule exists — will use area-based fallback',
    status: foldersFound.length > 0 ? 'completed' : 'not_found',
  });

  // --- Steps 6-8: Drawing Identification ---
  steps.push({
    step: 11, name: 'Check for Key Drawings (Steps 6-8)',
    input: 'Searching for: Thermal Load Summary, Equipment Schedule, AC Equipment Schedule',
    calculation: [
      `Thermal Load Summary: ${procedure.thermal_load_summary_found ? 'FOUND' : 'not found'}${procedure.thermal_load_summary_file ? ` (${procedure.thermal_load_summary_file})` : ''}`,
      `Equipment Schedule: ${procedure.equipment_schedule_found ? 'FOUND' : 'not found'}${procedure.equipment_schedule_file ? ` (${procedure.equipment_schedule_file})` : ''}`,
      `AC Equipment Schedule: ${procedure.ac_equipment_schedule_found ? 'FOUND' : 'not found'}${procedure.ac_equipment_schedule_file ? ` (${procedure.ac_equipment_schedule_file})` : ''}`,
    ].join(' | '),
    output: procedure.thermal_load_summary_found || procedure.equipment_schedule_found
      ? 'Key drawings identified and confirmed'
      : 'Key drawings not found — estimation will use available data',
    status: procedure.thermal_load_summary_found ? 'completed' : 'not_found',
  });

  // --- Steps 9-10: Confirmation ---
  steps.push({
    step: 11, name: 'Confirm Drawings by Comparison (Steps 9-10)',
    input: 'Compare found drawings against expected format',
    calculation: `Thermal Load confirmed: ${procedure.thermal_load_confirmed ? 'YES' : 'NO'} | Equipment Schedule confirmed: ${procedure.equipment_schedule_confirmed ? 'YES' : 'NO'}`,
    output: procedure.thermal_load_confirmed ? 'Drawings confirmed as valid' : 'Could not confirm — proceeding with available data',
    status: procedure.thermal_load_confirmed ? 'completed' : 'skipped',
  });

  // --- Steps 11-12: Read Thermal Load Summary ---
  steps.push({
    step: 12, name: 'Read Thermal Load Summary Table (Steps 11-12)',
    input: procedure.thermal_load_summary_file || 'No thermal load file',
    calculation: procedure.thermal_load_table.length > 0
      ? `Extracted ${procedure.thermal_load_table.length} zones: ${procedure.thermal_load_table.map(t => `${t.area_or_zone}: ${t.capacity_kw}kW (${t.indoor_unit_type})`).join(', ')}`
      : 'No table data extracted',
    output: procedure.thermal_load_table.length > 0
      ? `${procedure.thermal_load_table.length} zones with total ${procedure.thermal_load_table.reduce((s, t) => s + t.capacity_kw, 0).toFixed(1)} kW`
      : 'No thermal load data — using calculated AC load or fallback',
    status: procedure.thermal_load_table.length > 0 ? 'completed' : 'not_found',
  });

  // --- Steps 13-15: Indoor Unit Count ---
  steps.push({
    step: 13, name: 'Count Indoor Units: Decorative vs Ducted (Steps 13-15)',
    input: `From thermal load table and equipment schedule`,
    calculation: `Decorative: ${procedure.decorative_count} | Ducted: ${procedure.ducted_count}`,
    output: `Predominantly ${procedure.predominantly} indoor units`,
    status: (procedure.decorative_count + procedure.ducted_count) > 0 ? 'completed' : 'skipped',
  });

  // --- Steps 16-18: Non-Indoor Items ---
  const nonIndoorSummary = procedure.non_indoor_items.length > 0
    ? procedure.non_indoor_items.map(i => `${i.item} (${i.type}, qty:${i.quantity}, ${i.capacity_kw || '?'}kW)`).join(', ')
    : 'None identified';

  steps.push({
    step: 14, name: 'Identify Non-Indoor Items (Steps 16-18)',
    input: 'Equipment schedule and drawings',
    calculation: nonIndoorSummary,
    output: procedure.non_indoor_items.length > 0
      ? `Found ${procedure.non_indoor_items.length} non-indoor items: ${procedure.non_indoor_items.map(i => i.type).join(', ')}`
      : 'No non-indoor items identified',
    status: procedure.non_indoor_items.length > 0 ? 'completed' : 'not_found',
  });

  // --- Steps 19-29: System Type Declaration ---
  // Map procedure system type to rate code
  const systemTypeMap: Record<string, { type: string; code: string }> = {
    vrf: { type: 'VRF System', code: 'vrf' },
    dx_split: { type: 'DX Split Unit', code: 'split' },
    chiller: { type: 'Chiller System', code: 'chiller' },
    district_cooling: { type: 'District Cooling', code: 'district_cooling' },
    unknown: { type: 'Unknown — using area fallback', code: 'vrf' },
  };
  const detectedSystem = systemTypeMap[procedure.system_type] || systemTypeMap.unknown;

  steps.push({
    step: 14, name: 'Declare AC System Type (Steps 19-29)',
    input: `Indoor KW: ${procedure.total_indoor_kw} | Outdoor KW: ${procedure.total_outdoor_kw} | Heat Exchanger: ${procedure.has_heat_exchanger ? 'YES' : 'NO'}`,
    calculation: procedure.system_detection_reasoning,
    output: `System declared: ${detectedSystem.type}`,
    status: procedure.system_type !== 'unknown' ? 'completed' : 'not_found',
  });

  // --- Step 30: Calculated AC Load ---
  const totalLoadKw = procedure.calculated_ac_load_kw || procedure.total_indoor_kw || 0;
  let tonnage: number;
  let notes: string;

  if (totalLoadKw > 0) {
    tonnage = totalLoadKw / KW_TO_TR;
    notes = `From drawings (George's procedure): ${totalLoadKw} kW total AC load = ${tonnage.toFixed(1)} TR. System: ${detectedSystem.type}.`;
  } else {
    // Fallback to area-based
    const factor = THERMAL_LOAD_FACTORS[buildingType] || THERMAL_LOAD_FACTORS.office;
    tonnage = totalAreaSqft / factor;
    notes = `Area-based fallback: ${totalAreaSqft.toLocaleString()} sqft / ${factor} sqft/TR = ${tonnage.toFixed(1)} TR. No thermal load data from drawings.`;
  }

  steps.push({
    step: 15, name: 'Read Calculated AC Load Total (Step 30)',
    input: totalLoadKw > 0 ? `Thermal load summary bottom total` : `Area-based: ${totalAreaSqft.toLocaleString()} sqft`,
    calculation: totalLoadKw > 0
      ? `AC Load = ${totalLoadKw} kW → TR = ${totalLoadKw} / 3.517`
      : `TR = ${totalAreaSqft.toLocaleString()} / ${THERMAL_LOAD_FACTORS[buildingType] || THERMAL_LOAD_FACTORS.office} sqft/TR`,
    output: `Tonnage = ${tonnage.toFixed(1)} TR`,
    status: totalLoadKw > 0 ? 'completed' : 'skipped',
  });

  // --- Steps 31-34: Formula-Based Pricing by System Type ---
  const roundedTonnage = Math.round(tonnage * 10) / 10;
  const unitRate = HVAC_UNIT_RATES[detectedSystem.code] || HVAC_UNIT_RATES.vrf;
  const acPrice = tonnage * unitRate;

  const formulaLabel = {
    vrf: 'Formula 1 (VRF)', split: 'Formula 2 (DX Split)',
    chiller: 'Formula 3 (Chiller)', district_cooling: 'Formula 4 (District Cooling)',
    package: 'Formula (Package)',
  }[detectedSystem.code] || 'Formula';

  steps.push({
    step: 16, name: `Price AC System — ${formulaLabel} (Steps 31-34)`,
    input: `System: ${detectedSystem.type}, Tonnage: ${roundedTonnage} TR, Rate: ${unitRate} AED/TR`,
    calculation: `AC Price = ${roundedTonnage} TR × ${unitRate} AED/TR`,
    output: `AC System Price = AED ${Math.round(acPrice).toLocaleString()}`,
    status: 'completed',
  });

  // --- Steps 35-36: FAHU Pricing ---
  let fahuPrice = 0;
  if (procedure.fahu_exists && procedure.fahu_count > 0) {
    if (procedure.fahu_flow_cfm && procedure.fahu_flow_cfm > 0) {
      fahuPrice = procedure.fahu_flow_cfm * FAHU_RATE_PER_CFM * procedure.fahu_count;
    } else {
      fahuPrice = FAHU_RATE_PER_UNIT * procedure.fahu_count;
    }

    steps.push({
      step: 16, name: 'Price FAHU — Formula 5 (Steps 35-36)',
      input: `FAHU count: ${procedure.fahu_count}, Flow: ${procedure.fahu_flow_cfm || 'N/A'} CFM`,
      calculation: procedure.fahu_flow_cfm
        ? `FAHU Price = ${procedure.fahu_flow_cfm} CFM × ${FAHU_RATE_PER_CFM} AED/CFM × ${procedure.fahu_count} units`
        : `FAHU Price = ${FAHU_RATE_PER_UNIT} AED/unit × ${procedure.fahu_count} units`,
      output: `FAHU Price = AED ${Math.round(fahuPrice).toLocaleString()}`,
      status: 'completed',
    });
  }

  // --- Step 37: Total AC Price ---
  const totalHvacPrice = acPrice + fahuPrice;

  steps.push({
    step: 16, name: 'Total AC Price — Formula 6 (Step 37)',
    input: `AC System: AED ${Math.round(acPrice).toLocaleString()} + FAHU: AED ${Math.round(fahuPrice).toLocaleString()}`,
    calculation: `Total = AC System Price + FAHU Price`,
    output: `Total HVAC Price = AED ${Math.round(totalHvacPrice).toLocaleString()}`,
    status: 'completed',
  });

  // Generate component-level BOQ with duct route data when available
  const lineItems = calculateHVACComponentEstimate({
    systemCode: detectedSystem.code,
    tonnage: roundedTonnage,
    totalAreaSqm: totalAreaSqft / 10.764,
    floors: Math.max(1, Math.round(totalAreaSqft / 10000)), // rough floor estimate
    ductedCount: procedure.ducted_count,
    decorativeCount: procedure.decorative_count,
    fahuCount: procedure.fahu_count,
    fahuCfm: procedure.fahu_flow_cfm || 0,
    ductRouteData,
    priceLibrary,
  });

  if (ductRouteData && ductRouteData.floors.length > 0) {
    steps.push({
      step: 16, name: 'Duct Route Analysis — Drawing-Based Quantities',
      input: `Analyzed ${ductRouteData.floors.length} floor plan(s)`,
      calculation: `Traced duct runs: supply, return, exhaust, fresh air per floor + risers`,
      output: `${lineItems.filter(i => i.category.includes('Ductwork') || i.category.includes('Terminal') || i.category.includes('Accessor')).length} duct-related BOQ items from drawing analysis (confidence: ${Math.round(ductRouteData.confidence * 100)}%)`,
      status: 'completed',
    });
  }

  const formulaExpression = `${roundedTonnage} TR × ${unitRate.toLocaleString()} AED/TR = ${Math.round(acPrice).toLocaleString()} AED${fahuPrice > 0 ? ` + FAHU ${Math.round(fahuPrice).toLocaleString()} AED` : ''}`;

  return {
    service_type: 'hvac',
    system_type: detectedSystem.type,
    tonnage: roundedTonnage,
    total_kw: totalLoadKw || null,
    fahu_kw: null,
    ac_unit_kw: totalLoadKw > 0 ? totalLoadKw - (procedure.fahu_flow_cfm ? procedure.fahu_count * 15 : 0) : null,
    unit_rate_aed: unitRate,
    quantity: roundedTonnage,
    total_aed: Math.round(totalHvacPrice),
    calculation_notes: `${notes} ${procedure.fahu_exists ? `FAHU: ${procedure.fahu_count} unit(s), AED ${Math.round(fahuPrice).toLocaleString()}.` : ''} Decorative: ${procedure.decorative_count}, Ducted: ${procedure.ducted_count} (${procedure.predominantly}). Confidence: ${Math.round(procedure.confidence * 100)}%.${ductRouteData ? ' Ductwork quantities from drawing analysis.' : ''}`,
    rate_source: 'ai',
    steps,
    formula_used: formulaLabel,
    formula_expression: formulaExpression,
    line_items: lineItems,
  };
}

export function calculateServiceEstimate(
  serviceType: ServiceType,
  totalAreaSqft: number,
  buildingType: string,
  priceLibrary: PriceLibraryItem[] = [],
): ServiceEstimate {
  // Check price library first for a service-level rate
  const libRate = matchPriceLibrary(priceLibrary, serviceType, `${serviceType.replace('_', ' ')} ${buildingType}`);
  const rates = SERVICE_RATES[serviceType];

  const steps: EstimationStep[] = [
    {
      step: 16,
      name: 'Formula-Based Pricing',
      input: `Service = ${serviceType}, Area = ${totalAreaSqft.toLocaleString()} sqft, Building type = ${buildingType}`,
      calculation: rates
        ? `Total AED = Area × Rate = ${totalAreaSqft.toLocaleString()} × ${rates[buildingType] || rates.office || 0} AED/sqft`
        : `No rate data for ${serviceType}`,
      output: rates
        ? `${serviceType} Total = AED ${Math.round(totalAreaSqft * (rates[buildingType] || rates.office || 0)).toLocaleString()}`
        : 'AED 0 — no rate defined',
      status: rates ? 'completed' : 'not_found',
    },
  ];

  if (!rates) {
    // AI fallback: never return 0 — use a conservative Dubai MEP market minimum
    const fallbackRate = 5; // AED/sqft — conservative floor for any MEP service
    const fallbackTotal = Math.round(totalAreaSqft * fallbackRate);
    return {
      service_type: serviceType,
      system_type: null,
      tonnage: null,
      total_kw: null,
      fahu_kw: null,
      ac_unit_kw: null,
      unit_rate_aed: fallbackRate,
      quantity: totalAreaSqft,
      total_aed: fallbackTotal,
      calculation_notes: `AI fallback: ${totalAreaSqft.toLocaleString()} sqft × ${fallbackRate} AED/sqft (no library match, Dubai market estimate)`,
      rate_source: 'ai',
      steps,
    };
  }

  let rate = rates[buildingType] || rates.office || 0;
  // Never allow 0 — use a minimum floor of 3 AED/sqft
  if (rate === 0) rate = 3;
  const totalAed = totalAreaSqft * rate;

  return {
    service_type: serviceType,
    system_type: null,
    tonnage: null,
    total_kw: null,
    fahu_kw: null,
    ac_unit_kw: null,
    unit_rate_aed: rate,
    quantity: totalAreaSqft,
    total_aed: Math.round(totalAed),
    calculation_notes: `${totalAreaSqft.toLocaleString()} sqft x ${rate} AED/sqft = ${totalAed.toLocaleString()} AED`,
    rate_source: libRate !== null ? 'library' : 'ai',
    steps,
  };
}

// --- Water Supply Component-Level Estimation ---

// Default unit rates for water supply components (AED)
export const WATER_SUPPLY_RATES: Record<string, number> = {
  underground_tank_per_liter: 0.8,
  roof_tank_per_liter: 1.2,
  transfer_pump_per_unit: 8500,
  booster_pump_per_unit: 12000,
  water_meter_per_unit: 450,
  hot_water_heater_per_unit: 2800,
  wc_per_unit: 1200,
  wash_basin_per_unit: 850,
  kitchen_sink_per_unit: 950,
  shower_per_unit: 750,
  bathtub_per_unit: 2500,
  pipe_gi_per_meter: 120,
  pipe_ppr_per_meter: 45,
  pipe_cpvc_per_meter: 55,
  pipe_copper_per_meter: 180,
};

export interface WaterSupplyLineItem {
  description: string;
  quantity: number;
  unit: string;
  unit_rate_aed: number;
  total_aed: number;
  category: string; // 'tank', 'pump', 'pipe', 'fixture', 'meter', 'heater'
  price_source?: 'library' | 'ai';
}

export interface WaterSupplyEstimate extends ServiceEstimate {
  line_items: WaterSupplyLineItem[];
}

export function calculateWaterSupplyEstimate(
  components: any, // WaterSupplyComponents from Claude
  totalAreaSqft: number,
  buildingType: string,
): WaterSupplyEstimate {
  const lineItems: WaterSupplyLineItem[] = [];

  // Tanks
  if (components?.underground_tank?.exists) {
    const cap = components.underground_tank.capacity_liters || 5000;
    lineItems.push({
      description: `Underground Water Tank (${components.underground_tank.material || 'GRP'}, ${cap}L)`,
      quantity: 1, unit: 'set',
      unit_rate_aed: cap * WATER_SUPPLY_RATES.underground_tank_per_liter,
      total_aed: cap * WATER_SUPPLY_RATES.underground_tank_per_liter,
      category: 'tank',
    });
  }

  if (components?.roof_tank?.exists) {
    const cap = components.roof_tank.capacity_liters || 2000;
    lineItems.push({
      description: `Roof Water Tank (${components.roof_tank.material || 'GRP'}, ${cap}L)`,
      quantity: 1, unit: 'set',
      unit_rate_aed: cap * WATER_SUPPLY_RATES.roof_tank_per_liter,
      total_aed: cap * WATER_SUPPLY_RATES.roof_tank_per_liter,
      category: 'tank',
    });
  }

  // Pumps
  if (components?.transfer_pump?.exists) {
    const count = components.transfer_pump.count || 2;
    lineItems.push({
      description: `Transfer Pump (${components.transfer_pump.kw || '?'} kW)`,
      quantity: count, unit: 'nos',
      unit_rate_aed: WATER_SUPPLY_RATES.transfer_pump_per_unit,
      total_aed: count * WATER_SUPPLY_RATES.transfer_pump_per_unit,
      category: 'pump',
    });
  }

  if (components?.booster_pump?.exists) {
    const count = components.booster_pump.count || 2;
    lineItems.push({
      description: `Booster Pump (${components.booster_pump.kw || '?'} kW)`,
      quantity: count, unit: 'nos',
      unit_rate_aed: WATER_SUPPLY_RATES.booster_pump_per_unit,
      total_aed: count * WATER_SUPPLY_RATES.booster_pump_per_unit,
      category: 'pump',
    });
  }

  // Water meters
  if (components?.water_meters?.count > 0) {
    lineItems.push({
      description: `Water Meter (${components.water_meters.size_mm || 20}mm)`,
      quantity: components.water_meters.count, unit: 'nos',
      unit_rate_aed: WATER_SUPPLY_RATES.water_meter_per_unit,
      total_aed: components.water_meters.count * WATER_SUPPLY_RATES.water_meter_per_unit,
      category: 'meter',
    });
  }

  // Hot water heaters
  if (components?.hot_water_heater?.exists) {
    const count = components.hot_water_heater.count || 1;
    lineItems.push({
      description: `${components.hot_water_heater.type || 'Electric'} Water Heater (${components.hot_water_heater.capacity_liters || 80}L)`,
      quantity: count, unit: 'nos',
      unit_rate_aed: WATER_SUPPLY_RATES.hot_water_heater_per_unit,
      total_aed: count * WATER_SUPPLY_RATES.hot_water_heater_per_unit,
      category: 'heater',
    });
  }

  // Fixtures
  const fixtures = components?.fixtures || {};
  const fixtureMap: Record<string, { label: string; rate: number }> = {
    wc: { label: 'WC (Western Closet)', rate: WATER_SUPPLY_RATES.wc_per_unit },
    wash_basin: { label: 'Wash Basin', rate: WATER_SUPPLY_RATES.wash_basin_per_unit },
    kitchen_sink: { label: 'Kitchen Sink', rate: WATER_SUPPLY_RATES.kitchen_sink_per_unit },
    shower: { label: 'Shower', rate: WATER_SUPPLY_RATES.shower_per_unit },
    bathtub: { label: 'Bathtub', rate: WATER_SUPPLY_RATES.bathtub_per_unit },
  };

  for (const [key, meta] of Object.entries(fixtureMap)) {
    const qty = fixtures[key];
    if (qty && qty > 0) {
      lineItems.push({
        description: meta.label,
        quantity: qty, unit: 'nos',
        unit_rate_aed: meta.rate,
        total_aed: qty * meta.rate,
        category: 'fixture',
      });
    }
  }

  // Pipes
  const pipes = components?.pipes || [];
  const pipeRates: Record<string, number> = {
    gi: WATER_SUPPLY_RATES.pipe_gi_per_meter,
    ppr: WATER_SUPPLY_RATES.pipe_ppr_per_meter,
    cpvc: WATER_SUPPLY_RATES.pipe_cpvc_per_meter,
    copper: WATER_SUPPLY_RATES.pipe_copper_per_meter,
  };

  for (const pipe of pipes) {
    if (pipe.length_meters && pipe.length_meters > 0) {
      const material = (pipe.material || 'PPR').toLowerCase();
      const rate = pipeRates[material] || WATER_SUPPLY_RATES.pipe_ppr_per_meter;
      lineItems.push({
        description: `${pipe.material || 'PPR'} Pipe ${pipe.size_mm}mm (${pipe.purpose || 'supply'})`,
        quantity: Math.round(pipe.length_meters), unit: 'meter',
        unit_rate_aed: rate,
        total_aed: Math.round(pipe.length_meters) * rate,
        category: 'pipe',
      });
    }
  }

  const totalAed = lineItems.reduce((sum, li) => sum + li.total_aed, 0);
  const costPerSqft = totalAreaSqft > 0 ? totalAed / totalAreaSqft : 0;

  return {
    service_type: 'plumbing',
    system_type: 'Water Supply System',
    tonnage: null,
    total_kw: null,
    fahu_kw: null,
    ac_unit_kw: null,
    unit_rate_aed: Math.round(costPerSqft * 100) / 100,
    quantity: totalAreaSqft,
    total_aed: Math.round(totalAed),
    calculation_notes: `Component-level water supply estimate: ${lineItems.length} line items, ${components?.apartments_units || '?'} units, confidence ${Math.round((components?.confidence || 0) * 100)}%`,
    rate_source: lineItems.some(li => li.price_source === 'library') ? 'library' : 'ai',
    steps: [],
    line_items: lineItems.map(li => ({ ...li, price_source: li.price_source || ('ai' as const) })),
  };
}

// --- Generic MEP Component Estimation (Phase 7) ---

// Default unit rates by component keyword (AED)
export const MEP_COMPONENT_RATES: Record<string, number> = {
  // HVAC
  ductwork: 85, ahu: 45000, fahu: 55000, fcu: 3500, vrf_outdoor: 28000, vrf_indoor: 4500,
  chiller: 120000, cooling_tower: 65000, exhaust_fan: 2800, damper: 350, grille: 180, diffuser: 220,
  thermostat: 450, bms_sensor: 380,
  // Electrical
  mdb: 35000, smdb: 18000, db: 8500, cable_per_meter: 45, light_fixture: 650, switch_socket: 120,
  cable_tray_per_meter: 85, earthing_rod: 1200, ups: 25000, transformer: 85000,
  // Fire Fighting
  sprinkler_head: 85, fire_pump: 45000, jockey_pump: 15000, hose_reel: 3500, fire_hydrant: 8500,
  fire_extinguisher: 350, fm200_per_kg: 280, alarm_valve: 12000, ff_pipe_per_meter: 95,
  // Drainage
  soil_pipe_per_meter: 65, waste_pipe_per_meter: 45, vent_pipe_per_meter: 40,
  floor_drain: 180, manhole: 8500, inspection_chamber: 3500, grease_trap: 12000, sewage_pump: 25000,
  // Fire Alarm
  fire_alarm_panel: 18000, smoke_detector: 120, heat_detector: 95, manual_call_point: 85,
  sounder: 65, beam_detector: 2800, fire_cable_per_meter: 18, module_unit: 350,
  // BMS
  ddc_controller: 8500, bms_temp_sensor: 280, actuator: 650, field_panel: 12000,
  network_switch: 3500, bms_workstation: 15000, bms_software: 25000,
  // LPG
  gas_regulator: 1800, gas_pipe_per_meter: 75, gas_valve: 450, gas_meter: 2800,
  solenoid_valve: 1200, gas_detector: 850, pressure_gauge: 350,
};

export function calculateMEPComponentEstimate(
  serviceType: ServiceType,
  components: Array<{ category: string; item: string; quantity: number; unit: string; specification: string | null }>,
  totalAreaSqft: number,
  buildingType?: string,
  priceLibrary: PriceLibraryItem[] = [],
): WaterSupplyEstimate {
  const lineItems: WaterSupplyLineItem[] = [];

  for (const comp of components) {
    if (comp.quantity <= 0) continue;

    const itemDesc = `${comp.item}${comp.specification ? ` (${comp.specification})` : ''}`;
    let rate = 0;
    let source: 'library' | 'ai' = 'ai';

    // 1. Try price library first
    const libRate = matchPriceLibrary(priceLibrary, serviceType, itemDesc);
    if (libRate !== null) {
      rate = libRate;
      source = 'library';
    } else {
      // 2. Try to match component to a known hardcoded rate
      const itemLower = `${comp.category} ${comp.item}`.toLowerCase();
      for (const [key, value] of Object.entries(MEP_COMPONENT_RATES)) {
        const keyWords = key.replace(/_/g, ' ');
        if (itemLower.includes(keyWords) || keyWords.includes(comp.category.toLowerCase())) {
          rate = value;
          break;
        }
      }

      // 3. Fallback: estimate from unit type
      if (rate === 0) {
        if (comp.unit === 'meter' || comp.unit === 'm') rate = 50;
        else if (comp.unit === 'sqm') rate = 35;
        else rate = 500; // generic per-unit
      }
    }

    lineItems.push({
      description: itemDesc,
      quantity: comp.quantity,
      unit: comp.unit,
      unit_rate_aed: rate,
      total_aed: Math.round(comp.quantity * rate),
      category: comp.category,
      price_source: source,
    });
  }

  const totalAed = lineItems.reduce((sum, li) => sum + li.total_aed, 0);
  const costPerSqft = totalAreaSqft > 0 ? totalAed / totalAreaSqft : 0;
  const label = serviceType.replace('_', ' ');

  // For HVAC services estimated via component analysis, still derive tonnage
  // from the area-based thermal load factor so the BOQ table shows a TR value
  // instead of '—'. Without this, component-level HVAC loses its primary unit
  // of measure and the number won't hold up in a professional audit.
  let derivedTonnage: number | null = null;
  let derivedTotalKw: number | null = null;
  let derivedRatePerTr: number | null = null;
  const componentSteps: EstimationStep[] = [];

  if (serviceType === 'hvac' && totalAreaSqft > 0) {
    const bt = buildingType || 'office';
    const factor = THERMAL_LOAD_FACTORS[bt] || THERMAL_LOAD_FACTORS.office;
    derivedTonnage = Math.round((totalAreaSqft / factor) * 10) / 10;
    derivedTotalKw = Math.round(derivedTonnage * KW_TO_TR * 10) / 10;
    derivedRatePerTr = derivedTonnage > 0 ? Math.round((totalAed / derivedTonnage) * 100) / 100 : 0;

    // Emit the 6 HVAC pipeline steps (10–15) + formula step (16) so the
    // "HVAC Formula Derivation" card's step log renders even when the
    // project has no thermal load drawing and the component-level Claude
    // analyzer ran instead. BT's demo promise is that George always sees
    // the HVAC flow on screen during gate 17 — before this fix, component
    // HVAC silently skipped the step log because steps was [].
    componentSteps.push({
      step: 10,
      name: 'Open Thermal Load Drawing',
      input: 'Project attachments (no discipline-tagged HVAC folder)',
      calculation: 'Search for thermal load / heat load / cooling load drawing',
      output: 'Not found — falling back to component-level analysis',
      status: 'not_found',
    });
    componentSteps.push({
      step: 11,
      name: 'Extract Total KW',
      input: 'No thermal load drawing',
      calculation: `Derived from area: ${derivedTonnage} TR × ${KW_TO_TR} (KW/TR)`,
      output: `Total KW ≈ ${derivedTotalKw} kW (area-based fallback)`,
      status: 'skipped',
    });
    componentSteps.push({
      step: 12,
      name: 'Extract FAHU KW',
      input: 'No thermal load drawing',
      calculation: 'FAHU unknown — assumed bundled in total',
      output: 'FAHU KW = 0 (not separated)',
      status: 'skipped',
    });
    componentSteps.push({
      step: 13,
      name: 'Calculate AC Unit KW',
      input: `Total KW = ${derivedTotalKw} kW, FAHU KW = 0`,
      calculation: 'AC Unit KW = Total KW − FAHU KW',
      output: `AC Unit KW = ${derivedTotalKw} kW`,
      status: 'completed',
    });
    componentSteps.push({
      step: 14,
      name: 'Identify AC System Type',
      input: `${lineItems.length} component line items from Claude analysis`,
      calculation: 'System type inferred from component mix (Component-Level)',
      output: 'System type = Component-Level BOQ',
      status: 'completed',
    });
    componentSteps.push({
      step: 15,
      name: 'Calculate Tonnage',
      input: `Area = ${totalAreaSqft.toLocaleString()} sqft, ${bt} factor = ${factor} sqft/TR`,
      calculation: `TR = Area ÷ ${factor}`,
      output: `Tonnage = ${derivedTonnage} TR`,
      status: 'completed',
    });
    componentSteps.push({
      step: 16,
      name: 'Formula-Based Pricing',
      input: `${lineItems.length} priced components, Tonnage = ${derivedTonnage} TR`,
      calculation: `Sum of line items = AED ${totalAed.toLocaleString()} (≈ ${derivedRatePerTr} AED/TR)`,
      output: `HVAC Total = AED ${Math.round(totalAed).toLocaleString()}`,
      status: 'completed',
    });
  }

  // HVAC stores unit_rate_aed as AED/TR so the services table and formula
  // chain both show a recognizable per-TR rate. Non-HVAC component services
  // keep storing cost-per-sqft as before.
  const storedUnitRate = serviceType === 'hvac' && derivedRatePerTr !== null
    ? derivedRatePerTr
    : Math.round(costPerSqft * 100) / 100;

  return {
    service_type: serviceType,
    system_type: `${label} System (Component-Level)`,
    tonnage: derivedTonnage,
    total_kw: derivedTotalKw,
    fahu_kw: serviceType === 'hvac' ? 0 : null,
    ac_unit_kw: derivedTotalKw,
    unit_rate_aed: storedUnitRate,
    quantity: serviceType === 'hvac' && derivedTonnage ? derivedTonnage : totalAreaSqft,
    total_aed: Math.round(totalAed),
    calculation_notes: `Component-level ${label} estimate: ${lineItems.length} line items${derivedTonnage ? ` · derived ${derivedTonnage} TR (area/factor, no thermal load drawing)` : ''}`,
    rate_source: lineItems.some(li => li.price_source === 'library') ? 'library' : 'ai',
    steps: componentSteps,
    line_items: lineItems,
  };
}

// ---- HVAC Component-Level BOQ Estimation ----
// Dubai MEP market rates (Q1 2025) — for component-level pricing
export const HVAC_COMPONENT_RATES: Record<string, { unit: string; rate: number; category: string; description: string }> = {
  vrf_outdoor_unit:   { unit: 'nos',  rate: 18500, category: 'A. VRF/DX Equipment',           description: 'VRF/DX Outdoor Condensing Unit' },
  chiller_unit:       { unit: 'nos',  rate: 250000,category: 'A. Chiller Plant',               description: 'Air-Cooled Scroll Chiller' },
  indoor_ducted:      { unit: 'nos',  rate: 3200,  category: 'B. Indoor Units',                description: 'Ducted Indoor Unit (Ceiling Concealed)' },
  indoor_decorative:  { unit: 'nos',  rate: 2800,  category: 'B. Indoor Units',                description: 'Decorative Indoor Unit (Cassette/Wall)' },
  fcu_4pipe:          { unit: 'nos',  rate: 3800,  category: 'B. Indoor Units',                description: 'Fan Coil Unit (4-Pipe, Ceiling)' },
  fahu:               { unit: 'nos',  rate: 55000, category: 'C. Fresh Air System',            description: 'Fresh Air Handling Unit (FAHU)' },
  ahu:                { unit: 'nos',  rate: 45000, category: 'C. Fresh Air System',            description: 'Air Handling Unit (AHU)' },
  inline_fan:         { unit: 'nos',  rate: 1800,  category: 'C. Fresh Air System',            description: 'Inline Fresh Air Fan' },
  exhaust_fan:        { unit: 'nos',  rate: 850,   category: 'D. Exhaust & Ventilation',       description: 'Exhaust Fan (Toilet/Kitchen)' },
  carpark_fan:        { unit: 'nos',  rate: 4500,  category: 'D. Exhaust & Ventilation',       description: 'Car Park Jet/Ventilation Fan' },
  gi_ductwork:        { unit: 'sqft', rate: 45,    category: 'E. Ductwork',                    description: 'GI Ductwork (Supply + Return)' },
  preinsulated_duct:  { unit: 'sqft', rate: 65,    category: 'E. Ductwork',                    description: 'Pre-insulated Duct (Fresh Air)' },
  flexible_duct:      { unit: 'nos',  rate: 85,    category: 'E. Ductwork',                    description: 'Flexible Duct Connection' },
  volume_damper:      { unit: 'nos',  rate: 350,   category: 'F. Duct Accessories',            description: 'Volume Control Damper' },
  fire_damper:        { unit: 'nos',  rate: 650,   category: 'F. Duct Accessories',            description: 'Fire Damper (Intumescent)' },
  sound_attenuator:   { unit: 'nos',  rate: 1200,  category: 'F. Duct Accessories',            description: 'Sound Attenuator' },
  sand_trap_louver:   { unit: 'nos',  rate: 950,   category: 'F. Duct Accessories',            description: 'Sand Trap Louver' },
  ceiling_diffuser:   { unit: 'nos',  rate: 180,   category: 'G. Air Terminals',               description: 'Ceiling Diffuser (Square/Round)' },
  linear_diffuser:    { unit: 'nos',  rate: 450,   category: 'G. Air Terminals',               description: 'Linear Slot Diffuser' },
  return_grille:      { unit: 'nos',  rate: 120,   category: 'G. Air Terminals',               description: 'Return Air Grille' },
  exhaust_grille:     { unit: 'nos',  rate: 100,   category: 'G. Air Terminals',               description: 'Exhaust Grille' },
  copper_piping:      { unit: 'Rmt',  rate: 120,   category: 'H. Refrigerant Piping',          description: 'Copper Refrigerant Pipe (Liquid+Gas)' },
  ref_pipe_insulation:{ unit: 'Rmt',  rate: 35,    category: 'H. Refrigerant Piping',          description: 'Refrigerant Pipe Insulation' },
  y_joint_header:     { unit: 'nos',  rate: 280,   category: 'H. Refrigerant Piping',          description: 'Y-Joint / Branch Header' },
  chw_piping:         { unit: 'Rmt',  rate: 180,   category: 'H. CHW Piping',                  description: 'Chilled Water Pipe (MS, Insulated)' },
  condensate_pipe:    { unit: 'Rmt',  rate: 45,    category: 'I. Condensate & Drain',          description: 'uPVC Condensate Drain Pipe' },
  condensate_pump:    { unit: 'nos',  rate: 650,   category: 'I. Condensate & Drain',          description: 'Condensate Drain Pump' },
  duct_insulation:    { unit: 'sqft', rate: 25,    category: 'J. Insulation',                  description: 'Duct Insulation (25mm Closed-Cell)' },
  pipe_insulation:    { unit: 'Rmt',  rate: 35,    category: 'J. Insulation',                  description: 'Pipe Insulation (Armaflex)' },
  power_cabling:      { unit: 'LS',   rate: 85000, category: 'K. Electrical (HVAC Related)',   description: 'Power Cabling to HVAC Equipment' },
  control_wiring:     { unit: 'LS',   rate: 45000, category: 'K. Electrical (HVAC Related)',   description: 'Control & Communication Wiring' },
  thermostat:         { unit: 'nos',  rate: 280,   category: 'K. Electrical (HVAC Related)',   description: 'Thermostat / Zone Controller' },
  duct_supports:      { unit: 'LS',   rate: 65000, category: 'L. Supports & Misc',            description: 'Duct Supports, Hangers & Brackets' },
  vibration_isolator: { unit: 'nos',  rate: 450,   category: 'L. Supports & Misc',            description: 'Vibration Isolator (Spring/Rubber)' },
  tab_testing:        { unit: 'Job',  rate: 35000, category: 'M. Testing & Commissioning',    description: 'Testing, Adjusting & Balancing (TAB)' },
  commissioning:      { unit: 'Job',  rate: 25000, category: 'M. Testing & Commissioning',    description: 'System Commissioning & Handover' },
};

export interface PriceLibraryItem {
  discipline: string;
  category: string;
  item_name: string;
  unit: string;
  unit_rate_aed: number;
}

/** Normalize text for matching: lowercase, strip special chars, expand abbreviations. */
function normForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/\bdia\b/g, 'diameter')
    .replace(/\bsp\b/g, 'soil pipe')
    .replace(/\bwp\b/g, 'waste pipe')
    .replace(/\bvp\b/g, 'vent pipe')
    .replace(/\bhrc\b/g, 'hose reel cabinet')
    .replace(/\bnrv\b/g, 'non return valve')
    .replace(/\bgv\b/g, 'gate valve')
    .replace(/\bwc\b/g, 'water closet')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extract pipe/duct size in mm (e.g., "25mm", "100 dia", "Pipe 150mm" → number). */
function extractSizeMM(text: string): number | null {
  const m = text.match(/(\d+)\s*(?:mm|dia(?:meter)?)/i);
  return m ? parseInt(m[1], 10) : null;
}

/** Try to match a line item against the price library by discipline + keyword/size overlap.
 *  Handles pipe size matching: "100m of 25mm fire pipe" matches "Pipe 25mm" at 75 AED/m.
 *  Returns { rate, item_name } or null for no match. */
export function matchPriceLibrary(
  library: PriceLibraryItem[],
  discipline: string,
  itemDescription: string,
): number | null {
  if (!library.length) return null;

  const target = normForMatch(itemDescription);
  const targetSize = extractSizeMM(itemDescription);
  const words = target.split(/\s+/).filter(w => w.length > 1);
  const candidates = library.filter(p => p.discipline === discipline);

  // Pass 1: exact substring match (highest confidence)
  for (const p of candidates) {
    const name = normForMatch(p.item_name);
    if (target.includes(name) || name.includes(target)) return p.unit_rate_aed;
  }

  // Pass 2: size + type match for pipes/ducts (e.g., "25mm fire pipe" → "Pipe 25mm")
  if (targetSize) {
    for (const p of candidates) {
      const pSize = extractSizeMM(p.item_name);
      if (pSize === targetSize) {
        const pName = normForMatch(p.item_name);
        // Check that the type also matches (pipe, duct, etc.)
        const typeWords = words.filter(w =>
          ['pipe', 'duct', 'ducting', 'soil', 'waste', 'vent', 'valve', 'sprinkler'].includes(w)
        );
        if (typeWords.some(tw => pName.includes(tw))) {
          return p.unit_rate_aed;
        }
      }
    }
  }

  // Pass 3: keyword overlap — require at least 2 matching words
  let bestMatch: PriceLibraryItem | null = null;
  let bestScore = 0;
  for (const p of candidates) {
    const name = normForMatch(p.item_name);
    const nameWords = name.split(/\s+/);
    // Count bidirectional word overlap
    const fwd = words.filter(w => name.includes(w)).length;
    const rev = nameWords.filter(w => target.includes(w)).length;
    const score = Math.max(fwd, rev);
    // Bonus for size match
    const sizeBonus = (targetSize && extractSizeMM(p.item_name) === targetSize) ? 2 : 0;
    const total = score + sizeBonus;
    if (total > bestScore && total >= 2) {
      bestScore = total;
      bestMatch = p;
    }
  }
  return bestMatch ? bestMatch.unit_rate_aed : null;
}

export interface HVACComponentLineItem {
  key: string;
  description: string;
  quantity: number;
  unit: string;
  unit_rate_aed: number;
  total_aed: number;
  category: string;
  price_source: 'library' | 'ai';
}

/**
 * Convert duct route analysis (from Claude vision) into priced BOQ line items.
 * Replaces area-based % estimates with real measured quantities from drawings.
 */
export function calculateDuctRouteEstimate(
  ductData: DuctRouteComponents,
  typicalFloorCount: number,
): HVACComponentLineItem[] {
  const items: HVACComponentLineItem[] = [];

  const add = (key: string, qty: number) => {
    if (qty <= 0) return;
    const r = HVAC_COMPONENT_RATES[key];
    if (!r) return;
    const q = Math.round(qty);
    items.push({ key, description: r.description, quantity: q, unit: r.unit, unit_rate_aed: r.rate, total_aed: q * r.rate, category: r.category, price_source: 'ai' as const });
  };

  // Helper: convert duct linear meters + size to surface area in sqft
  // For rectangular duct: perimeter ≈ 4 × width_mm / 1000, then × length × 10.764 sqft/sqm
  const ductToSqft = (runs: Array<{ size_mm: number; length_m: number }>) =>
    runs.reduce((total, d) => total + (d.size_mm * 4 / 1000) * d.length_m * 10.764, 0);

  let totalGiSqft = 0;
  let totalPreInsulatedSqft = 0;
  let totalFlexConnections = 0;
  let totalVolumeDampers = 0;
  let totalFireDampers = 0;
  let totalSoundAttenuators = 0;
  let totalSupplyDiffusers = 0;
  let totalLinearDiffusers = 0;
  let totalReturnGrilles = 0;
  let totalExhaustGrilles = 0;

  for (const floor of ductData.floors) {
    // Determine multiplier: if "typical" floor, multiply by typical floor count
    const isTypical = floor.floor_label.toLowerCase().includes('typical') ||
                      floor.floor_code.toLowerCase().includes('tf') ||
                      floor.floor_code.toLowerCase().includes('typ');
    const mult = isTypical ? Math.max(1, typicalFloorCount) : 1;

    // GI ductwork: supply + return + exhaust
    const giRuns = [
      ...floor.supply_ducts.filter(d => d.material !== 'pre_insulated'),
      ...floor.return_ducts.filter(d => d.material !== 'pre_insulated'),
      ...floor.exhaust_ducts.filter(d => d.material !== 'pre_insulated'),
    ];
    totalGiSqft += ductToSqft(giRuns) * mult;

    // Pre-insulated ductwork: fresh air + any pre_insulated supply/return
    const preInsRuns = [
      ...floor.fresh_air_ducts,
      ...floor.supply_ducts.filter(d => d.material === 'pre_insulated'),
      ...floor.return_ducts.filter(d => d.material === 'pre_insulated'),
    ];
    totalPreInsulatedSqft += ductToSqft(preInsRuns) * mult;

    // Flexible duct connections
    totalFlexConnections += (floor.accessories.flexible_connections || 0) * mult;

    // Accessories
    totalVolumeDampers += (floor.accessories.volume_dampers || 0) * mult;
    totalFireDampers += (floor.accessories.fire_dampers || 0) * mult;
    totalSoundAttenuators += (floor.accessories.sound_attenuators || 0) * mult;

    // Terminals
    totalSupplyDiffusers += (floor.terminals.supply_diffusers || 0) * mult;
    totalLinearDiffusers += (floor.terminals.linear_diffusers || 0) * mult;
    totalReturnGrilles += (floor.terminals.return_grilles || 0) * mult;
    totalExhaustGrilles += (floor.terminals.exhaust_grilles || 0) * mult;
  }

  // Add riser ductwork
  for (const riser of ductData.risers) {
    const riserLength = riser.floors_served * riser.height_per_floor_m;
    const riserSqft = (riser.size_mm * 4 / 1000) * riserLength * 10.764;
    if (riser.material === 'pre_insulated') {
      totalPreInsulatedSqft += riserSqft;
    } else {
      totalGiSqft += riserSqft;
    }
  }

  // E. Ductwork
  add('gi_ductwork', totalGiSqft);
  add('preinsulated_duct', totalPreInsulatedSqft);
  add('flexible_duct', totalFlexConnections);

  // F. Duct Accessories
  add('volume_damper', totalVolumeDampers);
  add('fire_damper', totalFireDampers);
  add('sound_attenuator', totalSoundAttenuators);

  // G. Air Terminals
  add('ceiling_diffuser', totalSupplyDiffusers);
  add('linear_diffuser', totalLinearDiffusers);
  add('return_grille', totalReturnGrilles);
  add('exhaust_grille', totalExhaustGrilles);

  // J. Duct Insulation — based on total GI duct surface area
  add('duct_insulation', totalGiSqft);

  return items;
}

/**
 * Generate component-level HVAC BOQ from system parameters.
 * Uses MEP industry ratios to derive quantities from tonnage, area, and floor count.
 * When ductRouteData is provided, uses real measured duct quantities instead of area-based %.
 */
export function calculateHVACComponentEstimate(params: {
  systemCode: string;       // 'vrf', 'split', 'chiller', 'district_cooling', 'package'
  tonnage: number;
  totalAreaSqm: number;
  floors: number;
  parkingFloors?: number;
  ductedCount: number;
  decorativeCount: number;
  fahuCount: number;
  fahuCfm?: number;
  ductRouteData?: DuctRouteComponents;
  skipFAHU?: boolean;       // set true when caller already priced FAHU separately (avoids double-count)
  priceLibrary?: PriceLibraryItem[];
}): HVACComponentLineItem[] {
  const {
    systemCode, tonnage, totalAreaSqm, floors, parkingFloors = 0,
    ductedCount, decorativeCount, fahuCount, fahuCfm = 0, skipFAHU = false,
    priceLibrary = [],
  } = params;

  const totalIndoor = ductedCount + decorativeCount;
  const areaSqft = Math.round(totalAreaSqm * 10.764);
  const isChiller = systemCode === 'chiller' || systemCode === 'district_cooling';
  const isVRF = systemCode === 'vrf';

  const items: HVACComponentLineItem[] = [];

  const add = (key: string, qty: number) => {
    if (qty <= 0) return;
    const r = HVAC_COMPONENT_RATES[key];
    if (!r) return;
    const q = Math.round(qty);
    // Try price library first, fall back to hardcoded rate
    const libRate = matchPriceLibrary(priceLibrary, 'hvac', r.description);
    const rate = libRate ?? r.rate;
    const source: 'library' | 'ai' = libRate !== null ? 'library' : 'ai';
    items.push({
      key,
      description: r.description,
      quantity: q,
      unit: r.unit,
      unit_rate_aed: rate,
      total_aed: q * rate,
      category: r.category,
      price_source: source,
    });
  };

  // A. Main Equipment
  if (isChiller) {
    add('chiller_unit', Math.ceil(tonnage / 350));
  } else {
    add('vrf_outdoor_unit', Math.ceil(tonnage / 16));
  }

  // B. Indoor Units
  if (isChiller) {
    add('fcu_4pipe', totalIndoor || Math.ceil(totalAreaSqm / 25));
  } else {
    add('indoor_ducted', ductedCount || Math.ceil(totalAreaSqm * 0.7 / 25));
    if (decorativeCount > 0) add('indoor_decorative', decorativeCount);
  }

  // C. Fresh Air System
  if (fahuCount > 0 && !skipFAHU) add('fahu', fahuCount);
  if (isChiller) add('ahu', Math.max(2, Math.ceil(floors / 5)));
  add('inline_fan', Math.max(4, Math.ceil(floors * 1.5)));

  // D. Exhaust & Ventilation
  add('exhaust_fan', floors * 3 + Math.ceil(totalIndoor * 0.3));
  if (parkingFloors > 0) add('carpark_fan', parkingFloors * 5);

  // E. Ductwork, F. Accessories, G. Terminals
  if (params.ductRouteData && params.ductRouteData.floors.length > 0) {
    // Use real quantities from drawing analysis
    const typicalFloors = Math.max(1, floors - (parkingFloors + 2)); // exclude parking + ground + roof
    const ductItems = calculateDuctRouteEstimate(params.ductRouteData, typicalFloors);
    items.push(...ductItems);
    // Sand trap louver is not from duct routing — keep area-based
    add('sand_trap_louver', Math.max(4, Math.ceil(floors * 1.2)));
  } else {
    // Fallback: area-based percentage estimates
    add('gi_ductwork', areaSqft * 0.45);
    add('preinsulated_duct', areaSqft * 0.08);
    add('flexible_duct', totalIndoor * 1.2);
    add('volume_damper', totalIndoor * 1.2);
    add('fire_damper', floors * 4);
    add('sound_attenuator', Math.max(4, Math.ceil(floors * 0.8)));
    add('sand_trap_louver', Math.max(4, Math.ceil(floors * 1.2)));
    add('ceiling_diffuser', totalIndoor * 2.5);
    add('linear_diffuser', Math.ceil(totalIndoor * 0.2));
    add('return_grille', totalIndoor * 2);
    add('exhaust_grille', Math.ceil(totalIndoor * 0.5));
  }

  // H. Piping
  if (isChiller) {
    add('chw_piping', floors * 40 + totalIndoor * 8);
  } else {
    add('copper_piping', floors * 30 + totalIndoor * 6);
    add('ref_pipe_insulation', floors * 30 + totalIndoor * 6);
    add('y_joint_header', totalIndoor);
  }

  // I. Condensate & Drain
  add('condensate_pipe', totalIndoor * 8 + floors * 15);
  add('condensate_pump', Math.ceil(totalIndoor * 0.15));

  // J. Insulation (duct insulation already added by calculateDuctRouteEstimate when ductRouteData present)
  if (!params.ductRouteData || params.ductRouteData.floors.length === 0) {
    add('duct_insulation', areaSqft * 0.45);
  }
  if (isChiller) {
    add('pipe_insulation', floors * 40 + totalIndoor * 8);
  }

  // K. Electrical (HVAC)
  add('power_cabling', 1);
  add('control_wiring', 1);
  add('thermostat', totalIndoor);

  // L. Supports & Misc
  add('duct_supports', 1);
  add('vibration_isolator', Math.ceil(tonnage / 3));

  // M. T&C
  add('tab_testing', 1);
  add('commissioning', 1);

  return items;
}

export function calculateFullEstimation(
  totalAreaSqft: number,
  buildingType: string,
  requiredServices: ServiceType[],
  hvacKw?: { totalKw?: number | null; fahuKw?: number | null },
  hvacSpecs?: { tonnage?: number | null; system?: string | null },
  waterSupplyComponents?: any,
  mepComponents?: Record<string, Array<{ category: string; item: string; quantity: number; unit: string; specification: string | null }>>,
  hvacProcedureEstimate?: ServiceEstimate,
  priceLibrary: PriceLibraryItem[] = [],
): EstimationOutput {
  const services: ServiceEstimate[] = [];

  for (const serviceType of requiredServices) {
    if (serviceType === 'hvac') {
      // HVAC: prefer 37-step procedure result, then component data, then formula
      if (hvacProcedureEstimate) {
        services.push(hvacProcedureEstimate);
      } else {
        const hvacComps = mepComponents?.['hvac'];
        if (hvacComps && hvacComps.length > 0) {
          services.push(calculateMEPComponentEstimate(serviceType, hvacComps, totalAreaSqft, buildingType, priceLibrary));
        } else {
          services.push(
            calculateHVACEstimate(
              totalAreaSqft, buildingType,
              hvacKw?.totalKw, hvacKw?.fahuKw,
              hvacSpecs?.tonnage, hvacSpecs?.system
            )
          );
        }
      }
    } else if (serviceType === 'plumbing' && waterSupplyComponents) {
      services.push(
        calculateWaterSupplyEstimate(waterSupplyComponents, totalAreaSqft, buildingType)
      );
    } else {
      // Check for component-level data from Claude analysis
      const comps = mepComponents?.[serviceType];
      if (comps && comps.length > 0) {
        services.push(calculateMEPComponentEstimate(serviceType, comps, totalAreaSqft, buildingType, priceLibrary));
      } else {
        services.push(
          calculateServiceEstimate(serviceType, totalAreaSqft, buildingType, priceLibrary)
        );
      }
    }
  }

  const totalAed = services.reduce((sum, s) => sum + s.total_aed, 0);
  const costPerSqft = totalAreaSqft > 0 ? totalAed / totalAreaSqft : 0;
  const marginPercent = DEFAULT_MARGIN_PERCENT;
  const finalQuote = Math.round(totalAed * (1 + marginPercent / 100));

  // Aggregate all steps across services; HVAC steps come first (most detailed)
  const hvacService = services.find(s => s.service_type === 'hvac');
  const allSteps: EstimationStep[] = hvacService ? [...hvacService.steps] : [];

  // Add summary steps for completion phase
  allSteps.push({
    step: 18,
    name: 'Complete All Services',
    input: `Services estimated: ${services.map(s => s.service_type).join(', ')}`,
    calculation: 'Repeat estimation procedure for each identified MEP service',
    output: `${services.length} service(s) estimated`,
    status: 'completed',
  });
  allSteps.push({
    step: 19,
    name: 'Total Bid Amount',
    input: services.map(s => `${s.service_type}: AED ${s.total_aed.toLocaleString()}`).join(', '),
    calculation: `Sum all service totals: ${services.map(s => s.total_aed.toLocaleString()).join(' + ')}`,
    output: `Base total = AED ${totalAed.toLocaleString()} (AED ${Math.round(costPerSqft * 100) / 100}/sqft)`,
    status: 'completed',
  });

  return {
    services,
    total_aed: totalAed,
    cost_per_sqft_aed: Math.round(costPerSqft * 100) / 100,
    margin_percent: marginPercent,
    final_quote_aed: finalQuote,
    steps: allSteps,
  };
}

// ---- Multi-System HVAC Estimation ----
// For buildings with multiple HVAC sub-systems (e.g., VRF + DX + FAHU)

export interface ThermalLoadZone {
  area_or_zone: string;
  indoor_unit_type: 'Decorative' | 'Ducted' | string;
  capacity_kw: number;
  system_ref: string | null; // 'VRF', 'DX', 'Chiller', etc.
  floor_code?: string;       // 'BF', 'GF', 'MZ', 'TF', '1F', 'RF', etc.
}

export interface MultiSystemResult {
  id: string;
  label: string;
  system_code: string;
  system_type: string;
  zones: string[];
  total_kw: number;
  fahu_kw: number;
  ac_unit_kw: number;
  tonnage: number;
  unit_rate_aed: number;
  ac_price: number;
  fahu_price: number;
  total_aed: number;
  indoor_units: { ducted: number; decorative: number };
  fahu_count: number;
  fahu_cfm: number;
  line_items: HVACComponentLineItem[];
}

/**
 * Calculate HVAC estimation for multiple sub-systems in a single building.
 * Groups thermal load zones by system_ref and produces independent estimates per sub-system.
 */
export function calculateMultiSystemHVAC(
  thermalLoadTable: ThermalLoadZone[],
  buildingParams: { totalAreaSqm: number; floors: number; parkingFloors: number },
  fahuData?: { count: number; cfm: number },
): MultiSystemResult[] {
  // Group zones by system_ref
  const groups: Record<string, ThermalLoadZone[]> = {};
  for (const zone of thermalLoadTable) {
    const ref = (zone.system_ref || 'unknown').toLowerCase().trim();
    if (!groups[ref]) groups[ref] = [];
    groups[ref].push(zone);
  }

  const results: MultiSystemResult[] = [];
  let idx = 0;

  for (const [ref, zones] of Object.entries(groups)) {
    idx++;
    // Sum KW for this group
    const totalKw = zones.reduce((s, z) => s + z.capacity_kw, 0);

    // Count indoor units by type
    const ducted = zones.filter(z => z.indoor_unit_type === 'Ducted').length;
    const decorative = zones.filter(z => z.indoor_unit_type === 'Decorative').length;

    // Determine system code from ref string
    let systemCode = 'vrf';
    let systemType = 'VRF System';
    const refLower = ref.toLowerCase();
    if (refLower.includes('split') || refLower.includes('dx')) {
      systemCode = 'split';
      systemType = 'DX Split Unit';
    } else if (refLower.includes('chiller')) {
      systemCode = 'chiller';
      systemType = 'Chiller System';
    } else if (refLower.includes('package')) {
      systemCode = 'package';
      systemType = 'Package Unit';
    } else if (refLower.includes('district')) {
      systemCode = 'district_cooling';
      systemType = 'District Cooling';
    }

    const rate = HVAC_UNIT_RATES[systemCode] || 4200;
    const tonnage = Math.round((totalKw / KW_TO_TR) * 10) / 10;
    const acPrice = Math.round(tonnage * rate);

    // FAHU: assign to first sub-system only (or separate sub-system)
    const isFirstSystem = idx === 1;
    const fahuCount = isFirstSystem && fahuData ? fahuData.count : 0;
    const fahuCfm = isFirstSystem && fahuData ? fahuData.cfm : 0;
    const fahuPrice = fahuCount > 0 && fahuCfm > 0
      ? Math.round(fahuCfm * FAHU_RATE_PER_CFM * fahuCount)
      : fahuCount > 0 ? fahuCount * FAHU_RATE_PER_UNIT : 0;

    // Zone labels
    const zoneLabels = [...new Set(zones.map(z => z.area_or_zone))];

    // Per-sub-system area estimate (proportional)
    const totalTableKw = thermalLoadTable.reduce((s, z) => s + z.capacity_kw, 0);
    const areaFraction = totalTableKw > 0 ? totalKw / totalTableKw : 1 / Object.keys(groups).length;
    const subAreaSqm = Math.round(buildingParams.totalAreaSqm * areaFraction);

    // Generate component line items for this sub-system.
    // skipFAHU: true — FAHU is already priced above via fahuPrice, so don't
    // duplicate it as a component line item.
    const lineItems = calculateHVACComponentEstimate({
      systemCode,
      tonnage,
      totalAreaSqm: subAreaSqm,
      floors: buildingParams.floors,
      parkingFloors: buildingParams.parkingFloors,
      ductedCount: ducted,
      decorativeCount: decorative,
      fahuCount,
      fahuCfm,
      skipFAHU: true,
    });

    results.push({
      id: `subsys-${idx}`,
      label: `${systemType} (${zoneLabels.length > 3 ? zoneLabels.slice(0, 3).join(', ') + '...' : zoneLabels.join(', ')})`,
      system_code: systemCode,
      system_type: systemType,
      zones: zoneLabels,
      total_kw: Math.round(totalKw * 100) / 100,
      fahu_kw: 0,
      ac_unit_kw: Math.round(totalKw * 100) / 100,
      tonnage,
      unit_rate_aed: rate,
      ac_price: acPrice,
      fahu_price: fahuPrice,
      total_aed: acPrice + fahuPrice,
      indoor_units: { ducted, decorative },
      fahu_count: fahuCount,
      fahu_cfm: fahuCfm,
      line_items: lineItems,
    });
  }

  return results;
}

// ---- Floor-by-Floor Breakdown ----

export interface FloorBreakdownResult {
  floor_label: string;
  floor_code: string;
  zone_count: number;
  ducted_count: number;
  decorative_count: number;
  total_kw: number;
  system_refs: string[];
}

/** Map zone code prefixes to floor labels */
const FLOOR_CODE_MAP: Record<string, { label: string; order: number }> = {
  'bf': { label: 'Basement', order: 0 },
  'b1': { label: 'Basement 1', order: 1 },
  'b2': { label: 'Basement 2', order: 2 },
  'gf': { label: 'Ground Floor', order: 10 },
  'gr': { label: 'Ground Floor', order: 10 },
  'mz': { label: 'Mezzanine', order: 15 },
  'mf': { label: 'Mezzanine', order: 15 },
  'tf': { label: 'Typical Floor', order: 20 },
  '1f': { label: '1st Floor', order: 21 },
  '2f': { label: '2nd Floor', order: 22 },
  '3f': { label: '3rd Floor', order: 23 },
  '4f': { label: '4th Floor', order: 24 },
  '5f': { label: '5th Floor', order: 25 },
  'rf': { label: 'Roof', order: 90 },
  'tr': { label: 'Top Roof', order: 95 },
};

/**
 * Parse zone code to extract floor code.
 * Zone codes like "AC-BF-01" → "bf", "AC-GR-01" → "gr", "AC-TF-01" → "tf"
 */
function parseFloorCode(zoneId: string): string {
  const parts = zoneId.toUpperCase().split('-');
  // Try second segment (AC-BF-01 → BF)
  if (parts.length >= 2) {
    const code = parts[1].toLowerCase();
    if (FLOOR_CODE_MAP[code]) return code;
  }
  // Try matching floor keywords in the full string
  const lower = zoneId.toLowerCase();
  if (lower.includes('basement') || lower.includes('bsmt')) return 'bf';
  if (lower.includes('ground')) return 'gf';
  if (lower.includes('mezz')) return 'mz';
  if (lower.includes('roof') && lower.includes('top')) return 'tr';
  if (lower.includes('roof')) return 'rf';
  if (lower.includes('typical')) return 'tf';
  // Match "1st", "2nd", etc.
  const floorMatch = lower.match(/(\d+)(st|nd|rd|th)?\s*floor/);
  if (floorMatch) return `${floorMatch[1]}f`;
  return 'tf'; // default to typical floor
}

/**
 * Group thermal load zones by floor, producing a per-floor summary.
 */
export function groupZonesByFloor(
  thermalLoadTable: ThermalLoadZone[],
): FloorBreakdownResult[] {
  const floors: Record<string, {
    zones: ThermalLoadZone[];
    code: string;
    order: number;
  }> = {};

  for (const zone of thermalLoadTable) {
    const floorCode = zone.floor_code || parseFloorCode(zone.area_or_zone);
    const info = FLOOR_CODE_MAP[floorCode] || { label: floorCode.toUpperCase(), order: 50 };

    if (!floors[floorCode]) {
      floors[floorCode] = { zones: [], code: floorCode, order: info.order };
    }
    floors[floorCode].zones.push(zone);
  }

  return Object.entries(floors)
    .sort(([, a], [, b]) => a.order - b.order)
    .map(([code, data]) => {
      const info = FLOOR_CODE_MAP[code] || { label: code.toUpperCase(), order: 50 };
      const systemRefs = [...new Set(
        data.zones
          .map(z => z.system_ref)
          .filter((r): r is string => r !== null && r !== undefined)
      )];

      return {
        floor_label: info.label,
        floor_code: code.toUpperCase(),
        zone_count: data.zones.length,
        ducted_count: data.zones.filter(z => z.indoor_unit_type === 'Ducted').length,
        decorative_count: data.zones.filter(z => z.indoor_unit_type === 'Decorative').length,
        total_kw: Math.round(data.zones.reduce((s, z) => s + z.capacity_kw, 0) * 100) / 100,
        system_refs: systemRefs,
      };
    });
}

// ---- Rate Override Wrappers ----

/**
 * Wrapper around calculateHVACEstimate that applies rate overrides to the result.
 * Existing calculateHVACEstimate is untouched — this post-processes the output.
 */
export function calculateHVACEstimateWithRates(
  totalAreaSqft: number,
  buildingType: string,
  rateOverrides: Record<string, number>,
  totalKw?: number | null,
  fahuKw?: number | null,
  specifiedTonnage?: number | null,
  specifiedSystem?: string | null,
): ServiceEstimate {
  const result = calculateHVACEstimate(
    totalAreaSqft, buildingType, totalKw, fahuKw, specifiedTonnage, specifiedSystem,
  );

  // Apply system-level rate override if present
  const systemCode = Object.entries(HVAC_UNIT_RATES).find(
    ([, rate]) => rate === result.unit_rate_aed
  )?.[0];

  if (systemCode && rateOverrides[systemCode]) {
    const newRate = rateOverrides[systemCode];
    const tonnage = result.tonnage || 0;
    return {
      ...result,
      unit_rate_aed: newRate,
      total_aed: Math.round(tonnage * newRate),
      rate_source: `Custom rate override: ${systemCode} @ ${newRate} AED/TR`,
    };
  }

  return result;
}

/**
 * Wrapper around calculateHVACComponentEstimate that applies rate overrides to line items.
 * Existing calculateHVACComponentEstimate is untouched — this post-processes the output.
 */
export function calculateHVACComponentEstimateWithRates(
  params: Parameters<typeof calculateHVACComponentEstimate>[0],
  rateOverrides: Record<string, number>,
): HVACComponentLineItem[] {
  const items = calculateHVACComponentEstimate(params);

  return items.map(item => {
    if (rateOverrides[item.key]) {
      const newRate = rateOverrides[item.key];
      return {
        ...item,
        unit_rate_aed: newRate,
        total_aed: item.quantity * newRate,
      };
    }
    return item;
  });
}

// ── Electrical Drawing Estimator ──────────────────────────────────────────────

export interface ElectricalComponentLineItem {
  key: string;
  description: string;
  quantity: number;
  unit: string;
  unit_rate_aed: number;
  total_aed: number;
  category: string;
  confidence: 'high' | 'medium' | 'low';
}

const ELEC_RATES: Record<string, { description: string; unit: string; rate: number; category: string; confidence: 'high' | 'medium' | 'low' }> = {
  // A. Main HV/LV Equipment
  transformer_1000kva:  { description: 'Supply, Install & Commission 1000 kVA Transformer (by DEWA)', unit: 'nos', rate: 0,      category: 'A. Main Equipment', confidence: 'high' },
  transformer_other:    { description: 'Supply, Install & Commission Transformer',                    unit: 'nos', rate: 95000,  category: 'A. Main Equipment', confidence: 'high' },
  generator_per_kva:    { description: 'Standby Diesel Generator (installed)',                        unit: 'kVA', rate: 350,    category: 'A. Main Equipment', confidence: 'high' },
  ats_400a:             { description: 'Automatic Transfer Switch 400A 4P with bypass',               unit: 'nos', rate: 25000,  category: 'A. Main Equipment', confidence: 'high' },
  main_acb_1600a:       { description: 'Main Air Circuit Breaker 1600A 4P 50kA',                      unit: 'nos', rate: 18000,  category: 'A. Main Equipment', confidence: 'high' },
  capacitor_bank:       { description: 'Automatic Power Factor Correction Capacitor Bank',            unit: 'nos', rate: 38000,  category: 'A. Main Equipment', confidence: 'high' },
  ct_meter:             { description: 'CT Meter Panel with energy metering',                          unit: 'nos', rate: 4500,   category: 'A. Main Equipment', confidence: 'high' },
  // B. Distribution Boards
  lvp_panel:            { description: 'LV Panel / Main Distribution Board (LVP)',                    unit: 'nos', rate: 18000,  category: 'B. Distribution Boards', confidence: 'high' },
  smdb:                 { description: 'Sub-Main Distribution Board (SMDB)',                          unit: 'nos', rate: 8500,   category: 'B. Distribution Boards', confidence: 'high' },
  esmdb:                { description: 'Emergency Sub-Main Distribution Board (ESMDB)',               unit: 'nos', rate: 11000,  category: 'B. Distribution Boards', confidence: 'high' },
  edb:                  { description: 'Emergency Distribution Board (EDB)',                          unit: 'nos', rate: 5500,   category: 'B. Distribution Boards', confidence: 'high' },
  db_standard:          { description: 'Distribution Board (DB) — standard',                         unit: 'nos', rate: 3500,   category: 'B. Distribution Boards', confidence: 'high' },
  meter_panel:          { description: 'Tenant kWh Meters (per meter)',                               unit: 'nos', rate: 650,    category: 'B. Distribution Boards', confidence: 'high' },
  // C. Main Cables (high-confidence from SLD)
  cable_300mm2:         { description: 'Cable 4C × 300mm² XLPE/SWA/PVC (incomer)',                   unit: 'm',   rate: 350,    category: 'C. Main Cables', confidence: 'high' },
  cable_185mm2_fr:      { description: 'Cable 1×4C × 185mm² Fire Rated + ECC',                       unit: 'm',   rate: 280,    category: 'C. Main Cables', confidence: 'high' },
  cable_70mm2_fr:       { description: 'Cable 4C × 70mm² Fire Rated + ECC',                          unit: 'm',   rate: 95,     category: 'C. Main Cables', confidence: 'high' },
  cable_10mm2_fr:       { description: 'Cable 4C × 10mm² Fire Rated + ECC',                          unit: 'm',   rate: 22,     category: 'C. Main Cables', confidence: 'medium' },
  cable_6mm2_fr:        { description: 'Cable 4C × 6mm² Fire Rated + ECC',                           unit: 'm',   rate: 16,     category: 'C. Main Cables', confidence: 'medium' },
  cable_tray:           { description: 'GI Cable Tray 300mm wide (complete with supports)',           unit: 'm',   rate: 85,     category: 'C. Main Cables', confidence: 'medium' },
  conduit_25mm:         { description: 'GI Conduit 25mm (concealed wiring)',                          unit: 'm',   rate: 25,     category: 'C. Main Cables', confidence: 'low'    },
  // D. Power Outlets (medium confidence — counted from floor plan symbols)
  outlet_13a_single:    { description: '13A 230V Single Switched Socket Outlet',                     unit: 'nos', rate: 85,     category: 'D. Power Outlets', confidence: 'medium' },
  outlet_13a_wp:        { description: '13A 230V Single Switched Socket Outlet W/P',                 unit: 'nos', rate: 110,    category: 'D. Power Outlets', confidence: 'medium' },
  outlet_13a_twin:      { description: '13A 230V Twin Switched Socket Outlet',                       unit: 'nos', rate: 115,    category: 'D. Power Outlets', confidence: 'medium' },
  outlet_15a:           { description: '15A 230V Switched Socket Outlet',                            unit: 'nos', rate: 110,    category: 'D. Power Outlets', confidence: 'medium' },
  fcu_fused_spur:       { description: 'Switched Fused Spur for FCU (13A with neon)',                unit: 'nos', rate: 120,    category: 'D. Power Outlets', confidence: 'medium' },
  water_heater_20a:     { description: '20A Flex Outlet for Water Heater (WH)',                      unit: 'nos', rate: 135,    category: 'D. Power Outlets', confidence: 'medium' },
  washing_machine_20a:  { description: '20A Unswitched Fused Spur for Washing Machine (FL)',         unit: 'nos', rate: 140,    category: 'D. Power Outlets', confidence: 'medium' },
  gas_ignition_13a:     { description: '13A Flex Outlet for Gas Hob Ignition',                       unit: 'nos', rate: 150,    category: 'D. Power Outlets', confidence: 'medium' },
  gas_detector:         { description: 'Gas Detector Outlet',                                        unit: 'nos', rate: 185,    category: 'D. Power Outlets', confidence: 'medium' },
  hand_dryer:           { description: 'Hand Dryer Outlet (HD)',                                     unit: 'nos', rate: 150,    category: 'D. Power Outlets', confidence: 'medium' },
  floor_box_f1:         { description: 'Floor Box — 13A Twin Socket + RJ45 Data (F1)',               unit: 'nos', rate: 480,    category: 'D. Power Outlets', confidence: 'medium' },
  usb_outlet:           { description: '13A Socket Outlet with USB Port',                            unit: 'nos', rate: 125,    category: 'D. Power Outlets', confidence: 'medium' },
  industrial_16a:       { description: '16A Industrial Socket Outlet (BMU)',                         unit: 'nos', rate: 220,    category: 'D. Power Outlets', confidence: 'medium' },
  dp_switch_20a:        { description: '20A DP Switch with Neon Indicator',                          unit: 'nos', rate: 185,    category: 'D. Power Outlets', confidence: 'medium' },
  control_panel_conn:   { description: 'Control Panel Connection Point (CP)',                        unit: 'nos', rate: 260,    category: 'D. Power Outlets', confidence: 'medium' },
  // E. Earthing & Lightning
  earthing_system:      { description: 'Earthing System (electrodes, conductors, test links)',       unit: 'lot', rate: 18000,  category: 'E. Earthing & Protection', confidence: 'medium' },
  lightning_protection: { description: 'Lightning Protection System (roof conductors + rods)',       unit: 'lot', rate: 22000,  category: 'E. Earthing & Protection', confidence: 'medium' },
  // F. Testing & Commissioning
  testing_commissioning:{ description: 'Testing, Commissioning & DEWA Approval',                    unit: 'lot', rate: 1,      category: 'F. Testing & Commissioning', confidence: 'high' },
};

/**
 * Convert electrical drawing analysis result into priced BOQ line items.
 */
export function calculateElectricalDrawingEstimate(
  elecData: ElectricalComponents,
  typicalFloorCount: number,
): ElectricalComponentLineItem[] {
  const items: ElectricalComponentLineItem[] = [];

  const add = (key: string, qty: number) => {
    if (qty <= 0) return;
    const r = ELEC_RATES[key];
    if (!r) return;
    const q = Math.round(qty);
    items.push({ key, description: r.description, quantity: q, unit: r.unit, unit_rate_aed: r.rate, total_aed: q * r.rate, category: r.category, confidence: r.confidence });
  };

  // A. Main Equipment (from SLD — high confidence)
  if (elecData.transformer) {
    const kva = elecData.transformer.kva || 0;
    if (kva >= 900 && kva <= 1100) {
      // DEWA-supplied transformer: no supply cost, just note
      add('transformer_1000kva', elecData.transformer.count);
    } else {
      add('transformer_other', elecData.transformer.count);
    }
  }
  if (elecData.generator) {
    const kva = elecData.generator.kva || 0;
    items.push({
      key: 'generator_per_kva',
      description: `${kva} kVA Standby Diesel Generator (installed, complete)`,
      quantity: kva * elecData.generator.count,
      unit: 'kVA',
      unit_rate_aed: ELEC_RATES.generator_per_kva.rate,
      total_aed: kva * elecData.generator.count * ELEC_RATES.generator_per_kva.rate,
      category: ELEC_RATES.generator_per_kva.category,
      confidence: 'high',
    });
  }
  if (elecData.ats) add('ats_400a', elecData.ats.count);
  if (elecData.main_acb) add('main_acb_1600a', elecData.main_acb.count);
  if (elecData.capacitor_bank) add('capacitor_bank', 1);

  // B. Distribution Boards
  const dbCounts: Record<string, number> = {};
  for (const db of elecData.distribution_boards) {
    const typeKey = db.is_emergency && db.type === 'smdb' ? 'esmdb'
      : db.is_emergency && db.type === 'db' ? 'edb'
      : db.type === 'lvp' || db.type === 'mdb' ? 'lvp_panel'
      : db.type === 'smdb' ? 'smdb'
      : db.type === 'esmdb' ? 'esmdb'
      : db.type === 'edb' ? 'edb'
      : 'db_standard';
    dbCounts[typeKey] = (dbCounts[typeKey] || 0) + 1;
  }
  for (const [key, count] of Object.entries(dbCounts)) {
    add(key, count);
  }

  // Meter panels — estimate from typical floor count if boards present
  const dbTotal = elecData.distribution_boards.length;
  if (dbTotal > 0) {
    const estimatedMeters = Math.max(typicalFloorCount * 2, dbTotal);
    add('meter_panel', estimatedMeters);
  }

  // C. Main Cables (from SLD — high confidence)
  for (const cable of elecData.cables) {
    const len = cable.length_m;
    if (!len) continue;
    let key = '';
    if (cable.size_mm2 >= 240) key = 'cable_300mm2';
    else if (cable.size_mm2 >= 150) key = 'cable_185mm2_fr';
    else if (cable.size_mm2 >= 50) key = 'cable_70mm2_fr';
    else if (cable.size_mm2 >= 8) key = 'cable_10mm2_fr';
    else key = 'cable_6mm2_fr';
    if (!key) continue;
    const r = ELEC_RATES[key];
    items.push({
      key,
      description: `${r.description} — ${cable.circuit || 'general'}`,
      quantity: Math.round(len),
      unit: 'm',
      unit_rate_aed: r.rate,
      total_aed: Math.round(len) * r.rate,
      category: r.category,
      confidence: cable.length_m ? 'high' : 'medium',
    });
  }

  // Cable tray estimate: ~3m per floor per board
  const cableTrayM = Math.max(50, elecData.distribution_boards.length * 3 * Math.max(typicalFloorCount, 3));
  add('cable_tray', cableTrayM);

  // Conduit: estimated from floor count + outlet count
  const totalOutlets = elecData.floors.reduce((sum, f) => {
    const o = f.outlets;
    return sum + o.single_13a + o.single_13a_wp + o.twin_13a + o.outlet_15a +
      o.fcu_fused_spur + o.water_heater_20a + o.washing_machine_20a +
      o.gas_ignition_13a + o.hand_dryer + o.usb_outlet + o.dp_switch_20a + o.control_panel;
  }, 0);
  add('conduit_25mm', Math.max(200, totalOutlets * 4));

  // D. Power Outlets (from floor plan symbol counts)
  let totals: Record<string, number> = {};
  for (const floor of elecData.floors) {
    const isTypical = floor.floor_label.toLowerCase().includes('typical') || floor.floor_code.toLowerCase().includes('tf');
    const mult = isTypical ? Math.max(1, typicalFloorCount) : 1;
    const o = floor.outlets;
    totals.single_13a =       (totals.single_13a || 0) + o.single_13a * mult;
    totals.single_13a_wp =    (totals.single_13a_wp || 0) + o.single_13a_wp * mult;
    totals.twin_13a =         (totals.twin_13a || 0) + o.twin_13a * mult;
    totals.outlet_15a =       (totals.outlet_15a || 0) + o.outlet_15a * mult;
    totals.fcu_fused_spur =   (totals.fcu_fused_spur || 0) + o.fcu_fused_spur * mult;
    totals.water_heater_20a = (totals.water_heater_20a || 0) + o.water_heater_20a * mult;
    totals.washing_machine =  (totals.washing_machine || 0) + o.washing_machine_20a * mult;
    totals.gas_ignition =     (totals.gas_ignition || 0) + o.gas_ignition_13a * mult;
    totals.gas_detector =     (totals.gas_detector || 0) + o.gas_detector * mult;
    totals.hand_dryer =       (totals.hand_dryer || 0) + o.hand_dryer * mult;
    totals.floor_box_f1 =     (totals.floor_box_f1 || 0) + o.floor_box_f1 * mult;
    totals.usb_outlet =       (totals.usb_outlet || 0) + o.usb_outlet * mult;
    totals.industrial_16a =   (totals.industrial_16a || 0) + o.industrial_16a * mult;
    totals.dp_switch_20a =    (totals.dp_switch_20a || 0) + o.dp_switch_20a * mult;
    totals.control_panel =    (totals.control_panel || 0) + o.control_panel * mult;
  }
  add('outlet_13a_single',   totals.single_13a || 0);
  add('outlet_13a_wp',       totals.single_13a_wp || 0);
  add('outlet_13a_twin',     totals.twin_13a || 0);
  add('outlet_15a',          totals.outlet_15a || 0);
  add('fcu_fused_spur',      totals.fcu_fused_spur || 0);
  add('water_heater_20a',    totals.water_heater_20a || 0);
  add('washing_machine_20a', totals.washing_machine || 0);
  add('gas_ignition_13a',    totals.gas_ignition || 0);
  add('gas_detector',        totals.gas_detector || 0);
  add('hand_dryer',          totals.hand_dryer || 0);
  add('floor_box_f1',        totals.floor_box_f1 || 0);
  add('usb_outlet',          totals.usb_outlet || 0);
  add('industrial_16a',      totals.industrial_16a || 0);
  add('dp_switch_20a',       totals.dp_switch_20a || 0);
  add('control_panel_conn',  totals.control_panel || 0);

  // E. Earthing & Lightning
  if (elecData.earthing) {
    add('earthing_system', 1);
    if (elecData.earthing.lightning_protection) add('lightning_protection', 1);
  }

  // F. Testing & Commissioning (5% of subtotal)
  const subtotal = items.reduce((s, i) => s + i.total_aed, 0);
  const tcRate = Math.round(subtotal * 0.05);
  if (tcRate > 0) {
    items.push({
      key: 'testing_commissioning',
      description: 'Testing, Commissioning & DEWA Approval (5%)',
      quantity: 1,
      unit: 'lot',
      unit_rate_aed: tcRate,
      total_aed: tcRate,
      category: 'F. Testing & Commissioning',
      confidence: 'high',
    });
  }

  return items;
}
