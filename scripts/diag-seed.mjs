// Diagnose why seeded projects end up with no attachment.
// Loads .env, then checks: storage bucket exists, upload works, attachment insert works.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

for (const line of readFileSync(resolve('.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
console.log('URL set:', !!url, '| service key set:', !!key);
const sb = createClient(url, key);

// 1. Buckets
const { data: buckets, error: bErr } = await sb.storage.listBuckets();
console.log('\n[buckets]', bErr ? `ERROR: ${bErr.message}` : (buckets || []).map(b => b.name).join(', ') || '(none)');

// 2. Try the exact upload the seeder does
const buf = readFileSync(resolve('test-files/p379-power.pdf'));
const path = `test-rfq/electrical_demo/p379-power.pdf`;
const { error: upErr } = await sb.storage.from('sabi-attachments').upload(path, buf, { contentType: 'application/pdf', upsert: true });
console.log('[upload]', upErr ? `ERROR: ${upErr.message}` : 'OK →', path);

// 3. Try the exact attachment insert the seeder does (error is NOT checked in the seed!)
//    Use a throwaway project_id to see whether the row shape / FK / RLS is the problem.
const { data: proj } = await sb.from('sabi_projects').select('id').limit(1).single();
if (proj) {
  const { error: insErr } = await sb.from('sabi_attachments').insert({
    project_id: proj.id,
    filename: 'p379-power.pdf',
    mime_type: 'application/pdf',
    size_bytes: buf.length,
    file_type: 'drawing_pdf',
    discipline: 'electrical',
    storage_path: path,
  }).select('id').single();
  console.log('[attachment insert]', insErr ? `ERROR: ${insErr.message}` : 'OK (test row inserted — harmless)');
} else {
  console.log('[attachment insert] skipped — no project to attach to');
}

// 4. Show the columns the table actually has (probe by selecting *)
const { data: sample, error: selErr } = await sb.from('sabi_attachments').select('*').limit(1);
console.log('[sabi_attachments columns]', selErr ? `ERROR: ${selErr.message}` : Object.keys(sample?.[0] || {}).join(', ') || '(empty table)');
