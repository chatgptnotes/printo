// One-shot probe: did the two Phase 1+2 migrations land?
// Run: node scripts/check-migrations.mjs
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

// Tiny inline .env.local loader so we don't depend on dotenv
try {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch { /* missing .env.local — fall through to error below */ }

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(url, key);

async function check(table) {
  const { error, count } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true });
  if (error) return { table, ok: false, error: error.message };
  return { table, ok: true, rows: count ?? 0 };
}

const [cache, corrections] = await Promise.all([
  check('sabi_drawing_analysis_cache'),
  check('sabi_corrections'),
]);

console.log('\n--- Migration check ---\n');
for (const r of [cache, corrections]) {
  if (r.ok) {
    console.log(`✅ ${r.table}: present (${r.rows} rows)`);
  } else {
    console.log(`❌ ${r.table}: MISSING — ${r.error}`);
  }
}

// Also probe the Postgres function added by migration 1
const { error: fnErr } = await supabase.rpc('bump_drawing_cache_hit', { p_cache_key: '__probe__' });
if (fnErr && !fnErr.message.includes('row')) {
  console.log(`❌ bump_drawing_cache_hit() function: MISSING — ${fnErr.message}`);
} else {
  console.log(`✅ bump_drawing_cache_hit() function: present`);
}

const ok = cache.ok && corrections.ok;
console.log(ok ? '\n🟢 Both migrations applied. You\'re good to deploy --prod.\n' : '\n🔴 At least one migration missing — re-run before --prod.\n');
process.exit(ok ? 0 : 1);
