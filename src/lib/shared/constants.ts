import { PhaseInfo, PipelineStep, ServiceType } from '@/lib/shared/types';

// Gmail account to monitor
export const GMAIL_ACCOUNT = process.env.GMAIL_ACCOUNT || 'chatgptnotes@gmail.com';

// Target estimation email — only process emails addressed to this
export const ESTIMATION_EMAIL = process.env.ESTIMATION_EMAIL || 'estimation@realsoft.example';

// RFQ identification keywords
export const RFQ_KEYWORDS = [
  'please quote',
  'waiting for your best price',
  'will be interested',
  'request for quotation',
  'rfq',
  'best price',
  'proposal request',
  'tender',
  'bid invitation',
  'enquiry',
  'pricing request',
  'quotation required',
  'kindly quote',
  'competitive price',
  'submit your offer',
  'invitation to bid',
  'request for proposal',
  'scope of work',
  'quotation',
  'formal quotation',
  'price breakdown',
  'cost breakdown',
  'project cost',
  'mep',
  'hvac',
  'plumbing',
  'electrical',
  'fire fighting',
  'site visit',
  'bill of quantities',
  'boq',
];

// MEP service definitions
export const SERVICE_LABELS: Record<ServiceType, string> = {
  hvac: 'Air Conditioning (HVAC)',
  electrical: 'Electrical',
  plumbing: 'Plumbing',
  fire_fighting: 'Fire Fighting',
  fire_alarm: 'Fire Alarm',
  bms: 'BMS (Building Management System)',
  lpg: 'LPG',
  drainage: 'Drainage',
};

// Priority labels matching George's classification
export const PRIORITY_LABELS: Record<string, string> = {
  priority_top: 'Priority - Top',
  priority_gen: 'Priority - General',
  new: 'New',
  ignore: 'To Be Ignored',
};

/**
 * @deprecated Use {@link MAIN_PIPELINE_PHASES} for the top-level workflow and
 * the electrical sub-pipeline phase via {@link ELECTRICAL_SUB_PIPELINE} for the
 * cable-schedule procedure. Kept for back-compat readers; will be removed once
 * all callers migrate (see PR4 of MAIN/SUB migration plan).
 */
export const PIPELINE_PHASES: PhaseInfo[] = [
  { id: 'electrical', label: 'Electrical Cable Schedule', stepRange: [1, 14] },
];

/**
 * @deprecated Use {@link MAIN_PIPELINE_STEPS} (15-step email→quote workflow with
 * 5 gates) and {@link ELECTRICAL_SUB_PIPELINE} (14-step cable-schedule procedure
 * that runs inside MAIN step 11 on the Detailed path). Kept as a back-compat
 * alias for old readers.
 */
