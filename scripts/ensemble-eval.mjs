#!/usr/bin/env node
// Phase 0 diagnostic + ensemble eval harness for the drawing scanner.
//
// Runs the SAME drawing through the AI gateway many times and measures how much
// the output wobbles run-to-run — then does the same for the 5-agent ensemble
// and shows whether the wobble shrinks. ALSO logs per-run tokensOut/timedOut so
// you can tell whether "sections disappear" is sampling noise (ensemble fixes it)
// or 32k-token truncation (it does NOT — segment the scan instead).
//
// It calls the gateway DIRECTLY (POST /api/invoke-vision), so it bypasses both
// the content-hash cache and the SABI_TEST_FIXTURES replay — every run is a real,
// fresh scan. That is the whole point, and it costs real money on prod infra:
// single mode = R calls, ensemble mode = R*N calls. Default is a DRY RUN that
// only prints the cost plan; pass --yes to actually spend.
//
// Usage:
//   node scripts/ensemble-eval.mjs --file "P-379 POWER (1).pdf"            # dry run, shows plan
//   node scripts/ensemble-eval.mjs --file <pdf> --mode both --reps 5 --yes  # real, ~30 calls
//
// Flags:
//   --file <path>         drawing PDF/PNG/JPG (REQUIRED). Use a REAL drawing, not
//                         tests/fixtures/p379-power-boq.pdf (that is a synthetic
//                         BOQ-output PDF and won't reproduce vision variance).
//   --reps <R>            repetitions per mode (default 5)
//   --mode single|ensemble|both   (default both)
//   --ensemble-size <N>   agents per ensemble rep (default 5)
//   --temperature <t>     ensemble per-agent temperature (default 0.3 — decorrelates)
//   --single-temperature <t>  single-mode temperature (default 0 — matches prod today)
//   --concurrency <c>     max parallel gateway calls (default 1 — the bridge is
//                         single-flight: it serializes and returns 429 "Bridge busy"
//                         on any overlap, so parallelism does NOT speed scans up)
//   --max-tokens <n>      maxTokens per call (default 32000 — match prod; raise to test truncation)
//   --floors <n> --area <sqft> --building-type <s>   building hints for the prompt
//   --out <file.json>     write full raw results + metrics
//   --yes                 actually call the gateway (without it: dry run only)
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { mergeEnsembleResults, keyFor } from './lib/ensemble-merge.mjs';

// ---- CRLF-safe env loader (local .env is CRLF; split on /\r?\n/) ----
for (const f of ['.env', '.env.local']) {
  try {
    for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* file may not exist */ }
}

// ---- args ----
function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}
const FILE = arg('file');
const REPS = parseInt(arg('reps', '5'), 10);
const MODE = arg('mode', 'both');
const N = parseInt(arg('ensemble-size', '5'), 10);
const ENS_TEMP = parseFloat(arg('temperature', '0.3'));
const SINGLE_TEMP = parseFloat(arg('single-temperature', '0'));
const CONCURRENCY = parseInt(arg('concurrency', '1'), 10);
const MAX_TOKENS = parseInt(arg('max-tokens', '32000'), 10);
const OUT = arg('out');
const YES = process.argv.includes('--yes');
const BUILDING = {
  floors: arg('floors'),
  area_sqft: arg('area'),
  building_type: arg('building-type', 'unknown'),
};

const GATEWAY = (process.env.NEXAPROC_GATEWAY_URL || '').replace(/\/+$/, '');
const AIAS_KEY = process.env.DRAWTOBOQ_AIAS_KEY;
const TASK_ID = 'DRAWTOBOQ_ELECTRICAL_EXTRACT';
const SYSTEM_PROMPT =
  'You are an MEP electrical estimator. Respond ONLY with a valid JSON object matching the schema in the user message. No prose, no markdown.';
const FETCH_TIMEOUT_MS = 1_800_000;

if (!FILE) { console.error('ERROR: --file <drawing.pdf> is required'); process.exit(1); }

