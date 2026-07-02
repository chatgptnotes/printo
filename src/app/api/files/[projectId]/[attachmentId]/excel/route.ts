import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { requireAuth } from '@/lib/shared/api-auth';
import { resolveAttachmentBinary } from '@/lib/drawing/file-resolver';

export const dynamic = 'force-dynamic';

interface SheetData {
  name: string;
  rows: (string | number | null)[][];
  rowCount: number;
  colCount: number;
}

// GET: Parse an Excel attachment into JSON sheets for inline viewing
export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string; attachmentId: string } }
) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const result = await resolveAttachmentBinary(params.projectId, params.attachmentId);
  if ('error' in result) {
    return NextResponse.json(result.error, { status: result.status });
  }

  // Parse with ExcelJS
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.buffer as unknown as ArrayBuffer);

    const sheets: SheetData[] = [];
    workbook.eachSheet((sheet) => {
      const rows: (string | number | null)[][] = [];
      let maxCol = 0;

      sheet.eachRow({ includeEmpty: false }, (row) => {
        const rowData: (string | number | null)[] = [];
        const colCount = row.cellCount;
        if (colCount > maxCol) maxCol = colCount;

        for (let i = 1; i <= colCount; i++) {
          const cell = row.getCell(i);
          const v = cell.value;
          if (v == null) {
            rowData.push(null);
          } else if (typeof v === 'object') {
            // Formula, hyperlink, rich text
            if ('result' in v && v.result != null) rowData.push(v.result as string | number);
            else if ('text' in v) rowData.push(v.text as string);
            else if ('richText' in v && Array.isArray(v.richText)) {
              rowData.push(v.richText.map((t: { text: string }) => t.text).join(''));
            } else if (v instanceof Date) {
              rowData.push(v.toLocaleDateString());
            } else {
              rowData.push(String(v));
            }
          } else {
            rowData.push(v as string | number);
          }
        }
        rows.push(rowData);
      });

      sheets.push({
        name: sheet.name,
        rows,
        rowCount: rows.length,
        colCount: maxCol,
      });
    });

    return NextResponse.json({ filename: result.filename, sheets });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Excel parse failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
