import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
try {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch {}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const PROJ = '16cd9625-3d9f-46ce-a63d-2324c03bd43d';

console.log('\n--- Recent activity for P-379 ---\n');

const { data: log } = await supabase
  .from('sabi_activity_log')
  .select('step, step_name, status, details, created_at')
  .eq('project_id', PROJ)
  .order('created_at', { ascending: false })
  .limit(15);

for (const row of log || []) {
  const t = row.created_at?.slice(11, 19) ?? '';
  const det = row.details ? JSON.stringify(row.details).slice(0, 220) : '';
  console.log(`[${t}] step ${row.step ?? '?'} [${row.status}] ${row.step_name}`);
  if (det) console.log(`         ${det}`);
}

console.log('\n--- Project state ---\n');
const { data: proj } = await supabase
  .from('sabi_projects')
  .select('status, notes, final_quote_aed, updated_at')
  .eq('id', PROJ)
  .single();
console.log(JSON.stringify(proj, null, 2));

console.log('\n--- Electrical service ai_extraction shape ---\n');
const { data: svc } = await supabase
  .from('sabi_services')
  .select('id, service_type, total_aed, ai_extraction')
  .eq('project_id', PROJ)
  .eq('service_type', 'electrical')
  .maybeSingle();
if (!svc) {
  console.log('No electrical service row.');
} else {
  const ext = svc.ai_extraction || {};
  const r = ext.raw_electrical_procedure;
  console.log(`total_aed: ${svc.total_aed}`);
  console.log(`has raw_electrical_procedure: ${!!r}`);
  if (r) {
    console.log(`  cable_schedule rows: ${(r.cable_schedule || []).length}`);
    console.log(`  smdb_inventory rows: ${(r.smdb_inventory || []).length}`);
    console.log(`  load_summary rows: ${(r.load_summary || []).length}`);
    if (r.load_summary?.length) {
      console.log(`  load_summary sample:`);
      for (const ls of r.load_summary.slice(0, 3)) {
        console.log(`    panel=${ls.panel} tcl=${ls.tcl_kw} standby=${ls.standby_kw} df=${ls.demand_factor} md=${ls.max_demand_kw}`);
      }
    }
  }
}