// ---- frozen copy of worker/server.js buildElectricalProcedurePrompt (KEEP IN SYNC) ----
// extractedText/promptHints frozen empty so the prompt is byte-identical across runs.
function buildPrompt(buildingInfo, agentNonce) {
  const nonce = agentNonce
    ? `\nYou are independent reviewer #${agentNonce}. Read the drawing from scratch and form your own count; do not assume a "standard" answer.\n`
    : '';
  return `You are an MEP electrical estimator following George Varkey's 14-step electrical BOQ procedure for a project in Dubai, UAE.
${nonce}
Building: ${buildingInfo.floors || '?'} floors, ${buildingInfo.area_sqft || '?'} sqft, ${buildingInfo.building_type || 'unknown'} type.

Follow these steps IN ORDER and report findings for each:

Step 1:  Open the drawing — locate all electrical drawings available
Step 2:  List available drawings — classify each as floor_plan / schematic / riser / schedule / other; note which floor each covers
Step 3:  Establish floors and floor height — count and name every level (Basement, Ground, 1F, 2F … Roof). For typical floor height, READ it from the drawing (level datums / FFL/SSL annotations); if none is legible, set typical_floor_height_m to null — do NOT substitute a generic default.
Step 4:  Find drawing scale — read the scale annotation or scale bar (e.g. "1:100"); note if found or not found
Step 5:  Identify LV Room / MDB — find the Main LV Panel / MDB; note tag, rating (A), location
Step 6:  Check availability of schematic drawing — confirm if an SLD/schematic exists; note the filename
Step 7:  Note SMDBs from LV panel — list every SMDB fed from the MDB: tag, floor, rating (A), cable size from MDB, connected_load_kw if shown, qty when a row covers a stack of identical floors
Step 8:  Identify SMDBs in floor drawings Basement→Roof — confirm SMDB locations, cross-check with schematic
Step 9:  Establish probable cable route LV panel → SMDBs — riser drawing/annotations
Step 10: Estimate cable lengths & sizes for LV→SMDB runs — size (mm²), length (m), confidence high/medium/low
Step 11: Establish SMDB → DB identification and cable size — list EVERY individual DB in db_inventory, one row per DB tag (never "DB-T01 to DB-T15"); also populate db_groups[] as a rollup
Step 12: For each SMDB, identify locations of its DBs from floor plans
Step 13: Estimate cable size & length for each SMDB→DB run — smdb_to_db_cables MUST emit one row per individual DB; aggregated rows are FORBIDDEN
Step 14: Prepare cable schedule — compile every cable entry with size (mm²) and length (m); also populate bulk_cables[] with aggregated final-circuit lengths by floor count

Extract first; estimate is a PER-ROW last resort, never a section-level shortcut. READ every sheet, zoom into legends/schedules/notes/floor plans and extract the REAL values floor by floor. Set provisional=true ONLY on rows you genuinely could not read. Read every basement/parking/underground sheet and capture their boards, EV chargers, fans and pumps. Every level in floor_labels MUST appear in the per-floor take-off (at least one power_outlets row AND one lighting_fixtures row). List each physical item exactly ONCE.

Also extract these BOQ sections from the SLD and floor plans (each MANDATORY non-empty when present):
INCOMING SUPPLY (Section 2): each transformer (kVA + voltage ratio), generator (kVA + type), ATS (rating A), HV duct size/count, mobile_generator_provision count.
LV PANELS (Section 3): per LV panel — main incomer ACB rating (A) + breaking capacity (kA), outgoing MCCBs, all capacitor banks.
MECHANICAL EQUIPMENT (Section 6): every dedicated equipment feeder (fire/jockey/booster/sump pumps, FAHU/AHU, fans, lifts, BMU, EV chargers …) with kW or A and count.
POWER OUTLETS (Section 7): per-type counts × floors — one row per (type, floor) with the floor field set; never collapse to one lump row.
LIGHTING FIXTURES (Section 8): read fixture type tags from THIS drawing's legend; one row per fixture type per floor; type_ref + floor set.
CONTAINMENT (Section 9): cable tray + conduit sizes with estimated lengths; provisional=true on estimates.
EARTHING (Section 10): earth pits, earth cable size/length, SPDs.
METERING (Section 11): DEWA kWh meters, CT meters, IMS.
LOAD SUMMARY (Section 12): per LV panel — TCL kW, standby kW, demand factor, max demand kW.

Respond ONLY with valid JSON matching this exact structure:
{
  "drawings_found": [{ "filename": "string", "type": "floor_plan|schematic|riser|schedule|other", "floor": "string or omit", "drawing_number": "string or null", "sheet_number": "string or null", "page_no": "number or null" }],
  "floors_identified": number_or_null,
  "floor_labels": ["string"],
  "typical_floor_height_m": number_or_null,
  "drawing_scale": "string or null",
  "scale_detected": boolean,
  "mdb_info": { "location": "string or null", "rating_a": number_or_null, "floor": "string or null", "tag": "string or null" },
  "schematic_available": boolean,
  "schematic_filename": "string or null",
  "smdb_inventory": [{ "id": "string", "floor": "string", "rating_a": number_or_null, "cable_size_from_mdb": "string or null", "connected_load_kw": number_or_null, "qty": number_or_null }],
  "lv_to_smdb_cables": [{ "from": "string", "to": "string", "size_mm2": number_or_null, "length_m": number_or_null, "route_via": "string or null", "confidence": "high|medium|low", "source_drawing_number": "string or null" }],
  "db_inventory": [{ "smdb_id": "string", "db_id": "string", "floor": "string", "rating_a": number_or_null, "cable_size": "string or null", "source_drawing_number": "string or null" }],
  "db_groups": [{ "tag_pattern": "string", "per_floor_qty": number_or_null, "floors": number_or_null, "total_qty": number, "tcl_range_kw": "string or null" }],
  "smdb_to_db_cables": [{ "from": "string", "to": "string", "size_mm2": number_or_null, "length_m": number_or_null, "confidence": "high|medium|low", "source_drawing_number": "string or null" }],
  "cable_schedule": [{ "from": "string", "to": "string", "size_mm2": number, "length_m": number, "type": "XLPE|fire_rated|LSZH|PVC", "circuit_description": "string or null", "source_drawing_number": "string or null" }],
  "bulk_cables": [{ "specification": "string", "application": "string", "estimated_length_m": number }],
  "incoming_supply": {
    "transformers": [{ "kva": number, "voltage_ratio": "string", "count": number }],
    "generator": { "kva": number, "type": "diesel" } or null,
    "ats": { "rating_a": number } or null,
    "hv_ducts": { "size_mm": number, "count": number } or null,
    "mobile_generator_provision": { "count": number } or null
  },
  "lv_panels": [{ "tag": "string", "main_acb_rating_a": number_or_null, "main_acb_breaking_ka": number_or_null, "outgoing_mccbs": [{ "to": "string", "rating_a": number, "count": number }], "capacitor_bank_kvar": number_or_null, "capacitor_banks": [{ "kvar": number, "isolator_rating_a": number_or_null }] }],
  "mechanical_equipment": [{ "description": "string", "rating_kw": number_or_null, "rating_a": number_or_null, "count": number }],
  "power_outlets": [{ "description": "string", "unit": "No.", "estimated_qty": number, "floor": "string", "provisional": boolean }],
  "lighting_fixtures": [{ "type_ref": "string or null", "description": "string", "floor": "string", "qty": number, "provisional": boolean }],
  "containment": [{ "description": "string", "unit": "m or No.", "estimated_qty": number, "provisional": boolean }],
  "earthing": [{ "description": "string", "unit": "No. or m", "qty": number, "provisional": boolean }],
  "metering": [{ "description": "string", "qty": number, "provisional": boolean }],
  "load_summary": [{ "panel": "string", "tcl_kw": number, "standby_kw": number, "demand_factor": number, "max_demand_kw": number }],
  "confidence": number_between_0_and_1,
  "step_log": [{ "step_num": number, "name": "string", "status": "done|not_found|skipped", "finding": "string" }]
}`;
}

