/**
 * Electrical pipeline preflight orchestrator.
 *
 * Runs deterministic library extractors over each attachment BEFORE Sonnet is
 * called. The result is a `KnownFacts` object that the caller injects into the
 * Sonnet prompt so the model doesn't waste tokens re-deriving things we
 * already read with `pdfjs-dist`, `dxf-parser`, or `exceljs`.
 *
 * Sub-steps covered when the library returns high-confidence facts:
 *   sub-step 1 — Open the drawing             (filename + DXF metadata)
 *   sub-step 2 — List available drawings      (filename + drawingType)
 *   sub-step 3 — Floors and floor heights     (title-block text)
 *   sub-step 4 — Drawing scale                (title-block text)
 *   sub-step 6 — SLD availability             (drawingType === 'schematic')
 *   sub-step 7/11 — Panel & DB schedules      (XLSX from client)
 *
 * Gated by env flag `ELECTRICAL_PREFLIGHT=on`. When off, returns an empty
 * KnownFacts object so callers behave exactly as today.
 */

import type { AttachmentFile } from '@/lib/ai/claude-api';
import { extractTitleBlock, type TitleBlock, type DrawingType } from '@/lib/drawing/title-block-extractor';
import { extractDxfSummary, hasElectricalLayers, extractCableRoutes } from '@/lib/drawing/dxf-text-extractor';
import { extractXlsxSchedule, type ScheduleRow } from '@/lib/drawing/xlsx-schedule-parser';
import { extractScheduleTable } from '@/lib/drawing/panel-schedule-parser';
import { measureFromDxfPolyline } from '@/lib/drawing/cable-route-measurer';

export interface CableMeasurement {
  source_filename: string;
  layer: string;
  metres: number;
  segment_count: number;
  confidence: number; // 0..1
  unit: 'mm' | 'cm' | 'm' | 'in' | 'ft' | 'unitless';
}

export interface KnownFacts {
  scale: string | null;
  scaleRatio: number | null;
  floors: string[];
  hasSld: boolean;
  drawings: Array<{
    filename: string;
    drawingType: DrawingType;
    drawingNumber: string | null;
    isElectrical: boolean | null; // null = unknown
  }>;
  scheduleRows: ScheduleRow[];
  /** Cable runs measured deterministically from DXF polylines (Phase 3). */
  cableMeasurements: CableMeasurement[];
}

export interface PreflightResult {
  enabled: boolean;
  knownFacts: KnownFacts;
  /** Filenames we are confident Sonnet does NOT need to re-read. */
  skippedSonnet: string[];
  /** Filenames we still need Sonnet to look at (image-only PDFs, etc.). */
  remainingForSonnet: AttachmentFile[];
  /** A pre-formatted block to splice into the Sonnet user prompt. */
  promptHints: string;
}

const EMPTY: KnownFacts = {
  scale: null,
  scaleRatio: null,
  floors: [],
  hasSld: false,
  drawings: [],
  scheduleRows: [],
  cableMeasurements: [],
};

function isOn(): boolean {
  const v = process.env.ELECTRICAL_PREFLIGHT;
  return v === '1' || v === 'true' || v === 'on';
}

function isPdf(f: AttachmentFile): boolean {
  return f.mimeType === 'application/pdf' || /\.pdf$/i.test(f.filename);
}

function isDxf(f: AttachmentFile): boolean {
  return f.mimeType === 'application/dxf' || /\.dxf$/i.test(f.filename);
}

function isXlsx(f: AttachmentFile): boolean {
  return /\.xlsx?$/i.test(f.filename) || f.mimeType.includes('spreadsheet');
}

function mergeScale(current: KnownFacts, tb: TitleBlock): void {
  if (tb.scale && tb.scaleRatio && !current.scale) {
    current.scale = tb.scale;
    current.scaleRatio = tb.scaleRatio;
  }
}

function buildPromptHints(facts: KnownFacts): string {
  if (
    !facts.scale &&
    facts.floors.length === 0 &&
    facts.drawings.length === 0 &&
    facts.scheduleRows.length === 0 &&
    facts.cableMeasurements.length === 0
  ) {
    return '';
  }
  const lines: string[] = ['<known_facts source="library-preflight">'];
  if (facts.scale) lines.push(`  scale: ${facts.scale}`);
  if (facts.floors.length > 0) lines.push(`  floors: ${facts.floors.join(', ')}`);
  if (facts.hasSld) lines.push('  schematic_present: true');
  if (facts.drawings.length > 0) {
    lines.push('  drawings:');
    for (const d of facts.drawings.slice(0, 40)) {
      lines.push(
        `    - ${d.filename} | type=${d.drawingType}${
          d.drawingNumber ? ` | dwg=${d.drawingNumber}` : ''
        }${d.isElectrical === false ? ' | non-electrical' : ''}`,
      );
    }
  }
  if (facts.scheduleRows.length > 0) {
    lines.push(`  panel_schedule_rows_from_xlsx: ${facts.scheduleRows.length}`);
    for (const r of facts.scheduleRows.slice(0, 30)) {
      lines.push(
        `    - tag=${r.tag ?? '?'}${r.rating ? ` rating=${r.rating}` : ''}${
          r.cable_size ? ` cable=${r.cable_size}` : ''
        }${r.from ? ` from=${r.from}` : ''}${r.to ? ` to=${r.to}` : ''}${
          r.length_m != null ? ` length=${r.length_m}m` : ''
        }${r.location ? ` loc=${r.location}` : ''}`,
      );
    }
  }
  if (facts.cableMeasurements.length > 0) {
    lines.push(
      `  cable_measurements_from_dxf: ${facts.cableMeasurements.length} (deterministic — pixels × scale)`,
    );
    for (const c of facts.cableMeasurements.slice(0, 40)) {
      lines.push(
        `    - layer=${c.layer} | length=${c.metres}m | segments=${c.segment_count} | conf=${c.confidence.toFixed(2)} | src=${c.source_filename}`,
      );
    }
  }
  lines.push('</known_facts>');
  lines.push(
    '',
    'These facts came from deterministic parsers (pdfjs / dxf-parser / exceljs).',
    'Treat them as ground truth. Do NOT re-derive them — focus your output on',
    'the sub-steps that still need vision (5, 8, 9, 12) and the cable-route',
    'CHOICE in steps 9, 10, 13 (the LENGTH numbers are now measured from DXF).',
    '',
  );
  return lines.join('\n');
}

