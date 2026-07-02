// Renderer-ready 2D geometry synthesized from an ElectricalProcedureResult.
// The pipeline never extracts real room/wall XY coordinates — only floor count,
// floor heights, panel→floor tags, and per-cable lengths/gauges. So this model is
// a schematic building ELEVATION (riser): floors stacked as horizontal bands,
// panels placed on their real floor, cable_schedule runs routed through a left
// riser lane and labelled with size/length. Lengths/cost are real (from length_m).

import type { GaugeBucket } from './cost';

export type { GaugeBucket };
export type PanelKind = 'mdb' | 'smdb' | 'db';

export interface SvgFloor {
  index: number;     // 0 = lowest (basement), N = roof
  label: string;
  yTop: number;      // band top (px, SVG space)
  height: number;    // band height (px)
}

export interface SvgPanel {
  tag: string;
  kind: PanelKind;
  floorIndex: number;
  x: number;         // box top-left (px)
  y: number;
  w: number;
  h: number;
  rating_a: number | null;
}

export interface SvgCable {
  from: string;
  to: string;
  sizeMm2: number;
  lengthM: number;          // real estimate length (drives cost)
  bucket: GaugeBucket;
  path: string;             // orthogonal SVG path string; '' when unresolved
  labelX: number;
  labelY: number;
  segLabelX: number;        // "on wire" anchor — centre of the gap left of the box
  segLabelY: number;        // just above the wire centreline
  resolved: boolean;        // false = endpoints not placeable; length still counted
}

export interface ExtractionSummary {
  buildingName: string;
  drawingScale: string | null;
  scaleDetected: boolean;
  floorsIdentified: number;
  mdbTag: string | null;
  mdbRatingA: number | null;
  smdbCount: number;
  dbCount: number;
  outletsTotal: number;
  lightingTotal: number;     // sum of lighting_fixtures qty (0 when no legend on drawing)
  lightingTypes: number;     // distinct fixture types read from the legend
  totalCableLengthM: number;
  typicalFloorHeightM: number | null;   // floor-to-floor height (m) from the scan
  confidence: number | null;
}

export interface SvgPlanModel {
  width: number;
  height: number;
  floors: SvgFloor[];
  panels: SvgPanel[];
  cables: SvgCable[];
  outletsByFloor: Record<number, number>;
  lightingByFloor: Record<number, number>;
  cableLengthByFloor: Record<number, number>; // total feeder length (m) terminating on each floor
  summary: ExtractionSummary;
  unresolvedCount: number;   // cables counted in cost but not drawn
  isDemo: boolean;
}
