/**
 * DWG (binary AutoCAD) → readable form, defense-in-depth.
 *
 * DWG has no reliable pure-JS reader, so "making it work" means auto-converting
 * the moment it's encountered. Two paths, free first:
 *
 *   1. WASM (primary, $0):  LibreDWG-WASM converts DWG → DXF in-process, then we
 *      reuse the existing `extractDxfSummary()` to pull layers + TEXT/MTEXT. This
 *      gives the same text-grade context as a natively-uploaded DXF (no geometry
 *      vision, but every panel tag / layer name).
 *   2. CloudConvert (fallback, paid): if the WASM path yields nothing usable, and
 *      CLOUDCONVERT_API_KEY is set, render DWG → PDF for full vision scanning.
 *
 * If both are unavailable, the caller skips the file with the manual-conversion
 * guidance message (unchanged legacy behaviour).
 */

import { extractDxfSummary, type DxfSummaryResult } from './dxf-text-extractor';
import { convertDwgToPdf } from './cloudconvert';

// LibreDWG-WASM is loaded lazily and cached for the lifetime of the warm lambda
// so non-DWG requests never pay the WASM instantiation cost.
let _libredwg: Promise<{ dwg_write_dxf(input: ArrayBuffer): Uint8Array | null }> | null = null;
async function getLibreDwg() {
  if (!_libredwg) {
    _libredwg = (async () => {
      const mod = await import('@mlightcad/libredwg-web');
      // Node usage requires pointing at the wasm directory. Forward slashes work
      // on Windows and Linux; cwd is the project root on Vercel.
      const wasmDir = `${process.cwd().replace(/\\/g, '/')}/node_modules/@mlightcad/libredwg-web/wasm/`;
      return mod.LibreDwg.create(wasmDir);
    })();
  }
  return _libredwg;
}

export type DwgConvertResult =
  | { method: 'wasm-dxf'; dxfSummary: Extract<DxfSummaryResult, { ok: true }> }
  | { method: 'cloudconvert-pdf'; pdfBuffer: Buffer }
  | { method: 'failed'; error: string };

/**
 * Convert a DWG buffer. Tries the free WASM→DXF path first, then the
 * CloudConvert→PDF fallback. Never throws — failures are returned as
 * `{ method: 'failed' }` so the caller can skip the file gracefully.
 */
export async function convertDwg(filename: string, buffer: Buffer): Promise<DwgConvertResult> {
  // ── Path 1: free in-process WASM, DWG → DXF → existing DXF summary ──
  // Accept ANY successful parse — layer names alone are useful discipline +
  // tag context, and many drawings carry labels as block ATTRIBs (0 TEXT/MTEXT)
  // yet still convert fine, so we must not require text entities here.
  let wasmError = '';
  try {
    const libredwg = await getLibreDwg();
    // Slice to a standalone ArrayBuffer — a Node Buffer's underlying buffer is
    // pooled/shared, which would corrupt the WASM read.
    const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
    const dxfBytes = libredwg.dwg_write_dxf(ab);
    if (!dxfBytes || dxfBytes.length === 0) {
      wasmError = 'dwg_write_dxf returned null/empty (unsupported DWG version or corrupt file)';
    } else {
      const summary = extractDxfSummary(filename, Buffer.from(dxfBytes));
      if (summary.ok) {
        console.log(`[dwg] WASM→DXF ok for ${filename}: ${summary.layers.length} layers, ${summary.textEntities.length} text strings`);
        return { method: 'wasm-dxf', dxfSummary: summary };
      }
      wasmError = `DXF re-parse failed: ${summary.error}`;
    }
  } catch (e) {
    wasmError = (e as Error).message;
  }
  if (wasmError) console.warn(`[dwg] WASM convert failed for ${filename}: ${wasmError}`);

  // ── Path 2: paid CloudConvert fallback, DWG → PDF for vision ──
  let ccError = process.env.CLOUDCONVERT_API_KEY ? '' : 'no CLOUDCONVERT_API_KEY set';
  try {
    const pdf = await convertDwgToPdf(buffer, filename);
    if (pdf && pdf.length > 0) {
      return { method: 'cloudconvert-pdf', pdfBuffer: pdf };
    }
  } catch (e) {
    ccError = (e as Error).message;
    console.warn(`[dwg] CloudConvert fallback failed for ${filename}: ${ccError}`);
  }

  return {
    method: 'failed',
    error: `WASM[${wasmError || 'unknown'}] · CloudConvert[${ccError || 'returned no file'}]`,
  };
}
