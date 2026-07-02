import { getDemoEmails, type DemoEmail } from '@/lib/shared/demo-emails';
import { calculateHVACComponentEstimate } from '@/lib/pipeline/estimation-engine';
import { getDrawingPreview } from '@/lib/drawing/drawing-previews';
import type {
  Project, Attachment, Service, Estimation, ActivityLog,
  ProjectDetail, ProjectPriority, ProjectStatus,
  HVACSubSystem, FloorBreakdown, EquipmentScheduleItem,
} from '@/lib/shared/types';

// ---- Store (globalThis to share across Next.js route bundles) ----
const globalStore = globalThis as unknown as {
  __demoProjectStore?: Map<string, ProjectDetail>;
  __demoProjectsInitialized?: boolean;
};
if (!globalStore.__demoProjectStore) {
  globalStore.__demoProjectStore = new Map();
}
const projectStore = globalStore.__demoProjectStore;
const isInitialized = () => globalStore.__demoProjectsInitialized === true;
const markInitialized = () => { globalStore.__demoProjectsInitialized = true; };

// ---- Helpers ----
function extractClientName(from: string): string {
  const match = from.match(/^([^@<]+)/);
  return match ? match[1].replace(/[._-]/g, ' ').trim() : from;
}

function extractProjectName(subject: string): string {
  // Strip common prefixes
  let name = subject
    .replace(/^(re:|fw:|fwd:)\s*/gi, '')
    .replace(/^(rfq|tender|invitation|request)[:\s—–-]+/i, '');
  if (name.length > 80) name = name.slice(0, 80) + '...';
  return name.trim();
}

function classifyPriority(subject: string, from: string): ProjectPriority {
  const lower = (subject + ' ' + from).toLowerCase();
  if (lower.includes('priority') || lower.includes('urgent') || lower.includes('george')) return 'priority_top';
  if (lower.includes('tender') || lower.includes('invitation')) return 'priority_gen';
  return 'new';
}

function nowISO(): string { return new Date().toISOString(); }

// ---- HVAC folder structure for demo (based on RIDGE dooc-HVAC.pdf) ----
const DEMO_ZIP_CONTENTS = [
  'RIDGE_HVAC_Plot6457918/AC_000_Green_Building_General_Notes.pdf',
  'RIDGE_HVAC_Plot6457918/AC_Standard_Details/AC_001_Standard_Details_01.pdf',
  'RIDGE_HVAC_Plot6457918/AC_Standard_Details/AC_002_Standard_Details_02.pdf',
  'RIDGE_HVAC_Plot6457918/AC_Calculations/AC_005_Summary_of_Thermal_Load_Calculation.pdf',
  'RIDGE_HVAC_Plot6457918/AC_Calculations/AC_006_Window_Glazing_Schedule.pdf',
  'RIDGE_HVAC_Plot6457918/AC_Calculations/AC_007_UValue_Section_Details.pdf',
  'RIDGE_HVAC_Plot6457918/AC_Layouts/AC_100_Basement_Pump_Room_AC_Layout.pdf',
  'RIDGE_HVAC_Plot6457918/AC_Layouts/AC_101_Basement_2_Floor_Plan_AC_Layout.pdf',
  'RIDGE_HVAC_Plot6457918/AC_Layouts/AC_102_Basement_1_Floor_Plan_AC_Layout.pdf',
  'RIDGE_HVAC_Plot6457918/AC_Layouts/AC_103_Ground_Floor_AC_Layout.pdf',
  'RIDGE_HVAC_Plot6457918/AC_Layouts/AC_104_Mezzanine_Floor_AC_Layout.pdf',
  'RIDGE_HVAC_Plot6457918/AC_Layouts/AC_105_1st_Floor_AC_Layout.pdf',
  'RIDGE_HVAC_Plot6457918/AC_Layouts/AC_106_2nd_to_4th_Floor_AC_Layout.pdf',
  'RIDGE_HVAC_Plot6457918/AC_Layouts/AC_107_5th_Floor_AC_Layout.pdf',
  'RIDGE_HVAC_Plot6457918/AC_Layouts/AC_108_Roof_Floor_AC_Layout.pdf',
  'RIDGE_HVAC_Plot6457918/AC_Layouts/AC_109_Top_Roof_Floor_AC_Layout.pdf',
];

// ---- Per-email project metadata ----
interface ProjectMeta {
  location: string;
  floors: number;
  parking: number;
  typical: number;
  areaPerFloor: number;
  totalArea: number;
  height: number;
  buildingType: string;
  systemType: string;
  systemCode: string;
  totalKw: number;
  fahuKw: number;
  acKw: number;
  tonnage: number;
  rate: number;
  acPrice: number;
  fahuPrice: number;
  fahuCfm: number;
  totalHvac: number;
  decorativeCount: number;
  ductedCount: number;
  predominantly: string;
  formula: string;
}

// Projects starting at gate 6 — user walks through all approvals
const EARLY_STAGE_EMAILS = new Set(['demo-new-001', 'demo-new-002']);

const PROJECT_META: Record<string, ProjectMeta> = {
  'demo-001': { // RIDGE — DX Residential
    location: 'Wadi Al Safa 3th, Dubai', floors: 10, parking: 2, typical: 5, areaPerFloor: 3428, totalArea: 34270, height: 3.2, buildingType: 'residential',
    systemType: 'DX Split Unit', systemCode: 'split', totalKw: 639, fahuKw: 92, acKw: 547, tonnage: 155.5, rate: 3500,
    acPrice: 544250, fahuPrice: 37400, fahuCfm: 4400, totalHvac: 581650,
    decorativeCount: 5, ductedCount: 97, predominantly: 'ducted', formula: 'Formula 2 (DX Split)',
  },
  'demo-005': { // K&A — Chiller Office Tower
    location: 'Al Quoz Industrial 3, Dubai', floors: 16, parking: 1, typical: 12, areaPerFloor: 15608, totalArea: 242188, height: 3.6, buildingType: 'office',
    systemType: 'Chiller System', systemCode: 'chiller', totalKw: 1850, fahuKw: 210, acKw: 1640, tonnage: 466.4, rate: 5500,
    acPrice: 2565200, fahuPrice: 204000, fahuCfm: 24000, totalHvac: 2769200,
    decorativeCount: 0, ductedCount: 52, predominantly: 'ducted', formula: 'Formula 3 (Chiller)',
  },
  'demo-002': { // RAK — Plumbing & FF only
    location: 'Ras Al Khaimah, UAE', floors: 16, parking: 1, typical: 14, areaPerFloor: 12857, totalArea: 540000, height: 3.0, buildingType: 'residential',
    systemType: 'VRF System', systemCode: 'vrf', totalKw: 980, fahuKw: 45, acKw: 935, tonnage: 265.9, rate: 4200,
    acPrice: 1116780, fahuPrice: 38250, fahuCfm: 4500, totalHvac: 1155030,
    decorativeCount: 42, ductedCount: 18, predominantly: 'decorative', formula: 'Formula 1 (VRF)',
  },
  'demo-004': { // Emirates Engineers — Package Warehouse
    location: 'Dubai Investment Park (DIP)', floors: 2, parking: 0, typical: 1, areaPerFloor: 67500, totalArea: 135000, height: 12.0, buildingType: 'warehouse',
    systemType: 'Package Unit', systemCode: 'package', totalKw: 1583, fahuKw: 0, acKw: 1583, tonnage: 450, rate: 3800,
    acPrice: 1710000, fahuPrice: 0, fahuCfm: 0, totalHvac: 1710000,
    decorativeCount: 0, ductedCount: 8, predominantly: 'ducted', formula: 'Formula (Package)',
  },
  'demo-hospital': { // ADHS Al Ain Hospital — Chiller, healthcare
    location: 'Al Ain, Abu Dhabi', floors: 5, parking: 1, typical: 3, areaPerFloor: 10500, totalArea: 42000, height: 4.2, buildingType: 'hospital',
    systemType: 'Chiller System', systemCode: 'chiller', totalKw: 527, fahuKw: 85, acKw: 442, tonnage: 150, rate: 5500,
    acPrice: 825000, fahuPrice: 127500, fahuCfm: 15000, totalHvac: 952500,
    decorativeCount: 0, ductedCount: 48, predominantly: 'ducted', formula: 'Formula 3 (Chiller)',
  },
  'demo-arch-plans': { // Emaar Creek Vista — Chiller, with architecture drawings
    location: 'Dubai Creek Harbour, Dubai', floors: 24, parking: 2, typical: 20, areaPerFloor: 8500, totalArea: 215000, height: 3.2, buildingType: 'residential',
    systemType: 'Chiller System', systemCode: 'chiller', totalKw: 1231, fahuKw: 148, acKw: 1083, tonnage: 350, rate: 5500,
    acPrice: 1925000, fahuPrice: 136000, fahuCfm: 16000, totalHvac: 2061000,
    decorativeCount: 0, ductedCount: 120, predominantly: 'ducted', formula: 'Formula 3 (Chiller)',
  },
  'demo-hvac-test': { // Al Fara — VRF Office Tower (HVAC test)
    location: 'Business Bay, Dubai', floors: 17, parking: 1, typical: 14, areaPerFloor: 4800, totalArea: 82000, height: 3.6, buildingType: 'office',
    systemType: 'VRF System', systemCode: 'vrf', totalKw: 486, fahuKw: 62, acKw: 424, tonnage: 138.2, rate: 4200,
    acPrice: 580440, fahuPrice: 59500, fahuCfm: 7000, totalHvac: 639940,
    decorativeCount: 14, ductedCount: 42, predominantly: 'ducted', formula: 'Formula 1 (VRF)',
  },
  'demo-new-001': { // DAMAC Lagoons Villas — VRF
    location: 'Dubailand, Dubai', floors: 2, parking: 0, typical: 1, areaPerFloor: 2500, totalArea: 363200, height: 3.2, buildingType: 'villa',
    systemType: 'VRF System', systemCode: 'vrf', totalKw: 2679, fahuKw: 0, acKw: 2679, tonnage: 762, rate: 4200,
    acPrice: 3200400, fahuPrice: 0, fahuCfm: 0, totalHvac: 3200400,
    decorativeCount: 438, ductedCount: 146, predominantly: 'decorative', formula: 'Formula 1 (VRF)',
  },
  'demo-new-002': { // Arabtec Jumeirah Living — District Cooling
    location: 'JVC, Dubai', floors: 22, parking: 0, typical: 18, areaPerFloor: 12000, totalArea: 780000, height: 3.0, buildingType: 'residential',
    systemType: 'District Cooling', systemCode: 'district_cooling', totalKw: 8968, fahuKw: 420, acKw: 8548, tonnage: 2550, rate: 4800,
    acPrice: 12240000, fahuPrice: 204000, fahuCfm: 24000, totalHvac: 12444000,
    decorativeCount: 0, ductedCount: 432, predominantly: 'ducted', formula: 'Formula 4 (District Cooling)',
  },
};

