// Shared types mirroring the FastAPI backend contract.

export type Verdict = "PASSED" | "WARNING" | "FAILED" | "TIMEOUT" | "ERROR" | "GENERATED" | "LIMITED";

/** One Bill-of-Quantities line, grouped by trade `section`. */
export interface BoqItem {
  section: string | null;
  description: string | null;
  unit: string | null;
  quantity: string | null;
}

export type EventType = "info" | "success" | "warning" | "error" | "done";

export interface StreamEvent {
  type: EventType;
  line?: string;
  // present only on the final "done" event:
  verdict?: Verdict;
  elapsed?: number;
  errors?: string[];
  warnings?: string[];
  extracted?: Extracted;
  realsoft_payload?: RealsoftPayload;
  erp_status?: string;
  drawing_id?: number;
  prepass_count?: number;
  needs_review?: boolean;
  review_status?: ReviewStatus;
}

export interface Extracted {
  [key: string]: unknown;
  confidence?: Record<string, number>;
  field_locations?: Record<string, number[]>;
  room_schedule?: Array<{ name?: string; area?: string } | string>;
  boq_items?: BoqItem[];
}

export interface RealsoftPayload {
  module?: string;
  data?: Record<string, unknown>;
  metadata?: {
    low_confidence_fields?: string[];
    mapping_warnings?: string[];
    mapping_source?: string;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

export interface DonePayload {
  type: "done";
  verdict: Verdict;
  elapsed: number;
  errors: string[];
  warnings: string[];
  extracted: Extracted;
  realsoft_payload: RealsoftPayload;
  erp_status?: string;
  drawing_id: number;
  prepass_count?: number;
  needs_review?: boolean;
  review_status?: ReviewStatus;
}

// ── Human-in-the-loop verification ──────────────────────────────────────────
export type ReviewStatus = "pending_review" | "approved";

/** Payload for the BOQ review / approval screen (GET /drawings/:id/review). */
export interface ReviewData {
  drawing_id: number;
  file_name: string;
  status: string;
  review_status: ReviewStatus;
  approved_by: string | null;
  approved_at: string | null;
  verdict: Verdict | null;
  elapsed: number;
  extracted: Extracted;
  boq_items: BoqItem[];
  project_description?: string;
  summary_draft: string;
  summary_override: string | null;
  erp_payload: RealsoftPayload;
  thumbnail_uri: string | null;
  failure_reason?: string | null;
}

export interface ApproveResult {
  message: string;
  drawing_id: number;
  verdict: Verdict;
  erp_status: "sent" | "failed" | "simulated";
  erp_message: string;
  approved_by: string;
  approved_at: string;
}

export interface DrawingSummary {
  id: number;
  file_name: string;
  uploaded_at: string;
  status: "done" | "error" | "blurred" | "processing" | string;
  drawing_number: string | null;
  drawing_title: string | null;
  project_name: string | null;
  floor_category: string | null;
  failure_reason?: string | null;
}

export interface DrawingDetail {
  drawing: DrawingSummary & { file_path?: string };
  extractions: Array<{ field: string; value: unknown; confidence: number | null }>;
  erp_pushes: Array<{ method: string; status: string; pushed_at: string | null }>;
  corrections: Array<{
    field: string;
    original: string;
    corrected: string;
    by: string;
    at: string;
  }>;
}

export interface CurrentUser {
  username: string;
  role: string;
}

// ── RealSoft ERP integration ────────────────────────────────────────────────
export interface ErpStatus {
  configured: boolean;
  reachable: boolean;
  base_url: string;
  module: string;
  mode: "live" | "simulation";
}

export interface ErpPushResult {
  drawing_id: number;
  status: "sent" | "failed" | "simulated" | "skipped";
  status_code?: number;
  pushed_at?: string;
  message: string;
}

export interface ErpPushSummary {
  total: number;
  sent: number;
  failed: number;
  simulated: number;
  results: ErpPushResult[];
}

export interface ErpPushRecord {
  id: number;
  drawing_id: number;
  file_name: string | null;
  project_name: string | null;
  status: string;
  pushed_at: string | null;
  response_summary: string;
}

export interface Health {
  status: string;
  version: string;
  total_drawings: number;
  completed: number;
  erp_mode: string;
  ai_provider: string;
  ai_mode: string;
  ai_model: string;
}
