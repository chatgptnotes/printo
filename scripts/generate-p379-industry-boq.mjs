// Generate the Dubai industry-standard 13-bill MEP electrical BOQ for P-379:
//   docs/p379-power-boq-industry.xlsx
//
// Same project + corrections as the simpler tender BOQ, but rendered in the
// 13-bill format Dubai consultants expect for client submission.
//
// Usage: npm run boq:p379-industry  (or: node scripts/generate-p379-industry-boq.mjs)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateDubaiIndustryBoqXlsx } from './lib/dubai-industry-boq-xlsx.mjs';
import { lookupRate } from './lib/dubai-2026-rates.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO_ROOT  = resolve(__dirname, '..');

try {
  for (const line of readFileSync(resolve(REPO_ROOT, '.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch {
  console.warn('⚠ .env.local not found — falling back to embedded P-379 fixture');
}

const P379_PROJECT_ID = '16cd9625-3d9f-46ce-a63d-2324c03bd43d';

let project, electrical;

if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const { data: p } = await supabase.from('sabi_projects').select('*').eq('id', P379_PROJECT_ID).single();
  project = p || p379Fixture().project;

  const { data: svc } = await supabase.from('sabi_services')
    .select('ai_extraction').eq('project_id', P379_PROJECT_ID).eq('service_type', 'electrical').single();
  const raw = svc?.ai_extraction?.raw_electrical_procedure;
  electrical = raw || p379Fixture().electrical;
} else {
  const fx = p379Fixture();
  project = fx.project;
  electrical = fx.electrical;
}

mergeFixtureFallbacks(electrical, p379Fixture().electrical);
const corrections = applyCorrections(electrical);

const overrides = {
  project_name:        'Proposed B+G+8+R Commercial & Residential Building',
  location:            'Al Barsha South Third, Dubai, UAE',
  plot_no:             '6731315',
  owner:               'Qutaiba Ameen Abdal Kija',
  architect:           'Engr. Samer Mahmoud Ajami (Reg. 105181)',
  structural_engineer: 'Engr. Mohamad Maher Myaser Jabban (Reg. 101079)',
  consultant:          'Future Art Engineering Consultancy',
  job_no:              'FA_P379 / CRs B/010/25',
  drawing_set:         'P-001 … P-300 (14 sheets, Power Layout)',
  drawing_date:        '16.01.2026',
  authority:           'DEWA (Dubai Electricity & Water Authority)',
  boq_date:            new Date().toLocaleDateString('en-GB'),
  addendum_no:         '0',
};

let rateStats = null;
const options = {
  contingency_pct: 0.10,
  vat_pct: 0.05,
  currency: 'AED',
  status: 'PRICED (INDICATIVE) — Dubai 2026 market rates · review before submission',
  reconciliation_notes: [
    ...corrections,
    'Rate column F populated with INDICATIVE Dubai 2026 market rates (see scripts/lib/dubai-2026-rates.mjs). Review every line and adjust to actual supplier quotations before tender submission.',
  ],
  rateLookup: lookupRate,
  onRateStats: (s) => { rateStats = s; },
};

const docsDir = resolve(REPO_ROOT, 'docs');
if (!existsSync(docsDir)) mkdirSync(docsDir, { recursive: true });

console.log('Generating Dubai industry-standard 13-bill BOQ…');
const xlsxBuf = await generateDubaiIndustryBoqXlsx({ project, electrical, overrides, options });
writeFileSync(resolve(docsDir, 'p379-power-boq-industry.xlsx'), xlsxBuf);
console.log(`✅ docs/p379-power-boq-industry.xlsx (${(xlsxBuf.length / 1024).toFixed(1)} KB)`);

if (rateStats) {
  const total = rateStats.populated + rateStats.skipped;
  const pct = total > 0 ? Math.round((rateStats.populated / total) * 100) : 0;
  console.log(`\nRates populated: ${rateStats.populated}/${total} priceable rows (${pct}%) · ${rateStats.skipped} skipped (no confident match — review manually)`);
}

console.log('\nReconciliation notes applied:');
corrections.forEach(n => console.log(`  • ${n}`));

// ─── Helpers ────────────────────────────────────────────────────────────
function mergeFixtureFallbacks(live, fixture) {
  for (const k of ['lv_panels', 'containment', 'earthing', 'mechanical_equipment', 'power_outlets', 'metering', 'bulk_cables']) {
    if (!Array.isArray(live[k]) || live[k].length === 0) live[k] = fixture[k] || [];
  }
  if (!live.incoming_supply) live.incoming_supply = {};
  for (const k of ['transformers', 'generator', 'ats', 'hv_ducts', 'mobile_generator_provision']) {
    const lv = live.incoming_supply[k];
    const fx = fixture.incoming_supply?.[k];
    const lvEmpty = lv == null || (Array.isArray(lv) && lv.length === 0);
    if (lvEmpty && fx != null) live.incoming_supply[k] = fx;
  }
}

function applyCorrections(e) {
  const notes = [];
  for (const c of (e?.cable_schedule || [])) {
    const isLvp01 = /^LVP-?0?1$/i.test(c.from || '');
    const isTypicalRiser = /^SMDB-?[1-8]F\b|SMDB-?TF/i.test(c.to || '');
    if (isLvp01 && isTypicalRiser && Number(c.size_mm2) === 300) c.size_mm2 = 150;
  }
  notes.push('LVP-01 → SMDB-1F…8F risers sized at 4C × 150mm² (PDF wins; XLSX source had 300mm², which is oversized for the 256 A load).');

  for (const c of (e?.cable_schedule || [])) {
    const isFire = /fire ?pump/i.test(c.circuit_description || '') || /fire ?pump/i.test(c.to || '');
    if (isFire && Number(c.size_mm2) === 300) {
      c.size_mm2 = 185; c.cores = 4;
      if (c.circuit_description) c.circuit_description = c.circuit_description.replace(/2 ?× ?/i, '').trim();
    }
  }
  notes.push('Fire-pump feeder sized at 1×4C 185mm² FR + 1C 95mm² ECC (PDF wins; XLSX source had 2×4C 300mm² FR, which is oversized for 167 A start).');

  for (const c of (e?.cable_schedule || [])) {
    const isEsmdbG = /^ESMDB-?G\b/i.test(c.to || '');
    if (isEsmdbG && Number(c.size_mm2) < 300) {
      c.size_mm2 = 300;
      if (c.circuit_description) c.circuit_description = c.circuit_description.replace(/\b(\d+)\s*mm2\s*FIRE\s*RATED/i, '300mm2 FIRE RATED');
    }
  }
  notes.push('ESMDB-G feeder sized at 4C × 300mm² FR (XLSX wins; PDF source had a 70mm² value in section 4 vs 300mm² in section 8.7 — 70mm² is undersized by ~3× for the 338 A load).');

  const ls = e?.load_summary || [];
  const tcl = ls.reduce((s, x) => s + (Number(x?.tcl_kw) || 0), 0);
  const md  = ls.reduce((s, x) => s + (Number(x?.max_demand_kw) || 0), 0);
  if (tcl <= 0) {
    e.load_summary = [
      { panel: 'LVP-01 (residential risers + EV)',                 tcl_kw: 1206.89, standby_kw: 0,    demand_factor: 0.80, max_demand_kw: 965.51 },
      { panel: 'LVP-02 (services + retail + roof + essential)',     tcl_kw: 910.17,  standby_kw: 23.0, demand_factor: 0.69, max_demand_kw: 631.34 },
    ];
    const fxTcl = e.load_summary.reduce((s, x) => s + x.tcl_kw, 0);
    const fxMd  = e.load_summary.reduce((s, x) => s + x.max_demand_kw, 0);
    notes.push(`Building totals on Cover (TCL ${fxTcl.toFixed(2)} kW · MD ~${Math.round(fxMd)} kW · DF ${(fxMd / fxTcl).toFixed(2)}) sourced from comparison PDF — no load_summary in live extraction.`);
  } else {
    notes.push(`Building totals on Cover: TCL ${tcl.toFixed(2)} kW · MD ~${Math.round(md)} kW · DF ${(md / tcl).toFixed(2)} (mandatory for quotation per comparison verdict).`);
  }
  return notes;
}

function p379Fixture() {
  const project = {
    id: P379_PROJECT_ID,
    project_name: 'Proposed B+G+8+R Commercial & Residential Building',
    location: 'Al Barsha South Third, Dubai, UAE',
    client_name: 'Qutaiba Ameen Abdal Kija',
    consultant: 'Future Art Engineering Consultancy',
    floors: 14,
    ai_extraction: {
      plot_no: '6731315',
      architect: 'Engr. Samer Mahmoud Ajami (Reg. 105181)',
      structural_engineer: 'Engr. Mohamad Maher Myaser Jabban (Reg. 101079)',
      consultant: 'Future Art Engineering Consultancy',
      drawing_set: 'P-001 … P-300 (14 sheets)',
      job_no: 'FA_P379 / CRs B/010/25',
    },
  };
  const electrical = {
    drawings_found: [], floors_identified: 14,
    floor_labels: ['UG', 'G', '1F', '2F', '3F', '4F', '5F', '6F', '7F', '8F', 'RF', 'UR'],
    typical_floor_height_m: 3.5, drawing_scale: '1:100', scale_detected: true,
    mdb_info: { location: 'GF LV Room', rating_a: 2000, floor: 'G', tag: 'LVP-01' },
    schematic_available: true, schematic_filename: 'P-200',
    smdb_inventory: [], lv_to_smdb_cables: [], db_inventory: [], db_groups: [],
    smdb_to_db_cables: [], cable_schedule: [], bulk_cables: [],
    incoming_supply: {
      transformers: [
        { kva: 1000, voltage_ratio: '11kV/400V', count: 1 },
        { kva: 1500, voltage_ratio: '11kV/400V', count: 1 },
      ],
      generator: { kva: 300, type: 'diesel' }, ats: { rating_a: 400 },
      hv_ducts: null, mobile_generator_provision: null,
    },
    lv_panels: [
      { tag: 'LVP-01', main_acb_rating_a: 2000, main_acb_breaking_ka: 50,
        outgoing_mccbs: [{ to: 'SMDB-1F..8F', rating_a: 300, count: 8 }],
        capacitor_bank_kvar: null, capacitor_banks: [{ kvar: 375, isolator_rating_a: null }] },
      { tag: 'LVP-02', main_acb_rating_a: 1600, main_acb_breaking_ka: 50,
        outgoing_mccbs: [
          { to: 'SMDB-RF', rating_a: 500, count: 1 },
          { to: 'SMDB-EV', rating_a: 160, count: 1 },
          { to: 'SMDB-G',  rating_a: 125, count: 1 },
          { to: 'SMDB-SH01..12', rating_a: 50, count: 12 },
          { to: 'ESMDB-G', rating_a: 400, count: 1 },
          { to: 'Fire Pump', rating_a: 350, count: 1 },
        ],
        capacitor_bank_kvar: null, capacitor_banks: [{ kvar: 275, isolator_rating_a: null }] },
    ],
    mechanical_equipment: [
      { description: 'FAHU (Fresh Air Handling Unit)', rating_kw: 174.66, rating_a: null, count: 1 },
      { description: 'Fire pump (jockey + main + diesel cooling)', rating_kw: 98, rating_a: null, count: 1 },
      { description: 'EV chargers (7 kW + 22 kW points)', rating_kw: 88, rating_a: null, count: 10 },
    ],
    power_outlets: [],
    containment: [
      { description: 'GI hot-dip galvanised cable ladder, 500mm wide × 100mm side rail (vertical riser shaft, UG to Roof)', unit: 'm', estimated_qty: 40 },
      { description: 'GI hot-dip galvanised cable ladder, 300mm wide × 100mm side rail (horizontal at each floor riser→SMDB)', unit: 'm', estimated_qty: 130 },
      { description: 'GI perforated cable tray, 200mm wide × 50mm deep (corridor distribution 1F–8F)', unit: 'm', estimated_qty: 400 },
      { description: 'GI perforated cable tray, 100mm wide × 50mm deep (branch distribution to DBs)', unit: 'm', estimated_qty: 300 },
      { description: 'GI perforated cable tray, 200mm wide × 50mm deep (Ground floor retail/common)', unit: 'm', estimated_qty: 100 },
      { description: 'GI perforated cable tray, 300mm wide × 75mm deep (Roof mechanical)', unit: 'm', estimated_qty: 80 },
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
      { description: 'Supplementary bonding conductor 4mm² — pipework, trays, equipment frames (provisional)', unit: 'Sum', qty: 1 },
    ],
    metering: [],
    load_summary: [
      { panel: 'LVP-01 (residential risers + EV)',                 tcl_kw: 1206.89, standby_kw: 0,    demand_factor: 0.80, max_demand_kw: 965.51 },
      { panel: 'LVP-02 (services + retail + roof + essential)',     tcl_kw: 910.17,  standby_kw: 23.0, demand_factor: 0.69, max_demand_kw: 631.34 },
    ],
    confidence: 0.85, step_log: [],
  };
  return { project, electrical };
}
