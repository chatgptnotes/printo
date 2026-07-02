/**
 * Measure a cable route's real-world length from a drawing page.
 *
 * Replaces the length GUESS in sub-steps 10 and 13 of
 * `analyzeElectricalProcedure` (Sonnet vision) — today the BOQ already prints
 * those rows with `confidence: 'low'` because Sonnet eyeballs pixel distance.
 * Real geometry — `pixels × scale = metres` — is deterministic and accurate.
 *
 * This module ships in two modes, gated by env flag `ELECTRICAL_GEOMETRY=on`:
 *
 *   Mode A · "polyline supplied"
 *     Caller already has the polyline (from DXF entities or future OpenCV
 *     detection or operator draw-on-image override). We just sum segment
 *     lengths and multiply by `m_per_px`. Deterministic, ±0 % math error.
 *
 *   Mode B · "polyline missing"
 *     We can't safely guess the route. Returns `metres: null, confidence: 0`
 *     so the caller falls back to Sonnet's existing length estimate (and the
 *     BOQ row keeps its today-style low-confidence flag).
 *
 * Future mode C — OpenCV polyline detection on rasterised PDF pages — slots in
 * here without changing the public API.
 */

export type Point = { x: number; y: number };

export interface MeasureInput {
  /** Polyline of route in PIXEL coordinates on the rendered page. */
  polylinePx: Point[] | null;
  /** Metres per pixel for the rendered page (from drawing-scale.ts). */
  mPerPx: number | null;
  /** Optional ratio_label like "1:100" — used purely for telemetry. */
  scaleLabel?: string | null;
  /** Optional source tag — 'dxf' | 'opencv' | 'manual' | 'unknown'. */
  source?: 'dxf' | 'opencv' | 'manual' | 'unknown';
}

export interface MeasureResult {
  metres: number | null;
  confidence: number;       // 0..1
  segmentCount: number;
  source: NonNullable<MeasureInput['source']>;
  reason: string;
}

function isOn(): boolean {
  const v = process.env.ELECTRICAL_GEOMETRY;
  return v === '1' || v === 'true' || v === 'on';
}

function pixelLength(poly: Point[]): number {
  let total = 0;
  for (let i = 1; i < poly.length; i++) {
    total += Math.hypot(poly[i].x - poly[i - 1].x, poly[i].y - poly[i - 1].y);
  }
  return total;
}

export function measureCableRun(input: MeasureInput): MeasureResult {
  const source = input.source ?? 'unknown';

  if (!isOn()) {
    return {
      metres: null, confidence: 0, segmentCount: 0, source,
      reason: 'ELECTRICAL_GEOMETRY flag off — fallback to Sonnet length estimate',
    };
  }

  if (!input.polylinePx || input.polylinePx.length < 2) {
    return {
      metres: null, confidence: 0, segmentCount: 0, source,
      reason: 'no polyline supplied — fallback to Sonnet length estimate',
    };
  }

  if (!input.mPerPx || input.mPerPx <= 0) {
    return {
      metres: null, confidence: 0, segmentCount: input.polylinePx.length - 1, source,
      reason: 'no scale (m_per_px) — cannot convert pixels to metres',
    };
  }

  const px = pixelLength(input.polylinePx);
  const metres = px * input.mPerPx;

  // Confidence is driven by the polyline source, not the math (math is exact).
  const confidence =
    source === 'dxf'
      ? 0.95                  // DXF polyline at known scale = ground truth
      : source === 'manual'
      ? 0.9                   // operator-drawn override
      : source === 'opencv'
      ? 0.7                   // detector-found polyline
      : 0.4;                  // unknown provenance

  return {
    metres,
    confidence,
    segmentCount: input.polylinePx.length - 1,
    source,
    reason: `${px.toFixed(1)} px × ${input.mPerPx.toExponential(3)} m/px @ ${input.scaleLabel ?? '?'}`,
  };
}

/**
 * Convenience wrapper for the common DXF case: a sequence of LINE / LWPOLYLINE
 * entities that together form the cable route. Caller has already filtered to
 * the cable layer.
 */
export function measureFromDxfPolyline(
  vertices: Point[],
  mPerPx: number | null,
  scaleLabel?: string | null,
): MeasureResult {
  return measureCableRun({
    polylinePx: vertices,
    mPerPx,
    scaleLabel,
    source: 'dxf',
  });
}