export const PIPELINE_STEPS: PipelineStep[] = [
  { step: 1,  name: 'Open the Drawing',                        description: 'Locate all electrical drawings available in the attachment set',                                              requiresConfirmation: false, phase: 'electrical', displayName: 'Drawing opened',           activeLabel: 'Opening electrical drawings...' },
  { step: 2,  name: 'List Available Drawings',                 description: 'Classify each drawing: floor_plan / schematic / riser / schedule / other; note which floor each covers',    requiresConfirmation: false, phase: 'electrical', displayName: 'Drawings listed',          activeLabel: 'Listing and classifying drawings...' },
  { step: 3,  name: 'Establish Floors and Floor Height',       description: 'Count and name every level (Basement, Ground, 1F … Roof); note typical floor height in metres',            requiresConfirmation: false, phase: 'electrical', displayName: 'Floors established',       activeLabel: 'Establishing floors and floor heights...' },
  { step: 4,  name: 'Find Drawing Scale',                      description: 'Read scale annotation or scale bar (e.g. 1:100, 1:50); note if found or not found',                         requiresConfirmation: false, phase: 'electrical', displayName: 'Scale found',              activeLabel: 'Finding drawing scale...' },
  { step: 5,  name: 'Identify LV Room / MDB',                  description: 'Find the Main LV Panel / MDB — most probably on Ground Floor; note tag, rating (A), and location',          requiresConfirmation: false, phase: 'electrical', displayName: 'LV Room / MDB identified', activeLabel: 'Locating LV Room / Main Distribution Board...' },
  { step: 6,  name: 'Check Schematic Drawing Availability',    description: 'Confirm if a Single-Line Diagram (SLD) or schematic exists; note the filename',                             requiresConfirmation: false, phase: 'electrical', displayName: 'Schematic checked',        activeLabel: 'Checking for schematic / SLD...' },
  { step: 7,  name: 'Note SMDBs from LV Panel',               description: 'From schematic: list every SMDB fed from MDB — tag, floor, rating (A), cable size (e.g. 4C×95mm²)',        requiresConfirmation: false, phase: 'electrical', displayName: 'SMDBs noted from SLD',     activeLabel: 'Noting SMDBs from LV panel in schematic...' },
  { step: 8,  name: 'Identify SMDBs in Floor Drawings',       description: 'Confirm SMDB locations on floor plans from Basement to Roof; cross-check with schematic',                   requiresConfirmation: false, phase: 'electrical', displayName: 'SMDBs located on plans',   activeLabel: 'Identifying SMDBs in floor drawings...' },
  { step: 9,  name: 'Establish Cable Route LV Panel to SMDBs', description: 'Look at riser drawing or riser annotations; note probable route (e.g. riser shaft B, west core)',           requiresConfirmation: false, phase: 'electrical', displayName: 'Cable routes established', activeLabel: 'Establishing cable routes LV panel → SMDBs...' },
  { step: 10, name: 'Estimate Cable Lengths and Sizes LV to SMDB', description: 'Note cable size (mm²), estimated length (m), confidence: high=riser dim / medium=scaled / low=assumed', requiresConfirmation: false, phase: 'electrical', displayName: 'LV→SMDB lengths estimated', activeLabel: 'Estimating cable lengths and sizes LV panel → all SMDBs...' },
  { step: 11, name: 'Establish SMDB to DB Identification',    description: 'From schematic: list every DB fed from each SMDB — DB tag, rating (A), cable size',                          requiresConfirmation: false, phase: 'electrical', displayName: 'SMDB→DB cables identified', activeLabel: 'Establishing SMDB → DB identification and cable size...' },
  { step: 12, name: 'Identify DB Locations per SMDB',         description: 'From floor plans: confirm DB locations for each SMDB floor by floor',                                         requiresConfirmation: false, phase: 'electrical', displayName: 'DB locations confirmed',   activeLabel: 'Identifying DB locations per SMDB...' },
  { step: 13, name: 'Estimate Cable Size and Length per DB',  description: 'Length from scaled floor plan; confidence flagged per run',                                                    requiresConfirmation: false, phase: 'electrical', displayName: 'SMDB→DB lengths estimated', activeLabel: 'Estimating cable size and length for each DB...' },
  { step: 14, name: 'Prepare Cable Schedule',                  description: 'Gate: compile every cable entry — unit identification, size (mm²), length (m). Approve to generate Power BOQ PDF', requiresConfirmation: true,  phase: 'electrical', displayName: 'Cable schedule ready',     activeLabel: 'Awaiting cable schedule review...' },
];

// Default margin percentage
export const DEFAULT_MARGIN_PERCENT = Number(process.env.DEFAULT_MARGIN_PERCENT) || 15;

// Total pipeline steps — single source of truth so UI never hardcodes "23"
export const TOTAL_PIPELINE_STEPS = PIPELINE_STEPS.length;

// Benchmark reference text — updated quarterly
export const BENCHMARK_REFERENCE = 'ERP Realsoft internal MEP benchmarks, Dubai/UAE Q1 2025';

