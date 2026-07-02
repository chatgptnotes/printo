#!/usr/bin/env node
// Build a single .eml file containing a realistic RFQ + all test attachments.
// Open the resulting .eml in Apple Mail (double-click) and hit Send to trigger
// the SABI 23-step pipeline against estimation@sabi.ae.
//
// Run: node scripts/build-test-rfq-email.mjs
// Output: ~/Desktop/SABI_Test_RFQ.eml

import fs from 'fs';
import path from 'path';
import os from 'os';

const TO = 'estimation@sabi.ae';
const FROM = 'Al Reem Developments <projects@alreem-dev.example>';
const SUBJECT = 'RFQ — Al Reem Tower, Dubai Marina | MEP Quotation Required';

const FILES_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'test-files');
const OUT = path.join(os.homedir(), 'Desktop', 'SABI_Test_RFQ.eml');

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

Greetings from Al Reem Developments.

We are pleased to invite SABI to submit a competitive quotation (RFQ) for the
complete MEP package on our upcoming project. Please quote your best price
covering supply, installation, testing and commissioning.

PROJECT DETAILS
---------------
Project Name      : Al Reem Tower
Location          : Dubai Marina, Dubai, UAE
Building Type     : Residential + Retail Podium
Floors            : G + 4P + 28 typical floors
Parking Levels    : 4 basement + podium
Typical Floor Area: 1,250 sqm
Total Built-up    : 38,500 sqm
Floor-to-floor    : 3.6 m typical, 4.5 m podium

SCOPE OF WORKS (MEP)
--------------------
1. HVAC — chilled water VRF + FAHU, full ducting, BMS interface
2. Electrical — LV distribution, lighting, small power, containment
3. Plumbing & drainage — domestic water, soil/waste, storm
4. Fire fighting — sprinklers, wet riser, fire pumps
5. Fire alarm & low current — addressable system

ATTACHED DOCUMENTS
------------------
- Thermal Load Report (PDF)
- Indicative BOQ template (XLSX)
- MEP estimation reference (DOCX)
- Project presentation (PPTX)
- MEP specifications (CSV)
- Bid list reference (CSV)
- Drawing index (TXT)

SUBMISSION
----------
Please submit your priced quotation, technical compliance statement and
delivery programme by 30 April 2026. Any clarifications may be addressed to
the undersigned.

Thank you, and we look forward to receiving your most competitive offer.

Best regards,
Ahmed Al Mansoori
Procurement Manager
Al Reem Developments LLC
Dubai, UAE
`;

// ---- Build MIME ----
const boundary = '----=_SABI_RFQ_' + Date.now().toString(36);
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

// Body part
mime += `--${boundary}${CRLF}`;
mime += `Content-Type: text/plain; charset="utf-8"${CRLF}`;
mime += `Content-Transfer-Encoding: 7bit${CRLF}${CRLF}`;
mime += BODY + CRLF;

// Attachment parts
for (const [name, mimeType] of ATTACHMENTS) {
  const filepath = path.join(FILES_DIR, name);
  if (!fs.existsSync(filepath)) {
    console.warn(`! missing: ${filepath} — skipped`);
    continue;
  }
  const data = fs.readFileSync(filepath).toString('base64');
  // wrap base64 at 76 chars per line
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
