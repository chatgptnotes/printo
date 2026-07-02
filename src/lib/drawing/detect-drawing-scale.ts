/**
 * Task: detectDrawingScale
 *
 * Vision-tier. Given a single drawing page (rasterised image or PDF), find
 * the most reliable scale cue — dimension arrows > scale bar > grid pitch >
 * building dimensions — and return a typed DrawingScale.
 *
 * Output is consumed by the discipline analyzers (duct route, water supply,
 * MEP components). They never compute their own scale.
 */

import type { AITask, AIUserContent } from '@/lib/ai/types';
import {
  type DrawingScale,
  type ScaleEvidence,
  type ScaleMethod,
  fallbackScale,
  formatRatio,
  mPerPxFromRatio,
} from '@/lib/drawing/drawing-scale';

export interface DetectDrawingScaleInput {
  /** Drawing image or PDF page as base64. */
  dataBase64: string;
  mimeType: string;
  /** Image dimensions in pixels (for cross-check + evidence bookkeeping). */
  imagePxWidth: number;
  imagePxHeight: number;
  /** Raster DPI when the caller converted from PDF — informs ratio back-solving. */
  dpi?: number;
  /** Optional project context for model reasoning. */
  projectContext?: {
    total_area_sqft?: number | null;
    floors?: number | null;
    building_type?: string | null;
  };
}

export type DetectDrawingScaleOutput = DrawingScale;

/** Raw tool-call shape we ask the model to emit. Parsed into DrawingScale. */
interface RawScaleOutput {
  method:
    | 'dimension_arrows'
    | 'scale_bar'
    | 'grid'
    | 'building_dims'
    | 'none';
  ratio_label: string | null;
  m_per_px: number | null;
  confidence: number;
  evidence: Array<{
    method: Exclude<ScaleMethod, 'default' | 'manual'>;
    pixel_from: { x: number; y: number };
    pixel_to: { x: number; y: number };
    real_world_value: number;
    real_world_unit: 'm' | 'mm' | 'ft';
    note?: string;
  }>;
  reasoning: string;
}

const SYSTEM_PROMPT = `You are an MEP drawing scale detector for ERP Realsoft (Dubai, UAE MEP estimation platform).
Your ONLY job on this call is to determine the drawing's scale (metres per pixel) by finding the most reliable visual cue on the page.

Priority order (use the highest-priority cue you can confirm):
1. DIMENSION ARROWS — two arrowheads with a numeric label between them (e.g. "8200" mm or "8.2 m"). Most reliable. ALWAYS look for these first; back-calculate px-per-metre from the pixel distance between the arrowheads divided by the labelled real-world length. Examples of dimension-arrow patterns: "←——— 8200 ———→", "8.2 m" between tick marks, mullion-to-mullion distances on plans, column-to-column gridlines with mm annotations.
2. SCALE BAR — a printed bar with tick marks labelled in metres or feet.
3. GRID WITH PITCH — a grid where the column spacing is annotated (e.g. "6 m c/c").
4. BUILDING DIMENSIONS — overall wall-to-wall measurements annotated on the drawing edges.
5. AREA CROSS-CHECK — when no annotation is visible but project context provides total_area_sqft and floors, you may approximate m_per_px by treating the visible drawing footprint as covering area_per_floor_m2 and back-solving from the bounding-box pixel area. Confidence MUST be ≤ 0.4 for this method (no direct annotation).
6. none — no reliable cue visible AND no usable area cross-check. Return method="none", m_per_px=null, confidence=0.

When you find a cue:
- Report the two pixel coordinates that bracket it (for audit UI).
- Report the real-world value + unit (mm / m / ft).
- Compute m_per_px = real_world_value_in_metres / pixel_distance.
- Compute ratio_label as "1:N" where N = round(1 / (real_world_per_px_metres × dpi / 0.0254)) — but if DPI is not known, just report m_per_px and set ratio_label=null.

Sanity checks before returning:
- If project context gives total_area_sqft and floors, compute the implied drawing footprint width_m ≈ sqrt((total_area_sqft × 0.0929) / floors). The detected scale should produce a drawing that fits this footprint within ±25%. If it doesn't, lower confidence by 0.2.
- Reasonable architectural scales for floor plans are 1:50, 1:75, 1:100, 1:150, 1:200. If your detected ratio is far from these (e.g. 1:37 or 1:300+), re-check the cue and consider lowering confidence.

Confidence guide:
- 0.9 for clean dimension arrows
- 0.85 for labelled scale bar
- 0.7 for annotated grid
- 0.6 for building dimensions
- 0.4 for area cross-check (cap)
- 0.3 when guessing from drawing conventions
- 0.0 when nothing plausible

Do not hallucinate scales. If the cue is ambiguous, lower the confidence.

Always call the record_drawing_scale tool exactly once.`;

