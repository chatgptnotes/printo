// Two-column "What George said vs How we solved it" report for the SABI cable
// take-off review. Left column = George's own words (verbatim from the review);
// right column = the fix. Run: node scripts/generate-fix-report-pdf.mjs
// Output: docs/CABLE_BOQ_ACCURACY_FIXES.pdf
import PDFDocument from 'pdfkit';
import { createWriteStream, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const NAVY = '#1F3A5F';
const BLUE = '#2E5A8C';
const GREEN = '#1B7A3D';
const GREY = '#555555';
const BORDER = '#C9D2DD';

if (!existsSync('docs')) mkdirSync('docs', { recursive: true });
const out = resolve('docs/CABLE_BOQ_ACCURACY_FIXES.pdf');

const doc = new PDFDocument({ size: 'A4', margins: { top: 50, bottom: 50, left: 50, right: 50 } });
doc.pipe(createWriteStream(out));

const M = 50;
const W = doc.page.width - M * 2;
const BOTTOM = doc.page.height - 50;

// Column geometry
const LW = Math.round(W * 0.48); // left: George
const RW = W - LW;               // right: fix
const PADX = 9, PADY = 7;

function measure(text, width, font, size) {
  doc.font(font).fontSize(size);
  return doc.heightOfString(text, { width });
}

function titleBar(title, sub) {
  const y = doc.y;
  const subH = sub ? measure(sub, W - 24, 'Helvetica', 9) : 0;
  const h = sub ? Math.max(46, 24 + subH + 8) : 30;
  doc.rect(M, y, W, h).fill(NAVY);
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(13).text(title, M + 12, y + 7, { width: W - 24 });
  if (sub) doc.fillColor('#C9D8EC').font('Helvetica').fontSize(9).text(sub, M + 12, y + 26, { width: W - 24 });
  doc.fillColor('#000000');
  doc.y = y + h + 10;
}

function headerRow() {
  const y = doc.y;
  doc.rect(M, y, LW, 20).fill(BLUE);
  doc.rect(M + LW, y, RW, 20).fill(GREEN);
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(10);
  doc.text('What George said', M + PADX, y + 5, { width: LW - PADX * 2 });
  doc.text('How we solved it', M + LW + PADX, y + 5, { width: RW - PADX * 2 });
  doc.fillColor('#000000');
  doc.y = y + 20;
}

// One table row: George's verbatim quote (left) and the fix (right).
function row(saidText, fixText, alt) {
  const said = `“${saidText}”`; // curly quotes around George's words
  const hL = measure(said, LW - PADX * 2, 'Helvetica-Oblique', 9);
  const hR = measure(fixText, RW - PADX * 2, 'Helvetica', 9);
  const rh = Math.max(hL, hR) + PADY * 2;

  if (doc.y + rh > BOTTOM) { doc.addPage(); headerRow(); }
  const y = doc.y;
  if (alt) doc.rect(M, y, W, rh).fill('#F5F8FB');
  // borders
  doc.lineWidth(0.5).strokeColor(BORDER);
  doc.rect(M, y, LW, rh).stroke();
  doc.rect(M + LW, y, RW, rh).stroke();
  // text
  doc.fillColor('#222222').font('Helvetica-Oblique').fontSize(9)
     .text(said, M + PADX, y + PADY, { width: LW - PADX * 2, lineGap: 2 });
  doc.fillColor('#1A1A1A').font('Helvetica').fontSize(9)
     .text(fixText, M + LW + PADX, y + PADY, { width: RW - PADX * 2, lineGap: 2 });
  doc.fillColor('#000000');
  doc.y = y + rh;
}

// ── Document ──
titleBar('CABLE TAKE-OFF REVIEW',
         'SABI project - electrical power drawing - cable quantity.  Left column: George\'s own words from the review.  Right column: the fix applied.');

doc.font('Helvetica').fontSize(9.5).fillColor('#333333')
   .text('Scope of the review (in George\'s words): "Right now, the cable is being checked only in the power drawing. In the power drawing, our main focus was on cable quantity. We looked at the procedure for how the cable quantity is arrived at."',
     M, doc.y, { width: W, lineGap: 2 });
doc.moveDown(0.8);
doc.fillColor('#000000');

headerRow();

const ROWS = [
  [
    'This is the first part: LV Panel to SMDB listing. All SMDBs must be listed, and next to each SMDB, the cable length and cable size should be written. The cable size is taken from the schematic drawing. It will be written there as a line description, for example, 150 sq.mm.',
    'Every SMDB is now listed with its cable length and a short cable-size line (e.g. 150 sq.mm) read from the schematic - shown in a dedicated Cable Size column, not a long paragraph.',
  ],
  [
    'But in the data you provided, a large description is shown. It is not clear where that was taken from. I feel that details from another project, possibly an Indian project, may have been mixed here. Because of that, a small mismatch may have happened.',
    'The other project\'s example quantities (about 12,000 / 6,000 / 2,400 / 1,800 m) were being fed to the AI and copied across - these are removed. The AI now derives everything from this building only, and the long boilerplate prints once per section, not on every line.',
  ],
  [
    'We take the cable length from the LV Panel to each SMDB. First, we check this on the ground floor. I have checked it, and it has come almost matching. After that, as we go up each floor, approximately 5 meters is added. This should be established as the height difference.',
    'The rising length is now CALCULATED by the system - the ground-floor run as the baseline, then the floor-to-floor height added for each floor going up - instead of being left to the AI. A confident, measured reading is never overwritten, so the close ground-floor match is kept.',
  ],
  [
    'Even if it does not match exactly, there may be a small difference. To understand why that difference exists, we need to know who prepared it and what procedure they used.',
    'Agreed - a small residual can remain. Anything the system estimates is now clearly flagged PROVISIONAL, and the take-off follows the stated procedure so any gap is explainable. Confirming the original preparer\'s method stays a human step.',
  ],
  [
    'The second part is SMDB to DB. Typical floors, for example from the 7th floor upward, will usually be the same. So one floor can be calculated and then multiplied by 8 or 16. But it seems this has not been done here. That is why the quantity appears to be very different.',
    'The typical floor is now multiplied across all the repeating floors automatically - for buildings above 7 typical floors, exactly as you said. Floors read only part-way are completed too, and a board already read is never double-counted.',
  ],
  [
    'The correct approach is to prepare a floor-wise schedule. Measurements should be taken floor by floor, quantities should be calculated, and a schedule should be prepared.',
    'The SMDB to DB take-off is now produced as a floor-wise schedule - one row per floor per DB - and the result can be reviewed floor by floor (a tool prints each floor\'s board count and length).',
  ],
  [
    'For lighting fittings, each floor may have different types. The correct reference type must be taken from the drawing, specifically the reference for this project only. References from another project or from a home project should not be used. The naming must be created by reading the drawing itself. A floor-wise breakup should be done. But this approach is not visible here. That is the main issue.',
    'Lighting references are now read from THIS project\'s own drawing legend and counted floor by floor into a per-floor schedule. If the legend genuinely cannot be read, the placeholder list is clearly stamped "GENERIC ESTIMATE - not read from drawing / PROVISIONAL" so it is never taken as a project-specific count.',
  ],
  [
    'The total is not matching. So there is a doubt whether this is a project-specific calculation. If we speak to the person who prepared it, we will get clarity on whether they followed this procedure or copied it from another project and adjusted it.',
    'With the other-project numbers removed, the floor-wise multiplication in place, and lengths computed by the system, the total is now built only from this drawing. Anything estimated is flagged, so it cannot quietly inflate the total. The final confirmation is a side-by-side check of one real scan against a trusted reference (a tool is ready for that).',
  ],
];

ROWS.forEach((r, i) => row(r[0], r[1], i % 2 === 1));

// ── On-screen (UI) section ──
function sectionBar(text) {
  if (doc.y + 60 > BOTTOM) doc.addPage();
  doc.moveDown(0.8);
  const y = doc.y;
  doc.rect(M, y, W, 22).fill(NAVY);
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(11).text(text, M + 10, y + 5, { width: W - 20 });
  doc.fillColor('#000000');
  doc.y = y + 22 + 8;
}
function bullet(text) {
  if (doc.y + 30 > BOTTOM) doc.addPage();
  const indent = 14, startY = doc.y;
  doc.fillColor('#1A1A1A').font('Helvetica').fontSize(9.5).text('-', M, startY);
  doc.text(text, M + indent, startY, { width: W - indent, lineGap: 2.5 });
  doc.moveDown(0.4);
}

sectionBar('What we also added on screen (Plan -> Data tab)');
doc.font('Helvetica').fontSize(9.5).fillColor('#333333')
   .text('So the cable take-off can be checked on screen - every length now shows how it was worked out, and a panel explains the method and your rule:',
     M, doc.y, { width: W, lineGap: 2 });
doc.moveDown(0.5);
doc.fillColor('#000000');
bullet('Each cable line shows WHERE its length came from (on hover): "measured from drawing scale", "est. from floor height: 4 + (floors climbed x height) + 0.5 = ... m", "copied from typical floor", or "on-floor run from plan" - so the number can never disagree with its method.');
bullet('A "How cable lengths were worked out" panel shows the floor-to-floor height (read from the drawing title block), the riser formula, and a per-floor riser-climb breakdown (how many floor-heights up each floor sits).');
bullet('When typical floors are multiplied, the panel states it plainly: "Repeating floors above the typical floor reuse its lengths (per George\'s rule)."');
bullet('The panel spells out your rule directly: buildings taller than 7 floors reuse the typical floor\'s lengths for the floors above; shorter buildings are counted floor by floor.');
bullet('Lines that need a manual check are highlighted so they stand out for review.');

doc.moveDown(0.8);
doc.fillColor(GREY).font('Helvetica-Oblique').fontSize(8)
   .text('Left column quotes are George\'s own words from the cable take-off review (translated). Internal note for review and sign-off.',
     M, doc.y, { width: W });

doc.end();
console.log('Wrote', out);
