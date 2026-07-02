#!/usr/bin/env npx ts-node
/**
 * Generate test tender PDF documents for pipeline testing.
 * Run: npx ts-node scripts/generate-test-tender.ts
 * Output: ~/Desktop/ (5 files)
 */

import PDFDocument from 'pdfkit';
import * as fs from 'fs';
import * as path from 'path';

const OUTPUT_DIR = path.join(process.env.HOME || '/tmp', 'Desktop');

// ---- Helpers ----

function drawHeader(doc: PDFKit.PDFDocument, company: string, title: string) {
  // Blue header bar
  doc.rect(0, 0, doc.page.width, 90).fill('#1e3a5f');
  doc.fontSize(22).fill('#ffffff').text(company, 50, 25, { width: 500 });
  doc.fontSize(10).fill('#a0c4e8').text(title, 50, 55, { width: 500 });
  doc.moveDown(3);
  doc.fill('#333333');
}

function drawSectionTitle(doc: PDFKit.PDFDocument, title: string) {
  doc.moveDown(0.5);
  const y = doc.y;
  doc.rect(50, y, 500, 24).fill('#eef3fa');
  doc.fontSize(12).fill('#1e3a5f').text(title, 58, y + 6, { width: 480 });
  doc.fill('#333333').fontSize(10);
  doc.y = y + 30;
}

function drawTable(doc: PDFKit.PDFDocument, rows: [string, string][]) {
  const startX = 58;
  const colW = [180, 310];
  for (const [label, value] of rows) {
    const y = doc.y;
    doc.rect(startX, y, colW[0], 20).fill('#f8f9fa').stroke('#e0e0e0');
    doc.rect(startX + colW[0], y, colW[1], 20).stroke('#e0e0e0');
    doc.fill('#555').fontSize(9).text(label, startX + 6, y + 5, { width: colW[0] - 12 });
    doc.fill('#111').text(value, startX + colW[0] + 6, y + 5, { width: colW[1] - 12 });
    doc.y = y + 20;
  }
  doc.moveDown(0.5);
}

function drawFooter(doc: PDFKit.PDFDocument, text: string) {
  doc.moveDown(2);
  doc.fontSize(8).fill('#999').text(text, 50, doc.page.height - 50, {
    width: 500,
    align: 'center',
  });
}

// ---- 1. Main RFQ Letter ----

