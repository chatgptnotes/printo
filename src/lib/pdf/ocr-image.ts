/**
 * Tesseract.js OCR for image attachments (PNG/JPG only).
 *
 * Currently the extract pipeline sends PNG/JPG drawings straight to Claude Sonnet
 * vision. Vision is good at reasoning about geometry, but it's overkill (and
 * expensive) when the image contains plain printed text — drawing title blocks,
 * panel schedules, room labels, etc. OCR runs first to harvest the easy text;
 * Sonnet then handles only the visual reasoning that needs it.
 *
 * Why image-only (no PDF→OCR)? Rendering PDF pages to raster on Vercel needs
 * @napi-rs/canvas + pdfjs-dist (~90 MB extra deploy size) and tesseract takes
 * 3–5 sec/page — on the 10-sec free-tier function limit a 3-page scan blows up.
 * Image attachments ship as raster already and tesseract.js handles them
 * directly via WASM. PDF text is still extracted via the existing pdf-parse
 * pathway; image-based PDFs continue to fall through to AI vision.
 *
 * Cost saved: ~$0.05–0.20 per drawing (less vision tokens spent reading text
 * the OCR pass already harvested).
 *
 * Vercel safety: tesseract.js v5 ships pure WASM. Worker downloads ~10 MB of
 * eng.traineddata on first invocation per cold start (cached in /tmp). No
 * native binaries.
 */
import { createWorker, type Worker } from 'tesseract.js';

const MAX_OCR_BUFFER_BYTES = 5 * 1024 * 1024; // 5 MB — tesseract chokes on huge images
const OCR_TIMEOUT_MS = 8000; // 8 sec per image — keeps us under the 10-sec free-tier limit

let workerPromise: Promise<Worker> | null = null;

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker('eng', 1, {
      // 'AUTO' page-segmentation mode handles drawing labels well; explicit
      // PSM_AUTO=3. Letting tesseract auto-detect page layout is what we want
      // for mixed-content drawings.
      logger: () => {},
    });
  }
  return workerPromise;
}

export interface OcrResult {
  text: string;
  confidence: number;
  source: 'tesseract';
  durationMs: number;
}

/**
 * Run OCR on a raster image buffer (PNG/JPG/WebP). Returns null when the
 * buffer is too large, OCR throws, or the recognised text is essentially
 * empty (<20 chars) — caller should fall through to AI vision in that case.
 */
export async function runOcrOnImageBuffer(buffer: Buffer): Promise<OcrResult | null> {
  if (!buffer || buffer.length === 0 || buffer.length > MAX_OCR_BUFFER_BYTES) return null;

  const start = Date.now();
  try {
    const worker = await Promise.race([
      getWorker(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('worker init timeout')), OCR_TIMEOUT_MS)),
    ]);

    const job = worker.recognize(buffer);
    const result = await Promise.race([
      job,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('OCR timeout')), OCR_TIMEOUT_MS)),
    ]);

    const text = (result.data?.text ?? '').trim();
    const confidence = (result.data?.confidence ?? 0) / 100;
    if (text.length < 20) return null;

    return {
      text,
      confidence,
      source: 'tesseract',
      durationMs: Date.now() - start,
    };
  } catch (err) {
    console.warn('[ocr] failed:', (err as Error).message);
    return null;
  }
}

/** Best-effort cleanup — call from a route's `finally` if you spawned a worker. */
export async function shutdownOcrWorker(): Promise<void> {
  if (!workerPromise) return;
  try {
    const w = await workerPromise;
    await w.terminate();
  } catch {}
  workerPromise = null;
}
