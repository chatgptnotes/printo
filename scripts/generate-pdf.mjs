#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import AdmZip from 'adm-zip';

const OUT_DIR = path.join(process.cwd(), 'test-files');

function generatePDF() {
  console.log('Generating PDF...');
  return new Promise((resolve) => {
    const filePath = path.join(OUT_DIR, 'SABI_MEP_Thermal_Load_Report.pdf');
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // ─── Page 1: Cover ───
    doc.moveDown(6);
    doc.fontSize(32).font('Helvetica-Bold').fillColor('#1F4E79')
      .text('THERMAL LOAD CALCULATION', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(24).fillColor('#2E75B6')
      .text('Al Reem Tower — Dubai Marina', { align: 'center' });
    doc.moveDown(2);
    doc.fontSize(14).font('Helvetica').fillColor('#666666')
      .text('MEP Estimation Department', { align: 'center' });
    doc.text('SABI Contracting LLC', { align: 'center' });
    doc.moveDown(1);
    doc.text('Date: April 8, 2026', { align: 'center' });
    doc.text('Reference: TLC/ART/2026/001', { align: 'center' });
    doc.moveDown(3);
    doc.fontSize(11).fillColor('#999999')
      .text('CONFIDENTIAL — For Internal Estimation Use Only', { align: 'center' });

    // ─── Page 2: Project Summary ───
    doc.addPage();
    doc.fontSize(18).font('Helvetica-Bold').fillColor('#1F4E79')
      .text('1. PROJECT SUMMARY');
    doc.moveDown(0.5);
    doc.fontSize(11).font('Helvetica').fillColor('#333333');

    const summary = [
      ['Project Name', 'Al Reem Tower'],
      ['Client', 'Al Futtaim Group'],
      ['Location', 'Dubai Marina, Plot 12-B'],
      ['Building Type', 'Grade-A Commercial Office'],
      ['Total Floors', '24 + 4 Basement Parking'],
      ['Total Area', '185,000 sqft'],
      ['Typical Floor Height', '3.6 m'],
      ['Consultant', 'KEO International Consultants'],
      ['HVAC System', 'VRF (Variable Refrigerant Flow)'],
      ['Total Cooling Load', '1,035.4 kW (294.4 TR)'],
      ['FAHU Load', '180.2 kW'],
      ['Net AC Load', '855.2 kW (243.2 TR)'],
    ];

    const tableTop = doc.y + 10;
    const col1X = 60;
    const col2X = 260;
    const rowH = 22;

    // Header
    doc.rect(col1X - 5, tableTop - 5, 480, rowH).fill('#1F4E79');
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#FFFFFF');
    doc.text('Parameter', col1X, tableTop, { width: 190 });
    doc.text('Value', col2X, tableTop, { width: 280 });

    summary.forEach((row, i) => {
      const y = tableTop + (i + 1) * rowH;
      if (i % 2 === 0) {
        doc.rect(col1X - 5, y - 3, 480, rowH).fill('#F0F4F8');
      }
      doc.fontSize(10).font('Helvetica').fillColor('#333333');
      doc.text(row[0], col1X, y, { width: 190 });
      doc.font('Helvetica-Bold').text(row[1], col2X, y, { width: 280 });
    });

    doc.y = tableTop + (summary.length + 2) * rowH;

    // ─── Page 2 continued: Thermal Load Table ───
    doc.moveDown(1);
    doc.fontSize(18).font('Helvetica-Bold').fillColor('#1F4E79')
      .text('2. THERMAL LOAD SUMMARY BY FLOOR');
    doc.moveDown(0.5);

    const thermalData = [
      ['Basement 1', 'Parking', '0', 'Exhaust Only', '0'],
      ['Basement 2', 'Parking', '0', 'Exhaust Only', '0'],
      ['Ground Floor', 'Lobby & Reception', '85.5', 'VRF', '12'],
      ['Mezzanine', 'Meeting Rooms', '42.3', 'VRF', '8'],
      ['1st Floor', 'Open Office', '125.8', 'VRF', '18'],
      ['2nd Floor', 'Open Office', '125.8', 'VRF', '18'],
      ['3rd Floor', 'Open Office', '125.8', 'VRF', '18'],
      ['4th Floor', 'Open Office', '125.8', 'VRF', '18'],
      ['5th Floor', 'Open Office', '125.8', 'VRF', '18'],
      ['6th Floor', 'Executive Suites', '98.4', 'VRF', '14'],
      ['7th Floor', 'IT & Server Room', '180.2', 'Precision AC', '6'],
      ['Roof', 'Plant Room', '0', 'N/A', '0'],
    ];

    const headers = ['Floor', 'Zone', 'Load (kW)', 'System', 'Indoor Units'];
    const colWidths = [90, 120, 80, 100, 80];
    let tY = doc.y + 10;

    // Header row
    doc.rect(col1X - 5, tY - 3, 480, rowH).fill('#548235');
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#FFFFFF');
    let xPos = col1X;
    headers.forEach((h, i) => {
      doc.text(h, xPos, tY, { width: colWidths[i] });
      xPos += colWidths[i];
    });

    thermalData.forEach((row, i) => {
      tY += rowH;
      if (i % 2 === 0) {
        doc.rect(col1X - 5, tY - 3, 480, rowH).fill('#F0F8F0');
      }
      doc.fontSize(9).font('Helvetica').fillColor('#333333');
      xPos = col1X;
      row.forEach((cell, j) => {
        doc.text(cell, xPos, tY, { width: colWidths[j] });
        xPos += colWidths[j];
      });
    });

    // Total row
    tY += rowH;
    doc.rect(col1X - 5, tY - 3, 480, rowH).fill('#548235');
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#FFFFFF');
    doc.text('TOTAL', col1X, tY, { width: 90 });
    doc.text('', col1X + 90, tY, { width: 120 });
    doc.text('1,035.4', col1X + 210, tY, { width: 80 });
    doc.text('', col1X + 290, tY, { width: 100 });
    doc.text('130', col1X + 390, tY, { width: 80 });

    // ─── Page 3: HVAC Calculations ───
    doc.addPage();
    doc.fontSize(18).font('Helvetica-Bold').fillColor('#1F4E79')
      .text('3. HVAC SYSTEM CALCULATION');
    doc.moveDown(0.5);

    const calcSteps = [
      { step: 'Step 1: Total Calculated KW', value: '1,035.4 kW', note: 'Sum of all floor loads from thermal load drawing' },
      { step: 'Step 2: FAHU KW', value: '180.2 kW', note: 'Fresh Air Handling Unit load (Server Room + common areas)' },
      { step: 'Step 3: AC Unit KW', value: '855.2 kW', note: 'Total KW - FAHU KW = 1,035.4 - 180.2' },
      { step: 'Step 4: System Type', value: 'VRF', note: 'Based on equipment schedule — Variable Refrigerant Flow system' },
      { step: 'Step 5: Tonnage', value: '243.2 TR', note: 'AC Unit KW / 3.517 = 855.2 / 3.517' },
      { step: 'Step 6: Total Tonnage', value: '294.4 TR', note: 'Total KW / 3.517 = 1,035.4 / 3.517 (including FAHU)' },
    ];

    calcSteps.forEach((calc, i) => {
      doc.moveDown(0.5);
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#2E75B6')
        .text(calc.step);
      doc.fontSize(20).font('Helvetica-Bold').fillColor('#1F4E79')
        .text(calc.value);
      doc.fontSize(9).font('Helvetica').fillColor('#666666')
        .text(calc.note);
      if (i < calcSteps.length - 1) {
        doc.moveDown(0.3);
        doc.moveTo(60, doc.y).lineTo(540, doc.y).strokeColor('#E0E0E0').stroke();
      }
    });

    doc.moveDown(1.5);
    doc.fontSize(18).font('Helvetica-Bold').fillColor('#1F4E79')
      .text('4. PRICING FORMULA');
    doc.moveDown(0.5);

    const pricing = [
      ['HVAC (VRF)', 'AED 17.57/sqft', '185,000 sqft', 'AED 3,250,000'],
      ['Electrical', 'AED 10.00/sqft', '185,000 sqft', 'AED 1,850,000'],
      ['Plumbing', 'AED 4.97/sqft', '185,000 sqft', 'AED 920,000'],
      ['Fire Fighting', 'AED 4.22/sqft', '185,000 sqft', 'AED 780,000'],
    ];

    let pY = doc.y + 10;
    doc.rect(col1X - 5, pY - 3, 480, rowH).fill('#2E75B6');
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#FFFFFF');
    ['Service', 'Rate', 'Area', 'Amount'].forEach((h, i) => {
      doc.text(h, col1X + i * 120, pY, { width: 120 });
    });

    pricing.forEach((row, i) => {
      pY += rowH;
      if (i % 2 === 0) doc.rect(col1X - 5, pY - 3, 480, rowH).fill('#F0F4F8');
      doc.fontSize(9).font('Helvetica').fillColor('#333333');
      row.forEach((cell, j) => {
        doc.text(cell, col1X + j * 120, pY, { width: 120 });
      });
    });

    pY += rowH;
    doc.rect(col1X - 5, pY - 3, 480, rowH).fill('#1F4E79');
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#FFFFFF');
    doc.text('TOTAL MEP ESTIMATE', col1X, pY, { width: 360 });
    doc.text('AED 6,800,000', col1X + 360, pY, { width: 120 });

    // ─── Page 4: Equipment Schedule ───
    doc.addPage();
    doc.fontSize(18).font('Helvetica-Bold').fillColor('#1F4E79')
      .text('5. EQUIPMENT SCHEDULE');
    doc.moveDown(0.5);

    const equipment = [
      ['ODU-01 to ODU-08', 'VRF Outdoor Unit 22HP', 'Daikin RXYQ22TATL', '8', 'Roof'],
      ['FCU-GF-01 to 12', 'Indoor Unit Ducted 2.2kW', 'Daikin FXDQ20', '12', 'Ground Floor'],
      ['FCU-MZ-01 to 08', 'Indoor Unit Ducted 2.2kW', 'Daikin FXDQ20', '8', 'Mezzanine'],
      ['FCU-1F to 5F', 'Indoor Unit Ducted 2.2kW', 'Daikin FXDQ20', '90', 'Typical Floors'],
      ['FCU-6F-01 to 14', 'Indoor Unit Decorative 1.5kW', 'Daikin FXKQ15', '14', '6th Floor'],
      ['FCU-7F-01 to 06', 'Precision AC 10kW', 'Emerson Liebert', '6', '7th Floor'],
      ['FAHU-01 to 04', 'Fresh Air Handling Unit 5000CFM', 'Daikin AHU', '4', 'Roof'],
      ['EF-01 to EF-08', 'Exhaust Fan 2000CFM', 'Kruger', '8', 'Basements'],
    ];

    let eY = doc.y + 10;
    const eCols = [110, 130, 100, 30, 80];
    const eHeaders = ['Tag', 'Description', 'Model', 'Qty', 'Location'];

    doc.rect(col1X - 5, eY - 3, 480, rowH).fill('#1F4E79');
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#FFFFFF');
    let eX = col1X;
    eHeaders.forEach((h, i) => { doc.text(h, eX, eY, { width: eCols[i] }); eX += eCols[i]; });

    equipment.forEach((row, i) => {
      eY += rowH;
      if (i % 2 === 0) doc.rect(col1X - 5, eY - 3, 480, rowH).fill('#F0F4F8');
      doc.fontSize(8).font('Helvetica').fillColor('#333333');
      eX = col1X;
      row.forEach((cell, j) => { doc.text(cell, eX, eY, { width: eCols[j] }); eX += eCols[j]; });
    });

    doc.moveDown(3);
    doc.fontSize(18).font('Helvetica-Bold').fillColor('#1F4E79')
      .text('6. YARDSTICK COMPARISON');
    doc.moveDown(0.5);
    doc.fontSize(11).font('Helvetica').fillColor('#333333');
    doc.text('Market benchmark for Grade-A Office (Dubai): AED 32 - 42 per sqft');
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').fillColor('#548235')
      .text('Our estimate: AED 36.76 per sqft — WITHIN RANGE');
    doc.moveDown(0.3);
    doc.font('Helvetica').fillColor('#666666')
      .text('Status: Approved for quotation preparation');

    doc.moveDown(2);
    doc.fontSize(10).font('Helvetica').fillColor('#999999');
    doc.text('Prepared by: SABI Estimation Department', { align: 'center' });
    doc.text('Approved by: George Varkey M — Technical Director', { align: 'center' });
    doc.text('george@sabi.ae | +971 4 XXX XXXX', { align: 'center' });

    doc.end();
    stream.on('finish', () => {
      console.log(`  -> ${filePath} (${(fs.statSync(filePath).size / 1024).toFixed(1)} KB)`);
      resolve(filePath);
    });
  });
}

async function main() {
  console.log('\n=== Generating PDF + Updating ZIP ===\n');
  const pdfPath = await generatePDF();

  // Update ZIP with the PDF
  const zipPath = path.join(process.cwd(), 'SABI_RFQ_Test_Package.zip');
  const zip = new AdmZip(zipPath);
  zip.addLocalFile(pdfPath);
  zip.writeZip(zipPath);

  const sizeMB = (fs.statSync(zipPath).size / (1024 * 1024)).toFixed(2);
  console.log(`\n  ZIP updated: ${zipPath} (${sizeMB} MB)`);

  // Also copy to Downloads
  fs.copyFileSync(pdfPath, path.join('/Users/apple/Downloads', path.basename(pdfPath)));
  fs.copyFileSync(zipPath, path.join('/Users/apple/Downloads', path.basename(zipPath)));
  console.log('  Copied to ~/Downloads/\n');
}

main().catch(err => { console.error('Error:', err); process.exit(1); });