function generateRFQLetter() {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const filePath = path.join(OUTPUT_DIR, 'RFQ_Letter_Al_Zahra_Tower.pdf');
  doc.pipe(fs.createWriteStream(filePath));

  drawHeader(doc, 'AL ZAHRA PROPERTIES LLC', 'Request for Quotation — MEP Works');

  doc.fontSize(10).text('Date: 07 April 2026', { align: 'right' });
  doc.text('Ref: AZP/PROC/2026/0347', { align: 'right' });
  doc.moveDown(1);

  doc.fontSize(11).text('To: SABI Estimation Department');
  doc.text('Email: estimation@sabi.ae');
  doc.moveDown(0.5);
  doc.fontSize(11).fill('#1e3a5f').text('Subject: RFQ — MEP Works for Al Zahra Commercial Tower, JLT (B+2P+18F)');
  doc.fill('#333');
  doc.moveDown(1);

  doc.fontSize(10).text(
    'Dear Sir/Madam,\n\n' +
    'Al Zahra Properties LLC is pleased to invite you to submit your best price for the MEP ' +
    '(Mechanical, Electrical, and Plumbing) supply and installation works for the above-mentioned project.\n\n' +
    'Please find below the project details and scope of work. Kindly review the attached tender documents ' +
    'and submit your competitive quotation before the deadline.',
    { lineGap: 3 }
  );

  drawSectionTitle(doc, 'PROJECT INFORMATION');
  drawTable(doc, [
    ['Project Name', 'Al Zahra Commercial Tower'],
    ['Location', 'JLT (Jumeirah Lake Towers), Plot No. CT-15, Dubai, UAE'],
    ['Client / Developer', 'Al Zahra Properties LLC'],
    ['Consultant', 'KEO International Consultants'],
    ['Main Contractor', 'To be appointed'],
    ['Contract Type', 'MEP Supply & Installation (Lump Sum)'],
  ]);

  drawSectionTitle(doc, 'BUILDING DETAILS');
  drawTable(doc, [
    ['Building Type', 'Office / Commercial Tower'],
    ['Configuration', 'Basement + 2 Parking + 18 Typical Floors + Roof'],
    ['Total Floors', '21 (including 2 parking levels)'],
    ['Parking Floors', '2 (Basement + Podium)'],
    ['Typical Floors', '18'],
    ['Area per Floor', '3,200 sqft'],
    ['Total Built-Up Area', '72,000 sqft (6,689 sqm)'],
    ['Typical Floor Height', '3.4m (floor to floor)'],
    ['Basement Height', '4.2m (floor to floor)'],
    ['Gross Floor Area (GFA)', '67,200 sqft'],
  ]);

  drawSectionTitle(doc, 'SCOPE OF WORK');
  const services = [
    ['1. HVAC', 'Supply & installation of VRF system, fresh air handling units (FAHU), ducting, grilles, diffusers, controls, and commissioning'],
    ['2. Electrical', 'LV distribution, lighting, power outlets, DB panels, cable trays, earthing, lightning protection, ELV (CCTV, access control, intercom)'],
    ['3. Plumbing', 'Cold & hot water supply, drainage, sewage, rainwater, water tanks, pumps, sanitary fixtures'],
    ['4. Fire Fighting', 'Sprinkler system, fire hydrant, hose reels, fire pump, jockey pump, FM200 for server room'],
    ['5. Fire Alarm', 'Addressable fire alarm system, smoke detectors, manual call points, alarm bells, control panel'],
    ['6. BMS', 'Building Management System integration for HVAC, lighting, fire alarm monitoring'],
  ];
  for (const [svc, desc] of services) {
    doc.fontSize(10).fill('#1e3a5f').text(svc, 58, doc.y, { continued: true });
    doc.fill('#333').text(` — ${desc}`, { lineGap: 2 });
  }

  doc.moveDown(1);
  drawSectionTitle(doc, 'TENDER DOCUMENTS ENCLOSED');
  const docs = [
    'MEP_Tender_Drawings.zip — AutoCAD drawings (all services)',
    'HVAC_Equipment_Schedule.pdf — Equipment specifications & schedule',
    'Thermal_Load_Calculation.pdf — Cooling load summary by floor',
    'Electrical_SLD.dwg — Single Line Diagram',
    'Plumbing_Layout.dwg — Plumbing riser & layout',
    'Fire_Fighting_Layout.pdf — Sprinkler & hydrant layout',
    'BOQ_Template.xlsx — Bill of Quantities format',
    'Specifications_MEP.pdf — Full MEP specifications (Vol. 1)',
  ];
  for (const d of docs) {
    doc.fontSize(9).text(`  •  ${d}`, 58, doc.y, { lineGap: 1 });
  }

  doc.moveDown(1);
  drawSectionTitle(doc, 'SUBMISSION DETAILS');
  drawTable(doc, [
    ['Submission Deadline', '25 April 2026, 5:00 PM GST'],
    ['Validity Period', '90 days from submission date'],
    ['Submit To', 'estimation@sabi.ae'],
    ['Contact Person', 'Mohammed Al Rashid, Procurement Manager'],
    ['Phone', '+971 4 555 1234'],
    ['Email', 'procurement@alzahra-properties.ae'],
  ]);

  doc.moveDown(1);
  doc.fontSize(10).text(
    'We look forward to receiving your competitive quotation.\n\n' +
    'Best regards,',
    { lineGap: 3 }
  );
  doc.moveDown(0.5);
  doc.fontSize(11).fill('#1e3a5f').text('Mohammed Al Rashid');
  doc.fontSize(9).fill('#666').text('Procurement Manager');
  doc.text('Al Zahra Properties LLC');
  doc.text('P.O. Box 12345, Dubai, UAE');

  drawFooter(doc, 'CONFIDENTIAL — This document is intended solely for the addressee. Ref: AZP/PROC/2026/0347');
  doc.end();
  console.log(`  ✓ ${filePath}`);
}

