#!/usr/bin/env node
/**
 * Build an .eml file with a PDF attached. Double-click the output in macOS to
 * open in Mail.app pre-composed; review and click Send.
 *
 *   node scripts/build-rfq-eml.mjs <pdfPath> [outputPath]
 *
 * Defaults output to ~/Desktop/<basename>.eml.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error('Usage: node scripts/build-rfq-eml.mjs <pdfPath> [outputPath]');
  process.exit(1);
}

const pdfBuffer = readFileSync(pdfPath);
const pdfBase64 = pdfBuffer.toString('base64').replace(/(.{76})/g, '$1\r\n');
const pdfFilename = path.basename(pdfPath);

const outputPath = process.argv[3]
  || path.join(os.homedir(), 'Desktop', pdfFilename.replace(/\.pdf$/i, '') + '.eml');

const FROM_NAME = 'Ahmed Khan';
const FROM_EMAIL = 'ahmed.khan@premierdevelopers.example';
const TO = 'estimation@sabi.ae';
const CC = 'george@sabi.ae';
const SUBJECT = 'Request for Quotation - Electrical Power Works | B+G+8+R Commercial & Residential Bldg, Plot 67315 Al Quoz';

const date = new Date().toUTCString();
const messageId = `<rfq-${Date.now()}-${Math.random().toString(36).slice(2, 10)}@premierdevelopers.example>`;
const boundary = `----=_Part_${Math.random().toString(36).slice(2)}_${Date.now()}`;

const body = `Dear SABI Estimation Team,

Greetings from Premier Developers.

We are pleased to invite SABI Electromechanical Co. to submit a quotation
for the Electrical Power works of our upcoming B+G+8+R Commercial &
Residential Building at Plot 67315, Al Quoz, Dubai.

Project highlights
  - Building: Basement + Ground + 8 typical + Roof
  - Built-up area: ~ 75,000 sqft
  - Use: Mixed-use (retail at G, residential above)
  - Tender deadline: 14 days from date of this email

Attached please find the Power BOQ document (P-379) listing the schedule
of quantities, brands, and technical particulars expected. Kindly include
your unit rates against each item, payment terms, validity period, and
delivery schedule.

For any clarifications please contact the undersigned. We look forward
to your competitive submission.

Best regards,
${FROM_NAME}
Procurement Manager
Premier Developers LLC
Dubai, UAE
`;

const eml = [
  `From: "${FROM_NAME}" <${FROM_EMAIL}>`,
  `To: <${TO}>`,
  `Cc: <${CC}>`,
  `Subject: ${SUBJECT}`,
  `Date: ${date}`,
  `Message-ID: ${messageId}`,
  `MIME-Version: 1.0`,
  `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ``,
  `This is a multi-part message in MIME format.`,
  ``,
  `--${boundary}`,
  `Content-Type: text/plain; charset=UTF-8`,
  `Content-Transfer-Encoding: 7bit`,
  ``,
  body,
  `--${boundary}`,
  `Content-Type: application/pdf; name="${pdfFilename}"`,
  `Content-Transfer-Encoding: base64`,
  `Content-Disposition: attachment; filename="${pdfFilename}"`,
  ``,
  pdfBase64,
  `--${boundary}--`,
  ``,
].join('\r\n');

writeFileSync(outputPath, eml);
console.log(`✓ wrote ${outputPath}`);
console.log(`  Subject: ${SUBJECT}`);
console.log(`  To:      ${TO}  (Cc: ${CC})`);
console.log(`  Attach:  ${pdfFilename} (${pdfBuffer.length} bytes)`);
console.log(`\nDouble-click the .eml in Finder to open in Mail.app, then send.`);
