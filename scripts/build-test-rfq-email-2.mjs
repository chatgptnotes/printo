#!/usr/bin/env node
// Second test RFQ — different project, different scale, different client.
// Run: node scripts/build-test-rfq-email-2.mjs
// Output: ~/Desktop/SABI_Test_RFQ_2.eml

import fs from 'fs';
import path from 'path';
import os from 'os';

const TO = 'estimation@sabi.ae';
const FROM = 'Emirates Skyline Contracting <tenders@skyline-contracting.example>';
const SUBJECT = 'RFQ — Jumeirah Business Bay Office Tower | MEP Package Pricing';

const FILES_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'test-files');
const OUT = path.join(os.homedir(), 'Desktop', 'SABI_Test_RFQ_2.eml');

const ATTACHMENTS = [
  ['SABI_MEP_Thermal_Load_Report.pdf',         'application/pdf'],
  ['SABI_BOQ_Al_Reem_Tower.xlsx',              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['SABI_MEP_Estimation_Al_Reem_Tower.docx',   'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['SABI_MEP_Presentation_Al_Reem_Tower.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ['SABI_MEP_Specifications.csv',              'text/csv'],
  ['SABI_Bid_List_2026.csv',                   'text/csv'],
  ['SABI_Drawing_Index.txt',                   'text/plain'],
];

const BODY = `Dear SABI Estimation Team,

Greetings from Emirates Skyline Contracting.

We have been awarded the main contract for the Jumeirah Business Bay Office
Tower and are inviting nominated MEP subcontractors to submit their best price
for the full mechanical, electrical and plumbing package. Kindly treat this as
a formal Request for Quotation (RFQ).

PROJECT DETAILS
---------------
Project Name      : Jumeirah Business Bay Office Tower
Location          : Business Bay, Dubai, UAE
Building Type     : Grade-A Commercial Office + Ground Floor Retail
Floors            : 2B + G + M + 42 typical floors + Roof
Parking Levels    : 2 basement (B1, B2) + Mezzanine
Typical Floor Area: 1,800 sqm (lettable 1,520 sqm)
Total Built-up    : 84,600 sqm
Floor-to-floor    : 4.0 m office, 5.5 m ground, 3.8 m parking
Target LEED       : Gold certification

SCOPE OF WORKS (MEP)
--------------------
1. HVAC — district cooling connection, AHUs, FAHU, VAV system, BMS
2. Electrical — 11kV substation interface, LV switchgear, busbar risers
3. Plumbing — domestic cold/hot water, booster pumps, drainage, irrigation
4. Fire fighting — sprinklers, FM200 for IT rooms, fire pump room
5. Fire alarm & ELV — addressable FA, access control, CCTV, structured cabling

ATTACHED DOCUMENTS
------------------
- Thermal load calculation report (PDF)
- BOQ template for pricing entry (XLSX)
- Estimation reference document (DOCX)
- Project briefing presentation (PPTX)
- Technical specifications (CSV)
- Tender bid list (CSV)
- Architectural & MEP drawing index (TXT)

SUBMISSION REQUIREMENTS
-----------------------
- Priced BOQ in attached template format
- Technical compliance statement (item-by-item)
- Programme of works (Gantt or bar chart)
- List of similar completed projects (last 5 years)
- Submission deadline: 5 May 2026, 4:00 PM Dubai time

Please confirm receipt of this RFQ at your earliest convenience. We look
forward to your most competitive offer.

Best regards,
Khalid Rahman
Senior Procurement Engineer
Emirates Skyline Contracting LLC
Business Bay, Dubai, UAE
+971 4 555 0123
`;

const boundary = '----=_SABI_RFQ2_' + Date.now().toString(36);
const CRLF = '\r\n';

const headers = [
  `From: ${FROM}`,
  `To: ${TO}`,
  `Subject: ${SUBJECT}`,
  `Date: ${new Date().toUTCString()}`,
  `MIME-Version: 1.0`,
  `Content-Type: multipart/mixed; boundary="${boundary}"`,
].join(CRLF);

let mime = headers + CRLF + CRLF;
mime += `This is a multi-part message in MIME format.${CRLF}${CRLF}`;

mime += `--${boundary}${CRLF}`;
mime += `Content-Type: text/plain; charset="utf-8"${CRLF}`;
mime += `Content-Transfer-Encoding: 7bit${CRLF}${CRLF}`;
mime += BODY + CRLF;

for (const [name, mimeType] of ATTACHMENTS) {
  const filepath = path.join(FILES_DIR, name);
  if (!fs.existsSync(filepath)) {
    console.warn(`! missing: ${filepath} — skipped`);
    continue;
  }
  const data = fs.readFileSync(filepath).toString('base64');
  const wrapped = data.match(/.{1,76}/g).join(CRLF);

  mime += `--${boundary}${CRLF}`;
  mime += `Content-Type: ${mimeType}; name="${name}"${CRLF}`;
  mime += `Content-Transfer-Encoding: base64${CRLF}`;
  mime += `Content-Disposition: attachment; filename="${name}"${CRLF}${CRLF}`;
  mime += wrapped + CRLF;
}

mime += `--${boundary}--${CRLF}`;

fs.writeFileSync(OUT, mime);
const sizeKB = (fs.statSync(OUT).size / 1024).toFixed(1);

console.log(`✓ wrote ${OUT} (${sizeKB} KB)`);
console.log(`  to:      ${TO}`);
console.log(`  subject: ${SUBJECT}`);
console.log(`  files:   ${ATTACHMENTS.length}`);
console.log(``);
console.log(`Next: double-click the .eml in Finder to open in Apple Mail, then Send.`);
