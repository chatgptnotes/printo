// drawtoboq-estimate-worker
//
// VPS background worker that takes the Vercel Pro 300s function cap out
// of the Run-to-BOQ path. Vercel kicks this off with project context +
// drawing files; this worker builds the same prompt the Vercel lambda
// would have built, calls the ai-aas gateway (no time limit), runs the
// post-processing (enrichment, empty-cable validation, cache write,
// status update, sabi_services upsert), and writes everything back to
// Supabase. The frontend's existing pollUntilStatus picks up the change.
//
// Auth: shared header DRAWTOBOQ_WORKER_KEY (separate from DRAWTOBOQ_AIAS_KEY).

const express = require('express');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
// Source fetch AND FormData from the SAME undici (the npm 7.x package).
// undici-7's fetch only serializes a body as multipart when it's an instance of
// undici-7's own FormData; pairing it with Node's built-in (undici-6) global
// FormData silently stringifies the body to "[object FormData]" as text/plain,
// so the gateway sees no taskID/files and returns 400 "taskID is required".
// NOTE: undici 7 does NOT export Blob/File — keep Blob as the Node global
// (importing it from undici throws "Blob is not a constructor" at runtime).
// undici-7 FormData accepts the global Blob and wraps it internally.
const { fetch, FormData, Agent, setGlobalDispatcher } = require('undici');

// Node 22 global.fetch uses the BUILT-IN undici 6.x; the npm undici package
// (which we list as a dep) is 7.x — a separate instance. setGlobalDispatcher
// from undici 7 does NOT affect global.fetch. We therefore import fetch from
// undici so that our setGlobalDispatcher call is the one that governs it.
// headersTimeout default in both versions is 300_000 ms (5 min), which is
// exactly the Vercel cap we're trying to escape. Raise it to 30 min so a
// 15–25 min scan never trips an HTTP-layer timeout before the gateway's own
// CLAUDE_TIMEOUT_MS (1800s) ceiling.
setGlobalDispatcher(
  new Agent({
    headersTimeout: 1_800_000,
    bodyTimeout: 1_800_000,
    keepAliveTimeout: 1_800_000,
    keepAliveMaxTimeout: 1_800_000,
  }),
);

const PORT = parseInt(process.env.PORT || '8779', 10);
const WORKER_KEY = process.env.DRAWTOBOQ_WORKER_KEY;
const AIAS_LB_URL = process.env.AIAS_LB_URL || 'http://drawtoboq-aias-lb:80';
const AIAS_KEY = process.env.DRAWTOBOQ_AIAS_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
// ~28 min: under the gateway's 30-min CLAUDE_TIMEOUT_MS ceiling but well above
// the 15–25 min worst-case scan. Override via env if the gateway ceiling moves.
const AIAS_FETCH_TIMEOUT_MS = parseInt(process.env.AIAS_FETCH_TIMEOUT_MS || '1700000', 10);
// Where to push WhatsApp alerts (the app host runs openclaw; the worker can't).
// e.g. http://localhost:3001/api/internal/scan-alert  — disabled if unset.
const SCAN_ALERT_URL = process.env.SCAN_ALERT_URL || '';
// Warn us once if a job is still running this close to the ceiling (default 28 min).
const SCAN_SLOW_WARN_MS = parseInt(process.env.SCAN_SLOW_WARN_MS || '1680000', 10);

const TASK_ID = 'DRAWTOBOQ_ELECTRICAL_EXTRACT';
const MODEL_VISION = 'claude-sonnet-4-6';
const MAX_TOKENS = 32000;
const SYSTEM_PROMPT =
  'You are an MEP electrical estimator. Respond ONLY with a valid JSON object matching the schema in the user message. No prose, no markdown.';

if (!WORKER_KEY) throw new Error('DRAWTOBOQ_WORKER_KEY is required');
if (!AIAS_KEY) throw new Error('DRAWTOBOQ_AIAS_KEY is required');
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 10 },
});

const app = express();

app.get('/health', (req, res) => {
  res.json({
    status: 'online',
    service: 'drawtoboq-estimate-worker',
    uptimeSec: Math.round(process.uptime()),
  });
});

app.post('/run', upload.array('files'), async (req, res) => {
  if (req.header('X-Worker-Key') !== WORKER_KEY) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const projectId = req.body.project_id;
  const cacheKey = req.body.cache_key;
  const buildingInfoJSON = req.body.building_info;
  const inputSummaryJSON = req.body.input_summary;
  const promptHints = req.body.prompt_hints || '';
  const extractedText = req.body.extracted_text || '';
  const estimatedCostUsd = parseFloat(req.body.estimated_cost_usd || '0.5');
  const correlationId = req.body.correlation_id || (cacheKey ? cacheKey.slice(0, 12) : 'no-corr');

  if (!projectId || !cacheKey || !buildingInfoJSON || !inputSummaryJSON) {
    return res.status(400).json({
      error: 'missing required fields',
      need: ['project_id', 'cache_key', 'building_info', 'input_summary'],
    });
  }

  let buildingInfo, inputSummary;
  try {
    buildingInfo = JSON.parse(buildingInfoJSON);
    inputSummary = JSON.parse(inputSummaryJSON);
  } catch (e) {
    return res.status(400).json({ error: `invalid JSON: ${e.message}` });
  }

  const files = (req.files || []).map(f => ({
    name: f.originalname,
    mime: f.mimetype,
    buffer: f.buffer,
  }));

  if (files.length === 0) {
    return res.status(400).json({ error: 'no files uploaded' });
  }

  console.log(
    `[worker] accepted job project=${projectId} corr=${correlationId} files=${files.length} bytes=${files.reduce((s, f) => s + f.buffer.length, 0)}`,
  );

  res.status(202).json({
    accepted: true,
    project_id: projectId,
    correlation_id: correlationId,
    files: files.length,
  });

  processEstimate({
    projectId,
    cacheKey,
    buildingInfo,
    inputSummary,
    promptHints,
    extractedText,
    estimatedCostUsd,
    files,
    correlationId,
  }).catch(err => {
    console.error(`[worker] job ${correlationId} crashed outside try:`, err);
  });
});

app.use((err, req, res, next) => {
  console.error('[worker] unhandled error:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: err.message || 'internal error' });
});

// Push a WhatsApp alert through the app host (which has openclaw linked); the
// worker host can't reach openclaw directly. Fire-and-forget — a notification
// failure must never mask the real scan error.
async function notifyScanAlert(kind, message, projectId) {
  if (!SCAN_ALERT_URL) return;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8_000);
  try {
    await fetch(SCAN_ALERT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Worker-Key': WORKER_KEY },
      body: JSON.stringify({ kind, message: String(message).slice(0, 500), projectId }),
      signal: ac.signal,
    });
  } catch (e) {
    console.error('[worker] scan-alert push failed:', e && e.message ? e.message : e);
  } finally {
    clearTimeout(timer);
  }
}

// Write a progress row to sabi_activity_log so the bid page (which polls the
// project + its activity_log every few seconds) shows the scan moving along
// live, instead of a blind spinner. sub_pipeline='electrical' matches the
// app's own sub-pipeline rows.
async function logWorkerActivity(projectId, step, stepName, status, details) {
  try {
    const { error } = await supabase.from('sabi_activity_log').insert({
      project_id: projectId,
      step,
      step_name: stepName,
      status,
      details: details || null,
      sub_pipeline: 'electrical',
    });
    if (error) console.error('[worker] activity log insert failed:', error.message);
  } catch (e) {
    console.error('[worker] activity log insert threw:', e && e.message ? e.message : e);
  }
}

