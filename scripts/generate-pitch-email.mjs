import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
} from 'docx';

const OUT = path.resolve('.');

// ──────────────────── FAKE RECIPIENT / PROJECT ────────────────────
const FROM_NAME  = 'George Varkey M';
const FROM_EMAIL = 'george@sabi.ae';
const FROM_TITLE = 'Technical Director, SABI Engineering LLC';
const FROM_PHONE = '+971 50 842 6170';

const TO_NAME    = 'Ms. Aisha Al Marzooqi';
const TO_TITLE   = 'Senior Projects Manager';
const TO_COMPANY = 'Meridian Consult Engineering';
const TO_EMAIL   = 'a.almarzooqi@meridianconsult.ae';

const PROJECT    = 'The Azure Residences, Dubai Marina';
const PROJECT_DESC = '42-floor residential tower, 2 basement levels, podium retail';
const RFQ_REF    = 'RFQ/MCE/2026/0418';
const MEETING_DATE = 'Tuesday, 21 April 2026';

const SUBJECT = `SABI x Meridian — Azure Residences MEP estimation, delivered via realsoft.example`;

// ──────────────────── EMAIL BODY COPY ────────────────────
const greeting = `Dear Ms. Al Marzooqi,`;

const openingPara = `Thank you for sharing the tender package for The Azure Residences (ref: ${RFQ_REF}) on 16 April. Our estimation team has already begun processing the drawings, and I wanted to take a moment to show you what makes our turnaround different — and why you can expect a fully priced BOQ on your desk within 72 hours.`;

const platformPara = `Over the last year, SABI has built realsoft.example — an AI-powered estimation pipeline that ingests an RFQ email, reads the drawings, extracts quantities, and produces a priced Bill of Quantities end-to-end. It is the same engine that is processing the Azure Residences package right now.`;

const whatItDoesIntro = `From the moment your tender email arrived at estimation@sabi.ae, a 23-step automated workflow kicked in:`;

const whatItDoes = [
  ['Recognised the enquiry',    'logged the RFQ, classified it as a Priority-top residential high-rise, notified our team on WhatsApp within 2 minutes'],
  ['Unpacked the package',      '147 drawings across AutoCAD and PDF, plus your specification document and equipment schedule — all cataloged automatically'],
  ['Identified the MEP scope',  'HVAC, electrical, plumbing, drainage, and fire fighting — cross-checked against your tender scope letter'],
  ['Read the drawings',         'our AI vision model extracted the thermal load summary, equipment schedules, and indoor unit counts directly from the HVAC drawings'],
  ['Applied validated formulas','each service priced through its own engineering formula (VRF, chiller, package, split) — no lookup tables, no guesswork'],
  ['Benchmarked every number',  'every line item cross-checked against current Dubai AED/sqft yardstick rates before it leaves our office'],
  ['Generated the deliverable', 'clean Excel BOQ, branded PDF quotation, covering letter — ready for your review'],
];

const meaningIntro = `What this means for Meridian on Azure Residences:`;

const meaning = [
  ['72-hour turnaround',  `a full priced BOQ for a 42-floor tower by end of day Friday, 17 April`],
  ['Three approval gates','our engineers approve the scope, the pricing, and the final quotation before anything reaches you — no unchecked AI output'],
  ['Full traceability',   'every number in the BOQ is linked back to the drawing sheet and the formula that produced it — audit-ready from day one'],
  ['Consistent accuracy', 'benchmarked against our 2026 yardstick database covering 80+ comparable Dubai projects'],
];

const highlightPara = `Under the hood, our estimation team — led by myself and Senior Estimator Murali K — reviews every bid before dispatch. The AI handles the grunt work; we handle the engineering judgment.`;

const ctaPara = `I'd like to propose a short call on ${MEETING_DATE} at 11:00 AM to walk you through the Azure Residences BOQ live, on screen, step by step. You will see exactly which drawing produced which line item. If the timing doesn't suit, please nominate any slot that week and I will make it work.`;

const closingPara = `In the meantime, if you would like to add any services to the scope or share any updated drawings, simply reply to this email and the pipeline will pick up the changes automatically.`;

const signOff = `Looking forward to delivering a cleaner, faster quotation than you have ever received — and to many more projects together.`;

const SABI_BLUE = '#0b4f8a';
const SABI_BLUE_HEX = '0b4f8a';