// ---- 2. Thermal Load Calculation PDF ----

function generateThermalLoad() {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const filePath = path.join(OUTPUT_DIR, 'Thermal_Load_Calculation.pdf');
  doc.pipe(fs.createWriteStream(filePath));

  drawHeader(doc, 'KEO INTERNATIONAL CONSULTANTS', 'Thermal Load Calculation Report');

  doc.fontSize(10).text('Project: Al Zahra Commercial Tower, JLT');
  doc.text('Document No: KEO-AZT-HVAC-TLC-001   Rev: A');
  doc.text('Date: March 2026');
  doc.moveDown(1);

  drawSectionTitle(doc, 'COOLING LOAD SUMMARY');

  // Floor-by-floor table header
  const startX = 58;
  const cols = [120, 80, 80, 80, 80];
  const headers = ['Floor', 'Area (sqft)', 'W/sqft', 'Load (kW)', 'Load (TR)'];
  let y = doc.y;
  let x = startX;
  for (let i = 0; i < headers.length; i++) {
    doc.rect(x, y, cols[i], 20).fill('#1e3a5f');
    doc.fill('#fff').fontSize(8).text(headers[i], x + 4, y + 6, { width: cols[i] - 8 });
    x += cols[i];
  }
  doc.y = y + 20;

  const floors = [
    ['Basement (Parking)', '3,200', '15', '4.8', '1.4'],
    ['Podium Parking', '3,200', '15', '4.8', '1.4'],
    ['Ground Floor (Lobby)', '3,200', '120', '38.4', '10.9'],
    ['1st Floor (Office)', '3,200', '110', '35.2', '10.0'],
    ['2nd Floor (Office)', '3,200', '110', '35.2', '10.0'],
    ['3rd – 17th Floor (×15)', '48,000', '110', '528.0', '150.1'],
    ['18th Floor (Penthouse)', '3,200', '100', '32.0', '9.1'],
    ['Roof (AHU/Plant)', '—', '—', '—', '—'],
  ];

  for (const row of floors) {
    y = doc.y;
    x = startX;
    const isAlt = floors.indexOf(row) % 2 === 1;
    for (let i = 0; i < row.length; i++) {
      if (isAlt) doc.rect(x, y, cols[i], 18).fill('#f5f7fa');
      else doc.rect(x, y, cols[i], 18).fill('#fff');
      doc.rect(x, y, cols[i], 18).stroke('#e0e0e0');
      doc.fill('#333').fontSize(8).text(row[i], x + 4, y + 5, { width: cols[i] - 8 });
      x += cols[i];
    }
    doc.y = y + 18;
  }

  // Total row
  y = doc.y;
  x = startX;
  const totals = ['TOTAL', '72,000', '—', '678.4', '192.9'];
  for (let i = 0; i < totals.length; i++) {
    doc.rect(x, y, cols[i], 22).fill('#e8f0fe');
    doc.fill('#1e3a5f').fontSize(9).text(totals[i], x + 4, y + 6, { width: cols[i] - 8 });
    x += cols[i];
  }
  doc.y = y + 30;

  drawSectionTitle(doc, 'HVAC SYSTEM BREAKDOWN');
  drawTable(doc, [
    ['Total Calculated Load', '678.4 kW (192.9 TR)'],
    ['FAHU Load (Fresh Air)', '85.2 kW (24.2 TR)'],
    ['AC Unit Load (Cooling)', '593.2 kW (168.7 TR)'],
    ['Recommended System', 'VRF System (Variable Refrigerant Flow)'],
    ['Safety Factor', '10% applied'],
    ['Design Load (with SF)', '746.2 kW (212.2 TR)'],
    ['Diversity Factor', '0.85'],
    ['Peak Demand', '634.3 kW (180.3 TR)'],
  ]);

  drawSectionTitle(doc, 'EQUIPMENT SCHEDULE — VRF OUTDOOR UNITS');
  drawTable(doc, [
    ['VRF Outdoor Units', '12 × 16 HP units (Daikin VRV-X or equivalent)'],
    ['Total Capacity', '192 HP = 192.9 TR'],
    ['FAHU Units', '4 × 6.0 TR heat recovery type'],
    ['Exhaust Fans', '18 × inline duct fans (toilets & pantries)'],
    ['Smoke Extract', '2 × axial fans (basement parking)'],
    ['FCU for Lobby', '3 × ceiling cassette units'],
  ]);

  drawSectionTitle(doc, 'DESIGN CONDITIONS');
  drawTable(doc, [
    ['Outdoor Temperature', '46°C DB / 30°C WB (Dubai summer peak)'],
    ['Indoor Temperature', '23°C ± 1°C (offices), 24°C (lobby)'],
    ['Relative Humidity', '50% ± 5%'],
    ['Fresh Air Rate', '8.5 L/s per person (ASHRAE 62.1)'],
    ['Occupancy', '1 person per 10 sqm (offices)'],
  ]);

  drawFooter(doc, 'KEO International Consultants — Document KEO-AZT-HVAC-TLC-001 Rev A — CONFIDENTIAL');
  doc.end();
  console.log(`  ✓ ${filePath}`);
}