export async function runElectricalPreflight(attachments: AttachmentFile[]): Promise<PreflightResult> {
  if (!isOn()) {
    return {
      enabled: false,
      knownFacts: EMPTY,
      skippedSonnet: [],
      remainingForSonnet: attachments,
      promptHints: '',
    };
  }

  const facts: KnownFacts = {
    scale: null,
    scaleRatio: null,
    floors: [],
    hasSld: false,
    drawings: [],
    scheduleRows: [],
    cableMeasurements: [],
  };

  const skipped: string[] = [];
  const remaining: AttachmentFile[] = [];
  const seenFloors = new Set<string>();

  await Promise.all(
    attachments.map(async (f) => {
      try {
        if (isXlsx(f)) {
          const rows = await extractXlsxSchedule(f.buffer);
          if (rows.length > 0) {
            facts.scheduleRows.push(...rows);
            skipped.push(f.filename);
            return;
          }
          // Fall through — empty XLSX still goes to Sonnet (rare).
          remaining.push(f);
          return;
        }

        if (isDxf(f)) {
          const summary = extractDxfSummary(f.filename, f.buffer);
          if (summary.ok) {
            const electrical = hasElectricalLayers(summary.layers);
            facts.drawings.push({
              filename: f.filename,
              drawingType: 'other',
              drawingNumber: null,
              isElectrical: electrical,
            });

            // Phase 3 — extract cable polylines on electrical layers and
            // measure each route deterministically. The cable-route-measurer
            // is itself flag-gated (ELECTRICAL_GEOMETRY); when off it returns
            // metres=null so we just skip the row instead of writing garbage.
            if (electrical) {
              try {
                const cables = extractCableRoutes(f.filename, f.buffer);
                if (cables.ok && cables.routes.length > 0) {
                  for (const route of cables.routes) {
                    const measured = measureFromDxfPolyline(
                      route.vertices,
                      cables.unitMetres,
                      cables.unitName,
                    );
                    if (measured.metres != null && measured.metres > 0) {
                      facts.cableMeasurements.push({
                        source_filename: f.filename,
                        layer: route.layer,
                        metres: Number(measured.metres.toFixed(2)),
                        segment_count: measured.segmentCount,
                        confidence: measured.confidence,
                        unit: cables.unitName,
                      });
                    }
                  }
                }
              } catch (err) {
                console.warn(
                  `[electrical-preflight] cable-route extraction failed for ${f.filename}: ${(err as Error).message}`,
                );
              }
            }

            // DXF text + cable measurements feed the AI as additional context;
            // the geometry interpretation (route choice, panel relationships)
            // still needs Sonnet vision on the rasterised version, so the file
            // stays in `remaining`.
            remaining.push(f);
            return;
          }
          remaining.push(f);
          return;
        }

        if (isPdf(f)) {
          const tb = await extractTitleBlock(f.buffer);
          mergeScale(facts, tb);
          for (const fl of tb.floors) {
            if (!seenFloors.has(fl)) {
              seenFloors.add(fl);
              facts.floors.push(fl);
            }
          }
          if (tb.drawingType === 'schematic') facts.hasSld = true;
          facts.drawings.push({
            filename: f.filename,
            drawingType: tb.drawingType,
            drawingNumber: tb.drawingNumber,
            isElectrical: null,
          });

          // Schedule pages → try the positional-text parser. If it returns
          // ≥3 rows, that's a real schedule we can serve library-only and
          // Sonnet doesn't need to look at the file at all.
          if (tb.drawingType === 'schedule') {
            try {
              const rows = await extractScheduleTable(f.buffer);
              if (rows.length >= 3) {
                facts.scheduleRows.push(...rows);
                skipped.push(f.filename);
                return;
              }
            } catch (err) {
              console.warn(
                `[electrical-preflight] panel-schedule parse failed for ${f.filename}: ${(err as Error).message}`,
              );
            }
            // Fewer than 3 rows OR parse failed → fall through to Sonnet.
          }

          // Confidence threshold — only skip Sonnet for sub-step 1/2/3/4/6
          // when the title block was clearly readable. Geometry-bearing pages
          // (floor plans, risers) still need Sonnet for sub-steps 5+.
          if (tb.confidence < 0.6) {
            remaining.push(f);
            return;
          }
          remaining.push(f);
          return;
        }

        // Image / unknown: hand to Sonnet
        remaining.push(f);
      } catch (err) {
        console.warn(
          `[electrical-preflight] ${f.filename} failed: ${(err as Error).message} — falling back to Sonnet`,
        );
        remaining.push(f);
      }
    }),
  );

  return {
    enabled: true,
    knownFacts: facts,
    skippedSonnet: skipped,
    remainingForSonnet: remaining,
    promptHints: buildPromptHints(facts),
  };
}