const TOOL_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    method: {
      type: 'string',
      enum: ['dimension_arrows', 'scale_bar', 'grid', 'building_dims', 'none'],
    },
    ratio_label: { type: ['string', 'null'], description: 'Like "1:100" or null' },
    m_per_px: {
      type: ['number', 'null'],
      description: 'Metres per pixel at the provided image resolution',
    },
    confidence: { type: 'number', description: '0..1' },
    evidence: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          method: {
            type: 'string',
            enum: ['dimension_arrows', 'scale_bar', 'grid', 'building_dims'],
          },
          pixel_from: {
            type: 'object',
            properties: { x: { type: 'number' }, y: { type: 'number' } },
            required: ['x', 'y'],
          },
          pixel_to: {
            type: 'object',
            properties: { x: { type: 'number' }, y: { type: 'number' } },
            required: ['x', 'y'],
          },
          real_world_value: { type: 'number' },
          real_world_unit: { type: 'string', enum: ['m', 'mm', 'ft'] },
          note: { type: 'string' },
        },
        required: ['method', 'pixel_from', 'pixel_to', 'real_world_value', 'real_world_unit'],
      },
    },
    reasoning: { type: 'string' },
  },
  required: ['method', 'confidence', 'evidence', 'reasoning'],
} as const;

export const DetectDrawingScaleTask: AITask<
  DetectDrawingScaleInput,
  DetectDrawingScaleOutput
> = {
  name: 'detectDrawingScale',
  version: '1.0.0',
  tier: 'vision',
  needsVision: true,
  needsToolUse: true,
  maxOutputTokens: 1024,
  systemPrompt: SYSTEM_PROMPT,
  toolName: 'record_drawing_scale',
  toolDescription:
    'Record the scale of a drawing (metres per pixel) with the evidence used to derive it.',
  toolInputSchema: TOOL_INPUT_SCHEMA as unknown as Record<string, unknown>,

  buildUserContent(input: DetectDrawingScaleInput): AIUserContent[] {
    const ctx = input.projectContext;
    const ctxText = ctx
      ? `Project context for sanity-check (do NOT use to invent a scale — only as a sanity signal):
  total_area_sqft: ${ctx.total_area_sqft ?? 'unknown'}
  floors: ${ctx.floors ?? 'unknown'}
  building_type: ${ctx.building_type ?? 'unknown'}`
      : 'No project context available.';

    const introText = `Image resolution: ${input.imagePxWidth} × ${input.imagePxHeight} px${
      input.dpi ? `, ${input.dpi} DPI` : ''
    }.
Find the best available scale cue. Return method="none" if nothing reliable.

${ctxText}`;

    const isPdf = input.mimeType === 'application/pdf';
    return [
      { type: 'text', text: introText },
      {
        type: isPdf ? 'document' : 'image',
        mimeType: input.mimeType,
        dataBase64: input.dataBase64,
      },
    ];
  },

  parseOutput(raw: unknown): DetectDrawingScaleOutput {
    const r = (raw ?? {}) as Partial<RawScaleOutput>;

    // Fallback when the model found nothing.
    if (!r.method || r.method === 'none') {
      return fallbackScale();
    }

    const method = r.method as ScaleMethod;
    const confidence =
      typeof r.confidence === 'number'
        ? Math.max(0, Math.min(1, r.confidence))
        : 0.3;
    const evidenceRaw = Array.isArray(r.evidence) ? r.evidence : [];
    const evidence: ScaleEvidence[] = evidenceRaw.map((e) => ({
      method: e.method,
      pixel_from: e.pixel_from,
      pixel_to: e.pixel_to,
      real_world_value: e.real_world_value,
      real_world_unit: e.real_world_unit,
      note: e.note,
    }));

    // Resolve m_per_px: trust the model's number if present, else derive from evidence.
    let mPerPx = typeof r.m_per_px === 'number' && r.m_per_px > 0 ? r.m_per_px : NaN;
    if (!Number.isFinite(mPerPx) && evidence.length > 0) {
      const e = evidence[0];
      const pxDist = Math.hypot(
        e.pixel_to.x - e.pixel_from.x,
        e.pixel_to.y - e.pixel_from.y
      );
      const metres = toMetres(e.real_world_value, e.real_world_unit);
      if (pxDist > 0 && metres > 0) mPerPx = metres / pxDist;
    }

    if (!Number.isFinite(mPerPx) || mPerPx <= 0) {
      return fallbackScale();
    }

    // Derive ratio_label when we have DPI-style info, else honour model's label.
    let ratioLabel = r.ratio_label ?? null;
    if (!ratioLabel) {
      // Heuristic: infer ratio assuming 150 DPI (the typical PDF→raster choice).
      const inferredRatio = 0.0254 / 150 / mPerPx;
      if (Number.isFinite(inferredRatio) && inferredRatio > 0) {
        ratioLabel = formatRatio(inferredRatio);
      }
    }

    return {
      m_per_px: mPerPx,
      ratio_label: ratioLabel,
      source: 'detected',
      confidence,
      method,
      evidence,
      assumed: confidence < 0.5,
      updated_at: new Date().toISOString(),
      updated_by: 'ai:detectDrawingScale',
    };
  },
};

function toMetres(value: number, unit: 'm' | 'mm' | 'ft'): number {
  if (unit === 'm') return value;
  if (unit === 'mm') return value / 1000;
  return value * 0.3048; // ft
}

// Re-export helper the benchmark script uses.
export { mPerPxFromRatio };