// ---- 3. HVAC Equipment Schedule PDF ----

function generateEquipmentSchedule() {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 50 });
  const filePath = path.join(OUTPUT_DIR, 'HVAC_Equipment_Schedule.pdf');
  doc.pipe(fs.createWriteStream(filePath));

  drawHeader(doc, 'KEO INTERNATIONAL CONSULTANTS', 'HVAC Equipment Schedule — Al Zahra Commercial Tower');

  doc.fontSize(10).text('Document: KEO-AZT-HVAC-ES-001   Rev: A   |   Date: March 2026');
  doc.moveDown(1);

  drawSectionTitle(doc, 'VRF OUTDOOR UNIT SCHEDULE');

  const equipment = [
    { tag: 'VRF-ODU-01 to 06', location: 'Roof Level A', type: 'VRF Outdoor (Heat Recovery)', capacity: '16 HP each', qty: 6, make: 'Daikin VRV-X / Mitsubishi City Multi' },
    { tag: 'VRF-ODU-07 to 12', location: 'Roof Level B', type: 'VRF Outdoor (Heat Recovery)', capacity: '16 HP each', qty: 6, make: 'Daikin VRV-X / Mitsubishi City Multi' },
    { tag: 'FAHU-01 to 04', location: 'Each 5th floor AHU room', type: 'Fresh Air Handling Unit', capacity: '6.0 TR each', qty: 4, make: 'Carrier / Zamil' },
    { tag: 'EF-01 to 18', location: 'Toilet/pantry shafts', type: 'Inline Duct Exhaust Fan', capacity: '300 CFM each', qty: 18, make: 'S&P / Kruger' },
    { tag: 'SEF-01, 02', location: 'Basement parking', type: 'Axial Smoke Extract Fan', capacity: '25,000 CFM each', qty: 2, make: 'Systemair / Woods' },
    { tag: 'FCU-L1 to L3', location: 'Ground Floor Lobby', type: 'Ceiling Cassette FCU', capacity: '3.5 TR each', qty: 3, make: 'Daikin / Carrier' },
  ];

  for (const eq of equipment) {
    doc.fontSize(9).fill('#1e3a5f').text(eq.tag, 58, doc.y, { continued: true });
    doc.fill('#333').text(`  |  ${eq.location}  |  ${eq.type}  |  ${eq.capacity}  |  Qty: ${eq.qty}  |  ${eq.make}`);
  }

  doc.moveDown(2);
  drawSectionTitle(doc, 'APPROVED MAKES');
  const makes: [string, string][] = [
    ['VRF System', 'Daikin, Mitsubishi Electric, LG, Samsung'],
    ['FAHU', 'Carrier, Zamil, SKM, Al Salem Johnson Controls'],
    ['Exhaust Fans', 'S&P, Kruger, Systemair, Greenheck'],
    ['Ductwork', 'Pre-insulated (PIR): Premdor, P3ducto, Ductoseal'],
    ['Controls', 'Honeywell, Siemens, Johnson Controls'],
    ['Copper Piping', 'Mueller, Cambridge-Lee, Kembla'],
    ['Insulation', 'Armaflex, K-Flex (19mm for piping, 25mm for duct)'],
  ];
  drawTable(doc, makes);

  drawFooter(doc, 'KEO International Consultants — HVAC Equipment Schedule — Rev A');
  doc.end();
  console.log(`  ✓ ${filePath}`);
}