// ---- frozen copy of worker extractJSON + normalizeProcedureResult ----
function extractJSON(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) throw new Error('empty Claude response');
  try { return JSON.parse(trimmed); } catch { /* fallthrough */ }
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1].trim()); } catch { /* fallthrough */ } }
  const s = trimmed.indexOf('{');
  const e = trimmed.lastIndexOf('}');
  if (s >= 0 && e > s) { try { return JSON.parse(trimmed.substring(s, e + 1)); } catch { /* fallthrough */ } }
  throw new Error(`failed to parse JSON (${trimmed.length} chars)`);
}
function normalize(p) {
  if (!p || typeof p !== 'object') return { cable_schedule: [], confidence: 0, step_log: [] };
  const A = (x) => (Array.isArray(x) ? x : []);
  return {
    drawings_found: A(p.drawings_found), floors_identified: p.floors_identified ?? null,
    floor_labels: A(p.floor_labels), typical_floor_height_m: p.typical_floor_height_m ?? null,
    drawing_scale: p.drawing_scale ?? null, scale_detected: p.scale_detected ?? false,
    mdb_info: p.mdb_info ?? { location: null, rating_a: null, floor: null, tag: null },
    schematic_available: p.schematic_available ?? false, schematic_filename: p.schematic_filename ?? null,
    smdb_inventory: A(p.smdb_inventory), lv_to_smdb_cables: A(p.lv_to_smdb_cables),
    db_inventory: A(p.db_inventory), db_groups: A(p.db_groups), smdb_to_db_cables: A(p.smdb_to_db_cables),
    cable_schedule: A(p.cable_schedule), bulk_cables: A(p.bulk_cables),
    incoming_supply: p.incoming_supply ?? { transformers: [], generator: null, ats: null, hv_ducts: null },
    lv_panels: A(p.lv_panels), mechanical_equipment: A(p.mechanical_equipment),
    power_outlets: A(p.power_outlets), lighting_fixtures: A(p.lighting_fixtures),
    containment: A(p.containment), earthing: A(p.earthing), metering: A(p.metering),
    load_summary: A(p.load_summary), confidence: p.confidence ?? 0, step_log: A(p.step_log),
  };
}

