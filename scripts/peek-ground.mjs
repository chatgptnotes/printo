import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
for (const file of ['.env', '.env.local']) {
  try { for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  } } catch {}
}
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data: svc } = await supabase.from('sabi_services').select('ai_extraction')
  .eq('project_id', 'e718bf00-fbb5-4ff7-8e58-965150bcfdaf').eq('service_type', 'electrical').single();
const r = svc.ai_extraction.raw_electrical_procedure;

console.log('SMDBs on Ground:');
for (const s of r.smdb_inventory || []) if (/ground|^g$|gf/i.test(s.floor||'')) console.log('  ', JSON.stringify(s));

console.log('\nsmdb_to_db_cables feeding Ground-floor DBs (sample):');
for (const c of r.smdb_to_db_cables || []) if (/shop|ground|gf/i.test((c.to||'')+(c.from||''))) console.log('  ', JSON.stringify(c));

console.log('\nAll distinct sizes used in smdb_to_db_cables:');
const sizes = {};
for (const c of r.smdb_to_db_cables || []) sizes[c.size_mm2] = (sizes[c.size_mm2]||0)+1;
console.log('  ', JSON.stringify(sizes));
console.log('\nLength range smdb_to_db:', Math.min(...r.smdb_to_db_cables.map(c=>c.length_m)), '-', Math.max(...r.smdb_to_db_cables.map(c=>c.length_m)));
console.log('\nSample DB-SHOP inventory row:');
console.log('  ', JSON.stringify((r.db_inventory||[]).find(d=>/shop/i.test(d.db_id||d.tag||''))));
