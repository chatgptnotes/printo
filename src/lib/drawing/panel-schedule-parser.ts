/**
 * Parse a panel / cable / DB schedule from a native-text PDF using pdfjs-dist
 * text-item coordinates. No vision, no OCR — just clustering text by Y and X.
 *
 * Replaces sub-steps 7 (SMDBs from LV Panel) and 11 (SMDB → DB identification)
 * of `analyzeElectricalProcedure` (Sonnet vision) for the common case where
 * the consultant's PDF has the schedule as selectable text.
 *
 * Returns [] when no row of expected shape is recognised. Caller falls back
 * to Sonnet.
 *
 * Why we do this ourselves instead of `pdf-table-extractor`:
 *   that package depends on pdfjs-dist 1.5.x (incompatible with our 5.x) and
 *   uses file paths + callbacks. Rolling our own keeps one pdfjs version.
 */

import { extractFloors } from '@/lib/drawing/floor-counter';
import type { ScheduleRow } from '@/lib/drawing/xlsx-schedule-parser';

interface PositionedText {
  str: string;
  x: number;
  y: number;
  width: number;
}

const HEADER_HINTS: Record<keyof Omit<ScheduleRow, never>, RegExp[]> = {
  tag: [/\b(?:tag|ref|panel|board|circuit|id|smdb|db)\b/i],
  rating: [/\b(?:rating|amp|amps|capacity|breaker|mcb|mccb|acb|kA)\b/i],
  cable_size: [/\b(?:cable|conductor|size|csa|mm[²2]|core)\b/i],
  length_m: [/\b(?:length|len|distance|run|m\b)/i],
  from: [/\b(?:from|source|upstream|fed\s*from|supply)\b/i],
  to: [/\b(?:to|dest|downstream|feeds?|load)\b/i],
  location: [/\b(?:location|floor|level|area|room|zone)\b/i],
  remarks: [/\b(?:remarks?|notes?|comments?|description)\b/i],
};

const FIELDS = Object.keys(HEADER_HINTS) as Array<keyof typeof HEADER_HINTS>;

// Two text items belong to the same visual row if their Y coordinates differ
// by less than this fraction of the page height. PDF.js gives Y in PDF units
// (1/72 inch) — half a line is plenty.
const ROW_Y_TOLERANCE = 4;

async function pdfPositionedText(buf: Buffer): Promise<Array<{ pageNum: number; items: PositionedText[] }>> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const loadingTask = (pdfjs as any).getDocument({
    data,
    disableFontFace: true,
    useSystemFonts: false,
    isEvalSupported: false,
  });
  const doc = await loadingTask.promise;
  const out: Array<{ pageNum: number; items: PositionedText[] }> = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items: PositionedText[] = content.items
      .filter((it: any) => 'str' in it && it.str && it.transform)
      .map((it: any) => ({
        str: String(it.str),
        x: it.transform[4],
        y: it.transform[5],
        width: it.width ?? 0,
      }));
    out.push({ pageNum: p, items });
  }
  return out;
}

function clusterIntoRows(items: PositionedText[]): PositionedText[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: PositionedText[][] = [];
  for (const item of sorted) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last[0].y - item.y) <= ROW_Y_TOLERANCE) {
      last.push(item);
    } else {
      rows.push([item]);
    }
  }
  return rows.map(r => r.sort((a, b) => a.x - b.x));
}

function rowText(row: PositionedText[]): string {
  return row.map(i => i.str).join(' ').trim();
}

interface HeaderHit {
  rowIdx: number;
  mapping: Record<string, { startX: number; endX: number }>;
}

function detectHeader(rows: PositionedText[][]): HeaderHit | null {
  let best: HeaderHit | null = null;
  let bestScore = 0;
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    const row = rows[i];
    const mapping: Record<string, { startX: number; endX: number }> = {};
    let score = 0;
    for (const cell of row) {
      const text = cell.str.trim();
      if (!text) continue;
      for (const field of FIELDS) {
        if (mapping[field]) continue;
        if (HEADER_HINTS[field].some(re => re.test(text))) {
          mapping[field] = { startX: cell.x, endX: cell.x + cell.width };
          score++;
          break;
        }
      }
    }
    if (score >= 3 && score > bestScore) {
      bestScore = score;
      best = { rowIdx: i, mapping };
    }
  }
  return best;
}

function valueForColumn(
  row: PositionedText[],
  range: { startX: number; endX: number },
  nextStartX: number | null,
): string | null {
  // A value cell starts at its column header X and ends at the next column's X.
  const columnEnd = nextStartX ?? range.endX + 200;
  const tolerance = 8;
  const inCol = row.filter(c => c.x + tolerance >= range.startX - 4 && c.x < columnEnd - tolerance);
  const text = inCol.map(c => c.str).join(' ').replace(/\s+/g, ' ').trim();
  return text || null;
}

function toLengthM(v: string | null): number | null {
  if (!v) return null;
  const m = v.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : null;
}

export async function extractScheduleTable(buf: Buffer): Promise<ScheduleRow[]> {
  let pages: Array<{ pageNum: number; items: PositionedText[] }>;
  try {
    pages = await pdfPositionedText(buf);
  } catch (err) {
    console.warn('[panel-schedule-parser] pdfjs failed:', (err as Error).message);
    return [];
  }

  const rowsOut: ScheduleRow[] = [];
  for (const { items } of pages) {
    if (items.length === 0) continue;
    const rows = clusterIntoRows(items);
    const header = detectHeader(rows);
    if (!header) continue;

    // Determine column boundaries left → right.
    const cols = FIELDS
      .filter(f => header.mapping[f])
      .map(f => ({ field: f, ...header.mapping[f] }))
      .sort((a, b) => a.startX - b.startX);

    const dataRows = rows.slice(header.rowIdx + 1);
    for (const row of dataRows) {
      const text = rowText(row);
      // Skip blank or section-title rows (they tend to be one cell only).
      if (text.length < 4 || row.length < Math.max(2, cols.length - 2)) continue;

      const get = (fieldIdx: number): string | null => {
        const col = cols[fieldIdx];
        const next = cols[fieldIdx + 1];
        return valueForColumn(row, { startX: col.startX, endX: col.endX }, next?.startX ?? null);
      };

      const colIndexOf = (f: keyof typeof HEADER_HINTS) => cols.findIndex(c => c.field === f);
      const idxTag = colIndexOf('tag');
      const idxRating = colIndexOf('rating');
      const idxCable = colIndexOf('cable_size');
      const idxLen = colIndexOf('length_m');
      const idxFrom = colIndexOf('from');
      const idxTo = colIndexOf('to');
      const idxLoc = colIndexOf('location');
      const idxRem = colIndexOf('remarks');

      const tag = idxTag >= 0 ? get(idxTag) : null;
      const cable = idxCable >= 0 ? get(idxCable) : null;
      // Sanity: every emitted row should have either a tag or a cable size.
      if (!tag && !cable) continue;

      const location = idxLoc >= 0 ? get(idxLoc) : null;
      // If location was missing but text contains a floor token, capture it.
      const inferredLoc = location ?? (extractFloors(text)[0] ?? null);

      rowsOut.push({
        tag,
        rating: idxRating >= 0 ? get(idxRating) : null,
        cable_size: cable,
        length_m: idxLen >= 0 ? toLengthM(get(idxLen)) : null,
        from: idxFrom >= 0 ? get(idxFrom) : null,
        to: idxTo >= 0 ? get(idxTo) : null,
        location: inferredLoc,
        remarks: idxRem >= 0 ? get(idxRem) : null,
      });
    }
  }
  return rowsOut;
}