const MIME = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

// The bridge is single-flight (429 "Bridge busy" on overlap) and an in-flight
// vision scan holds it for 5-25 min. A 429 costs nothing (no Claude work), so we
// retry on a TIME budget (default 30 min/call) rather than a few quick attempts —
// patient enough to outlast whatever scan currently owns the bridge. Backoff
// 10s→120s. Transient network errors ("fetch failed") are retried too.
const RETRY_BUDGET_MS = parseFloat(arg('retry-minutes', '30')) * 60000;
async function callGateway(fileBuf, fileName, temperature, agentNonce) {
  const start = Date.now();
  for (let attempt = 1; ; attempt++) {
    try {
      return await callGatewayOnce(fileBuf, fileName, temperature, agentNonce);
    } catch (e) {
      const msg = String(e?.message || e);
      const retryable = /gateway 429|gateway 503|busy/i.test(msg) || /fetch failed|ECONNRESET|ETIMEDOUT|socket|EAI_AGAIN/i.test(msg);
      const elapsed = Date.now() - start;
      if (retryable && elapsed < RETRY_BUDGET_MS) {
        const wait = Math.min(120000, 10000 * attempt);
        console.log(`  bridge busy/transient (attempt ${attempt}, ${Math.round(elapsed / 1000)}s elapsed of ${RETRY_BUDGET_MS / 60000}min) — waiting ${wait / 1000}s`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw e;
    }
  }
}

async function callGatewayOnce(fileBuf, fileName, temperature, agentNonce) {
  const form = new FormData();
  form.append('taskID', TASK_ID);
  form.append('payload', JSON.stringify({
    systemPrompt: SYSTEM_PROMPT,
    userText: buildPrompt(BUILDING, agentNonce),
    maxTokens: MAX_TOKENS,
    temperature,
  }));
  form.append('useJson', 'true');
  const mime = MIME[extname(fileName).toLowerCase()] || 'application/octet-stream';
  form.append('files', new Blob([fileBuf], { type: mime }), fileName);

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  const t0 = Date.now();
  let res;
  try {
    res = await fetch(`${GATEWAY}/api/invoke-vision`, {
      method: 'POST', headers: { 'X-Nexaproc-Key': AIAS_KEY }, body: form, signal: ac.signal,
    });
  } finally { clearTimeout(timer); }
  const body = await res.text();
  if (!res.ok) throw new Error(`gateway ${res.status}: ${body.slice(0, 300)}`);
  const env = JSON.parse(body);
  if (!env.ok) throw new Error(`gateway not ok (exit=${env.exitCode} timedOut=${env.timedOut})`);
  const parsed = env.parsed && typeof env.parsed === 'object' ? env.parsed : extractJSON(env.stdout || '');
  return {
    result: normalize(parsed),
    tokensOut: env.tokensOut ?? null,
    timedOut: env.timedOut === true,
    durationMs: env.durationMs ?? (Date.now() - t0),
  };
}

// ---- concurrency pool ----
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ---- metrics ----
function cov(values) {
  const a = values.filter((v) => Number.isFinite(v));
  if (a.length < 2) return null;
  const mean = a.reduce((s, x) => s + x, 0) / a.length;
  if (mean === 0) return null;
  const variance = a.reduce((s, x) => s + (x - mean) ** 2, 0) / (a.length - 1); // sample (ddof=1)
  return Math.sqrt(variance) / Math.abs(mean);
}
const sum = (arr, f) => (Array.isArray(arr) ? arr.reduce((s, x) => s + (Number(f(x)) || 0), 0) : 0);
function numericAggregates(r) {
  return {
    cableCount: (r.cable_schedule || []).length,
    outletQty: sum(r.power_outlets, (x) => x.estimated_qty),
    lightingQty: sum(r.lighting_fixtures, (x) => x.qty),
    cableLength: sum(r.cable_schedule, (x) => x.length_m),
  };
}
function keySet(section, r) {
  return new Set((Array.isArray(r[section]) ? r[section] : []).map((row) => keyFor(section, row)));
}
function meanPairwiseJaccard(results, section) {
  const sets = results.map((r) => keySet(section, r));
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      let inter = 0;
      for (const x of sets[i]) if (sets[j].has(x)) inter++;
      const uni = sets[i].size + sets[j].size - inter;
      total += uni === 0 ? 1 : inter / uni;
      pairs++;
    }
  }
  return pairs ? total / pairs : null;
}
const MANDATORY = ['cable_schedule', 'smdb_inventory', 'db_inventory', 'power_outlets', 'lighting_fixtures', 'containment', 'earthing', 'metering'];
function maxPresenceFlip(results) {
  let worst = 0;
  for (const s of MANDATORY) {
    const present = results.filter((r) => (Array.isArray(r[s]) ? r[s].length : 0) > 0).length / results.length;
    worst = Math.max(worst, 1 - Math.max(present, 1 - present));
  }
  return worst;
}
function metricsFor(results) {
  const aggs = results.map(numericAggregates);
  return {
    n: results.length,
    cov: {
      cableCount: cov(aggs.map((a) => a.cableCount)),
      outletQty: cov(aggs.map((a) => a.outletQty)),
      lightingQty: cov(aggs.map((a) => a.lightingQty)),
      cableLength: cov(aggs.map((a) => a.cableLength)),
    },
    jaccard: {
      cable_schedule: meanPairwiseJaccard(results, 'cable_schedule'),
      db_inventory: meanPairwiseJaccard(results, 'db_inventory'),
      power_outlets: meanPairwiseJaccard(results, 'power_outlets'),
      lighting_fixtures: meanPairwiseJaccard(results, 'lighting_fixtures'),
      containment: meanPairwiseJaccard(results, 'containment'),
    },
    presenceFlip: maxPresenceFlip(results),
    aggregates: aggs,
  };
}

