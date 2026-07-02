#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
try {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch {}
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const id = process.argv[2];
if (!id) { console.error('Usage: node scripts/inspect-project.mjs <projectId>'); process.exit(1); }

const { data: p } = await supabase.from('sabi_projects').select('*').eq('id', id).single();
console.log(`status:  ${p.status}`);
console.log(`notes:   ${p.notes}`);
console.log(`updated: ${p.updated_at}`);

const { data: logs } = await supabase
  .from('sabi_activity_log')
  .select('step, step_name, status, sub_pipeline, details, created_at')
  .eq('project_id', id)
  .order('created_at', { ascending: false })
  .limit(15);
console.log(`\nlast 15 activity_log rows:`);
for (const l of logs || []) {
  const tag = l.sub_pipeline ? `[${l.sub_pipeline}]` : '[MAIN]';
  const det = l.details ? JSON.stringify(l.details).slice(0, 150) : '';
  console.log(`  ${l.created_at}  ${tag} step ${l.step} · ${l.step_name} · ${l.status}  ${det}`);
}
