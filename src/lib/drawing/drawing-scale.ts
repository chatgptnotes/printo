export type ScaleMethod =
  | 'dimension_arrows'
  | 'scale_bar'
  | 'grid'
  | 'building_dims'
  | 'none'
  | 'default'
  | 'manual';

export interface ScaleEvidence {
  method: Exclude<ScaleMethod, 'default' | 'manual'>;
  pixel_from: { x: number; y: number };
  pixel_to: { x: number; y: number };
  real_world_value: number;
  real_world_unit: 'm' | 'mm' | 'ft';
  note?: string;
}

export interface DrawingScale {
  m_per_px: number | null;
  ratio_label: string | null;
  source: 'detected' | 'default' | 'manual';
  confidence: number;
  method: ScaleMethod;
  evidence: ScaleEvidence[];
  assumed: boolean;
  updated_at: string;
  updated_by: string;
}

export function fallbackScale(): DrawingScale {
  return {
    m_per_px: null,
    ratio_label: null,
    source: 'default',
    confidence: 0,
    method: 'default',
    evidence: [],
    assumed: true,
    updated_at: new Date().toISOString(),
    updated_by: 'ai:detectDrawingScale',
  };
}

export function formatRatio(ratio: number): string {
  return `1:${Math.round(1 / ratio)}`;
}

/** Convert a scale ratio (1:N) to metres-per-pixel at the given DPI (default 150). */
export function mPerPxFromRatio(ratio: number, dpi = 150): number {
  // 1 inch = 0.0254 m; ratio = real / drawn => m_per_px = (0.0254 / dpi) * ratio
  return (0.0254 / dpi) * ratio;
}
