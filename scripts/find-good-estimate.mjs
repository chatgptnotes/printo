#!/usr/bin/env node
/**
 * Find projects whose electrical estimate succeeded — candidates we can
 * capture as test fixtures so demo runs replay without calling Claude.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

try {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch {}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: services } = await supabase
  .from('sabi_services')
  .select('project_id, ai_extraction, confidence, updated_at')
  .eq('service_type', 'electrical')
  .not('ai_extraction', 'is', null)
  .order('updated_at', { ascending: false })
  .limit(20);

const candidates = [];
for (const s of (services || [])) {
  const proc = s.ai_extraction?.raw_electrical_procedure;
  if (!proc) continue;
  const cables = Array.isArray(proc.cable_schedule) ? proc.cable_schedule.length : 0;
  if (cables === 0) continue;
  candidates.push({
    project_id: s.project_id,
    cables,
    smdbs: Array.isArray(proc.smdb_inventory) ? proc.smdb_inventory.length : 0,
    dbs: Array.isArray(proc.db_inventory) ? proc.db_inventory.length : 0,
    confidence: proc.confidence ?? null,
    updated_at: s.updated_at,
    stub: !!proc.stub,
  });
}

console.log(`\nFound ${candidates.length} successful electrical estimate(s):\n`);
for (const c of candidates) {
  const { data: p } = await supabase.from('sabi_projects').select('status, project_name').eq('id', c.project_id).single();
  const { data: atts } = await supabase
    .from('sabi_attachments')
    .select('filename, size_bytes')
    .eq('project_id', c.project_id);
  console.log(`──────────────────────────────────────────────────`);
  console.log(`project: ${c.project_id}`);
  console.log(`name:    ${p?.project_name || '∅'}`);
  console.log(`status:  ${p?.status}`);
  console.log(`cables=${c.cables}  smdbs=${c.smdbs}  dbs=${c.dbs}  confidence=${c.confidence}  stub=${c.stub}`);
  console.log(`updated: ${c.updated_at}`);
  console.log(`attachments (${atts?.length ?? 0}):`);
  for (const a of (atts || [])) {
    console.log(`  - ${a.filename} (${a.size_bytes} bytes)`);
  }

  const { data: storageList } = await supabase.storage.from('sabi-attachments').list(`boq/${c.project_id}`);
  const hasPdf = (storageList || []).some(f => f.name === 'power-boq.pdf');
  console.log(`power-boq.pdf in storage: ${hasPdf ? 'YES ✓' : 'NO'}`);
}
console.log();
