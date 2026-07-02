#!/usr/bin/env node
/**
 * Capture a test fixture from a successful pipeline run.
 *
 *   node scripts/capture-fixture.mjs <projectId> <label>
 *
 * Reads the project's vision attachments, computes the SHA-256 hash that
 * src/lib/ai/test-fixture-replay.ts will look for at runtime, then writes:
 *
 *   tests/fixtures/<label>-result.json   (ElectricalProcedureResult)
 *   tests/fixtures/<label>-power-boq.pdf (rendered Power BOQ PDF)
 *   tests/fixtures/index.json            (updated)
 *
 * Run AFTER one real successful end-to-end run for the project (estimate +
 * Gate 12 approve so the PDF exists at boq/<id>/power-boq.pdf in storage).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

// ── .env.local loader (same pattern as scripts/inspect-procedure.mjs) ──
try {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch { /* .env.local optional */ }

const projectId = process.argv[2];
const label = process.argv[3];
if (!projectId || !label) {
  console.error('Usage: node scripts/capture-fixture.mjs <projectId> <label>');
  process.exit(1);
}
if (!/^[a-z0-9_-]+$/i.test(label)) {
  console.error(`Label must match /^[a-z0-9_-]+$/i (got "${label}")`);
  process.exit(1);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const FIXTURE_DIR = path.join(process.cwd(), 'tests', 'fixtures');
const INDEX_PATH = path.join(FIXTURE_DIR, 'index.json');

// ── 1. Fetch project's vision attachments and download buffers ──
console.log(`[capture] project=${projectId} label=${label}`);
const { data: attachments, error: attErr } = await supabase
  .from('sabi_attachments')
  .select('filename, storage_path')
  .eq('project_id', projectId);
if (attErr) {
  console.error('Failed to query attachments:', attErr.message);
  process.exit(1);
}
if (!attachments || attachments.length === 0) {
  console.error(`No attachments found for project ${projectId}.`);
  process.exit(1);
}

// Match the same filter the estimate route uses to build electricalFiles.
// Discipline filtering is NOT applied here — fixture key is over the full
// vision-format set the user uploads. For a single-PDF demo (P-379) this is
// identical to what estimate computes.
const visionExt = /\.(pdf|png|jpe?g)$/i;
const visionAtts = attachments.filter(a => visionExt.test(a.filename || ''));
if (visionAtts.length === 0) {
  console.error('No vision-format attachments (pdf/png/jpg) on project — cannot compute fixture key.');
  process.exit(1);
}

const files = [];
for (const att of visionAtts) {
  if (!att.storage_path) {
    console.warn(`  skip ${att.filename}: missing storage_path`);
    continue;
  }
  const { data, error } = await supabase.storage.from('sabi-attachments').download(att.storage_path);
  if (error || !data) {
    console.warn(`  skip ${att.filename}: download failed (${error?.message})`);
    continue;
  }
  const buffer = Buffer.from(await data.arrayBuffer());
  files.push({ filename: att.filename, buffer });
  console.log(`  loaded ${att.filename} (${buffer.length} bytes)`);
}
if (files.length === 0) {
  console.error('No attachment buffers could be downloaded.');
  process.exit(1);
}

// ── 2. Compute SHA-256 — must match computeFixtureKey() exactly ──
const hash = createHash('sha256');
const sorted = [...files].sort((a, b) => a.filename.localeCompare(b.filename));
for (const f of sorted) {
  hash.update('|FILE|');
  hash.update(f.filename);
  hash.update(f.buffer);
}
const fixtureKey = hash.digest('hex');
console.log(`[capture] fixture key: ${fixtureKey}`);

// ── 3. Pull the ElectricalProcedureResult from sabi_services ──
const { data: svc, error: svcErr } = await supabase
  .from('sabi_services')
  .select('ai_extraction')
  .eq('project_id', projectId)
  .eq('service_type', 'electrical')
  .single();
if (svcErr || !svc) {
  console.error(`Failed to read sabi_services.ai_extraction for project ${projectId}: ${svcErr?.message ?? 'not found'}`);
  process.exit(1);
}
const procedureResult = svc.ai_extraction?.raw_electrical_procedure;
if (!procedureResult) {
  console.error('sabi_services.ai_extraction.raw_electrical_procedure is empty — run /estimate successfully first.');
  process.exit(1);
}
const cableCount = Array.isArray(procedureResult.cable_schedule) ? procedureResult.cable_schedule.length : 0;
console.log(`[capture] result loaded: ${cableCount} cables, confidence=${procedureResult.confidence ?? '?'}`);

// ── 4. Download the rendered Power BOQ PDF ──
const pdfPath = `boq/${projectId}/power-boq.pdf`;
const { data: pdfData, error: pdfErr } = await supabase.storage.from('sabi-attachments').download(pdfPath);
if (pdfErr || !pdfData) {
  console.error(`Power BOQ PDF not found at ${pdfPath}: ${pdfErr?.message ?? 'no data'}`);
  console.error('Approve Gate 12 first so the PDF gets rendered and stored.');
  process.exit(1);
}
const pdfBuffer = Buffer.from(await pdfData.arrayBuffer());
console.log(`[capture] PDF loaded: ${pdfBuffer.length} bytes`);

// ── 5. Write fixture files ──
await fs.mkdir(FIXTURE_DIR, { recursive: true });
const resultFile = `${label}-result.json`;
const pdfFile = `${label}-power-boq.pdf`;
writeFileSync(path.join(FIXTURE_DIR, resultFile), JSON.stringify(procedureResult, null, 2));
writeFileSync(path.join(FIXTURE_DIR, pdfFile), pdfBuffer);
console.log(`[capture] wrote ${resultFile} + ${pdfFile}`);

// ── 6. Update index.json (preserve other entries) ──
let index = {};
try {
  index = JSON.parse(readFileSync(INDEX_PATH, 'utf-8'));
} catch { /* fresh */ }
const existing = index[fixtureKey];
if (existing && existing.label !== label) {
  console.warn(`[capture] WARNING: hash already registered under label "${existing.label}" — overwriting with "${label}"`);
}
index[fixtureKey] = { label, result: resultFile, pdf: pdfFile };
writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2) + '\n');
console.log(`[capture] index.json updated`);

console.log('\n✓ Done.');
console.log(`  Set SABI_TEST_FIXTURES=1 in .env.local and restart the dev server.`);
console.log(`  Re-uploading the same file(s) to a new project will replay this result instantly.`);