async function processEstimate({
  projectId,
  cacheKey,
  buildingInfo,
  inputSummary,
  promptHints,
  extractedText,
  estimatedCostUsd,
  files,
  correlationId,
}) {
  const t0 = Date.now();
  // Live progress marker #1 — the file reached the VPS and scanning has begun.
  await logWorkerActivity(projectId, 1, 'VPS worker received drawing — scan started', 'completed', {
    files: files.length,
    bytes: files.reduce((s, f) => s + f.buffer.length, 0),
  });
  // Warn us once if the scan is still running near the 30-min ceiling, so we
  // hear about it *inside* the window rather than after a silent hard-timeout.
  const slowTimer = setTimeout(() => {
    void notifyScanAlert(
      'scan_slow',
      `⏳ SABI: scan ${correlationId} (project ${projectId}) still running after ${Math.round(SCAN_SLOW_WARN_MS / 60000)} min — nearing the 30-min limit.`,
      projectId,
    );
  }, SCAN_SLOW_WARN_MS);
  try {
    const userText = buildElectricalProcedurePrompt({ promptHints, buildingInfo, extractedText });
    const payload = { systemPrompt: SYSTEM_PROMPT, userText, maxTokens: MAX_TOKENS };

    const { result: rawResult, truncated: scanTruncated, truncationDetail: scanTruncationDetail } =
      await callAiasInvokeVision({ taskID: TASK_ID, payload, files });
    const result = normalizeProcedureResult(rawResult);
    let enriched = enrichElectricalResult(result);
    const cableCount = (enriched.cable_schedule || []).length;
    const elapsedSec = Math.round((Date.now() - t0) / 1000);
    console.log(
      `[worker] ${correlationId} ai-aas done in ${elapsedSec}s | cable_schedule=${cableCount} confidence=${enriched.confidence}`,
    );
    // Live progress marker #2 — the AI scan returned; show how much it found.
    await logWorkerActivity(
      projectId,
      14,
      `AI scan complete in ${elapsedSec}s — ${cableCount} cables found`,
      'completed',
      { cable_schedule: cableCount, confidence: enriched.confidence },
    );

    if (cableCount === 0 && !enriched.stub) {
      const reason =
        'Electrical analysis returned 0 cables — no electrical drawings detected or AI extraction was incomplete.';
      await supabase
        .from('sabi_projects')
        .update({
          status: 'extracted',
          notes: JSON.stringify({ last_error: reason, last_error_at: new Date().toISOString() }),
          updated_at: new Date().toISOString(),
        })
        .eq('id', projectId);
      console.log(`[worker] ${correlationId} rolled back to 'extracted' (0 cables)`);
      await logWorkerActivity(projectId, 14, 'Scan returned 0 cables — rolled back (check drawings / extraction)', 'failed', { reason });
      await notifyScanAlert(
        'scan_failed',
        `⚠️ SABI: scan ${correlationId} (project ${projectId}) returned 0 cables — rolled back. Check the drawings / AI extraction.`,
        projectId,
      );
      return;
    }

    await supabase.from('sabi_drawing_analysis_cache').upsert(
      {
        cache_key: cacheKey,
        model: MODEL_VISION,
        procedure_version: 'electrical-v1',
        input_summary: inputSummary,
        result: enriched,
        est_savings_usd: estimatedCostUsd,
      },
      { onConflict: 'cache_key' },
    );

    // Post-scan validation gate + ONE targeted gap-fill retry — same as the
    // in-process path. If a required section came back MISSING, re-read the
    // drawing once for just those sections, merge, and re-validate. Flag, never
    // reject (only hard block is the 0-cable gate above).
    // Fires on ANY missing fillable section, not only error-severity ones:
    // incoming_supply / lv_panels / mechanical_equipment are warning-severity (so
    // `passed` stays true) yet are routinely dropped under output pressure — they
    // still earn the one re-read. KEEP IN SYNC with the in-process route.
    let report = validateElectricalScan(enriched);
    const missingFillable = gapFillableSections(report.stats.sectionsMissing);
    if (missingFillable.length > 0) {
      await logWorkerActivity(projectId, 14, `Re-reading drawing for missing: ${missingFillable.join(', ')}`, 'started', { missing: missingFillable });
      try {
        const gapPayload = {
          systemPrompt: SYSTEM_PROMPT,
          userText: buildGapFillPrompt(missingFillable, buildingInfo, extractedText),
          maxTokens: 8000,
        };
        const { result: gapRaw } = await callAiasInvokeVision({ taskID: TASK_ID, payload: gapPayload, files });
        enriched = mergeGapFill(enriched, gapRaw, missingFillable);
      } catch (e) {
        console.warn(`[worker] ${correlationId} gap-fill failed: ${e && e.message ? e.message : e}`);
      }
      report = validateElectricalScan(enriched);
      report.retried = true;
    }

    // Per-floor gap-fill — floors established in Step 3 but with no per-floor
    // take-off get ONE focused re-read of just those floors' sheets (outlets +
    // lighting), then merge by appending. Independent of the section retry above.
    if (report.stats.floorsEmpty.length > 0) {
      const emptyFloors = report.stats.floorsEmpty;
      await logWorkerActivity(projectId, 14, `Re-reading floors with no take-off: ${emptyFloors.join(', ')}`, 'started', { floors: emptyFloors });
      try {
        const floorPayload = {
          systemPrompt: SYSTEM_PROMPT,
          userText: buildFloorGapFillPrompt(emptyFloors, buildingInfo, extractedText),
          maxTokens: 8000,
        };
        const { result: floorGapRaw } = await callAiasInvokeVision({ taskID: TASK_ID, payload: floorPayload, files });
        enriched = mergeFloorGapFill(enriched, floorGapRaw, emptyFloors);
      } catch (e) {
        console.warn(`[worker] ${correlationId} floor gap-fill failed: ${e && e.message ? e.message : e}`);
      }
      report = validateElectricalScan(enriched);
      report.retried = true;
    }
    // Gap-fill (above) appends rows AFTER the sort inside enrichElectricalResult,
    // so re-order once more here to keep the persisted result canonical regardless
    // of whether a re-read fired. Idempotent when no gap-fill ran.
    enriched = sortElectricalResult(enriched);
    const scanValidation = report;
    // Truncation flag (Step 2 — detect, don't block): the main scan hit/near the token
    // cap, so the JSON was likely cut and sections can silently vary run-to-run. Surface
    // it on the validation report + as a loud activity row so it's visible in the bid page
    // (don't fail the scan — a partial result still beats a dead 20-min run). The durable
    // fix is segmenting the scan; this just makes the problem visible. KEEP IN SYNC with
    // the in-process route if that path gains the same detection.
    if (scanTruncated) {
      scanValidation.truncated = scanTruncationDetail;
      await logWorkerActivity(
        projectId,
        14,
        `⚠ Scan output hit the ${scanTruncationDetail.cap}-token cap (tokensOut=${scanTruncationDetail.tokensOut ?? '?'}) — result may be PARTIAL; sections can vary run-to-run. Segment the scan or raise the cap.`,
        'failed',
        scanTruncationDetail,
      );
      console.warn(`[worker] ${correlationId} TRUNCATION suspected: ${JSON.stringify(scanTruncationDetail)}`);
    }
    await logWorkerActivity(
      projectId,
      14,
      scanValidation.passed ? 'Scan validation passed' : 'Scan validation flagged gaps — review or re-run',
      scanValidation.passed ? 'completed' : 'failed',
      { summary: summarizeScanValidation(scanValidation), violations: scanValidation.violations, stats: scanValidation.stats },
    );
    if (!scanValidation.passed) {
      console.warn(`[worker] ${correlationId} ${summarizeScanValidation(scanValidation)}`);
    }

    const aiExtraction = {
      raw_electrical_procedure: enriched,
      cable_schedule: enriched.cable_schedule || [],
      smdb_inventory: enriched.smdb_inventory || [],
      db_inventory: enriched.db_inventory || [],
      mdb_info: enriched.mdb_info || null,
      incoming_supply: enriched.incoming_supply || null,
      lv_panels: enriched.lv_panels || [],
      mechanical_equipment: enriched.mechanical_equipment || [],
      power_outlets: enriched.power_outlets || [],
      lighting_fixtures: enriched.lighting_fixtures || [],
      containment: enriched.containment || [],
      earthing: enriched.earthing || [],
      metering: enriched.metering || [],
      load_summary: enriched.load_summary || [],
      scan_validation: scanValidation,
    };
    const confidenceTier =
      enriched.confidence >= 0.7 ? 'high' : enriched.confidence >= 0.4 ? 'medium' : 'low';

    const { data: existing } = await supabase
      .from('sabi_services')
      .select('id')
      .eq('project_id', projectId)
      .eq('service_type', 'electrical')
      .maybeSingle();
    if (existing) {
      await supabase
        .from('sabi_services')
        .update({
          is_required: true,
          ai_extraction: aiExtraction,
          confidence: confidenceTier,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
    } else {
      await supabase.from('sabi_services').insert({
        project_id: projectId,
        service_type: 'electrical',
        is_required: true,
        ai_extraction: aiExtraction,
        confidence: confidenceTier,
      });
    }

    await supabase
      .from('sabi_projects')
      .update({
        status: 'pricing_pending',
        notes: JSON.stringify({ approval_gate: 12 }),
        updated_at: new Date().toISOString(),
      })
      .eq('id', projectId);

    console.log(
      `[worker] ${correlationId} success: status=pricing_pending cable_schedule=${cableCount}`,
    );
    // Live progress marker #3 — done; UI will flip to the cable-schedule review.
    await logWorkerActivity(
      projectId,
      14,
      'Electrical scan complete — ready for cable-schedule review (Gate 12)',
      'completed',
      { cable_schedule: cableCount },
    );
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    console.error(`[worker] ${correlationId} failed:`, message);
    await supabase
      .from('sabi_projects')
      .update({
        status: 'extracted',
        notes: JSON.stringify({
          last_error: `worker: ${message.slice(0, 500)}`,
          last_error_at: new Date().toISOString(),
        }),
        updated_at: new Date().toISOString(),
      })
      .eq('id', projectId);
    await logWorkerActivity(projectId, 1, `Worker scan failed: ${message.slice(0, 120)}`, 'failed', { error: message.slice(0, 300) });
    await notifyScanAlert(
      'scan_failed',
      `🚨 SABI: scan ${correlationId} FAILED (project ${projectId}): ${message.slice(0, 200)}`,
      projectId,
    );
  } finally {
    clearTimeout(slowTimer);
  }
}

async function callAiasInvokeVision({ taskID, payload, files }) {
  const form = new FormData();
  form.append('taskID', taskID);
  form.append('payload', JSON.stringify(payload));
  form.append('useJson', 'true');
  for (const f of files) {
    form.append('files', new Blob([f.buffer], { type: f.mime }), f.name);
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), AIAS_FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${AIAS_LB_URL}/api/invoke-vision`, {
      method: 'POST',
      headers: { 'X-Nexaproc-Key': AIAS_KEY },
      body: form,
      signal: ac.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  const bodyText = await res.text();
  if (!res.ok) {
    throw new Error(`ai-aas ${res.status}: ${bodyText.slice(0, 300)}`);
  }
  let envelope;
  try {
    envelope = JSON.parse(bodyText);
  } catch (e) {
    throw new Error(`ai-aas non-JSON envelope: ${bodyText.slice(0, 200)}`);
  }
  if (!envelope.ok) {
    const stderr = (envelope.stderr || '').slice(0, 300);
    throw new Error(`ai-aas not ok (exit=${envelope.exitCode} timedOut=${envelope.timedOut}): ${stderr}`);
  }
  if (envelope.timedOut) {
    throw new Error('ai-aas reported timedOut=true');
  }

  // Truncation detection. The CLI-via-gateway envelope has no `stop_reason`, so infer
  // a hit token cap from tokensOut sitting at/near maxTokens (primary signal), and/or
  // the JSON having to be salvaged by substring because the clean parse failed
  // (secondary signal — the response was likely cut). We FLAG, never throw: the worker
  // is the long async path and a partial result beats failing a 20-min scan — but it
  // must be surfaced (sections can silently vanish run-to-run when output is truncated).
  const cap = (payload && payload.maxTokens) || MAX_TOKENS;
  const tokensOut = typeof envelope.tokensOut === 'number' ? envelope.tokensOut : null;
  const nearCap = tokensOut != null && tokensOut >= cap - Math.max(200, Math.round(cap * 0.01));
  let result;
  let salvaged = false;
  if (envelope.parsed && typeof envelope.parsed === 'object') {
    result = envelope.parsed;
  } else {
    const parsed = extractJSON(envelope.stdout || '');
    result = parsed.value;
    salvaged = parsed.salvaged;
  }
  return { result, tokensOut, truncated: nearCap || salvaged, truncationDetail: { tokensOut, cap, nearCap, salvaged } };
}

function extractJSON(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) throw new Error('empty Claude response');
  try { return { value: JSON.parse(trimmed), salvaged: false }; } catch (_) {}
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try { return { value: JSON.parse(fence[1].trim()), salvaged: false }; } catch (_) {}
  }
  const s = trimmed.indexOf('{');
  const e = trimmed.lastIndexOf('}');
  if (s >= 0 && e > s) {
    // Substring salvage = the clean parse failed and we recovered a prefix object —
    // a strong sign the response was cut mid-structure.
    try { return { value: JSON.parse(trimmed.substring(s, e + 1)), salvaged: true }; } catch (_) {}
  }
  throw new Error(
    `failed to parse JSON from Claude response (${trimmed.length} chars, head=${trimmed.slice(0, 80).replace(/\n/g, ' ')})`,
  );
}

// Mirrors the post-parse normalisation in claude-api.ts analyzeElectricalProcedure.
function normalizeProcedureResult(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return { cable_schedule: [], confidence: 0, step_log: [] };
  }
  const emptySupply = () => ({ transformers: [], generator: null, ats: null, hv_ducts: null });
  return {
    drawings_found: Array.isArray(parsed.drawings_found) ? parsed.drawings_found : [],
    floors_identified: parsed.floors_identified ?? null,
    floor_labels: Array.isArray(parsed.floor_labels) ? parsed.floor_labels : [],
    typical_floor_height_m: parsed.typical_floor_height_m ?? null,
    drawing_scale: parsed.drawing_scale ?? null,
    scale_detected: parsed.scale_detected ?? false,
    mdb_info: parsed.mdb_info ?? { location: null, rating_a: null, floor: null, tag: null },
    schematic_available: parsed.schematic_available ?? false,
    schematic_filename: parsed.schematic_filename ?? null,
    smdb_inventory: Array.isArray(parsed.smdb_inventory) ? parsed.smdb_inventory : [],
    lv_to_smdb_cables: Array.isArray(parsed.lv_to_smdb_cables) ? parsed.lv_to_smdb_cables : [],
    db_inventory: Array.isArray(parsed.db_inventory) ? parsed.db_inventory : [],
    db_groups: Array.isArray(parsed.db_groups) ? parsed.db_groups : undefined,
    smdb_to_db_cables: Array.isArray(parsed.smdb_to_db_cables) ? parsed.smdb_to_db_cables : [],
    cable_schedule: Array.isArray(parsed.cable_schedule) ? parsed.cable_schedule : [],
    bulk_cables: Array.isArray(parsed.bulk_cables) ? parsed.bulk_cables : undefined,
    incoming_supply: parsed.incoming_supply ?? emptySupply(),
    lv_panels: Array.isArray(parsed.lv_panels) ? parsed.lv_panels : [],
    mechanical_equipment: Array.isArray(parsed.mechanical_equipment) ? parsed.mechanical_equipment : [],
    power_outlets: Array.isArray(parsed.power_outlets) ? parsed.power_outlets : [],
    lighting_fixtures: Array.isArray(parsed.lighting_fixtures) ? parsed.lighting_fixtures : [],
    containment: Array.isArray(parsed.containment) ? parsed.containment : [],
    earthing: Array.isArray(parsed.earthing) ? parsed.earthing : [],
    metering: Array.isArray(parsed.metering) ? parsed.metering : [],
    load_summary: Array.isArray(parsed.load_summary) ? parsed.load_summary : [],
    confidence: parsed.confidence ?? 0,
    step_log: Array.isArray(parsed.step_log) ? parsed.step_log : [],
  };
}

// JS port of floorForCable() in src/lib/electrical/derive-cable-paths.ts —
// KEEP IN SYNC. Reads the floor a run belongs to from its endpoint tags so the
// take-off table / Excel cable bill don't show a blank floor on itemised rows.
function floorForCable(from, to) {
  const read = (tag) => {
    const t = (tag || '').toUpperCase();
    const numF = t.match(/-?(\d+)\s*F\b/);
    if (numF) return `${parseInt(numF[1], 10)}F`;
    if (/-?RF\b|ROOF/.test(t)) return 'Roof';
    if (/-?SH\d/.test(t)) return 'Ground';
    if (/-?EV\b|BASEMENT|-?B\d/.test(t)) return 'Basement';
    if (/-?GF?\b|GROUND/.test(t)) return 'Ground';
    return null;
  };
  return read(to) ?? read(from);
}

function enrichElectricalResult(result) {
  if (!result || typeof result !== 'object') return { cable_schedule: [], confidence: 0 };
  const withFloor = (rows) =>
    (Array.isArray(rows) ? rows : []).map((c) => ({ ...c, floor: c.floor ?? floorForCable(c.from, c.to) }));
  // Final: deterministically order every section so the same drawing always renders
  // the same row order (the scan is non-deterministic run-to-run). Pure reorder.
  return sortElectricalResult({
    ...result,
    cable_schedule: withFloor(result.cable_schedule),
    lv_to_smdb_cables: Array.isArray(result.lv_to_smdb_cables) ? result.lv_to_smdb_cables : [],
    smdb_to_db_cables: withFloor(result.smdb_to_db_cables),
    db_inventory: Array.isArray(result.db_inventory) ? result.db_inventory : [],
    smdb_inventory: Array.isArray(result.smdb_inventory) ? result.smdb_inventory : [],
  });
}

// Post-scan validation gate (flag, don't block). JS port of
// src/lib/electrical/scan-validation.ts — KEEP IN SYNC: when one changes,
// change both. Checks the 14-step procedure + completeness logic and returns a
// report that gets attached to ai_extraction.scan_validation; it never rejects
// the result (the only hard block is the 0-cable gate in processEstimate).
const SCAN_EXPECTED_STEPS = 14;
const SCAN_SECTION_RULES = [
  { key: 'cable_schedule', label: 'Cable schedule', severity: 'error' },
  { key: 'smdb_inventory', label: 'SMDBs', severity: 'error' },
  { key: 'db_inventory', label: 'DBs', severity: 'error' },
  { key: 'power_outlets', label: 'Power outlets', severity: 'error' },
  { key: 'lighting_fixtures', label: 'Lighting', severity: 'error' },
  { key: 'containment', label: 'Containment', severity: 'error' },
  { key: 'earthing', label: 'Earthing', severity: 'error' },
  { key: 'metering', label: 'Metering', severity: 'error' },
  { key: 'lv_panels', label: 'LV panels', severity: 'warning' },
  { key: 'mechanical_equipment', label: 'Mechanical', severity: 'warning' },
  { key: 'load_summary', label: 'Load summary', severity: 'warning' },
];
const SCAN_AGG_PATTERNS = [
  /\bto\b/i,
  /\d+\s*[-–]\s*\d+/,
  /per\s+typical/i,
  /typical\s+floor/i,
  /\b(odd|even|all|each)\s+floors?\b/i,
  /\bx\s*\d+\b/i,
];
function scanArr(v) {
  return Array.isArray(v) ? v : [];
}
function scanLooksAggregated(tag) {
  if (!tag) return false;
  return SCAN_AGG_PATTERNS.some(re => re.test(tag));
}
// EXTRACTED / ESTIMATED (all rows provisional) / MISSING (empty).
function scanSectionState(rows) {
  if (rows.length === 0) return 'missing';
  return rows.every(r => r && r.provisional === true) ? 'estimated' : 'extracted';
}
function validateElectricalScan(result) {
  const violations = [];
  const sectionsMissing = [];
  const sectionsEstimated = [];
  const r = result || {};
  const isStub = r.stub === true;

  // A step counts as "covered" if it appears in step_log under ANY status —
  // 'not_found'/'skipped' are legitimate outcomes, not incomplete work. Step
  // gaps are warnings (audit-trail signal); an absent log is one warning.
  const stepLog = scanArr(r.step_log);
  const coveredSteps = new Set(
    stepLog.filter(s => s && typeof s.step_num === 'number').map(s => s.step_num),
  );
  if (!isStub) {
    if (stepLog.length === 0) {
      violations.push({
        code: 'STEPS_LOG_MISSING',
        severity: 'warning',
        kind: 'other',
        section: 'step_log',
        message: `Steps — no step log (can't confirm all ${SCAN_EXPECTED_STEPS} ran)`,
      });
    } else {
      const missingSteps = [];
      for (let n = 1; n <= SCAN_EXPECTED_STEPS; n++) if (!coveredSteps.has(n)) missingSteps.push(n);
      if (missingSteps.length > 0) {
        violations.push({
          code: 'STEPS_INCOMPLETE',
          severity: 'warning',
          kind: 'other',
          section: 'step_log',
          message: `Steps — ${missingSteps.length}/${SCAN_EXPECTED_STEPS} not logged (${missingSteps.join(', ')})`,
          count: missingSteps.length,
        });
      }
    }
  }

  if (!isStub) {
    for (const rule of SCAN_SECTION_RULES) {
      const state = scanSectionState(scanArr(r[rule.key]));
      if (state === 'missing') {
        sectionsMissing.push(rule.key);
        violations.push({
          code: 'SECTION_MISSING',
          severity: rule.severity,
          kind: 'missing',
          section: rule.key,
          message: `${rule.label} — missing (not in drawing)`,
        });
      } else if (state === 'estimated') {
        sectionsEstimated.push(rule.key);
        violations.push({
          code: 'SECTION_ESTIMATED',
          severity: 'warning',
          kind: 'estimated',
          section: rule.key,
          message: `${rule.label} — estimated, verify`,
        });
      }
    }
    const transformers = scanArr(r.incoming_supply && r.incoming_supply.transformers).length;
    if (transformers === 0) {
      sectionsMissing.push('incoming_supply');
      violations.push({
        code: 'SECTION_MISSING',
        severity: 'warning',
        kind: 'missing',
        section: 'incoming_supply',
        message: 'Incoming supply — missing (no transformers)',
      });
    }
  }

  const outlets = scanArr(r.power_outlets);
  const outletsNoFloor = outlets.filter(o => !o.floor || String(o.floor).trim() === '').length;
  if (!isStub && outlets.length > 0 && outletsNoFloor === outlets.length) {
    violations.push({
      code: 'OUTLETS_NOT_PER_FLOOR',
      severity: 'warning',
      kind: 'other',
      section: 'power_outlets',
      message: 'Power outlets — not split per floor',
      count: outletsNoFloor,
    });
  }

  const dbCables = scanArr(r.smdb_to_db_cables);
  const cablesNoFloor = dbCables.filter(c => !c.floor || String(c.floor).trim() === '').length;
  if (!isStub && dbCables.length > 0 && cablesNoFloor === dbCables.length) {
    violations.push({
      code: 'DB_CABLES_NOT_PER_FLOOR',
      severity: 'warning',
      kind: 'other',
      section: 'smdb_to_db_cables',
      message: 'SMDB→DB cables — not split per floor',
      count: cablesNoFloor,
    });
  }

  const aggDbTags = scanArr(r.db_inventory).map(d => d.db_id).filter(scanLooksAggregated);
  if (aggDbTags.length > 0) {
    violations.push({
      code: 'DB_AGGREGATED',
      severity: 'error',
      kind: 'other',
      section: 'db_inventory',
      message: `DBs — ${aggDbTags.length} aggregated rows (enumerate individually)`,
      count: aggDbTags.length,
      sample: aggDbTags.slice(0, 5),
    });
  }
  const aggCableTags = dbCables.map(c => c.to).filter(scanLooksAggregated);
  if (aggCableTags.length > 0) {
    violations.push({
      code: 'DB_CABLES_AGGREGATED',
      severity: 'error',
      kind: 'other',
      section: 'smdb_to_db_cables',
      message: `SMDB→DB cables — ${aggCableTags.length} aggregated destinations`,
      count: aggCableTags.length,
      sample: aggCableTags.slice(0, 5),
    });
  }

  // ── 5. Every established floor has a per-floor take-off ────────────────
  const floorsEmpty = [];
  const floorLabels = scanArr(r.floor_labels).filter(l => typeof l === 'string' && l.trim() !== '');
  const floorWiseRows = [
    ...scanArr(r.power_outlets),
    ...scanArr(r.lighting_fixtures),
    ...scanArr(r.db_inventory),
    ...scanArr(r.smdb_inventory),
    ...scanArr(r.smdb_to_db_cables),
  ];
  const sectionFloorKeys = new Set();
  for (const row of floorWiseRows) {
    const k = canonFloorKey(row && row.floor);
    if (k) sectionFloorKeys.add(k);
  }
  if (!isStub && floorLabels.length >= 2 && sectionFloorKeys.size > 0) {
    const seen = new Set();
    for (const label of floorLabels) {
      const k = canonFloorKey(label);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      if (!floorIsCovered(k, sectionFloorKeys)) floorsEmpty.push(label.trim());
    }
    if (floorsEmpty.length > 0) {
      violations.push({
        code: 'FLOORS_EMPTY',
        severity: 'warning',
        kind: 'missing',
        section: 'floors',
        message: `Floors with no take-off — ${floorsEmpty.length} empty, re-scan: ${floorsEmpty.slice(0, 8).join(', ')}`,
        count: floorsEmpty.length,
        sample: floorsEmpty.slice(0, 8),
      });
    }
  }

  // ── 6. Typical-floor multiplication could not run (B3) ─────────────────
  if (!isStub && typeof r.typical_floor_warning === 'string' && r.typical_floor_warning.trim() !== '') {
    violations.push({
      code: 'TYPICAL_FLOOR_NOT_MULTIPLIED',
      severity: 'warning',
      kind: 'other',
      section: 'smdb_to_db_cables',
      message: r.typical_floor_warning.trim(),
    });
  }

  const passed = violations.every(v => v.severity !== 'error');
  return {
    passed,
    retried: false,
    generatedAt: new Date().toISOString(),
    violations,
    stats: {
      stepsDone: coveredSteps.size,
      stepsExpected: SCAN_EXPECTED_STEPS,
      cableRuns: scanArr(r.cable_schedule).length,
      sectionsMissing,
      sectionsEstimated,
      floorsEmpty,
    },
  };
}
function summarizeScanValidation(report) {
  if (report.violations.length === 0) {
    return `Scan complete — all ${report.stats.stepsExpected} steps + every section read from the drawing.`;
  }
  const missing = report.stats.sectionsMissing.length;
  const estimated = report.stats.sectionsEstimated.length;
  const prefix = report.retried ? 'After re-scan: ' : '';
  const head = report.passed
    ? `${prefix}complete${estimated ? `, ${estimated} estimated` : ''}`
    : `${prefix}INCOMPLETE — ${missing} missing${estimated ? `, ${estimated} estimated` : ''}`;
  const detail = report.violations
    .slice(0, 5)
    .map(v => (v.severity === 'error' ? '✗ ' : '⚠ ') + v.message)
    .join(' · ');
  return `${head}. ${detail}`;
}