// ──────────────────────────── TXT ────────────────────────────
function generateTXT() {
  const wrap = (s, n = 76) => {
    const words = s.split(' ');
    const lines = [];
    let line = '';
    for (const w of words) {
      if ((line + ' ' + w).trim().length > n) { lines.push(line); line = w; }
      else line = (line + ' ' + w).trim();
    }
    if (line) lines.push(line);
    return lines.join('\n');
  };

  const bulletTxt = (items) => items
    .map(([a, b]) => wrap(`  • ${a} — ${b}`, 76))
    .join('\n');

  const txt =
`From:    ${FROM_NAME} <${FROM_EMAIL}>
To:      ${TO_NAME} <${TO_EMAIL}>
Subject: ${SUBJECT}

${greeting}

${wrap(openingPara)}

${wrap(platformPara)}

WHAT HAPPENED IN THE LAST 24 HOURS

${wrap(whatItDoesIntro)}

${bulletTxt(whatItDoes)}

WHAT THIS MEANS FOR MERIDIAN

${wrap(meaningIntro)}

${bulletTxt(meaning)}

${wrap(highlightPara)}

NEXT STEP

${wrap(ctaPara)}

${wrap(closingPara)}

${wrap(signOff)}

Warm regards,

${FROM_NAME}
${FROM_TITLE}
${FROM_EMAIL}  |  ${FROM_PHONE}
realsoft.example
`;
  fs.writeFileSync(path.join(OUT, 'PITCH_EMAIL.txt'), txt);
}

// ──────────────────────────── MD ─────────────────────────────
function generateMD() {
  const bulletMd = (items) =>
    items.map(([a, b]) => `- **${a}** — ${b}`).join('\n');

  const md =
`**From:** ${FROM_NAME} <${FROM_EMAIL}>
**To:** ${TO_NAME} <${TO_EMAIL}>
**Subject:** ${SUBJECT}

---

${greeting}

${openingPara}

${platformPara}

## What happened in the last 24 hours

${whatItDoesIntro}

${bulletMd(whatItDoes)}

## What this means for Meridian

${meaningIntro}

${bulletMd(meaning)}

> ${highlightPara}

## Next step

${ctaPara}

${closingPara}

${signOff}

Warm regards,

**${FROM_NAME}**
${FROM_TITLE}
${FROM_EMAIL} | ${FROM_PHONE}
realsoft.example
`;
  fs.writeFileSync(path.join(OUT, 'PITCH_EMAIL.md'), md);
}

// ──────────────────────────── HTML ───────────────────────────
function generateHTML() {
  const bulletHtml = (items) => items
    .map(([a, b]) => `    <li><strong>${a}</strong> — ${b}</li>`)
    .join('\n');

  const html =
`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${SUBJECT}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; line-height: 1.6; color: #1a1a1a; max-width: 680px; margin: 0 auto; padding: 32px 24px; background: #ffffff; }
  .meta { font-size: 12px; color: #666; border-bottom: 1px solid #e5e5e5; padding-bottom: 12px; margin-bottom: 20px; }
  .meta span { color: #1a1a1a; }
  .header { border-bottom: 3px solid ${SABI_BLUE}; padding-bottom: 16px; margin-bottom: 24px; }
  .header h1 { font-size: 22px; color: ${SABI_BLUE}; margin: 0; }
  .header .subtitle { color: #666; font-size: 14px; margin-top: 4px; }
  h2 { color: ${SABI_BLUE}; font-size: 17px; margin-top: 28px; margin-bottom: 10px; border-left: 4px solid ${SABI_BLUE}; padding-left: 10px; text-transform: uppercase; letter-spacing: 0.4px; }
  p { margin: 12px 0; }
  ul { padding-left: 22px; }
  li { margin-bottom: 8px; }
  strong { color: ${SABI_BLUE}; }
  .highlight { background: #f4f8fc; border-left: 4px solid ${SABI_BLUE}; padding: 14px 18px; margin: 20px 0; font-size: 15px; font-style: italic; }
  .cta { background: ${SABI_BLUE}; color: #ffffff; padding: 18px 22px; border-radius: 6px; margin: 28px 0; }
  .cta h2 { color: #ffffff; border-left-color: #ffffff; margin-top: 0; }
  .cta p { color: #eaf1f8; }
  .cta strong { color: #ffffff; }
  .signature { margin-top: 32px; padding-top: 20px; border-top: 1px solid #e5e5e5; font-size: 14px; }
  .signature .name { font-weight: bold; color: ${SABI_BLUE}; font-size: 16px; }
  .signature a { color: ${SABI_BLUE}; text-decoration: none; }
</style>
</head>
<body>

  <div class="meta">
    <div><strong>From:</strong> <span>${FROM_NAME} &lt;${FROM_EMAIL}&gt;</span></div>
    <div><strong>To:</strong> <span>${TO_NAME} &lt;${TO_EMAIL}&gt;</span></div>
    <div><strong>Subject:</strong> <span>${SUBJECT}</span></div>
  </div>

  <div class="header">
    <h1>${PROJECT}</h1>
    <div class="subtitle">${PROJECT_DESC} &middot; ${RFQ_REF}</div>
  </div>

  <p>${greeting}</p>

  <p>${openingPara}</p>

  <p>${platformPara}</p>

  <h2>What happened in the last 24 hours</h2>
  <p>${whatItDoesIntro}</p>
  <ul>
${bulletHtml(whatItDoes)}
  </ul>

  <h2>What this means for Meridian</h2>
  <p>${meaningIntro}</p>
  <ul>
${bulletHtml(meaning)}
  </ul>

  <div class="highlight">${highlightPara}</div>

  <div class="cta">
    <h2>Next step</h2>
    <p>${ctaPara}</p>
  </div>

  <p>${closingPara}</p>

  <p>${signOff}</p>

  <div class="signature">
    Warm regards,<br><br>
    <span class="name">${FROM_NAME}</span><br>
    ${FROM_TITLE}<br>
    <a href="mailto:${FROM_EMAIL}">${FROM_EMAIL}</a> &middot; ${FROM_PHONE}<br>
    <a href="http://localhost:3001">realsoft.example</a>
  </div>

</body>
</html>
`;
  fs.writeFileSync(path.join(OUT, 'PITCH_EMAIL.html'), html);
}

