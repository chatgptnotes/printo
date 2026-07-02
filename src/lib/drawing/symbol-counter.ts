/**
 * Count repeating electrical symbols on a floor plan via template matching.
 *
 * Replaces sub-step 12 (DB locations per SMDB) and outlet counts in
 * `analyzeElectricalDrawing` (Sonnet vision) for the common case of standard
 * legend glyphs (DB box, single 13A, twin 13A, water heater outlet, FCU spur,
 * floor box).
 *
 * Gated by env flag `SYMBOL_TEMPLATE_MATCH=on`. When off, returns
 * `{ count: null, confidence: 0 }` so the caller falls back to Sonnet —
 * exactly today's behaviour.
 *
 * Today this module is a skeleton: it accepts a glyph + page image, exposes
 * a stable interface, and returns "fallback to Sonnet" until OpenCV (or a
 * pure-JS template-match) is wired in. The point of shipping the skeleton now
 * is so call sites can be updated once and the implementation can land
 * without a second touch on `analyzeElectricalProcedure`.
 */

export interface SymbolCountInput {
  /** Rendered page as a raw image buffer (PNG / JPEG bytes). */
  pageImage: Buffer;
  /** Legend glyph as a raw image buffer. */
  glyph: Buffer;
  /** Optional human label for telemetry, e.g. "single_13a". */
  label?: string;
  /** Match score threshold (0..1). Lower = more matches but more false positives. */
  minScore?: number;
}

export interface SymbolCountResult {
  count: number | null;
  confidence: number;       // 0..1; 0 means "use Sonnet fallback"
  matched: number;
  source: 'opencv' | 'fallback';
  reason: string;
}

function isOn(): boolean {
  const v = process.env.SYMBOL_TEMPLATE_MATCH;
  return v === '1' || v === 'true' || v === 'on';
}

export async function countSymbols(input: SymbolCountInput): Promise<SymbolCountResult> {
  if (!isOn()) {
    return {
      count: null, confidence: 0, matched: 0, source: 'fallback',
      reason: 'SYMBOL_TEMPLATE_MATCH flag off — fallback to Sonnet symbol count',
    };
  }

  // Validate inputs cheaply so misconfiguration surfaces clearly without a
  // confusing OpenCV stack trace.
  if (!input.pageImage?.length || !input.glyph?.length) {
    return {
      count: null, confidence: 0, matched: 0, source: 'fallback',
      reason: 'pageImage or glyph empty — fallback to Sonnet',
    };
  }

  // Real implementation lands when @techstark/opencv-js is wired in
  // (Phase 4 day 4.1). The skeleton intentionally returns a fallback so the
  // wiring in claude-api.ts can be merged independently of the CV work.
  return {
    count: null, confidence: 0, matched: 0, source: 'fallback',
    reason: 'template-matching backend not yet implemented — fallback to Sonnet',
  };
}
