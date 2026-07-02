// Client-only "Export PDF" helper for the Plan & Wiring views. No extra deps.
//
// Uses a hidden same-origin <iframe> (NOT window.open) so browser pop-up blockers
// can't silently swallow it. It copies the page's stylesheets so Tailwind classes
// survive, writes the supplied body, waits for styles/fonts, then prints just the
// iframe — the user picks "Save as PDF". Used for both the SVG diagram and the data
// tables so each view prints exactly what's on screen (full content, not the crop).

export function printHtmlDocument(
  bodyHtml: string,
  opts: { title?: string; landscape?: boolean } = {},
): void {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  Object.assign(iframe.style, {
    position: 'fixed',
    right: '0',
    bottom: '0',
    width: '0',
    height: '0',
    border: '0',
    visibility: 'hidden',
  } as CSSStyleDeclaration);
  document.body.appendChild(iframe);

  const cw = iframe.contentWindow;
  const doc = cw?.document;
  if (!cw || !doc) {
    iframe.remove();
    return;
  }

  // Copy every linked stylesheet + inline <style> so the print frame renders with
  // the same Tailwind/utility styling as the app (the data tables rely on it). In
  // Next dev, CSS is injected as <style> tags; in prod it's <link> — both captured.
  const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
    .map((n) => n.outerHTML)
    .join('\n');

  const page = opts.landscape
    ? '@page { size: A4 landscape; margin: 10mm; }'
    : '@page { size: A4 portrait; margin: 12mm; }';

  doc.open();
  doc.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${opts.title || 'Export'}</title>
${styles}
<style>
  ${page}
  html, body { background: #fff; margin: 0; }
  /* Print backgrounds/colours so the coloured chips, bands and flags survive. */
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
</style></head><body>${bodyHtml}</body></html>`,
  );
  doc.close();

  let done = false;
  const trigger = () => {
    if (done) return;
    done = true;
    try {
      cw.focus();
      cw.print();
    } catch { /* frame torn down */ }
    // Remove after the dialog closes (afterprint), with a fallback in case it never fires.
    cw.addEventListener?.('afterprint', () => iframe.remove());
    setTimeout(() => iframe.remove(), 60_000);
  };

  // Wait for the copied stylesheets + fonts to load, else the first print is unstyled.
  const fontsReady = (doc as Document & { fonts?: FontFaceSet }).fonts?.ready;
  if (fontsReady) fontsReady.then(() => setTimeout(trigger, 250)).catch(() => setTimeout(trigger, 600));
  else setTimeout(trigger, 600);
  // Backstop: if neither path fires (some browsers), print after a hard delay.
  setTimeout(trigger, 1500);
}
