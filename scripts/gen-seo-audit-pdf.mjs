import PDFDocument from 'pdfkit';
import fs from 'fs';

const OUT = 'C:\\Users\\ACER\\OneDrive\\Desktop\\realsoft-SEO-Audit-2026-05-27.pdf';

const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
doc.pipe(fs.createWriteStream(OUT));

const PAGE_W = doc.page.width;
const L = doc.page.margins.left;
const R = doc.page.width - doc.page.margins.right;
const CW = R - L;

const C = {
  ink: '#1a1a2e', sub: '#555', line: '#dcdce4',
  blue: '#1d4ed8', green: '#15803d', amber: '#b45309', red: '#b91c1c',
  band: '#f1f5f9', white: '#ffffff',
};

function hr(y) { doc.moveTo(L, y).lineTo(R, y).lineWidth(0.6).strokeColor(C.line).stroke(); }

function h2(text) {
  if (doc.y > 720) doc.addPage();
  doc.moveDown(0.6);
  doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(13).text(text, L, doc.y);
  hr(doc.y + 3);
  doc.moveDown(0.5);
}

function para(text, opts = {}) {
  doc.fillColor(opts.color || C.sub).font(opts.font || 'Helvetica').fontSize(opts.size || 10)
    .text(text, { width: CW, align: opts.align || 'left', lineGap: 2 });
}

