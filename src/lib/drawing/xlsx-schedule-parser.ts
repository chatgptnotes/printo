/**
 * Parse a client-supplied XLSX cable / DB schedule into ScheduleRow[].
 *
 * Replaces sub-steps 7 (SMDBs from LV Panel) and 11 (SMDB→DB identification)
 * of `analyzeElectricalProcedure` (Sonnet vision) for the common case where
 * the consultant attaches a panel-schedule spreadsheet alongside the drawings.
 *
 * Strategy:
 *   1. Read every worksheet via `exceljs` (already a project dep).
 *   2. Find the header row by scoring each row against expected column names.
 *   3. Map columns to ScheduleRow fields and emit one row per data row.
 *
 * Returns [] when no header row is recognisable. Caller falls back to Sonnet.
 */

import ExcelJS from 'exceljs';

export interface ScheduleRow {
  tag: string | null;             // Panel/DB tag e.g. "MDB", "SMDB-1", "DB-3F-1"
  rating: string | null;          // e.g. "400A", "63A"
  cable_size: string | null;      // e.g. "4x95mm² + 1x50mm² ECC"
  length_m: number | null;
  from: string | null;            // upstream panel
  to: string | null;              // downstream panel (or load)
  location: string | null;        // floor / room
  remarks: string | null;
}

const COLUMN_HINTS: Record<keyof Omit<ScheduleRow, never>, RegExp[]> = {
  tag: [/\b(?:tag|ref(?:erence)?|panel|board|circuit|id)\b/i],
  rating: [/\b(?:rating|amp|amps|capacity|breaker|mcb|mccb|acb)\b/i],
  cable_size: [/\b(?:cable|conductor|size|csa|mm[²2])\b/i],
  length_m: [/\b(?:length|len|distance|run)\b/i],
  from: [/\b(?:from|source|upstream|fed\s*from|supply)\b/i],
  to: [/\b(?:to|dest(?:ination)?|downstream|feeds?|load)\b/i],
  location: [/\b(?:location|floor|level|area|room|zone)\b/i],
  remarks: [/\b(?:remarks?|notes?|comments?|description)\b/i],
};

const FIELDS = Object.keys(COLUMN_HINTS) as Array<keyof typeof COLUMN_HINTS>;

function scoreHeaderRow(values: string[]): { score: number; mapping: Record<string, number> } {
  const mapping: Record<string, number> = {};
  let score = 0;
  values.forEach((cellValue, colIdx) => {
    if (!cellValue) return;
    const cellStr = String(cellValue).trim();
    for (const field of FIELDS) {
      if (mapping[field] !== undefined) continue;
      if (COLUMN_HINTS[field].some(re => re.test(cellStr))) {
        mapping[field] = colIdx;
        score += 1;
        break;
      }
    }
  });
  return { score, mapping };
}

function cellToString(v: ExcelJS.CellValue | undefined): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    if ('text' in v && typeof (v as any).text === 'string') return (v as any).text.trim() || null;
    if ('result' in v) return cellToString((v as any).result);
    if ('richText' in v && Array.isArray((v as any).richText)) {
      return (v as any).richText.map((r: any) => r.text ?? '').join('').trim() || null;
    }
  }
  return null;
}

function cellToNumber(v: ExcelJS.CellValue | undefined): number | null {
  const s = cellToString(v);
  if (!s) return null;
  // Strip units like "12 m" / "120m" / "12.5 metres"
  const m = s.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : null;
}

export async function extractXlsxSchedule(buf: Buffer): Promise<ScheduleRow[]> {
  let workbook: ExcelJS.Workbook;
  try {
    workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buf as unknown as ArrayBuffer);
  } catch (err) {
    console.warn('[xlsx-schedule-parser] load failed:', (err as Error).message);
    return [];
  }

  const allRows: ScheduleRow[] = [];
  for (const sheet of workbook.worksheets) {
    let bestHeader: { rowNumber: number; mapping: Record<string, number>; score: number } | null = null;
    // Scan first 20 rows for a header — schedules often have a title block
    // above the actual table.
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber > 20 || (bestHeader && bestHeader.score >= 5)) return;
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, cell => cells.push(String(cellToString(cell.value) ?? '')));
      const { score, mapping } = scoreHeaderRow(cells);
      if (score >= 3 && (!bestHeader || score > bestHeader.score)) {
        bestHeader = { rowNumber, mapping, score };
      }
    });

    if (!bestHeader) continue;
    const { rowNumber: headerRow, mapping } = bestHeader as { rowNumber: number; mapping: Record<string, number>; score: number };
    const colOf = (field: keyof typeof COLUMN_HINTS): number | undefined => mapping[field];

    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber <= headerRow) return;
      const get = (field: keyof typeof COLUMN_HINTS) => {
        const idx = colOf(field);
        if (idx === undefined) return undefined;
        return row.getCell(idx + 1).value;
      };
      const tag = cellToString(get('tag'));
      const cableSize = cellToString(get('cable_size'));
      // Skip empty rows (no tag and no cable size = filler)
      if (!tag && !cableSize) return;
      allRows.push({
        tag,
        rating: cellToString(get('rating')),
        cable_size: cableSize,
        length_m: cellToNumber(get('length_m')),
        from: cellToString(get('from')),
        to: cellToString(get('to')),
        location: cellToString(get('location')),
        remarks: cellToString(get('remarks')),
      });
    });
  }
  return allRows;
}
