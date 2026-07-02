/**
 * Corrections logger — single helper for every "human overrode the AI" event.
 *
 * Writes to `sabi_corrections` so the heuristic layer can later mine real
 * override data ("AI under-estimated office cable length by 18 % on average,
 * adjust the formula"). Treats DB write failure as non-fatal — overrides MUST
 * succeed even if the audit table is offline.
 */
import { supabaseAdmin } from '@/lib/storage/supabase';

export interface CorrectionRecord {
  projectId: string;
  fieldPath: string;
  aiValue: unknown;
  humanValue: unknown;
  aiProvider?: string | null;
  procedureVersion?: string | null;
  metadata?: Record<string, unknown>;
  createdBy?: string | null;
}

export async function logCorrection(rec: CorrectionRecord): Promise<void> {
  try {
    await supabaseAdmin.from('sabi_corrections').insert({
      project_id: rec.projectId,
      field_path: rec.fieldPath,
      ai_value: rec.aiValue ?? null,
      human_value: rec.humanValue,
      ai_provider: rec.aiProvider ?? null,
      procedure_version: rec.procedureVersion ?? null,
      metadata: rec.metadata ?? {},
      created_by: rec.createdBy ?? null,
    });
  } catch (err) {
    console.warn('[corrections] insert failed:', (err as Error).message);
  }
}