const fmt = (v, d = 2) => (v == null ? ' n/a ' : v.toFixed(d));
function delta(s, e) { return s == null || e == null || s === 0 ? 'n/a' : `${(((e - s) / s) * 100).toFixed(0)}%`; }

// ---- run ----
const fileBuf = readFileSync(FILE);
const fileName = basename(FILE);
const doSingle = MODE === 'single' || MODE === 'both';
const doEnsemble = MODE === 'ensemble' || MODE === 'both';
const singleCalls = doSingle ? REPS : 0;
const ensembleCalls = doEnsemble ? REPS * N : 0;
const totalCalls = singleCalls + ensembleCalls;

console.log('=== Phase 0 / ensemble eval ===');
console.log(`file:        ${fileName} (${(fileBuf.length / 1024).toFixed(0)} KB)`);
console.log(`gateway:     ${GATEWAY || '(NEXAPROC_GATEWAY_URL not set)'}`);
console.log(`mode:        ${MODE}   reps=${REPS}   ensemble-size=${N}   concurrency=${CONCURRENCY}`);
console.log(`temps:       single=${SINGLE_TEMP}  ensemble=${ENS_TEMP}   maxTokens=${MAX_TOKENS}`);
console.log(`projected:   single=${singleCalls} + ensemble=${ensembleCalls} = ${totalCalls} gateway calls (each ~$ + 5-25 min)`);
console.log(`⚠ shares PROD gateway infra — the bridge is SINGLE-FLIGHT (one scan at a time); run off-peak.`);