// Service bar colors for the MEP services table share column
export const SERVICE_BAR_COLORS: Record<string, string> = {
  hvac: 'bg-blue-500', electrical: 'bg-amber-500', plumbing: 'bg-cyan-500',
  fire_fighting: 'bg-red-500', fire_alarm: 'bg-orange-500', bms: 'bg-purple-500',
  lpg: 'bg-emerald-500', drainage: 'bg-teal-500',
};

// Gate-specific success messages after approval
export const GATE_SUCCESS_MESSAGES: Record<number, string> = {
  12: 'Cable schedule approved — generating Power BOQ PDF',
};

// Gate-specific loading text shown during processing
export const GATE_LOADING_TEXT: Record<number, string> = {
  12: 'Generating Power BOQ PDF…',
};

// Gate questions — single gate in the 14-step electrical pipeline.
export type GateQuestion = {
  kind: 'binary';
  question: string;
  yesLabel: string;
  noLabel: string;
};

/**
 * @deprecated Use {@link MAIN_GATE_QUESTIONS} keyed on the 5 MAIN gates
 * (9, 10, 12, 14, 15). The single electrical sub-gate (cable schedule review)
 * is MAIN gate 12 on the Detailed path. Kept as a back-compat alias for old readers.
 */
export const GATE_QUESTIONS: Record<number, GateQuestion> = {
  12: {
    kind: 'binary',
    question: 'Cable schedule is prepared. Review the extracted MDB → SMDB → DB cable runs and confirm all entries look correct. Approve to generate the Power BOQ PDF.',
    yesLabel: 'Approve — Generate Power BOQ',
    noLabel: 'Revise',
  },
};

/**
 * @deprecated Use {@link MAIN_GATE_STEPS} for the 5-gate MAIN workflow.
 * `[12]` here is the electrical SUB gate set (= MAIN Gate 3 on the detailed path),
 * also exposed via {@link SUB_GATE_STEPS}.electrical.
 */
export const GATE_STEPS = [12] as const;

// Building type icons
export const BUILDING_ICONS: Record<string, string> = {
  office: '🏢', residential: '🏠', villa: '🏡', hotel: '🏨', retail: '🏪',
  warehouse: '🏭', hospital: '🏥', restaurant: '🍽️',
};

// Building type labels
export const BUILDING_TYPE_LABELS: Record<string, string> = {
  office: 'Office', residential: 'Residential', villa: 'Villa', hotel: 'Hotel',
  retail: 'Retail', warehouse: 'Warehouse', hospital: 'Hospital', restaurant: 'Restaurant',
};

// Reputation class display
export const REPUTATION_META: Record<string, { label: string; shortLabel: string; color: string; bgColor: string }> = {
  tier_a:  { label: 'Tier A — Major',    shortLabel: 'Tier A', color: 'text-green-700',  bgColor: 'bg-green-50' },
  tier_b:  { label: 'Tier B — Standard', shortLabel: 'Tier B', color: 'text-blue-700',   bgColor: 'bg-blue-50' },
  tier_c:  { label: 'Tier C — Small',    shortLabel: 'Tier C', color: 'text-gray-700',   bgColor: 'bg-gray-100' },
  unknown: { label: 'Unclassified',      shortLabel: 'Unknown', color: 'text-gray-500',   bgColor: 'bg-gray-50' },
};

/**
 * @deprecated Use {@link MAIN_STATUS_TO_STEP} for the 15-step MAIN workflow,
 * combined with {@link getCurrentStep} which resolves a status into
 * `{pipeline, step}` so UI can render the right level. Kept as a back-compat
 * alias — every status here also lives in the legacy electrical-only mapping.
 */
export const STATUS_TO_STEP: Record<string, number> = {
  new:             1,   // project created, analysis not yet started
  classified:      1,
  extracting:      1,
  extracted:       1,
  estimating:      1,   // 14-step electrical procedure running
  pricing_pending: 14,  // Gate — cable schedule ready for review
  boq_ready:       14,  // Power BOQ PDF generated
  sent:            14,
  won:             14,
  lost:            14,
  declined:        14,
  archived:        14,
};