// Targeted gap-fill — JS port of src/lib/electrical/gap-fill.ts (KEEP IN SYNC).
// One focused re-read of the missing sections; extract-from-file first, mark
// estimates provisional. Pure helpers; the AI call is callAiasInvokeVision.
const GAP_FILL_SCHEMAS = {
  lighting_fixtures:
    '"lighting_fixtures": [{ "type_ref": "string or null", "description": "string", "floor": "string", "qty": number, "provisional": boolean }]',
  power_outlets:
    '"power_outlets": [{ "description": "string", "unit": "No.", "estimated_qty": number, "floor": "string", "provisional": boolean }]',
  containment:
    '"containment": [{ "description": "string", "unit": "m or No.", "estimated_qty": number, "provisional": boolean }]',
  earthing:
    '"earthing": [{ "description": "string", "unit": "No. or m", "qty": number, "provisional": boolean }]',
  metering: '"metering": [{ "description": "string", "qty": number, "provisional": boolean }]',
  mechanical_equipment:
    '"mechanical_equipment": [{ "description": "string", "rating_kw": number_or_null, "rating_a": number_or_null, "count": number }]',
  lv_panels:
    '"lv_panels": [{ "tag": "string", "main_acb_rating_a": number_or_null, "main_acb_breaking_ka": number_or_null, "outgoing_mccbs": [{ "to": "string", "rating_a": number, "count": number }], "capacitor_banks": [{ "kvar": number, "isolator_rating_a": number_or_null }] }]',
  load_summary:
    '"load_summary": [{ "panel": "string", "tcl_kw": number, "standby_kw": number, "demand_factor": number, "max_demand_kw": number }]',
  smdb_inventory:
    '"smdb_inventory": [{ "id": "string", "floor": "string", "rating_a": number_or_null, "cable_size_from_mdb": "string or null", "qty": number_or_null }]',
  db_inventory:
    '"db_inventory": [{ "smdb_id": "string", "db_id": "string", "floor": "string", "rating_a": number_or_null, "cable_size": "string or null" }]',
  incoming_supply:
    '"incoming_supply": { "transformers": [{ "kva": number, "voltage_ratio": "string", "count": number }], "generator": { "kva": number, "type": "diesel" } or null, "ats": { "rating_a": number } or null }',
};
const GAP_FILL_LABELS = {
  lighting_fixtures: 'Lighting fixtures (Section 8)',
  power_outlets: 'Power outlets (Section 7)',
  containment: 'Containment — tray/trunking/conduit (Section 9)',
  earthing: 'Earthing & lightning protection (Section 10)',
  metering: 'Metering (Section 11)',
  mechanical_equipment: 'Mechanical equipment feeders (Section 6)',
  lv_panels: 'LV panels (Section 3)',
  load_summary: 'Load summary (Section 12)',
  smdb_inventory: 'SMDB inventory',
  db_inventory: 'DB inventory',
  incoming_supply: 'Incoming supply — transformers (Section 2)',
};
function gapFillableSections(sections) {
  return (sections || []).filter(s => s in GAP_FILL_SCHEMAS);
}
function buildGapFillPrompt(sections, buildingInfo, extractedText) {
  const keys = gapFillableSections(sections);
  const labelLines = keys.map(k => `  - ${GAP_FILL_LABELS[k] || k}`).join('\n');
  const schemaLines = keys.map(k => `  ${GAP_FILL_SCHEMAS[k]}`).join(',\n');
  return `You are an MEP electrical estimator re-checking a Dubai, UAE drawing set you already scanned.

Building: ${buildingInfo.floors || '?'} floors, ${buildingInfo.area_sqft || '?'} sqft, ${buildingInfo.building_type || 'unknown'} type.

Your first pass did NOT return these sections. Re-read the SAME drawings — check EVERY sheet, the legend/keys, the schedules, and the general notes — and fill ONLY these:
${labelLines}

Rules (strict):
- EXTRACT from the drawing first. Read the real values that are actually shown. Do NOT assume.
- Count per floor where the section is floor-wise (set the \`floor\` field), Basement → Roof.
- ONLY if a value genuinely is not present/legible in the drawing, you may estimate it from the building geometry (floors, dwelling/room count, riser height) as a LAST RESORT — and you MUST set \`provisional\`: true on every such row and keep counts conservative. Never mark an estimate as if it were read from the drawing.
- Do NOT touch, repeat, or change any other section.

Respond ONLY with a single JSON object containing exactly these keys (no prose, no markdown):
{
${schemaLines}
}

Text content from drawings:
${(extractedText || '').substring(0, 12000)}`;
}
function gapArr(v) {
  return Array.isArray(v) ? v : [];
}
function mergeGapFill(result, gap, sections) {
  if (!gap || typeof gap !== 'object') return result;
  const merged = { ...result };
  for (const key of gapFillableSections(sections)) {
    if (key === 'incoming_supply') {
      const current = merged.incoming_supply || null;
      const incoming = gap.incoming_supply || null;
      if (gapArr(current && current.transformers).length === 0 && gapArr(incoming && incoming.transformers).length > 0) {
        merged.incoming_supply = incoming;
      }
      continue;
    }
    if (gapArr(merged[key]).length === 0 && gapArr(gap[key]).length > 0) {
      merged[key] = gap[key];
    }
  }
  return merged;
}