if (!YES) {
  console.log('\nDRY RUN — no calls made. Re-run with --yes to actually spend.');
  process.exit(0);
}
if (!GATEWAY || !AIAS_KEY) {
  console.error('\nERROR: NEXAPROC_GATEWAY_URL and DRAWTOBOQ_AIAS_KEY must be set (in .env or shell).');
  process.exit(1);
}

function logRun(tag, r) {
  console.log(`  [${tag}] cables=${(r.result.cable_schedule || []).length} tokensOut=${r.tokensOut ?? '?'} timedOut=${r.timedOut} ${Math.round(r.durationMs / 1000)}s`);
}

const report = { file: fileName, mode: MODE, reps: REPS, ensembleSize: N, single: null, ensemble: null };

if (doSingle) {
  console.log(`\n--- single mode: ${REPS} fresh scans (temp ${SINGLE_TEMP}) ---`);
  const runs = (await pool(Array.from({ length: REPS }), CONCURRENCY, async (_x, idx) => {
    try {
      const r = await callGateway(fileBuf, fileName, SINGLE_TEMP, 0);
      logRun(`single ${idx + 1}/${REPS}`, r);
      return r;
    } catch (e) {
      console.error(`  [single ${idx + 1}/${REPS}] FAILED: ${String(e?.message || e).slice(0, 200)}`);
      return null;
    }
  })).filter(Boolean);
  console.log(`  single mode: ${runs.length}/${REPS} scans succeeded`);
  report.single = { metrics: metricsFor(runs.map((r) => r.result)), diagnostics: runs.map((r) => ({ tokensOut: r.tokensOut, timedOut: r.timedOut, durationMs: r.durationMs })), results: runs.map((r) => r.result) };
}

if (doEnsemble) {
  console.log(`\n--- ensemble mode: ${REPS} reps × ${N} agents (temp ${ENS_TEMP}) ---`);
  const reps = [];
  for (let rep = 0; rep < REPS; rep++) {
    const agents = (await pool(Array.from({ length: N }), CONCURRENCY, async (_x, k) => {
      try {
        const r = await callGateway(fileBuf, fileName, ENS_TEMP, k + 1);
        logRun(`rep ${rep + 1} agent ${k + 1}/${N}`, r);
        return r;
      } catch (e) {
        console.error(`  [rep ${rep + 1} agent ${k + 1}/${N}] FAILED: ${String(e?.message || e).slice(0, 200)}`);
        return null;
      }
    })).filter(Boolean);
    const { result, agreement } = mergeEnsembleResults(agents.map((a) => a.result), { requested: N });
    console.log(`  => rep ${rep + 1} merged: cables=${(result.cable_schedule || []).length} overall-agreement=${agreement.overall}`);
    reps.push({ result, agreement, diagnostics: agents.map((a) => ({ tokensOut: a.tokensOut, timedOut: a.timedOut, durationMs: a.durationMs })) });
  }
  report.ensemble = { metrics: metricsFor(reps.map((r) => r.result)), reps };
}

