import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
try {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch {}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: svc } = await supabase
  .from('sabi_services')
  .select('ai_extraction')
  .eq('project_id', '16cd9625-3d9f-46ce-a63d-2324c03bd43d')
  .eq('service_type', 'electrical')
  .single();

const r = svc?.ai_extraction?.raw_electrical_procedure ?? {};
console.log('--- Section coverage ---\n');
const sections = {
  '2 Incoming Supply': r.incoming_supply,
  '3 LV Panels': r.lv_panels?.length,
  '4 SMDB': r.smdb_inventory?.length,
  '5 DB (groups)': r.db_groups?.length,
  '5 DB (inventory)': r.db_inventory?.length,
  '6 Mechanical': r.mechanical_equipment?.length,
  '7 Power Outlets': r.power_outlets?.length,
  '8 Cable Schedule': r.cable_schedule?.length,
  '8 Bulk Cables': r.bulk_cables?.length,
  '9 Containment': r.containment?.length,
  '10 Earthing': r.earthing?.length,
  '11 Metering': r.metering?.length,
  '12 Load Summary': r.load_summary?.length,
};
for (const [k, v] of Object.entries(sections)) {
  const status = v == null ? '❌ MISSING' : v === 0 ? '⚠️  EMPTY' : `✅ ${typeof v === 'object' ? 'present' : v + ' rows'}`;
  console.log(`  ${k.padEnd(28)} ${status}`);
}

console.log('\n--- LV Panels detail ---');
console.log(JSON.stringify(r.lv_panels, null, 2)?.slice(0, 1000));
console.log('\n--- Incoming Supply detail ---');
console.log(JSON.stringify(r.incoming_supply, null, 2));
console.log('\n--- Load Summary detail ---');
console.log(JSON.stringify(r.load_summary, null, 2));
console.log('\n--- SMDB sample (first 3) ---');
console.log(JSON.stringify(r.smdb_inventory?.slice(0, 3), null, 2));
console.log('\n--- LV→SMDB cables sample (first 3) ---');
console.log(JSON.stringify(r.lv_to_smdb_cables?.slice(0, 3), null, 2));