// Derive meta from email content for user-added emails
function deriveMeta(email: DemoEmail): ProjectMeta {
  const text = (email.subject + ' ' + email.body).toLowerCase();

  // Try to extract area from text
  const areaMatch = text.match(/(\d[\d,]*)\s*(sqft|sq\.?\s*ft|square\s*feet)/i);
  const totalArea = areaMatch ? parseInt(areaMatch[1].replace(/,/g, '')) : 50000;

  // Try to extract floors
  const floorMatch = text.match(/(\d+)\s*(floors?|stories|storey)/i) || text.match(/[bg+]*(\d+)\s*f/i);
  const floors = floorMatch ? parseInt(floorMatch[1]) : 8;

  // Guess system type from keywords
  let systemType = 'VRF System', systemCode = 'vrf', rate = 4200, formula = 'Formula 1 (VRF)';
  if (text.includes('chiller')) { systemType = 'Chiller System'; systemCode = 'chiller'; rate = 5500; formula = 'Formula 3 (Chiller)'; }
  else if (text.includes('package') || text.includes('warehouse')) { systemType = 'Package Unit'; systemCode = 'package'; rate = 3800; formula = 'Formula (Package)'; }
  else if (text.includes('dx') || text.includes('split')) { systemType = 'DX Split Unit'; systemCode = 'split'; rate = 3500; formula = 'Formula 2 (DX Split)'; }
  else if (text.includes('district')) { systemType = 'District Cooling'; systemCode = 'district_cooling'; rate = 4800; formula = 'Formula 4 (District Cooling)'; }

  // Guess building type
  let buildingType = 'residential';
  if (text.includes('office') || text.includes('commercial')) buildingType = 'office';
  else if (text.includes('warehouse') || text.includes('industrial')) buildingType = 'warehouse';
  else if (text.includes('hotel')) buildingType = 'hotel';
  else if (text.includes('retail') || text.includes('mall')) buildingType = 'retail';

  // Estimate load from area (rough: 1 TR per 400 sqft for office, 500 for residential)
  const sqftPerTR = buildingType === 'office' ? 400 : buildingType === 'warehouse' ? 600 : 500;
  const tonnage = Math.round(totalArea / sqftPerTR);
  const totalKw = Math.round(tonnage * 3.517);
  const fahuKw = Math.round(totalKw * 0.08);
  const acKw = totalKw - fahuKw;
  const acPrice = tonnage * rate;
  const fahuCfm = Math.round(fahuKw * 50);
  const fahuPrice = fahuCfm > 0 ? Math.round(fahuCfm * 8.5) : 0;

  // Extract location
  let location = 'Dubai, UAE';
  const locMatch = text.match(/(?:location|located\s+(?:in|at))\s*[:—–-]?\s*([^,.<\n]{5,40})/i);
  if (locMatch) location = locMatch[1].trim();
  else if (text.includes('downtown')) location = 'Downtown Dubai';
  else if (text.includes('marina')) location = 'Dubai Marina';
  else if (text.includes('jbr')) location = 'JBR, Dubai';
  else if (text.includes('business bay')) location = 'Business Bay, Dubai';

  return {
    location, floors, parking: Math.min(floors > 5 ? 2 : 1, 3), typical: Math.max(floors - 3, 1),
    areaPerFloor: Math.round(totalArea / Math.max(floors, 1)), totalArea, height: buildingType === 'warehouse' ? 8.0 : 3.2, buildingType,
    systemType, systemCode, totalKw, fahuKw, acKw, tonnage, rate,
    acPrice, fahuPrice, fahuCfm, totalHvac: acPrice + fahuPrice,
    decorativeCount: Math.round(tonnage * 0.1), ductedCount: Math.round(tonnage * 0.9),
    predominantly: 'ducted', formula,
  };
}

// ---- Generate multi-system HVAC sub-systems for demo projects ----
function generateDemoSubSystems(emailId: string, meta: ProjectMeta): HVACSubSystem[] {
  const SUB_SYSTEM_DATA: Record<string, Array<{
    label: string; code: string; type: string; kwPct: number; zones: string[];
    ducted: number; decorative: number; fahuCount: number; fahuCfm: number;
  }>> = {
    'demo-001': [ // RIDGE — DX Split + FAHU
      { label: 'DX Split (Typical Floors)', code: 'split', type: 'DX Split Unit', kwPct: 0.72, zones: ['Ground Floor Retail', 'Typical 1F-4F', '5th Floor'], ducted: 82, decorative: 3, fahuCount: 0, fahuCfm: 0 },
      { label: 'DX Split (Common Areas)', code: 'split', type: 'DX Split Unit', kwPct: 0.14, zones: ['Basement Pump Room', 'Mezzanine', 'Roof Gym'], ducted: 15, decorative: 2, fahuCount: 0, fahuCfm: 0 },
      { label: 'Fresh Air System (FAHU)', code: 'split', type: 'DX Split Unit', kwPct: 0.14, zones: ['Roof FAHU Room'], ducted: 0, decorative: 0, fahuCount: 1, fahuCfm: 4400 },
    ],
    'demo-005': [ // K&A — Chiller + AHU + FAHU
      { label: 'Chiller (Office Floors)', code: 'chiller', type: 'Chiller System', kwPct: 0.75, zones: ['Typical 1F-12F Office', 'Ground Floor Lobby'], ducted: 42, decorative: 0, fahuCount: 0, fahuCfm: 0 },
      { label: 'Chiller (Basement & Podium)', code: 'chiller', type: 'Chiller System', kwPct: 0.14, zones: ['Basement 1', 'Parking Level'], ducted: 10, decorative: 0, fahuCount: 0, fahuCfm: 0 },
      { label: 'Fresh Air System (FAHU/AHU)', code: 'chiller', type: 'Chiller System', kwPct: 0.11, zones: ['Roof Plant Room'], ducted: 0, decorative: 0, fahuCount: 2, fahuCfm: 12000 },
    ],
    'demo-002': [ // RAK — VRF + FAHU
      { label: 'VRF (Apartments)', code: 'vrf', type: 'VRF System', kwPct: 0.82, zones: ['Typical 1F-14F Apartments'], ducted: 14, decorative: 38, fahuCount: 0, fahuCfm: 0 },
      { label: 'VRF (Common Areas)', code: 'vrf', type: 'VRF System', kwPct: 0.13, zones: ['Ground Floor Lobby', 'Mezzanine'], ducted: 4, decorative: 4, fahuCount: 0, fahuCfm: 0 },
      { label: 'Fresh Air System (FAHU)', code: 'vrf', type: 'VRF System', kwPct: 0.05, zones: ['Roof Plant'], ducted: 0, decorative: 0, fahuCount: 1, fahuCfm: 4500 },
    ],
    'demo-004': [ // Emirates Engineers — Package (single system)
      { label: 'Package Unit (Warehouse)', code: 'package', type: 'Package Unit', kwPct: 0.85, zones: ['Warehouse Floor', 'Mezzanine Office'], ducted: 6, decorative: 0, fahuCount: 0, fahuCfm: 0 },
      { label: 'Package Unit (Admin)', code: 'package', type: 'Package Unit', kwPct: 0.15, zones: ['Admin Office'], ducted: 2, decorative: 0, fahuCount: 0, fahuCfm: 0 },
    ],
    'demo-hospital': [ // ADHS Hospital — Chiller
      { label: 'Chiller (Clinical Floors)', code: 'chiller', type: 'Chiller System', kwPct: 0.68, zones: ['Ground Emergency', '1F Operating Theatres', '2F ICU/HDU', '3F Patient Wards'], ducted: 40, decorative: 0, fahuCount: 0, fahuCfm: 0 },
      { label: 'Chiller (Service & Basement)', code: 'chiller', type: 'Chiller System', kwPct: 0.16, zones: ['Basement Plant', 'CSSD', 'Kitchen', 'Pharmacy'], ducted: 8, decorative: 0, fahuCount: 0, fahuCfm: 0 },
      { label: 'Fresh Air System (FAHU — 100% OA for OT/CSSD)', code: 'chiller', type: 'Chiller System', kwPct: 0.16, zones: ['OT Suite FAHU', 'ICU FAHU', 'General FAHU'], ducted: 0, decorative: 0, fahuCount: 3, fahuCfm: 5000 },
    ],
    'demo-arch-plans': [ // Emaar Creek Vista — Chiller
      { label: 'Chiller (Apartments 1F-20F)', code: 'chiller', type: 'Chiller System', kwPct: 0.75, zones: ['Typical 1F-20F Apartments'], ducted: 100, decorative: 0, fahuCount: 0, fahuCfm: 0 },
      { label: 'Chiller (Ground & Podium)', code: 'chiller', type: 'Chiller System', kwPct: 0.13, zones: ['Ground Floor Lobby', 'Podium Retail', 'Gym'], ducted: 20, decorative: 0, fahuCount: 0, fahuCfm: 0 },
      { label: 'Fresh Air System (FAHU)', code: 'chiller', type: 'Chiller System', kwPct: 0.12, zones: ['Roof Plant Room'], ducted: 0, decorative: 0, fahuCount: 2, fahuCfm: 8000 },
    ],
    'demo-hvac-test': [ // Al Fara — VRF Office Tower
      { label: 'VRF (Office Floors 1-14)', code: 'vrf', type: 'VRF System', kwPct: 0.77, zones: ['Ground Floor Lobby', 'Typical 1F-14F Offices'], ducted: 42, decorative: 10, fahuCount: 0, fahuCfm: 0 },
      { label: 'VRF (Common & Basement)', code: 'vrf', type: 'VRF System', kwPct: 0.10, zones: ['Basement Services', 'Security', 'Server Room'], ducted: 0, decorative: 4, fahuCount: 0, fahuCfm: 0 },
      { label: 'Fresh Air System (FAHU)', code: 'vrf', type: 'VRF System', kwPct: 0.13, zones: ['Roof Plant Room'], ducted: 0, decorative: 0, fahuCount: 2, fahuCfm: 3500 },
    ],
    'demo-new-001': [ // DAMAC Lagoons — VRF Villas
      { label: 'VRF (Villa Living Spaces)', code: 'vrf', type: 'VRF System', kwPct: 0.65, zones: ['Ground Floor Living', 'First Floor Bedrooms'], ducted: 96, decorative: 290, fahuCount: 0, fahuCfm: 0 },
      { label: 'VRF (Villa Service Areas)', code: 'vrf', type: 'VRF System', kwPct: 0.35, zones: ['Kitchen', 'Maid Room', 'Garage'], ducted: 50, decorative: 148, fahuCount: 0, fahuCfm: 0 },
    ],
    'demo-new-002': [ // Arabtec Jumeirah — District Cooling + FCU + FAHU
      { label: 'District Cooling (Apartments)', code: 'district_cooling', type: 'District Cooling', kwPct: 0.72, zones: ['Typical 1F-18F Apartments'], ducted: 360, decorative: 0, fahuCount: 0, fahuCfm: 0 },
      { label: 'District Cooling (Podium & Common)', code: 'district_cooling', type: 'District Cooling', kwPct: 0.23, zones: ['Ground Floor', 'Podium 1-2', 'Amenity Floor'], ducted: 72, decorative: 0, fahuCount: 0, fahuCfm: 0 },
      { label: 'Fresh Air System (FAHU)', code: 'district_cooling', type: 'District Cooling', kwPct: 0.05, zones: ['Roof Plant Room'], ducted: 0, decorative: 0, fahuCount: 3, fahuCfm: 8000 },
    ],
  };

  const defs = SUB_SYSTEM_DATA[emailId];
  if (!defs) return [];

  return defs.map((def, idx) => {
    const subKw = Math.round(meta.totalKw * def.kwPct);
    const subTonnage = Math.round((subKw / 3.517) * 10) / 10;
    const rate = meta.rate;
    const acPrice = Math.round(subTonnage * rate);
    const fahuPrice = def.fahuCount > 0 && def.fahuCfm > 0
      ? Math.round(def.fahuCfm * 8.5 * def.fahuCount) : 0;

    const subAreaSqm = Math.round((meta.totalArea / 10.764) * def.kwPct);
    const lineItems = calculateHVACComponentEstimate({
      systemCode: def.code,
      tonnage: subTonnage,
      totalAreaSqm: subAreaSqm,
      floors: Math.max(1, Math.round(meta.floors * def.kwPct)),
      parkingFloors: idx === 0 ? meta.parking : 0,
      ductedCount: def.ducted,
      decorativeCount: def.decorative,
      fahuCount: def.fahuCount,
      fahuCfm: def.fahuCfm,
    });

    return {
      id: `subsys-${idx + 1}`,
      label: def.label,
      system_code: def.code,
      system_type: def.type,
      zones: def.zones,
      total_kw: subKw,
      fahu_kw: def.fahuCount > 0 ? Math.round(meta.fahuKw * (def.fahuCfm / Math.max(meta.fahuCfm, 1))) : 0,
      ac_unit_kw: subKw,
      tonnage: subTonnage,
      unit_rate_aed: rate,
      ac_price: acPrice,
      fahu_price: fahuPrice,
      total_aed: acPrice + fahuPrice,
      indoor_units: { ducted: def.ducted, decorative: def.decorative },
      fahu_count: def.fahuCount,
      fahu_cfm: def.fahuCfm,
      line_items: lineItems,
    };
  });
}