// ---- comparison table + acceptance gate ----
console.log('\n=== RESULTS ===');
if (doSingle && doEnsemble) {
  const s = report.single.metrics;
  const e = report.ensemble.metrics;
  console.log('metric                         single    ensemble   change');
  const row = (label, sv, ev, d) => console.log(`${label.padEnd(30)} ${fmt(sv, 3).padStart(7)}  ${fmt(ev, 3).padStart(8)}   ${d}`);
  row('CoV cable count', s.cov.cableCount, e.cov.cableCount, delta(s.cov.cableCount, e.cov.cableCount));
  row('CoV total outlet qty', s.cov.outletQty, e.cov.outletQty, delta(s.cov.outletQty, e.cov.outletQty));
  row('CoV total lighting qty', s.cov.lightingQty, e.cov.lightingQty, delta(s.cov.lightingQty, e.cov.lightingQty));
  row('CoV total cable length', s.cov.cableLength, e.cov.cableLength, delta(s.cov.cableLength, e.cov.cableLength));
  row('Jaccard cable_schedule', s.jaccard.cable_schedule, e.jaccard.cable_schedule, delta(s.jaccard.cable_schedule, e.jaccard.cable_schedule));
  row('Jaccard db_inventory', s.jaccard.db_inventory, e.jaccard.db_inventory, delta(s.jaccard.db_inventory, e.jaccard.db_inventory));
  row('Jaccard power_outlets', s.jaccard.power_outlets, e.jaccard.power_outlets, delta(s.jaccard.power_outlets, e.jaccard.power_outlets));
  row('Jaccard lighting_fixtures', s.jaccard.lighting_fixtures, e.jaccard.lighting_fixtures, delta(s.jaccard.lighting_fixtures, e.jaccard.lighting_fixtures));
  row('presence-flip (max)', s.presenceFlip, e.presenceFlip, delta(s.presenceFlip, e.presenceFlip));

  // acceptance: ensemble CoV >=50% lower on every numeric; Jaccard >=0.9 structured / >=0.8 free-text; flip 0
  const covPass = ['cableCount', 'outletQty', 'lightingQty', 'cableLength'].every((k) => {
    const sv = s.cov[k]; const ev = e.cov[k];
    return sv == null || ev == null || ev <= sv * 0.5;
  });
  const jPass = (e.jaccard.cable_schedule ?? 0) >= 0.9 && (e.jaccard.db_inventory ?? 0) >= 0.9
    && (e.jaccard.power_outlets ?? 0) >= 0.8 && (e.jaccard.lighting_fixtures ?? 0) >= 0.8;
  const flipPass = (e.presenceFlip ?? 0) === 0;
  const passed = covPass && jPass && flipPass;
  console.log(`\nACCEPTANCE: CoV-halved=${covPass}  Jaccard=${jPass}  no-section-flip=${flipPass}  =>  ${passed ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log('Truncation check: if single-mode tokensOut sits near maxTokens on runs that DROP sections,');
  console.log('the variance is truncation, not sampling — fix by segmenting / raising the cap, not ensembling.');
  report.acceptance = { covPass, jPass, flipPass, passed };
  if (OUT) { writeFileSync(OUT, JSON.stringify(report, null, 2)); console.log(`\nwrote ${OUT}`); }
  process.exit(passed ? 0 : 1);
} else {
  console.log(JSON.stringify((report.single || report.ensemble).metrics, null, 2));
  if (OUT) { writeFileSync(OUT, JSON.stringify(report, null, 2)); console.log(`wrote ${OUT}`); }
}
