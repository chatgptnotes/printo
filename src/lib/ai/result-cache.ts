/**
 * Content-hash cache for electrical drawing analysis.
 *
 * The 14-step electrical procedure costs $0.30–1.00 in Claude tokens per run.
 * When the same drawings are submitted again (re-upload, demo replay, another
 * project that received the same PDFs), we skip the Claude call entirely.
 *
 * Cache key is sha256 of:
 *   - sorted file contents (filename + raw bytes)
 *   - the DXF/text-extracted context string
 *   - the model identifier
 *   - the procedure version (bump to invalidate after prompt changes)
 *   - building metadata (floors, area_sqft, building_type) — same drawings
 *     applied to a different building yield a different result, so this MUST
 *     be in the key.
 *
 * Storage table: sabi_drawing_analysis_cache (migration 20260504).
 */

import { createHash } from 'node:crypto';
import { supabaseAdmin } from '@/lib/storage/supabase';
import type { AttachmentFile } from '@/lib/ai/ai-provider';

// Bump when the electrical procedure prompt or output schema changes — forces
// a global cache miss so old results aren't silently reused.
// v2 (2026-06-22): no-assumption / extract-first prompt rewrite + lighting/
// provisional schema + scan-validation gate + gap-fill retry.
// v3 (2026-06-22): below-ground-levels directive (read basement/underground
// sheets — EV SMDB, pump-room EDB/DB, EV chargers, pumps, exhaust fans).
// v4 (2026-06-23): per-floor completeness rule — every floor_labels level must
// have a per-floor take-off; validator flags empty floors + targeted floor re-read.
// v5 (2026-06-23): source-side + mechanical completeness — Sections 2 (incoming
// supply: transformers/generator/ATS), 3 (LV panels + capacitor banks) and 6
// (mechanical equipment feeders) promoted to MANDATORY non-empty; gap-fill re-read
// now fires on any missing fillable section (warning-severity ones included).
export const PROCEDURE_VERSION = 'electrical-v5';

export interface CacheKeyInputs {
  files: AttachmentFile[];
  text: string;
  model: string;
  metadata: {
    floors?: number | null;
    area_sqft?: number | null;
    building_type?: string | null;
  };
}

export function computeCacheKey(inputs: CacheKeyInputs): string {
  const hash = createHash('sha256');
  // Deterministic file order
  const sorted = [...inputs.files].sort((a, b) => a.filename.localeCompare(b.filename));
  for (const f of sorted) {
    hash.update(f.filename);
    hash.update(f.buffer);
  }
  hash.update('|TEXT|');
  hash.update(inputs.text || '');
  hash.update('|MODEL|');
  hash.update(inputs.model);
  hash.update('|VER|');
  hash.update(PROCEDURE_VERSION);
  hash.update('|META|');
  hash.update(JSON.stringify({
    floors: inputs.metadata.floors ?? null,
    area_sqft: inputs.metadata.area_sqft ?? null,
    building_type: inputs.metadata.building_type ?? null,
  }));
  return hash.digest('hex');
}

export async function getCachedResult<T>(cacheKey: string): Promise<T | null> {
  const { data, error } = await supabaseAdmin
    .from('sabi_drawing_analysis_cache')
    .select('result')
    .eq('cache_key', cacheKey)
    .maybeSingle();
  if (error || !data) return null;

  // Atomic hit-counter bump (RPC function in the migration). Fire-and-forget.
  void supabaseAdmin.rpc('bump_drawing_cache_hit', { p_cache_key: cacheKey });

  return data.result as T;
}

export async function storeCachedResult<T>(
  cacheKey: string,
  model: string,
  inputSummary: Record<string, unknown>,
  result: T,
  estimatedCostUsd: number,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('sabi_drawing_analysis_cache')
    .upsert({
      cache_key: cacheKey,
      model,
      procedure_version: PROCEDURE_VERSION,
      input_summary: inputSummary,
      result: result as unknown as Record<string, unknown>,
      est_savings_usd: estimatedCostUsd, // initial cost; future hits save this much
    }, { onConflict: 'cache_key' });
  if (error) console.error('[result-cache] store failed:', error.message);
}

// Average per-call cost — used to report "savings" per cache hit. Not exact;
// real cost varies with file count and total bytes.
export function estimateCallCostUsd(_model: string, fileCount: number): number {
  // Claude Sonnet 4.6: rough average $0.50 per call with vision PDFs
  return 0.5 * Math.max(1, fileCount / 5);
}

// ---------------------------------------------------------------------------
// Generic content-hash cache for non-drawing AI calls (spec analysis,
// project-info extraction, OCR results). Reuses sabi_drawing_analysis_cache
// since the schema is generic — only the procedure_version differs.
// ---------------------------------------------------------------------------

/**
 * SHA-256 over an arbitrary set of buffers + JSON-able context. Sorted by
 * filename so input order doesn't change the key.
 */
export function computeGenericKey(
  procedureVersion: string,
  buffers: Array<{ name: string; data: Buffer }>,
  context: Record<string, unknown>,
): string {
  const hash = createHash('sha256');
  hash.update('|VER|');
  hash.update(procedureVersion);
  const sorted = [...buffers].sort((a, b) => a.name.localeCompare(b.name));
  for (const b of sorted) {
    hash.update('|FILE|');
    hash.update(b.name);
    hash.update(b.data);
  }
  hash.update('|CTX|');
  hash.update(JSON.stringify(context));
  return hash.digest('hex');
}

/**
 * Hash arbitrary text content. Useful for spec analysis where we already have
 * extracted text and don't want to re-hash the original PDF buffers.
 */
export function computeTextKey(procedureVersion: string, text: string, context: Record<string, unknown> = {}): string {
  const hash = createHash('sha256');
  hash.update('|VER|');
  hash.update(procedureVersion);
  hash.update('|TXT|');
  hash.update(normaliseForHash(text));
  hash.update('|CTX|');
  hash.update(JSON.stringify(context));
  return hash.digest('hex');
}

/**
 * Strip per-revision noise from a text blob before hashing so a re-stamped
 * drawing or re-issued spec package still hits cache when the *content*
 * hasn't changed. Removes:
 *   - Revision strings: "Rev A", "Rev 01", "REVISION 3"
 *   - Date stamps: "01/05/2026", "2026-05-01", "1 May 2026"
 *   - Page footers: "Page 3 of 12", "Sheet 2/8"
 *   - Printed-on / plotted timestamps: "Printed: 2026-05-01 14:32"
 *   - Excess whitespace
 */
export function normaliseForHash(text: string): string {
  if (!text) return '';
  return text
    .replace(/\brev(?:ision)?\s*[:\-]?\s*[A-Z0-9]{1,4}\b/gi, '')
    .replace(/\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b/g, '')
    .replace(/\b\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}\b/g, '')
    .replace(/\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{2,4}\b/gi, '')
    .replace(/\b(?:page|sheet)\s*\d+\s*(?:of|\/)\s*\d+\b/gi, '')
    .replace(/\b(?:printed|plotted|issued)\s*[:\-]?\s*[\d:\-\s\/T.]+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// `getCachedResult<T>` and `storeCachedResult<T>` above are already generic
// over T — re-export under simpler names for the new call sites.
export const getCached = getCachedResult;
export const storeCached = storeCachedResult;
