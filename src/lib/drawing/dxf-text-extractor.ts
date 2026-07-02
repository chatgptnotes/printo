/**
 * Extract a textual summary from a DXF file buffer.
 *
 * DXF is the text-based AutoCAD format. We parse it server-side via
 * `dxf-parser` and pull out the bits that matter for discipline detection
 * and the cable-schedule procedure:
 *   - Layer names (E-LIGHTING, E-POWER, MDB, SMDB, M-DUCT … reveal discipline)
 *   - All TEXT / MTEXT entities (panel labels, room tags, MDB/DB ids, notes)
 *   - Block reference names (symbols used on the drawing)
 *   - Entity counts per type
 *
 * The result is fed to the electrical procedure as additional `extractedText`
 * context — so even though Claude vision can't render DXF directly,
 * the AI still sees panel tags, MDB labels, and layer names from the drawing.
 *
 * DWG (binary) is NOT handled here — DWG → DXF/PDF conversion needs an
 * external tool. Use the manual workflow (AutoCAD → File → Save As → DXF /
 * Print → PDF) before upload.
 */

import DxfParser from 'dxf-parser';

export interface DxfSummary {
  ok: true;
  filename: string;
  layers: string[];
  textEntities: string[];
  blockNames: string[];
  entityCounts: Record<string, number>;
  /** Compact textual summary suitable for inclusion in the AI prompt. */
  textBlock: string;
}

export interface DxfSummaryError {
  ok: false;
  filename: string;
  error: string;
}

export type DxfSummaryResult = DxfSummary | DxfSummaryError;

const TEXT_LIMIT = 12000;

