/**
 * Claude AI integration.
 *
 * Uses @anthropic-ai/sdk with:
 *   - claude-sonnet-4-6 → vision + extraction (electrical procedure, project info, specs)
 * `classifyEmail` is rules-only (no AI) — the estimation inbox is curated.
 */

import Anthropic from '@anthropic-ai/sdk';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { classifyAndAlertClaudeError, logTokenUsage, logHeuristicSaving } from '@/lib/notifications/api-alert';
import { assertAiBudget } from '@/lib/ai/budget-guard';
import { invokeText, invokeVision, gatewayEnabled, type VisionFile } from '@/lib/ai/nexaproc-client';
import { analyzeSpecsHeuristicAsync, MIN_CONFIDENCE as SPEC_MIN_CONFIDENCE } from '@/lib/ai/spec-analyzer';
import { runElectricalPreflight } from '@/lib/ai/electrical-preflight';
import { getExtractionPriorHints } from '@/lib/ai/extraction-hints';
import { computeTextKey, getCached, storeCached } from '@/lib/ai/result-cache';
import { buildGapFillPrompt, gapFillableSections, buildFloorGapFillPrompt } from '@/lib/electrical/gap-fill';
import { ProjectPriority, ServiceType, Discipline, ReputationClass } from '@/lib/shared/types';
import { loadKeywordsFromDB } from '@/lib/pipeline/keywords';
import {
  stripQuotedReplies,
  extractHvacTonnage,
  extractHvacSystem,
  extractBuildingType,
  extractDeadline,
  extractConsultant,
} from '@/lib/email/email-utils';
// Re-export all types so consumers can import from this file
export type {
  ClassificationResult,
  ExtractionResult,
  AttachmentFile,
  DisciplineResult,
  ReputationResult,
  SpecRequirement,
  SpecAnalysisResult,
  WaterSupplyComponents,
  DuctRouteComponents,
  MEPComponentResult,
  HVACProcedureResult,
  ElectricalOutletCounts,
  ElectricalDistributionBoard,
  ElectricalCable,
  ElectricalComponents,
  ElectricalProcedureResult,
};

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });

const MODEL_VISION = 'claude-sonnet-4-6';

const MAX_INLINE_SIZE = 20 * 1024 * 1024; // 20MB — Claude PDF/image inline limit
const SUPPORTED_VISION_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];

// ---------------------------------------------------------------------------
// JSON extraction utility — Claude doesn't have responseMimeType
// ---------------------------------------------------------------------------

function extractJSON(text: string): any {
  // Direct parse
  try { return JSON.parse(text); } catch { /* continue */ }
  // Code-fenced JSON
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1].trim()); } catch { /* continue */ } }
  // Extract between first { and last }
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s >= 0 && e > s) { try { return JSON.parse(text.substring(s, e + 1)); } catch { /* continue */ } }
  throw new Error('Failed to extract JSON from Claude response');
}

// ---------------------------------------------------------------------------
// File conversion — buffers to Claude content blocks
// ---------------------------------------------------------------------------

interface AttachmentFile {
  filename: string;
  mimeType: string;
  buffer: Buffer;
}

type ClaudeContentBlock =
  | { type: 'document'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'text'; text: string };

function filesToClaudeParts(files: AttachmentFile[]): ClaudeContentBlock[] {
  const parts: ClaudeContentBlock[] = [];
  for (const file of files) {
    if (!SUPPORTED_VISION_TYPES.includes(file.mimeType)) continue;

    if (file.buffer.length > MAX_INLINE_SIZE) {
      // Too large — skip with a text note. Caller should have used pdf-parse text.
      parts.push({ type: 'text', text: `[Skipped ${file.filename} — ${(file.buffer.length / 1024 / 1024).toFixed(1)}MB exceeds inline limit]` });
      continue;
    }

    const b64 = file.buffer.toString('base64');
    if (file.mimeType === 'application/pdf') {
      parts.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } } as any);
    } else {
      parts.push({ type: 'image', source: { type: 'base64', media_type: file.mimeType, data: b64 } } as any);
    }
  }
  return parts;
}

// ---------------------------------------------------------------------------
// Helper — call Claude with retry on JSON parse failure
// ---------------------------------------------------------------------------

// subStep → gateway taskID. The 13 callers across this file pass a stable
// subStep label; we map each to a registered DRAWTOBOQ_* taskID on the
// Nexaproc gateway side. Anything not in the map is rejected — prompts must
// be registered gateway-side, never inlined ad-hoc at a call site.
const TASK_ID_BY_SUBSTEP: Record<string, string> = {
  extractProjectInfo:         'DRAWTOBOQ_EXTRACT_PROJECT',
  analyzeSpecifications:      'DRAWTOBOQ_SPEC_ANALYZE',
  analyzeWaterSupplyDrawing:  'DRAWTOBOQ_WATER_SUPPLY',
  analyzeDuctRouteDrawing:    'DRAWTOBOQ_DUCT_ROUTE',
  analyzeHVACProcedure:       'DRAWTOBOQ_HVAC_PROCEDURE',
  analyzeMEPDrawing:          'DRAWTOBOQ_MEP_DRAWING',
  analyzeElectricalDrawing:   'DRAWTOBOQ_ELECTRICAL_DRAWING',
  analyzeElectricalProcedure: 'DRAWTOBOQ_ELECTRICAL_EXTRACT',
  refreshDubaiPrices:         'DRAWTOBOQ_PRICE_REFRESH',
};

const FIX_JSON_TASK_ID = 'DRAWTOBOQ_FIX_JSON';

// Walks the Anthropic-shaped userContent array used by the SDK path and
// re-extracts (a) concatenated text and (b) the original file bytes from
// the base64 blocks `filesToClaudeParts` produced. Lets the gateway path
// reuse the wrapper functions' existing content construction without
// requiring each caller to thread `attachmentFiles` separately.
function unpackUserContent(userContent: any[]): { userText: string; files: VisionFile[] } {
  const textParts: string[] = [];
  const files: VisionFile[] = [];
  let idx = 0;
  for (const block of userContent) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text' && typeof block.text === 'string') {
      textParts.push(block.text);
    } else if ((block.type === 'document' || block.type === 'image') && block.source?.type === 'base64') {
      const mime = block.source.media_type || 'application/octet-stream';
      const bytes = Buffer.from(block.source.data || '', 'base64');
      const ext = mime === 'application/pdf' ? 'pdf'
        : mime === 'image/png'  ? 'png'
        : mime === 'image/jpeg' ? 'jpg'
        : mime === 'image/webp' ? 'webp'
        : 'bin';
      files.push({ name: `file-${idx++}.${ext}`, mime, bytes });
    }
  }
  return { userText: textParts.join('\n\n'), files };
}

async function callClaude(
  model: string,
  systemPrompt: string,
  userContent: any[],
  maxTokens = 8192,
  subStep?: string,
): Promise<any> {
  // Hard budget gate: throws AiBudgetExceededError if AI_DISABLED is set or
  // today's spend exceeds MAX_DAILY_AI_USD / MAX_PROJECT_AI_USD. Callers may
  // catch and fall back to a library path; otherwise the error surfaces.
  await assertAiBudget();

  // Phase 12: prompt-version SHA so a future A/B test can correlate token
  // usage / accuracy with prompt-string changes. Hash the system prompt + the
  // first text block from user content (the bulky PDF/image bytes are skipped
  // — same prompt against different attachments is the same "prompt version").
  const firstTextBlock = userContent.find(b => b?.type === 'text')?.text ?? '';
  const promptVersion = sha256First16(systemPrompt + '\n' + firstTextBlock);

  if (gatewayEnabled()) {
    return callViaGateway({ systemPrompt, userContent, maxTokens, subStep, promptVersion, model });
  }

  let response;
  try {
    response = await anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      temperature: 0,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    });
  } catch (err) {
    classifyAndAlertClaudeError(err);
    throw err;
  }
  if (response.usage) {
    void logTokenUsage(model, response.usage.input_tokens, response.usage.output_tokens, {
      prompt_version: promptVersion,
      token_source: 'sdk',
      ...(subStep ? { sub_step: subStep } : {}),
    });
  }
  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  // When Claude is cut off by the output cap, the JSON is mid-structure: the
  // retry below salvages a syntactically-valid object, but trailing arrays
  // (cable_schedule, load_summary…) come back empty. That used to surface as
  // a silent "0 cables" downstream — now we throw a typed error so the caller
  // can act (raise max_tokens, split the prompt, etc.) instead of guessing.
  if (response.stop_reason === 'max_tokens') {
    throw new Error(
      `Claude output truncated at max_tokens=${maxTokens} for ${subStep || 'callClaude'} — schema is too large for the cap. Increase max_tokens or split the prompt.`,
    );
  }
  try {
    return extractJSON(text);
  } catch {
    // Retry with text only — do NOT resend PDFs/images (avoids doubling cost)
    let retry;
    try {
      retry = await anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        temperature: 0,
        system: 'Your previous response was not valid JSON. Respond ONLY with a JSON object. No markdown, no explanation. Start with { and end with }.',
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'Extract the JSON from your previous response.' }] },
          { role: 'assistant', content: text },
          { role: 'user', content: [{ type: 'text', text: 'Respond with ONLY the JSON object.' }] },
        ],
      });
    } catch (err) {
      classifyAndAlertClaudeError(err);
      throw err;
    }
    if (retry.usage) {
      void logTokenUsage(model, retry.usage.input_tokens, retry.usage.output_tokens, { token_source: 'sdk' });
    }
    const retryText = retry.content[0].type === 'text' ? retry.content[0].text : '';
    return extractJSON(retryText);
  }
}

// Gateway path. Same contract as the SDK branch above: returns a parsed JSON
// object. The wrapper functions don't know whether the SDK or the gateway
// served the request — that's the point of the USE_AI_GATEWAY flag.
async function callViaGateway(args: {
  systemPrompt: string;
  userContent: any[];
  maxTokens: number;
  subStep?: string;
  promptVersion: string;
  model: string;
}): Promise<any> {
  const { systemPrompt, userContent, maxTokens, subStep, promptVersion, model } = args;
  if (!subStep || !TASK_ID_BY_SUBSTEP[subStep]) {
    throw new Error(
      `callClaude invoked under USE_AI_GATEWAY without a registered subStep — got ${JSON.stringify(subStep)}. Register a DRAWTOBOQ_* taskID on the gateway and add it to TASK_ID_BY_SUBSTEP.`,
    );
  }
  const taskID = TASK_ID_BY_SUBSTEP[subStep];
  const { userText, files } = unpackUserContent(userContent);
  // Passthrough payload: gateway templates may consume systemPrompt/userText
  // directly, or treat them as fallback while a structured payload schema is
  // hardened in chatgptnotes/AI-aas. maxTokens is forwarded so the template
  // can size the call (mirrors the SDK path).
  const payload = { systemPrompt, userText, maxTokens };

  let res;
  try {
    res = files.length > 0
      ? await invokeVision(taskID, payload, files, { useJson: true })
      : await invokeText(taskID, payload, { useJson: true });
  } catch (err) {
    classifyAndAlertClaudeError(err);
    throw err;
  }
  void logTokenUsage(model, res.tokensIn || 0, res.tokensOut || 0, {
    prompt_version: promptVersion,
    token_source: 'gateway',
    task_id: taskID,
    ...(subStep ? { sub_step: subStep } : {}),
  });
  if (res.timedOut) {
    throw new Error(
      `Gateway hit its CLI timeout for ${subStep} (taskID=${taskID}). Retry, or split the prompt — wallclock exceeded the 120s cap.`,
    );
  }
  if (res.parsed !== undefined) {
    return res.parsed;
  }
  // Gateway returned text but couldn't parse it as JSON (or useJson:false).
  try {
    return extractJSON(res.stdout || '');
  } catch {
    return callViaGatewayFixJson(res.stdout || '', model, subStep);
  }
}

