#!/usr/bin/env node
/**
 * Phase 1 + 2 smoke test — runs every library extractor against the real
 * fixtures in tests/files/ and prints what each one found. No network calls,
 * no Sonnet, no DB. Pure local validation that the preflight chain works.
 *
 * Run:  node scripts/smoke-electrical-preflight.mjs
 */

// Run via:  node --import tsx scripts/smoke-electrical-preflight.mjs
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const FIXTURES_DIR = './tests/files';
const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const summary = { run: 0, pass: 0, fail: 0 };

function check(label, ok, detail) {
  summary.run++;
  if (ok) summary.pass++;
  else summary.fail++;
  console.log(`  ${ok ? PASS : FAIL} ${label}${detail ? `  ${DIM}${detail}${RESET}` : ''}`);
}

function section(title) {
  console.log(`\n${'─'.repeat(60)}\n${title}\n${'─'.repeat(60)}`);
}

async function main() {
  // Force the env flags on for this smoke test.
  process.env.ELECTRICAL_PREFLIGHT = 'on';
  process.env.ELECTRICAL_GEOMETRY = 'on';

  // Lazy-import the modules under test (after tsx loader is registered).
  const { extractFloors } = await import('../src/lib/drawing/floor-counter.ts');
  const { extractTitleBlock } = await import('../src/lib/drawing/title-block-extractor.ts');
  const { extractXlsxSchedule } = await import('../src/lib/drawing/xlsx-schedule-parser.ts');
  const { extractScheduleTable } = await import('../src/lib/drawing/panel-schedule-parser.ts');
  const { loadSpecDoc } = await import('../src/lib/ai/spec-doc-loader.ts');
  const { hasElectricalLayers, extractCableRoutes } = await import('../src/lib/drawing/dxf-text-extractor.ts');
  const { measureFromDxfPolyline } = await import('../src/lib/drawing/cable-route-measurer.ts');
  const { normaliseForHash } = await import('../src/lib/ai/result-cache.ts');
  const { runElectricalPreflight } = await import('../src/lib/ai/electrical-preflight.ts');

  // ─── 1. floor-counter (pure function, no fixture needed) ─────────────────
  section('1. floor-counter.ts — extractFloors()');
  const cases = [
    { in: 'B2, B1, GF, M, 1F, 2F, 3F, 4F, ROOF', want: ['B2','B1','GF','MEZZ','1F','2F','3F','4F','ROOF'] },
    { in: 'Levels 1-7 Roof', want: ['1F','2F','3F','4F','5F','6F','7F','ROOF'] },
    { in: 'Basement 2 / Basement 1 / Ground / Mezzanine / 1F / 2F', want: ['B2','B1','GF','MEZZ','1F','2F'] },
    { in: 'Floor 5', want: ['5F'] },
  ];
  for (const c of cases) {
    const got = extractFloors(c.in);
    const ok = JSON.stringify(got) === JSON.stringify(c.want);
    check(`"${c.in.slice(0, 40)}…"`, ok, `got [${got.join(', ')}]`);
  }

  // ─── 2. result-cache normalisation ───────────────────────────────────────
  section('2. result-cache.ts — normaliseForHash()');
  const before = 'Spec Issued: 2026-05-01 14:32  Rev A  Page 3 of 12  contractor shall use ABB';
  const after = 'Spec contractor shall use ABB';
  const norm = normaliseForHash(before);
  check('strips date/rev/page noise', norm === after, `→ "${norm}"`);

  // Same content with a different rev should hash to the same string.
  const beforeRevB = before.replace('Rev A', 'Rev B').replace('2026-05-01', '2026-06-01');
  check('Rev A vs Rev B hash to same key', normaliseForHash(beforeRevB) === norm);

  // ─── 3. dxf hasElectricalLayers ──────────────────────────────────────────
  section('3. dxf-text-extractor.ts — hasElectricalLayers()');
  check('matches E-POWR',          hasElectricalLayers(['0', 'E-POWR', 'A-WALL']));
  check('matches MDB',             hasElectricalLayers(['MDB-MAIN', 'A-DOOR']));
  check('matches SMDB',            hasElectricalLayers(['SMDB-1F']));
  check('rejects HVAC-only',       !hasElectricalLayers(['M-HVAC', 'M-DUCT']));
  check('rejects empty',           !hasElectricalLayers([]));

  // ─── 4. title-block-extractor on every PDF in tests/files ────────────────
  section('4. title-block-extractor.ts — extractTitleBlock() on real PDFs');
  const allFiles = await readdir(FIXTURES_DIR);
  const pdfs = allFiles.filter(f => f.endsWith('.pdf'));
  for (const f of pdfs) {
    const buf = await readFile(join(FIXTURES_DIR, f));
    const tb = await extractTitleBlock(buf);
    const detail = `pages=${tb.pageCount} chars=${tb.textSampleChars} type=${tb.drawingType} scale=${tb.scale ?? '-'} dwg=${tb.drawingNumber ?? '-'} floors=[${tb.floors.join(',')}] conf=${tb.confidence.toFixed(2)}`;
    check(f, tb.textSampleChars > 0, detail);
  }

  // ─── 5. xlsx-schedule-parser on the BOQ XLSX ─────────────────────────────
  section('5. xlsx-schedule-parser.ts — extractXlsxSchedule()');
  const xlsxFile = 'SABI_BOQ_Al_Reem_Tower.xlsx';
  try {
    const buf = await readFile(join(FIXTURES_DIR, xlsxFile));
    const rows = await extractXlsxSchedule(buf);
    check(`${xlsxFile}: parsed ${rows.length} rows`, true);
    for (const r of rows.slice(0, 5)) {
      console.log(`    ${DIM}- tag=${r.tag ?? '-'} | rating=${r.rating ?? '-'} | cable=${r.cable_size ?? '-'} | from=${r.from ?? '-'} | to=${r.to ?? '-'}${RESET}`);
    }
  } catch (err) {
    check(xlsxFile, false, err.message);
  }

  // ─── 6. panel-schedule-parser on schedule-style PDFs ─────────────────────
  section('6. panel-schedule-parser.ts — extractScheduleTable()');
  for (const f of ['HVAC_Equipment_Schedule.pdf', 'Indoor_Unit_Schedule.pdf', 'BOQ_Template_Al_Zahra.pdf']) {
    try {
      const buf = await readFile(join(FIXTURES_DIR, f));
      const rows = await extractScheduleTable(buf);
      check(`${f}: parsed ${rows.length} rows`, true, rows.length > 0 ? `first tag=${rows[0].tag ?? '-'}` : '(no header detected — falls back to Sonnet)');
    } catch (err) {
      check(f, false, err.message);
    }
  }

  // ─── 7. spec-doc-loader on DOCX and PDF specs ────────────────────────────
  section('7. spec-doc-loader.ts — loadSpecDoc()');
  for (const [f, mime] of [
    ['SABI_MEP_Estimation_Al_Reem_Tower.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['Specifications_MEP.pdf', 'application/pdf'],
  ]) {
    try {
      const buf = await readFile(join(FIXTURES_DIR, f));
      const r = await loadSpecDoc(buf, mime, f);
      check(`${f}: source=${r.source} chars=${r.text.length} conf=${r.confidence.toFixed(2)}`, r.text.length > 0);
    } catch (err) {
      check(f, false, err.message);
    }
  }

  // ─── 8. dxf cable-route extraction + measurement (synthetic DXF) ─────────
  section('8. dxf-text-extractor.ts — extractCableRoutes + measureFromDxfPolyline');
  // Minimal DXF with $INSUNITS=4 (mm) and an L-shaped LWPOLYLINE on E-POWR.
  // Vertices: (0,0) → (15000,0) → (15000,10000)  ⇒ 25 m total at mm.
  const syntheticDxf = `0
SECTION
2
HEADER
9
$INSUNITS
70
4
0
ENDSEC
0
SECTION
2
TABLES
0
TABLE
2
LAYER
0
LAYER
2
E-POWR
70
0
62
7
6
CONTINUOUS
0
ENDTAB
0
ENDSEC
0
SECTION
2
ENTITIES
0
LWPOLYLINE
8
E-POWR
90
3
70
0
10
0.0
20
0.0
10
15000.0
20
0.0
10
15000.0
20
10000.0
0
ENDSEC
0
EOF
`;
  const dxfBuf = Buffer.from(syntheticDxf, 'utf-8');
  const cables = extractCableRoutes('synthetic.dxf', dxfBuf);
  check(`dxf parsed`, cables.ok, cables.ok ? `routes=${cables.routes.length} unit=${cables.unitName} mPerUnit=${cables.unitMetres}` : cables.error);
  if (cables.ok && cables.routes.length > 0) {
    const measured = measureFromDxfPolyline(cables.routes[0].vertices, cables.unitMetres, cables.unitName);
    const metres = measured.metres ?? 0;
    check(`measured length ≈ 25 m (got ${metres.toFixed(2)} m)`, Math.abs(metres - 25) < 0.01, `conf=${measured.confidence} segments=${measured.segmentCount}`);
  }

  // ─── 9. End-to-end: runElectricalPreflight on a mixed bundle ─────────────
  section('9. electrical-preflight.ts — runElectricalPreflight() end-to-end');
  const bundleFiles = ['BOQ_Template_Al_Zahra.pdf', 'RFQ_Letter_Al_Zahra_Tower.pdf', 'SABI_BOQ_Al_Reem_Tower.xlsx'];
  const attachments = await Promise.all(
    bundleFiles.map(async (filename) => ({
      filename,
      mimeType: filename.endsWith('.pdf') ? 'application/pdf' :
                filename.endsWith('.xlsx') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' :
                'application/octet-stream',
      buffer: await readFile(join(FIXTURES_DIR, filename)),
    })),
  );
  // Add the synthetic DXF as a 4th attachment so the end-to-end run also
  // exercises the Phase 3 cable-measurement path.
  attachments.push({
    filename: 'synthetic-cable.dxf',
    mimeType: 'application/dxf',
    buffer: dxfBuf,
  });
  const pre = await runElectricalPreflight(attachments);
  check('preflight ran (flag on)', pre.enabled);
  check(`scale detected: ${pre.knownFacts.scale ?? 'none'}`, true);
  check(`floors detected: [${pre.knownFacts.floors.join(', ') || 'none'}]`, true);
  check(`drawings catalogued: ${pre.knownFacts.drawings.length}`, true);
  check(`schedule rows from XLSX/PDF: ${pre.knownFacts.scheduleRows.length}`, true);
  check(`cable measurements from DXF: ${pre.knownFacts.cableMeasurements.length}`, pre.knownFacts.cableMeasurements.length > 0);
  for (const c of pre.knownFacts.cableMeasurements.slice(0, 3)) {
    console.log(`    ${DIM}- layer=${c.layer} length=${c.metres}m segs=${c.segment_count} conf=${c.confidence.toFixed(2)} src=${c.source_filename}${RESET}`);
  }
  check(`files served library-only: ${pre.skippedSonnet.length}/${attachments.length}`, true,
        pre.skippedSonnet.join(', ') || '(none)');
  check(`files still going to Sonnet: ${pre.remainingForSonnet.length}/${attachments.length}`, true);
  console.log('\n' + DIM + '--- prompt hint block that would be injected into Sonnet ---' + RESET);
  console.log(pre.promptHints || '(empty)');

  // ─── Summary ─────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Summary: ${summary.pass}/${summary.run} checks passed${summary.fail > 0 ? `, ${summary.fail} failed` : ''}`);
  console.log('─'.repeat(60));
  process.exit(summary.fail > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('\n💥 Smoke test crashed:', err);
  process.exit(2);
});
