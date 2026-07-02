// Regenerate the corrected P-379 POWER BOQ from this drawing's extraction,
// through the PRODUCTION code (enrich → generate). Lighting is left to the
// honest fallback (📋 estimate) because the POWER drawing has no lighting legend.
// Run: npx tsx scripts/regen-p379-power-boq.ts
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { lookupRate } from '../src/lib/excel/dubai-2026-rates';
import { enrichElectricalResult } from '../src/lib/electrical/derive-cable-paths';
import { generateDubaiIndustryBoqXlsx } from '../src/lib/excel/dubai-industry-boq-xlsx';

async function main() {
  const electrical: any = JSON.parse(readFileSync(resolve('tests/fixtures/p379-result.json'), 'utf8'));
  const enriched = enrichElectricalResult(electrical);

  const project = {
    project_name: 'Proposed B+G+8+R Commercial & Residential Building',
    location: 'Al Barsha South Third, Dubai, UAE',
    plot_no: '6731315', floors: 14, ai_extraction: {},
  };
  const overrides = {
    project_name: 'Proposed B+G+8+R Commercial & Residential Building',
    location: 'Al Barsha South Third, Dubai, UAE',
    plot_no: '6731315', owner: 'Qutaiba Ameen Abdal Kija',
    consultant: 'Future Art Engineering Consultancy',
    job_no: 'FA_P379 / CRs B/010/25', drawing_set: 'P-001 … P-300 (14 sheets, Power)',
    authority: 'DEWA (Dubai Electricity & Water Authority)',
  };

  let rateStats: any = null;
  const buf = await generateDubaiIndustryBoqXlsx({
    project, electrical: enriched, overrides,
    options: {
      contingency_pct: 0.10, vat_pct: 0.05, currency: 'AED',
      status: 'PRICED (INDICATIVE) — Dubai 2026 rates · POWER scope · review before submission',
      rateLookup: lookupRate,
      onRateStats: (s: any) => { rateStats = s; },
    },
  });

  if (!existsSync('docs')) mkdirSync('docs', { recursive: true });
  const out = resolve('docs/p379-power-boq-corrected.xlsx');
  writeFileSync(out, buf);

  const cs = enriched.cable_schedule || [];
  const perDb = cs.filter((c: any) => /SMDB-?\d+F/i.test(c.from) && /^DB-T\d+$/i.test(c.to)).length;
  console.log('P-379 POWER BOQ regenerated from drawing extraction:');
  console.log('  file:', out, `(${(buf.length / 1024).toFixed(0)} KB)`);
  console.log('  apartment DB feeders enumerated per floor:', perDb);
  console.log('  SMDBs after dedupe:', (enriched.smdb_inventory || []).length);
  console.log('  lighting fixtures from drawing:', (enriched.lighting_fixtures || []).length, '(0 = POWER drawing has no lighting legend → Bill 8 = estimate)');
  if (rateStats) console.log(`  rates populated: ${rateStats.populated}/${rateStats.populated + rateStats.skipped}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
