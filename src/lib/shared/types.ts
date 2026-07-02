// SABI RFQ Pipeline Type Definitions

export type ProjectPriority = 'priority_top' | 'priority_gen' | 'new' | 'ignore';

export type ProjectStatus =
  | 'new'
  | 'classified'
  | 'project_info_pending'
  | 'extracting'
  | 'extracted'
  | 'scope_pending'
  | 'quote_decision'
  | 'fast_pricing'
  | 'detailed_decision'
  | 'services_identified'
  | 'bid_decision_pending'        // MAIN Gate 2 (3-way bid decision)
  | 'estimating'
  | 'estimated'
  | 'pricing_pending'             // electrical sub: cable schedule ready (= MAIN Gate 3 on detailed path)
  | 'total_pending'
  | 'consent_pending'             // MAIN Gate 5
  | 'yardstick_checked'
  | 'quotation_ready'
  | 'findings_presented'
  | 'send_pending'
  | 'sent'
  | 'won'
  | 'lost'
  | 'declined'
  | 'archived'
  // --- MAIN pipeline additions (PR1, jaunty-bouncing-kay.md) ---
  // Inert until PR2 wires routes that emit them; existing rows unaffected.
  | 'email_read'
  | 'enquiry_registered'
  | 'folder_opened'
  | 'attachment_unloaded'
  | 'awaiting_attachment'         // MAIN step 4 — notification sent to estimation
  | 'documents_listed'
  | 'drawings_listed'
  | 'building_extracted'
  | 'docs_sufficient_pending'     // MAIN Gate 1
  | 'awaiting_documents'          // MAIN Gate 1 rejected — terminal hold
  | 'yardstick_ready'
  | 'confirm_total_pending'       // MAIN Gate 4
  | 'revise_pricing'              // MAIN Gate 4 rollback
  | 'quote_held'                  // MAIN Gate 5 rollback
  | 'sending'                     // MAIN step 15, briefly between Gate 5 approve and 'sent'
  // --- Electrical SUB-pipeline statuses (live inside MAIN step 11/12) ---
  | 'boq_generating'              // electrical Gate 14 approved, PDF rendering
  | 'boq_ready';                  // electrical Gate 14 done, PDF stored

// Bid decision (Gate 2 / step 10). 2-way: No-Bid (terminal) or Detailed
// (full take-off pipeline). The legacy 'quick' (rate × sqft) path was
// removed in favor of the INSTANT BOQ auto-approve lane.
export type BidDecision = 'no_bid' | 'detailed';

// Critical-drawings status (step 8) — present, missing, or fallback used (e.g.
// equipment schedule used in place of thermal load).
export type CriticalDrawingsStatus = 'present' | 'missing' | 'fallback_used';

// BOQ quality (step 9) — usability of any client-provided BOQ.
export type BoqQuality = 'reliable' | 'partial' | 'unusable';

// Confidence tag (step 22) — for individual quantity rows.
export type ConfidenceTag = 'high' | 'medium' | 'low';

// Source tag for line-item pricing (step 26).
export type PricingSource = 'library' | 'ai_estimate' | 'manual';

// Scale-detection metadata (step 10).
export interface ScaleDetection {
  detected_px_per_m: number | null;
  confidence: number | null;       // 0..1
  source: 'dimension_arrow' | 'scale_bar' | 'grid' | 'area_cross_check' | 'manual' | null;
}

export type ServiceType =
  | 'hvac'
  | 'electrical'
  | 'plumbing'
  | 'fire_fighting'
  | 'fire_alarm'
  | 'bms'
  | 'lpg'
  | 'drainage';

export type FileType =
  | 'drawing_autocad'
  | 'drawing_pdf'
  | 'schedule_excel'
  | 'specification'
  | 'archive_zip'
  | 'image'
  | 'other';

export type Discipline = ServiceType; // discipline matches service types: hvac, electrical, plumbing, etc.

export type ReputationClass = 'tier_a' | 'tier_b' | 'tier_c' | 'unknown';

export type ActivityStatus = 'started' | 'completed' | 'failed' | 'skipped';

