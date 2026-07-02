#!/usr/bin/env node
// Inspect one project's live state + recent activity log (prod Supabase).
import fs from 'fs';

function env() {
  const e = {};
  for (const f of ['.env.local', '.env']) {
    try {
      for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !(m[1] in e)) e[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
      }
    } catch {}
  }
  return e;
}

const e = env();
const URL = e.NEXT_PUBLIC_SUPABASE_URL || `https://${(e.SUPABASE_URL||'').replace(/^https?:\/\//,'')}`;
const KEY = e.SUPABASE_SERVICE_ROLE_KEY;
const id = process.argv[2];
if (!id) { console.error('usage: node scripts/check-project.mjs <projectId>'); process.exit(1); }

const h = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function q(path) {
  const r = await fetch(`${URL}/rest/v1/${path}`, { headers: h });
  if (!r.ok) return { _err: `${r.status} ${await r.text().catch(()=> '')}` };
  return r.json();
}

console.log('Supabase:', URL);
const proj = await q(`sabi_projects?id=eq.${id}&select=id,status,updated_at,notes,total_area_sqft,floors,building_type`);
console.log('\n=== PROJECT ===');
console.log(JSON.stringify(proj, null, 2).slice(0, 1500));

const log = await q(`sabi_activity_log?project_id=eq.${id}&select=created_at,sub_pipeline,step,step_name,status&order=created_at.desc&limit=15`);
console.log('\n=== LAST 15 ACTIVITY ROWS (newest first) ===');
if (Array.isArray(log)) {
  for (const r of log) console.log(`${r.created_at}  [${r.sub_pipeline||'main'}] step ${r.step} ${r.status.padEnd(9)} ${r.step_name}`);
} else console.log(JSON.stringify(log));
