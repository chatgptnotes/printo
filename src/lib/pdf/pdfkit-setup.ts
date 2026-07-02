// Monkey-patch fs.readFileSync to serve pdfkit's standard AFM font metrics
// and sRGB ICC profile from memory. This must be imported BEFORE `pdfkit`
// so the first StandardFont lookup finds our in-memory data.
//
// Why: on Vercel serverless, @vercel/nft does not trace the dynamic paths
// pdfkit uses (`fs.readFileSync(__dirname + '/data/Helvetica.afm', 'utf8')`),
// and the pnpm symlinked node_modules layout prevents outputFileTracingIncludes
// from bundling them either. Rather than fight the bundler, we inline the
// font metrics at build time (see scripts/generate-pdfkit-fonts.mjs) and
// intercept the file reads here.

import fs from 'node:fs';
import { PDFKIT_AFM_FONTS, PDFKIT_ICC_BASE64 } from './pdfkit-fonts.generated';

let patched = false;

export function ensurePdfkitFontsPatched(): void {
  if (patched) return;
  patched = true;

  const originalReadFileSync = fs.readFileSync.bind(fs);

  (fs as any).readFileSync = function patchedReadFileSync(
    filePath: any,
    options?: any,
  ) {
    if (typeof filePath === 'string') {
      // Match ".../pdfkit/js/data/<Name>.afm" on any OS
      const afmMatch = filePath.match(/pdfkit[/\\]js[/\\]data[/\\]([^/\\]+)\.afm$/);
      if (afmMatch) {
        const fontName = afmMatch[1];
        const data = PDFKIT_AFM_FONTS[fontName];
        if (data) return data;
      }

      // Match ".../pdfkit/js/data/sRGB_IEC61966_2_1.icc"
      if (filePath.endsWith('sRGB_IEC61966_2_1.icc') && PDFKIT_ICC_BASE64) {
        return Buffer.from(PDFKIT_ICC_BASE64, 'base64');
      }
    }

    return originalReadFileSync(filePath, options);
  };
}

ensurePdfkitFontsPatched();
