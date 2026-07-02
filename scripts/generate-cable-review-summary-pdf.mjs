#!/usr/bin/env node
// One-off: plain-English PDF summarising George's P-379 cable-BOQ review,
// what we fixed, what's pending, and the "+5 m per floor" rule.
import fs from 'fs';
import PDFDocument from 'pdfkit';

const OUT = 'D:\\office\\draw to boq\\SABI_Cable_BOQ_Review_Summary.pdf';

const NAVY = '#1F4E79';
const BLUE = '#2E75B6';
const GREEN = '#548235';
const TEXT = '#333333';
const GREY = '#666666';
const ZEBRA = '#F0F4F8';
const AMBER = '#B7791F';

const LEFT = 50;
const WIDTH = 495; // A4 (595) - 2*50

function heading(doc, text) {
  doc.moveDown(0.8);
  doc.fontSize(15).font('Helvetica-Bold').fillColor(NAVY).text(text, LEFT, doc.y, { width: WIDTH });
  doc.moveDown(0.4);
}

function body(doc, text, opts = {}) {
  doc.fontSize(11).font('Helvetica').fillColor(TEXT).text(text, LEFT, doc.y, { width: WIDTH, ...opts });
  doc.moveDown(0.3);
}

function bullet(doc, text) {
  doc.fontSize(11).font('Helvetica').fillColor(TEXT).text('•  ' + text, LEFT + 8, doc.y, { width: WIDTH - 8 });
  doc.moveDown(0.2);
}