// ---- Generate floor breakdown for demo projects ----
function generateDemoFloorBreakdown(emailId: string, meta: ProjectMeta): FloorBreakdown[] {
  const FLOOR_DATA: Record<string, FloorBreakdown[]> = {
    'demo-001': [ // RIDGE — 10 floors (2B+G+M+5F+R)
      { floor_label: 'Basement 2', floor_code: 'B2', zone_count: 1, ducted_count: 0, decorative_count: 1, total_kw: 7.16, system_refs: ['DX'] },
      { floor_label: 'Basement 1', floor_code: 'B1', zone_count: 1, ducted_count: 0, decorative_count: 0, total_kw: 5.2, system_refs: ['DX'] },
      { floor_label: 'Ground Floor', floor_code: 'GF', zone_count: 16, ducted_count: 11, decorative_count: 4, total_kw: 186.79, system_refs: ['DX'] },
      { floor_label: 'Mezzanine', floor_code: 'MZ', zone_count: 4, ducted_count: 3, decorative_count: 0, total_kw: 32.5, system_refs: ['DX'] },
      { floor_label: '1st Floor', floor_code: '1F', zone_count: 12, ducted_count: 12, decorative_count: 0, total_kw: 78.4, system_refs: ['DX'] },
      { floor_label: '2nd Floor', floor_code: '2F', zone_count: 12, ducted_count: 12, decorative_count: 0, total_kw: 78.4, system_refs: ['DX'] },
      { floor_label: '3rd Floor', floor_code: '3F', zone_count: 12, ducted_count: 12, decorative_count: 0, total_kw: 78.4, system_refs: ['DX'] },
      { floor_label: '4th Floor', floor_code: '4F', zone_count: 12, ducted_count: 12, decorative_count: 0, total_kw: 78.4, system_refs: ['DX'] },
      { floor_label: '5th Floor', floor_code: '5F', zone_count: 10, ducted_count: 10, decorative_count: 0, total_kw: 65.8, system_refs: ['DX'] },
      { floor_label: 'Roof', floor_code: 'RF', zone_count: 4, ducted_count: 3, decorative_count: 0, total_kw: 27.98, system_refs: ['DX', 'FAHU'] },
    ],
    'demo-005': [ // K&A — 16 floors (B+G+14F+R)
      { floor_label: 'Basement', floor_code: 'B1', zone_count: 3, ducted_count: 2, decorative_count: 0, total_kw: 45.0, system_refs: ['Chiller'] },
      { floor_label: 'Ground Floor', floor_code: 'GF', zone_count: 5, ducted_count: 4, decorative_count: 0, total_kw: 125.0, system_refs: ['Chiller'] },
      { floor_label: '1st Floor', floor_code: '1F', zone_count: 4, ducted_count: 4, decorative_count: 0, total_kw: 115.0, system_refs: ['Chiller'] },
      { floor_label: '2nd Floor', floor_code: '2F', zone_count: 4, ducted_count: 4, decorative_count: 0, total_kw: 115.0, system_refs: ['Chiller'] },
      { floor_label: 'Typical 3F-12F', floor_code: 'TF', zone_count: 40, ducted_count: 32, decorative_count: 0, total_kw: 1100.0, system_refs: ['Chiller'] },
      { floor_label: '13th Floor', floor_code: '13F', zone_count: 4, ducted_count: 4, decorative_count: 0, total_kw: 115.0, system_refs: ['Chiller'] },
      { floor_label: '14th Floor', floor_code: '14F', zone_count: 4, ducted_count: 2, decorative_count: 0, total_kw: 125.0, system_refs: ['Chiller'] },
      { floor_label: 'Roof', floor_code: 'RF', zone_count: 2, ducted_count: 0, decorative_count: 0, total_kw: 110.0, system_refs: ['Chiller', 'FAHU'] },
    ],
    'demo-002': [ // RAK — 16 floors (B+G+14F)
      { floor_label: 'Basement', floor_code: 'B1', zone_count: 2, ducted_count: 2, decorative_count: 0, total_kw: 28.0, system_refs: ['VRF'] },
      { floor_label: 'Ground Floor', floor_code: 'GF', zone_count: 6, ducted_count: 2, decorative_count: 4, total_kw: 85.0, system_refs: ['VRF'] },
      { floor_label: 'Mezzanine', floor_code: 'MZ', zone_count: 3, ducted_count: 1, decorative_count: 2, total_kw: 42.0, system_refs: ['VRF'] },
      { floor_label: 'Typical 1F-14F', floor_code: 'TF', zone_count: 56, ducted_count: 12, decorative_count: 36, total_kw: 780.0, system_refs: ['VRF'] },
      { floor_label: 'Roof', floor_code: 'RF', zone_count: 2, ducted_count: 1, decorative_count: 0, total_kw: 45.0, system_refs: ['VRF', 'FAHU'] },
    ],
    'demo-004': [ // Emirates Engineers — 2 floors
      { floor_label: 'Ground Floor', floor_code: 'GF', zone_count: 3, ducted_count: 2, decorative_count: 0, total_kw: 1200.0, system_refs: ['Package'] },
      { floor_label: 'Mezzanine Office', floor_code: 'MZ', zone_count: 3, ducted_count: 6, decorative_count: 0, total_kw: 383.0, system_refs: ['Package'] },
    ],
    'demo-new-001': [ // DAMAC Lagoons — 2 floors per villa, 145 villas
      { floor_label: 'Ground Floor', floor_code: 'GF', zone_count: 4, ducted_count: 2, decorative_count: 3, total_kw: 1608.0, system_refs: ['VRF'] },
      { floor_label: 'First Floor', floor_code: '1F', zone_count: 4, ducted_count: 2, decorative_count: 3, total_kw: 1071.0, system_refs: ['VRF'] },
    ],
    'demo-new-002': [ // Arabtec Jumeirah — 22 floors
      { floor_label: 'Ground Floor', floor_code: 'GF', zone_count: 6, ducted_count: 6, decorative_count: 0, total_kw: 320.0, system_refs: ['District Cooling'] },
      { floor_label: 'Podium 1', floor_code: 'P1', zone_count: 4, ducted_count: 4, decorative_count: 0, total_kw: 280.0, system_refs: ['District Cooling'] },
      { floor_label: 'Podium 2', floor_code: 'P2', zone_count: 4, ducted_count: 4, decorative_count: 0, total_kw: 260.0, system_refs: ['District Cooling'] },
      { floor_label: 'Typical 1F-18F', floor_code: 'TF', zone_count: 72, ducted_count: 360, decorative_count: 0, total_kw: 7228.0, system_refs: ['District Cooling'] },
      { floor_label: 'Amenity Floor', floor_code: '19F', zone_count: 4, ducted_count: 24, decorative_count: 0, total_kw: 380.0, system_refs: ['District Cooling'] },
      { floor_label: 'Roof', floor_code: 'RF', zone_count: 3, ducted_count: 0, decorative_count: 0, total_kw: 500.0, system_refs: ['District Cooling', 'FAHU'] },
    ],
  };

  return FLOOR_DATA[emailId] || [];
}

// ---- Generate equipment schedule for demo projects ----
function generateDemoEquipmentSchedule(emailId: string, meta: ProjectMeta): EquipmentScheduleItem[] {
  const EQUIP_DATA: Record<string, EquipmentScheduleItem[]> = {
    'demo-001': [ // RIDGE — DX Split
      { tag: 'ODU-01', description: 'DX Outdoor Condensing Unit 14HP', model: 'Daikin RXQ14TAY1', capacity_kw: 40.0, capacity_tr: 11.4, quantity: 3, location: 'Roof', type: 'outdoor' },
      { tag: 'ODU-02', description: 'DX Outdoor Condensing Unit 10HP', model: 'Daikin RXQ10TY1', capacity_kw: 28.0, capacity_tr: 8.0, quantity: 5, location: 'Roof', type: 'outdoor' },
      { tag: 'ODU-03', description: 'DX Outdoor Condensing Unit 8HP', model: 'Daikin RXQ8TY1', capacity_kw: 22.4, capacity_tr: 6.4, quantity: 2, location: 'Roof', type: 'outdoor' },
      { tag: 'FCU-D-01', description: 'Ducted Indoor Unit 5.6kW', model: 'Daikin FXMQ50MVE', capacity_kw: 5.6, capacity_tr: 1.6, quantity: 65, location: 'Typical Floors', type: 'indoor_ducted' },
      { tag: 'FCU-D-02', description: 'Ducted Indoor Unit 7.1kW', model: 'Daikin FXMQ63MVE', capacity_kw: 7.1, capacity_tr: 2.0, quantity: 32, location: 'Ground & Common', type: 'indoor_ducted' },
      { tag: 'FCU-C-01', description: 'Cassette Indoor Unit 3.5kW', model: 'Daikin FFQ35BVE', capacity_kw: 3.5, capacity_tr: 1.0, quantity: 5, location: 'Ground Floor', type: 'indoor_decorative' },
      { tag: 'FAHU-01', description: 'Fresh Air Handling Unit 4400 CFM', model: 'Carrier 39CQ', capacity_kw: 92.0, capacity_tr: 26.2, quantity: 1, location: 'Roof', type: 'fahu' },
      { tag: 'EF-01', description: 'Toilet Exhaust Fan', model: 'Systemair KVO 200', capacity_kw: 0.25, capacity_tr: null, quantity: 24, location: 'All Floors', type: 'exhaust' },
      { tag: 'EF-02', description: 'Kitchen Exhaust Fan', model: 'Systemair KVO 315', capacity_kw: 0.55, capacity_tr: null, quantity: 12, location: 'All Floors', type: 'exhaust' },
    ],
    'demo-005': [ // K&A — Chiller
      { tag: 'CH-01', description: 'Air-Cooled Scroll Chiller 350TR', model: 'Carrier 30RBP350', capacity_kw: 1231.0, capacity_tr: 350, quantity: 1, location: 'Roof', type: 'outdoor' },
      { tag: 'CH-02', description: 'Air-Cooled Scroll Chiller 120TR', model: 'Carrier 30RBP120', capacity_kw: 422.0, capacity_tr: 120, quantity: 1, location: 'Roof', type: 'outdoor' },
      { tag: 'FCU-01', description: '4-Pipe Fan Coil Unit (Ceiling)', model: 'Carrier 42N', capacity_kw: 14.0, capacity_tr: 4.0, quantity: 36, location: 'Office Floors', type: 'indoor_ducted' },
      { tag: 'FCU-02', description: '4-Pipe Fan Coil Unit (Ceiling)', model: 'Carrier 42N', capacity_kw: 7.0, capacity_tr: 2.0, quantity: 16, location: 'Ground & Podium', type: 'indoor_ducted' },
      { tag: 'AHU-01', description: 'Air Handling Unit 15000 CFM', model: 'Carrier 39HQ', capacity_kw: 85.0, capacity_tr: 24.2, quantity: 2, location: 'Roof', type: 'ahu' },
      { tag: 'FAHU-01', description: 'Fresh Air Handling Unit 12000 CFM', model: 'Carrier 39CQ', capacity_kw: 105.0, capacity_tr: 29.9, quantity: 2, location: 'Roof', type: 'fahu' },
      { tag: 'CHWP-01', description: 'Chilled Water Pump', model: 'Grundfos NB 65-160', capacity_kw: 11.0, capacity_tr: null, quantity: 3, location: 'Plant Room', type: 'pump' },
    ],
    'demo-002': [ // RAK — VRF
      { tag: 'ODU-VRF-01', description: 'VRF Outdoor Unit 22HP', model: 'Daikin RXYQ22TATL', capacity_kw: 61.5, capacity_tr: 17.5, quantity: 6, location: 'Roof', type: 'outdoor' },
      { tag: 'ODU-VRF-02', description: 'VRF Outdoor Unit 16HP', model: 'Daikin RXYQ16TATL', capacity_kw: 45.0, capacity_tr: 12.8, quantity: 4, location: 'Roof', type: 'outdoor' },
      { tag: 'FCU-C-01', description: 'Cassette Unit 4-Way 5.6kW', model: 'Daikin FXFQ50AVE', capacity_kw: 5.6, capacity_tr: 1.6, quantity: 42, location: 'Apartments', type: 'indoor_decorative' },
      { tag: 'FCU-D-01', description: 'Ducted Indoor Unit 7.1kW', model: 'Daikin FXMQ63MVE', capacity_kw: 7.1, capacity_tr: 2.0, quantity: 18, location: 'Common Areas', type: 'indoor_ducted' },
      { tag: 'FAHU-01', description: 'Fresh Air Handling Unit 4500 CFM', model: 'Daikin D-AHU', capacity_kw: 45.0, capacity_tr: 12.8, quantity: 1, location: 'Roof', type: 'fahu' },
    ],
  };

  return EQUIP_DATA[emailId] || [];
}