// ── Per-floor completeness — JS port of src/lib/electrical/gap-fill.ts +
// scan-validation.ts (KEEP IN SYNC). canonFloorKey collapses the many ways a
// level is written so an established floor (floor_labels) can be matched against
// the `floor` field on outlet/lighting/DB/SMDB rows; the floor gap-fill re-reads
// the empty floors' sheets and appends.
const FLOOR_WISE_SECTIONS = ['power_outlets', 'lighting_fixtures'];
const FLOOR_ORDINALS = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
  eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13,
  fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18,
  nineteenth: 19, twentieth: 20,
};
function canonFloorKey(raw) {
  let t = String(raw == null ? '' : raw).toLowerCase().trim();
  if (!t) return '';
  for (const w of Object.keys(FLOOR_ORDINALS)) {
    t = t.replace(new RegExp(`\\b${w}\\b`, 'g'), String(FLOOR_ORDINALS[w]));
  }
  if (/\broof\s*top\b|\bupper\s*roof\b|\broof\b|\bterrace\b/.test(t)) return 'roof';
  if (/penthouse|\bph\b/.test(t)) return 'penthouse';
  if (/mezz/.test(t)) return 'mezzanine';
  if (/sub.?basement|basement|cellar|\bb\d\b/.test(t)) { const m = t.match(/(\d+)/); return 'basement' + (m ? m[1] : '1'); }
  if (/lower\s*ground|\blg\b/.test(t)) return 'basement1';
  if (/\bground\b|\bgf\b|\bg\.?f\b|\blobby\b/.test(t) && !/upper\s*ground/.test(t)) return 'ground';
  if (/upper\s*ground|\bug\b/.test(t)) return 'ground';
  if (/podium|car\s*park|parking/.test(t)) { const m = t.match(/(\d+)/); return 'podium' + (m ? m[1] : '1'); }
  const num = t.match(/(\d{1,2})/);
  if (
    num &&
    /\b\d{1,2}\s*(?:st|nd|rd|th)?\s*(?:f|fl|flr|floor)\b|\b(?:f|fl|flr|floor|level|lvl|l)\s*\.?\s*\d{1,2}\b|^\s*\d{1,2}\s*$/.test(t)
  ) {
    return 'f' + num[1];
  }
  return 'n:' + t.replace(/[^a-z0-9]+/g, ' ').trim();
}