export function extractDxfSummary(filename: string, buffer: Buffer): DxfSummaryResult {
  try {
    const text = buffer.toString('utf-8');
    const parser = new DxfParser();
    const dxf = parser.parseSync(text);
    if (!dxf) {
      return { ok: false, filename, error: 'DXF parser returned null (file may be DWG-binary or corrupt)' };
    }

    const entities = ((dxf.entities ?? []) as unknown) as Array<Record<string, unknown>>;
    const tables = ((dxf.tables ?? {}) as unknown) as Record<string, unknown>;
    const blocks = ((dxf.blocks ?? {}) as unknown) as Record<string, unknown>;

    // Layer names — `tables.layer.layers` is a map of name → layer record.
    const layerTable = (tables.layer as { layers?: Record<string, unknown> } | undefined)?.layers ?? {};
    const layers = Object.keys(layerTable).filter(Boolean);

    // Block names (symbols used on the drawing).
    const blockNames = Object.keys(blocks).filter((n) => !n.startsWith('*'));

    // Text entities + per-type counts.
    const textEntities: string[] = [];
    const entityCounts: Record<string, number> = {};
    for (const e of entities) {
      const type = (e.type as string) || 'UNKNOWN';
      entityCounts[type] = (entityCounts[type] || 0) + 1;
      if (type === 'TEXT' || type === 'MTEXT') {
        const raw = (e.text as string) || '';
        // MTEXT can contain {\\f...} formatting codes — strip them for cleanliness.
        const clean = raw
          .replace(/\\[A-Za-z]\d*[^;]*;/g, '')
          .replace(/[{}]/g, '')
          .trim();
        if (clean) textEntities.push(clean);
      }
    }

    // De-dup texts and cap size so the prompt stays bounded.
    const uniqueTexts = Array.from(new Set(textEntities));
    let textBlock =
      `# DXF: ${filename}\n` +
      `## Layers (${layers.length}): ${layers.slice(0, 80).join(', ')}\n` +
      `## Blocks (${blockNames.length}): ${blockNames.slice(0, 40).join(', ')}\n` +
      `## Entity counts: ${Object.entries(entityCounts).map(([t, n]) => `${t}=${n}`).join(', ')}\n` +
      `## Drawing text (${uniqueTexts.length} unique strings):\n` +
      uniqueTexts.join(' · ');

    if (textBlock.length > TEXT_LIMIT) {
      textBlock = textBlock.slice(0, TEXT_LIMIT) + '\n[... truncated ...]';
    }

    return {
      ok: true,
      filename,
      layers,
      textEntities: uniqueTexts,
      blockNames,
      entityCounts,
      textBlock,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'DXF parse failed';
    return { ok: false, filename, error: message };
  }
}

/**
 * Quick discipline hint from DXF layer names.
 *
 * AutoCAD MEP standards typically prefix layers by discipline:
 *   E-*  electrical, M-* mechanical/HVAC, P-* plumbing, FP-* fire protection.
 * AIA layer guidelines use 4-character prefixes (e.g., E-POWR, E-LITE, M-HVAC).
 */
export function disciplineHintFromLayers(layers: string[]): { discipline: string | null; matched: string[] } {
  const matched: string[] = [];
  let elec = 0;
  let other = 0;
  const elecPatterns = /^(E-|ELEC|ELE_|POWR|POWER|LITE|LIGHT|MDB|SMDB|DB[-_]|CABLE|PANEL)/i;
  const otherPatterns = /^(M-|MECH|HVAC|DUCT|AHU|FAHU|FCU|P-|PLMB|PLUMB|FP-|FIRE)/i;
  for (const layer of layers) {
    if (elecPatterns.test(layer)) {
      elec++;
      matched.push(layer);
    } else if (otherPatterns.test(layer)) {
      other++;
    }
  }
  if (elec === 0 && other === 0) return { discipline: null, matched: [] };
  if (elec > other) return { discipline: 'electrical', matched };
  return { discipline: 'non_electrical', matched };
}

/**
 * Strict electrical-layer test for the preflight short-circuit. Returns true
 * when the DXF carries any of the canonical electrical layer prefixes called
 * out in CLAUDE.md (`E-, ELEC, POWR, LITE, MDB, SMDB`). When this is true,
 * `analyzeElectricalProcedure` can skip Sonnet for sub-step 1 (open the
 * drawing) and sub-step 2 (drawing classification) on this attachment.
 */
export function hasElectricalLayers(layers: string[]): boolean {
  const re = /^(?:E-|ELEC|POWR|LITE|MDB|SMDB)/i;
  return layers.some(l => re.test(l));
}

// ---------------------------------------------------------------------------
// Cable polyline extraction — Phase 3 foundation
// ---------------------------------------------------------------------------

export interface DxfPoint { x: number; y: number; }

export interface CableRoute {
  layer: string;
  /** Vertices in DXF model coordinates (units controlled by $INSUNITS). */
  vertices: DxfPoint[];
  entityType: 'LINE' | 'LWPOLYLINE' | 'POLYLINE';
}

export interface CableRouteResult {
  ok: true;
  filename: string;
  routes: CableRoute[];
  /** Metres per DXF unit, derived from $INSUNITS (default mm → 0.001). */
  unitMetres: number;
  unitName: 'mm' | 'cm' | 'm' | 'in' | 'ft' | 'unitless';
}

export interface CableRouteError {
  ok: false;
  filename: string;
  error: string;
}

// AutoCAD $INSUNITS table → metres-per-unit + name
const INSUNITS_TO_METRES: Record<number, { m: number; name: CableRouteResult['unitName'] }> = {
  0: { m: 0.001, name: 'unitless' }, // assume mm
  1: { m: 0.0254, name: 'in' },
  2: { m: 0.3048, name: 'ft' },
  4: { m: 0.001, name: 'mm' },
  5: { m: 0.01, name: 'cm' },
  6: { m: 1, name: 'm' },
};

const CABLE_LAYER_PATTERN = /^(?:E-|ELEC|POWR|LITE|MDB|SMDB|CABLE|PWR|FEEDER|RISER)/i;

function dedupeVertices(vs: DxfPoint[]): DxfPoint[] {
  const out: DxfPoint[] = [];
  for (const v of vs) {
    const last = out[out.length - 1];
    if (!last || last.x !== v.x || last.y !== v.y) out.push(v);
  }
  return out;
}

/**
 * Pull every cable-bearing polyline + line out of a DXF and return the geometry
 * in real-world units, ready to feed into `measureFromDxfPolyline`.
 *
 * Filters to electrical/cable layers (CABLE_LAYER_PATTERN) — non-electrical
 * geometry on architectural layers is intentionally dropped.
 */
export function extractCableRoutes(filename: string, buffer: Buffer): CableRouteResult | CableRouteError {
  try {
    const text = buffer.toString('utf-8');
    const parser = new DxfParser();
    const dxf = parser.parseSync(text);
    if (!dxf) return { ok: false, filename, error: 'DXF parser returned null' };

    const header = ((dxf.header ?? {}) as Record<string, unknown>);
    const insunits = typeof header.$INSUNITS === 'number' ? (header.$INSUNITS as number) : 4;
    const unit = INSUNITS_TO_METRES[insunits] ?? INSUNITS_TO_METRES[4];

    const entities = ((dxf.entities ?? []) as unknown) as Array<Record<string, unknown>>;
    const routes: CableRoute[] = [];

    for (const e of entities) {
      const layer = String(e.layer ?? '');
      if (!CABLE_LAYER_PATTERN.test(layer)) continue;

      const type = String(e.type ?? '');
      if (type === 'LWPOLYLINE' || type === 'POLYLINE') {
        const verticesRaw = (e.vertices as Array<{ x: number; y: number }> | undefined) ?? [];
        const vertices = dedupeVertices(
          verticesRaw
            .filter(v => Number.isFinite(v?.x) && Number.isFinite(v?.y))
            .map(v => ({ x: v.x, y: v.y })),
        );
        if (vertices.length >= 2) {
          routes.push({ layer, vertices, entityType: type });
        }
      } else if (type === 'LINE') {
        const verts = (e.vertices as Array<{ x?: number; y?: number }> | undefined) ?? [];
        const start = (e.startPoint as { x?: number; y?: number } | undefined) ?? verts[0];
        const end = (e.endPoint as { x?: number; y?: number } | undefined) ?? verts[1];
        if (
          start && end &&
          Number.isFinite(start.x) && Number.isFinite(start.y) &&
          Number.isFinite(end.x) && Number.isFinite(end.y)
        ) {
          routes.push({
            layer,
            vertices: [
              { x: start.x as number, y: start.y as number },
              { x: end.x as number, y: end.y as number },
            ],
            entityType: 'LINE',
          });
        }
      }
    }

    return { ok: true, filename, routes, unitMetres: unit.m, unitName: unit.name };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'DXF cable-route parse failed';
    return { ok: false, filename, error: message };
  }
}
