import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
for (const file of ['.env', '.env.local']) {
  try {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  } catch {}
}
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// 1) direct prefix match
const { data: pref } = await supabase
  .from('sabi_projects')
  .select('id, project_name, status')
  .like('id', 'e7180f00%');
console.log('prefix e7180f00 match:', JSON.stringify(pref));

// 2) all services that have a non-null ai_extraction -> their projects
const { data: svcs } = await supabase
  .from('sabi_services')
  .select('project_id')
  .eq('service_type', 'electrical')
  .not('ai_extraction', 'is', null);
const ids = [...new Set((svcs || []).map((s) => s.project_id))];
console.log(`\nprojects WITH electrical ai_extraction: ${ids.length}`);
if (ids.length) {
  const { data: ps } = await supabase
    .from('sabi_projects')
    .select('id, project_name, status, created_at')
    .in('id', ids)
    .order('created_at', { ascending: false });
  for (const p of ps || []) console.log(`  ${p.id}  ${(p.status||'').padEnd(18)}  ${p.project_name}`);
}
