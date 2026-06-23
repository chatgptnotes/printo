// Shared types mirroring the FastAPI backend contract.

export type Verdict = "PASSED" | "WARNING" | "FAILED" | "TIMEOUT" | "ERROR";

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
}

export interface Extracted {
  [key: string]: unknown;
  confidence?: Record<string, number>;
  field_locations?: Record<string, number[]>;
  room_schedule?: Array<{ name?: string; area?: string } | string>;
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