// ---- 4. MEP Specifications PDF ----

function generateSpecifications() {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const filePath = path.join(OUTPUT_DIR, 'Specifications_MEP.pdf');
  doc.pipe(fs.createWriteStream(filePath));

  drawHeader(doc, 'KEO INTERNATIONAL CONSULTANTS', 'MEP Specifications — Al Zahra Commercial Tower');

  doc.fontSize(10).text('Document: KEO-AZT-MEP-SPEC-001   Rev: A');
  doc.text('Date: March 2026');
  doc.moveDown(1);

  // HVAC Spec
  drawSectionTitle(doc, 'SECTION 23 00 00 — HVAC');
  doc.fontSize(9).text(
    '1. VRF System shall be heat-recovery type with minimum COP of 4.0 at AHRI conditions.\n' +
    '2. All refrigerant piping shall be ACR grade copper, brazed joints, pressure tested at 600 psi.\n' +
    '3. Pre-insulated ductwork (PIR type) for all supply and return ducts.\n' +
    '4. Fresh air handling units with heat recovery wheel, minimum 70% effectiveness.\n' +
    '5. All equipment to comply with ASHRAE 90.1 energy efficiency standards.\n' +
    '6. Commissioning as per ASHRAE Guideline 0-2005.',
    { lineGap: 2 }
  );

  doc.moveDown(0.5);
  drawSectionTitle(doc, 'SECTION 26 00 00 — ELECTRICAL');
  doc.fontSize(9).text(
    '1. Main LV Switchboard: 4000A, 415V, 3-phase, 4-wire, 50Hz.\n' +
    '2. Sub-distribution boards: MCB/MCCB type, IP54 rated.\n' +
    '3. Cable trays: Hot-dip galvanized, ladder type for power, perforated for data.\n' +
    '4. Lighting: LED throughout, minimum 90 CRI, dimmable in office areas.\n' +
    '5. Emergency lighting: maintained type, 3-hour battery backup.\n' +
    '6. Earthing: 2 × earth pits per riser, interconnected ring.\n' +
    '7. Lightning protection: ESE type, coverage per BS EN 62305.',
    { lineGap: 2 }
  );

  doc.moveDown(0.5);
  drawSectionTitle(doc, 'SECTION 22 00 00 — PLUMBING');
  doc.fontSize(9).text(
    '1. Water supply: PPR pipes (hot & cold), pressure rated PN20.\n' +
    '2. Drainage: uPVC pipes, BS EN 1401, with anti-siphon traps.\n' +
    '3. Sanitary fixtures: Duravit / Grohe / equivalent, water-saving type.\n' +
    '4. Water tanks: GRP sectional, 2-day storage capacity.\n' +
    '5. Pumps: Grundfos / Wilo, variable speed for boosting.\n' +
    '6. Solar water heating pre-piping for future installation.',
    { lineGap: 2 }
  );

  doc.moveDown(0.5);
  drawSectionTitle(doc, 'SECTION 21 00 00 — FIRE PROTECTION');
  doc.fontSize(9).text(
    '1. Sprinkler system: wet type, K-factor 5.6, ordinary hazard Group 1.\n' +
    '2. Fire hydrant system: Class II standpipe, 100mm risers.\n' +
    '3. Fire pump: diesel + electric, 100% standby, UL/FM listed.\n' +
    '4. FM200: clean agent for server room (50 sqm), 7% concentration.\n' +
    '5. All components UL/FM listed, installation per NFPA 13, 14, 20.\n' +
    '6. Fire alarm: addressable, Notifier / Honeywell / Edwards.',
    { lineGap: 2 }
  );

  doc.moveDown(0.5);
  drawSectionTitle(doc, 'GENERAL REQUIREMENTS');
  doc.fontSize(9).text(
    '• All works to comply with Dubai Municipality, DEWA, and Civil Defence regulations.\n' +
    '• Contractor to provide shop drawings, material submittals, and O&M manuals.\n' +
    '• 12-month defects liability period from practical completion.\n' +
    '• Performance bond: 10% of contract value.\n' +
    '• Retention: 10% (5% released at practical completion, 5% at end of DLP).\n' +
    '• Insurance: CAR policy covering full contract value.',
    { lineGap: 2 }
  );

  drawFooter(doc, 'KEO International Consultants — MEP Specifications Vol.1 — CONFIDENTIAL');
  doc.end();
  console.log(`  ✓ ${filePath}`);
}