// ============================================================================
// MAIN + SUB pipeline architecture (PR1 — additive; readers migrate in PR4).
// ============================================================================
// Today's `PIPELINE_STEPS` IS the electrical 14-step procedure. The plan
// (jaunty-bouncing-kay.md) restructures so the canonical pipeline becomes
// the 15-step email-to-quotation MAIN flow, with electrical-14 as a named
// SUB-pipeline triggered when the user picks "Detailed pricing" at Gate 2.
//
// PR1 introduces the new constants without touching the old ones. Existing
// UI code keeps reading `PIPELINE_STEPS`, `GATE_QUESTIONS`, `GATE_STEPS`,
// `STATUS_TO_STEP` and behaves identically. PR4 swaps the readers.

export type PipelineId = 'main' | SubPipelineId;
export type SubPipelineId = 'electrical';

// Electrical SUB-pipeline = today's PIPELINE_STEPS, kept verbatim.
export const ELECTRICAL_SUB_PIPELINE: PipelineStep[] = PIPELINE_STEPS;

export const SUB_PIPELINES: Record<SubPipelineId, PipelineStep[]> = {
  electrical: ELECTRICAL_SUB_PIPELINE,
};

// MAIN pipeline — 15 steps, email arrival to quotation sent.
// Per CLAUDE.md "5 confirmation gates ... never collapse":
// Gate 1 (step 9)  — Documents Sufficient
// Gate 2 (step 10) — Bid Decision (no_bid / quick / detailed)
// Gate 3 (step 12) — Confirm Quantities (= electrical Gate 14 on detailed path)
// Gate 4 (step 14) — Confirm Total
// Gate 5 (step 15) — Consent Received → send quotation
export const MAIN_PIPELINE_STEPS: PipelineStep[] = [
  { step: 1,  name: 'Read Email',                       description: 'Poll inbox; pick emails addressed to estimation@realsoft.example that are new RFQs',                                requiresConfirmation: false, phase: 'info_sufficiency', displayName: 'Email read',              activeLabel: 'Polling inbox for new RFQs...' },
  { step: 2,  name: 'Register New Enquiry',              description: 'Create sabi_projects row with project name and source of enquiry',                                       requiresConfirmation: false, phase: 'info_sufficiency', displayName: 'Enquiry registered',      activeLabel: 'Registering new enquiry...' },
  { step: 3,  name: 'Open Tender Folder',                description: 'Create the S3 prefix that will hold this tender’s attachments and outputs',                          requiresConfirmation: false, phase: 'info_sufficiency', displayName: 'Folder opened',           activeLabel: 'Opening tender folder...' },
  { step: 4,  name: 'Unload Attachments',                description: 'Save attachments to the tender folder; if no attachment, notify estimation department',                  requiresConfirmation: false, phase: 'info_sufficiency', displayName: 'Attachments unloaded',    activeLabel: 'Unloading attachments...' },
  { step: 5,  name: 'Extract Attachment Archive',        description: 'Unzip / unrar archives, parse PDFs, extract embedded files',                                              requiresConfirmation: false, phase: 'info_sufficiency', displayName: 'Archive extracted',       activeLabel: 'Extracting attachment archive...' },
  { step: 6,  name: 'List Available Documents',          description: 'Inventory every parsed document with type tag (drawing / spec / schedule / etc.)',                       requiresConfirmation: false, phase: 'info_sufficiency', displayName: 'Documents listed',        activeLabel: 'Listing available documents...' },
  { step: 7,  name: 'List Drawings',                     description: 'Discipline-tag every drawing (electrical / hvac / plumbing / fire); locate the drawings folder',          requiresConfirmation: false, phase: 'info_sufficiency', displayName: 'Drawings listed',         activeLabel: 'Listing and tagging drawings...' },
  { step: 8,  name: 'Extract Building + Reputation',     description: 'Extract floors, area per floor, building type, floor height; assign reputation tier to source of enquiry', requiresConfirmation: false, phase: 'info_sufficiency', displayName: 'Building + reputation extracted', activeLabel: 'Extracting building details and reputation tier...' },
  { step: 9,  name: 'Documents Sufficient',              description: 'Gate 1: present building details + reputation; ask whether we have enough drawings/specs to estimate',     requiresConfirmation: true,  phase: 'info_sufficiency', displayName: 'Documents sufficient',    activeLabel: 'Awaiting documents-sufficient decision...' },
  { step: 10, name: 'Bid Decision',                      description: 'Gate 2: choose No-Bid / Fast price / Detailed pricing',                                                    requiresConfirmation: true,  phase: 'bid_decision',     displayName: 'Bid decision made',       activeLabel: 'Awaiting bid decision (No-Bid / Fast / Detailed)...' },
  { step: 11, name: 'Run Pricing',                       description: 'Run the 14-step electrical sub-pipeline for detailed take-off',                                              requiresConfirmation: false, phase: 'quantities',       displayName: 'Pricing complete',        activeLabel: 'Running pricing...' },
  { step: 12, name: 'Confirm Quantities',                description: 'Gate 3: review take-off quantities (cable schedule for detailed; per-sqft/tonnage for fast)',             requiresConfirmation: true,  phase: 'quantities',       displayName: 'Quantities confirmed',    activeLabel: 'Awaiting quantities confirmation...' },
  { step: 13, name: 'Prepare Yardstick Ratios',          description: 'Compare estimate against market benchmark rates by building type and discipline',                          requiresConfirmation: false, phase: 'final_quote',      displayName: 'Yardstick ready',         activeLabel: 'Preparing yardstick ratios...' },
  { step: 14, name: 'Confirm Total',                     description: 'Gate 4: review total AED with yardstick comparison; approve or send back for revision',                   requiresConfirmation: true,  phase: 'final_quote',      displayName: 'Total confirmed',         activeLabel: 'Awaiting total confirmation...' },
  { step: 15, name: 'Consent Received & Send',           description: 'Gate 5: final consent to send the quotation; on approval, dispatch by email to the source of enquiry',    requiresConfirmation: true,  phase: 'final_quote',      displayName: 'Quotation sent',          activeLabel: 'Awaiting consent to send quotation...' },
];

