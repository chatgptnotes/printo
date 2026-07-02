#!/usr/bin/env node
/**
 * Diagnose why Instant BOQ is failing — looks at the most recently active
 * projects and surfaces the last activity log entry per project.
 *
 *   node scripts/diagnose-instant-boq.mjs
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

try {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch {}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, KEY);

const { data: projects } = await supabase
  .from('sabi_projects')
  .select('id, status, building_type, project_name, notes, created_at, updated_at')
  .order('updated_at', { ascending: false })
  .limit(8);

console.log(`\nMost recent ${projects?.length ?? 0} projects:\n`);
for (const p of (projects || [])) {
  console.log(`──────────────────────────────────────────────────`);
  console.log(`id:      ${p.id}`);
  console.log(`name:    ${(p.project_name || '∅').slice(0, 80)}`);
  console.log(`status:  ${p.status}`);
  console.log(`updated: ${p.updated_at}`);
  if (p.notes) {
    let notes = p.notes;
    try { notes = JSON.stringify(JSON.parse(p.notes), null, 0).slice(0, 200); } catch {}
    console.log(`notes:   ${notes}`);
  }

  const { data: logs } = await supabase
    .from('sabi_activity_log')
    .select('step, step_name, status, details, sub_pipeline, created_at')
    .eq('project_id', p.id)
    .order('created_at', { ascending: false })
    .limit(6);

  console.log(`last 6 activity_log rows:`);
  for (const l of (logs || [])) {
    const detail = l.details ? JSON.stringify(l.details).slice(0, 200) : '';
    const tag = l.sub_pipeline ? `[${l.sub_pipeline}]` : '[MAIN]';
    console.log(`  ${tag} step ${l.step} · ${l.step_name} · ${l.status}  ${detail}`);
  }

  const { count: attCount } = await supabase
    .from('sabi_attachments')
    .select('*', { count: 'exact', head: true })
    .eq('project_id', p.id);
  console.log(`attachments: ${attCount ?? 0}`);
}

console.log(`\n`);
