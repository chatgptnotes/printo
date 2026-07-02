#!/usr/bin/env node
/**
 * One-shot cleanup: clear notes.approval_gate on a project whose status is
 * past the gate referenced by notes (data was clobbered by a prior
 * power-boq regenerate that overwrote notes). Preserves boq_pdf_path /
 * boq_xlsx_path so download buttons keep working.
 *
 *   node scripts/clear-stale-notes.mjs <projectId>
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

const id = process.argv[2];
if (!id) { console.error('Usage: node scripts/clear-stale-notes.mjs <projectId>'); process.exit(1); }

const { data: p } = await supabase.from('sabi_projects').select('status, notes').eq('id', id).single();
if (!p) { console.error('Project not found'); process.exit(1); }
console.log(`Before: status=${p.status} notes=${p.notes}`);

let parsed = {};
try { parsed = p.notes ? JSON.parse(p.notes) : {}; } catch {}
delete parsed.approval_gate;
const newNotes = Object.keys(parsed).length === 0 ? null : JSON.stringify(parsed);

await supabase.from('sabi_projects').update({ notes: newNotes, updated_at: new Date().toISOString() }).eq('id', id);
console.log(`After:  status=${p.status} notes=${newNotes}`);
console.log(`✓ stale approval_gate removed. UI gate card will disappear on next refresh.`);