async function callViaGatewayFixJson(
  malformedText: string,
  model: string,
  subStep?: string,
): Promise<any> {
  let res;
  try {
    res = await invokeText(FIX_JSON_TASK_ID, { malformedText }, { useJson: true });
  } catch (err) {
    classifyAndAlertClaudeError(err);
    throw err;
  }
  void logTokenUsage(model, res.tokensIn || 0, res.tokensOut || 0, {
    token_source: 'gateway',
    task_id: FIX_JSON_TASK_ID,
    ...(subStep ? { sub_step: `${subStep}:fix-json` } : {}),
  });
  if (res.parsed !== undefined) return res.parsed;
  return extractJSON(res.stdout || '');
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ClassificationResult {
  isRfq: boolean;
  confidence: number;
  priority: ProjectPriority;
  reasoning: string;
  keywordsFound: string[];
}

interface ExtractionResult {
  client_name: string | null;
  project_name: string | null;
  location: string | null;
  floors: number | null;
  parking_floors: number | null;
  typical_floors: number | null;
  area_per_floor_sqft: number | null;
  total_area_sqft: number | null;
  typical_height_m: number | null;
  building_type: string | null;
  deadline: string | null;
  services_mentioned: ServiceType[];
  hvac_tonnage: number | null;
  hvac_system: string | null;
  consultant: string | null;
  plot_no?: string | null;
  architect?: string | null;
  structural_engineer?: string | null;
  drawing_set?: string | null;
  job_no?: string | null;
}

interface DisciplineResult {
  discipline: Discipline | null;
  confidence: number;
  reasoning: string;
}

interface ReputationResult {
  reputation_class: ReputationClass;
  reasoning: string;
}

interface SpecRequirement {
  service: string;
  category: string;
  item: string;
  specified_brand: string | null;
  specified_model: string | null;
  standard: string | null;
  remarks: string | null;
}

interface SpecAnalysisResult {
  requirements: SpecRequirement[];
  approved_makes: string[];
  standards_referenced: string[];
  confidence: number;
  reasoning: string;
}

interface WaterSupplyComponents {
  underground_tank: { exists: boolean; capacity_liters: number | null; material: string | null } | null;
  transfer_pump: { exists: boolean; kw: number | null; count: number } | null;
  roof_tank: { exists: boolean; capacity_liters: number | null; material: string | null } | null;
  booster_pump: { exists: boolean; kw: number | null; count: number } | null;
  water_meters: { count: number; size_mm: number | null } | null;
  hot_water_heater: { exists: boolean; type: string | null; capacity_liters: number | null; count: number } | null;
  apartments_units: number | null;
  fixtures: {
    wc: number | null; wash_basin: number | null; kitchen_sink: number | null;
    shower: number | null; bathtub: number | null; washing_machine: number | null;
  };
  pipes: Array<{ size_mm: number; material: string | null; length_meters: number | null; purpose: string }>;
  confidence: number;
  reasoning: string;
}

interface DuctRouteComponents {
  floors: Array<{
    floor_label: string; floor_code: string;
    supply_ducts: Array<{ size_mm: number; length_m: number; material: 'GI' | 'pre_insulated' | 'flexible' | string; shape: 'rectangular' | 'round' | 'oval' | string }>;
    return_ducts: Array<{ size_mm: number; length_m: number; material: 'GI' | 'pre_insulated' | 'flexible' | string }>;
    exhaust_ducts: Array<{ size_mm: number; length_m: number; material: 'GI' | 'pre_insulated' | string }>;
    fresh_air_ducts: Array<{ size_mm: number; length_m: number; material: 'GI' | 'pre_insulated' | string }>;
    fittings: { bends_90: number; bends_45: number; tees: number; reducers: number };
    terminals: { supply_diffusers: number; linear_diffusers: number; return_grilles: number; exhaust_grilles: number };
    accessories: { volume_dampers: number; fire_dampers: number; sound_attenuators: number; flexible_connections: number };
  }>;
  risers: Array<{ type: 'supply' | 'return' | 'exhaust' | 'fresh_air'; size_mm: number; floors_served: number; height_per_floor_m: number; material: string }>;
  confidence: number;
  reasoning: string;
}

interface MEPComponentResult {
  discipline: string;
  components: Array<{
    category: string; item: string; quantity: number; unit: string;
    specification: string | null; floor?: string; source?: string;
  }>;
  floor_summary?: Array<{ floor: string; items_found: number; key_equipment: string }>;
  confidence: number;
  reasoning: string;
}

interface HVACProcedureResult {
  hvac_folder_found: boolean; ventilation_folder_found: boolean; ac_folder_found: boolean;
  drawings_list: Array<{ folder: string; filename: string; type: string }>;
  thermal_load_summary_found: boolean; thermal_load_summary_file: string | null;
  equipment_schedule_found: boolean; equipment_schedule_file: string | null;
  ac_equipment_schedule_found: boolean; ac_equipment_schedule_file: string | null;
  thermal_load_confirmed: boolean; equipment_schedule_confirmed: boolean;
  thermal_load_table: Array<{ area_or_zone: string; indoor_unit_type: string; capacity_kw: number; system_ref: string | null }>;
  decorative_count: number; ducted_count: number; predominantly: 'decorative' | 'ducted' | 'mixed';
  non_indoor_items: Array<{ item: string; type: string; quantity: number; capacity_kw: number | null; flow_cfm: number | null }>;
  system_type: 'vrf' | 'dx_split' | 'chiller' | 'district_cooling' | 'unknown';
  system_detection_reasoning: string; total_indoor_kw: number; total_outdoor_kw: number; has_heat_exchanger: boolean;
  calculated_ac_load_kw: number; fahu_exists: boolean; fahu_flow_cfm: number | null; fahu_count: number;
  confidence: number;
  step_log: Array<{ step: number; description: string; result: string; status: 'done' | 'not_found' | 'skipped' }>;
}

interface ElectricalOutletCounts {
  single_13a: number;
  single_13a_wp: number;
  twin_13a: number;
  outlet_15a: number;
  fcu_fused_spur: number;
  water_heater_20a: number;
  washing_machine_20a: number;
  gas_ignition_13a: number;
  gas_detector: number;
  hand_dryer: number;
  floor_box_f1: number;
  usb_outlet: number;
  industrial_16a: number;
  dp_switch_20a: number;
  control_panel: number;
}

interface ElectricalDistributionBoard {
  tag: string;
  type: 'lvp' | 'mdb' | 'smdb' | 'esmdb' | 'edb' | 'db';
  rating_a: number | null;
  tcl_kw: number | null;
  floor: string | null;
  is_emergency: boolean;
  circuit_count: number | null;
}

interface ElectricalCable {
  size_mm2: number;
  core_count: number;
  type: string;
  length_m: number | null;
  circuit: string | null;
  is_fire_rated: boolean;
}

interface ElectricalComponents {
  transformer: { kva: number | null; voltage_ratio: string | null; count: number } | null;
  generator: { kva: number | null; type: string | null; count: number } | null;
  ats: { rating_a: number | null; count: number } | null;
  main_acb: { rating_a: number | null; breaking_ka: number | null; count: number } | null;
  capacitor_bank: { kvar: number | null; type: string | null } | null;
  total_connected_load_kw: number | null;
  power_factor: number | null;
  fire_pump_kw: number | null;
  distribution_boards: ElectricalDistributionBoard[];
  cables: ElectricalCable[];
  floors: Array<{
    floor_label: string;
    floor_code: string;
    outlets: ElectricalOutletCounts;
    db_tags: string[];
  }>;
  earthing: { earth_rods: number | null; lightning_protection: boolean } | null;
  sld_found: boolean;
  floor_plan_count: number;
  confidence: number;
  reasoning: string;
}

interface ElectricalProcedureResult {
  // Step 1-2: Drawing inventory
  drawings_found: Array<{ filename: string; type: 'floor_plan' | 'schematic' | 'riser' | 'schedule' | 'other'; floor?: string }>;
  // Step 3: Floors
  floors_identified: number | null;
  floor_labels: string[];
  typical_floor_height_m: number | null;
  // Step 4: Scale
  drawing_scale: string | null;
  scale_detected: boolean;
  // Step 5: MDB / LV Room
  mdb_info: { location: string | null; rating_a: number | null; floor: string | null; tag: string | null; review_confirmed?: boolean };
  // Step 6: Schematic
  schematic_available: boolean;
  schematic_filename: string | null;
  // Steps 7-8: SMDB inventory
  smdb_inventory: Array<{ id: string; floor: string; rating_a: number | null; cable_size_from_mdb: string | null; connected_load_kw?: number | null; qty?: number | null; review_confirmed?: boolean }>;
  // Steps 9-10: LV → SMDB cables
  lv_to_smdb_cables: Array<{ from: string; to: string; size_mm2: number | null; length_m: number | null; route_via: string | null; confidence: 'high' | 'medium' | 'low'; circuit_description?: string | null; type?: string | null; provisional?: boolean }>;
  // Steps 11-12: SMDB → DB inventory
  db_inventory: Array<{ smdb_id: string; db_id: string; floor: string; rating_a: number | null; cable_size: string | null; review_confirmed?: boolean }>;
  db_groups?: Array<{
    tag_pattern: string;
    per_floor_qty: number | null;
    floors: number | null;
    total_qty: number;
    tcl_range_kw: string | null;
  }>;
  // Step 13: SMDB → DB cables (floor lets us group/enumerate per floor)
  smdb_to_db_cables: Array<{ from: string; to: string; size_mm2: number | null; length_m: number | null; confidence: 'high' | 'medium' | 'low'; floor?: string | null; circuit_description?: string | null; type?: string | null }>;
  // Step 14: Cable schedule (final output). `floor` is filled by the floor-aggregation
  // expander in derive-cable-paths so per-floor SMDB→DB runs stay distinguishable.
  // `source_drawing_number` is the sheet the run was read from (e.g. "P-200"); the scan
  // prompt fills it and the normalizer passes it through — used for the hover source ref.
  cable_schedule: Array<{ from: string; to: string; size_mm2: number; length_m: number; type: string; circuit_description: string | null; floor?: string | null; source_drawing_number?: string | null; review_confirmed?: boolean }>;
  bulk_cables?: Array<{ specification: string; application: string; estimated_length_m: number; provisional?: boolean }>;

  // BOQ Section 2: Incoming supply (from SLD)
  incoming_supply: {
    transformers: Array<{ kva: number; voltage_ratio: string; count: number }>;
    generator: { kva: number; type: string } | null;
    ats: { rating_a: number } | null;
    hv_ducts: { size_mm: number; count: number } | null;
    /** P-379-style "Mobile Generator provision (per DEWA requirement)" — count of provision sets */
    mobile_generator_provision?: { count: number } | null;
  };
  // BOQ Section 3: LV panel detail
  lv_panels: Array<{
    tag: string;
    main_acb_rating_a: number | null;
    main_acb_breaking_ka: number | null;
    outgoing_mccbs: Array<{ to: string; rating_a: number; count: number }>;
    /** @deprecated retained for back-compat — prefer `capacitor_banks` for multi-step setups */
    capacitor_bank_kvar: number | null;
    capacitor_banks?: Array<{ kvar: number; isolator_rating_a?: number | null }>;
  }>;
  mechanical_equipment: Array<{ description: string; rating_kw: number | null; rating_a: number | null; count: number }>;
  // `floor` enables the per-floor small-power take-off (this floor has X, that
  // floor has Y → bill total). Null/absent = building-wide line.
  // `provisional` = value estimated from geometry, NOT read from the drawing
  // (the "extract from file, no assumption" rule — estimates must be labelled).
  power_outlets: Array<{ description: string; unit: string; estimated_qty: number; floor?: string | null; provisional?: boolean }>;
  // Lighting fixtures read from THIS drawing's legend, counted per floor.
  // `provisional` = the drawing marks the area "indicative / as per ID/client".
  lighting_fixtures?: Array<{ type_ref: string | null; description: string; floor: string | null; qty: number; provisional?: boolean }>;
  containment: Array<{ description: string; unit: string; estimated_qty: number; provisional?: boolean }>;
  earthing: Array<{ description: string; unit: string; qty: number; provisional?: boolean }>;
  metering: Array<{ description: string; qty: number; provisional?: boolean }>;
  load_summary: Array<{ panel: string; tcl_kw: number; standby_kw: number; demand_factor: number; max_demand_kw: number }>;

  confidence: number;
  step_log: Array<{ step_num: number; name: string; status: 'done' | 'not_found' | 'skipped'; finding: string }>;
  stub?: boolean;
  /** Set by expandTypicalFloorFeeders (B3) when the typical-floor multiplication
   *  could not run (no fully-read template floor). Surfaced by the scan validator
   *  so a low cable total is flagged, never produced silently. */
  typical_floor_warning?: string | null;
}

function stubElectricalResult(buildingInfo: { floors?: number | null; area_sqft?: number | null; building_type?: string | null }): ElectricalProcedureResult {
  const floors = buildingInfo.floors || 5;
  const area = buildingInfo.area_sqft || 5000;
  const floorLabels = [
    'Basement',
    'Ground Floor',
    ...Array.from({ length: Math.max(0, floors - 2) }, (_, i) => `${i + 1}F`),
    'Roof',
  ];
  const STEP_NAMES = [
    '', 'Open the Drawing', 'List Available Drawings', 'Establish Floors and Floor Height',
    'Find Drawing Scale', 'Identify LV Room / MDB', 'Check Schematic Drawing Availability',
    'Note SMDBs from LV Panel', 'Identify SMDBs in Floor Drawings',
    'Establish Cable Route LV Panel to SMDBs', 'Estimate Cable Lengths and Sizes LV to SMDB',
    'Establish SMDB to DB Identification', 'Identify DB Locations per SMDB',
    'Estimate Cable Size and Length per DB', 'Prepare Cable Schedule',
  ];
  return {
    stub: true,
    drawings_found: [
      { filename: 'E-001 Ground Floor Power Plan.pdf', type: 'floor_plan', floor: 'Ground' },
      { filename: 'E-002 Typical Floor Power Plan.pdf', type: 'floor_plan', floor: 'Typical' },
      { filename: 'E-100 Single Line Diagram.pdf', type: 'schematic' },
      { filename: 'E-101 Riser Diagram.pdf', type: 'riser' },
    ],
    floors_identified: floors,
    floor_labels: floorLabels,
    typical_floor_height_m: 3.2,
    drawing_scale: '1:100',
    scale_detected: true,
    mdb_info: { location: 'LV Room, Ground Floor', rating_a: 1600, floor: 'Ground', tag: 'LVP-01' },
    schematic_available: true,
    schematic_filename: 'E-100 Single Line Diagram.pdf',
    smdb_inventory: [
      { id: 'SMDB-B1', floor: 'Basement', rating_a: 400, cable_size_from_mdb: '4C×95mm² XLPE' },
      { id: 'SMDB-GF', floor: 'Ground', rating_a: 315, cable_size_from_mdb: '4C×70mm² XLPE' },
      { id: 'SMDB-TF', floor: 'Typical', rating_a: 200, cable_size_from_mdb: '4C×35mm² XLPE' },
    ],
    lv_to_smdb_cables: [
      { from: 'LVP-01', to: 'SMDB-B1', size_mm2: 95, length_m: 30, route_via: 'Cable tray, riser shaft west', confidence: 'medium' },
      { from: 'LVP-01', to: 'SMDB-GF', size_mm2: 70, length_m: 15, route_via: 'Cable tray, LV room to main corridor', confidence: 'low' },
      { from: 'LVP-01', to: 'SMDB-TF', size_mm2: 35, length_m: 45, route_via: 'Riser shaft, floor by floor', confidence: 'low' },
    ],
    db_inventory: [
      { smdb_id: 'SMDB-GF', db_id: 'DB-GF-01', floor: 'Ground', rating_a: 100, cable_size: '4C×16mm² XLPE' },
      { smdb_id: 'SMDB-GF', db_id: 'DB-GF-02', floor: 'Ground', rating_a: 63, cable_size: '4C×10mm² XLPE' },
      { smdb_id: 'SMDB-TF', db_id: 'DB-TF', floor: 'Typical', rating_a: 63, cable_size: '4C×10mm² XLPE' },
    ],
    smdb_to_db_cables: [
      { from: 'SMDB-GF', to: 'DB-GF-01', size_mm2: 16, length_m: 25, confidence: 'medium' },
      { from: 'SMDB-GF', to: 'DB-GF-02', size_mm2: 10, length_m: 18, confidence: 'low' },
      { from: 'SMDB-TF', to: 'DB-TF', size_mm2: 10, length_m: 20, confidence: 'low' },
    ],
    cable_schedule: [
      { from: 'LVP-01', to: 'SMDB-B1', size_mm2: 95, length_m: 30, type: '4C×95mm² XLPE/SWA', circuit_description: 'Basement feeder' },
      { from: 'LVP-01', to: 'SMDB-GF', size_mm2: 70, length_m: 15, type: '4C×70mm² XLPE/SWA', circuit_description: 'Ground floor feeder' },
      { from: 'LVP-01', to: 'SMDB-TF', size_mm2: 35, length_m: 45, type: '4C×35mm² XLPE/SWA', circuit_description: 'Typical floor riser' },
      { from: 'SMDB-GF', to: 'DB-GF-01', size_mm2: 16, length_m: 25, type: '4C×16mm² XLPE', circuit_description: 'General power DB' },
      { from: 'SMDB-GF', to: 'DB-GF-02', size_mm2: 10, length_m: 18, type: '4C×10mm² XLPE', circuit_description: 'Lighting DB' },
      { from: 'SMDB-TF', to: 'DB-TF', size_mm2: 10, length_m: 20, type: '4C×10mm² XLPE', circuit_description: 'Typical floor DB (×floors)' },
    ],
    incoming_supply: {
      transformers: [{ kva: 1000, voltage_ratio: '11kV/400V', count: 1 }],
      generator: { kva: 500, type: 'diesel' },
      ats: { rating_a: 1600 },
      hv_ducts: null,
    },
    lv_panels: [{
      tag: 'LVP-01',
      main_acb_rating_a: 1600,
      main_acb_breaking_ka: 50,
      outgoing_mccbs: [
        { to: 'SMDB-B1', rating_a: 400, count: 1 },
        { to: 'SMDB-GF', rating_a: 315, count: 1 },
        { to: 'SMDB-TF', rating_a: 200, count: 1 },
      ],
      capacitor_bank_kvar: 150,
    }],
    mechanical_equipment: [
      { description: 'Fire pump', rating_kw: 37, rating_a: null, count: 1 },
      { description: 'Lift motor room', rating_kw: 22, rating_a: null, count: 2 },
    ],
    power_outlets: [
      { description: '13A single switched socket', unit: 'No.', estimated_qty: Math.round(area / 150) },
      { description: '13A twin switched socket', unit: 'No.', estimated_qty: Math.round(area / 300) },
      { description: 'FCU fused spur 20A', unit: 'No.', estimated_qty: Math.round(area / 600) },
    ],
    containment: [
      { description: '200×100mm HDGI cable tray', unit: 'm', estimated_qty: 150 },
      { description: '100×50mm HDGI cable tray', unit: 'm', estimated_qty: 300 },
      { description: '25mm dia. PVC conduit', unit: 'm', estimated_qty: 500 },
    ],
    earthing: [
      { description: 'Earth pit complete (copper rod)', unit: 'No.', qty: Math.ceil(floors / 3) },
      { description: '1C×70mm² bare copper earth cable', unit: 'm', qty: 100 },
    ],
    metering: [
      { description: 'DEWA kWh meter', qty: 1 },
      { description: 'CT meter 2000/5A', qty: 2 },
    ],
    load_summary: [
      { panel: 'LVP-01', tcl_kw: 450, standby_kw: 180, demand_factor: 0.7, max_demand_kw: 315 },
    ],
    confidence: 0.3,
    step_log: Array.from({ length: 14 }, (_, i) => ({
      step_num: i + 1,
      name: STEP_NAMES[i + 1],
      status: 'done' as const,
      finding: 'Demo mode — add ANTHROPIC_API_KEY (or DRAWTOBOQ_AIAS_KEY for the gateway) to analyze real drawings',
    })),
  };
}

// =========================================================================
// 1. classifyEmail — text-only, uses Haiku for speed
// =========================================================================

// The estimation inbox is curated for BOQ/RFQ traffic. Upstream filters
// (`isAutoIgnore`, `hasRfqKeywords` in poll-inbox/route.ts) already drop
// newsletters and keyword-less mail, so AI verification adds no signal here —
// every message that reaches this function is treated as an RFQ.
export async function classifyEmail(
  subject: string,
  body: string,
  from: string,
): Promise<ClassificationResult> {
  void from;
  const keywords = await loadKeywordsFromDB();

  const cleanText = `${subject} ${body}`
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
  const foundKeywords = keywords.filter(kw => cleanText.includes(kw.toLowerCase()));
  const matches = foundKeywords.length;

  const hasLargeArea = /\b(?:[5-9]\d|[1-9]\d{2,})[\s,]?\d{3}\s*(?:sq\s*ft|sqft|sq\.?\s*ft|sft)\b|\b\d{2,}\s*k\s*(?:sq\s*ft|sqft|sft)\b/i.test(cleanText);
  const hasUrgent = /\b(?:urgent|priority|asap|immediate|critical)\b/i.test(`${subject} ${cleanText}`);

  let priority: ClassificationResult['priority'];
  if (matches >= 5 || hasLargeArea || hasUrgent) {
    priority = 'priority_top';
  } else if (matches >= 2) {
    priority = 'priority_gen';
  } else {
    priority = 'new';
  }

  const confidence = matches >= 3 ? 0.9 : matches >= 1 ? 0.75 : 0.6;
  const reasonParts = [`${matches} keyword(s)`];
  if (hasLargeArea) reasonParts.push('large-area mention');
  if (hasUrgent) reasonParts.push('urgency cue');

  // Haiku classify ≈ $0.0025 per call avoided
  void logHeuristicSaving('rules-classify', 0.0025, { matches, priority });

  return {
    isRfq: true,
    confidence,
    priority,
    reasoning: `Rules-only (curated estimation inbox). ${reasonParts.join(', ')}.`,
    keywordsFound: foundKeywords,
  };
}

// =========================================================================
// 2. extractProjectInfo — vision + text, Sonnet
// =========================================================================

const EXTRACT_PROCEDURE_VERSION = 'extract-v1';

export async function extractProjectInfo(
  subject: string,
  body: string,
  attachmentNames: string[],
  attachmentFiles?: AttachmentFile[],
): Promise<ExtractionResult> {
  const stripped = body.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const dequoted = stripQuotedReplies(stripped);
  const cleanBody = dequoted.replace(/\s+/g, ' ').trim();

  // ── Tier 1: regex fallback (zero AI tokens) ──────────────────────────────
  // The fallback extracts ~10 fields from text alone. If we have no attachments
  // at all, AI can't add anything beyond what regex already found, so we skip
  // the call entirely. With attachments, AI may pull values from PDF vision
  // — we still run fallback first and merge below so AI null-returns don't
  // overwrite values regex already filled.
  const heuristic = extractProjectInfoFallback(subject, cleanBody, attachmentNames);
  const noAttachments = !attachmentFiles || attachmentFiles.length === 0;
  if (noAttachments) {
    console.log('[extract] no attachments — heuristic only, skipping Claude');
    return heuristic;
  }

  // ── Tier 2: content-hash cache ───────────────────────────────────────────
  const fileHashes = (attachmentFiles ?? []).map(f => ({ name: f.filename, data: f.buffer }));
  const cacheKey = computeTextKey(EXTRACT_PROCEDURE_VERSION, `${subject}\n${cleanBody}`, {
    attachments: fileHashes.map(f => ({ name: f.name, sha256_first16: hashFirst16(f.data) })),
  });
  const cached = await getCached<ExtractionResult>(cacheKey);
  if (cached) {
    console.log(`[extract] cache hit key=${cacheKey.slice(0, 12)}… — skipping Claude`);
    void logHeuristicSaving('extract-cache', 0.15, { key: cacheKey.slice(0, 16) });
    return cached;
  }

  // Phase 9: prepend a snippet listing fields humans have historically corrected
  // (last 90 days). Empty string when no actionable corrections — prompt is
  // unchanged. Cached 1h so this read costs nothing on the hot path.
  const priorHints = await getExtractionPriorHints();

  const prompt = `Extract ALL structured project information from this email and its PDF attachment content.

IMPORTANT: PDF attachment content contains the most accurate data. Always prioritize values from PDF over email body.

${priorHints}Email Subject: ${subject}
Content (email body + PDF attachments):
${cleanBody.substring(0, 8000)}

Attachment filenames: ${attachmentNames.join(', ') || 'None'}

Extract and respond in JSON format:
{
  "client_name": "company or developer name, or null",
  "project_name": "project name, or null",
  "location": "city/area in UAE, or null",
  "floors": total number of floors (count ALL: basement + ground + typical + roof), or null,
  "parking_floors": number of basement/parking floors or null,
  "typical_floors": number of typical/office floors or null,
  "area_per_floor_sqft": area per floor in sqft or null,
  "total_area_sqft": total built-up area in sqft (this is critical - extract exact number from PDF), or null,
  "typical_height_m": floor-to-floor height in meters or null,
  "building_type": one of "office"|"retail"|"residential"|"warehouse"|"villa"|"hotel"|"hospital"|"restaurant" or null,
  "deadline": submission deadline as ISO date string (e.g. "2026-05-03"), or null,
  "services_mentioned": array of ALL MEP services mentioned: "hvac"|"electrical"|"plumbing"|"fire_fighting"|"fire_alarm"|"bms"|"lpg"|"drainage",
  "hvac_tonnage": HVAC cooling load in TR (tons of refrigeration) if specified, or null,
  "hvac_system": HVAC system type if specified (e.g. "VRF", "Chiller", "Split", "Package Unit", "VRF with FAHU"), or null,
  "consultant": consultant/engineer firm name, or null,
  "plot_no": plot number from drawing title block (e.g. "6731315"), or null,
  "architect": lead architect name + registration if shown (e.g. "Engr. Samer Mahmoud Ajami (Reg. 105181)"), or null,
  "structural_engineer": structural engineer name + registration if shown, or null,
  "drawing_set": drawing set range/series, e.g. "P-001…P-300 (14 sheets, Power Layout)", or null,
  "job_no": job/file number from title block (e.g. "FA_P379"), or null
}

CRITICAL extraction rules:
- total_area_sqft: Look for "Built-Up Area", "Total Area", "GFA", "BUA" values. This MUST be extracted if present.
- Convert sqm to sqft (1 sqm = 10.764 sqft) if area given in metric
- If total_area_sqft not mentioned but area_per_floor and floors are, calculate it
- floors: Count ALL levels including basement, ground, mezzanine, typical, and roof
- services_mentioned: Include ALL MEP services found. Look for fire alarm separately from fire fighting.
- If drawing files are attached, analyze them visually for MEP equipment schedules, room layouts, floor plans.`;

  try {
    const content: any[] = [{ type: 'text', text: prompt }];
    if (attachmentFiles && attachmentFiles.length > 0) {
      content.push(...filesToClaudeParts(attachmentFiles));
    }

    const parsed = await callClaude(
      MODEL_VISION,
      'You are an MEP project data extractor for ERP Realsoft, an MEP estimation platform in Dubai, UAE. Respond with valid JSON only.',
      content,
      4096,
      'extractProjectInfo',
    );

    if (!parsed.total_area_sqft && parsed.area_per_floor_sqft && parsed.floors) {
      parsed.total_area_sqft = parsed.area_per_floor_sqft * parsed.floors;
    }

    // Merge: prefer AI value when non-null, otherwise keep heuristic value.
    // Critical: do NOT let AI's `null` overwrite a regex hit — the AI sometimes
    // returns null for fields the title-block text clearly contained.
    const pick = <T,>(ai: T | null | undefined, fallback: T | null): T | null =>
      (ai ?? null) !== null ? (ai as T) : fallback;
    const result: ExtractionResult = {
      client_name: pick(parsed.client_name, heuristic.client_name),
      project_name: pick(parsed.project_name, heuristic.project_name),
      location: pick(parsed.location, heuristic.location),
      floors: pick(parsed.floors, heuristic.floors),
      parking_floors: pick(parsed.parking_floors, heuristic.parking_floors),
      typical_floors: pick(parsed.typical_floors, heuristic.typical_floors),
      area_per_floor_sqft: pick(parsed.area_per_floor_sqft, heuristic.area_per_floor_sqft),
      total_area_sqft: pick(parsed.total_area_sqft, heuristic.total_area_sqft),
      typical_height_m: pick(parsed.typical_height_m, heuristic.typical_height_m),
      building_type: pick(parsed.building_type, heuristic.building_type),
      deadline: pick(parsed.deadline, heuristic.deadline),
      services_mentioned:
        Array.isArray(parsed.services_mentioned) && parsed.services_mentioned.length > 0
          ? parsed.services_mentioned
          : heuristic.services_mentioned,
      hvac_tonnage: pick(parsed.hvac_tonnage, heuristic.hvac_tonnage),
      hvac_system: pick(parsed.hvac_system, heuristic.hvac_system),
      consultant: pick(parsed.consultant, heuristic.consultant),
      plot_no: parsed.plot_no || null,
      architect: parsed.architect || null,
      structural_engineer: parsed.structural_engineer || null,
      drawing_set: parsed.drawing_set || null,
      job_no: parsed.job_no || null,
    };
    void storeCached(
      cacheKey,
      MODEL_VISION,
      { subject, attachment_count: attachmentFiles?.length ?? 0, body_chars: cleanBody.length },
      result,
      0.2,
    );
    return result;
  } catch (error: any) {
    // AI budget exceeded OR Claude failed — regex fallback covers ~60 % of fields.
    console.error('Claude extraction error, using fallback:', error.message);
    return extractProjectInfoFallback(subject, cleanBody, attachmentNames);
  }
}

// Short hash helper used in extract-cache key construction. We don't need a
// full sha256 of every file in the key (the cache table dedups by full key
// and a 16-char prefix differentiates files in practice).
function hashFirst16(buf: Buffer): string {
  let h = 0xcbf29ce4 >>> 0;
  const len = Math.min(buf.length, 4096);
  for (let i = 0; i < len; i++) {
    h ^= buf[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0') + buf.length.toString(16);
}

/**
 * 16-char SHA-256 prefix of a string. Used for prompt_version logging — full
 * SHA is overkill for a JSONB tag; 16 hex chars is enough collision resistance
 * to identify a single prompt revision across the dataset.
 */
function sha256First16(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

// Fallback
function extractProjectInfoFallback(subject: string, body: string, attachmentNames: string[]): ExtractionResult {
  const raw = `${subject}\n${body}`;
  const text = raw.toLowerCase();
  const clientMatch = raw.match(/client[:\s]+([^\n,;]+)/i);
  const projectMatch = raw.match(/project(?:\s+name)?[:\s]+([^\n,;]+)/i);
  const locationMatch = raw.match(/(?:location|site|address)[:\s]+([^\n,;]+)/i);
  const floorsMatch = text.match(/(\d+)\s*(?:floors?|storeys?|levels?)/i);
  const parkingMatch = text.match(/(\d+)\s*(?:basement|parking)\s*(?:floors?|levels?)?/i);
  const typicalMatch = text.match(/(\d+)\s*(?:typical|office|residential)\s*floors?/i);
  const heightMatch = text.match(/(?:floor[\s-]*to[\s-]*floor|typical\s+height|ceiling\s+height)[:\s]*([\d.]+)\s*m/i);
  const areaLabels = /(?:built[\s-]*up\s+area|total\s+area|gfa|bua|area)[:\s]*/i;
  const areaSqftMatch = text.match(new RegExp(`${areaLabels.source}([\\d,]+)\\s*(?:sq\\.?\\s*ft|sqft|sft)`, 'i')) || text.match(/([\d,]+)\s*(?:sq\.?\s*ft|sqft|sft)/i);
  const areaSqmMatch = text.match(new RegExp(`${areaLabels.source}([\\d,]+)\\s*(?:sq\\.?\\s*m|sqm|m2)`, 'i')) || text.match(/([\d,]+)\s*(?:sq\.?\s*m|sqm|m2)/i);
  let totalArea: number | null = null;
  if (areaSqftMatch) totalArea = parseInt(areaSqftMatch[1].replace(/,/g, ''));
  else if (areaSqmMatch) totalArea = Math.round(parseInt(areaSqmMatch[1].replace(/,/g, '')) * 10.764);
  const serviceKeywords: Record<ServiceType, string[]> = {
    hvac: ['hvac', 'air conditioning', 'ac ', 'a/c', 'cooling', 'ventilation'],
    electrical: ['electrical', 'power', 'lighting', 'wiring'],
    plumbing: ['plumbing', 'water supply', 'sanitary'],
    fire_fighting: ['fire fighting', 'firefighting', 'fire suppression', 'sprinkler'],
    fire_alarm: ['fire alarm', 'fire detection'],
    bms: ['bms', 'building management'],
    lpg: ['lpg', 'gas system'],
    drainage: ['drainage', 'sewage', 'waste water'],
  };
  const servicesMentioned: ServiceType[] = [];
  for (const [service, kws] of Object.entries(serviceKeywords)) {
    if (kws.some(kw => text.includes(kw))) servicesMentioned.push(service as ServiceType);
  }
  if (text.includes('complete mep') || text.includes('all mep') || text.includes('full mep')) {
    for (const svc of ['hvac', 'electrical', 'plumbing', 'fire_fighting'] as ServiceType[]) {
      if (!servicesMentioned.includes(svc)) servicesMentioned.push(svc);
    }
  }
  return {
    client_name: clientMatch ? clientMatch[1].trim() : null,
    project_name: projectMatch ? projectMatch[1].trim() : (subject || null),
    location: locationMatch ? locationMatch[1].trim() : null,
    floors: floorsMatch ? parseInt(floorsMatch[1]) : null,
    parking_floors: parkingMatch ? parseInt(parkingMatch[1]) : null,
    typical_floors: typicalMatch ? parseInt(typicalMatch[1]) : null,
    area_per_floor_sqft: null,
    total_area_sqft: totalArea,
    typical_height_m: heightMatch ? parseFloat(heightMatch[1]) : null,
    building_type: extractBuildingType(raw) as any,
    deadline: extractDeadline(raw),
    services_mentioned: servicesMentioned,
    hvac_tonnage: extractHvacTonnage(raw),
    hvac_system: extractHvacSystem(raw),
    consultant: extractConsultant(raw),
  };
}

// =========================================================================
// 3. classifyDrawingDiscipline — keyword-based, NO API call
// =========================================================================

const DISCIPLINE_KEYWORDS: Record<Discipline, string[]> = {
  hvac: ['hvac', 'ac-', 'ac_', 'a/c', 'air conditioning', 'ventilation', 'duct', 'fahu', 'ahu', 'fcu', 'thermal load', 'cooling', 'heating', 'chiller', 'vrf', 'dx-', 'package unit', 'split unit', 'exhaust fan', 'fresh air', 'mech-', 'mech_'],
  electrical: ['electrical', 'elec-', 'elec_', 'elec.', 'power', 'lighting', 'panel', 'switchgear', 'cable', 'mdb', 'smdb', 'db schedule', 'lux', 'wiring', 'transformer', 'busbar', 'ups', 'ele-', 'ele_'],
  plumbing: ['plumbing', 'plmb', 'plb-', 'plb_', 'plb.', 'water supply', 'hot water', 'cold water', 'sanitary', 'pipe', 'wc ', 'wash basin', 'fixture', 'water meter', 'booster pump', 'tank', 'cpvc', 'ppr'],
  fire_fighting: ['fire fighting', 'firefighting', 'sprinkler', 'fire suppression', 'fire pump', 'hose reel', 'hydrant', 'fm200', 'wet riser', 'dry riser', 'ff-', 'ff_', 'ff.'],
  fire_alarm: ['fire alarm', 'fire detection', 'smoke detector', 'heat detector', 'fire panel', 'addressable', 'fa-', 'fa_', 'fa.'],
  bms: ['bms', 'building management', 'building automation', 'bas-', 'ddc-', 'scada'],
  lpg: ['lpg', 'gas system', 'gas pipe', 'gas supply', 'cooking gas'],
  drainage: ['drainage', 'sewage', 'waste water', 'wastewater', 'storm water', 'stormwater', 'manhole', 'soil pipe', 'vent pipe', 'dr-', 'dr_'],
};

export function classifyDrawingDiscipline(filename: string, extractedText?: string): DisciplineResult {
  const text = `${filename} ${extractedText || ''}`.toLowerCase();
  let bestDiscipline: Discipline | null = null;
  let bestScore = 0;
  let bestKeywords: string[] = [];
  for (const [discipline, kws] of Object.entries(DISCIPLINE_KEYWORDS)) {
    const matched = kws.filter(kw => text.includes(kw));
    if (matched.length > bestScore) {
      bestScore = matched.length;
      bestDiscipline = discipline as Discipline;
      bestKeywords = matched;
    }
  }
  if (bestScore === 0) return { discipline: null, confidence: 0, reasoning: 'No discipline keywords found in filename or text' };
  return { discipline: bestDiscipline, confidence: Math.min(0.95, 0.4 + bestScore * 0.15), reasoning: `Matched ${bestScore} keywords: ${bestKeywords.join(', ')}` };
}

// =========================================================================
// 4. classifyReputation — heuristic-based, NO API call
// =========================================================================

export async function classifyReputation(
  clientName: string | null, projectName: string | null, location: string | null,
  totalAreaSqft: number | null, buildingType: string | null,
): Promise<ReputationResult> {
  const area = totalAreaSqft || 0;
  const client = (clientName || '').toLowerCase();
  const project = (projectName || '').toLowerCase();
  const tierAKeywords = ['government', 'emaar', 'nakheel', 'meraas', 'damac', 'aldar', 'dubai holding', 'dewa', 'rta', 'expo', 'ministry'];
  const isTierAClient = tierAKeywords.some(kw => client.includes(kw) || project.includes(kw));
  if (isTierAClient || area >= 100000) return { reputation_class: 'tier_a', reasoning: isTierAClient ? `Known major developer/government entity: ${clientName}` : `Large project: ${area.toLocaleString()} sqft` };
  if (area >= 30000 || buildingType === 'hotel' || buildingType === 'hospital') return { reputation_class: 'tier_b', reasoning: `Standard commercial project: ${area.toLocaleString()} sqft, ${buildingType || 'unknown type'}` };
  if (area > 0) return { reputation_class: 'tier_c', reasoning: `Small project: ${area.toLocaleString()} sqft` };
  return { reputation_class: 'unknown', reasoning: 'Insufficient data to classify reputation' };
}

// =========================================================================
// 5. analyzeSpecifications — vision, Sonnet
// =========================================================================

const SPEC_PROCEDURE_VERSION = 'spec-v2-heuristic';

export async function analyzeSpecifications(
  attachmentFiles: AttachmentFile[],
  extractedText: string,
): Promise<SpecAnalysisResult> {
  // ── Tier 1: dictionary heuristic (zero AI tokens) ────────────────────────
  // ~95 % of SABI specs reference at least 4 known brands; the heuristic
  // returns confidence ≥ 0.75 in that case and we never call Claude.
  // Async variant unions the static dictionary with brands auto-harvested
  // from past `sabi_services.ai_extraction.spec_analysis.approved_makes`.
  const heuristic = await analyzeSpecsHeuristicAsync(extractedText);
  if (heuristic.confidence >= SPEC_MIN_CONFIDENCE) {
    console.log(
      `[spec] heuristic hit conf=${heuristic.confidence} brands=${heuristic.hits.brands} standards=${heuristic.hits.standards} — skipping Claude`,
    );
    void logHeuristicSaving('spec-heuristic', 0.30, { brands: heuristic.hits.brands, standards: heuristic.hits.standards });
    return {
      requirements: heuristic.requirements,
      approved_makes: heuristic.approved_makes,
      standards_referenced: heuristic.standards_referenced,
      confidence: heuristic.confidence,
      reasoning: heuristic.reasoning,
    };
  }

  // ── Tier 2: content-hash cache ──────────────────────────────────────────
  const cacheKey = computeTextKey(SPEC_PROCEDURE_VERSION, extractedText, {
    file_count: attachmentFiles.length,
  });
  const cached = await getCached<SpecAnalysisResult>(cacheKey);
  if (cached) {
    console.log(`[spec] cache hit key=${cacheKey.slice(0, 12)}… — skipping Claude`);
    return cached;
  }

  // ── Tier 3: Claude (last resort) ────────────────────────────────────────
  const prompt = `Analyze the specification documents and extract ALL brand/make requirements for MEP materials and equipment.

Heuristic pre-pass already found ${heuristic.approved_makes.length} brand(s) and ${heuristic.standards_referenced.length} standard(s):
  brands: ${heuristic.approved_makes.join(', ') || '(none)'}
  standards: ${heuristic.standards_referenced.join(', ') || '(none)'}
Augment that list with anything the heuristic missed.

Specification text:
${extractedText.substring(0, 20000)}

Extract and respond in JSON:
{
  "requirements": [
    {
      "service": "hvac" | "electrical" | "plumbing" | "fire_fighting" | "fire_alarm" | "bms" | "drainage",
      "category": "category name (e.g., pipes, valves, panels, cables, fixtures)",
      "item": "specific item description",
      "specified_brand": "brand name or null if not specified",
      "specified_model": "model number or null",
      "standard": "standard reference (BS, ASTM, DIN, etc.) or null",
      "remarks": "any special requirements or null"
    }
  ],
  "approved_makes": ["list of all brands/manufacturers mentioned"],
  "standards_referenced": ["BS EN 12845", "ASTM D2241", etc.],
  "confidence": 0 to 1,
  "reasoning": "brief summary of what was found"
}

RULES:
- Extract EVERY brand/make mentioned in the specification
- Look for "Approved Makes", "Approved Manufacturers", "Or Equal", "Or Approved Equal"
- Look for material specifications (CPVC, PPR, GI, copper, etc.)
- Look for standard references (BS, ASTM, DIN, EN, UL, FM, NFPA)
- Separate by MEP discipline
- If "or equal" is mentioned, note it in remarks`;

  try {
    const content: any[] = [{ type: 'text', text: prompt }];
    content.push(...filesToClaudeParts(attachmentFiles));

    const parsed = await callClaude(
      MODEL_VISION,
      'You are an MEP specification analyst for a contractor in Dubai, UAE. Respond with valid JSON only.',
      content,
      8192,
      'analyzeSpecifications',
    );
    // Union-merge with the heuristic result so AI never silently loses brands
    // the dictionary already caught.
    const aiBrands: string[] = parsed.approved_makes || [];
    const aiStandards: string[] = parsed.standards_referenced || [];
    const merged: SpecAnalysisResult = {
      requirements: parsed.requirements || heuristic.requirements,
      approved_makes: [...new Set([...heuristic.approved_makes, ...aiBrands])],
      standards_referenced: [...new Set([...heuristic.standards_referenced, ...aiStandards])],
      confidence: Math.max(heuristic.confidence, parsed.confidence || 0),
      reasoning: parsed.reasoning || heuristic.reasoning,
    };
    void storeCached(
      cacheKey,
      MODEL_VISION,
      { text_chars: extractedText.length, files: attachmentFiles.length },
      merged,
      0.4, // estimated cost saved on a future hit
    );
    return merged;
  } catch (error: any) {
    // AI budget exceeded OR Claude failed — fall back to the heuristic result
    // even if its confidence is low. Better than empty.
    console.error('Spec analysis fell back to heuristic:', error.message);
    return {
      requirements: heuristic.requirements,
      approved_makes: heuristic.approved_makes,
      standards_referenced: heuristic.standards_referenced,
      confidence: heuristic.confidence,
      reasoning: `${heuristic.reasoning} (AI fallback unavailable: ${error.message})`,
    };
  }
}

// =========================================================================
// refreshDubaiRates — text + live web search (gateway task DRAWTOBOQ_PRICE_REFRESH)
// =========================================================================
// Given the current Price Library rows, asks Claude to web-search the latest
// Dubai MEP market price for each item and return a new rate WITH the source it
// used. The gateway-side template (chatgptnotes/AI-aas) is what actually enables
// the WebSearch tool — this wrapper just ships the item list and parses JSON.
// No DB writes happen here; the caller shows a review panel and applies only the
// rates the user approves.

export interface PriceRefreshInput {
  id: string;
  discipline: string;
  category: string;
  item_name: string;
  unit: string;
  current_rate_aed: number;
}

export interface PriceRefreshProposal {
  id: string;
  new_rate_aed: number | null;
  source_name: string | null;
  source_url: string | null;
  confidence: 'high' | 'medium' | 'low' | null;
}

export async function refreshDubaiRates(
  items: PriceRefreshInput[],
): Promise<PriceRefreshProposal[]> {
  if (items.length === 0) return [];

  const itemList = items
    .map(i => `- id=${i.id} | ${i.discipline} / ${i.category} | ${i.item_name} | unit=${i.unit} | current=AED ${i.current_rate_aed}`)
    .join('\n');

  const prompt = `Find the LATEST Dubai, UAE market unit price (in AED) for each MEP item below.
Use live web search of Dubai suppliers / market references. Match the stated unit.
For every item return the source you took the price from.

Items:
${itemList}

Respond with valid JSON only:
{
  "rates": [
    {
      "id": "the id given above",
      "new_rate_aed": number (AED per the item's unit) or null if no reliable Dubai price found,
      "source_name": "short source name e.g. supplier or site, or null",
      "source_url": "url you used, or null",
      "confidence": "high" | "medium" | "low"
    }
  ]
}

RULES:
- Return one entry for EVERY id given, in any order.
- Prices must be Dubai/UAE market rates in AED, matching the item's unit.
- If you cannot find a reliable Dubai price, set new_rate_aed to null (do not guess).
- Always cite the source you used for any non-null rate.`;

  const parsed = await callClaude(
    MODEL_VISION,
    'You are an MEP cost researcher for a contractor in Dubai, UAE. Use live web search for current Dubai market prices. Respond with valid JSON only.',
    [{ type: 'text', text: prompt }],
    8192,
    'refreshDubaiPrices',
  );

  const rows: any[] = Array.isArray(parsed) ? parsed : parsed?.rates || [];
  return rows.map(r => ({
    id: String(r.id),
    new_rate_aed: r.new_rate_aed == null || isNaN(Number(r.new_rate_aed)) ? null : Number(r.new_rate_aed),
    source_name: r.source_name || null,
    source_url: r.source_url || null,
    confidence: ['high', 'medium', 'low'].includes(r.confidence) ? r.confidence : null,
  }));
}

// =========================================================================
// 6. analyzeWaterSupplyDrawing — vision, Sonnet
// =========================================================================

export async function analyzeWaterSupplyDrawing(
  attachmentFiles: AttachmentFile[],
  extractedText: string,
  buildingInfo: { floors?: number | null; apartments?: number | null; area_sqft?: number | null; building_type?: string | null },
): Promise<WaterSupplyComponents> {
  const prompt = `You are analyzing water supply drawings for a building in Dubai, UAE.

Building Info:
- Floors: ${buildingInfo.floors || 'unknown'}
- Apartments/Units: ${buildingInfo.apartments || 'unknown'}
- Total Area: ${buildingInfo.area_sqft || 'unknown'} sqft
- Building Type: ${buildingInfo.building_type || 'unknown'}

Extracted text from drawings:
${extractedText.substring(0, 15000)}

Analyze the drawings and extracted text. Identify ALL water supply components.

Respond in JSON:
{
  "underground_tank": { "exists": boolean, "capacity_liters": number or null, "material": "GRP" or "concrete" or null },
  "transfer_pump": { "exists": boolean, "kw": number or null, "count": number },
  "roof_tank": { "exists": boolean, "capacity_liters": number or null, "material": string or null },
  "booster_pump": { "exists": boolean, "kw": number or null, "count": number },
  "water_meters": { "count": number, "size_mm": number or null },
  "hot_water_heater": { "exists": boolean, "type": "electric" or "solar" or "gas" or null, "capacity_liters": number or null, "count": number },
  "apartments_units": number or null,
  "fixtures": { "wc": count, "wash_basin": count, "kitchen_sink": count, "shower": count, "bathtub": count, "washing_machine": count },
  "pipes": [{ "size_mm": number, "material": "CPVC"|"PPR"|"GI"|"copper"|null, "length_meters": number|null, "purpose": "cold_supply"|"hot_supply"|"distribution"|"riser" }],
  "confidence": 0 to 1,
  "reasoning": "brief explanation"
}

RULES:
- If apartments count unknown but floors given: estimate 4 apartments per floor for residential
- If fixture count unknown but apartments given: estimate per apartment
- Extract ALL pipe sizes mentioned
- Do NOT return null for fields you can reasonably estimate`;

  try {
    const content: any[] = [{ type: 'text', text: prompt }];
    content.push(...filesToClaudeParts(attachmentFiles));

    const parsed = await callClaude(
      MODEL_VISION,
      'You are an MEP quantity surveyor analyzing water supply drawings. Respond with valid JSON only.',
      content,
      8192,
      'analyzeWaterSupplyDrawing',
    );
    return {
      underground_tank: parsed.underground_tank || null,
      transfer_pump: parsed.transfer_pump || null,
      roof_tank: parsed.roof_tank || null,
      booster_pump: parsed.booster_pump || null,
      water_meters: parsed.water_meters || null,
      hot_water_heater: parsed.hot_water_heater || null,
      apartments_units: parsed.apartments_units || null,
      fixtures: parsed.fixtures || { wc: null, wash_basin: null, kitchen_sink: null, shower: null, bathtub: null, washing_machine: null },
      pipes: parsed.pipes || [],
      confidence: parsed.confidence || 0,
      reasoning: parsed.reasoning || '',
    };
  } catch (error: any) {
    console.error('Water supply analysis error:', error);
    const floors = buildingInfo.floors || 5;
    const units = buildingInfo.apartments || Math.max(floors * 4, 4);
    return {
      underground_tank: { exists: true, capacity_liters: units * 500, material: 'GRP' },
      transfer_pump: { exists: true, kw: 2.2, count: 2 },
      roof_tank: { exists: true, capacity_liters: units * 200, material: 'GRP' },
      booster_pump: { exists: true, kw: 1.5, count: 2 },
      water_meters: { count: units, size_mm: 20 },
      hot_water_heater: { exists: true, type: 'electric', capacity_liters: 80, count: units },
      apartments_units: units,
      fixtures: { wc: units, wash_basin: units * 2, kitchen_sink: units, shower: units, bathtub: null, washing_machine: null },
      pipes: [
        { size_mm: 100, material: 'GI', length_meters: floors * 3.2, purpose: 'riser' },
        { size_mm: 50, material: 'PPR', length_meters: floors * 3.2 * 2, purpose: 'distribution' },
        { size_mm: 20, material: 'PPR', length_meters: units * 15, purpose: 'cold_supply' },
        { size_mm: 20, material: 'CPVC', length_meters: units * 10, purpose: 'hot_supply' },
      ],
      confidence: 0.3,
      reasoning: 'Estimated from building info (no drawings analyzed)',
    };
  }
}

// =========================================================================
// 7. analyzeDuctRouteDrawing — vision, Sonnet
// =========================================================================

export async function analyzeDuctRouteDrawing(
  attachmentFiles: AttachmentFile[],
  extractedText: string,
  buildingInfo: { floors?: number | null; area_sqft?: number | null; building_type?: string | null; typical_height_m?: number | null },
): Promise<DuctRouteComponents> {
  const prompt = `You are tracing DUCT ROUTES on HVAC floor plan drawings for a building in Dubai, UAE.

Building Info:
- Floors: ${buildingInfo.floors || 'unknown'}
- Total Area: ${buildingInfo.area_sqft || 'unknown'} sqft
- Building Type: ${buildingInfo.building_type || 'unknown'}
- Floor Height: ${buildingInfo.typical_height_m || 3.2}m

Extracted text from drawings:
${extractedText.substring(0, 15000)}

TASK: Trace every visible duct run on each floor plan. For each duct segment, measure or estimate its length.

Respond in JSON:
{
  "floors": [
    {
      "floor_label": "Ground Floor",
      "floor_code": "GF",
      "supply_ducts": [{"size_mm": 600, "length_m": 25, "material": "GI", "shape": "rectangular"}],
      "return_ducts": [{"size_mm": 500, "length_m": 20, "material": "GI"}],
      "exhaust_ducts": [{"size_mm": 300, "length_m": 15, "material": "GI"}],
      "fresh_air_ducts": [{"size_mm": 400, "length_m": 10, "material": "pre_insulated"}],
      "fittings": {"bends_90": 8, "bends_45": 4, "tees": 6, "reducers": 3},
      "terminals": {"supply_diffusers": 20, "linear_diffusers": 4, "return_grilles": 15, "exhaust_grilles": 8},
      "accessories": {"volume_dampers": 10, "fire_dampers": 4, "sound_attenuators": 2, "flexible_connections": 20}
    }
  ],
  "risers": [{"type": "supply", "size_mm": 800, "floors_served": 10, "height_per_floor_m": 3.2, "material": "GI"}],
  "confidence": 0.0 to 1.0,
  "reasoning": "brief explanation"
}

RULES:
- Trace EVERY visible duct run — do not skip small branches
- If "Typical Floor", note it — quantities multiplied by typical floor count
- Count ALL visible terminals on each floor plan
- Do NOT return empty arrays — estimate from typical layouts if not visible`;

  try {
    const content: any[] = [{ type: 'text', text: prompt }];
    content.push(...filesToClaudeParts(attachmentFiles));

    const parsed = await callClaude(
      MODEL_VISION,
      'You are an MEP quantity surveyor tracing duct routes on HVAC floor plans. Respond with valid JSON only.',
      content,
      8192,
      'analyzeDuctRouteDrawing',
    );
    return {
      floors: (parsed.floors || []).map((f: any) => ({
        floor_label: f.floor_label || 'Unknown Floor', floor_code: f.floor_code || 'UNK',
        supply_ducts: f.supply_ducts || [], return_ducts: f.return_ducts || [],
        exhaust_ducts: f.exhaust_ducts || [], fresh_air_ducts: f.fresh_air_ducts || [],
        fittings: f.fittings || { bends_90: 0, bends_45: 0, tees: 0, reducers: 0 },
        terminals: f.terminals || { supply_diffusers: 0, linear_diffusers: 0, return_grilles: 0, exhaust_grilles: 0 },
        accessories: f.accessories || { volume_dampers: 0, fire_dampers: 0, sound_attenuators: 0, flexible_connections: 0 },
      })),
      risers: parsed.risers || [],
      confidence: parsed.confidence || 0,
      reasoning: parsed.reasoning || '',
    };
  } catch (error: any) {
    console.error('Duct route analysis error:', error);
    const floors = buildingInfo.floors || 5;
    const areaSqm = (buildingInfo.area_sqft || 30000) / 10.764;
    const areaPerFloor = areaSqm / Math.max(floors, 1);
    const supplyLen = Math.round(Math.sqrt(areaPerFloor) * 2.5);
    const diffusers = Math.max(4, Math.round(areaPerFloor / 12));
    return {
      floors: [{
        floor_label: 'Typical Floor', floor_code: 'TF',
        supply_ducts: [{ size_mm: 500, length_m: supplyLen, material: 'GI', shape: 'rectangular' }],
        return_ducts: [{ size_mm: 400, length_m: Math.round(supplyLen * 0.7), material: 'GI' }],
        exhaust_ducts: [{ size_mm: 300, length_m: Math.round(supplyLen * 0.4), material: 'GI' }],
        fresh_air_ducts: [{ size_mm: 400, length_m: Math.round(supplyLen * 0.3), material: 'pre_insulated' }],
        fittings: { bends_90: Math.ceil(supplyLen / 5), bends_45: Math.ceil(supplyLen / 10), tees: Math.ceil(supplyLen / 8), reducers: Math.ceil(supplyLen / 12) },
        terminals: { supply_diffusers: diffusers, linear_diffusers: Math.ceil(diffusers * 0.1), return_grilles: Math.ceil(diffusers * 0.75), exhaust_grilles: Math.ceil(diffusers * 0.3) },
        accessories: { volume_dampers: Math.ceil(diffusers * 0.5), fire_dampers: 4, sound_attenuators: 2, flexible_connections: diffusers },
      }],
      risers: [
        { type: 'supply', size_mm: 600, floors_served: floors, height_per_floor_m: buildingInfo.typical_height_m || 3.2, material: 'GI' },
        { type: 'return', size_mm: 500, floors_served: floors, height_per_floor_m: buildingInfo.typical_height_m || 3.2, material: 'GI' },
      ],
      confidence: 0.25,
      reasoning: 'Estimated from building info (no drawings analyzed)',
    };
  }
}

// =========================================================================
// 8. analyzeHVACProcedure — vision, Sonnet (the crown jewel)
// =========================================================================

export async function analyzeHVACProcedure(
  attachmentFiles: AttachmentFile[],
  extractedText: string,
  buildingInfo: { floors?: number | null; area_sqft?: number | null; building_type?: string | null },
): Promise<HVACProcedureResult> {
  const prompt = `You are following George Varkey's EXACT 37-step HVAC estimation procedure for a project in Dubai, UAE.

Building: ${buildingInfo.floors || '?'} floors, ${buildingInfo.area_sqft || '?'} sqft, ${buildingInfo.building_type || 'unknown'} type.

Follow these steps IN ORDER and report findings for each:

<phase_a>
FOLDER NAVIGATION (Steps 1-5):
Step 1: Open Folder HVAC — look for any HVAC-related drawings/documents
Step 2: Open Folder Ventilation — look for ventilation-related drawings
Step 3: Open Folder AC — look for AC-specific drawings
Step 4: If none found, report "no schedule for AC exists"
Step 5: List all drawings folder-wise
</phase_a>

<phase_b>
DRAWING IDENTIFICATION (Steps 6-10):
Step 6: Check for drawing titled "Thermal Load Summary"
Step 7: Check for drawing titled "Equipment Schedule"
Step 8: Check for drawing titled "AC Equipment Schedule"
Step 9: If Step 6 found, confirm it IS a thermal load summary (has columns: Area/Zone, Load kW, Indoor unit type)
Step 10: If Step 7 or 8 found, confirm it IS an equipment schedule (has equipment listed with capacities)
</phase_b>

<phase_c>
SYSTEM ANALYSIS (Steps 11-18):
Step 11: TASK 1 — Find the principal system of air conditioning
Step 12: Read Thermal Load Summary in TABLE form — extract every row with: area/zone, indoor unit type (Decorative/Ducted), capacity kW, system reference
Step 13: Count Decorative indoor units
Step 14: Count Ducted indoor units
Step 15: Declare "predominantly decorative" OR "predominantly ducted"
Step 16: Establish AC system type from the data
Step 17: Identify items that are NOT indoor units (chillers, outdoor units, FAHUs, pumps, etc.)
Step 18: Specifically identify: Air Cooled Chiller, VRF Outdoor Unit, Package Units, FAHU, Pumps, or Others
</phase_c>

<phase_d>
SYSTEM TYPE DECLARATION (Steps 19-29):
Step 19-21: IF units reference reads "VRF" or system reads "Inverter Tech Compressor" AND indoor KW count >> outdoor KW count → declare "VRF System"
Step 22-24: IF system reads "DX" AND indoor KW count ≈ outdoor KW count → declare "DX Split Unit"
Step 25-27: IF system reads "Chiller" AND outdoor KW absent for indoor units but exists for "Chiller" → declare "Chiller System"
Step 28-29: IF Step 25-27 conditions met but NO chiller exists and Heat Exchanger exists → declare "District Cooling"
</phase_d>

<phase_e>
CALCULATION INPUTS (Steps 30-37):
Step 30: Read "Calculated AC Load" total at bottom of thermal load summary (total kW)
Step 35: If Step 18 found FAHU, read the FLOW (CFM) value
Step 36: Note FAHU count and capacity for separate pricing
</phase_e>

Extracted text from drawings:
${extractedText.substring(0, 20000)}

Respond in this EXACT JSON format:
{
  "hvac_folder_found": true/false,
  "ventilation_folder_found": true/false,
  "ac_folder_found": true/false,
  "drawings_list": [{"folder": "HVAC", "filename": "drawing name", "type": "thermal_load/equipment_schedule/floor_plan/other"}],
  "thermal_load_summary_found": true/false,
  "thermal_load_summary_file": "filename or null",
  "equipment_schedule_found": true/false,
  "equipment_schedule_file": "filename or null",
  "ac_equipment_schedule_found": true/false,
  "ac_equipment_schedule_file": "filename or null",
  "thermal_load_confirmed": true/false,
  "equipment_schedule_confirmed": true/false,
  "thermal_load_table": [{"area_or_zone": "Ground Floor", "indoor_unit_type": "Decorative", "capacity_kw": 5.6, "system_ref": "VRF"}],
  "decorative_count": 0,
  "ducted_count": 0,
  "predominantly": "decorative" or "ducted" or "mixed",
  "non_indoor_items": [{"item": "VRF Outdoor Unit", "type": "vrf_outdoor", "quantity": 1, "capacity_kw": 45.0, "flow_cfm": null}],
  "system_type": "vrf" or "dx_split" or "chiller" or "district_cooling" or "unknown",
  "system_detection_reasoning": "explain which steps led to this conclusion",
  "total_indoor_kw": 0,
  "total_outdoor_kw": 0,
  "has_heat_exchanger": false,
  "calculated_ac_load_kw": 0,
  "fahu_exists": false,
  "fahu_flow_cfm": null,
  "fahu_count": 0,
  "confidence": 0.0 to 1.0,
  "step_log": [{"step": 1, "description": "Open HVAC folder", "result": "Found 3 HVAC drawings", "status": "done"}]
}

CRITICAL RULES:
- Follow the steps IN ORDER — each step depends on the previous
- Extract REAL numbers from the drawings — do NOT guess
- The system_type detection MUST follow George's logic (steps 19-29) exactly
- step_log must have an entry for EVERY step showing what was found or skipped`;

  try {
    const content: any[] = [{ type: 'text', text: prompt }];
    content.push(...filesToClaudeParts(attachmentFiles));

    const parsed = await callClaude(
      MODEL_VISION,
      'You are an MEP estimation engineer following a precise 37-step HVAC procedure. Respond with valid JSON only.',
      content,
      4096,
      'analyzeHVACProcedure',
    );

    return {
      hvac_folder_found: parsed.hvac_folder_found ?? false,
      ventilation_folder_found: parsed.ventilation_folder_found ?? false,
      ac_folder_found: parsed.ac_folder_found ?? false,
      drawings_list: parsed.drawings_list || [],
      thermal_load_summary_found: parsed.thermal_load_summary_found ?? false,
      thermal_load_summary_file: parsed.thermal_load_summary_file || null,
      equipment_schedule_found: parsed.equipment_schedule_found ?? false,
      equipment_schedule_file: parsed.equipment_schedule_file || null,
      ac_equipment_schedule_found: parsed.ac_equipment_schedule_found ?? false,
      ac_equipment_schedule_file: parsed.ac_equipment_schedule_file || null,
      thermal_load_confirmed: parsed.thermal_load_confirmed ?? false,
      equipment_schedule_confirmed: parsed.equipment_schedule_confirmed ?? false,
      thermal_load_table: parsed.thermal_load_table || [],
      decorative_count: parsed.decorative_count || 0,
      ducted_count: parsed.ducted_count || 0,
      predominantly: parsed.predominantly || 'mixed',
      non_indoor_items: parsed.non_indoor_items || [],
      system_type: parsed.system_type || 'unknown',
      system_detection_reasoning: parsed.system_detection_reasoning || '',
      total_indoor_kw: parsed.total_indoor_kw || 0,
      total_outdoor_kw: parsed.total_outdoor_kw || 0,
      has_heat_exchanger: parsed.has_heat_exchanger ?? false,
      calculated_ac_load_kw: parsed.calculated_ac_load_kw || 0,
      fahu_exists: parsed.fahu_exists ?? false,
      fahu_flow_cfm: parsed.fahu_flow_cfm || null,
      fahu_count: parsed.fahu_count || 0,
      confidence: parsed.confidence || 0,
      step_log: parsed.step_log || [],
    };
  } catch (error: any) {
    console.error('HVAC procedure analysis error:', error);
    return {
      hvac_folder_found: false, ventilation_folder_found: false, ac_folder_found: false,
      drawings_list: [], thermal_load_summary_found: false, thermal_load_summary_file: null,
      equipment_schedule_found: false, equipment_schedule_file: null,
      ac_equipment_schedule_found: false, ac_equipment_schedule_file: null,
      thermal_load_confirmed: false, equipment_schedule_confirmed: false,
      thermal_load_table: [], decorative_count: 0, ducted_count: 0, predominantly: 'mixed',
      non_indoor_items: [], system_type: 'unknown',
      system_detection_reasoning: `Analysis failed: ${error.message}`,
      total_indoor_kw: 0, total_outdoor_kw: 0, has_heat_exchanger: false,
      calculated_ac_load_kw: 0, fahu_exists: false, fahu_flow_cfm: null, fahu_count: 0,
      confidence: 0, step_log: [{ step: 1, description: 'Analysis failed', result: error.message, status: 'not_found' }],
    };
  }
}

// =========================================================================
// 9. analyzeMEPDrawing — vision, Sonnet (generic BOQ extraction)
// =========================================================================

export async function analyzeMEPDrawing(
  discipline: string,
  attachmentFiles: AttachmentFile[],
  extractedText: string,
  buildingInfo: { floors?: number | null; area_sqft?: number | null; building_type?: string | null },
): Promise<MEPComponentResult> {
  const disciplinePrompts: Record<string, string> = {
    hvac: `Analyze HVAC drawings to extract a BOQ. Count EVERY indoor unit (Decorative/Ducted), outdoor units, FAHU/AHU, exhaust fans, FCU. Measure ductwork lengths, count fittings, terminals, accessories. Count from what you SEE on the drawings.`,

    electrical: `Identify Electrical components:
- MDB: quantity, rating (A)
- SMDB: quantity, rating (A)
- Distribution Boards (DB): quantity, rating (A)
- Cables: size (mm²), type (XLPE/PVC/LSZH), length (m)
- Light fixtures: quantity, type (LED/fluorescent), wattage
- Switches and sockets: quantity, type
- Cable trays: size, length (m)
- Earthing system: rods, cables
- UPS: quantity, capacity (kVA)
- Transformers: quantity, capacity (kVA)`,

    fire_fighting: `Identify Fire Fighting components:
- Sprinkler heads: quantity, type, rating
- Fire pump: quantity, capacity (GPM), HP
- Jockey pump: quantity, HP
- Hose reels: quantity
- Fire hydrants: quantity
- Fire extinguishers: quantity, type
- FM200 system: quantity, capacity
- Alarm valves: quantity, size
- Piping: sizes (mm), lengths (m), material`,

    drainage: `Identify Drainage components:
- Soil pipes: sizes (mm), lengths (m), material
- Waste pipes: sizes (mm), lengths (m)
- Vent pipes: sizes (mm), lengths (m)
- Floor drains: quantity, size
- Manholes: quantity, depth, size
- Inspection chambers: quantity
- Grease traps: quantity, capacity
- Sewage pump: quantity, HP`,

    fire_alarm: `Identify Fire Alarm components:
- Fire alarm panel: quantity, type, zones
- Smoke detectors: quantity, type
- Heat detectors: quantity, type
- Manual call points: quantity
- Sounders/bells: quantity
- Beam detectors: quantity
- Cables: type (fire rated), length (m)
- Module/interface units: quantity`,

    bms: `Identify BMS components:
- DDC controllers: quantity, type, I/O points
- Sensors: quantity, type
- Actuators: quantity, type
- Field panels: quantity
- Network switches: quantity
- Workstation: quantity
- Software licenses: quantity
- Cables: type, length (m)`,

    lpg: `Identify LPG/Gas components:
- Gas regulators: quantity, capacity
- Gas pipes: sizes (mm), lengths (m), material
- Gas valves: quantity, size
- Gas meters: quantity
- Solenoid valves: quantity
- Gas detectors: quantity
- Pressure gauges: quantity`,
  };

  const prompt = `You are extracting a Bill of Quantities (BOQ) from ${discipline.replace('_', ' ')} drawings.

Building: ${buildingInfo.floors || '?'} floors, ${buildingInfo.area_sqft || '?'} sqft, ${buildingInfo.building_type || 'unknown'} type.

IMPORTANT: Study the attached drawing images carefully. Count actual items you can SEE — symbols on floor plans, entries in equipment schedules, items in legends. Do NOT hallucinate quantities.

${extractedText ? `Extracted text from drawings:\n${extractedText.substring(0, 15000)}\n` : ''}
${disciplinePrompts[discipline] || 'Identify all components with quantities.'}

Respond in JSON:
{
  "components": [
    {
      "category": "A. Equipment / B. Ductwork / C. Piping / D. Accessories / E. Controls",
      "item": "specific item description (include model/brand if visible)",
      "quantity": number,
      "unit": "nos/m/set/sqm/lot",
      "specification": "size, capacity, rating, material, or null",
      "floor": "which floor(s) this was found on, or 'various'",
      "source": "counted from floor plan / read from equipment schedule / estimated from area"
    }
  ],
  "floor_summary": [
    { "floor": "Ground Floor", "items_found": 12, "key_equipment": "summary" }
  ],
  "confidence": 0 to 1,
  "reasoning": "what drawings were analyzed and key findings"
}

RULES:
- Extract EVERY component you can identify with real quantities
- Always state the SOURCE of each quantity (counted vs estimated)
- Group by category in BOQ order: Equipment → Ductwork → Piping → Accessories → Controls
- Include sizes (mm), lengths (m), and capacities (kW/TR/CFM) where visible`;

  try {
    const content: any[] = [{ type: 'text', text: prompt }];
    content.push(...filesToClaudeParts(attachmentFiles));

    const parsed = await callClaude(
      MODEL_VISION,
      `You are an expert MEP quantity surveyor in Dubai, UAE, extracting a BOQ from ${discipline.replace('_', ' ')} drawings. Respond with valid JSON only.`,
      content,
      8192,
      'analyzeMEPDrawing',
    );
    return {
      discipline,
      components: parsed.components || [],
      floor_summary: parsed.floor_summary || [],
      confidence: parsed.confidence || 0,
      reasoning: parsed.reasoning || '',
    };
  } catch (error: any) {
    console.error(`MEP analysis error (${discipline}):`, error);
    return { discipline, components: [], confidence: 0, reasoning: `Analysis failed: ${error.message}` };
  }
}

// =========================================================================
// 9. analyzeElectricalDrawing — vision, Sonnet
// =========================================================================

export async function analyzeElectricalDrawing(
  attachmentFiles: AttachmentFile[],
  extractedText: string,
  buildingInfo: { floors?: number | null; area_sqft?: number | null; building_type?: string | null; typical_height_m?: number | null }
): Promise<ElectricalComponents> {
  const prompt = `You are an MEP quantity surveyor analyzing ELECTRICAL POWER drawings for a building in Dubai, UAE.

Building Info:
- Floors: ${buildingInfo.floors || 'unknown'}
- Total Area: ${buildingInfo.area_sqft || 'unknown'} sqft
- Building Type: ${buildingInfo.building_type || 'unknown'}
- Floor Height: ${buildingInfo.typical_height_m || 3.2}m

Extracted text from drawings:
${extractedText.substring(0, 15000)}

TASK: Analyze ALL attached electrical power drawings. Extract data in two passes:

PASS 1 — SINGLE-LINE DIAGRAM (if present):
Read the single-line/riser diagram carefully for:
- Transformer: capacity (kVA), voltage ratio (e.g. 11kV/400V), quantity
- Standby generator: capacity (kVA), type (diesel/gas), quantity
- ATS (Automatic Transfer Switch): rating (A), quantity
- Main ACB: rating (A), breaking capacity (kA), quantity
- Capacitor bank: capacity (kVAR), type (automatic/manual)
- Total Connected Load (TCL): overall kW value + power factor
- Fire pump: kW rating
- ALL distribution boards: tag name (e.g. LVP-01, SMDB-G, ESMDB-RF, EDB-1F, DB-GF), type, rating (A), TCL (kW), floor, circuit count
- ALL cable types shown: conductor size (mm²), core count (e.g. 4C), type (XLPE/fire rated/FR), what circuit it feeds
- Earthing: earth rod count, lightning protection present?

PASS 2 — FLOOR PLAN DRAWINGS:
For EACH floor plan visible, count ALL power outlet symbols:
- 13A single switched socket (standard SP symbol)
- 13A single switched socket WP (weatherproof, shown with WP tag)
- 13A twin switched socket
- 15A switched socket outlet
- FCU fused spur (for fan coil units, labeled SP or FCU spur)
- 20A water heater flex outlet (labeled WH)
- 20A washing machine unswitched fused spur (labeled FL)
- Gas hob ignition 13A outlet (labeled GD or gas ignition)
- Gas detector outlet
- Hand dryer outlet (labeled HD)
- Floor box F1 (twin 13A + RJ45, labeled F1)
- USB socket outlet (labeled USB)
- 16A industrial socket (for BMU)
- 20A DP switch with neon (for mechanical equipment)
- Control panel connection point (labeled CP)
Also note which DB tags serve each floor.

Respond in JSON:
{
  "transformer": { "kva": number or null, "voltage_ratio": "11kV/400V" or null, "count": number },
  "generator": { "kva": number or null, "type": "diesel" or null, "count": number },
  "ats": { "rating_a": number or null, "count": number },
  "main_acb": { "rating_a": number or null, "breaking_ka": number or null, "count": number },
  "capacitor_bank": { "kvar": number or null, "type": "automatic" or "manual" or null },
  "total_connected_load_kw": number or null,
  "power_factor": number or null,
  "fire_pump_kw": number or null,
  "distribution_boards": [
    {
      "tag": "LVP-01",
      "type": "lvp" or "mdb" or "smdb" or "esmdb" or "edb" or "db",
      "rating_a": number or null,
      "tcl_kw": number or null,
      "floor": "Ground" or null,
      "is_emergency": true or false,
      "circuit_count": number or null
    }
  ],
  "cables": [
    {
      "size_mm2": number,
      "core_count": number,
      "type": "fire_rated" or "xlpe" or "lszh" or "pvc",
      "length_m": number or null,
      "circuit": "description of what it feeds" or null,
      "is_fire_rated": true or false
    }
  ],
  "floors": [
    {
      "floor_label": "Ground Floor",
      "floor_code": "GF",
      "outlets": {
        "single_13a": 0,
        "single_13a_wp": 0,
        "twin_13a": 0,
        "outlet_15a": 0,
        "fcu_fused_spur": 0,
        "water_heater_20a": 0,
        "washing_machine_20a": 0,
        "gas_ignition_13a": 0,
        "gas_detector": 0,
        "hand_dryer": 0,
        "floor_box_f1": 0,
        "usb_outlet": 0,
        "industrial_16a": 0,
        "dp_switch_20a": 0,
        "control_panel": 0
      },
      "db_tags": ["DB-GF"]
    }
  ],
  "earthing": { "earth_rods": number or null, "lightning_protection": true or false },
  "sld_found": true or false,
  "floor_plan_count": number,
  "confidence": 0.0 to 1.0,
  "reasoning": "what drawings were found and how data was extracted"
}

RULES:
- If a floor plan is labeled "Typical Floor", note it — outlet counts will be multiplied by typical floor count
- Outlet counts: COUNT symbols you can SEE on the drawing. Mark source as counted vs estimated.
- Distribution board tags: use exact labels from the drawing (LVP-01, SMDB-G, etc.)
- Type mapping: LVP = main LV panel, SMDB = sub-main DB, ESMDB = emergency SMDB, EDB = emergency DB, DB = standard distribution board, MDB = main DB
- If SLD is present, extract ALL boards visible in the hierarchy
- confidence: 0.8+ if SLD present, 0.5-0.7 if only floor plans, 0.3 if estimated
- Do NOT return empty arrays — estimate if you cannot count precisely`;

  try {
    const content: any[] = [{ type: 'text', text: prompt }];
    content.push(...filesToClaudeParts(attachmentFiles));

    const parsed = await callClaude(
      MODEL_VISION,
      'You are an MEP quantity surveyor analyzing electrical power drawings. Respond with valid JSON only.',
      content,
      8192,
      'analyzeElectricalDrawing',
    );

    const emptyOutlets = (): ElectricalOutletCounts => ({
      single_13a: 0, single_13a_wp: 0, twin_13a: 0, outlet_15a: 0,
      fcu_fused_spur: 0, water_heater_20a: 0, washing_machine_20a: 0,
      gas_ignition_13a: 0, gas_detector: 0, hand_dryer: 0,
      floor_box_f1: 0, usb_outlet: 0, industrial_16a: 0,
      dp_switch_20a: 0, control_panel: 0,
    });

    return {
      transformer: parsed.transformer || null,
      generator: parsed.generator || null,
      ats: parsed.ats || null,
      main_acb: parsed.main_acb || null,
      capacitor_bank: parsed.capacitor_bank || null,
      total_connected_load_kw: parsed.total_connected_load_kw || null,
      power_factor: parsed.power_factor || null,
      fire_pump_kw: parsed.fire_pump_kw || null,
      distribution_boards: (parsed.distribution_boards || []).map((b: any) => ({
        tag: b.tag || 'Unknown',
        type: b.type || 'db',
        rating_a: b.rating_a || null,
        tcl_kw: b.tcl_kw || null,
        floor: b.floor || null,
        is_emergency: b.is_emergency ?? false,
        circuit_count: b.circuit_count || null,
      })),
      cables: (parsed.cables || []).map((c: any) => ({
        size_mm2: c.size_mm2 || 0,
        core_count: c.core_count || 4,
        type: c.type || 'xlpe',
        length_m: c.length_m || null,
        circuit: c.circuit || null,
        is_fire_rated: c.is_fire_rated ?? false,
      })),
      floors: (parsed.floors || []).map((f: any) => ({
        floor_label: f.floor_label || 'Unknown Floor',
        floor_code: f.floor_code || 'UNK',
        outlets: { ...emptyOutlets(), ...(f.outlets || {}) },
        db_tags: f.db_tags || [],
      })),
      earthing: parsed.earthing || null,
      sld_found: parsed.sld_found ?? false,
      floor_plan_count: parsed.floor_plan_count || attachmentFiles.length,
      confidence: parsed.confidence || 0,
      reasoning: parsed.reasoning || '',
    };
  } catch (error: any) {
    console.error('Electrical drawing analysis error:', error);
    const floors = buildingInfo.floors || 5;
    const units = Math.max(floors * 2, 4);
    return {
      transformer: null,
      generator: null,
      ats: null,
      main_acb: null,
      capacitor_bank: null,
      total_connected_load_kw: null,
      power_factor: null,
      fire_pump_kw: null,
      distribution_boards: [
        { tag: 'MDB', type: 'mdb', rating_a: 800, tcl_kw: null, floor: 'Ground', is_emergency: false, circuit_count: null },
        { tag: 'SMDB-TF', type: 'smdb', rating_a: 200, tcl_kw: null, floor: 'Typical', is_emergency: false, circuit_count: null },
      ],
      cables: [],
      floors: Array.from({ length: Math.min(floors, 3) }, (_, i) => ({
        floor_label: i === 0 ? 'Ground Floor' : i === 1 ? 'Typical Floor' : 'Roof',
        floor_code: i === 0 ? 'GF' : i === 1 ? 'TF' : 'RF',
        outlets: {
          single_13a: Math.round(units * 3), single_13a_wp: Math.round(units * 0.5),
          twin_13a: Math.round(units * 1), outlet_15a: 0, fcu_fused_spur: units,
          water_heater_20a: units, washing_machine_20a: Math.round(units * 0.5),
          gas_ignition_13a: units, gas_detector: Math.round(units * 0.3),
          hand_dryer: Math.round(floors * 2), floor_box_f1: 0,
          usb_outlet: Math.round(units * 0.5), industrial_16a: 0,
          dp_switch_20a: Math.round(floors * 2), control_panel: Math.round(floors * 0.5),
        },
        db_tags: [],
      })),
      earthing: { earth_rods: Math.ceil(floors / 3), lightning_protection: true },
      sld_found: false,
      floor_plan_count: 0,
      confidence: 0.2,
      reasoning: `Analysis failed: ${error.message} — fallback estimates used`,
    };
  }
}

// =========================================================================
// 10. analyzeElectricalProcedure — 14-step procedure, vision, Sonnet
// =========================================================================

export async function analyzeElectricalProcedure(
  attachmentFiles: AttachmentFile[],
  extractedText: string,
  buildingInfo: { floors?: number | null; area_sqft?: number | null; building_type?: string | null }
): Promise<ElectricalProcedureResult> {
  // Stub fallback when AI credentials aren't configured. Gateway path checks
  // DRAWTOBOQ_AIAS_KEY (the gateway provisions Claude on its side); SDK path
  // checks ANTHROPIC_API_KEY directly.
  const aiCredsMissing = gatewayEnabled()
    ? !process.env.DRAWTOBOQ_AIAS_KEY
    : !process.env.ANTHROPIC_API_KEY;
  if (aiCredsMissing) return stubElectricalResult(buildingInfo);

  // Phase 1 preflight — gated by ELECTRICAL_PREFLIGHT env flag.
  // When on: deterministic library extractors fill in scale, floors, drawing
  // list, schematic presence, and any client-supplied XLSX schedule rows
  // before Sonnet sees the prompt.
  const preflight = await runElectricalPreflight(attachmentFiles);
  const sonnetFiles = preflight.enabled ? preflight.remainingForSonnet : attachmentFiles;
  if (preflight.enabled) {
    const skippedCount = preflight.skippedSonnet.length;
    const factCount =
      (preflight.knownFacts.scale ? 1 : 0) +
      preflight.knownFacts.floors.length +
      preflight.knownFacts.drawings.length +
      preflight.knownFacts.scheduleRows.length;
    console.log(
      `[electrical-preflight] enabled · ${factCount} facts injected · ${skippedCount} files served library-only · ${sonnetFiles.length} still going to Sonnet`,
    );
    // Sonnet vision call ≈ $0.50; rough credit per file fully library-served.
    if (skippedCount > 0) {
      void logHeuristicSaving('electrical-preflight', 0.05 * skippedCount, {
        skipped: skippedCount,
        facts: factCount,
      });
    }
  }

  // Prior-error patterns from the last 90 days of human corrections (the same
  // signal extractProjectInfo uses). Surface common over/under-counts and
  // wrong-field mistakes here so Claude re-checks them before answering.
  // Empty string when no corrections are above the 3-instance noise floor.
  const correctionHints = await getExtractionPriorHints();
  const knownFactsBlock = [preflight.promptHints, correctionHints]
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .join('\n\n');

  const prompt = `You are an MEP electrical estimator following George Varkey's 14-step electrical BOQ procedure for a project in Dubai, UAE.

${knownFactsBlock}

Building: ${buildingInfo.floors || '?'} floors, ${buildingInfo.area_sqft || '?'} sqft, ${buildingInfo.building_type || 'unknown'} type.

Follow these steps IN ORDER and report findings for each:

Step 1:  Open the drawing — locate all electrical drawings available
Step 2:  List available drawings — classify each as floor_plan / schematic / riser / schedule / other; note which floor each covers
Step 3:  Establish floors and floor height — count and name every level (Basement, Ground, 1F, 2F … Roof); note typical floor height in metres
Step 4:  Find drawing scale — read the scale annotation or scale bar (e.g. "1:100", "1:50"); note if found or not found
Step 5:  Identify LV Room / MDB — find the Main LV Panel / Main Distribution Board, most probably on the Ground Floor; note tag (e.g. LVP-01), rating in Amps, location
Step 6:  Check availability of schematic drawing — confirm if a Single-Line Diagram (SLD) or schematic exists; note the filename
Step 7:  Note SMDBs from LV panel in schematic drawing — list every SMDB fed from the MDB: tag (e.g. SMDB-1F), floor, rating (A), cable size from MDB (e.g. 4C×95mm²), connected_load_kw if shown on the SLD (e.g. 150.86 kW), qty when a row covers a stack of identical floors (e.g. SMDB-1F to SMDB-8F → qty 8). Use ONE representation per SMDB: EITHER enumerate per-floor boards (SMDB-1F, SMDB-2F … each qty 1) OR a single typical-floor stack (SMDB-TF, qty = N) — NEVER both, or the typical floors get double-counted.
Step 8:  Identify SMDBs in floor drawings from Basement to Roof — confirm SMDB locations on floor plans, cross-check with schematic
Step 9:  Establish probable cable route from LV panel to SMDBs — look at riser drawing or riser annotations; note route (e.g. "riser shaft B, west core")
Step 10: Estimate cable lengths and sizes for all LV panel → SMDB runs — note size (mm²), estimated length (m), confidence: high=from riser dim / medium=scaled / low=assumed. When scale is NOT detected, mark the length confidence "low" — the system then fills it deterministically from the typical floor height (4 m lead-in + floor index × typical_floor_height_m + 0.5 m), so do NOT default to 15 m+ per floor (that produces 4× over-estimates).
Step 11: Establish SMDB → DB identification and cable size — from schematic, list EVERY individual Distribution Board (DB) fed from each SMDB in db_inventory: one row per DB tag (DB-T01, DB-T02, … DB-T15 — never "DB-T01 to DB-T15"). Also populate db_groups[] alongside as a rollup summary (tag pattern, per-floor qty, total qty, TCL range) — db_groups never replaces db_inventory enumeration.
Step 12: For each SMDB, identify locations of its DBs — from floor plans, confirm DB location per floor
Step 13: Estimate cable size and length for each SMDB → DB run — length from scaled floor plan; confidence flagged. smdb_to_db_cables MUST emit one row per individual DB on each floor, with the floor field set. Both kinds of aggregation are FORBIDDEN: tag ranges ("DB-T01 to T15") AND floor qualifiers ("DB-T01 to DB-T15 odd floors", "per typical floor", "1F–8F"). A typical floor with 15 DBs across 8 floors = 120 rows, not 2. They break the take-off audit trail. MEASURE EACH DB'S LENGTH INDIVIDUALLY: trace the route from the SMDB to THAT board's own position on the scaled plan, so a DB at the far end of the floor gets a longer run than one beside the SMDB. Do NOT copy a single length onto every DB on a floor — identical same-floor lengths are valid ONLY when the plan genuinely shows the boards equidistant, and those rows must be flagged confidence "low".
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
  "smdb_to_db_cables": [{ "from": "string", "to": "string", "size_mm2": number_or_null, "length_m": number_or_null, "confidence": "high|medium|low", "floor": "string or null", "source_drawing_number": "string or null" }],
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
${extractedText.substring(0, 12000)}`;

  try {
    const content: any[] = [...filesToClaudeParts(sonnetFiles), { type: 'text', text: prompt }];

    // 12K wasn't enough for real SLDs (P-379 etc.) — Claude truncates after
    // emitting drawings/SMDB/DB inventory and never reaches cable_schedule,
    // which then trips the "0 cables" gate. Sonnet 4.6 supports far more;
    // 32K covers a fully-itemized take-off (~250-300 rows across all sections)
    // with margin.
    const parsed = await callClaude(
      MODEL_VISION,
      'You are an MEP electrical estimator. Respond ONLY with a valid JSON object matching the schema in the user message. No prose, no markdown.',
      content,
      32000,
      'analyzeElectricalProcedure',
    );

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
      lighting_fixtures: Array.isArray(parsed.lighting_fixtures) ? parsed.lighting_fixtures : undefined,
      containment: Array.isArray(parsed.containment) ? parsed.containment : [],
      earthing: Array.isArray(parsed.earthing) ? parsed.earthing : [],
      metering: Array.isArray(parsed.metering) ? parsed.metering : [],
      load_summary: Array.isArray(parsed.load_summary) ? parsed.load_summary : [],
      confidence: parsed.confidence ?? 0,
      step_log: Array.isArray(parsed.step_log) ? parsed.step_log : [],
    };
  } catch (error: any) {
    // Re-throw so the caller (estimate route) can roll status back to 'extracted'.
    // Returning a stub here would silently open Gate 14 with zero cables.
    console.error('analyzeElectricalProcedure (claude) failed:', error.message);
    throw error instanceof Error ? error : new Error(String(error));
  }
}

/**
 * Targeted gap-fill re-read. Makes ONE focused vision call that re-reads the
 * same drawings for only the given (empty) sections and returns the parsed
 * section arrays. Reuses the electrical taskID (the gateway is passthrough on
 * userText) and the unified callClaude transport. Returns {} when there are no
 * fillable sections or AI creds are missing — caller merges via mergeGapFill().
 */
export async function gapFillElectricalSections(
  attachmentFiles: AttachmentFile[],
  extractedText: string,
  buildingInfo: { floors?: number | null; area_sqft?: number | null; building_type?: string | null },
  sections: string[],
): Promise<Record<string, unknown>> {
  const keys = gapFillableSections(sections);
  if (keys.length === 0) return {};
  const aiCredsMissing = gatewayEnabled()
    ? !process.env.DRAWTOBOQ_AIAS_KEY
    : !process.env.ANTHROPIC_API_KEY;
  if (aiCredsMissing) return {};

  const prompt = buildGapFillPrompt(keys, buildingInfo, extractedText);
  const content: any[] = [...filesToClaudeParts(attachmentFiles), { type: 'text', text: prompt }];
  try {
    // 8K is ample for a few sections; reuse the registered electrical subStep so
    // the gateway routes it to DRAWTOBOQ_ELECTRICAL_EXTRACT (passthrough prompt).
    const parsed = await callClaude(
      MODEL_VISION,
      'You are an MEP electrical estimator. Respond ONLY with a valid JSON object matching the schema in the user message. No prose, no markdown.',
      content,
      8000,
      'analyzeElectricalProcedure',
    );
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error: any) {
    // Gap-fill is best-effort — a failure must not sink the whole scan. The
    // caller keeps the original result and the validator still flags the gaps.
    console.error('gapFillElectricalSections failed:', error?.message || error);
    return {};
  }
}

/**
 * Per-floor gap-fill re-read. When the validator finds floors that were
 * established (floor_labels) but produced NO per-floor take-off, makes ONE
 * focused vision call that re-reads ONLY those floors' sheets for the floor-wise
 * sections (power outlets + lighting). Caller appends via mergeFloorGapFill().
 * Returns {} when there are no empty floors or AI creds are missing.
 */
export async function gapFillElectricalFloors(
  attachmentFiles: AttachmentFile[],
  extractedText: string,
  buildingInfo: { floors?: number | null; area_sqft?: number | null; building_type?: string | null },
  emptyFloors: string[],
): Promise<Record<string, unknown>> {
  if (!emptyFloors || emptyFloors.length === 0) return {};
  const aiCredsMissing = gatewayEnabled()
    ? !process.env.DRAWTOBOQ_AIAS_KEY
    : !process.env.ANTHROPIC_API_KEY;
  if (aiCredsMissing) return {};

  const prompt = buildFloorGapFillPrompt(emptyFloors, buildingInfo, extractedText);
  const content: any[] = [...filesToClaudeParts(attachmentFiles), { type: 'text', text: prompt }];
  try {
    const parsed = await callClaude(
      MODEL_VISION,
      'You are an MEP electrical estimator. Respond ONLY with a valid JSON object matching the schema in the user message. No prose, no markdown.',
      content,
      8000,
      'analyzeElectricalProcedure',
    );
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error: any) {
    console.error('gapFillElectricalFloors failed:', error?.message || error);
    return {};
  }
}
