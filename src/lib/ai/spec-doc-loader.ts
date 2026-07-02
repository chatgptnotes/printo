/**
 * Load plain text from a specification document so the brand-dictionary
 * heuristic in `spec-analyzer.ts` can scan it without paying Sonnet to read
 * the file via vision.
 *
 * Supported sources (best-effort, in priority order):
 *   - DOCX (mammoth — fast, accurate)
 *   - PDF text layer (pdfjs-dist — works for vendor-issued PDFs)
 *   - Plain text / unknown — pass through buffer.toString()
 *
 * OCR (tesseract.js) is intentionally NOT wired here yet — image-only spec
 * scans are still routed to Sonnet vision via the `pdf-text-poor` confidence
 * branch, so we don't pay the 10 MB WASM cost on every cold start.
 */

export type SpecDocSource = 'docx' | 'pdf-text' | 'plain' | 'pdf-text-poor' | 'unknown';

export interface SpecDocResult {
  text: string;
  source: SpecDocSource;
  confidence: number;            // 0..1
  pageCount?: number;
}

const PDF_POOR_TEXT_THRESHOLD = 200; // chars total across all pages

function isDocx(mime: string, filename: string): boolean {
  return (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    /\.docx$/i.test(filename)
  );
}

function isPdf(mime: string, filename: string): boolean {
  return mime === 'application/pdf' || /\.pdf$/i.test(filename);
}

function isPlain(mime: string, filename: string): boolean {
  return mime.startsWith('text/') || /\.(txt|md)$/i.test(filename);
}

async function loadDocx(buf: Buffer): Promise<string> {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ buffer: buf });
  return (result.value ?? '').trim();
}

async function loadPdfText(buf: Buffer): Promise<{ text: string; pageCount: number }> {
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
  for (let p = 1; p <= pageCount; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    parts.push(content.items.map((it: any) => ('str' in it ? it.str : '')).join(' '));
  }
  return { text: parts.join('\n').trim(), pageCount };
}

export async function loadSpecDoc(
  buf: Buffer,
  mime: string,
  filename = '',
): Promise<SpecDocResult> {
  try {
    if (isDocx(mime, filename)) {
      const text = await loadDocx(buf);
      return {
        text,
        source: 'docx',
        confidence: text.length > 200 ? 0.95 : 0.4,
      };
    }

    if (isPdf(mime, filename)) {
      const { text, pageCount } = await loadPdfText(buf);
      const poor = text.length < PDF_POOR_TEXT_THRESHOLD;
      return {
        text,
        source: poor ? 'pdf-text-poor' : 'pdf-text',
        confidence: poor ? 0.2 : 0.85,
        pageCount,
      };
    }

    if (isPlain(mime, filename)) {
      const text = buf.toString('utf-8').trim();
      return { text, source: 'plain', confidence: 0.9 };
    }
  } catch (err) {
    console.warn(`[spec-doc-loader] ${filename || '(unnamed)'} failed: ${(err as Error).message}`);
  }

  return { text: '', source: 'unknown', confidence: 0 };
}
