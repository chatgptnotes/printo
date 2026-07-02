#!/usr/bin/env node
// Verify required environment variables are set before starting dev/build.
// Run via `npm run check-env`. Wired as a prebuild dependency would block
// builds on missing keys; left manual so CI can opt in explicitly.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ENV_FILE = resolve(process.cwd(), '.env.local');

if (existsSync(ENV_FILE)) {
  const lines = readFileSync(ENV_FILE, 'utf8').split('\n');
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

const REQUIRED = {
  'NEXT_PUBLIC_SUPABASE_URL': 'Supabase project URL — without this, every API route 500s',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY': 'Supabase anon key for client-side reads',
  'SUPABASE_SERVICE_ROLE_KEY': 'Supabase service role key — required for server-side writes',
  'JWT_SECRET': 'Auth cookie signing secret (required in prod, dev falls back to a default)',
  'ANTHROPIC_API_KEY': 'Anthropic API key — Claude Sonnet 4.6 powers all AI calls (classification, extraction, electrical drawing scan). Without it the 14-step pipeline returns the demo stub.',
};

const RECOMMENDED = {
  'INTERNAL_API_SECRET': 'Lets bid-decision survive user JWT expiry mid-estimate (prod only)',
};

let missing = 0;
let warnings = 0;

console.log('Checking required environment variables...\n');
for (const [k, why] of Object.entries(REQUIRED)) {
  if (process.env[k]) {
    console.log(`  ok   ${k}`);
  } else {
    console.log(`  MISS ${k}  — ${why}`);
    missing++;
  }
}

console.log('\nRecommended (not strictly required):');
for (const [k, why] of Object.entries(RECOMMENDED)) {
  if (process.env[k]) {
    console.log(`  ok   ${k}`);
  } else {
    console.log(`  warn ${k}  — ${why}`);
    warnings++;
  }
}

console.log('');
if (missing > 0) {
  console.error(`${missing} required variable(s) missing. Copy .env.example to .env.local and fill them in.`);
  process.exit(1);
}
console.log(`Environment OK${warnings ? ` (${warnings} recommended unset)` : ''}.`);