// ──────────────────────────── PDF ────────────────────────────
function generatePDF() {
  const doc = new PDFDocument({ size: 'A4', margin: 54 });
  const stream = fs.createWriteStream(path.join(OUT, 'PITCH_EMAIL.pdf'));
  doc.pipe(stream);

  // Meta header
  doc.fillColor('#666').fontSize(9).font('Helvetica')
    .text(`From:    ${FROM_NAME} <${FROM_EMAIL}>`)
    .text(`To:      ${TO_NAME} <${TO_EMAIL}>`)
    .text(`Subject: ${SUBJECT}`, { width: 487 });
  doc.moveDown(0.4);
  doc.strokeColor('#e5e5e5').lineWidth(0.5)
    .moveTo(54, doc.y).lineTo(541, doc.y).stroke();
  doc.moveDown(0.8);

  doc.fillColor(SABI_BLUE).fontSize(20).font('Helvetica-Bold')
    .text(PROJECT);
  doc.moveDown(0.15);
  doc.fillColor('#666').fontSize(10).font('Helvetica')
    .text(`${PROJECT_DESC}  ·  ${RFQ_REF}`);
  doc.moveDown(0.5);
  doc.strokeColor(SABI_BLUE).lineWidth(2)
    .moveTo(54, doc.y).lineTo(541, doc.y).stroke();
  doc.moveDown(0.9);

  const bodyText = (t, opts = {}) =>
    doc.fillColor('#1a1a1a').fontSize(10.5).font('Helvetica').text(t, { lineGap: 2.5, ...opts });

  const section = (title) => {
    doc.moveDown(0.6);
    doc.fillColor(SABI_BLUE).fontSize(11).font('Helvetica-Bold')
      .text(title.toUpperCase(), { characterSpacing: 0.6 });
    doc.moveDown(0.25);
    doc.strokeColor(SABI_BLUE).lineWidth(1.2)
      .moveTo(54, doc.y).lineTo(120, doc.y).stroke();
    doc.moveDown(0.35);
    doc.fillColor('#1a1a1a').fontSize(10.5).font('Helvetica');
  };

  const bullet = (label, rest) => {
    const startX = doc.x;
    doc.font('Helvetica-Bold').fillColor('#1a1a1a')
      .text('•  ' + label, { continued: true });
    doc.font('Helvetica').text(' — ' + rest, { lineGap: 2.5 });
    doc.x = startX;
    doc.moveDown(0.15);
  };

  bodyText(greeting);
  doc.moveDown(0.5);
  bodyText(openingPara);
  doc.moveDown(0.5);
  bodyText(platformPara);

  section('What happened in the last 24 hours');
  bodyText(whatItDoesIntro);
  doc.moveDown(0.35);
  whatItDoes.forEach(([a, b]) => bullet(a, b));

  section('What this means for Meridian');
  bodyText(meaningIntro);
  doc.moveDown(0.35);
  meaning.forEach(([a, b]) => bullet(a, b));

  // highlight box
  doc.moveDown(0.6);
  const boxY = doc.y;
  const boxH = 52;
  doc.save().rect(54, boxY, 487, boxH).fill('#f4f8fc').restore();
  doc.save().rect(54, boxY, 4, boxH).fill(SABI_BLUE).restore();
  doc.fillColor('#1a1a1a').fontSize(10).font('Helvetica-Oblique')
    .text(highlightPara, 66, boxY + 12, { width: 470, lineGap: 2 });
  doc.y = boxY + boxH + 14;
  doc.x = 54;

  section('Next step');
  bodyText(ctaPara);
  doc.moveDown(0.4);
  bodyText(closingPara);
  doc.moveDown(0.4);
  bodyText(signOff);

  doc.moveDown(1.0);
  doc.strokeColor('#e5e5e5').lineWidth(0.5)
    .moveTo(54, doc.y).lineTo(541, doc.y).stroke();
  doc.moveDown(0.5);
  doc.fillColor('#1a1a1a').fontSize(10).font('Helvetica').text('Warm regards,');
  doc.moveDown(0.3);
  doc.fillColor(SABI_BLUE).font('Helvetica-Bold').fontSize(12).text(FROM_NAME);
  doc.fillColor('#444').font('Helvetica').fontSize(9.5)
    .text(FROM_TITLE)
    .text(`${FROM_EMAIL}  ·  ${FROM_PHONE}`)
    .text('realsoft.example');

  doc.end();
  return new Promise((r) => stream.on('finish', r));
}

