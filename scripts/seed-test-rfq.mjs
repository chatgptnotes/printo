#!/usr/bin/env node
/**
 * One-shot test RFQ seeder — drives /api/seed-test-rfq from the terminal.
 *
 * Usage:
 *   node scripts/seed-test-rfq.mjs              # uses default template 'al_reem'
 *   node scripts/seed-test-rfq.mjs al_reem      # explicit template
 *
 * Env:
 *   APP_URL         base URL of the running dev server (default http://localhost:3001)
 *   TEST_RFQ_EMAIL  admin login email (default admin@sabi.ae)
 *   TEST_RFQ_PASS   admin login password (default admin123)
 *
 * The script logs in first to obtain an auth-token cookie, then POSTs to the
 * seed endpoint. Prints the resulting project URL on success.
 */

const template = process.argv[2] || 'al_reem';
const baseUrl = (process.env.APP_URL || 'http://localhost:3001').replace(/\/$/, '');
const email = process.env.TEST_RFQ_EMAIL || 'admin@sabi.ae';
const password = process.env.TEST_RFQ_PASS || 'admin123';

async function main() {
  // 1. Login to get auth cookie
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!loginRes.ok) {
    const body = await loginRes.text().catch(() => '');
    console.error(`✗ login failed: ${loginRes.status} ${body}`);
    process.exit(1);
  }

  const setCookie = loginRes.headers.get('set-cookie') || '';
  const authTokenMatch = setCookie.match(/auth-token=([^;]+)/);
  if (!authTokenMatch) {
    console.error('✗ login did not set auth-token cookie');
    process.exit(1);
  }
  const cookie = `auth-token=${authTokenMatch[1]}`;

  console.log(`✓ logged in as ${email}`);
  console.log(`→ seeding test RFQ (template: ${template})...`);

  const started = Date.now();
  const seedRes = await fetch(`${baseUrl}/api/seed-test-rfq`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify({ template }),
  });

  const body = await seedRes.json().catch(() => ({}));
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  if (!seedRes.ok) {
    console.error(`✗ seed failed (${seedRes.status}) in ${elapsed}s`);
    console.error(JSON.stringify(body, null, 2));
    process.exit(1);
  }

  console.log(`✓ seeded in ${elapsed}s`);
  console.log(`  project_id:         ${body.project_id}`);
  console.log(`  status:             ${body.status}`);
  console.log(`  gate:               ${body.gate}`);
  console.log(`  attachments:        ${body.attachments_uploaded}`);
  console.log(`  server duration:    ${body.duration_ms}ms`);
  console.log('');
  console.log(`  Open: ${body.url}`);
  console.log('');
}

main().catch((err) => {
  console.error('✗ unexpected error:', err.message);
  process.exit(1);
});
