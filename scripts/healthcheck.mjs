#!/usr/bin/env node
// Quick end-to-end "is everything working" check:
// 1) local dev app  2) VPS gateway health  3) authenticated gateway call  4) auth enforcement
import fs from 'fs';

function loadEnv() {
  const env = {};
  for (const f of ['.env.local', '.env']) {
    try {
      for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !(m[1] in env)) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
      }
    } catch {}
  }
  return env;
}

async function hit(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    return { status: r.status, body: await r.text() };
  } catch (e) {
    return { status: 0, body: String(e.message || e) };
  } finally {
    clearTimeout(t);
  }
}

const env = loadEnv();
const URL = (env.NEXAPROC_GATEWAY_URL || '').trim();
const KEY = (env.DRAWTOBOQ_AIAS_KEY || '').trim();
const APP = 'http://localhost:3001';

const ok = (b) => (b ? 'PASS' : 'FAIL');

console.log('Gateway:', URL || '[MISSING]');
console.log('Key    :', KEY ? `[set, ${KEY.length} chars]` : '[MISSING]');
console.log('');

const local = await hit(APP);
console.log(`[1] Local app (${APP})        -> HTTP ${local.status}  ${ok(local.status >= 200 && local.status < 500)}`);

const health = await hit(`${URL}/health`);
console.log(`[2] Gateway /health            -> HTTP ${health.status}  ${ok(health.status === 200)}`);

const auth = await hit(`${URL}/api/templates`, { headers: { 'X-Nexaproc-Key': KEY } });
let taskInfo = '';
if (auth.status === 200) {
  try {
    const j = JSON.parse(auth.body);
    let names = j.templates || j.tasks || j;
    names = Array.isArray(names) ? names : Object.keys(names);
    taskInfo = '  tasks: ' + JSON.stringify(names).slice(0, 200);
  } catch { taskInfo = '  ' + auth.body.slice(0, 120); }
}
console.log(`[3] Gateway auth (templates)   -> HTTP ${auth.status}  ${ok(auth.status === 200)}${taskInfo}`);

const noKey = await hit(`${URL}/api/templates`);
console.log(`[4] Auth enforced (no key=401) -> HTTP ${noKey.status}  ${ok(noKey.status === 401 || noKey.status === 403)}`);

console.log('');
const allOk = local.status >= 200 && local.status < 500 && health.status === 200 && auth.status === 200 && (noKey.status === 401 || noKey.status === 403);
console.log(allOk ? '==> ALL WORKING' : '==> SOMETHING IS OFF (see FAIL above)');