// ---- Create project from demo email ----
export function createDemoProjectFromEmail(email: DemoEmail): ProjectDetail {
  const id = `demo-proj-${email.threadId}`;

  // Skip if already exists
  const existing = projectStore.get(id);
  if (existing) return existing;

  const priority = classifyPriority(email.subject, email.from);
  const now = nowISO();
  const meta = PROJECT_META[email.threadId] || deriveMeta(email);
  const isEarlyStage = EARLY_STAGE_EMAILS.has(email.threadId);

  // Build attachments
  const attachments: Attachment[] = [
    // ZIP archive with folder contents
    {
      id: `${id}-att-zip`,
      project_id: id,
      filename: 'RIDGE_dooc-HVAC_Plot6457918.zip',
      mime_type: 'application/zip',
      size_bytes: 52000000,
      attachment_id: 'demo-att-zip',
      message_id: email.messageId,
      file_type: 'archive_zip',
      discipline: null,
      extracted_data: { contents: DEMO_ZIP_CONTENTS },
      storage_path: null,
      created_at: now,
    },
    // AC 005 — Thermal Load Summary (the key calculation sheet)
    {
      id: `${id}-att-thermal`,
      project_id: id,
      filename: 'AC005_Summary_of_Thermal_Load_Calculation.pdf',
      mime_type: 'application/pdf',
      size_bytes: 4800000,
      attachment_id: 'demo-att-thermal',
      message_id: email.messageId,
      file_type: 'drawing_pdf',
      discipline: 'hvac',
      extracted_data: { text: 'SUMMARY OF THERMAL LOAD CALCULATION\nPlot No: 6457918\nProject: 2B+G+M+SF+R Residential & Commercial Building\nConsultant: RIDGE Engineering Consultants\nDate: 14-01-2022 V1\n\nDubai Municipality Requirements:\n- For all new buildings with cooling load ≥350 kW, condensate water must be recovered\n- For all new buildings with treated outdoor air >1000 L/s, energy recovery systems must be provided\n\n═══════════════════════════════════════════════════════════════\nBASEMENT FLOOR\n═══════════════════════════════════════════════════════════════\nAC-BF-01  | DX | Decorative | Pump Room    | 1.00 | 57.20 sqm | 0.98 occupant\n          | Total kW: 7.16 | Sensible: 7.19 | Flow Rate: 730.09 L/h\n          | Electric Power: Indoor 0.51 kW | Outdoor 9.15 kW\n\n═══════════════════════════════════════════════════════════════\nGROUND FLOOR\n═══════════════════════════════════════════════════════════════\nAC-GR-01  | DX | Ducted | RETAIL-1     | 1.00 | 44.90 sqm | 6.03 occ | 33.00 people\n          | Total kW: 13.36 | Sensible: 12.84 | Flow Rate: 711.09\n          | Electric Power: Indoor 2.90 kW | Outdoor 4.56 kW\nAC-GR-02  | DX | Ducted | RETAIL-2     | 1.00 | 49.70 sqm | 7.03 occ | 38.00\n          | Total kW: 14.17 | Sensible: 15.09 | Flow Rate: 741.09\nAC-GR-03  | DX | Ducted | RETAIL-3     | 1.00 | 60.00 sqm | 9.03 occ | 18.00\n          | Total kW: 18.00 | Sensible: 14.69 | Flow Rate: 245.09\nAC-GR-04  | DX | Ducted | RETAIL-4     | 1.00 | 52.10 sqm | 13.09 occ | 62.00\n          | Total kW: 21.86 | Sensible: 18.05 | Flow Rate: 798.09\nAC-GR-05  | DX | Ducted | RETAIL-5     | 1.00 | 64.10 sqm | 14.09 occ | 75.00\n          | Total kW: 21.84 | Sensible: 15.69 | Flow Rate: 390.09\nAC-GR-06  | DX | External | RETAIL-6   | 1.00 | 46.20 sqm | 7.03 occ | 24.00\n          | Total kW: 12.93 | Sensible: 12.79 | Flow Rate: 300.09\nAC-GR-07  | DX | Ducted | RETAIL-7     | 1.00 | 46.20 sqm | 6.03 occ | 54.00\n          | Total kW: 12.93 | Sensible: 17.35 | Flow Rate: 895.09\nAC-GR-08  | DX | Ducted | RETAIL-8     | 1.00 | 49.20 sqm | 7.03 occ | 34.00\n          | Total kW: 14.23 | Sensible: 13.71 | Flow Rate: 472.09\nAC-GR-09  | DX | Ducted | RETAIL-9     | 1.00 | 45.90 sqm | 8.03 occ | 181.00\n          | Total kW: 11.25 | Sensible: 16.71 | Flow Rate: 757.09\nAC-GR-10  | DX | Ducted | RETAIL-10    | 1.00 | 46.20 sqm | 7.03 occ | 171.00\n          | Total kW: 14.17 | Sensible: 16.03 | Flow Rate: 740.09\nAC-GR-11  | DX | Ducted | RETAIL-11    | 1.00 | 83.50 sqm | 14.09 occ | 229.00\n          | Total kW: 22.05 | Sensible: 14.93 | Flow Rate: 949.09\nAC-GRK-01 | DX | Decorative | WATCHMAN ROOM | 1.00 | 14.00 sqm | 1.03 occ | 20.00\n          | Total kW: 7.14 | Sensible: 12.71 | Flow Rate: 178.09\nAC-GRK-02 | DX | Decorative | GARBAGE ROOM  | 1.00 | 23.20 sqm\n          | Total kW: 0.86 | Sensible: 10.98\nAC-GRK-03 | DX | Ducted | LV ROOM       | 1.00 | 39.20 sqm\nAC-GRK-04 | DX | Ducted | MAIN ENTRANCE/CCTV RM | 1.00 | 71.19 sqm\nAC-GRK-05 | DX | Decorative | RATE TELE ROOM | 1.00 | 8.19 sqm\n\n═══════════════════════════════════════════════════════════════\nTYPICAL FLOORS (1st–4th)\n═══════════════════════════════════════════════════════════════\nAC-TYP-01 | DX | Ducted | KITCHEN/LVN  | 5.00 | 32.10 sqm | 1.03 occ | 56.00\n          | Total kW: 7.31 | Sensible: 11.23 | Flow Rate: 692.09\nAC-TYP-01A| DX | Ducted | M.S BED ROOM | 4.00 | 14.20 sqm | 1.03 occ | 24.00\n          | Total kW: 7.21 | Sensible: 9.15 | Flow Rate: 286.09\nAC-TYP-02 | DX | Ducted | KITCHEN/LVN  | 5.00 | 36.00 sqm | 1.03 occ | 28.00\n          | Total kW: 2.71 | Sensible: 15.73 | Flow Rate: 321.09\nAC-TYP-03 | DX | Ducted | M.S BED KHALWAT RM | 5.00 | 16.20 sqm | 1.03 occ | 28.00\n          | Total kW: 28.05 | Sensible: 15.15 | Flow Rate: 283.09\nAC-TYP-03N| DX | Ducted | BED RM       | 5.00 | 15.00 sqm | 1.03 occ | 26.00\n          | Total kW: 4.58 | Sensible: 15.62 | Flow Rate: 383.09\n[... continues for all typical floor zones ...]\nAC-TYP-OG | DX | Decorative | CORRIDOR/STAIR/ELEV SM | 1.00 | 52.70 sqm\n          | Total kW: 40.91 | Sensible: 5.17 | Flow Rate: 507.09\n\n═══════════════════════════════════════════════════════════════\nROOF\n═══════════════════════════════════════════════════════════════\nAC-RF-01  | DX | Ducted | MALE GYM/TOILET  | 1.00 | 89.60 sqm | 1.03 occ | 170.00\n          | Total kW: 1.11 | Sensible: 12.63 | Flow Rate: 1041.09\nAC-RF-02  | DX | Ducted | OSM RM/CORRIDOR/ELEV SM | 1.00 | 59.70 sqm | 1.03 occ | 46.00\n          | Total kW: 1.88 | Sensible: 12.63 | Flow Rate: 752.09\nAC-RF-03  | DX | Ducted | FEMALE GYM    | 1.00 | 103.30 sqm | 1.03 occ | 189.00\n\n═══════════════════════════════════════════════════════════════\nFAHU\n═══════════════════════════════════════════════════════════════\nAC-RF-61  | DX | FAHU | Swimming Pool & Pump Room | 1.00 | 144.78 sqm\n          | Total kW: 10.00 | Flow Rate: 2077.09\n          | Electric Power: Indoor 1.00 kW | Outdoor 320.03 kW | 92.00 kW\n\n═══════════════════════════════════════════════════════════════\nTOTALS\n═══════════════════════════════════════════════════════════════\nTotal Rooms/Zones: 103\nTotal Area: 3,184.30 sqm\nTotal People: 180.98\nTotal Outdoor Air: 4,531.00 L/s\nTotal AC Load: 639.03 kW (sensible) + 555.18 kW (latent) = 675.63 kW check\nTotal Flow Rate: 45475.86 L/h\n\nTotal Electric Power: Indoor 18.29 kW | Outdoor 272.23 kW\nTotal Electric Power per sqm: 88.71 W/m²\n\nTotal Outdoor Air L/s: 4,531.00\n\nFirst Selection — Electric Power kW:\n  Indoor: 18.29 | Outdoor: 272.23\n  Total: 28050.00 (estimated annual)\n\nImportant Notes:\n- HVAC equipment and systems must comply with minimum energy efficiency requirements\n- Test procedures as listed in DSS evaluation system (Al Sa\'fat)\n- Consultant is fully responsible for the HVAC thermal load calculation and selection', pages: 1, identified_as: 'thermal_load_summary' },
      storage_path: null,
      created_at: now,
    },
    // AC 006 — Glazing Schedule
    {
      id: `${id}-att-glazing`,
      project_id: id,
      filename: 'AC006_Window_Glazing_Schedule.pdf',
      mime_type: 'application/pdf',
      size_bytes: 2200000,
      attachment_id: 'demo-att-glazing',
      message_id: email.messageId,
      file_type: 'drawing_pdf',
      discipline: 'hvac',
      extracted_data: { text: 'GLAZED ELEMENTS — FENESTRATION PERFORMANCE REQUIREMENTS\nPlot No: 6457918\nProject: 2B+G+M+SF+R Residential & Commercial Building\nConsultant: RIDGE Engineering Consultants\nBuilding Type: Residential\n\nTotal Wall Area: 3,519.80 sqm\nTotal Glazed Area: 1,383.88 sqm\nWWR (Window-to-Wall Ratio): 39.3%\n\n══════════════════════════════════════════\nORIENTATION ANALYSIS\n══════════════════════════════════════════\n\nNORTH (-22.5° ≤ a ≤ 22.5°):\n  Max Percentage of glazing per building elevation: ≤ 80%\n  Total Wall Area N Orientations: [specified]\n\nNORTHEAST (22.5° ≤ a ≤ 67.5°):\n  Total Wall Area NE/NW Orientations: 1,456.80 sqm\n  Max Percentage: ≤ 70%\n  Glazed Area: 550.52 sqm\n  Percentage: 38% — COMPLY\n\nEAST (67.5° ≤ a ≤ 112.5°):\n  Total Wall Area E/W: 282.6 sqm\n  Max Percentage: ≤ 60%\n\nSOUTHEAST/SOUTH/SOUTHWEST (112.5°–247.5°):\n  Total Wall Area SS/SW: 1,863.00 sqm\n  Max Percentage: ≤ 40%\n  Glazed Area: 753.36 sqm\n  Percentage: 40% — COMPLY\n\nGlazing Specifications by Orientation:\n┌──────────┬────────┬───────┬──────────┬─────┬────────────┬──────────┬─────────────┐\n│ Ref No   │ Height │ Width │ Item Area│ Qty │ Thermal U  │ Shading  │ Light Trans │\n│          │ m      │ m     │ sqm      │     │ W/m²K      │ Coeff SC │ LT %        │\n├──────────┼────────┼───────┼──────────┼─────┼────────────┼──────────┼─────────────┤\n│ GD02     │ 3.29   │ 3.90  │ 5.60     │ 9.0 │ 1.90       │ 0.40     │ 40.0        │\n│ GD03     │ 3.20   │ 3.90  │ 11.62    │ 1.0 │ 1.9        │ 0.40     │ 40.00       │\n│ GD04     │ 3.20   │ 4.80  │ 13.30    │ 8.0 │ 1.8        │ 0.4      │ 40          │\n│ GD06     │ 3.20   │ 6.85  │ 21.62    │ 5.0 │ 1.90       │ 0.40     │ 40.0        │\n│ GD07     │ 3.20   │ 10.20 │ 32.84    │ 4.0 │ 1.8        │ 0.40     │ 40.00       │\n│ GD08     │ 3.20   │ 6.90  │ 22.08    │ 1.0 │ 1.9        │ 0.4      │ 40          │\n│ GD12     │ 1.00   │ 48.20 │ 48.20    │ 1.0 │ 1.90       │ 0.40     │ 40.0        │\n│ GW01     │ 1.20   │ 1.00  │ 1.20     │ 1.0 │ 1.6        │ 1.90     │ 40          │\n│ GW03     │ 3.20   │ 4.00  │ 12.80    │ 5.0 │ 1.90       │ 0.40     │ 40.0        │\n└──────────┴────────┴───────┴──────────┴─────┴────────────┴──────────┴─────────────┘\n\nAll glazing: U-value max 1.90 W/m²K, Shading Coefficient 0.40, Light Transmittance 40%\nDubai Building Code compliant', pages: 1 },
      storage_path: null,
      created_at: now,
    },
    // AC 007 — U-Value Section Details
    {
      id: `${id}-att-uvalue`,
      project_id: id,
      filename: 'AC007_UValue_Section_Details.pdf',
      mime_type: 'application/pdf',
      size_bytes: 3100000,
      attachment_id: 'demo-att-uvalue',
      message_id: email.messageId,
      file_type: 'drawing_pdf',
      discipline: 'hvac',
      extracted_data: { text: 'THERMAL TRANSMITTANCE (U-VALUE) DETAILS\nPlot No: 6457918\nProject: 2B+G+M+SF+R Residential & Commercial Building\nConsultant: RIDGE Engineering Consultant LLC\nAl Sa\'fat Rating: Silver\n\n══════════════════════════════════════════\nWALL SECTIONS\n══════════════════════════════════════════\n\nEXTERNAL WALL (D10):\n  U-Value: 0.57 W/m²K | AvDM Req: 1.792\n  Layers: Plaster cement sand (20mm) → Concrete block (200mm) →\n          Thermal insulation board EPS (50mm, k=0.034) →\n          Plaster cement sand (20mm) → Ceramic tiles\n  Status: COMPLIANT (below 0.57 limit)\n\nEXTERNAL DROP BEAM (D60):\n  U-Value: 1.18 W/m²K | AvDM Req: 3.691\n  Status: COMPLIANT\n\nEXTERNAL COLUMN (D60):\n  U-Value: 1.03 W/m²K | AvDM Req: 3.646\n  Status: COMPLIANT\n\n══════════════════════════════════════════\nROOF SECTION\n══════════════════════════════════════════\n\nROOF (R2):\n  U-Value: 0.38 W/m²K | AvDM Req: 2.211\n  Layers: Ceramic tiles → Light Weight Concrete (LWC, k=0.95) →\n          Thermal insulation board (Foamglass, Type IV, 80mm) →\n          Reinforced Concrete → Plaster cement sand\n  Status: COMPLIANT\n\nROOF SLAB (R2):\n  U-Value: 0.38 | Min ≤ 0.40 W/m²K for Dubai\n\n══════════════════════════════════════════\nFLOOR SECTIONS\n══════════════════════════════════════════\n\nINSULATED GROUND:\n  U-Value: 0.86 W/m²K | AvDM Req: 1.397\n  Status: COMPLIANT\n\nNON-INSULATED GROUND (F14):\n  U-Value: 2.69 W/m²K | AvDM Req: 0.375\n\nTYPICAL FLOOR (J06):\n  U-Value: 2.65 W/m²K\n  Layers: Ceramic tiles → Cement screed → Light Weight Concrete →\n          Reinforced Concrete → Plaster cement sand\n\n══════════════════════════════════════════\nPARTITION\n══════════════════════════════════════════\n\nPARTITION (D18):\n  U-Value: 2.24 W/m²K | AvDM Req: 5.448\n  Layers: Plaster → Concrete block → Rock wool (50mm) →\n          Plaster cement sand\n\nAll sections comply with Dubai Municipality Al Sa\'fat Silver rating requirements.', pages: 1 },
      storage_path: null,
      created_at: now,
    },
    {
      id: `${id}-att-spec`,
      project_id: id,
      filename: 'MEP_Specifications.docx',
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size_bytes: 890000,
      attachment_id: 'demo-att-spec',
      message_id: email.messageId,
      file_type: 'specification',
      discipline: null,
      extracted_data: { text: 'MEP SPECIFICATIONS — ALCAZAR TOWER\nBusiness Bay, Dubai\n\nSECTION 15: HVAC WORKS\n\n15.1 GENERAL\nAll HVAC works shall comply with Dubai Municipality standards and ASHRAE 90.1.\nContractor shall provide complete system including supply, installation, testing & commissioning.\n\n15.2 VRF SYSTEM\n- Brand: Daikin VRV-IV or approved equivalent (Mitsubishi, LG Multi-V)\n- Outdoor units: Air-cooled, inverter-driven scroll compressor\n- Indoor units: Ceiling cassette (4-way) for apartments, ducted for common areas\n- Refrigerant: R-410A\n- COP minimum: 3.8 at ARI conditions\n\n15.3 FRESH AIR HANDLING UNITS (FAHU)\n- Brand: Carrier or Daikin\n- Energy recovery wheel: minimum 70% effectiveness\n- MERV 13 filters\n- EC plug fans\n\n15.4 DUCTWORK\n- Material: Galvanized steel, SMACNA standards\n- Insulation: 25mm closed-cell with aluminium facing\n- Fire dampers at all fire-rated walls\n\n15.5 CONTROLS\n- BACnet-compatible DDC controllers\n- Individual zone temperature control per apartment\n- Central monitoring via BMS\n\nSECTION 16: ELECTRICAL WORKS\n\n16.1 GENERAL\n- DEWA supply: 11kV, 2 transformers (1500 kVA each)\n- Main distribution: MDB with ACB, MCCB breakers\n- Sub-distribution: SMDB per floor, DB per apartment\n\n16.2 LIGHTING\n- LED throughout, minimum CRI 80\n- Emergency lighting: 3-hour battery backup\n- Common area: automated dimming with occupancy sensors\n\nSECTION 17: PLUMBING\n\n17.1 WATER SUPPLY\n- Underground tank: 200,000L (2 days storage)\n- Roof tank: 50,000L\n- Booster pump set: 2+1 duty/standby\n- Pipe material: PPR (hot), CPVC (cold)\n\n17.2 DRAINAGE\n- Soil pipes: uPVC, SDR 41\n- Waste pipes: uPVC\n- Vent system: Full single-stack\n\nSECTION 18: FIRE FIGHTING\n\n18.1 SPRINKLER SYSTEM\n- Wet riser, ordinary hazard Group 1\n- Density: 4.1 mm/min over 72 sqm\n- Fire pump: Electric 100HP + Jockey\n- Diesel standby: 100HP\n\n18.2 HOSE REELS & HYDRANTS\n- Hose reels: Every floor landing\n- Hydrants: As per DCD requirements', pages: 12 },
      storage_path: null,
      created_at: now,
    },
    // AC Layout drawing
    {
      id: `${id}-att-ac-layout`,
      project_id: id,
      filename: 'AC_Layout_Typical_Floor.pdf',
      mime_type: 'application/pdf',
      size_bytes: 8500000,
      attachment_id: 'demo-att-ac-layout',
      message_id: email.messageId,
      file_type: 'drawing_pdf',
      discipline: 'hvac',
      extracted_data: { text: 'AC LAYOUT — TYPICAL FLOOR PLAN\nDrawing No: HVAC-TF-01 Rev.02\nScale: 1:100\n\nRoom Schedule:\n┌─────────────────────┬──────────┬───────────┬──────────────────┐\n│ Room                │ Area sqm │ Load kW   │ Indoor Unit      │\n├─────────────────────┼──────────┼───────────┼──────────────────┤\n│ Apt 01 - Living     │ 32       │ 5.6       │ Cassette (Deco)  │\n│ Apt 01 - Bedroom 1  │ 16       │ 2.8       │ Wall Mount (Deco)│\n│ Apt 01 - Bedroom 2  │ 14       │ 2.5       │ Wall Mount (Deco)│\n│ Apt 02 - Living     │ 28       │ 5.0       │ Cassette (Deco)  │\n│ Apt 02 - Bedroom    │ 18       │ 3.2       │ Wall Mount (Deco)│\n│ Corridor            │ 45       │ 7.1       │ Ducted           │\n│ Lobby               │ 30       │ 5.0       │ Ducted           │\n│ Electrical Room     │ 8        │ 2.0       │ Split (Deco)     │\n└─────────────────────┴──────────┴───────────┴──────────────────┘\n\nVRF Outdoor Unit:\n- OU-TF-01: Located on roof, 28 kW capacity\n- Refrigerant piping: 2 risers (liquid + gas)\n\nDuct Layout Notes:\n- Supply duct: 400×200mm GI from FAHU to corridor\n- Return air: Ceiling plenum with grilles\n- Exhaust: Kitchen & bathroom mechanical extract\n\nFire Dampers: FD-01 to FD-04 at shaft penetrations', pages: 1 },
      storage_path: null,
      created_at: now,
    },
    // Electrical drawing
    {
      id: `${id}-att-elec`,
      project_id: id,
      filename: 'Power_Distribution_SLD.pdf',
      mime_type: 'application/pdf',
      size_bytes: 4200000,
      attachment_id: 'demo-att-elec',
      message_id: email.messageId,
      file_type: 'drawing_pdf',
      discipline: 'electrical',
      extracted_data: { text: 'SINGLE LINE DIAGRAM — POWER DISTRIBUTION\nDrawing No: ELEC-SLD-01 Rev.03\n\nDEWA Supply: 11kV, 2 circuits\n\nTransformers:\n- TR-01: 1500 kVA, 11/0.4 kV, ONAN cooling\n- TR-02: 1500 kVA, 11/0.4 kV, ONAN cooling\n\nMain Distribution Board (MDB):\n- ACB: 4000A, 3P, motorized\n- Bus coupler: 2500A, manual\n- Outgoing feeders: 12 nos MCCB\n\nSMDB per Floor:\n- Incomer: 800A MCCB\n- Apartment DBs: 8 nos × 63A TPN\n- Common lighting: 1 × 100A TPN\n- Fire alarm: 1 × 32A TPN\n\nTotal Connected Load: 2,800 kVA\nDemand Load: 1,680 kVA (60% diversity)\nPower Factor: 0.85 (capacitor bank provided)\n\nEmergency Power:\n- Generator: 500 kVA diesel\n- ATS: Automatic Transfer Switch\n- Covers: Fire pumps, elevators, emergency lighting, smoke extract', pages: 1 },
      storage_path: null,
      created_at: now,
    },
    // Plumbing drawing
    {
      id: `${id}-att-plumb`,
      project_id: id,
      filename: 'Water_Supply_Schematic.pdf',
      mime_type: 'application/pdf',
      size_bytes: 3800000,
      attachment_id: 'demo-att-plumb',
      message_id: email.messageId,
      file_type: 'drawing_pdf',
      discipline: 'plumbing',
      extracted_data: { text: 'WATER SUPPLY SCHEMATIC\nDrawing No: PLB-WS-01 Rev.02\n\nSystem Description:\nDomestic water supply with break pressure tanks\n\nUnderground Tank:\n- Capacity: 200,000 Liters (2 days storage)\n- Material: RC with waterproof lining\n- Municipality connection: 100mm DI\n\nBooster Pump Set:\n- Type: Multi-stage centrifugal\n- Capacity: 2 × 15 L/s @ 55m head (duty/standby)\n- Jockey pump: 1 × 2 L/s @ 60m head\n- VFD controlled\n\nRoof Tank:\n- Capacity: 50,000 Liters\n- Break pressure at Level 15\n- Float valve controlled\n\nPipe Sizing:\n- Riser: 80mm PPR (hot), 100mm CPVC (cold)\n- Branch to apartments: 25mm\n- Individual fixtures: 15mm\n\nFixture Schedule (per floor):\n┌──────────────┬─────┬───────────────┐\n│ Fixture      │ Qty │ Connection    │\n├──────────────┼─────┼───────────────┤\n│ WC           │ 16  │ 15mm cold     │\n│ Wash Basin   │ 16  │ 15mm H+C      │\n│ Kitchen Sink │ 8   │ 15mm H+C      │\n│ Shower       │ 8   │ 15mm H+C      │\n│ Washing Mach │ 8   │ 15mm cold     │\n└──────────────┴─────┴───────────────┘\n\nHot Water:\n- Central calorifier: 2 × 1000L electric\n- Circulation pump: 1 × 0.5 L/s\n- PPR insulated piping', pages: 2 },
      storage_path: null,
      created_at: now,
    },
    // Fire Fighting drawing
    {
      id: `${id}-att-fire`,
      project_id: id,
      filename: 'Sprinkler_Layout_Typical.pdf',
      mime_type: 'application/pdf',
      size_bytes: 5100000,
      attachment_id: 'demo-att-fire',
      message_id: email.messageId,
      file_type: 'drawing_pdf',
      discipline: 'fire_fighting',
      extracted_data: { text: 'SPRINKLER LAYOUT — TYPICAL FLOOR\nDrawing No: FF-SPR-TF-01 Rev.01\n\nSystem: Wet pipe sprinkler, Ordinary Hazard Group 1\nDesign Density: 4.1 mm/min over 72 sqm\nStandard: NFPA 13 + DCD requirements\n\nSprinkler Heads per Floor:\n- Apartments: 48 nos (pendant, concealed, K=80)\n- Corridor: 6 nos (pendant, K=80)\n- Lobby: 4 nos (pendant, K=80)\n- Store rooms: 4 nos (upright, K=80)\n- Total per floor: 62 nos\n\nPiping:\n- Main riser: 100mm ERW, Schedule 40\n- Floor branch: 65mm\n- Cross mains: 50mm\n- Sprinkler drops: 25mm\n\nFire Pump Room (Basement):\n- Electric fire pump: 100 HP, 2500 LPM @ 8 bar\n- Diesel fire pump: 100 HP (standby)\n- Jockey pump: 5 HP\n- Fire water tank: 150,000 L\n\nHose Reels:\n- Each floor landing: 2 nos\n- Hose length: 30m\n- Nozzle: 12mm\n\nFire Hydrants:\n- External: 2 nos (pillar type)\n- Internal: Landing valve each floor', pages: 1 },
      storage_path: null,
      created_at: now,
    },
    // BOQ Excel template
    {
      id: `${id}-att-boq`,
      project_id: id,
      filename: 'BOQ_Template_MEP.xlsx',
      mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size_bytes: 245000,
      attachment_id: 'demo-att-boq',
      message_id: email.messageId,
      file_type: 'schedule_excel',
      discipline: null,
      extracted_data: { text: 'MEP BILL OF QUANTITIES — TEMPLATE\n\nSheet 1: HVAC\n┌─────┬────────────────────────────┬──────┬─────┬──────────┬──────────┐\n│ No  │ Description                │ Unit │ Qty │ Rate AED │ Amount   │\n├─────┼────────────────────────────┼──────┼─────┼──────────┼──────────┤\n│ 1.1 │ VRF Outdoor Unit 28kW      │ No.  │ 3   │          │          │\n│ 1.2 │ VRF Indoor Cassette 5.6kW  │ No.  │ 18  │          │          │\n│ 1.3 │ VRF Indoor Wall Mount 3.5kW│ No.  │ 6   │          │          │\n│ 1.4 │ Ducted Indoor Unit 7.1kW   │ No.  │ 4   │          │          │\n│ 1.5 │ FAHU 2000 CFM              │ No.  │ 1   │          │          │\n│ 1.6 │ Refrigerant Piping         │ LS   │ 1   │          │          │\n│ 1.7 │ GI Ductwork                │ Kg   │ est │          │          │\n│ 1.8 │ Duct Insulation            │ sqm  │ est │          │          │\n│ 1.9 │ Fire Dampers               │ No.  │ est │          │          │\n│ 1.10│ Testing & Commissioning    │ LS   │ 1   │          │          │\n└─────┴────────────────────────────┴──────┴─────┴──────────┴──────────┘\n\nSheet 2: ELECTRICAL\n(Rate columns left blank for contractor to fill)\n\nSheet 3: PLUMBING\n(Rate columns left blank for contractor to fill)\n\nSheet 4: FIRE FIGHTING\n(Rate columns left blank for contractor to fill)', pages: 4 },
      storage_path: null,
      created_at: now,
    },
  ];

  // Add architecture floor plan drawings for projects that have them
  if (email.threadId === 'demo-arch-plans') {
    attachments.push(
      {
        id: `${id}-att-arch-gf`, project_id: id,
        filename: 'ARCH-GF-01_Ground_Floor_Plan.pdf', mime_type: 'application/pdf', size_bytes: 12500000,
        attachment_id: 'att-arch-gf', message_id: email.messageId,
        file_type: 'drawing_pdf', discipline: null,
        extracted_data: { text: 'ARCHITECTURE — GROUND FLOOR PLAN\nDrawing No: ARCH-GF-01 Rev.03\nProject: Creek Vista Residences — Tower A\nArchitect: SOM (Skidmore, Owings & Merrill)\nScale: 1:100\n\n══════════════════════════════════════════════════════════════\nGROUND FLOOR LAYOUT (Total Area: 9,200 sqft)\n══════════════════════════════════════════════════════════════\n\n┌─────────────────────────────────────────────────────────────┐\n│                    MAIN ENTRANCE (North)                     │\n│                    Double-height lobby 6.0m                  │\n├───────────┬─────────────────────────────┬───────────────────┤\n│           │                             │                   │\n│  RETAIL 1 │      MAIN LOBBY             │    RETAIL 2       │\n│  125 sqm  │      280 sqm                │    130 sqm        │\n│  F.F.L:   │      Marble floor           │    F.F.L:         │\n│  +0.300   │      Chandelier 4m drop     │    +0.300         │\n│           │      Reception desk (8m)    │                   │\n├───────────┤      2× Guest seating areas ├───────────────────┤\n│           │      Concierge counter      │                   │\n│  RETAIL 3 │                             │  RETAIL 4         │\n│  95 sqm   ├─────────────────────────────┤  110 sqm          │\n│           │    ELEVATOR LOBBY           │                   │\n│           │    3× Passenger lifts       │                   │\n│           │    1× Service lift          │                   │\n│           │    1× Firefighter lift      │                   │\n├───────────┼─────────────────────────────┼───────────────────┤\n│           │                             │                   │\n│  MGMT     │    SERVICE CORRIDOR         │  ELECTRICAL RM    │\n│  OFFICE   │    2.4m wide                │  45 sqm           │\n│  65 sqm   │                             │  MDB + SMDB       │\n│           │                             │                   │\n├───────────┼──────────┬──────────────────┼───────────────────┤\n│ SECURITY  │ TELECOM  │  FIRE PUMP RM    │  GENERATOR RM     │\n│ ROOM      │ ROOM     │  120 sqm         │  85 sqm           │\n│ 25 sqm    │ 18 sqm   │  FFP + Jockey    │  500 kVA diesel   │\n└───────────┴──────────┴──────────────────┴───────────────────┘\n│                    PARKING RAMP DOWN                         │\n│                    → Basement 1 (120 cars)                   │\n└─────────────────────────────────────────────────────────────┘\n\nKey Dimensions:\n- Building footprint: 42m × 28m\n- Lobby ceiling height: 6.0m (double volume)\n- Retail ceiling height: 4.5m\n- Core: 12m × 8m (5 lifts + 2 stairs)\n- Column grid: 8.4m × 7.0m typical', pages: 1, identified_as: 'architecture_ground_floor_plan' },
        storage_path: null, created_at: now,
      },
      {
        id: `${id}-att-arch-tf`, project_id: id,
        filename: 'ARCH-TF-01_Typical_Floor_Plan.pdf', mime_type: 'application/pdf', size_bytes: 11800000,
        attachment_id: 'att-arch-tf', message_id: email.messageId,
        file_type: 'drawing_pdf', discipline: null,
        extracted_data: { text: 'ARCHITECTURE — TYPICAL FLOOR PLAN (Floors 1–20)\nDrawing No: ARCH-TF-01 Rev.04\nProject: Creek Vista Residences — Tower A\nArchitect: SOM\nScale: 1:100\n\n══════════════════════════════════════════════════════════════\nTYPICAL FLOOR LAYOUT (Total Area: 8,500 sqft / 790 sqm)\n══════════════════════════════════════════════════════════════\n\n┌─────────────────────────────────────────────────────────────┐\n│              NORTH FACADE (Creek View)                       │\n├──────────────────┬──────────────────────┬───────────────────┤\n│                  │                      │                   │\n│   APT 01 (3BR)   │    APT 02 (2BR)     │   APT 03 (1BR)    │\n│   1,450 sqft     │    1,100 sqft       │   680 sqft        │\n│                  │                      │                   │\n│  ┌────┬────┐    │  ┌────┬────┐        │  ┌────┐           │\n│  │Mstr│Mstr│    │  │Mstr│Bath│        │  │Mstr│           │\n│  │Bed │Bath│    │  │Bed │    │        │  │Bed │           │\n│  │18m²│8m² │    │  │16m²│6m² │        │  │14m²│           │\n│  ├────┼────┤    │  ├────┼────┤        │  ├────┤           │\n│  │Bed2│Bed3│    │  │Bed2│    │        │  │    │           │\n│  │14m²│12m²│    │  │12m²│    │        │  │Lvng│           │\n│  ├────┴────┤    │  ├────┘    │        │  │28m²│           │\n│  │ Living  │    │  │ Living  │        │  │    │           │\n│  │ + Dining│    │  │ + Dining│        │  ├────┤           │\n│  │ 42 sqm  │    │  │ 32 sqm  │        │  │Ktch│           │\n│  ├─────────┤    │  ├─────────┤        │  │ 8m²│           │\n│  │ Kitchen │    │  │ Kitchen │        │  └────┘           │\n│  │ 14 sqm  │    │  │ 11 sqm  │        │                   │\n│  └─────────┘    │  └─────────┘        │                   │\n├──────────────────┼──────────────────────┼───────────────────┤\n│    CORRIDOR 2.0m │ ELEVATOR LOBBY       │    CORRIDOR 2.0m  │\n│                  │ 3× Passenger lifts   │                   │\n│                  │ 1× Service lift      │                   │\n│                  │ 1× FF lift           │                   │\n│    STAIR A       │                      │    STAIR B        │\n├──────────────────┼──────────────────────┼───────────────────┤\n│                  │                      │                   │\n│   APT 04 (2BR)   │    APT 05 (2BR)     │   APT 06 (1BR)    │\n│   1,100 sqft     │    1,100 sqft       │   680 sqft        │\n│   (same as 02)   │    (same as 02)     │   (same as 03)    │\n│                  │                      │                   │\n└──────────────────┴──────────────────────┴───────────────────┘\n│              SOUTH FACADE (City View)                        │\n\nUnit Mix Per Floor:\n┌──────────┬──────┬───────────┬─────────────┬──────────────────┐\n│ Unit Type│ Qty  │ Area sqft │ Bedrooms    │ Balcony sqft     │\n├──────────┼──────┼───────────┼─────────────┼──────────────────┤\n│ 3BR      │ 1    │ 1,450     │ 3 + Maid    │ 180 (Creek view) │\n│ 2BR      │ 3    │ 1,100     │ 2           │ 120              │\n│ 1BR      │ 2    │ 680       │ 1           │ 80               │\n├──────────┼──────┼───────────┼─────────────┼──────────────────┤\n│ TOTAL    │ 6    │ 6,810     │             │ 700              │\n│ Common   │      │ 1,690     │             │                  │\n│ Total FL │      │ 8,500     │             │                  │\n└──────────┴──────┴───────────┴─────────────┴──────────────────┘\n\nTotal Apartments: 120 (6 per floor × 20 floors)\n\nStructural Grid: 8.4m × 7.0m\nFloor-to-Floor: 3.2m\nCeiling Height (finished): 2.85m\nSlab Thickness: 200mm post-tensioned\nCurtain Wall: Double-glazed, low-E, U=1.8 W/m²K', pages: 1, identified_as: 'architecture_typical_floor_plan' },
        storage_path: null, created_at: now,
      },
      {
        id: `${id}-att-arch-sec`, project_id: id,
        filename: 'ARCH-SEC-01_Building_Section.pdf', mime_type: 'application/pdf', size_bytes: 9500000,
        attachment_id: 'att-arch-sec', message_id: email.messageId,
        file_type: 'drawing_pdf', discipline: null,
        extracted_data: { text: 'ARCHITECTURE — BUILDING SECTION A-A\nDrawing No: ARCH-SEC-01 Rev.02\nProject: Creek Vista Residences — Tower A\nArchitect: SOM\nScale: 1:200\n\n══════════════════════════════════════════════════════════════\nVERTICAL SECTION (North–South through Core)\n══════════════════════════════════════════════════════════════\n\n  ┌─────────────────────────────┐  +73.600 ROOF LEVEL\n  │ ROOF PLANT ROOM             │  Chillers, FAHU, Cooling Towers\n  │ Height: 4.5m                │  Waterproofing + insulation\n  ├─────────────────────────────┤  +69.100\n  │ 20TH FLOOR  (Typical)       │  FFL +66.100\n  │ C.H: 2.85m  Slab: 200mm PT │\n  ├─────────────────────────────┤  +65.900\n  │ 19TH FLOOR  (Typical)       │  FFL +62.900\n  ├─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┤\n  │  ... 18 typical floors ...  │  Each: 3.2m F-to-F\n  │  Floor heights uniform      │  Ceiling: 2.85m\n  │  Slab: 200mm PT concrete    │  Services zone: 0.35m\n  ├─────────────────────────────┤\n  │ 1ST FLOOR  (Typical)        │  FFL +8.500\n  ├═════════════════════════════┤  +5.300 PODIUM LEVEL\n  │ PODIUM FLOOR                │  FFL +5.000\n  │ Height: 4.2m                │  Gym, pool, amenity deck\n  │ Swimming pool: 25m lap      │  Pool plant below\n  ├═════════════════════════════┤  +0.800\n  │ GROUND FLOOR                │  FFL +0.300\n  │ Height: 4.5m (double lobby) │  Retail + main entrance\n  │ Lobby ceiling: 6.0m         │  Chandelier zone\n  ├═════════════════════════════┤  −3.200 BASEMENT 1\n  │ BASEMENT 1                  │  FFL −3.500\n  │ Height: 3.0m                │  Parking: 120 cars\n  │ Fire-rated: 2 hours         │  MEP rooms, water tanks\n  ├─────────────────────────────┤  −6.200 BASEMENT 2\n  │ BASEMENT 2                  │  FFL −6.500\n  │ Height: 3.0m                │  Parking: 110 cars\n  │ UG Water Tank: 250,000L     │  Fire water: 200,000L\n  ├═════════════════════════════┤  −9.200 FOUNDATION\n  │ RAFT FOUNDATION             │  1.2m thick RC raft\n  │ Piles: 600mm dia × 20m     │  Bored piles to rock\n  └─────────────────────────────┘  −10.400\n\nTotal Building Height: 73.6m (above ground)\nTotal Below Ground: 9.2m\nOverall Height: 82.8m\n\nFire Compartments:\n- Each floor = 1 compartment (< 1,000 sqm)\n- Basements: 2-hour fire rating\n- Stairwells: 2-hour pressurized\n- Refuge areas: Every 5th floor\n\nWaterproofing:\n- Basements: Crystalline + membrane\n- Roof: Built-up with 80mm insulation\n- Podium deck: Inverted roof system', pages: 1, identified_as: 'architecture_building_section' },
        storage_path: null, created_at: now,
      },
      {
        id: `${id}-att-arch-elv`, project_id: id,
        filename: 'ARCH-ELV-01_Building_Elevations.pdf', mime_type: 'application/pdf', size_bytes: 14000000,
        attachment_id: 'att-arch-elv', message_id: email.messageId,
        file_type: 'drawing_pdf', discipline: null,
        extracted_data: { text: 'ARCHITECTURE — BUILDING ELEVATIONS\nDrawing No: ARCH-ELV-01 Rev.02\nProject: Creek Vista Residences — Tower A\nArchitect: SOM\nScale: 1:200\n\n══════════════════════════════════════════════════════════════\nNORTH ELEVATION (Creek View — Primary Facade)\n══════════════════════════════════════════════════════════════\n\nMaterial Schedule:\n- Levels 1-20: Unitized curtain wall system\n  - Vision glass: Double-glazed, low-E, 6+12A+6mm\n  - Spandrel: Back-painted glass, insulated\n  - Mullions: Aluminium, powder-coated RAL 7016\n  - U-value: 1.8 W/m²K, SHGC: 0.35\n\n- Ground Level: Frameless glass shopfront\n  - 12mm tempered + 12mm laminated\n  - Auto sliding doors: 2 sets main entrance\n\n- Podium: Aluminium composite panel (ACP)\n  - Finish: Champagne gold anodized\n  - Ventilated rain-screen system\n\n- Roof Plant Screen: Perforated aluminium\n  - 40% open area for ventilation\n  - Conceals chillers and FAHU units\n\nWindow-to-Wall Ratio (WWR):\n- North: 65% (creek view — maximized)\n- South: 45% (city view)\n- East: 40%\n- West: 35% (sun protection priority)\n- Overall: 46% — Dubai Municipality compliant\n\nBalcony Details:\n- Glass railing: 12mm tempered, 1.2m height\n- Depth: 1.5m (3BR), 1.2m (2BR), 1.0m (1BR)\n- Soffit: Exposed concrete with protective coating\n\n══════════════════════════════════════════════════════════════\nSOUTH ELEVATION\n══════════════════════════════════════════════════════════════\n- Similar curtain wall system\n- Reduced glazing ratio (45%)\n- External shading fins at 1.2m spacing\n- Podium: Solid wall with feature lighting', pages: 2, identified_as: 'architecture_elevations' },
        storage_path: null, created_at: now,
      },
      {
        id: `${id}-att-arch-dwg`, project_id: id,
        filename: 'ARCH-TF-01_Typical_Floor.dwg', mime_type: 'application/acad', size_bytes: 25000000,
        attachment_id: 'att-arch-dwg', message_id: email.messageId,
        file_type: 'drawing_autocad', discipline: null,
        extracted_data: { text: 'AutoCAD DWG File — Architecture Typical Floor Plan\nDrawing No: ARCH-TF-01\nFile size: 25 MB\nLayers: 142 (ARCH-WALL, ARCH-DOOR, ARCH-WINDOW, ARCH-DIM, ARCH-FURN, ARCH-HATCH, MEP-HVAC, MEP-ELEC, MEP-PLMB, STRUCT-COL, STRUCT-BEAM, ...)\n\nThis is an AutoCAD .dwg file. To view the full drawing:\n- Open in AutoCAD, BricsCAD, or DraftSight\n- Or use a free online DWG viewer (Autodesk Viewer, ShareCAD)\n\nExtracted layer summary:\n- 6 apartments per floor (3BR×1, 2BR×3, 1BR×2)\n- Core: 5 elevators + 2 fire stairs\n- Column grid: 8.4m × 7.0m\n- Curtain wall perimeter: ~140 linear meters\n- Balconies: 6 nos per floor', pages: null, identified_as: 'architecture_autocad_floor_plan' },
        storage_path: null, created_at: now,
      },
      {
        id: `${id}-att-arch-roof`, project_id: id,
        filename: 'ARCH-RF-01_Roof_Plan.pdf', mime_type: 'application/pdf', size_bytes: 8200000,
        attachment_id: 'att-arch-roof', message_id: email.messageId,
        file_type: 'drawing_pdf', discipline: null,
        extracted_data: { text: 'ARCHITECTURE — ROOF PLAN\nDrawing No: ARCH-RF-01 Rev.02\nProject: Creek Vista Residences — Tower A\nArchitect: SOM\nScale: 1:100\n\n══════════════════════════════════════════════════════════════\nROOF LAYOUT (Total Area: 9,800 sqft / 910 sqm)\n══════════════════════════════════════════════════════════════\n\n┌─────────────────────────────────────────────────────────────┐\n│                                                             │\n│  ┌───────────┐  ┌───────────┐  ┌───────────────────────┐   │\n│  │ CHILLER 1 │  │ CHILLER 2 │  │  FAHU-01 (8,000 CFM)  │   │\n│  │ 200 TR    │  │ 150 TR    │  │  Energy recovery wheel│   │\n│  │ Air-cooled│  │ Air-cooled│  │  MERV13 filters       │   │\n│  │ 6.0×2.5m │  │ 5.0×2.2m │  │  5.0×2.0m             │   │\n│  └───────────┘  └───────────┘  └───────────────────────┘   │\n│                                                             │\n│  ┌───────────────────────┐  ┌──────────────────────────┐   │\n│  │  FAHU-02 (8,000 CFM)  │  │ COOLING TOWER (future)   │   │\n│  │  Energy recovery wheel│  │ Provision only           │   │\n│  │  5.0×2.0m             │  │ 4.0×4.0m pad             │   │\n│  └───────────────────────┘  └──────────────────────────┘   │\n│                                                             │\n│  ┌──────────┐  ┌──────────┐  ┌──────────────────────────┐  │\n│  │ CHW PUMP │  │ CHW PUMP │  │ ELECTRICAL PANEL ROOM    │  │\n│  │ SET 1    │  │ SET 2    │  │ 25 sqm                   │  │\n│  │ 2+1      │  │ 2+1      │  │ ATS, Generator MCB       │  │\n│  └──────────┘  └──────────┘  └──────────────────────────┘  │\n│                                                             │\n│  Maintenance walkway: 1.5m around all equipment            │\n│  Perforated screen wall: 2.4m height (all sides)           │\n│  Crane access: Hook point at 2 locations                   │\n│  Drainage: Floor drain to condensate recovery tank          │\n│                                                             │\n└─────────────────────────────────────────────────────────────┘\n\nEquipment Weights (for structural):\n- Chiller 1: 12,500 kg operating\n- Chiller 2: 9,800 kg operating\n- FAHU (each): 3,200 kg\n- Pump sets: 1,500 kg each\n\nNoise: Plant room screen designed for 55 dB(A) at boundary', pages: 1, identified_as: 'architecture_roof_plan' },
        storage_path: null, created_at: now,
      },
    );
  }

  // Inject preview SVGs into any attachments that have them
  for (const att of attachments) {
    const svg = att.attachment_id ? getDrawingPreview(att.attachment_id) : null;
    if (svg) {
      const ed = att.extracted_data as Record<string, unknown> || {};
      att.extracted_data = { ...ed, preview_svg: svg };
    }
  }

  // HVAC service with estimation data from meta
  const services: Service[] = [
    {
      id: `${id}-svc-hvac`,
      project_id: id,
      service_type: 'hvac',
      is_required: true,
      system_type: meta.systemType,
      total_kw: meta.totalKw,
      fahu_kw: meta.fahuKw,
      ac_unit_kw: meta.acKw,
      tonnage: meta.tonnage,
      unit_rate_aed: meta.rate,
      quantity: 1,
      total_aed: meta.acPrice,
      notes: `${meta.formula}: ${meta.tonnage} TR × ${meta.rate.toLocaleString()} AED/TR = ${meta.acPrice.toLocaleString()} AED.${meta.fahuPrice > 0 ? ` FAHU: 1 unit × ${meta.fahuCfm.toLocaleString()} CFM × 8.5 AED/CFM = ${meta.fahuPrice.toLocaleString()} AED.` : ''} Total HVAC = ${meta.totalHvac.toLocaleString()} AED.`,
      ai_extraction: {
        system_type: meta.systemCode,
        formula_used: meta.formula,
        total_kw: meta.totalKw,
        fahu_kw: meta.fahuKw,
        ac_kw: meta.acKw,
        tonnage_tr: meta.tonnage,
        rate_aed_per_tr: meta.rate,
        ac_price: meta.acPrice,
        fahu_price: meta.fahuPrice,
        total_hvac_price: meta.totalHvac,
        decorative_count: meta.decorativeCount,
        ducted_count: meta.ductedCount,
        predominantly: meta.predominantly,
        fahu_count: meta.fahuPrice > 0 ? 1 : 0,
        fahu_flow_cfm: meta.fahuCfm,
        steps: [
          { step: 10, name: 'Open Thermal Load Drawing', output: 'Found thermal load drawing in HVAC folder', status: 'completed' },
          { step: 11, name: 'Extract Total KW', output: `Total Cooling Load = ${meta.totalKw} kW`, status: 'completed' },
          { step: 12, name: 'Extract FAHU KW', output: `FAHU Load = ${meta.fahuKw} kW${meta.fahuCfm > 0 ? ` (${meta.fahuCfm.toLocaleString()} CFM)` : ''}`, status: 'completed' },
          { step: 13, name: 'Calculate AC Unit KW', calculation: `${meta.totalKw} kW − ${meta.fahuKw} kW = ${meta.acKw} kW`, output: `AC Unit Load = ${meta.acKw} kW`, status: 'completed' },
          { step: 14, name: 'Identify AC System Type', output: `${meta.systemType} — ${meta.predominantly} (${meta.ductedCount} ducted, ${meta.decorativeCount} decorative)`, status: 'completed' },
          { step: 15, name: 'Calculate Tonnage', calculation: `${meta.acKw} kW ÷ 3.517 = ${meta.tonnage} TR`, output: `Tonnage = ${meta.tonnage} TR`, status: 'completed' },
          { step: 16, name: 'Formula-Based Pricing', calculation: `AC: ${meta.tonnage} TR × ${meta.rate.toLocaleString()} AED/TR = AED ${meta.acPrice.toLocaleString()}${meta.fahuPrice > 0 ? `\nFAHU: ${meta.fahuCfm.toLocaleString()} CFM × 8.5 AED/CFM = AED ${meta.fahuPrice.toLocaleString()}` : ''}\nTotal HVAC = AED ${meta.totalHvac.toLocaleString()}`, output: `Total HVAC Price = AED ${meta.totalHvac.toLocaleString()}`, status: 'completed' },
        ],
        // Component-level BOQ line items
        line_items: calculateHVACComponentEstimate({
          systemCode: meta.systemCode,
          tonnage: meta.tonnage,
          totalAreaSqm: Math.round(meta.totalArea / 10.764),
          floors: meta.floors,
          parkingFloors: meta.parking,
          ductedCount: meta.ductedCount,
          decorativeCount: meta.decorativeCount,
          fahuCount: meta.fahuPrice > 0 ? 1 : 0,
          fahuCfm: meta.fahuCfm,
        }),
        // Multi-system breakdown (BT Change 1)
        sub_systems: generateDemoSubSystems(email.threadId, meta),
        // Floor-by-floor breakdown (BT Change 2)
        floor_breakdown: generateDemoFloorBreakdown(email.threadId, meta),
        // Equipment schedule (BT Change 3)
        equipment_schedule_items: generateDemoEquipmentSchedule(email.threadId, meta),
      },
      created_at: now,
      updated_at: now,
    },
  ];

  // Estimation
  const costPerSqft = meta.totalArea > 0 ? Math.round(meta.totalHvac / meta.totalArea * 10) / 10 : 0;
  const yardstickMin = Math.round(meta.totalHvac * 0.8);
  const yardstickMax = Math.round(meta.totalHvac * 1.3);
  const finalQuote = Math.round(meta.totalHvac * 1.15);

  const estimation: Estimation = {
    id: `${id}-est`,
    project_id: id,
    total_aed: meta.totalHvac,
    cost_per_sqft_aed: costPerSqft,
    yardstick_min_aed: yardstickMin,
    yardstick_max_aed: yardstickMax,
    yardstick_status: 'within_range',
    margin_percent: 15,
    final_quote_aed: finalQuote,
    george_approved: false,
    approved_at: null,
    generated_boq_url: null,
    sent_at: null,
    created_at: now,
    updated_at: now,
  };

  // Activity log — early-stage: steps 1-5 (paused at gate 6), advanced: steps 1-15 (paused at gate 16)
  const baseLog: ActivityLog[] = [
    { id: `${id}-log-1`, project_id: id, step: 1, step_name: 'Identify Email', status: 'completed', details: { email: email.from, to: 'estimation@realsoft.example' }, created_at: new Date(Date.now() - 50 * 60000).toISOString() },
    { id: `${id}-log-2`, project_id: id, step: 2, step_name: 'Identify Enquiry', status: 'completed', details: { keywords_found: ['please quote', 'best price', 'rfq'], confidence: 0.95 }, created_at: new Date(Date.now() - 49 * 60000).toISOString() },
    { id: `${id}-log-3`, project_id: id, step: 3, step_name: 'Add to Bid List', status: 'completed', details: { project_id: id }, created_at: new Date(Date.now() - 48 * 60000).toISOString() },
    { id: `${id}-log-4`, project_id: id, step: 4, step_name: 'Unzip Attachments', status: 'completed', details: { has_attachments: true, count: email.attachments.length, files_extracted: 16 }, created_at: new Date(Date.now() - 45 * 60000).toISOString() },
    { id: `${id}-log-5`, project_id: id, step: 5, step_name: 'List Drawings & BOQ', status: 'completed', details: { total_files: 16, folders: ['HVAC', 'Electrical', 'Plumbing'] }, created_at: new Date(Date.now() - 40 * 60000).toISOString() },
  ];

  const advancedLog: ActivityLog[] = [
    { id: `${id}-log-7`, project_id: id, step: 7, step_name: 'Match Ideal Customer', status: 'completed', details: { matched: true, tier: 'tier_a' }, created_at: new Date(Date.now() - 35 * 60000).toISOString() },
    { id: `${id}-log-8`, project_id: id, step: 8, step_name: 'Extract Project Info', status: 'completed', details: { floors: meta.floors, parking: meta.parking, area_per_floor: meta.areaPerFloor, total_area: meta.totalArea, height: meta.height, reputation: 'tier_a', building_type: meta.buildingType }, created_at: new Date(Date.now() - 30 * 60000).toISOString() },
    { id: `${id}-log-9`, project_id: id, step: 9, step_name: 'Confirm Scope to Client', status: 'completed', details: { services: ['hvac', 'electrical', 'plumbing', 'fire_fighting'] }, created_at: new Date(Date.now() - 25 * 60000).toISOString() },
    { id: `${id}-log-11`, project_id: id, step: 11, step_name: 'Detect Drawing Scale', status: 'completed', details: { source: 'scale_bar', m_per_px: 0.025 }, created_at: new Date(Date.now() - 20 * 60000).toISOString() },
    { id: `${id}-log-13`, project_id: id, step: 13, step_name: 'Count Components', status: 'completed', details: { ac_units: 24, panels: 8, fixtures: 120 }, created_at: new Date(Date.now() - 15 * 60000).toISOString() },
    { id: `${id}-log-15`, project_id: id, step: 15, step_name: 'Per-Service Pricing', status: 'completed', details: { system: meta.systemType, tonnage_tr: meta.tonnage, total_hvac: meta.totalHvac }, created_at: new Date(Date.now() - 12 * 60000).toISOString() },
  ];

  const activity_log = isEarlyStage ? baseLog : [...baseLog, ...advancedLog];

  const project: ProjectDetail = {
    id,
    email_thread_id: email.threadId,
    email_message_id: email.messageId,
    email_from: email.from,
    email_subject: email.subject,
    email_date: email.date,
    email_snippet: email.snippet,
    client_name: extractClientName(email.from),
    project_name: extractProjectName(email.subject),
    location: meta.location,
    priority,
    status: (isEarlyStage ? 'scope_pending' : 'pricing_pending') as ProjectStatus,
    floors: meta.floors,
    parking_floors: meta.parking,
    typical_floors: meta.typical,
    area_per_floor_sqft: meta.areaPerFloor,
    total_area_sqft: meta.totalArea,
    typical_height_m: meta.height,
    building_type: meta.buildingType,
    deadline: null,
    reputation_class: 'tier_a',
    notes: JSON.stringify({ approval_gate: isEarlyStage ? 11 : 24 }),
    ai_classification: { isRfq: true, confidence: 0.95, keywords: ['please quote', 'best price'] },
    ai_extraction: { floors: meta.floors, parking: meta.parking, area: meta.totalArea, height: meta.height },
    final_quote_aed: null,
    created_at: email.date,
    updated_at: now,
    attachments,
    services,
    estimation,
    activity_log,
  };

  projectStore.set(id, project);
  return project;
}

