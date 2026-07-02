#!/usr/bin/env node
// Reset a stuck project's status (e.g. frozen 'estimating') so the UI re-runs
// and dispatches a fresh worker job. Usage: node reset-project-status.mjs <id> [status]
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
const newStatus = process.argv[3] || 'extracted';
if (!id) { console.error('usage: node scripts/reset-project-status.mjs <projectId> [status]'); process.exit(1); }

const r = await fetch(`${URL}/rest/v1/sabi_projects?id=eq.${id}`, {
  method: 'PATCH',
  headers: {
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  },
  body: JSON.stringify({ status: newStatus, notes: null, updated_at: new Date().toISOString() }),
});
console.log('HTTP', r.status);
console.log(await r.text());