// ── Deterministic ordering — JS port of src/lib/electrical/canonicalize.ts
// (KEEP IN SYNC) and of canonTag/canonDesc/floorRank in scripts/lib/ensemble-merge.mjs.
// The scan is non-deterministic run-to-run, so without a final sort the same drawing
// renders its rows in a different order every time and the BOQ "looks different".
// sortElectricalResult only reorders rows — it never rewrites, drops, or merges them.
function canonTag(s) {
  return String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]+/g, '');
}
const CANON_DESC_SYNONYMS = [
  [/(\d+)\s*a(?:mp(?:ere)?s?)?\b/g, '$1a'],
  [/socket\s*outlets?\b|sockets?\b|\bsso\b/g, 'socket'],
  [/\btwin\b|\bdouble\b|\b2\s*g(?:ang)?\b/g, 'twin'],
  [/\bsingle\b|\b1\s*g(?:ang)?\b/g, 'single'],
  [/\bweather\s*proof\b|\bwp\b/g, 'wp'],
  [/\bluminaires?\b|\bfittings?\b|lighting\s*fixtures?|light\s*fixtures?|down\s*lights?\b/g, 'light'],
  [/cable\s*trays?\b|\btrays?\b/g, 'tray'],
  [/\bnos?\b|\bqty\b|\bpcs\b|\bpieces?\b|\bunits?\b/g, ''],
];
const CANON_STOPWORDS = new Set(['the', 'for', 'of', 'with', 'type', 'a', 'an', 'and', 'to']);
function canonDesc(s) {
  let t = String(s == null ? '' : s).toLowerCase();
  for (const [re, rep] of CANON_DESC_SYNONYMS) t = t.replace(re, rep);
  t = t.replace(/[^a-z0-9]+/g, ' ').trim();
  const toks = t.split(/\s+/).filter((w) => w && !CANON_STOPWORDS.has(w));
  toks.sort();
  return toks.join(' ');
}
function floorRank(key) {
  if (key.startsWith('basement')) return -100 + (parseInt(key.slice(8), 10) || 1);
  if (key === 'ground') return 0;
  if (key === 'mezzanine') return 0.5;
  if (key.startsWith('podium')) return 1 + (parseInt(key.slice(6), 10) || 1) * 0.01;
  if (key.startsWith('f')) return parseInt(key.slice(1), 10) || 0;
  if (key === 'penthouse') return 900;
  if (key === 'roof') return 1000;
  return 800;
}
function canonStableStringify(v) {
  if (Array.isArray(v)) return `[${v.map(canonStableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonStableStringify(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v == null ? null : v);
}
function canonBy(keyFn) {
  return (a, b) => {
    const ka = keyFn(a), kb = keyFn(b);
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    const sa = canonStableStringify(a), sb = canonStableStringify(b);
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  };
}
function canonFr(f) {
  return String(Math.round(floorRank(canonFloorKey(f)) * 100 + 100000)).padStart(8, '0');
}
function sortElectricalResult(result) {
  if (!result || typeof result !== 'object') return result;
  const s = (arr, cmp) => (Array.isArray(arr) ? [...arr].sort(cmp) : arr);
  return {
    ...result,
    drawings_found: s(result.drawings_found, canonBy((r) => canonDesc(r.filename))),
    smdb_inventory: s(result.smdb_inventory, canonBy((r) => `${canonFr(r.floor)}|${canonTag(r.id)}`)),
    lv_to_smdb_cables: s(result.lv_to_smdb_cables, canonBy((r) => `${canonTag(r.from)}>${canonTag(r.to)}`)),
    db_inventory: s(result.db_inventory, canonBy((r) => `${canonFr(r.floor)}|${canonTag(r.smdb_id)}/${canonTag(r.db_id)}`)),
    db_groups: s(result.db_groups, canonBy((r) => canonDesc(r.tag_pattern))),
    smdb_to_db_cables: s(result.smdb_to_db_cables, canonBy((r) => `${canonFr(r.floor)}|${canonTag(r.from)}>${canonTag(r.to)}`)),
    cable_schedule: s(result.cable_schedule, canonBy((r) => `${canonFr(r.floor)}|${canonTag(r.from)}>${canonTag(r.to)}`)),
    bulk_cables: s(result.bulk_cables, canonBy((r) => canonDesc(r.specification))),
    lv_panels: s(result.lv_panels, canonBy((r) => canonTag(r.tag))),
    mechanical_equipment: s(result.mechanical_equipment, canonBy((r) => canonDesc(r.description))),
    power_outlets: s(result.power_outlets, canonBy((r) => `${canonFr(r.floor)}|${canonDesc(r.description)}`)),
    lighting_fixtures: s(result.lighting_fixtures, canonBy((r) => `${canonFr(r.floor)}|${r.type_ref ? canonTag(r.type_ref) : canonDesc(r.description)}`)),
    containment: s(result.containment, canonBy((r) => canonDesc(r.description))),
    earthing: s(result.earthing, canonBy((r) => canonDesc(r.description))),
    metering: s(result.metering, canonBy((r) => canonDesc(r.description))),
    load_summary: s(result.load_summary, canonBy((r) => canonDesc(r.panel))),
  };
}
function floorIsCovered(labelKey, sectionKeys) {
  if (!labelKey) return true;
  if (sectionKeys.has(labelKey)) return true;
  if (labelKey.startsWith('n:')) {
    const lt = labelKey.slice(2).split(' ').filter(Boolean);
    for (const sk of sectionKeys) {
      if (!sk.startsWith('n:')) continue;
      const st = new Set(sk.slice(2).split(' '));
      if (lt.some(x => st.has(x))) return true;
    }
  }
  return false;
}
function buildFloorGapFillPrompt(emptyFloors, buildingInfo, extractedText) {
  const floorList = emptyFloors.map(f => `  - ${f}`).join('\n');
  const schemaLines = FLOOR_WISE_SECTIONS.map(k => `  ${GAP_FILL_SCHEMAS[k]}`).join(',\n');
  return `You are an MEP electrical estimator re-checking a Dubai, UAE drawing set you already scanned.

Building: ${buildingInfo.floors || '?'} floors, ${buildingInfo.area_sqft || '?'} sqft, ${buildingInfo.building_type || 'unknown'} type.

Your first pass produced a take-off for the other floors but returned NOTHING for these floors — they are MISSING from the power-outlet and lighting take-off:
${floorList}

Open the sheet(s) for EACH of these floors and read them properly. These are real levels of this building (basement / parking, plant / roof, pool deck, amenity, podium) and they DO carry electrical scope — lighting, small power and sockets, plus pump / exhaust / equipment and feature / pool / landscape points. Enumerate per floor:
  - power_outlets — one row per (type, floor)
  - lighting_fixtures — one row per fixture type per floor

Rules (strict):
- EXTRACT from the drawing first; read what is actually drawn on that floor's own sheet. Do NOT assume.
- Set the \`floor\` field to the floor name EXACTLY as written in the list above so it merges correctly.
- If a floor genuinely has little occupiable area (open roof, plant deck, void), still return at minimum its maintenance / stair / lift-lobby / plant lighting and sockets, and set \`provisional\`: true on those rows.
- Estimation is a LAST RESORT only — set \`provisional\`: true on any estimated row. Never return an empty take-off for a listed floor.
- Do NOT touch, repeat, or change any floor that is not listed above.

Respond ONLY with a single JSON object containing exactly these keys (no prose, no markdown):
{
${schemaLines}
}

Text content from drawings:
${(extractedText || '').substring(0, 12000)}`;
}
function mergeFloorGapFill(result, gap, emptyFloors) {
  if (!gap || typeof gap !== 'object') return result;
  const targetKeys = new Set((emptyFloors || []).map(canonFloorKey).filter(Boolean));
  if (targetKeys.size === 0) return result;
  const merged = { ...result };
  for (const key of FLOOR_WISE_SECTIONS) {
    const existing = gapArr(merged[key]);
    const present = new Set(existing.map(row => canonFloorKey(row && row.floor)).filter(Boolean));
    const incoming = gapArr(gap[key]).filter(row => {
      const k = canonFloorKey(row && row.floor);
      return k !== '' && targetKeys.has(k) && !present.has(k);
    });
    if (incoming.length > 0) merged[key] = [...existing, ...incoming];
  }
  return merged;
}

