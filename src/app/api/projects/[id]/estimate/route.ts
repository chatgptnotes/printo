import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { logActivity, updateProjectStatus } from '@/lib/storage/activity-logger';
import { AttachmentFile, classifyDrawingDiscipline, analyzeElectricalProcedure, gapFillElectricalSections, gapFillElectricalFloors } from '@/lib/ai/claude-api';
import type { ElectricalProcedureResult } from '@/lib/ai/claude-api';
import { loadAttachmentBuffer } from '@/lib/storage/attachment-storage';
import { requireAuth } from '@/lib/shared/api-auth';
import { extractDxfSummary, disciplineHintFromLayers } from '@/lib/drawing/dxf-text-extractor';
import { convertDwg } from '@/lib/drawing/dwg-converter';
import { withProjectContext } from '@/lib/notifications/api-alert';
import { computeCacheKey, getCachedResult, storeCachedResult, estimateCallCostUsd } from '@/lib/ai/result-cache';
import { computeFixtureKey, tryLoadFixtureResult } from '@/lib/ai/test-fixture-replay';
import { runElectricalPrePass } from '@/lib/electrical/pre-pass';
import { parseSldSpatial } from '@/lib/electrical/sld-spatial-parser';
import { diffCableSchedules } from '@/lib/electrical/cable-schedule-diff';
import { diffMechanicalEquipment, diffPowerOutlets } from '@/lib/electrical/array-diff';
import { enrichElectricalResult } from '@/lib/electrical/derive-cable-paths';
import { sortElectricalResult } from '@/lib/electrical/canonicalize';
import { validateElectricalScan, summarizeScanValidation } from '@/lib/electrical/scan-validation';
import { mergeGapFill, gapFillableSections, mergeFloorGapFill } from '@/lib/electrical/gap-fill';
import { logCorrection } from '@/lib/storage/corrections-logger';
import { dispatchEstimateToWorker, workerDispatchEnabled } from '@/lib/ai/worker-dispatch';
import { runElectricalPreflight } from '@/lib/ai/electrical-preflight';
import { getExtractionPriorHints } from '@/lib/ai/extraction-hints';

// Disciplines we explicitly REJECT — the cable-schedule procedure reading
// HVAC/plumbing/firefighting drawings produces garbage output.
const NON_ELECTRICAL_DISCIPLINES = new Set(['hvac', 'plumbing', 'fire_fighting', 'fire_alarm', 'bms', 'lpg', 'drainage']);

// Vision-readable formats — sent to Claude as `AttachmentFile` images.
function isVisionFormat(fname: string): { ok: true; mime: string } | { ok: false } {
  if (fname.endsWith('.pdf'))  return { ok: true, mime: 'application/pdf' };
  if (fname.endsWith('.png'))  return { ok: true, mime: 'image/png' };
  if (fname.endsWith('.jpg') || fname.endsWith('.jpeg')) return { ok: true, mime: 'image/jpeg' };
  return { ok: false };
}