// ─────────────────────────── DOCX ────────────────────────────
async function generateDOCX() {
  const p = (text, opts = {}) => new Paragraph({
    children: [new TextRun({ text, ...opts })],
    spacing: { after: 160 },
  });
  const heading = (text) => new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text: text.toUpperCase(), color: SABI_BLUE_HEX, bold: true, size: 24 })],
    spacing: { before: 320, after: 140 },
  });
  const bulletP = (label, rest) => new Paragraph({
    bullet: { level: 0 },
    children: [
      new TextRun({ text: label, bold: true }),
      new TextRun({ text: ' — ' + rest }),
    ],
    spacing: { after: 100 },
  });
  const meta = (label, value) => new Paragraph({
    children: [
      new TextRun({ text: label + '  ', color: '666666', size: 18 }),
      new TextRun({ text: value, size: 18 }),
    ],
    spacing: { after: 40 },
  });

  const doc = new Document({
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    sections: [{
      properties: {},
      children: [
        meta('From:',    `${FROM_NAME} <${FROM_EMAIL}>`),
        meta('To:',      `${TO_NAME} <${TO_EMAIL}>`),
        meta('Subject:', SUBJECT),
        new Paragraph({ children: [new TextRun({ text: '' })], spacing: { after: 240 } }),

        new Paragraph({
          children: [new TextRun({ text: PROJECT, bold: true, size: 36, color: SABI_BLUE_HEX })],
          spacing: { after: 60 },
        }),
        new Paragraph({
          children: [new TextRun({ text: `${PROJECT_DESC}  ·  ${RFQ_REF}`, color: '666666', size: 20, italics: true })],
          spacing: { after: 320 },
        }),

        p(greeting),
        p(openingPara),
        p(platformPara),

        heading('What happened in the last 24 hours'),
        p(whatItDoesIntro),
        ...whatItDoes.map(([a, b]) => bulletP(a, b)),

        heading('What this means for Meridian'),
        p(meaningIntro),
        ...meaning.map(([a, b]) => bulletP(a, b)),

        new Paragraph({
          children: [new TextRun({ text: highlightPara, italics: true })],
          spacing: { before: 200, after: 200 },
          shading: { type: 'clear', fill: 'f4f8fc' },
        }),

        heading('Next step'),
        p(ctaPara),
        p(closingPara),
        p(signOff),

        p('Warm regards,'),
        new Paragraph({
          children: [new TextRun({ text: FROM_NAME, bold: true, color: SABI_BLUE_HEX, size: 26 })],
          spacing: { after: 60 },
        }),
        p(FROM_TITLE),
        p(`${FROM_EMAIL}  ·  ${FROM_PHONE}`),
        p('realsoft.example'),
      ],
    }],
  });

  const buf = await Packer.toBuffer(doc);
  fs.writeFileSync(path.join(OUT, 'PITCH_EMAIL.docx'), buf);
}

