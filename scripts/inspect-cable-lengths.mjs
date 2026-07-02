import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

// Load .env (CRLF-safe). Prefer real .env; fall back to .env.local if present.
for (const file of ['.env', '.env.local']) {
  try {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  } catch {}
}

const PROJECT_ID = process.argv[2] || 'e7180f00-fbb5-4ff7-8e58-9651500cdaf';
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: svc, error } = await supabase
  .from('sabi_services')
  .select('ai_extraction')
  .eq('project_id', PROJECT_ID)
  .eq('service_type', 'electrical')
  .single();

if (error) { console.error('DB error:', error.message); process.exit(1); }

const r = svc?.ai_extraction?.raw_electrical_procedure ?? svc?.ai_extraction ?? {};

const lv = r.lv_to_smdb_cables ?? [];
const sd = r.smdb_to_db_cables ?? [];
const cs = r.cable_schedule ?? [];
const feeders = [...lv, ...sd];

console.log(`Project ${PROJECT_ID}`);
console.log(`Feeder arrays: lv_to_smdb=${lv.length}  smdb_to_db=${sd.length}  cable_schedule=${cs.length}\n`);

function scan(name, arr) {
  let noLen = 0, noSize = 0, both = 0;
  const examples = [];
  for (const c of arr) {
    const len = typeof c.length_m === 'number' && c.length_m > 0;
    const size = typeof c.size_mm2 === 'number' && c.size_mm2 > 0;
    if (!len) noLen++;
    if (!size) noSize++;
    if (!len && !size) { both++; if (examples.length < 12) examples.push(`${c.from} -> ${c.to}`); }
  }
  console.log(`[${name}] rows=${arr.length}  missing length=${noLen}  missing size=${noSize}  missing BOTH=${both}`);
  if (examples.length) console.log('   no size+length:', examples.join(' | '));
}
scan('lv_to_smdb_cables', lv);
scan('smdb_to_db_cables', sd);
scan('cable_schedule', cs);

// Which DBs have NO feeder cable at all (the floating / tenant-fed boards)?
const dbInv = r.db_inventory ?? [];
const fedTags = new Set(feeders.map((c) => (c.to || '').trim()).filter(Boolean));
const unfed = [];
for (const d of dbInv) {
  const tag = (d.db_id || d.tag || '').trim();
  if (!tag) continue;
  // match if any feeder's `to` contains this tag
  const fed = [...fedTags].some((t) => t === tag || t.startsWith(tag) || tag.startsWith(t.split(' ')[0]));
  if (!fed) unfed.push(`${tag} [floor=${d.floor ?? '?'}]`);
}
console.log(`\nDB inventory rows=${dbInv.length}  with NO feeder cable=${unfed.length}`);
if (unfed.length) console.log('  unfed boards:\n   ' + unfed.join('\n   '));
