#!/usr/bin/env node
/**
 * Re-scan (re-run the electrical estimate / drawing scan) for every non-terminal bid.
 *
 * Each bid is sent to POST /api/projects/<id>/estimate with { force, force_refresh }:
 *   - force        : bypass the "already analyzed" guard (pricing_pending / boq_ready)
 *   - force_refresh: bypass the content-hash cache so Claude actually re-analyses
 * The estimate route hands off to the async VPS worker and returns 202; the scan
 * completes in the background (~15-25 min each). Poll bid status afterwards.
 *
 * ⚠ This OVERWRITES each bid's ai_extraction. For bids already at boq_ready it also
 *   invalidates the generated BOQ — Gates 3 & 4 must be re-approved afterwards.
 *   Commercially closed bids (sent / declined / archived / won) are SKIPPED.
 *
 * Requires (from .env / .env.local or the shell):
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   — to enumerate bids
 *   INTERNAL_API_SECRET                                    — to authenticate the call
 *   APP_URL (or NEXT_PUBLIC_APP_URL)  default http://localhost:3001
 *
 * By default this rescans only GENUINELY-SCANNED bids: it skips commercially
 * closed states, bids still at 'classified' (never extracted — they'd 4xx), and
 * obvious TEST / demo duplicates. Override with flags:
 *   --include-classified   also rescan 'classified' bids (they likely 4xx)
 *   --include-tests        also rescan bids whose name looks like TEST / demo
 *   --all                  both of the above (original behaviour)
 *
 * Usage:
 *   node scripts/rescan-all.mjs --dry-run          # list targets, no calls (no secret needed)
 *   INTERNAL_API_SECRET=xxx node scripts/rescan-all.mjs
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

for (const f of ['.env', '.env.local']) {
  try {
    for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* file may not exist */ }
}

const DRY = process.argv.includes('--dry-run');
const ALL = process.argv.includes('--all');
const INCLUDE_CLASSIFIED = ALL || process.argv.includes('--include-classified');
const INCLUDE_TESTS = ALL || process.argv.includes('--include-tests');
// A bid only has a take-off worth re-running once it has been extracted; 'classified'
// means the drawing was never scanned, so the estimate route 4xxes it.
const NOT_EXTRACTED = new Set(['classified']);
// TEST harness / demo duplicates we don't want to spend scan budget on.
const TEST_NAME = /\bTEST\b|\bdemo\b/i;
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_URL = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001').replace(/\/+$/, '');
const SECRET = process.env.INTERNAL_API_SECRET;

if (!SUPA_URL || !SUPA_KEY) { console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
if (!DRY && !SECRET) { console.error('INTERNAL_API_SECRET required (or pass --dry-run)'); process.exit(1); }

// Commercially closed / terminal states we never rescan.
const TERMINAL = new Set(['sent', 'declined', 'archived', 'won']);

const sb = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });
const { data: bids, error } = await sb
  .from('sabi_projects')
  .select('id, project_name, status')
  .order('created_at');
if (error) { console.error(error); process.exit(1); }

// Reason a bid is skipped, or null if it's a target.
const skipReason = (b) => {
  if (TERMINAL.has(b.status)) return `terminal (${b.status})`;
  if (!INCLUDE_CLASSIFIED && NOT_EXTRACTED.has(b.status)) return 'never extracted (classified)';
  if (!INCLUDE_TESTS && TEST_NAME.test(b.project_name ?? '')) return 'test/demo name';
  return null;
};

const targets = bids.filter((b) => !skipReason(b));
const skipped = bids.filter((b) => skipReason(b));

console.log(`Total bids: ${bids.length} | rescanning: ${targets.length} | skipping: ${skipped.length}`);
for (const b of skipped) console.log(`  - skip ${b.id} [${skipReason(b)}] ${(b.project_name ?? '').slice(0, 60)}`);
console.log(`App URL: ${APP_URL}${DRY ? '   [DRY RUN — no calls]' : ''}\n`);

let ok = 0, fail = 0;
for (const b of targets) {
  const label = `${b.id} (${b.status}) ${(b.project_name ?? '').slice(0, 60)}`.trim();
  if (DRY) { console.log(`  would rescan ${label}`); continue; }
  try {
    const res = await fetch(`${APP_URL}/api/projects/${b.id}/estimate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': SECRET },
      body: JSON.stringify({ force: true, force_refresh: true }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok || res.status === 202) { ok++; console.log(`  ✓ ${label} → ${res.status} ${body.async ? 'queued (async)' : 'done'}`); }
    else { fail++; console.log(`  ✗ ${label} → ${res.status} ${body.error || ''} ${body.code || ''}`); }
  } catch (e) { fail++; console.log(`  ✗ ${label} → ${e.message}`); }
  await new Promise((r) => setTimeout(r, 3000)); // gentle on the worker pool
}

console.log(`\nDone. queued/ok=${ok} failed=${fail}. Poll bid status until 'pricing_pending' / 'boq_ready'.`);
if (!DRY) console.log("Note: a 'classified' bid may 4xx (not yet extracted) — restart it from the UI: 'Restart Pipeline from Step 1'.");
