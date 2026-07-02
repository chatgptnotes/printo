/**
 * Full PDF→OCR pipeline for scanned (image-only) PDFs.
 *
 * Triggered ONLY when pdf-parse returns near-empty text (<200 chars over the
 * whole document) — a strong signal that the PDF is a scan with no embedded
 * text layer. Rasterises each page via pdfjs-dist + @napi-rs/canvas, then
 * tesseract.js OCR's the PNG. Pages capped at MAX_PAGES, total wall-time
 * capped at TOTAL_TIMEOUT_MS so a 50-page scan can't blow the function budget.
 *
 * Cost saved per scanned PDF: ~$0.20–0.50 in Sonnet vision tokens (one full
 * vision call over 5–10 pages of high-res raster).
 *
 * Vercel safety:
 *   - pdfjs-dist legacy build is pure JS (worker disabled by not bundling it)
 *   - @napi-rs/canvas ships prebuilt Linux x64 binaries that match Vercel's
 *     Lambda runtime; bundle adds ~25 MB
 *   - tesseract.js is pure WASM
 *
 * Why not always run OCR? Rendering + OCR'ing one A1 schematic page is 3–5 s.
 * For PDFs that already have an embedded text layer (98 % of consultant
 * uploads), pdf-parse is 50ms and OCR is wasted work. We only fire when
 * pdf-parse produced essentially nothing.
 */
import { runOcrOnImageBuffer } from '@/lib/pdf/ocr-image';

const MAX_PAGES = 5;
const TOTAL_TIMEOUT_MS = 25_000; // hard ceiling — caller's maxDuration is 300, but OCR is just one step
const RENDER_SCALE = 2.0;        // 2x scales gives 144 DPI, good enough for printed text
const MAX_PDF_BUFFER_BYTES = 30 * 1024 * 1024;

export interface PdfOcrResult {
  text: string;
  pages_ocred: number;
  durationMs: number;
  source: 'tesseract-pdf';
}

/**
 * Render a PDF buffer to PNG-per-page via pdfjs-dist + @napi-rs/canvas, OCR
 * each page with tesseract.js, return concatenated text. Fails soft — any
 * error returns null and the caller falls back to AI vision.
 */
export async function runOcrOnPdfBuffer(buffer: Buffer): Promise<PdfOcrResult | null> {
  if (!buffer || buffer.length === 0 || buffer.length > MAX_PDF_BUFFER_BYTES) return null;

  const start = Date.now();
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const { createCanvas } = await import('@napi-rs/canvas');

    const doc = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      isEvalSupported: false,
      useSystemFonts: false,
      verbosity: 0,
    }).promise;

    const pageLimit = Math.min(doc.numPages, MAX_PAGES);
    const parts: string[] = [];
    let pagesOcred = 0;

    for (let p = 1; p <= pageLimit; p++) {
      if (Date.now() - start > TOTAL_TIMEOUT_MS) {
        console.warn(`[ocr-pdf] hit ${TOTAL_TIMEOUT_MS}ms cap after ${pagesOcred} page(s)`);
        break;
      }

      const page = await doc.getPage(p);
      const viewport = page.getViewport({ scale: RENDER_SCALE });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext('2d');

      // pdfjs-dist's renderer expects a CanvasRenderingContext2D-shaped object.
      // @napi-rs/canvas's context is API-compatible enough for pdfjs's needs;
      // cast through unknown to satisfy TS without dragging in DOM types.
      await page.render({
        canvasContext: ctx as unknown as CanvasRenderingContext2D,
        viewport,
      } as never).promise;

      const png = canvas.toBuffer('image/png');
      page.cleanup();

      const ocr = await runOcrOnImageBuffer(png);
      if (ocr && ocr.text.length > 20) {
        parts.push(`--- Page ${p} ---\n${ocr.text}`);
        pagesOcred++;
      }
    }

    if (parts.length === 0) return null;
    return {
      text: parts.join('\n\n'),
      pages_ocred: pagesOcred,
      durationMs: Date.now() - start,
      source: 'tesseract-pdf',
    };
  } catch (err) {
    console.warn('[ocr-pdf] failed:', (err as Error).message);
    return null;
  }
}