// Phase grouping for the MAIN pipeline (matches transcript-aligned plan).
export const MAIN_PIPELINE_PHASES: PhaseInfo[] = [
  { id: 'info_sufficiency', label: 'Information Sufficiency', stepRange: [1, 9] },
  { id: 'bid_decision',     label: 'Bid Decision',             stepRange: [10, 10] },
  { id: 'quantities',       label: 'Quantities',               stepRange: [11, 12] },
  { id: 'final_quote',      label: 'Final Quote',              stepRange: [13, 15] },
];

export const MAIN_TOTAL_STEPS = MAIN_PIPELINE_STEPS.length;

// Two-level gate maps. Existing `GATE_STEPS` / `GATE_QUESTIONS` describe the
// electrical sub-pipeline's single gate (Cable Schedule Review at step 14)
// and remain the back-compat alias for old readers.
export const MAIN_GATE_STEPS = [9, 10, 12, 14, 15] as const;

export const SUB_GATE_STEPS: Record<SubPipelineId, readonly number[]> = {
  electrical: [12], // MAIN Gate 3 (step 12) on the detailed path
};

// Gate 10 (Bid Decision) is 3-way and rendered by the existing bid-decision
// widget, not the binary GateQuestion card. Only the binary gates appear here.
export const MAIN_GATE_QUESTIONS: Record<number, GateQuestion> = {
  9: {
    kind: 'binary',
    question: 'We have classified the documents and the building. Are the drawings and specifications sufficient to prepare an estimate? Approve to proceed to the Bid Decision.',
    yesLabel: 'Documents sufficient — proceed',
    noLabel: 'Hold — request more documents',
  },
  12: {
    kind: 'binary',
    question: 'Take-off quantities are ready. For detailed runs, this is the cable schedule (MDB → SMDB → DB). For fast runs, this is the per-sqft / per-tonnage breakdown. Approve to proceed to yardstick comparison.',
    yesLabel: 'Quantities OK — run yardstick',
    noLabel: 'Revise quantities',
  },
  14: {
    kind: 'binary',
    question: 'Quotation total has been calculated and compared against the yardstick range. Approve to proceed to the consent gate before sending.',
    yesLabel: 'Total OK — request consent',
    noLabel: 'Send back for re-pricing',
  },
  15: {
    kind: 'binary',
    question: 'Final consent: send the quotation to the source of enquiry. The PDF + email body have been prepared and are ready to dispatch.',
    yesLabel: 'Consent — send quotation',
    noLabel: 'Hold — do not send',
  },
};