// rows: [{ cells:[...], color?, bold? }], cols: width fractions
function table(headers, rows, fractions) {
  const colW = fractions.map(f => f * CW);
  let y = doc.y;
  const rowH = (cells, isHead) => {
    doc.font(isHead ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
    let max = 0;
    cells.forEach((c, i) => {
      const h = doc.heightOfString(String(c), { width: colW[i] - 10 });
      if (h > max) max = h;
    });
    return max + 8;
  };
  const drawRow = (cells, isHead, rowColor) => {
    const h = rowH(cells, isHead);
    if (y + h > 790) { doc.addPage(); y = doc.y; }
    if (isHead) { doc.rect(L, y, CW, h).fill(C.ink); }
    else { doc.rect(L, y, CW, h).fill(C.white); }
    let x = L;
    cells.forEach((c, i) => {
      doc.font(isHead ? 'Helvetica-Bold' : 'Helvetica').fontSize(9)
        .fillColor(isHead ? C.white : (rowColor || C.ink))
        .text(String(c), x + 5, y + 4, { width: colW[i] - 10 });
      x += colW[i];
    });
    doc.moveTo(L, y + h).lineTo(R, y + h).lineWidth(0.4).strokeColor(C.line).stroke();
    y += h;
  };
  drawRow(headers, true);
  rows.forEach(r => drawRow(r.cells, false, r.color));
  doc.y = y + 6;
}

function bullet(text, color) {
  const x = L + 12;
  const startY = doc.y;
  doc.circle(L + 5, startY + 5, 1.8).fill(color || C.blue);
  doc.fillColor(C.sub).font('Helvetica').fontSize(10)
    .text(text, x, startY, { width: CW - 12, lineGap: 2 });
  doc.moveDown(0.2);
}

// ---------- COVER HEADER ----------
doc.rect(0, 0, PAGE_W, 110).fill(C.ink);
doc.fillColor(C.white).font('Helvetica-Bold').fontSize(24).text('SEO Audit Report', L, 34);
doc.fillColor('#9fb3d1').font('Helvetica').fontSize(12).text('realsoft.example  —  SABI RFQ-to-BOQ Pipeline', L, 66);
doc.fillColor('#7e93b5').fontSize(9).text('Generated 2026-05-27  ·  Audited against live production + source code', L, 86);
doc.y = 130;

// ---------- VERDICT ----------
doc.moveDown(0.3);
doc.rect(L, doc.y, CW, 56).fill(C.band);
const vy = doc.y;
doc.fillColor(C.amber).font('Helvetica-Bold').fontSize(14).text('Overall SEO Grade:  C-  /  Needs Work', L + 14, vy + 10);
doc.fillColor(C.sub).font('Helvetica').fontSize(9.5)
  .text('The application runs with zero errors (clean TypeScript compile, clean production build, all pages serving). On the SEO dimension specifically, several standard elements are missing.', L + 14, vy + 30, { width: CW - 28 });
doc.y = vy + 64;

// ---------- WHAT WORKS ----------
h2('What is working correctly (no errors)');
table(
  ['Element', 'Status', 'Evidence'],
  [
    { cells: ['Site availability', 'PASS', 'HTTP 200, ~0.5s response on all public pages'], color: C.green },
    { cells: ['HTTPS enforced', 'PASS', 'www to apex 307 redirect'], color: C.green },
    { cells: ['<title> present', 'PASS', '"ERP Realsoft - RFQ to BOQ Pipeline"'], color: C.green },
    { cells: ['<meta description>', 'PASS', '"Automated MEP estimation pipeline for ERP Realsoft UAE"'], color: C.green },
    { cells: ['<html lang="en">', 'PASS', 'Set in root layout'], color: C.green },
    { cells: ['Mobile viewport', 'PASS', 'width=device-width, initial-scale=1'], color: C.green },
    { cells: ['Single H1 per page', 'PASS', 'Landing page has exactly one H1'], color: C.green },
    { cells: ['404 handling', 'PASS', 'Returns noindex + proper not-found page'], color: C.green },
    { cells: ['App icons', 'PARTIAL', '/icon.svg 200, /apple-icon.png 200'], color: C.green },
    { cells: ['Charset', 'PASS', 'UTF-8'], color: C.green },
  ],
  [0.26, 0.14, 0.60]
);

// ---------- MISSING ----------
h2('Missing / weak for SEO (findings)');
table(
  ['#', 'Issue', 'Severity', 'Detail'],
  [
    { cells: ['1', '/robots.txt -> 404', 'HIGH', 'No robots file. Crawlers have no directives. No src/app/robots.ts.'], color: C.red },
    { cells: ['2', '/sitemap.xml -> 404', 'HIGH', 'No sitemap. Search engines cannot discover pages.'], color: C.red },
    { cells: ['3', 'No Open Graph tags', 'MEDIUM', 'No og:title/description/image/url. Shared links render no preview.'], color: C.amber },
    { cells: ['4', 'No Twitter Card tags', 'MEDIUM', 'No twitter:card / twitter:image.'], color: C.amber },
    { cells: ['5', 'No per-page metadata', 'MEDIUM', 'Only root layout exports metadata; every page shares one title.'], color: C.amber },
    { cells: ['6', 'No canonical tags', 'MEDIUM', 'No rel="canonical"; apex vs www duplicate-content risk.'], color: C.amber },
    { cells: ['7', '/favicon.ico -> 404', 'LOW', 'icon.svg exists but classic favicon.ico 404s.'], color: C.amber },
    { cells: ['8', 'Keyword-thin copy', 'LOW', 'Title/description omit searchable terms (MEP estimating Dubai, BOQ automation UAE).'], color: C.amber },
    { cells: ['9', 'No structured data', 'LOW', 'No Organization / SoftwareApplication JSON-LD.'], color: C.amber },
    { cells: ['10', 'No metadataBase', 'LOW', 'Needed by Next.js to emit absolute OG URLs.'], color: C.amber },
  ],
  [0.05, 0.27, 0.13, 0.55]
);

// ---------- CONTEXT ----------
h2('Important context');
para('The app is a login-gated internal pipeline. Pages such as /bids, /inbox and /admin should NOT be indexed, so their lack of SEO is acceptable (ideally they would be explicitly noindex). The SEO that matters is the public /landing page, which is where findings 1-9 actually cost visibility.');

// ---------- RECOMMENDATIONS ----------
h2('Recommended fixes (low-risk, Next.js 14 native)');
para('These are additive metadata files and do not change application logic:', { color: C.ink, font: 'Helvetica-Bold', size: 10 });
doc.moveDown(0.3);
bullet('Add src/app/robots.ts - allow crawling, link sitemap, disallow /api, /admin, /bids.', C.blue);
bullet('Add src/app/sitemap.ts - list public routes (/, /landing, /auth/login).', C.blue);
bullet('Enrich root metadata - add metadataBase, openGraph, twitter, keywords, OG image.', C.blue);
bullet('Add export const metadata to /landing - unique title + description.', C.blue);
bullet('Add noindex to authenticated route layouts.', C.blue);
bullet('Add a favicon.ico (or src/app/favicon.ico).', C.blue);

// ---------- METHODOLOGY ----------
h2('Methodology');
para('Live HTTP probes (curl) of robots.txt, sitemap.xml, favicon, public pages, and HTML <head>; static inspection of src/app/layout.tsx, middleware.ts and metadata exports; verified build health via tsc --noEmit (0 errors) and next build (success).', { size: 9 });

// ---------- FOOTER on all pages ----------
const range = doc.bufferedPageRange();
for (let i = 0; i < range.count; i++) {
  doc.switchToPage(range.start + i);
  doc.fillColor('#9aa0ac').font('Helvetica').fontSize(8)
    .text('realsoft.example  ·  SEO Audit  ·  2026-05-27', L, 808, { width: CW, align: 'left' });
  doc.text('Page ' + (i + 1) + ' of ' + range.count, L, 808, { width: CW, align: 'right' });
}

doc.end();
console.log('PDF written to: ' + OUT);
