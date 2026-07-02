// Generate the priceable tender BOQ for project P-379:
//   - docs/p379-power-boq.xlsx (rateable workbook, 9 sheets)
//   - docs/p379-power-boq-tender.pdf (paired print/preview PDF)
//
// Runs the engineering corrections from PDF_vs_XLSX_Comparison.pdf in-memory
// against the loaded ElectricalProcedureResult before generating, and surfaces
// them in the Cover-sheet reconciliation banner.
//
// Usage: node scripts/generate-p379-tender-boq.mjs

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateTenderBoqXlsx } from './lib/tender-boq-xlsx.mjs';
import { generateTenderBoqPdf } from './lib/tender-boq-pdf.mjs';
import { lookupRate } from './lib/dubai-2026-rates.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO_ROOT  = resolve(__dirname, '..');

// ─── Load .env.local ─────────────────────────────────────────────────────
try {
  for (const line of readFileSync(resolve(REPO_ROOT, '.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch {
  console.warn('⚠ .env.local not found — falling back to embedded P-379 fixture');
}

const P379_PROJECT_ID = '16cd9625-3d9f-46ce-a63d-2324c03bd43d';

// ─── Load project + electrical data ──────────────────────────────────────
let project, electrical;

if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const { data: p, error: pErr } = await supabase.from('sabi_projects').select('*').eq('id', P379_PROJECT_ID).single();
  if (pErr || !p) {
    console.warn('⚠ Could not load project from Supabase:', pErr?.message || 'not found — using fixture');
    project = p379Fixture().project;
  } else {
    project = p;
  }

  const { data: svc, error: sErr } = await supabase.from('sabi_services')
    .select('ai_extraction').eq('project_id', P379_PROJECT_ID).eq('service_type', 'electrical').single();
  const raw = svc?.ai_extraction?.raw_electrical_procedure;
  if (sErr || !raw) {
    console.warn('⚠ Could not load electrical extraction:', sErr?.message || 'not found — using fixture');
    electrical = p379Fixture().electrical;
  } else {
    electrical = raw;
  }
} else {
  console.warn('⚠ Supabase env vars not set — using embedded P-379 fixture');
  const fx = p379Fixture();
  project = fx.project;
  electrical = fx.electrical;
}

// ─── Merge fixture fallbacks for fields the live AI extraction left empty ──
mergeFixtureFallbacks(electrical, p379Fixture().electrical);

// ─── Apply engineering corrections from PDF_vs_XLSX_Comparison.pdf ────────
const corrections = applyCorrections(electrical);

// ─── Cover-sheet metadata overrides + reconciliation notes ───────────────
const overrides = {
  project_name:         'Proposed B+G+8+R Commercial & Residential Building',
  location:             'Al Barsha South Third, Dubai, UAE',
  plot_no:              '6731315',
  owner:                'Qutaiba Ameen Abdal Kija',
  architect:            'Engr. Samer Mahmoud Ajami (Reg. 105181)',
  structural_engineer:  'Engr. Mohamad Maher Myaser Jabban (Reg. 101079)',
  consultant:           'Future Art Engineering Consultancy',
  job_no:               'FA_P379 / CRs B/010/25',
  drawing_set:          'P-001 … P-300 (14 sheets, Power Layout)',
  drawing_date:         '16.01.2026',
  authority:            'DEWA (Dubai Electricity & Water Authority)',
  boq_date:             new Date().toLocaleDateString('en-GB'),
};

const options = {
  contingency_pct: 0.10,
  vat_pct: 0.05,
  currency: 'AED',
  status: 'PRICED (INDICATIVE) — Dubai 2026 market rates · review before submission',
  reconciliation_notes: [
    ...corrections,
    'Rate column F populated with INDICATIVE Dubai 2026 rates from scripts/lib/dubai-2026-rates.mjs. Review and adjust to actual supplier quotations before tender submission.',
  ],
  rateLookup: lookupRate,
};

// ─── Generate ────────────────────────────────────────────────────────────
const docsDir = resolve(REPO_ROOT, 'docs');
if (!existsSync(docsDir)) mkdirSync(docsDir, { recursive: true });

console.log('Generating XLSX…');
const xlsxBuf = await generateTenderBoqXlsx({ project, electrical, overrides, options });
writeFileSync(resolve(docsDir, 'p379-power-boq.xlsx'), xlsxBuf);
console.log(`✅ docs/p379-power-boq.xlsx (${(xlsxBuf.length / 1024).toFixed(1)} KB)`);

console.log('Generating paired PDF…');
const pdfBuf = await generateTenderBoqPdf({ project, electrical, overrides, options });
writeFileSync(resolve(docsDir, 'p379-power-boq-tender.pdf'), pdfBuf);
console.log(`✅ docs/p379-power-boq-tender.pdf (${(pdfBuf.length / 1024).toFixed(1)} KB)`);

console.log('\nReconciliation notes applied:');
corrections.forEach(n => console.log(`  • ${n}`));

// ─── Merge fixture fallbacks ─────────────────────────────────────────────
// AI extractions often leave structural sections empty (lv_panels,
// containment, mechanical_equipment, etc.). For P-379 we have a known-good
// fixture; merge it in for any field where the live data is empty/missing.
function mergeFixtureFallbacks(live, fixture) {
  for (const k of [
    'lv_panels', 'containment', 'earthing', 'mechanical_equipment',
    'power_outlets', 'metering', 'bulk_cables',
  ]) {
    if (!Array.isArray(live[k]) || live[k].length === 0) live[k] = fixture[k] || [];
  }
  // incoming_supply: per-field fallback (don't overwrite a live ATS with a null fixture)
  if (!live.incoming_supply) live.incoming_supply = {};
  for (const k of ['transformers', 'generator', 'ats', 'hv_ducts', 'mobile_generator_provision']) {
    const lv = live.incoming_supply[k];
    const fx = fixture.incoming_supply?.[k];
    const lvEmpty = lv == null || (Array.isArray(lv) && lv.length === 0);
    if (lvEmpty && fx != null) live.incoming_supply[k] = fx;
  }
}

// ─── Corrections function ────────────────────────────────────────────────
// Apply the engineering verdicts from PDF_vs_XLSX_Comparison.pdf:
//   • LVP-01 → SMDB-1F…8F sized at 150mm² (PDF wins; XLSX's 300mm² oversized)
//   • Fire-pump feeder sized at 1×4C 185mm² FR (PDF wins; XLSX's 2×4C 300mm² oversized)
//   • ESMDB-G feeder sized at 4C 300mm² FR (XLSX wins; PDF section 4 had 70mm² which was undersized)
//
// Returns a list of human-readable notes describing the reconciliation —
// always emitted, so the Cover banner shows the contractor what the BOQ
// resolves to vs the source data, regardless of whether this run modified anything.
function applyCorrections(e) {
  const notes = [];

  // ── LVP-01 risers ─────────────────────────────────────────────────────
  for (const c of (e?.cable_schedule || [])) {
    const isLvp01 = /^LVP-?0?1$/i.test(c.from || '');
    const isTypicalRiser = /^SMDB-?[1-8]F\b|SMDB-?TF/i.test(c.to || '');
    if (isLvp01 && isTypicalRiser && Number(c.size_mm2) === 300) {
      c.size_mm2 = 150;
    }
  }
  notes.push('LVP-01 → SMDB-1F…8F risers sized at 4C × 150mm² (PDF wins; XLSX source had 300mm², which is oversized for the 256 A load).');

  // ── Fire-pump feeder ──────────────────────────────────────────────────
  for (const c of (e?.cable_schedule || [])) {
    const isFire = /fire ?pump/i.test(c.circuit_description || '') || /fire ?pump/i.test(c.to || '');
    if (isFire && Number(c.size_mm2) === 300) {
      c.size_mm2 = 185;
      c.cores = 4;
      if (c.circuit_description) c.circuit_description = c.circuit_description.replace(/2 ?× ?/i, '').trim();
    }
  }
  notes.push('Fire-pump feeder sized at 1×4C 185mm² FR + 1C 95mm² ECC (PDF wins; XLSX source had 2×4C 300mm² FR, which is oversized for 167 A start).');

  // ── ESMDB-G feeder ────────────────────────────────────────────────────
  for (const c of (e?.cable_schedule || [])) {
    const isEsmdbG = /^ESMDB-?G\b/i.test(c.to || '');
    if (isEsmdbG && Number(c.size_mm2) < 300) {
      c.size_mm2 = 300;
      // Rewrite size text inside the parenthetical circuit_description so the
      // BOQ line doesn't show "300mm²" in the main spec but "70mm²" in remarks.
      if (c.circuit_description) c.circuit_description = c.circuit_description.replace(/\b(\d+)\s*mm2\s*FIRE\s*RATED/i, '300mm2 FIRE RATED');
    }
  }
  notes.push('ESMDB-G feeder sized at 4C × 300mm² FR (XLSX wins; PDF source had a 70mm² value in section 4 vs 300mm² in section 8.7 — 70mm² is undersized by ~3× for the 338 A load).');

  // ── Building totals ───────────────────────────────────────────────────
  const ls = e?.load_summary || [];
  const tcl = ls.reduce((s, x) => s + (Number(x?.tcl_kw) || 0), 0);
  const md  = ls.reduce((s, x) => s + (Number(x?.max_demand_kw) || 0), 0);
  if (tcl <= 0) {
    e.load_summary = [
      { panel: 'LVP-01 (residential risers + EV)',                 tcl_kw: 1206.89, standby_kw: 0,    demand_factor: 0.80, max_demand_kw: 965.51 },
      { panel: 'LVP-02 (services + retail + roof + essential)',     tcl_kw: 910.17,  standby_kw: 23.0, demand_factor: 0.69, max_demand_kw: 631.34 },
    ];
    notes.push('Building totals on Cover (TCL 2,117.06 kW · MD ~1,597 kW · DF 0.80) sourced from comparison PDF — no load_summary in live extraction.');
  } else {
    notes.push(`Building totals on Cover: TCL ${tcl.toFixed(2)} kW · MD ~${Math.round(md)} kW · DF ${(md / tcl).toFixed(2)} (mandatory for quotation per comparison verdict).`);
  }

  return notes;
}

// ─── P-379 fixture (used when Supabase data is unavailable) ──────────────
function p379Fixture() {
  const project = {
    id: P379_PROJECT_ID,
    project_name: 'Proposed B+G+8+R Commercial & Residential Building',
    location: 'Al Barsha South Third, Dubai, UAE',
    client_name: 'Qutaiba Ameen Abdal Kija',
    consultant: 'Future Art Engineering Consultancy',
    floors: 14,
    building_type: 'commercial_residential',
    ai_extraction: {
      plot_no: '6731315',
      architect: 'Engr. Samer Mahmoud Ajami (Reg. 105181)',
      structural_engineer: 'Engr. Mohamad Maher Myaser Jabban (Reg. 101079)',
      consultant: 'Future Art Engineering Consultancy',
      drawing_set: 'P-001 … P-300 (14 sheets)',
      job_no: 'FA_P379 / CRs B/010/25',
    },
  };

  // Cable lengths from the user-supplied tender XLSX template (per-run remarks)
  const electrical = {
    drawings_found: [
      { filename: 'P-200.pdf', type: 'schematic', floor: 'all' },
      { filename: 'P-201.pdf', type: 'schematic', floor: 'all' },
      { filename: 'P-300.pdf', type: 'schematic', floor: 'all' },
    ],
    floors_identified: 14,
    floor_labels: ['UG', 'G', '1F', '2F', '3F', '4F', '5F', '6F', '7F', '8F', 'RF', 'UR'],
    typical_floor_height_m: 3.5,
    drawing_scale: '1:100',
    scale_detected: true,
    mdb_info: { location: 'Ground Floor LV Room', rating_a: 2000, floor: 'G', tag: 'LVP-01' },
    schematic_available: true,
    schematic_filename: 'P-200',

    smdb_inventory: [
      { id: 'SMDB-1F', floor: '1F', rating_a: 300, cable_size_from_mdb: '4C 150mm² XLPE/SWA/PVC', connected_load_kw: 150.86, qty: 1 },
      { id: 'SMDB-2F', floor: '2F', rating_a: 300, cable_size_from_mdb: '4C 150mm² XLPE/SWA/PVC', connected_load_kw: 150.86, qty: 1 },
      { id: 'SMDB-3F', floor: '3F', rating_a: 300, cable_size_from_mdb: '4C 150mm² XLPE/SWA/PVC', connected_load_kw: 150.86, qty: 1 },
      { id: 'SMDB-4F', floor: '4F', rating_a: 300, cable_size_from_mdb: '4C 150mm² XLPE/SWA/PVC', connected_load_kw: 150.86, qty: 1 },
      { id: 'SMDB-5F', floor: '5F', rating_a: 300, cable_size_from_mdb: '4C 150mm² XLPE/SWA/PVC', connected_load_kw: 150.86, qty: 1 },
      { id: 'SMDB-6F', floor: '6F', rating_a: 300, cable_size_from_mdb: '4C 150mm² XLPE/SWA/PVC', connected_load_kw: 150.86, qty: 1 },
      { id: 'SMDB-7F', floor: '7F', rating_a: 300, cable_size_from_mdb: '4C 150mm² XLPE/SWA/PVC', connected_load_kw: 150.86, qty: 1 },
      { id: 'SMDB-8F', floor: '8F', rating_a: 300, cable_size_from_mdb: '4C 150mm² XLPE/SWA/PVC', connected_load_kw: 150.86, qty: 1 },
      { id: 'SMDB-G',  floor: 'G',  rating_a: 125, cable_size_from_mdb: '4C 50mm² XLPE/SWA/PVC',  connected_load_kw: 60.55,  qty: 1 },
      { id: 'SMDB-RF', floor: 'RF', rating_a: 500, cable_size_from_mdb: '2×4C 150mm² XLPE/SWA/PVC', connected_load_kw: 248.63, qty: 1 },
      { id: 'SMDB-EV', floor: 'G',  rating_a: 160, cable_size_from_mdb: '4C 70mm² XLPE/SWA/PVC',  connected_load_kw: 88.00,  qty: 1 },
      { id: 'SMDB-SH 01-12', floor: 'G', rating_a: 50, cable_size_from_mdb: '4C 10mm² XLPE/SWA/PVC', connected_load_kw: null, qty: 12 },
      { id: 'ESMDB-G', floor: 'G',  rating_a: 400, cable_size_from_mdb: '4C 300mm² FR',           connected_load_kw: 199.13, qty: 1 },
      { id: 'ESMDB-RF',floor: 'RF', rating_a: 160, cable_size_from_mdb: '4C 70mm² FR',            connected_load_kw: 82.69,  qty: 1 },
    ],

    lv_to_smdb_cables: [],

    db_inventory: [],
    db_groups: [
      { tag_pattern: 'Apartment DB (typical floor 1F–8F, 8 units/floor)', per_floor_qty: 8, floors: 8, total_qty: 64, tcl_range_kw: '7.42 – 16.32' },
      { tag_pattern: 'Common Area / Corridor DB per floor (1F–8F)',       per_floor_qty: 1, floors: 8, total_qty: 8,  tcl_range_kw: null },
      { tag_pattern: 'Emergency DB per floor EDB-xF (1F–8F)',              per_floor_qty: 1, floors: 8, total_qty: 8,  tcl_range_kw: null },
      { tag_pattern: 'DB-G-01..04 (Lobby / Car Park / Services / Fire ctrl)',           per_floor_qty: null, floors: null, total_qty: 4, tcl_range_kw: null },
      { tag_pattern: 'Retail Shop internal DB (DB-SH01..12)',              per_floor_qty: null, floors: null, total_qty: 12, tcl_range_kw: null },
      { tag_pattern: 'DB-RF-01..04 (Mechanical/plant — AHU, pumps, pool)', per_floor_qty: null, floors: null, total_qty: 4,  tcl_range_kw: null },
      { tag_pattern: 'DB-RF-05..09 (EV charger + common area roof)',       per_floor_qty: null, floors: null, total_qty: 5,  tcl_range_kw: null },
      { tag_pattern: 'DB-EV-01..04 (Lift / Elevator panels)',              per_floor_qty: null, floors: null, total_qty: 4,  tcl_range_kw: null },
      { tag_pattern: 'Emergency DBs EDB-G-01..04, EDB-RF-01..02',          per_floor_qty: null, floors: null, total_qty: 6,  tcl_range_kw: null },
    ],

    smdb_to_db_cables: [
      { from: 'SMDB-1F..8F', to: 'Apartment DBs (8/floor × 8 = 64)', size_mm2: 16, length_m: 960, confidence: 'medium', cores: 4 },
      { from: 'SMDB-1F..8F', to: 'Common Area DBs (1/floor × 8)',     size_mm2: 10, length_m: 200, confidence: 'medium', cores: 4 },
      { from: 'SMDB-G',  to: 'DB-G-01..04 (lobby/carpark/svcs/fire)', size_mm2: 10, length_m: 65,  confidence: 'medium', cores: 4 },
      { from: 'SMDB-G',  to: 'Retail shop internal DBs (12)',         size_mm2: 10, length_m: 60,  confidence: 'medium', cores: 4 },
      { from: 'SMDB-EV', to: 'DB-EV-01..04 (lift panels)',            size_mm2: 10, length_m: 26,  confidence: 'medium', cores: 4 },
      { from: 'SMDB-RF', to: 'DB-RF-01..04 (mechanical/plant)',       size_mm2: 16, length_m: 78,  confidence: 'medium', cores: 4 },
      { from: 'SMDB-RF', to: 'DB-RF-05..09 (EV charger + common)',    size_mm2: 10, length_m: 82,  confidence: 'medium', cores: 4 },
      { from: 'ESMDB-G', to: 'EDB-G-01..04 (emergency lighting/FA/CCTV/stairs)', size_mm2: 10, length_m: 77, confidence: 'high', cores: 4, type: 'FR' },
      { from: 'ESMDB-RF',to: 'EDB-RF-01..02 (roof emergency)',         size_mm2: 10, length_m: 25,  confidence: 'high', cores: 4, type: 'FR' },
      { from: 'SMDB-1F..8F', to: 'EDB-xF (per residential floor)',    size_mm2: 10, length_m: 40,  confidence: 'medium', cores: 4, type: 'FR' },
    ],

    cable_schedule: [
      // C1 — XLPE/SWA/PVC LV→SMDB main feeders
      { from: 'LVP-01', to: 'SMDB-1F..8F (8 risers)', size_mm2: 300, length_m: 254, type: 'XLPE/SWA/PVC', circuit_description: '8 runs: 20+24+27+30+33+37+40+43m', confidence: 'high', cores: 4 },
      { from: 'LVP-02', to: 'SMDB-RF', size_mm2: 150, length_m: 96,  type: 'XLPE/SWA/PVC', circuit_description: '2 parallel runs × 48m', confidence: 'high', cores: 4 },
      { from: 'LVP-02', to: 'SMDB-EV', size_mm2: 70,  length_m: 17,  type: 'XLPE/SWA/PVC', circuit_description: '1 run × 17m', confidence: 'high', cores: 4 },
      { from: 'LVP-02', to: 'SMDB-G',  size_mm2: 50,  length_m: 17,  type: 'XLPE/SWA/PVC', circuit_description: '1 run × 17m', confidence: 'high', cores: 4 },
      { from: 'LVP-02', to: 'SMDB-SH01..12 (12 retail)', size_mm2: 10, length_m: 630, type: 'XLPE/SWA/PVC', circuit_description: '12 runs, 22–83m each', confidence: 'medium', cores: 4 },

      // C2 — Fire-Rated LV→Essential
      { from: 'LVP-02', to: 'Fire Pump panel', size_mm2: 300, length_m: 54, type: 'FR', circuit_description: '2 parallel runs × 27m via ATS', confidence: 'high', cores: 4 },
      { from: 'LVP-02', to: 'ESMDB-G', size_mm2: 300, length_m: 9, type: 'FR', circuit_description: 'Generator-backed emergency board', confidence: 'high', cores: 4 },
      { from: 'ESMDB-G', to: 'ESMDB-RF', size_mm2: 70, length_m: 48, type: 'FR', circuit_description: 'Roof emergency rising main', confidence: 'high', cores: 4 },
    ],

    bulk_cables: [],

    incoming_supply: {
      transformers: [],
      generator: { kva: 300, type: 'diesel' },
      ats: { rating_a: 400 },
      hv_ducts: null,
      mobile_generator_provision: null,
    },
    lv_panels: [
      {
        tag: 'LVP-01',
        main_acb_rating_a: 2000,
        main_acb_breaking_ka: 50,
        outgoing_mccbs: [
          { to: 'SMDB-1F..8F', rating_a: 300, count: 8 },
        ],
        capacitor_bank_kvar: null,
        capacitor_banks: [{ kvar: 375, isolator_rating_a: null }],
      },
      {
        tag: 'LVP-02',
        main_acb_rating_a: 1600,
        main_acb_breaking_ka: 50,
        outgoing_mccbs: [
          { to: 'SMDB-RF', rating_a: 500, count: 1 },
          { to: 'SMDB-EV', rating_a: 160, count: 1 },
          { to: 'SMDB-G',  rating_a: 125, count: 1 },
          { to: 'SMDB-SH01..12', rating_a: 50, count: 12 },
          { to: 'ESMDB-G', rating_a: 400, count: 1 },
          { to: 'Fire Pump', rating_a: 350, count: 1 },
        ],
        capacitor_bank_kvar: null,
        capacitor_banks: [{ kvar: 275, isolator_rating_a: null }],
      },
    ],
    mechanical_equipment: [
      { description: 'FAHU (Fresh Air Handling Unit)', rating_kw: 174.66, rating_a: null, count: 1 },
      { description: 'Fire pump (jockey + main + diesel cooling)', rating_kw: 98, rating_a: null, count: 1 },
      { description: 'EV chargers (7 kW + 22 kW points)', rating_kw: 88, rating_a: null, count: 10 },
    ],
    power_outlets: [],
    containment: [
      { description: 'GI Hot-dip galvanised cable ladder, 500mm × 100mm side rail (vertical riser shaft, UG to Roof)', unit: 'm', estimated_qty: 40 },
      { description: 'GI Hot-dip galvanised cable ladder, 300mm × 100mm side rail (horizontal at each floor riser→SMDB)', unit: 'm', estimated_qty: 130 },
      { description: 'GI perforated cable tray, 200mm × 50mm (corridor distribution 1F–8F)', unit: 'm', estimated_qty: 400 },
      { description: 'GI perforated cable tray, 100mm × 50mm (branch distribution to DBs)', unit: 'm', estimated_qty: 300 },
      { description: 'GI perforated cable tray, 200mm × 50mm (Ground floor retail/common)', unit: 'm', estimated_qty: 100 },
      { description: 'GI perforated cable tray, 300mm × 75mm (Roof mechanical)', unit: 'm', estimated_qty: 80 },
      { description: '25mm uPVC conduit c/w draw wire, saddles, junction boxes', unit: 'm', estimated_qty: 535 },
      { description: '32mm uPVC conduit (cable tray to SMDB at each floor)', unit: 'm', estimated_qty: 80 },
      { description: '20mm uPVC conduit (final-circuit drops to outlets)', unit: 'm', estimated_qty: 400 },
      { description: '25mm GI rigid conduit — fire-rated for emergency cable routes (staircase wells, fire shafts)', unit: 'm', estimated_qty: 200 },
    ],
    earthing: [
      { description: 'Main earth bar (MEB) in LV room — 50×6mm copper busbar, drilled and labelled, c/w insulators and fixing', unit: 'Nr', qty: 2 },
      { description: 'Earth pit (BS 7430 / DEWA) — 1200mm copper-bonded steel earth rod, inspection chamber, backfill, conductor clamp. Test < 1 Ω', unit: 'Nr', qty: 4 },
      { description: '1C × 95mm² bare copper earth conductor — MEB to earth pits and DEWA earth terminal', unit: 'm', qty: 30 },
      { description: '1C × 50mm² green/yellow PVC earth conductor — MEB to structural steel bonding points, water/gas entry', unit: 'm', qty: 40 },
      { description: '1C × 35mm² green/yellow XLPE earth conductor — MEB to sub-earth bar at each SMDB', unit: 'm', qty: 400 },
      { description: '1C × 10mm² green/yellow PVC earth conductor — SMDB earth bar to each DB on residential floors', unit: 'm', qty: 600 },
      { description: 'Supplementary bonding conductor 4mm² — pipework, trays, equipment frames (provisional)', unit: 'Item', qty: 1 },
    ],
    metering: [],
    load_summary: [
      { panel: 'LVP-01 (residential risers + EV)',                 tcl_kw: 1206.89, standby_kw: 0,    demand_factor: 0.80, max_demand_kw: 965.51 },
      { panel: 'LVP-02 (services + retail + roof + essential)',     tcl_kw: 910.17,  standby_kw: 23.0, demand_factor: 0.69, max_demand_kw: 631.34 },
    ],
    confidence: 0.85,
    step_log: [],
  };

  return { project, electrical };
}
