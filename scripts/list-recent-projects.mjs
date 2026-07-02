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
const { data, error } = await supabase
  .from('sabi_projects')
  .select('id, project_name, status, created_at')
  .order('created_at', { ascending: false })
  .limit(15);
if (error) { console.error(error.message); process.exit(1); }
for (const p of data) console.log(`${p.id}  ${p.status?.padEnd(20)}  ${p.project_name}`);
