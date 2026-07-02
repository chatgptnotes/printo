#!/usr/bin/env node
/**
 * Seed a tests/fixtures/ entry for a LOCAL PDF, using the result + rendered
 * Power BOQ PDF from a different (already-successful) project. Useful when:
 *   - You have a small/test PDF locally
 *   - A previous project already produced a good ElectricalProcedureResult
 *   - You want demo replay to short-circuit the AI on the local PDF
 *
 *   node scripts/seed-fixture-from.mjs <localPdfPath> <sourceProjectId> <label>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

try {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch {}

const [localPdfPath, sourceProjectId, label] = process.argv.slice(2);
if (!localPdfPath || !sourceProjectId || !label) {
  console.error('Usage: node scripts/seed-fixture-from.mjs <localPdfPath> <sourceProjectId> <label>');
  process.exit(1);
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const FIXTURE_DIR = path.join(process.cwd(), 'tests', 'fixtures');
const INDEX_PATH = path.join(FIXTURE_DIR, 'index.json');

// 1. Hash the LOCAL PDF — using the exact same algo as
//    src/lib/ai/test-fixture-replay.ts → computeFixtureKey()
const localBuffer = readFileSync(localPdfPath);
const localFilename = path.basename(localPdfPath);
const hash = createHash('sha256');
hash.update('|FILE|');
hash.update(localFilename);
hash.update(localBuffer);
const fixtureKey = hash.digest('hex');
console.log(`[seed] local PDF: ${localFilename} (${localBuffer.length} bytes)`);
console.log(`[seed] fixture key: ${fixtureKey}`);

// 2. Pull the historical ElectricalProcedureResult from the source project.
const { data: svc, error: svcErr } = await supabase
  .from('sabi_services')
  .select('ai_extraction')
  .eq('project_id', sourceProjectId)
  .eq('service_type', 'electrical')
  .single();
if (svcErr || !svc?.ai_extraction?.raw_electrical_procedure) {
  console.error(`No raw_electrical_procedure for project ${sourceProjectId}: ${svcErr?.message ?? 'not found'}`);
  process.exit(1);
}
const result = svc.ai_extraction.raw_electrical_procedure;
const cables = Array.isArray(result.cable_schedule) ? result.cable_schedule.length : 0;
console.log(`[seed] source result: ${cables} cables, confidence=${result.confidence ?? '?'}`);

// 3. Download the rendered Power BOQ PDF from the source project's storage.
const { data: pdfData, error: pdfErr } = await supabase.storage
  .from('sabi-attachments')
  .download(`boq/${sourceProjectId}/power-boq.pdf`);
if (pdfErr || !pdfData) {
  console.error(`No power-boq.pdf for ${sourceProjectId}: ${pdfErr?.message ?? 'no data'}`);
  process.exit(1);
}
const pdfBuffer = Buffer.from(await pdfData.arrayBuffer());
console.log(`[seed] source PDF: ${pdfBuffer.length} bytes`);

// 4. Write fixture files.
await fs.mkdir(FIXTURE_DIR, { recursive: true });
const resultFile = `${label}-result.json`;
const pdfFile = `${label}-power-boq.pdf`;
writeFileSync(path.join(FIXTURE_DIR, resultFile), JSON.stringify(result, null, 2));
writeFileSync(path.join(FIXTURE_DIR, pdfFile), pdfBuffer);

let index = {};
try { index = JSON.parse(readFileSync(INDEX_PATH, 'utf-8')); } catch {}
index[fixtureKey] = { label, result: resultFile, pdf: pdfFile };
writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2) + '\n');

console.log(`\n✓ wrote ${resultFile}, ${pdfFile}, and updated index.json`);
console.log(`  Set SABI_TEST_FIXTURES=1 in .env.local and restart dev server.`);
console.log(`  Re-uploading ${localFilename} (same bytes) to any project will replay this result.`);
