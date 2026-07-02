#!/usr/bin/env node
/**
 * One-shot helper to mint a new GOOGLE_REFRESH_TOKEN for Gmail.
 *
 * Usage:
 *   GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy node scripts/get-gmail-token.mjs
 *   (or set them in .env.local first, then: node -r dotenv/config scripts/get-gmail-token.mjs)
 *
 * What it does:
 *   1. Starts a tiny local server on http://localhost:3001
 *   2. Opens your browser to the Google OAuth consent screen
 *   3. After you sign in as estimation@sabi.ae and grant access,
 *      Google redirects back to localhost:3001 with an authorization code
 *   4. The script exchanges that code for a refresh token
 *   5. Prints the refresh token — copy it into Vercel env vars
 *
 * Prerequisites:
 *   - http://localhost:3001 must be in "Authorized redirect URIs" in your
 *     Google Cloud Console OAuth client (already done in your screenshot)
 *   - GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be in env or .env.local
 */

import http from 'node:http';
import { exec } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

// Try to load .env.local manually if env vars not set
function loadEnvLocal() {
  const path = '.env.local';
  if (!existsSync(path)) return;
  const content = readFileSync(path, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvLocal();

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID?.trim();
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET?.trim();
// Match the exact redirect URI you configured in Google Cloud Console.
// Override with: REDIRECT_URI=http://localhost:3001/something node scripts/get-gmail-token.mjs
const REDIRECT_URI = process.env.REDIRECT_URI?.trim() || 'http://localhost:3001/api/gmail/callback';
const PORT = 3001;
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
];

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('❌ Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET');
  console.error('   Set them in .env.local or pass them inline:');
  console.error('   GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy node scripts/get-gmail-token.mjs');
  process.exit(1);
}

const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id', CLIENT_ID);
authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', SCOPES.join(' '));
authUrl.searchParams.set('access_type', 'offline');
authUrl.searchParams.set('prompt', 'consent'); // forces refresh token issuance

console.log('🔑 Gmail Refresh Token Generator');
console.log('================================\n');
console.log('Starting local server on http://localhost:3001 ...');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  // Accept the callback at any path — Google may redirect to /, /callback,
  // /api/projects/callback, etc., depending on what's configured in Cloud Console.
  // We just look for the ?code= parameter.

  if (error) {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end(`<h1>❌ Auth failed</h1><p>${error}</p>`);
    console.error(`\n❌ Auth failed: ${error}`);
    server.close();
    process.exit(1);
  }

  if (!code) {
    // No code yet — return a friendly placeholder so favicons etc. don't crash
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h1>Waiting for OAuth callback...</h1><p>Sign in via the link printed in the terminal.</p>');
    return;
  }

  // Exchange code for tokens
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });

    const tokens = await tokenRes.json();

    if (!tokens.refresh_token) {
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end(`<h1>❌ No refresh_token returned</h1><pre>${JSON.stringify(tokens, null, 2)}</pre>`);
      console.error('\n❌ Google did not return a refresh_token. This usually means:');
      console.error('   - You already authorized this client before (revoke it at https://myaccount.google.com/permissions and try again)');
      console.error('   - The "prompt=consent" parameter was missing');
      console.error('\nFull response:', JSON.stringify(tokens, null, 2));
      server.close();
      process.exit(1);
    }

    // Test the access token by hitting Gmail API profile
    const profileRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await profileRes.json();

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <html><body style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 40px auto; padding: 20px;">
        <h1 style="color: #16a34a;">✅ Success!</h1>
        <p>Authorized as: <strong>${profile.emailAddress || 'unknown'}</strong></p>
        <p>You can close this window and return to your terminal.</p>
      </body></html>
    `);

    console.log('\n✅ SUCCESS! Authorized as:', profile.emailAddress || 'unknown');
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('GOOGLE_REFRESH_TOKEN=' + tokens.refresh_token);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('📋 Next steps:');
    console.log('   1. Copy the GOOGLE_REFRESH_TOKEN value above');
    console.log('   2. Go to Vercel → Settings → Environment Variables');
    console.log('   3. Update GOOGLE_REFRESH_TOKEN with the new value');
    console.log('   4. Redeploy the latest deployment');
    console.log('   5. Test Reply to Client / Send to Client on realsoft.example\n');

    setTimeout(() => {
      server.close();
      process.exit(0);
    }, 500);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end(`<h1>❌ Token exchange failed</h1><pre>${err.message}</pre>`);
    console.error('\n❌ Token exchange failed:', err.message);
    server.close();
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log(`✓ Server listening on http://localhost:${PORT}\n`);
  console.log('Opening browser to Google OAuth consent screen...');
  console.log('(If browser doesn\'t open, copy this URL manually:)\n');
  console.log(authUrl.toString());
  console.log('');

  // Try to open the browser
  const platform = process.platform;
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${cmd} "${authUrl.toString()}"`, (err) => {
    if (err) {
      console.log('⚠  Could not auto-open browser. Click the URL above manually.');
    }
  });

  console.log('Waiting for you to sign in and grant access...');
});