// ---- 5. BOQ Template (PDF version) ----

function generateBOQTemplate() {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 50 });
  const filePath = path.join(OUTPUT_DIR, 'BOQ_Template_Al_Zahra.pdf');
  doc.pipe(fs.createWriteStream(filePath));

  drawHeader(doc, 'AL ZAHRA PROPERTIES LLC', 'Bill of Quantities — MEP Works Template');

  doc.fontSize(10).text('Project: Al Zahra Commercial Tower, JLT   |   Ref: AZP/BOQ/2026/0347');
  doc.moveDown(1);

  drawSectionTitle(doc, 'BOQ SUMMARY');
  const boqItems = [
    ['A', 'HVAC WORKS', '', '', ''],
    ['A.1', 'VRF Outdoor Units (16HP)', '12', 'Nos', '___________'],
    ['A.2', 'VRF Indoor Units (various)', '120', 'Nos', '___________'],
    ['A.3', 'FAHU (6 TR)', '4', 'Nos', '___________'],
    ['A.4', 'Pre-insulated Ductwork', '2,800', 'Sqm', '___________'],
    ['A.5', 'Copper Piping (all sizes)', '1', 'Lot', '___________'],
    ['A.6', 'Controls & Commissioning', '1', 'Lot', '___________'],
    ['B', 'ELECTRICAL WORKS', '', '', ''],
    ['B.1', 'Main LV Switchboard', '1', 'Nos', '___________'],
    ['B.2', 'Sub-DB Panels', '42', 'Nos', '___________'],
    ['B.3', 'LED Light Fixtures', '1,800', 'Nos', '___________'],
    ['B.4', 'Power & Data Cabling', '1', 'Lot', '___________'],
    ['B.5', 'Cable Trays & Containment', '1', 'Lot', '___________'],
    ['C', 'PLUMBING WORKS', '', '', ''],
    ['C.1', 'Water Supply Piping (PPR)', '1', 'Lot', '___________'],
    ['C.2', 'Drainage Piping (uPVC)', '1', 'Lot', '___________'],
    ['C.3', 'Sanitary Fixtures', '210', 'Nos', '___________'],
    ['C.4', 'Water Pumps', '4', 'Nos', '___________'],
    ['D', 'FIRE FIGHTING', '', '', ''],
    ['D.1', 'Sprinkler Heads', '1,400', 'Nos', '___________'],
    ['D.2', 'Fire Pump Set', '1', 'Lot', '___________'],
    ['D.3', 'Fire Hydrant/Hose Reels', '42', 'Nos', '___________'],
    ['D.4', 'FM200 System', '1', 'Lot', '___________'],
    ['E', 'FIRE ALARM', '', '', ''],
    ['E.1', 'Addressable Panel', '1', 'Nos', '___________'],
    ['E.2', 'Detectors & Devices', '850', 'Nos', '___________'],
    ['F', 'BMS', '', '', ''],
    ['F.1', 'BMS Controllers & Integration', '1', 'Lot', '___________'],
  ];

  const startX = 58;
  const colWidths = [50, 250, 60, 50, 120];
  const colHeaders = ['Item', 'Description', 'Qty', 'Unit', 'Amount (AED)'];

  // Header row
  let y = doc.y;
  let x = startX;
  for (let i = 0; i < colHeaders.length; i++) {
    doc.rect(x, y, colWidths[i], 20).fill('#1e3a5f');
    doc.fill('#fff').fontSize(8).text(colHeaders[i], x + 4, y + 6, { width: colWidths[i] - 8 });
    x += colWidths[i];
  }
  doc.y = y + 20;

  for (const row of boqItems) {
    y = doc.y;
    if (y > doc.page.height - 80) {
      doc.addPage();
      y = 50;
      doc.y = 50;
    }
    x = startX;
    const isSection = row[2] === '';
    for (let i = 0; i < row.length; i++) {
      const h = 16;
      if (isSection) doc.rect(x, y, colWidths[i], h).fill('#eef3fa');
      else doc.rect(x, y, colWidths[i], h).fill('#fff');
      doc.rect(x, y, colWidths[i], h).stroke('#e0e0e0');
      doc.fill(isSection ? '#1e3a5f' : '#333').fontSize(isSection ? 9 : 8)
        .text(row[i], x + 4, y + 4, { width: colWidths[i] - 8 });
      x += colWidths[i];
    }
    doc.y = y + 16;
  }

  // Grand total row
  y = doc.y + 4;
  doc.rect(startX, y, 530, 22).fill('#e8f0fe');
  doc.fill('#1e3a5f').fontSize(11).text('GRAND TOTAL (AED)', startX + 10, y + 5);
  doc.text('___________________', startX + 420, y + 5);

  drawFooter(doc, 'Al Zahra Properties LLC — BOQ Template — Ref: AZP/BOQ/2026/0347');
  doc.end();
  console.log(`  ✓ ${filePath}`);
}

// ---- Run All ----

console.log('\nGenerating test tender documents...\n');
generateRFQLetter();
generateThermalLoad();
generateEquipmentSchedule();
generateSpecifications();
generateBOQTemplate();
console.log(`\n✅ All 5 files saved to ${OUTPUT_DIR}/\n`);
console.log('Files to attach when sending the email:');
console.log('  1. RFQ_Letter_Al_Zahra_Tower.pdf  (main RFQ letter)');
console.log('  2. Thermal_Load_Calculation.pdf    (HVAC cooling loads)');
console.log('  3. HVAC_Equipment_Schedule.pdf     (equipment specs)');
console.log('  4. Specifications_MEP.pdf          (full MEP specs)');
console.log('  5. BOQ_Template_Al_Zahra.pdf       (BOQ to fill)');
console.log('\nSend to: estimation@sabi.ae (or chatgptnotes@gmail.com for testing)');
console.log('Subject: RFQ — MEP Works for Al Zahra Commercial Tower, JLT (B+2P+18F), Please Quote\n');
