// One-off verification: drive the PRODUCTION code (enrichElectricalResult +
// generateDubaiIndustryBoqXlsx) over the real P-379 extraction fixture and prove
// the methodology fixes. Run: npx tsx scripts/verify-p379-improvements.ts
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import ExcelJS from 'exceljs';
import { enrichElectricalResult } from '../src/lib/electrical/derive-cable-paths';
import { generateDubaiIndustryBoqXlsx } from '../src/lib/excel/dubai-industry-boq-xlsx';

async function main() {
  const e: any = JSON.parse(readFileSync(resolve('tests/fixtures/p379-result.json'), 'utf8'));

  // The old extraction predates the lighting step — inject drawing-read fixtures
  // to exercise the new floor-wise Bill 8 (type refs from P-379's legend).
  e.lighting_fixtures = [
    { type_ref: 'B-01', description: 'Recessed LED downlight 12W (apartments)', floor: 'First Floor', qty: 48, provisional: false },
    { type_ref: 'D-7',  description: 'Surface LED panel 600×600 (lobby/corridor)', floor: 'First Floor', qty: 6, provisional: false },
    { type_ref: 'ALD-2', description: 'Decorative amenity fixture (gym)', floor: 'Roof Floor', qty: 20, provisional: true },
  ];

  const before = {
    aggregated: (e.cable_schedule || []).filter((c: any) => /to DB-|odd floor|even floor/i.test(c.to)).length,
    tfInventory: (e.smdb_inventory || []).filter((s: any) => /SMDB-?TF/i.test(s.id)).length,
  };

  const enriched: any = enrichElectricalResult(e);
  const sched = enriched.cable_schedule || [];
  const perDb = sched.filter((c: any) => /SMDB-?\d+F/i.test(c.from) && /^DB-T\d+$/i.test(c.to));
  const aggLeft = sched.filter((c: any) => /to DB-|odd floor|even floor/i.test(c.to));
  const tfLeft = (enriched.smdb_inventory || []).filter((s: any) => /SMDB-?TF/i.test(s.id)).length;
  const lvTf = sched.filter((c: any) => /SMDB-?TF/i.test(c.to)).length;

  console.log('── Cable expansion + SMDB dedupe ──');
  console.log(`  aggregated SMDB→DB rows:        ${before.aggregated} → ${aggLeft.length}   (expect 0)`);
  console.log(`  apartment per-DB rows (SMDB-nF→DB-Tnn): ${perDb.length}   (expect 60)`);
  console.log(`  TF stacks in inventory:         ${before.tfInventory} → ${tfLeft}   (expect 0)`);
  console.log(`  LV→SMDB-TF duplicate feeders:   ${lvTf}   (expect 0)`);
  console.log(`  total SMDB→DB cables:           ${(enriched.smdb_to_db_cables || []).length}`);

  // Pass a trivial rate lookup so we can confirm the rate lands in the Rate
  // column (not Qty) under Bill 5's 9-column layout.
  const buf = await generateDubaiIndustryBoqXlsx({
    project: { project_name: 'P-379 Verify', location: 'Al Barsha South, Dubai', plot_no: '6731315', floors: 14, ai_extraction: {} },
    electrical: enriched, overrides: {}, options: { rateLookup: () => 100 },
  });
  if (!existsSync('docs')) mkdirSync('docs', { recursive: true });
  writeFileSync('docs/p379-verify.xlsx', buf);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  const b5 = wb.getWorksheet('Bill 5 - LV Cables')!;
  console.log('\n── Bill 5 layout ──');
  console.log('  header:', [1, 2, 3, 4, 5, 6, 7, 8, 9].map(c => b5.getRow(3).getCell(c).value).join(' | '));
  let sample: any = null;
  b5.eachRow((row) => { if (!sample && String(row.getCell(1).value || '').startsWith('5.3.')) sample = row; });
  if (sample) {
    const cell = (n: number) => { const v = sample.getCell(n).value; return v && v.formula ? `=${v.formula}` : v; };
    console.log('  sample 5.3 row cells 1..9:');
    console.log('    1 Item   :', JSON.stringify(cell(1)));
    console.log('    2 Size   :', JSON.stringify(cell(2)));
    console.log('    3 Desc   :', JSON.stringify(cell(3)));
    console.log('    4 Ref    :', JSON.stringify(cell(4)));
    console.log('    5 Unit   :', JSON.stringify(cell(5)));
    console.log('    6 Qty    :', JSON.stringify(cell(6)));
    console.log('    7 Rate   :', JSON.stringify(cell(7)));
    console.log('    8 Amount :', JSON.stringify(cell(8)));
    console.log('    9 Origin :', JSON.stringify(cell(9)));
  }
  // Confirm the Summary pulls Bill 5's total from column H (its total moved right).
  const sum = wb.getWorksheet('Summary of Bills')!;
  let b5SumFormula: any = null;
  sum.eachRow((row) => { if (row.getCell(1).value === 5) b5SumFormula = (row.getCell(4).value as any)?.formula; });
  console.log('  Summary → Bill 5 total ref:', b5SumFormula);

  const b8 = wb.getWorksheet('Bill 8 - Lighting Fixtures')!;
  const bands: string[] = [];
  b8.eachRow((row) => { const v = row.getCell(1).value; if (typeof v === 'string' && /LIGHTING FIXTURES$/.test(v)) bands.push(v); });
  console.log('\n── Bill 8 (floor-wise) ──');
  console.log(`  floor bands: ${bands.length}`);
  bands.forEach(b => console.log('   ', b));
  // lighting was injected (from-drawing) → its rows should be tagged MEASURED (📐)
  let lightRow: any = null;
  b8.eachRow((row) => { if (!lightRow && /^8\.\d+\.\d+$/.test(String(row.getCell(1).value || ''))) lightRow = row; });
  const lightOrigin = lightRow ? String(lightRow.getCell(8).value || '') : '';
  console.log('  sample lighting row origin:', JSON.stringify(lightOrigin));

  // ── Hard assertions — fail loudly on regression ──
  const checks: Array<[string, boolean]> = [
    ['aggregated rows fully expanded', aggLeft.length === 0],
    ['apartment DBs enumerated per floor (120)', perDb.length === 120],
    ['typical-floor SMDB stacks deduped', tfLeft === 0],
    ['LV→SMDB-TF duplicates removed', lvTf === 0],
    ['Bill 5 has a Cable Size column', String(b5.getRow(3).getCell(2).value || '').toLowerCase().includes('cable size')],
    ['Bill 5 qty intact (col 6)', sample && typeof sample.getCell(6).value === 'number'],
    ['Bill 5 rate in col 7', sample && sample.getCell(7).value === 100],
    ['Bill 5 origin glyph in col 9', sample && /📐|📋/.test(String(sample.getCell(9).value || ''))],
    ['Summary points at Bill 5 col H', /!H\d+$/.test(String(b5SumFormula || ''))],
    ['Bill 8 grouped by floor', bands.length >= 2],
    ['drawing-read lighting tagged MEASURED (📐)', /📐/.test(lightOrigin)],
  ];
  let failed = 0;
  console.log('\n── Assertions ──');
  for (const [name, ok] of checks) { console.log(`  ${ok ? '✅' : '❌'} ${name}`); if (!ok) failed++; }
  console.log(`\n${failed === 0 ? '✅ ALL PASS' : `❌ ${failed} FAILED`} · wrote docs/p379-verify.xlsx`);
  if (failed) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