export type YardstickStatus = 'within_range' | 'below_market' | 'above_market';

// --- Email Sync Types ---

export interface Email {
  id: string;
  gmail_message_id: string;
  thread_id: string;
  from_address: string;
  to_address: string | null;
  cc_address: string | null;
  subject: string;
  date: string | null;
  snippet: string | null;
  body_html: string | null;
  body_text: string | null;
  labels: string[];
  has_attachments: boolean;
  synced_at: string;
  created_at: string;
}

export interface EmailAttachment {
  id: string;
  email_id: string;
  gmail_attachment_id: string;
  gmail_message_id: string;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  storage_path: string | null;
  sync_error: string | null;
  created_at: string;
}

export interface GmailSyncState {
  last_history_id: string | null;
  last_sync_at: string | null;
  backfill_complete: boolean;
}

export interface Project {
  id: string;
  email_thread_id: string | null;
  email_message_id: string | null;
  email_from: string;
  email_subject: string;
  email_date: string | null;
  email_snippet: string | null;
  client_name: string | null;
  project_name: string | null;
  location: string | null;
  priority: ProjectPriority;
  status: ProjectStatus;
  floors: number | null;
  parking_floors: number | null;
  typical_floors: number | null;
  area_per_floor_sqft: number | null;
  total_area_sqft: number | null;
  typical_height_m: number | null;
  building_type: string | null;
  deadline: string | null;
  reputation_class: ReputationClass | null;
  notes: string | null;
  ai_classification: Record<string, unknown> | null;
  ai_extraction: Record<string, unknown> | null;
  final_quote_aed: number | null;
  // 33-step pipeline additions (sabi-revised-pipeline-plan.md §"DB schema additions").
  // All optional in the type so existing rows missing the column don't break reads.
  critical_drawings_status?: CriticalDrawingsStatus | null;
  boq_quality?: BoqQuality | null;
  scale_detection?: ScaleDetection | null;
  bid_decision?: BidDecision | null;          // replaces overloaded priority='ignore' for No-Bid
  consultant?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Attachment {
  id: string;
  project_id: string;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  attachment_id: string | null;
  message_id: string | null;
  file_type: FileType | null;
  discipline: Discipline | null;
  extracted_data: Record<string, unknown> | null;
  storage_path: string | null;
  created_at: string;
}

export interface Service {
  id: string;
  project_id: string;
  service_type: ServiceType;
  is_required: boolean;
  system_type: string | null;
  total_kw: number | null;
  fahu_kw: number | null;
  ac_unit_kw: number | null;
  tonnage: number | null;
  unit_rate_aed: number | null;
  quantity: number | null;
  total_aed: number | null;
  notes: string | null;
  ai_extraction: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

// HVAC Sub-System — for multi-system projects (VRF + DX + FAHU in one building)
export interface HVACSubSystem {
  id: string;
  label: string;                    // "VRF (Typical Floors)", "DX Split (Villas)"
  system_code: string;              // 'vrf', 'split', 'chiller', 'package', 'district_cooling'
  system_type: string;              // "VRF System", "DX Split Unit"
  zones: string[];                  // ["Typical 1F-5F", "Mezzanine"]
  total_kw: number;
  fahu_kw: number;
  ac_unit_kw: number;
  tonnage: number;
  unit_rate_aed: number;
  ac_price: number;
  fahu_price: number;
  total_aed: number;
  indoor_units: { ducted: number; decorative: number };
  fahu_count: number;
  fahu_cfm: number;
  line_items: Array<{
    key: string;
    description: string;
    quantity: number;
    unit: string;
    unit_rate_aed: number;
    total_aed: number;
    category: string;
  }>;
}

// Floor-level breakdown of HVAC loads
export interface FloorBreakdown {
  floor_label: string;              // "Basement 1", "Ground", "Mezzanine", "1st Floor", "Roof"
  floor_code: string;               // "B1", "GF", "MZ", "1F", "RF"
  zone_count: number;
  ducted_count: number;
  decorative_count: number;
  total_kw: number;
  system_refs: string[];            // ["VRF", "DX"]
}

// Equipment schedule item — parsed from drawings
export interface EquipmentScheduleItem {
  tag: string;                      // "ODU-01", "FCU-GF-01"
  description: string;              // "VRF Outdoor Unit 22HP"
  model: string | null;             // "Daikin RXYQ22TATL"
  capacity_kw: number;
  capacity_tr: number | null;
  quantity: number;
  location: string | null;          // "Roof", "Ground Floor"
  type: 'outdoor' | 'indoor_ducted' | 'indoor_decorative' | 'fahu' | 'ahu' | 'exhaust' | 'pump' | 'other';
}

export interface Estimation {
  id: string;
  project_id: string;
  total_aed: number | null;
  cost_per_sqft_aed: number | null;
  yardstick_min_aed: number | null;
  yardstick_max_aed: number | null;
  yardstick_status: YardstickStatus | null;
  // Service types where placeholder rates were used during yardstick comparison
  // (real rates were AED 0 / null). Surfaced as a warning on the Gate 5 card.
  yardstick_placeholders?: string[] | null;
  margin_percent: number;
  final_quote_aed: number | null;
  george_approved: boolean;
  approved_at: string | null;
  generated_boq_url: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ActivityLog {
  id: string;
  project_id: string;
  step: number;
  step_name: string;
  status: ActivityStatus;
  details: Record<string, unknown> | null;
  /**
   * Discriminator for main vs sub-pipeline rows. NULL = MAIN pipeline row.
   * Non-null values name the sub-pipeline (e.g. 'electrical' for the
   * 14-step cable-schedule procedure that runs inside MAIN step 11).
   * Added in migration 006_main_subpipeline.sql.
   */
  sub_pipeline?: string | null;
  created_at: string;
}

// No-Bid audit row — populated by /api/projects/[id]/bid-decision when
// decision === 'no_bid'. Replaces the old approach of stuffing
// no_bid_reason inside ai_classification.
export interface NoBidLog {
  id: string;
  project_id: string;
  reason_code: string;            // free-form short tag (e.g. 'budget_mismatch', 'tight_timeline')
  reason_text: string;            // operator-supplied explanation
  decided_by: string;
  decided_at: string;
  source: 'human' | 'auto_escalation';   // auto_escalation = 7-day no-response cron
}

export interface YardstickRate {
  id: string;
  building_type: string;
  service_type: string;
  min_aed_per_sqft: number;
  max_aed_per_sqft: number;
  notes: string | null;
  updated_at: string;
}

// Extended project with related data
export interface ProjectDetail extends Project {
  attachments: Attachment[];
  services: Service[];
  estimation: Estimation | null;
  activity_log: ActivityLog[];
}

// Pipeline phase grouping — transcript-aligned plan (sabi-revised-pipeline-plan.md).
// Phase 0 is pre-pipeline (auto-filter at inbox; ejects spam / non-MEP /
// duplicate before a project row exists).
//   0. Pre-pipeline             — Claude classifier at inbox
//   1. Information Sufficiency  — identify email, inventory docs, critical/BOQ/scale checks → Gate 1
//   2. Bid / No-Bid             — customer + reputation match → Gate 2 (3-way)
//   3. Extract Quantities       — drawings → counts → measurements with confidence flags → Gate 3
//   4. Final Quote              — library + AI-fallback pricing, margin, BOQ → Gates 4 + 5
export type PipelinePhase = 'pre_pipeline' | 'info_sufficiency' | 'bid_decision' | 'quantities' | 'final_quote' | 'electrical';

// Pipeline step definition
export interface PipelineStep {
  step: number;
  name: string;
  description: string;
  requiresConfirmation: boolean;
  phase: PipelinePhase;
  // Client-friendly label shown in the animated timeline (demo / BT audience).
  // Falls back to `name` when absent.
  displayName?: string;
  // Present-continuous form shown while this step is in progress
  // ("Reading thermal load summary drawing..."). Falls back to `description`.
  activeLabel?: string;
}

// Phase metadata
export interface PhaseInfo {
  id: PipelinePhase;
  label: string;
  stepRange: [number, number]; // inclusive
}