function generate() {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const stream = fs.createWriteStream(OUT);
    doc.pipe(stream);

    // ── Cover ──
    doc.moveDown(5);
    doc.fontSize(28).font('Helvetica-Bold').fillColor(NAVY)
      .text('SABI Power BOQ', { align: 'center' });
    doc.fontSize(28).fillColor(BLUE)
      .text('Cable Review — What We Did', { align: 'center' });
    doc.moveDown(1.5);
    doc.fontSize(13).font('Helvetica').fillColor(GREY)
      .text('Project: P-379 (SABI)', { align: 'center' });
    doc.text("Subject: George's review of the cable BOQ vs the drawing", { align: 'center' });
    doc.text('Date: 19 June 2026', { align: 'center' });
    doc.moveDown(3);
    doc.fontSize(10).fillColor('#999999')
      .text('Plain-language summary for internal explanation', { align: 'center' });

    // ── Background ──
    doc.addPage();
    heading(doc, 'Background');
    body(doc,
      'George (Technical Director) checked our cable BOQ for the SABI / P-379 project against ' +
      'the actual drawing. He pointed out 3 problems. This note explains, in simple words, what ' +
      'each problem was, what we did about it, and what is still left to do.');

    // ── The 3 things, status table ──
    heading(doc, 'The 3 problems George raised, and what we did');

    const rows = [
      ['1', 'Cable descriptions were too long and looked copied from another (Indian) project.',
        'Added a clean "Cable Size" column and short route text. The long spec is printed once, not on every line.', 'DONE'],
      ['2', 'Cables were not counted floor by floor. The drawing gave a shortcut (2 lines hiding ~120 real cables), and some boards were counted twice.',
        'System now opens the shortcut into one row per floor per DB (2 lines became 120) and removes the double-counts.', 'DONE'],
      ['3', 'Lighting fittings were hard-coded and looked taken from another project.',
        'Lighting is now read from THIS project\'s drawing legend, floor by floor, then totalled.', 'DONE'],
    ];

    const cols = [22, 165, 230, 50]; // sums to 467, fits within 495 with small gaps
    const cx = [LEFT, LEFT + 28, LEFT + 200, LEFT + 440];

    // header
    let y = doc.y + 4;
    doc.rect(LEFT, y, WIDTH, 22).fill(NAVY);
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#FFFFFF');
    doc.text('#', cx[0], y + 6, { width: cols[0] });
    doc.text('What George said', cx[1], y + 6, { width: cols[1] });
    doc.text('What we did', cx[2], y + 6, { width: cols[2] });
    doc.text('Status', cx[3], y + 6, { width: cols[3] });
    y += 22;

    rows.forEach((r, i) => {
      // measure row height from the tallest cell
      doc.fontSize(9).font('Helvetica');
      const hSaid = doc.heightOfString(r[1], { width: cols[1] });
      const hDid = doc.heightOfString(r[2], { width: cols[2] });
      const rowH = Math.max(hSaid, hDid, 16) + 12;

      if (i % 2 === 0) doc.rect(LEFT, y, WIDTH, rowH).fill(ZEBRA);
      doc.fillColor(TEXT).font('Helvetica').fontSize(9);
      doc.text(r[0], cx[0], y + 6, { width: cols[0] });
      doc.text(r[1], cx[1], y + 6, { width: cols[1] });
      doc.text(r[2], cx[2], y + 6, { width: cols[2] });
      doc.font('Helvetica-Bold').fillColor(GREEN).text(r[3], cx[3], y + 6, { width: cols[3] });
      y += rowH;
    });
    doc.y = y + 10;

    body(doc, 'Important: problems 2 and 3 can only be done well if the uploaded drawing is clear. ' +
      'The logic is there for every project, but it feeds on the quality of the drawing data.');

    // ── Still pending ──
    heading(doc, 'Still pending');
    bullet(doc, 'The old saved sample file (docs/p379-power-boq-industry.xlsx) still shows the OLD wrong numbers. ' +
      'Only the live app has the fixes; that one sample file was not updated.');
    bullet(doc, 'George\'s "+5 metres per floor" rule is NOT in the code. A person still has to check this by hand.');

    // ── The +5m rule ──
    doc.addPage();
    heading(doc, 'What is the "+5 metres per floor" rule?');
    body(doc, 'The main power panel (LV Panel) sits on the ground floor. From there one big cable runs up to ' +
      'each floor\'s board (SMDB) — usually one per floor.');
    body(doc, 'A cable going to a higher floor must be longer, because it climbs higher. George\'s rule of thumb is:');
    doc.fontSize(12).font('Helvetica-Bold').fillColor(BLUE)
      .text('Every floor you go up, add about 5 metres of cable.', LEFT + 8, doc.y, { width: WIDTH - 8 });
    doc.moveDown(0.4);
    body(doc, 'Example: Ground = 20 m, 1st floor ≈ 25 m, 2nd ≈ 30 m, 3rd ≈ 35 m, and so on.');
    body(doc, 'It is a quick sanity-check, NOT an exact number. George himself said small differences are acceptable. ' +
      'Right now our app uses whatever length the drawing gives and does not apply this check automatically.');

    // ── Should it apply to future projects ──
    heading(doc, 'Should this rule apply to all future projects?');
    body(doc, 'Yes — but only as a CHECK / WARNING, never as a forced number. There are two ways to apply it:');

    const ways = [
      ['As a check (flag)', 'Keep the drawing\'s real lengths; just warn if a floor jump is not roughly +5 m.', 'YES – safe'],
      ['As a forced value', 'Ignore the drawing and force each floor = previous + 5 m.', 'NO – risky'],
    ];
    const wc = [120, 290, 80];
    const wx = [LEFT + 4, LEFT + 130, LEFT + 425];
    let wy = doc.y + 4;
    doc.rect(LEFT, wy, WIDTH, 20).fill(NAVY);
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#FFFFFF');
    doc.text('Way', wx[0], wy + 5, { width: wc[0] });
    doc.text('What it does', wx[1], wy + 5, { width: wc[1] });
    doc.text('Good idea?', wx[2], wy + 5, { width: wc[2] });
    wy += 20;
    ways.forEach((r, i) => {
      doc.fontSize(9).font('Helvetica');
      const h = Math.max(doc.heightOfString(r[1], { width: wc[1] }), 16) + 12;
      if (i % 2 === 0) doc.rect(LEFT, wy, WIDTH, h).fill(ZEBRA);
      doc.font('Helvetica-Bold').fillColor(TEXT).text(r[0], wx[0], wy + 6, { width: wc[0] });
      doc.font('Helvetica').fillColor(TEXT).text(r[1], wx[1], wy + 6, { width: wc[1] });
      doc.font('Helvetica-Bold').fillColor(i === 0 ? GREEN : '#B00020').text(r[2], wx[2], wy + 6, { width: wc[2] });
      wy += h;
    });
    doc.y = wy + 10;

    doc.fontSize(11).font('Helvetica-Bold').fillColor(AMBER)
      .text('Recommendation: make it a warning that flags suspicious floors for a human to review — ' +
        'not something that auto-changes the numbers. The drawing always stays the source of truth.',
        LEFT, doc.y, { width: WIDTH });
    doc.moveDown(0.5);

    // ── New projects ──
    heading(doc, 'Do these fixes apply to new projects?');
    bullet(doc, 'The 3 fixes run AUTOMATICALLY in the live app for any new project (as good as the drawing quality allows).');
    bullet(doc, 'The "+5 m per floor" rule does NOT — it is still a manual check for every project.');
    bullet(doc, 'The old sample file is just one saved example; new projects do not use it.');

    doc.moveDown(1.5);
    doc.fontSize(9).font('Helvetica').fillColor('#999999')
      .text('Prepared for SABI Estimation — internal explanation note', { align: 'center' });

    doc.end();
    stream.on('finish', () => resolve(OUT));
  });
}

const path = await generate();
const kb = (fs.statSync(path).size / 1024).toFixed(1);
console.log(`PDF written: ${path} (${kb} KB)`);