export const dynamic = 'force-dynamic';
// Vercel hard cap: Hobby=60s, Pro=300s, Enterprise=900s. Claude Opus 4.7
// on a 9.6 MB power PDF + full 14-step prompt regularly exceeds 300s, so
// the gateway/sidecar layers go to 1200s — but this synchronous lambda
// cannot exceed the plan's hard ceiling. Bump after upgrading the plan.
export const maxDuration = 300;

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const { id } = params;

    const reqBody = await request.json().catch(() => ({}));
    // force_refresh: true bypasses the content-hash cache (re-analyses with Claude
    // even when the same PDFs were processed before). Use when the AI prompt
    // changed in a non-versioned way or a previous result was wrong.
    const forceRefresh = reqBody?.force_refresh === true;

    const projectRes = await supabaseAdmin.from('sabi_projects').select('*').eq('id', id).single();
    if (projectRes.error || !projectRes.data) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    const project = projectRes.data;

    if (project.priority === 'ignore') {
      return NextResponse.json(
        { error: 'Project classified as "Ignore". Change priority before running analysis.', code: 'IGNORE_PRIORITY' },
        { status: 400 }
      );
    }

    // Guard: skip AI call if already analyzed — re-analysis must be explicitly forced
    const forceReanalyze = reqBody?.force === true;
    if (!forceReanalyze && (project.status === 'pricing_pending' || project.status === 'boq_ready')) {
      return NextResponse.json(
        { error: 'Project already analyzed. Approve or revise the cable schedule. Pass { force: true } to re-analyze.', code: 'ALREADY_ANALYZED' },
        { status: 409 }
      );
    }

    await updateProjectStatus(id, 'estimating');

    // Collect electrical drawing attachments
    const { data: allAtts } = await supabaseAdmin
      .from('sabi_attachments')
      .select('*')
      .eq('project_id', id);

    type AttRow = NonNullable<typeof allAtts>[number];
    const electricalFiles: AttachmentFile[] = [];
    const fallbackCandidates: Array<{ att: AttRow; mime: string }> = [];
    const skippedFiles: Array<{ filename: string; reason: string }> = [];
    let electricalText = '';

    for (const att of (allAtts || [])) {
      // Accept files loadable from EITHER Gmail (attachment_id + message_id) OR
      // a direct Supabase Storage path (seeded / uploaded files have the latter).
      if (!(att.attachment_id && att.message_id) && !att.storage_path) {
        skippedFiles.push({ filename: att.filename || '(unknown)', reason: 'missing attachment_id/message_id and storage_path' });
        continue;
      }
      const fname = (att.filename || '').toLowerCase();
      const vision = isVisionFormat(fname);
      const isDxf  = fname.endsWith('.dxf');
      const isDwg  = fname.endsWith('.dwg');
      if (!vision.ok && !isDxf && !isDwg) {
        skippedFiles.push({ filename: att.filename, reason: 'not pdf/png/jpg/dxf/dwg' });
        continue;
      }

      // ── Discipline detection: 3 signals, single source of truth ─────────
      // 1. Stored tag (set during extract phase by classifyDrawingDiscipline).
      // 2. Live re-classification using filename + extracted text.
      // 3. Reject if either signal points to a known NON-electrical discipline.
      const storedDisc = (att.discipline || '').toLowerCase();
      const extractedTextSnippet = ((att.extracted_data as Record<string, unknown> | null)?.text as string | undefined) || '';
      const live = classifyDrawingDiscipline(att.filename || '', extractedTextSnippet);

      const knownNonElec =
        NON_ELECTRICAL_DISCIPLINES.has(storedDisc) ||
        (live.discipline != null && NON_ELECTRICAL_DISCIPLINES.has(live.discipline));
      let isElectrical =
        storedDisc === 'electrical' ||
        live.discipline === 'electrical';

      // ── DXF: parse server-side, extract layer names + drawing text ──────
      // Vision APIs can't render DXF, but DXF *is* text — we feed the layer
      // table + TEXT/MTEXT entities to the AI as additional context. Layer
      // names alone are usually enough to confirm "electrical" vs other.
      if (isDxf) {
        try {
          const buffer = await loadAttachmentBuffer(att);
          const summary = extractDxfSummary(att.filename, buffer);
          if (!summary.ok) {
            skippedFiles.push({ filename: att.filename, reason: `DXF parse failed: ${summary.error}` });
            continue;
          }
          const hint = disciplineHintFromLayers(summary.layers);
          if (hint.discipline === 'non_electrical' && !isElectrical) {
            skippedFiles.push({
              filename: att.filename,
              reason: `DXF layer table is non-electrical (matched layers: ${hint.matched.slice(0, 5).join(', ')})`,
            });
            continue;
          }
          if (hint.discipline === 'electrical') isElectrical = true;
          // Fold the DXF summary into the prompt context. The procedure won't
          // see the geometry, but it sees every panel label, room tag, and
          // layer name from the drawing.
          electricalText += `\n\n${summary.textBlock}\n`;
          // Mark as included even though we don't push a vision file.
          // The procedure treats `extractedText` as authoritative when present.
          continue;
        } catch (e) {
          skippedFiles.push({ filename: att.filename, reason: `DXF buffer load failed: ${(e as Error).message}` });
          continue;
        }
      }

      // ── DWG: binary AutoCAD format. Auto-convert (free WASM→DXF first, then
      // CloudConvert→PDF fallback). See lib/drawing/dwg-converter.ts. ──
      if (isDwg) {
        try {
          const buffer = await loadAttachmentBuffer(att);
          const conv = await convertDwg(att.filename, buffer);

          if (conv.method === 'wasm-dxf') {
            // Same treatment as a natively-uploaded DXF: discipline hint from
            // the layer table, then fold the text block into the prompt context.
            const hint = disciplineHintFromLayers(conv.dxfSummary.layers);
            if (hint.discipline === 'non_electrical' && !isElectrical) {
              skippedFiles.push({
                filename: att.filename,
                reason: `DWG→DXF layer table is non-electrical (matched layers: ${hint.matched.slice(0, 5).join(', ')})`,
              });
              continue;
            }
            if (hint.discipline === 'electrical') isElectrical = true;
            electricalText += `\n\n${conv.dxfSummary.textBlock}\n`;
            console.log(`[estimate] DWG ${att.filename} → WASM/DXF (${conv.dxfSummary.layers.length} layers, ${conv.dxfSummary.textEntities.length} text strings)`);
            continue;
          }

          if (conv.method === 'cloudconvert-pdf') {
            if (knownNonElec && !isElectrical) {
              skippedFiles.push({
                filename: att.filename,
                reason: `non-electrical discipline (stored="${storedDisc || '∅'}", detected="${live.discipline ?? 'unknown'}")`,
              });
              continue;
            }
            electricalFiles.push({
              filename: `${att.filename.replace(/\.dwg$/i, '')} (converted).pdf`,
              mimeType: 'application/pdf',
              buffer: conv.pdfBuffer,
            });
            if (extractedTextSnippet) electricalText += extractedTextSnippet + '\n';
            console.log(`[estimate] DWG ${att.filename} → CloudConvert/PDF (${conv.pdfBuffer.length} bytes)`);
            continue;
          }

          // Both paths exhausted — fall back to the manual-conversion guidance.
          skippedFiles.push({
            filename: att.filename,
            reason: `DWG auto-conversion failed (${conv.error}). Convert to PDF (File → Print → PDF/Plot) or DXF (File → Save As → DXF) before upload.`,
          });
          continue;
        } catch (e) {
          skippedFiles.push({ filename: att.filename, reason: `DWG conversion error: ${(e as Error).message}` });
          continue;
        }
      }

      if (knownNonElec && !isElectrical) {
        skippedFiles.push({
          filename: att.filename,
          reason: `non-electrical discipline (stored="${storedDisc || '∅'}", detected="${live.discipline ?? 'unknown'}", evidence="${live.reasoning}")`,
        });
        continue;
      }

      if (vision.ok && isElectrical) {
        try {
          const buffer = await loadAttachmentBuffer(att);
          electricalFiles.push({ filename: att.filename, mimeType: vision.mime, buffer });
          // Use the full extracted text (already capped to 50K upstream at
          // extract/route.ts:359). The previous 3000-char limit silently
          // discarded the panel schedule + cable schedule tables, which
          // typically appear past the legend/notes pages — so Claude could
          // only see the first 3 SMDBs mentioned in the legend and reported
          // "NO explicit panel schedule visible in extracted text" in its
          // step_log diagnostics. Vision still sees all pages; text fills
          // in the dense tables Claude struggles to OCR from vision alone.
          if (extractedTextSnippet) electricalText += extractedTextSnippet + '\n';
        } catch (e) {
          skippedFiles.push({ filename: att.filename, reason: `buffer load failed: ${(e as Error).message}` });
        }
        continue;
      }

      // Vision-readable but discipline unclear — keep as a fallback candidate.
      if (vision.ok) {
        fallbackCandidates.push({ att, mime: vision.mime });
      }
    }

    // Fallback: if no clearly-electrical drawings found, try the unclear ones.
    // (Better than failing on a project where the classifier missed all hits.)
    if (electricalFiles.length === 0 && fallbackCandidates.length > 0) {
      console.warn(`[estimate] No clearly-electrical files; falling back to ${fallbackCandidates.length} unclassified candidates`);
      for (const { att, mime } of fallbackCandidates) {
        try {
          const buffer = await loadAttachmentBuffer(att);
          electricalFiles.push({ filename: att.filename, mimeType: mime, buffer });
          const text = ((att.extracted_data as Record<string, unknown> | null)?.text as string | undefined) || '';
          // Match the main-path change above: pass the full upstream-capped
          // extracted text, not the first 3000 chars.
          if (text) electricalText += text + '\n';
        } catch (e) {
          skippedFiles.push({ filename: att.filename, reason: `fallback buffer load failed: ${(e as Error).message}` });
        }
      }
    }

    // Hard fail only if BOTH zero vision files AND zero extracted text.
    // DXF-only projects (no PDF/image but parsed layer + text data) are
    // allowed to proceed — the procedure will degrade gracefully with text
    // context only (less accurate for geometric measurements).
    if (electricalFiles.length === 0 && electricalText.trim().length === 0) {
      const reason = `No electrical drawings detected among ${(allAtts || []).length} attachments. Upload drawings whose name or content includes electrical terms (elec, power, mdb, smdb, cable, panel, switchgear, lighting, lv, schematic, riser, sld), or DXF files with electrical layer prefixes (E-, ELEC, POWR, LITE, MDB, SMDB).`;
      await logActivity(id, 1, 'Open the Drawing', 'failed', {
        reason,
        total_attachments: (allAtts || []).length,
        skipped: skippedFiles.slice(0, 20),
      }, 'electrical');
      await supabaseAdmin
        .from('sabi_projects')
        .update({
          status: 'extracted',
          notes: JSON.stringify({ last_error: reason, last_error_at: new Date().toISOString() }),
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      return NextResponse.json(
        { error: reason, skipped_count: skippedFiles.length, skipped_sample: skippedFiles.slice(0, 10) },
        { status: 422 }
      );
    }

    if (electricalFiles.length === 0) {
      console.warn(`[estimate] DXF-only run — no vision files; AI procedure will use text context only. Geometric measurements (cable lengths) will be less accurate.`);
    }
    console.log(`[estimate] picked ${electricalFiles.length} vision files, ${electricalText.length} chars of text context, skipped ${skippedFiles.length}`);

    // ── Electrical pre-pass: regex/lookup for Steps 2, 4, 5, 6, 7, 11 ───
    // Runs deterministic extraction on the same text we'd send to the AI.
    // Findings are injected into the prompt as known facts so Sonnet doesn't
    // waste output tokens re-deriving scale, MDB tag, schematic file, etc.
    // Zero AI cost; ~10 ms per call.
    const prePassAttachments = (allAtts || [])
      .filter(a => {
        const fn = (a.filename || '').toLowerCase();
        return fn.endsWith('.pdf') || fn.endsWith('.dxf') || fn.endsWith('.png') || fn.endsWith('.jpg') || fn.endsWith('.jpeg');
      })
      .map(a => ({
        filename: a.filename || '',
        text: ((a.extracted_data as Record<string, unknown> | null)?.text as string | undefined) || null,
      }));
    const prePass = runElectricalPrePass(prePassAttachments);
    if (prePass.scale_detected || prePass.smdb_inventory.length > 0 || prePass.mdb_info.tag) {
      console.log(
        `[estimate] pre-pass: scale=${prePass.drawing_scale ?? 'none'} schematic=${prePass.schematic_filename ?? 'none'} mdb=${prePass.mdb_info.tag ?? '?'} smdbs=${prePass.smdb_inventory.length}`,
      );
      // Prepend to electricalText so the AI sees these as known context
      electricalText = prePass.context_block + '\n\n' + electricalText;
    }

    // ── Spatial SLD parse (pdfjs-dist) — augments pre-pass when a schematic
    // PDF is identified. Uses text-with-coordinates to cluster nearby labels
    // (e.g. SMDB tag + amp rating that appear on opposite ends of the same
    // schematic block). Skipped silently when no schematic PDF is in the
    // upload set or pdfjs throws.
    if (prePass.schematic_filename) {
      const schematicFile = electricalFiles.find(
        f => f.filename === prePass.schematic_filename && f.mimeType === 'application/pdf',
      );
      if (schematicFile) {
        const spatial = await parseSldSpatial(schematicFile.buffer);
        if (spatial && (spatial.smdb_inventory.length > 0 || spatial.mdb_info.tag || spatial.drawing_scale)) {
          console.log(
            `[estimate] spatial: scale=${spatial.drawing_scale ?? 'none'} mdb=${spatial.mdb_info.tag ?? '?'} smdbs=${spatial.smdb_inventory.length} dbMaps=${spatial.smdb_to_db_map.length} pages=${spatial.pages_parsed}`,
          );
          const lines = ['## Spatial schematic findings (from coordinate clustering — high confidence)'];
          if (spatial.drawing_scale) lines.push(`Scale (spatial): ${spatial.drawing_scale}`);
          if (spatial.mdb_info.tag) lines.push(`MDB (spatial): ${spatial.mdb_info.tag} ${spatial.mdb_info.rating_a ?? '?'}A`);
          for (const s of spatial.smdb_inventory.slice(0, 30)) {
            lines.push(`  SMDB ${s.id}: ${s.rating_a ?? '?'}A, cable ${s.cable_size_from_mdb ?? '?'}, page ${s.page}`);
          }
          for (const m of spatial.smdb_to_db_map.slice(0, 30)) {
            if (m.db_ids.length > 0) lines.push(`  ${m.smdb_id} feeds: ${m.db_ids.join(', ')}`);
          }
          electricalText = lines.join('\n') + '\n\n' + electricalText;
        }
      }
    }

    // Canonical electrical sub-pipeline step names (used for both 'started' and
    // 'completed' rows so the activity log shows one named entry per step,
    // not "Step N" + "Open the Drawing" duplicates).
    const ELECTRICAL_STEP_NAMES = [
      '', // 0 unused
      'Open the Drawing',
      'List Available Drawings',
      'Establish Floors and Floor Height',
      'Find Drawing Scale',
      'Identify LV Room / MDB',
      'Check Schematic Drawing Availability',
      'Note SMDBs from LV Panel',
      'Identify SMDBs in Floor Drawings',
      'Establish Cable Route LV Panel to SMDBs',
      'Estimate Cable Lengths and Sizes LV to SMDB',
      'Establish SMDB to DB Identification',
      'Identify DB Locations per SMDB',
      'Estimate Cable Size and Length per DB',
      'Prepare Cable Schedule',
    ];

    // ── Test-fixture replay (file-bytes-only key, gated by SABI_TEST_FIXTURES) ──
    // Pre-empts the AI cache so demo re-uploads of a captured PDF short-circuit
    // to the recorded result instead of waiting for Claude. Returns null when
    // the flag is off or no fixture matches → falls through to the real path.
    const fixtureKey = computeFixtureKey(electricalFiles);
    const fixtureResult = forceRefresh ? null : await tryLoadFixtureResult(fixtureKey);

    // ── Content-hash cache lookup (skip Claude if same files seen before) ──
    const modelId = 'claude-sonnet-4-6';
    const cacheKey = computeCacheKey({
      files: electricalFiles,
      text: electricalText,
      model: modelId,
      metadata: { floors: project.floors, area_sqft: project.total_area_sqft, building_type: project.building_type },
    });
    const cachedResult = (forceRefresh || fixtureResult) ? null : await getCachedResult<ElectricalProcedureResult>(cacheKey);

    let result: ElectricalProcedureResult;
    const cacheSavings = estimateCallCostUsd(modelId, electricalFiles.length);
    if (fixtureResult) {
      console.log(`[estimate] FIXTURE HIT key=${fixtureKey.slice(0, 12)}… — replaying captured result, skipping ${modelId}`);
      result = fixtureResult;
      await logActivity(id, 0, 'Test Fixture Replay', 'completed', {
        fixture_key: fixtureKey.slice(0, 16),
        model: modelId,
        file_count: electricalFiles.length,
        message: `Demo replay from tests/fixtures — zero ${modelId} tokens spent.`,
      }, 'electrical');
    } else if (cachedResult) {
      console.log(`[estimate] CACHE HIT key=${cacheKey.slice(0, 12)}… — skipping ${modelId} call, saved ~$${cacheSavings.toFixed(2)}`);
      result = cachedResult;
      // One audit row marking the cache hit — no "started" rows because the
      // steps were never actually executed in this run. The step_log replay
      // below will write 13 'completed' rows with the cached findings.
      await logActivity(id, 0, 'Drawing Cache Hit', 'completed', {
        cache_key: cacheKey.slice(0, 16),
        model: modelId,
        file_count: electricalFiles.length,
        est_savings_usd: Number(cacheSavings.toFixed(4)),
        message: `Reused prior analysis — zero ${modelId} tokens spent.`,
      }, 'electrical');
    } else {
    // Cache miss — emit one 'started' row per electrical sub-step using the
    // proper step name (not "Step N") and tag with sub_pipeline='electrical'
    // so MAIN steps 1–8 in the same project don't visually collide with
    // electrical sub-steps 1–13.
    for (let s = 1; s <= 13; s++) {
      await logActivity(id, s, ELECTRICAL_STEP_NAMES[s], 'started', { files_found: electricalFiles.length }, 'electrical');
    }

    // VPS worker dispatch path — hand off the long Claude call to the worker
    // so this lambda doesn't hit the Vercel Pro 300s function cap. Worker
    // writes status, sabi_drawing_analysis_cache, and sabi_services back via
    // the service-role key — frontend's pollUntilStatus picks up the flip.
    if (workerDispatchEnabled()) {
      console.log(`[estimate] CACHE MISS key=${cacheKey.slice(0, 12)}… — dispatching to worker (files=${electricalFiles.length})`);

      // Ground Claude's 14-step enumeration with library-extracted facts. The
      // worker runs the same prompt analyzeElectricalProcedure runs inline,
      // but its `prompt_hints` form field was unpopulated — Claude saw the
      // 14 steps with no <known_facts> anchor and under-counted SMDB rows
      // (fac0c6fe: 3 vs de850d91: 27 from the same task). Computing the
      // hints here mirrors what analyzeElectricalProcedure does internally
      // before its Claude call. Empty string is fine; preflight gates on
      // ELECTRICAL_PREFLIGHT env var.
      const preflight = await runElectricalPreflight(electricalFiles);
      const correctionHints = await getExtractionPriorHints();
      const dispatchPromptHints = [preflight.promptHints, correctionHints]
        .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        .join('\n\n');

      try {
        await dispatchEstimateToWorker({
          projectId: id,
          cacheKey,
          buildingInfo: { floors: project.floors, area_sqft: project.total_area_sqft, building_type: project.building_type },
          inputSummary: {
            file_count: electricalFiles.length,
            total_bytes: electricalFiles.reduce((sum, f) => sum + f.buffer.length, 0),
            text_chars: electricalText.length,
            building_type: project.building_type,
            floors: project.floors,
            area_sqft: project.total_area_sqft,
          },
          promptHints: dispatchPromptHints,
          extractedText: electricalText,
          estimatedCostUsd: estimateCallCostUsd(modelId, electricalFiles.length),
          files: electricalFiles,
          correlationId: cacheKey.slice(0, 12),
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[estimate] worker dispatch failed: ${msg}`);
        await logActivity(id, 1, 'Open the Drawing', 'failed', { error: `worker dispatch: ${msg}` }, 'electrical');
        await supabaseAdmin
          .from('sabi_projects')
          .update({
            status: 'extracted',
            notes: JSON.stringify({ last_error: `worker dispatch: ${msg}`, last_error_at: new Date().toISOString() }),
            updated_at: new Date().toISOString(),
          })
          .eq('id', id);
        return NextResponse.json({ error: 'Worker dispatch failed', details: msg }, { status: 502 });
      }
      // Worker has the job. Project status is already 'estimating' (set
      // above). Frontend will see the flip when the worker writes
      // 'pricing_pending' (success) or 'extracted' (rollback) to Supabase.
      return NextResponse.json({
        async: true,
        cache_key: cacheKey.slice(0, 16),
        message: 'Estimation handed off to VPS worker. Poll project status for completion.',
      }, { status: 202 });
    }

    try {
      console.log(`[estimate] CACHE MISS key=${cacheKey.slice(0, 12)}… — calling ${modelId} (files=${electricalFiles.length})`);
      result = await withProjectContext(id, () => analyzeElectricalProcedure(
        electricalFiles, electricalText,
        { floors: project.floors, area_sqft: project.total_area_sqft, building_type: project.building_type }
      ));
    } catch (err: any) {
      const msg = err.message || '';
      const friendlyMsg = /401|invalid.*api.*key|authentication/i.test(msg)
        ? 'Anthropic API key is invalid or account has no credits. Top up at console.anthropic.com/billing, then retry.'
        : msg;
      console.error('Electrical procedure failed:', msg);
      await logActivity(id, 1, 'Open the Drawing', 'failed', { error: friendlyMsg }, 'electrical');
      throw new Error(friendlyMsg);
    }

    // Cache write deferred until AFTER enrichment + non-empty validation
    // (see ~50 lines below). Caching the raw analyzer result here would
    // poison every future retry when Claude returns an empty cable_schedule.
    } // end cache-miss branch
    const cacheMiss = !fixtureResult && !cachedResult;

    // Replay the analyzer's step_log (electrical sub-pipeline) using the
    // canonical names, tagged 'electrical' so they don't collide with MAIN
    // steps 1–13. Skipped on cache hit too — the cached step_log has the
    // findings the prior run produced.
    for (const entry of result.step_log) {
      if (entry.step_num >= 1 && entry.step_num <= 13) {
        await logActivity(
          id,
          entry.step_num,
          ELECTRICAL_STEP_NAMES[entry.step_num] || entry.name,
          entry.status === 'done' ? 'completed' : entry.status === 'skipped' ? 'skipped' : 'failed',
          { finding: entry.finding },
          'electrical',
        );
      }
    }

    // Fill lv_to_smdb_cables / smdb_to_db_cables from cable_schedule when the
    // analyzer (or fixture) left them empty, and itemize aggregated DB rows
    // ("DB-T01 to T15"). Keeps Steps 9-10/11-12/13 in sync with Step 14.
    result = enrichElectricalResult(result);

    // Refuse to open Gate 14 with no cables. The intentional dev stub
    // (no API key) is excluded — it ships with sample cables for UI testing.
    if (result.cable_schedule.length === 0 && !result.stub) {
      const reason = 'Electrical analysis returned 0 cables — no electrical drawings detected or AI extraction was incomplete.';
      await logActivity(id, 14, 'Prepare Cable Schedule', 'failed', { reason, confidence: result.confidence }, 'electrical');
      await supabaseAdmin
        .from('sabi_projects')
        .update({
          status: 'extracted',
          notes: JSON.stringify({ last_error: reason, last_error_at: new Date().toISOString() }),
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      return NextResponse.json({ error: reason, cable_schedule_count: 0 }, { status: 422 });
    }

    // Cache the validated, non-empty result so future runs with identical
    // files skip the AI call. Only on cache-miss; cache hits and fixture
    // replays already came from a stored result.
    if (cacheMiss) {
      void storeCachedResult(
        cacheKey,
        modelId,
        {
          file_count: electricalFiles.length,
          total_bytes: electricalFiles.reduce((sum, f) => sum + f.buffer.length, 0),
          text_chars: electricalText.length,
          building_type: project.building_type,
          floors: project.floors,
          area_sqft: project.total_area_sqft,
        },
        result,
        estimateCallCostUsd(modelId, electricalFiles.length),
      );
    }

    // Step 14: cable schedule ready — log and set gate
    await logActivity(id, 14, 'Prepare Cable Schedule', 'started', {
      cable_schedule_count: result.cable_schedule.length,
      smdb_count: result.smdb_inventory.length,
      db_count: result.db_inventory.length,
      mdb_tag: result.mdb_info.tag,
      schematic_available: result.schematic_available,
      confidence: result.confidence,
    }, 'electrical');

    // ── Post-scan validation gate + ONE targeted gap-fill retry ─────────
    // Verify the result followed the 14-step procedure + completeness logic
    // (steps ran, mandatory sections present, per-floor, no aggregation). If a
    // required section came back MISSING, re-read the drawing once for just
    // those sections (extract-from-file first, estimate-labelled as last
    // resort), merge, and re-validate. Flag, never block — the only hard block
    // stays the 0-cable gate above. The re-read fires on ANY missing fillable
    // section, not only error-severity ones: incoming_supply / lv_panels /
    // mechanical_equipment are warning-severity (so `passed` stays true) yet are
    // routinely dropped under output pressure — they still earn the one re-read.
    let scanValidation = validateElectricalScan(result);
    const missingFillable = gapFillableSections(scanValidation.stats.sectionsMissing);
    if (missingFillable.length > 0) {
      await logActivity(id, 14, 'Scan Validation', 'started', {
        message: `Re-reading drawing for missing sections: ${missingFillable.join(', ')}`,
        missing: missingFillable,
      }, 'electrical');
      const gap = await gapFillElectricalSections(
        electricalFiles,
        electricalText,
        { floors: project.floors, area_sqft: project.total_area_sqft, building_type: project.building_type },
        missingFillable,
      );
      result = mergeGapFill(result, gap, missingFillable);
      scanValidation = validateElectricalScan(result);
      scanValidation.retried = true;
    }

    // Per-floor gap-fill — floors established in Step 3 but with no per-floor
    // take-off get ONE focused re-read of just those floors' sheets (outlets +
    // lighting), then merge by appending the missing floors. Independent of the
    // section retry above (empty floors are a warning, not a section-missing).
    if (scanValidation.stats.floorsEmpty.length > 0) {
      const emptyFloors = scanValidation.stats.floorsEmpty;
      await logActivity(id, 14, 'Scan Validation', 'started', {
        message: `Re-reading floors with no take-off: ${emptyFloors.join(', ')}`,
        floors: emptyFloors,
      }, 'electrical');
      const floorGap = await gapFillElectricalFloors(
        electricalFiles,
        electricalText,
        { floors: project.floors, area_sqft: project.total_area_sqft, building_type: project.building_type },
        emptyFloors,
      );
      result = mergeFloorGapFill(result, floorGap, emptyFloors);
      scanValidation = validateElectricalScan(result);
      scanValidation.retried = true;
    }
    // Gap-fill (above) appends rows AFTER the sort inside enrichElectricalResult,
    // so re-order once more here to keep the persisted result canonical regardless
    // of whether a re-read fired. Idempotent when no gap-fill ran. KEEP IN SYNC
    // with the worker (worker/server.js).
    result = sortElectricalResult(result);
    await logActivity(
      id,
      14,
      'Scan Validation',
      scanValidation.passed ? 'completed' : 'failed',
      { summary: summarizeScanValidation(scanValidation), violations: scanValidation.violations, stats: scanValidation.stats },
      'electrical',
    );
    if (!scanValidation.passed) {
      console.warn(`[estimate] ${summarizeScanValidation(scanValidation)}`);
    }

    // Ensure electrical service record exists and store the procedure result.
    // Pull ai_extraction too so we can diff the prior cable_schedule against
    // the new one — those diffs are the most-valuable corrections data the
    // pipeline produces and they were going un-captured before.
    const { data: existingSvc } = await supabaseAdmin
      .from('sabi_services')
      .select('id, ai_extraction')
      .eq('project_id', id)
      .eq('service_type', 'electrical')
      .maybeSingle();
    const priorExtraction = existingSvc?.ai_extraction as Record<string, unknown> | null;
    const priorCableSchedule = priorExtraction?.cable_schedule as Array<{ from?: string; to?: string; size_mm2?: number | null; length_m?: number | null }> | undefined;
    const priorMechanical = priorExtraction?.mechanical_equipment as Array<{ description?: string; count?: number | null; rating_kw?: number | null; rating_a?: number | null }> | undefined;
    const priorOutlets = priorExtraction?.power_outlets as Array<{ description?: string; estimated_qty?: number | null }> | undefined;

    const aiExtraction = {
      raw_electrical_procedure: result,
      cable_schedule: result.cable_schedule,
      smdb_inventory: result.smdb_inventory,
      db_inventory: result.db_inventory,
      mdb_info: result.mdb_info,
      incoming_supply: result.incoming_supply,
      lv_panels: result.lv_panels,
      mechanical_equipment: result.mechanical_equipment,
      power_outlets: result.power_outlets,
      lighting_fixtures: result.lighting_fixtures || [],
      containment: result.containment,
      earthing: result.earthing,
      metering: result.metering,
      load_summary: result.load_summary,
      scan_validation: scanValidation,
    };

    if (existingSvc) {
      await supabaseAdmin
        .from('sabi_services')
        .update({ is_required: true, ai_extraction: aiExtraction, confidence: result.confidence >= 0.7 ? 'high' : result.confidence >= 0.4 ? 'medium' : 'low', updated_at: new Date().toISOString() })
        .eq('id', existingSvc.id);
    } else {
      await supabaseAdmin.from('sabi_services').insert({
        project_id: id,
        service_type: 'electrical',
        is_required: true,
        ai_extraction: aiExtraction,
        confidence: result.confidence >= 0.7 ? 'high' : result.confidence >= 0.4 ? 'medium' : 'low',
      });
    }

    // Capture cable-schedule corrections — significant per-line diffs between
    // the prior run (which a human implicitly rejected by triggering a
    // re-run) and the current one. Each diff becomes one sabi_corrections
    // row. Future cable-length adjuster mines these to learn under/over-
    // estimation patterns per cohort.
    const aiProviderTag = 'claude-sonnet-4-6';
    const baseMetadata = {
      building_type: project.building_type,
      floors: project.floors,
      service_type: 'electrical',
    };

    type AnyDiff = { fieldPath: string; aiValue: number; humanValue: number; cableKey: string; attribute: string };
    const allDiffs: AnyDiff[] = [
      ...diffCableSchedules(priorCableSchedule, result.cable_schedule),
      ...diffMechanicalEquipment(priorMechanical, result.mechanical_equipment),
      ...diffPowerOutlets(priorOutlets, result.power_outlets),
    ];
    if (allDiffs.length > 0) {
      console.log(`[estimate] captured ${allDiffs.length} array-diff(s) as sabi_corrections`);
      for (const d of allDiffs) {
        await logCorrection({
          projectId: id,
          fieldPath: d.fieldPath,
          aiValue: d.aiValue,
          humanValue: d.humanValue,
          aiProvider: aiProviderTag,
          metadata: { ...baseMetadata, line_key: d.cableKey, attribute: d.attribute },
          createdBy: 'rerun-diff',
        });
      }
    }

    // Set Gate 12 — cable schedule review (MAIN Gate 3, step 12 per v6.0 PDF)
    const gateNotes: Record<string, unknown> = { approval_gate: 12 };
    if (fixtureResult) gateNotes.fixture_key = fixtureKey;
    await supabaseAdmin
      .from('sabi_projects')
      .update({
        status: 'pricing_pending',
        notes: JSON.stringify(gateNotes),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    return NextResponse.json({ result, cable_schedule_count: result.cable_schedule.length });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    await supabaseAdmin
      .from('sabi_projects')
      .update({
        status: 'extracted',
        notes: JSON.stringify({ last_error: message, last_error_at: new Date().toISOString() }),
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.id);
    return NextResponse.json({ error: 'Electrical analysis failed', details: message }, { status: 500 });
  }
}