// ---- Initialize from demo emails ----
function ensureInitialized(): void {
  if (isInitialized()) return;
  markInitialized();

  const emails = getDemoEmails();
  // Create project from first RFQ email only (not George's reply)
  const rfqEmails = emails.filter(e =>
    !e.from.includes('george@') && e.subject.toLowerCase().includes('rfq') || e.subject.toLowerCase().includes('tender')
  );
  rfqEmails.forEach(createDemoProjectFromEmail);
}

// ---- Public API ----
export function getDemoProjects(): ProjectDetail[] {
  ensureInitialized();
  return Array.from(projectStore.values()).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

export function getDemoProject(id: string): ProjectDetail | undefined {
  ensureInitialized();
  return projectStore.get(id);
}

export function scanDemoInbox(): { created: number; projectIds: string[] } {
  ensureInitialized();
  const emails = getDemoEmails();
  const created: string[] = [];

  for (const email of emails) {
    const id = `demo-proj-${email.threadId}`;
    if (!projectStore.has(id) && !email.from.includes('george@')) {
      createDemoProjectFromEmail(email);
      created.push(id);
    }
  }

  return { created: created.length, projectIds: created };
}

export function approveDemoGate(projectId: string): boolean {
  const project = projectStore.get(projectId);
  if (!project) return false;

  const notes = project.notes ? JSON.parse(project.notes) : {};
  const gate = notes.approval_gate;
  if (!gate) return false;

  // Gate approval auto-advances through intermediate steps to the NEXT gate.
  // 23-step pipeline (4-phase redesign) gates: 6, 10, 16, 20, 23.
  const gateTransitions: Record<number, { status: ProjectStatus; nextGate: number | null; logSteps: Array<{ step: number; name: string }> }> = {
    6: {
      status: 'services_identified',
      nextGate: 10,
      logSteps: [
        { step: 6, name: 'Document Sufficiency Check' },
        { step: 7, name: 'Match Ideal Customer' },
        { step: 9, name: 'Confirm Scope to Client' },
      ],
    },
    10: {
      status: 'estimated',
      nextGate: 16,
      logSteps: [
        { step: 10, name: 'Bid / No-Bid Decision' },
        { step: 11, name: 'Detect Drawing Scale' },
        { step: 13, name: 'Count Components' },
        { step: 15, name: 'Per-Service Pricing' },
      ],
    },
    16: {
      status: 'estimated',
      nextGate: 20,
      logSteps: [
        { step: 16, name: 'Confirm Quantities & Pricing' },
        { step: 17, name: 'Apply Rate Library' },
        { step: 18, name: 'Internet Price Search' },
        { step: 19, name: 'Calculate Total with Margin' },
      ],
    },
    20: {
      status: 'quotation_ready',
      nextGate: 23,
      logSteps: [
        { step: 20, name: 'Confirm Total' },
        { step: 21, name: 'Yardstick Check' },
        { step: 22, name: 'Prepare Quotation' },
      ],
    },
    23: {
      status: 'sent',
      nextGate: null,
      logSteps: [
        { step: 23, name: 'Send Quotation' },
      ],
    },
  };

  const transition = gateTransitions[gate];
  if (!transition) return false;

  // Update status and set next gate
  project.status = transition.status;
  project.notes = transition.nextGate
    ? JSON.stringify({ approval_gate: transition.nextGate })
    : JSON.stringify({});
  project.updated_at = nowISO();

  // Add activity log entries for completed steps
  const now = Date.now();
  for (let i = 0; i < transition.logSteps.length; i++) {
    const s = transition.logSteps[i];
    const logId = `${projectId}-log-auto-${gate}-${s.step}`;
    // Don't duplicate if already exists
    if (!project.activity_log.find(l => l.step === s.step)) {
      project.activity_log.unshift({
        id: logId,
        project_id: projectId,
        step: s.step,
        step_name: s.name,
        status: 'completed',
        details: { auto_advanced: true, approved_gate: gate },
        created_at: new Date(now - (transition.logSteps.length - i) * 30000).toISOString(),
      });
    }
  }

  return true;
}

export function rejectDemoGate(projectId: string, reason: string): boolean {
  const project = projectStore.get(projectId);
  if (!project) return false;

  const notes = project.notes ? JSON.parse(project.notes) : {};
  const gate = notes.approval_gate;

  // All gates: reject = decline the project
  project.status = 'declined';
  project.notes = JSON.stringify({
    rejected_gate: gate,
    previous_status: project.status,
    rejected_at: nowISO(),
    rejection_reason: reason || 'No reason provided',
  });
  project.updated_at = nowISO();
  return true;
}
