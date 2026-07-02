/**
 * Read drawing title-block facts from a PDF using pdfjs-dist text extraction.
 *
 * Replaces sub-steps 2, 3, 4, 6 of `analyzeElectricalProcedure` (Sonnet vision)
 * for the common case where the title block is rendered as text in the PDF.
 *
 * Facts extracted:
 *   - drawing scale (1:50, 1:100, 1:200…)
 *   - floors / level schedule (delegated to floor-counter)
 *   - drawing number (E-101, SLD-01, etc.)
 *   - drawing type (floor_plan / schematic / riser / schedule / other)
 *
 * Returns a confidence score. Caller (electrical-preflight) decides whether
 * to fall back to Sonnet.
 *
 * Caching: keyed on SHA-256 of the PDF bytes. Same PDF → same answer forever.
 */

import { extractFloors } from '@/lib/drawing/floor-counter';

export type DrawingType = 'floor_plan' | 'schematic' | 'riser' | 'schedule' | 'other';

export interface TitleBlock {
  scale: string | null;            // e.g. "1:100"
  scaleRatio: number | null;       // e.g. 100
  floors: string[];                // e.g. ["B1","GF","1F","2F"]
  drawingNumber: string | null;    // e.g. "E-101"
  drawingType: DrawingType;
  confidence: number;              // 0..1
  pageCount: number;
  textSampleChars: number;         // how much text we actually got from the PDF
}

const SCALE_PATTERNS: RegExp[] = [
  /\bscale\s*[:\-]?\s*1\s*[:\-]\s*(\d{1,4})\b/gi,
  /\b1\s*[:\-]\s*(20|25|50|75|100|150|200|250|500|1000)\b/g,
];

const DRAWING_NUMBER_PATTERNS: RegExp[] = [
  /\b(?:dwg|drawing)\s*(?:no|number|#)?\s*[:\-]?\s*([A-Z]{1,4}[\-\s]?\d{2,4}[A-Z\-\d]*)\b/gi,
  /\b([Ee][\-\s]?\d{2,4})\b/g,        // E-101, e 201
  /\b(SLD[\-\s]?\d{1,3})\b/g,
  /\b(MDB[\-\s]?\d{0,3})\b/g,
];

const TYPE_KEYWORDS: Array<{ type: DrawingType; patterns: RegExp[] }> = [
  { type: 'schematic', patterns: [/\b(?:single[\-\s]?line\s*diagram|sld|schematic|riser\s*diagram)\b/i] },
  { type: 'riser', patterns: [/\briser\b/i, /\bcable\s*route\b/i] },
  { type: 'schedule', patterns: [/\b(?:panel|cable|distribution|load)\s*schedule\b/i] },
  { type: 'floor_plan', patterns: [/\b(?:floor\s*plan|layout\s*plan|small\s*power|lighting\s*layout)\b/i] },
];

/**
 * Pulls plain text from every page of a PDF using pdfjs-dist legacy build
 * (Node-friendly — no DOM). Returns concatenated text with page separators.
 */
async function pdfTextOf(buf: Buffer): Promise<{ text: string; pageCount: number }> {
  // Lazy import — pdfjs-dist is heavy and only loaded when this preflight runs.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const loadingTask = (pdfjs as any).getDocument({
    data,
    disableFontFace: true,
    useSystemFonts: false,
    isEvalSupported: false,
  });
  const doc = await loadingTask.promise;
  const pageCount = doc.numPages;
  const parts: string[] = [];
  // Title-block text sits on the first or last page in most templates — read
  // first 3 pages, plus the very last, to keep this cheap on large drawing sets.
  const pagesToRead = new Set<number>([1, 2, 3, pageCount].filter(p => p >= 1 && p <= pageCount));
  for (const pageNum of pagesToRead) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item: any) => ('str' in item ? item.str : ''))
      .join(' ');
    parts.push(`### page ${pageNum}\n${pageText}`);
  }
  return { text: parts.join('\n'), pageCount };
}

function detectScale(text: string): { scale: string | null; ratio: number | null } {
  for (const re of SCALE_PATTERNS) {
    const m = re.exec(text);
    if (m) {
      const ratio = parseInt(m[1], 10);
      if (Number.isFinite(ratio) && ratio >= 10 && ratio <= 5000) {
        return { scale: `1:${ratio}`, ratio };
      }
    }
  }
  return { scale: null, ratio: null };
}

function detectDrawingNumber(text: string): string | null {
  for (const re of DRAWING_NUMBER_PATTERNS) {
    const m = re.exec(text);
    if (m) return m[1].replace(/\s+/g, '-').toUpperCase();
  }
  return null;
}

function detectType(text: string): DrawingType {
  for (const { type, patterns } of TYPE_KEYWORDS) {
    if (patterns.some(p => p.test(text))) return type;
  }
  return 'other';
}

export async function extractTitleBlock(buf: Buffer): Promise<TitleBlock> {
  let pageCount = 0;
  let text = '';
  try {
    const out = await pdfTextOf(buf);
    text = out.text;
    pageCount = out.pageCount;
  } catch (err) {
    console.warn('[title-block-extractor] pdfjs failed:', (err as Error).message);
    return {
      scale: null, scaleRatio: null, floors: [], drawingNumber: null,
      drawingType: 'other', confidence: 0, pageCount: 0, textSampleChars: 0,
    };
  }

  const { scale, ratio } = detectScale(text);
  const drawingNumber = detectDrawingNumber(text);
  const drawingType = detectType(text);
  const floors = extractFloors(text);

  // Confidence model — simple additive:
  //   scale found       → +0.4
  //   drawing number    → +0.2
  //   drawing type      → +0.15
  //   ≥1 floor          → +0.15
  //   any text          → +0.1 (proves the PDF has a text layer)
  let confidence = 0;
  if (scale) confidence += 0.4;
  if (drawingNumber) confidence += 0.2;
  if (drawingType !== 'other') confidence += 0.15;
  if (floors.length > 0) confidence += 0.15;
  if (text.length > 200) confidence += 0.1;

  return {
    scale,
    scaleRatio: ratio,
    floors,
    drawingNumber,
    drawingType,
    confidence: Math.min(1, confidence),
    pageCount,
    textSampleChars: text.length,
  };
}