// ─────────────────────────── EML ─────────────────────────────
function generateEML() {
  const html = fs.readFileSync(path.join(OUT, 'PITCH_EMAIL.html'), 'utf8');
  const txt = fs.readFileSync(path.join(OUT, 'PITCH_EMAIL.txt'), 'utf8');
  const boundary = '=_sabi_pitch_boundary_' + Date.now();
  const date = new Date().toUTCString();

  const eml =
`From: ${FROM_NAME} <${FROM_EMAIL}>
To: ${TO_NAME} <${TO_EMAIL}>
Subject: ${SUBJECT}
Date: ${date}
MIME-Version: 1.0
X-Mailer: realsoft.example pitch generator
Content-Type: multipart/alternative; boundary="${boundary}"

--${boundary}
Content-Type: text/plain; charset="utf-8"
Content-Transfer-Encoding: 8bit

${txt}
--${boundary}
Content-Type: text/html; charset="utf-8"
Content-Transfer-Encoding: 8bit

${html}
--${boundary}--
`;
  fs.writeFileSync(path.join(OUT, 'PITCH_EMAIL.eml'), eml);
}

// ─────────────────────────── RTF ─────────────────────────────
function generateRTF() {
  const esc = (s) => s
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{').replace(/\}/g, '\\}')
    .replace(/—/g, '\\u8212?')
    .replace(/·/g, '\\u183?')
    .replace(/'/g, "\\u8217?");
  const line = (s) => esc(s) + '\\par\n';

  const bulletList = (items) => items
    .map(([a, b]) => `\\bullet  {\\b ${esc(a)}} \\u8212? ${esc(b)}\\par\n`)
    .join('');

  const rtf =
`{\\rtf1\\ansi\\ansicpg1252\\deff0
{\\fonttbl{\\f0 Calibri;}}
{\\colortbl;\\red11\\green79\\blue138;\\red102\\green102\\blue102;\\red26\\green26\\blue26;}
\\viewkind4\\uc1\\f0\\fs20\\cf3
{\\cf2 From:    ${esc(FROM_NAME)} <${esc(FROM_EMAIL)}>}\\par
{\\cf2 To:      ${esc(TO_NAME)} <${esc(TO_EMAIL)}>}\\par
{\\cf2 Subject: ${esc(SUBJECT)}}\\par\\par
{\\cf1\\fs36\\b ${esc(PROJECT)}\\b0\\fs20\\cf3}\\par
{\\cf2\\i ${esc(PROJECT_DESC)} \\u183? ${esc(RFQ_REF)}\\i0\\cf3}\\par\\par
${line(greeting)}\\par
${line(openingPara)}\\par
${line(platformPara)}\\par
{\\cf1\\b\\fs24 WHAT HAPPENED IN THE LAST 24 HOURS\\b0\\fs20\\cf3}\\par
${line(whatItDoesIntro)}
${bulletList(whatItDoes)}\\par
{\\cf1\\b\\fs24 WHAT THIS MEANS FOR MERIDIAN\\b0\\fs20\\cf3}\\par
${line(meaningIntro)}
${bulletList(meaning)}\\par
{\\i ${esc(highlightPara)}\\i0}\\par\\par
{\\cf1\\b\\fs24 NEXT STEP\\b0\\fs20\\cf3}\\par
${line(ctaPara)}\\par
${line(closingPara)}\\par
${line(signOff)}\\par
${line('Warm regards,')}\\par
{\\cf1\\b ${esc(FROM_NAME)}\\b0\\cf3}\\par
${line(FROM_TITLE)}
${line(FROM_EMAIL + ' \\u183? ' + FROM_PHONE)}
${line('realsoft.example')}
}`;
  fs.writeFileSync(path.join(OUT, 'PITCH_EMAIL.rtf'), rtf);
}

// ─────────────────────────── run ─────────────────────────────
generateTXT();
generateMD();
generateHTML();
await generatePDF();
await generateDOCX();
generateEML();
generateRTF();

console.log('\nGenerated sample email to ' + TO_NAME + ' at ' + TO_COMPANY + ':\n');
['PITCH_EMAIL.txt','PITCH_EMAIL.md','PITCH_EMAIL.html','PITCH_EMAIL.pdf',
 'PITCH_EMAIL.docx','PITCH_EMAIL.eml','PITCH_EMAIL.rtf']
  .forEach(f => {
    const s = fs.statSync(path.join(OUT, f));
    console.log(`  ${f.padEnd(22)} ${(s.size/1024).toFixed(1).padStart(6)} KB`);
  });
console.log('');