// Mirrors the prompt in src/lib/ai/claude-api.ts analyzeElectricalProcedure.
// Keep these two in sync — when one changes, change the other.
function buildElectricalProcedurePrompt({ promptHints, buildingInfo, extractedText }) {
  return `You are an MEP electrical estimator following George Varkey's 14-step electrical BOQ procedure for a project in Dubai, UAE.

${promptHints || ''}

Building: ${buildingInfo.floors || '?'} floors, ${buildingInfo.area_sqft || '?'} sqft, ${buildingInfo.building_type || 'unknown'} type.

Follow these steps IN ORDER and report findings for each:

Step 1:  Open the drawing — locate all electrical drawings available
Step 2:  List available drawings — classify each as floor_plan / schematic / riser / schedule / other; note which floor each covers
Step 3:  Establish floors and floor height — count and name every level (Basement, Ground, 1F, 2F … Roof). For typical floor height, READ it from the drawing: prefer the level datums / FFL/SSL annotations on sections, elevations or the riser (height = difference between two consecutive floor levels, e.g. +3.60 − 0.00 = 3.6 m), or an explicit floor-height note in the general notes / typical section. If no level datum or height note is legible anywhere, set typical_floor_height_m to null — do NOT substitute a generic default (3.0/3.2/3.6); a guessed height corrupts the cable-length (Step 10) and containment (Section 9) estimates that depend on it.
Step 4:  Find drawing scale — read the scale annotation or scale bar (e.g. "1:100", "1:50"); note if found or not found
Step 5:  Identify LV Room / MDB — find the Main LV Panel / Main Distribution Board, most probably on the Ground Floor; note tag (e.g. LVP-01), rating in Amps, location
Step 6:  Check availability of schematic drawing — confirm if a Single-Line Diagram (SLD) or schematic exists; note the filename
Step 7:  Note SMDBs from LV panel in schematic drawing — list every SMDB fed from the MDB: tag (e.g. SMDB-1F), floor, rating (A), cable size from MDB (e.g. 4C×95mm²), connected_load_kw if shown on the SLD (e.g. 150.86 kW), qty when a row covers a stack of identical floors (e.g. SMDB-1F to SMDB-8F → qty 8)
Step 8:  Identify SMDBs in floor drawings from Basement to Roof — confirm SMDB locations on floor plans, cross-check with schematic
Step 9:  Establish probable cable route from LV panel to SMDBs — look at riser drawing or riser annotations; note route (e.g. "riser shaft B, west core")
Step 10: Estimate cable lengths and sizes for all LV panel → SMDB runs — note size (mm²), estimated length (m), confidence: high=from riser dim / medium=scaled / low=assumed. When scale is NOT detected, mark the length confidence "low" — the system then fills it deterministically from the typical floor height (4 m lead-in + floor index × typical_floor_height_m + 0.5 m), so do NOT default to 15 m+ per floor (that produces 4× over-estimates).
Step 11: Establish SMDB → DB identification and cable size — from schematic, list EVERY individual Distribution Board (DB) fed from each SMDB in db_inventory: one row per DB tag (DB-T01, DB-T02, … DB-T15 — never "DB-T01 to DB-T15"). Also populate db_groups[] alongside as a rollup summary (tag pattern, per-floor qty, total qty, TCL range) — db_groups never replaces db_inventory enumeration.
Step 12: For each SMDB, identify locations of its DBs — from floor plans, confirm DB location per floor
Step 13: Estimate cable size and length for each SMDB → DB run — length from scaled floor plan; confidence flagged. smdb_to_db_cables MUST emit one row per individual DB (DB-T01, DB-T02, …). Aggregated rows like "DB-T01 to T15 per floor" are FORBIDDEN — they break the take-off audit trail. MEASURE EACH DB'S LENGTH INDIVIDUALLY: trace the route from the SMDB to THAT board's own position on the scaled plan, so a DB at the far end of the floor gets a longer run than one beside the SMDB. Do NOT copy a single length onto every DB on a floor — identical same-floor lengths are valid ONLY when the plan genuinely shows the boards equidistant, and those rows must be flagged confidence "low".
Step 14: Prepare cable schedule — compile every cable entry with unit identification, size (mm²), and length (m). Additionally, populate bulk_cables[] with aggregated final-circuit lengths. Derive every length from THIS building's own typical-floor circuit counts read from the drawing × its number of typical floors; NEVER reuse quantities from any reference or example project. The usual final-circuit families are 4C 1.5mm² (lighting), 4C 2.5mm² (sockets), 4C 4mm² (dedicated circuits), 4C 6mm² (DB sub-mains) — but the lengths MUST come from this drawing, never from an example. Set provisional=true on every bulk_cables row. These are estimates by typical-floor count, not from→to entries.

CABLE ACCURACY RULE (read each cable exactly as annotated): (a) Record each cable's cores / insulation / type AS DRAWN. Single-core wires pulled in conduit are annotated like "4X1C 16mm² CU/PVC/WIRES" or "4×1C … CU/PVC" — these are NOT armoured cable; keep them as CU/PVC singles, do NOT relabel them XLPE/SWA/PVC. Reserve XLPE/SWA/PVC for cables actually annotated armoured, and FIRE RATED / FP / LSZH for fire-rated runs. (b) A board's incomer cable is the one feeding THAT board's OWN incomer terminal — read it off that board's incomer line; do NOT copy a downstream tie / link cable (e.g. an ESMDB-G→ESMDB-RF link) onto the board's incomer. Emergency mains are often large — a 400A emergency SMDB incomer is ~300mm² FR, not 70mm² — so cross-check every incomer cable size against the board's breaker rating (the cable must be able to carry the MCCB/ACB amps).

Drawing-level cross-reference: when KnownFacts.drawings provides a drawing_number for a sheet, propagate it onto every drawings_found[] entry, every db_inventory row (use the drawing where the DB was identified), and every cable row (lv_to_smdb_cables, smdb_to_db_cables, cable_schedule) so each line item carries its source_drawing_number. If no drawing number is known for a row, leave the field null — never invent one.

DATA SOURCE RULE (extract first; estimate is a PER-ROW last resort, NEVER a section-level shortcut): Your PRIMARY task is to READ this drawing — open every sheet, zoom into the legends, panel schedules, cable schedules, general notes and floor plans, and extract the REAL values and counts that are actually drawn, floor by floor. Estimation exists ONLY for individual rows whose value you genuinely cannot find anywhere in the drawing — it is NOT a shortcut to skip reading. Do NOT blanket-estimate a whole section: if the drawing shows the data anywhere, extract it. Set provisional=true ONLY on the specific rows you truly could not read (and lower confidence for those). A result where most rows of a section are provisional, or a cable schedule with only a handful of rows for a multi-floor building, means you did NOT actually read the drawing — go back and enumerate it properly. Never present an estimated value as if it were read, never return [] for a required section, and never replace a detailed per-floor take-off with a few round estimated numbers. BELOW-GROUND LEVELS are frequently under-counted: explicitly OPEN and READ every basement / parking and underground / pump-room sheet, and capture their boards (EV-charger SMDB, basement DB, pump-room EDB/DB), EV car chargers, exhaust fans, and fire / jockey / sump / booster / transfer pumps with their feeders — assign them to the correct below-ground floor (Basement, Underground). NEVER leave a basement or underground floor empty when the drawing has a sheet for it.

PER-FLOOR COMPLETENESS RULE (mandatory): every level you list in floor_labels (Step 3) is a real floor of this building and MUST appear in the per-floor take-off. When you finish, CROSS-CHECK floor by floor — for EACH floor_label (Basement(s), Ground, every typical floor 1F…NF, Mezzanine, Podium/Parking, Amenity/Pool Deck, Plant, Roof / Upper Roof) there must be at least one power_outlets row AND at least one lighting_fixtures row whose \`floor\` field is that floor. NEVER leave an established floor with an empty take-off: open that floor's OWN sheet and enumerate its lighting, small power and sockets. The special / named levels — swimming pool deck, health club / gym, amenity, podium, basement / parking, plant room, roof / upper roof — are the ones most often skipped, yet they always carry electrical scope (pool / feature / landscape lighting, maintenance and equipment sockets, pump / exhaust / lift-machine points, stair & lift-lobby lighting); read and count them too. Use the SAME floor name in the \`floor\` field as you wrote in floor_labels so the take-off reconciles floor-by-floor and no floor comes out blank.

Also extract the following BOQ sections from the SLD and floor plans:

INCOMING SUPPLY (Section 2): MANDATORY non-empty whenever an LV single-line diagram / LV panel is present (i.e. every DEWA-fed building). READ the SLD incomer / title block and capture EVERY item: each DEWA transformer (kVA + voltage ratio e.g. 11kV/400V — large buildings often have TWO, e.g. 1000 kVA + 1500 kVA), the standby diesel generator (kVA + type) and its ATS (rating A — note electrical+mechanical interlock / manual bypass), HV duct size and count, and mobile_generator_provision count (DEWA mobile-generator hookup sets, typically 1–2). The transformer is drawn on the incomer even when labelled "BY DEWA" — still list it (it remains a supply line in the BOQ). NEVER return empty transformers when an SLD/LV panel exists — that means you did not read the incomer; go back and read it.
LV PANELS (Section 3): MANDATORY non-empty whenever a main LV panel / MDB exists (it always does on a power SLD). For EACH LV panel (LVP-01, LVP-02 …) read the SLD: main incomer ACB rating (A) and breaking capacity (kA), panel form/type when shown (e.g. Form-4 Type-6), the list of outgoing MCCBs (destination SMDB/feeder, rating A, count), and ALL capacitor / power-factor-correction banks present (P-379-style panels carry multiple, e.g. 275 kVAR + 375 kVAR multi-step automatic) into the capacitor_banks array with each bank's isolator ACB rating (A). A result with SMDBs but an empty lv_panels array means the LV panel was not read — go back and enumerate it.
MECHANICAL EQUIPMENT (Section 6): MANDATORY non-empty for any building with mechanical services (every occupiable building). Read EVERY dedicated equipment feeder drawn on the SLD and the pump-room / roof / basement plans — fire pump, jockey pump, booster / transfer / sump / circulation pumps, FAHU / AHU, pressurization & exhaust fans (staircase, smoke, toilet, car-park), lifts, BMU / cleaning cradle, EV car chargers, swimming-pool pump, sauna, LPG vaporizer, garbage compactor — each with its kW (or A) rating and count, taken from the SLD load labels (e.g. "FAHU 174.66 kW", "FIRE PUMP 98 kW", "E-CAR CHARGER 22 kW", "LIFT 15 kW"). These feeders are explicitly tagged on the SLD; an empty array means the SLD was not read.
NO DUPLICATION (applies to all three sections above and to every section): list each physical item exactly ONCE. A transformer / LV panel / capacitor bank drawn on more than one sheet is still ONE unit — never count it twice. mechanical_equipment is the list of TERMINAL mechanical loads only: do NOT put a DB or SMDB there (those belong only in db_inventory / smdb_inventory), and do NOT re-list a feeder that is already a cable_schedule row — Section 6 is the equipment connection, the cable is counted once in the cable schedule. Likewise never emit the same SMDB, DB, outlet (type, floor) or cable run twice.
POWER OUTLETS (Section 7): read total outlet counts per type from the floor-plan symbols, floor by floor: 13A single, 13A twin, 13A WP, 20A water heater, 20A washing machine, FCU spur, gas ignition, gas detector, hand dryer, floor box, USB, industrial 16A, 20A DP switch, control panel. MANDATORY — this array MUST be non-empty for any building with occupiable area. If a floor's outlet symbols are genuinely not countable at this resolution, do NOT fabricate a quantity — inventing or multiplying a per-unit count by floors produces a DIFFERENT number on every run. Instead read the outlet TYPES from the POWER LEGEND and still emit one row per (type, floor) for that floor with estimated_qty=0 and provisional=true, so the floor/type is represented and flagged for manual take-off. Never return [] because counting is hard, and never guess a count. FLOOR-WISE: emit one row per (type, floor) and set the floor field — count each typical floor separately (1F, 2F, …) plus Basement / Ground / Roof, so the take-off reads "this floor has X, that floor has Y" and sums to the building total. Do NOT collapse the whole building into a single lump row per type.
LIGHTING FIXTURES (Section 8): populate lighting_fixtures[] — read the fixture type tags from THIS drawing's own lighting legend/schedule (e.g. B-01…B-10, ALD-2…22, D-7…D-13, FE-02, façade FAW/LW). Do NOT invent drawing-specific tags or carry over counts from another project. Count per FLOOR (one row per fixture type per floor) by reading the floor-plan symbols × the floors that repeat; set type_ref to the drawing tag and floor to the floor it is counted for. Where the drawing marks an area "indicative / final design as per ID / client" (gym, amenity, multi-hall, kids play), still list the fitting but set provisional=true. MANDATORY non-empty for any occupiable building — same rule as POWER OUTLETS: do NOT estimate fixture counts from area (a per-area guess such as "1 fixture per 8–10 m²" changes every run). Read the legend tags and count the floor-plan symbols. If a floor or area is genuinely illegible or marked "as per ID / client", still emit the row with a generic description, type_ref null, qty=0 and provisional=true (flagged for manual take-off) rather than guessing a per-area number or returning [].
CONTAINMENT (Section 9): estimate cable tray sizes (mm HDGI) and conduit sizes (mm PVC/GI) with estimated lengths (m) or quantities. MANDATORY non-empty — derive tray/trunking lengths from the riser height (floors × typical_floor_height_m) and conduit from the outlet/point count; read sizes from installation-detail notes ("25mmØ PVC conduit", "HDGI cable tray"). Mark estimated rows provisional=true.
EARTHING (Section 10): earth pits (count), earth cable size and length, surge protection devices. MANDATORY non-empty — earth-pit details, earth-rod spec ("17.2×3000mm copper") and main earth cable size ("70mm²") are almost always in the earthing-detail notes; read them and estimate counts/lengths for the building, marking estimated rows provisional=true.
METERING (Section 11): DEWA kWh meters (count), CT meters (count and ratio), IMS if mentioned. MANDATORY non-empty — at minimum one DEWA kWh meter per apartment/tenant DB (= apartment DB count) plus landlord/common CT meters; add IMS/MBUS provision when the notes mention EMPOWER/EMICOOL/ETS. Mark estimated rows provisional=true.
LOAD SUMMARY (Section 12): for each LV panel — total connected load (kW), standby load (kW), demand factor, maximum demand (kW).

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
  "bulk_cables": [{ "specification": "string (e.g. '4C 1.5mm² Cu/PVC final sub-circuits')", "application": "string (e.g. 'Apartments (lighting, sockets)')", "estimated_length_m": number, "provisional": true }],
  "incoming_supply": {
    "transformers": [{ "kva": number, "voltage_ratio": "string", "count": number }],
    "generator": { "kva": number, "type": "diesel" } or null,
    "ats": { "rating_a": number } or null,
    "hv_ducts": { "size_mm": number, "count": number } or null,
    "mobile_generator_provision": { "count": number } or null
  },
  "lv_panels": [{
    "tag": "string",
    "main_acb_rating_a": number_or_null,
    "main_acb_breaking_ka": number_or_null,
    "outgoing_mccbs": [{ "to": "string", "rating_a": number, "count": number }],
    "capacitor_bank_kvar": number_or_null,
    "capacitor_banks": [{ "kvar": number, "isolator_rating_a": number_or_null }]
  }],
  "mechanical_equipment": [{ "description": "string", "rating_kw": number_or_null, "rating_a": number_or_null, "count": number }],
  "power_outlets": [{ "description": "string", "unit": "No.", "estimated_qty": number, "floor": "string (one row per (type, floor))", "provisional": "boolean (true only if estimated, not read)" }],
  "lighting_fixtures": [{ "type_ref": "string or null (the fixture tag from THIS drawing's legend, e.g. 'B-01', 'ALD-2', 'D-7', 'FE-02')", "description": "string (fitting type read from the legend)", "floor": "string (the floor this count is for)", "qty": number, "provisional": boolean }],
  "containment": [{ "description": "string", "unit": "m or No.", "estimated_qty": number, "provisional": "boolean (true only if estimated, not read)" }],
  "earthing": [{ "description": "string", "unit": "No. or m", "qty": number, "provisional": "boolean (true only if estimated, not read)" }],
  "metering": [{ "description": "string", "qty": number, "provisional": "boolean (true only if estimated, not read)" }],
  "load_summary": [{ "panel": "string", "tcl_kw": number, "standby_kw": number, "demand_factor": number, "max_demand_kw": number }],
  "confidence": number_between_0_and_1,
  "step_log": [{ "step_num": number, "name": "string", "status": "done|not_found|skipped", "finding": "string" }]
}

Text content from drawings:
${(extractedText || '').substring(0, 12000)}`;
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[worker] drawtoboq-estimate-worker listening on :${PORT}`);
});