// Status → step map for the MAIN pipeline. PR2 introduces routes that write
// these statuses; until then they're inert. Sub-pipeline statuses are
// resolved by `getCurrentStep` below, not by this map.
export const MAIN_STATUS_TO_STEP: Record<string, number> = {
  new:                       1,
  classified:                1,
  email_read:                1,
  enquiry_registered:        2,
  folder_opened:             3,
  attachment_unloaded:       4,
  awaiting_attachment:       4,   // notification sent to estimation
  extracting:                5,
  extracted:                 6,
  documents_listed:          6,
  drawings_listed:           7,
  building_extracted:        8,
  docs_sufficient_pending:   9,   // Gate 1
  awaiting_documents:        9,   // Gate 1 rejected — terminal hold
  bid_decision_pending:      10,  // Gate 2
  estimating:                11,  // detailed → delegates to electrical sub
  revise_quantities:         12,  // Gate 3 rollback
  boq_generating:            12,  // Gate 3 — PDF rendering in progress
  boq_ready:                 13,  // BOQ PDF stored; yardstick runs before Gate 4
  yardstick_ready:           13,
  yardstick_checked:         13,  // set by yardstick-orchestrator after comparison runs
  confirm_total_pending:     14,  // Gate 4
  revise_pricing:            14,  // Gate 4 rollback
  consent_pending:           15,  // Gate 5
  quote_held:                15,  // Gate 5 rollback
  sending:                   15,
  sent:                      15,
  won:                       15,
  lost:                      15,
  declined:                  15,
  archived:                  15,
};

// Statuses that belong to the electrical SUB-pipeline (live inside main step 11).
// boq_ready is NOT included: once the PDF is stored the project is back in the
// MAIN pipeline at step 13 (yardstick / Gate 4 Confirm Total).
const ELECTRICAL_SUB_STATUSES = new Set(['pricing_pending', 'boq_generating']);

/**
 * Resolve a project's current pipeline + step from its status.
 *
 * Returns `{ pipeline: 'electrical', step: 14 }` for projects mid-cable-schedule
 * (these live under MAIN step 11). All other statuses resolve in the MAIN
 * pipeline.
 */
export function getCurrentStep(status: string | null | undefined): { pipeline: PipelineId; step: number } {
  if (!status) return { pipeline: 'main', step: 1 };
  if (ELECTRICAL_SUB_STATUSES.has(status)) {
    return { pipeline: 'electrical', step: 14 };
  }
  const mainStep = MAIN_STATUS_TO_STEP[status];
  if (mainStep != null) return { pipeline: 'main', step: mainStep };
  // Legacy fallback — anything not in the new map falls back to the old
  // electrical-pipeline mapping so old code keeps working.
  return { pipeline: 'main', step: STATUS_TO_STEP[status] ?? 1 };
}
