#!/usr/bin/env node
/**
 * Generate dummy test files (CSV, DOCX, XLSX, PPTX) and zip them together.
 * Usage: node generate-test-files.mjs
 * Output: test-rfq-package.zip (~1-2 MB)
 */

import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import PptxGenJS from 'pptxgenjs';
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel, BorderStyle, WidthType, AlignmentType } from 'docx';
import AdmZip from 'adm-zip';

const OUT_DIR = path.join(process.cwd(), 'test-files');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// ─── Dummy Data ───────────────────────────────────────────────────────────
const projects = [
  { id: 'PRJ-001', name: 'Al Reem Tower', client: 'Al Futtaim Group', location: 'Dubai Marina', type: 'Office', floors: 24, parking: 4, area: 185000, height: 3.6, deadline: '2026-05-15', services: 'HVAC, Electrical, Plumbing, Fire Fighting', status: 'New', priority: 'Top' },
  { id: 'PRJ-002', name: 'Creek Vista Residences', client: 'Emaar Properties', location: 'Dubai Creek Harbour', type: 'Residential', floors: 35, parking: 5, area: 320000, height: 3.2, deadline: '2026-06-01', services: 'HVAC, Electrical, Plumbing, Fire Alarm, BMS', status: 'Extracted', priority: 'Top' },
  { id: 'PRJ-003', name: 'Palm Gateway Mall', client: 'Nakheel', location: 'Palm Jumeirah', type: 'Retail', floors: 4, parking: 3, area: 95000, height: 4.5, deadline: '2026-04-30', services: 'HVAC, Electrical, Plumbing, Fire Fighting, BMS', status: 'Estimating', priority: 'General' },
  { id: 'PRJ-004', name: 'DIFC Business Hub', client: 'DIFC Authority', location: 'DIFC', type: 'Office', floors: 18, parking: 3, area: 145000, height: 3.8, deadline: '2026-05-20', services: 'HVAC, Electrical, Plumbing, Fire Fighting, Fire Alarm', status: 'New', priority: 'Top' },
  { id: 'PRJ-005', name: 'Jumeirah Lake Towers Villa', client: 'Meraas Holding', location: 'JLT', type: 'Villa', floors: 3, parking: 1, area: 8500, height: 3.5, deadline: '2026-07-01', services: 'HVAC, Electrical, Plumbing', status: 'New', priority: 'General' },
  { id: 'PRJ-006', name: 'Dubai Hills Hospital', client: 'Dubai Health Authority', location: 'Dubai Hills Estate', type: 'Hospital', floors: 12, parking: 4, area: 220000, height: 4.0, deadline: '2026-08-15', services: 'HVAC, Electrical, Plumbing, Fire Fighting, Fire Alarm, BMS, LPG', status: 'New', priority: 'Top' },
  { id: 'PRJ-007', name: 'Business Bay Hotel', client: 'Jumeirah Group', location: 'Business Bay', type: 'Hotel', floors: 28, parking: 5, area: 260000, height: 3.4, deadline: '2026-06-30', services: 'HVAC, Electrical, Plumbing, Fire Fighting, BMS', status: 'Classified', priority: 'General' },
  { id: 'PRJ-008', name: 'Al Quoz Warehouse Complex', client: 'DP World', location: 'Al Quoz Industrial', type: 'Warehouse', floors: 2, parking: 0, area: 45000, height: 8.0, deadline: '2026-05-10', services: 'HVAC, Electrical, Plumbing, Fire Fighting', status: 'New', priority: 'General' },
  { id: 'PRJ-009', name: 'La Mer Restaurant', client: 'Meraas', location: 'La Mer', type: 'Restaurant', floors: 2, parking: 0, area: 4500, height: 4.2, deadline: '2026-04-25', services: 'HVAC, Electrical, Plumbing, LPG, Fire Fighting', status: 'New', priority: 'Top' },
  { id: 'PRJ-010', name: 'Silicon Oasis Tower B', client: 'DSOA', location: 'Dubai Silicon Oasis', type: 'Office', floors: 15, parking: 3, area: 110000, height: 3.6, deadline: '2026-07-15', services: 'HVAC, Electrical, Plumbing, Fire Fighting, Fire Alarm', status: 'Extracted', priority: 'General' },
];

const boqItems = [
  { service: 'HVAC', item: 'VRF Outdoor Unit 22HP', unit: 'No.', qty: 8, rate: 45000, category: 'Equipment' },
  { service: 'HVAC', item: 'VRF Indoor Unit - Ducted (2.2kW)', unit: 'No.', qty: 120, rate: 3500, category: 'Equipment' },
  { service: 'HVAC', item: 'VRF Indoor Unit - Decorative (1.5kW)', unit: 'No.', qty: 45, rate: 2800, category: 'Equipment' },
  { service: 'HVAC', item: 'Fresh Air Handling Unit (FAHU) 5000CFM', unit: 'No.', qty: 4, rate: 65000, category: 'Equipment' },
  { service: 'HVAC', item: 'Refrigerant Piping (R410A)', unit: 'RM', qty: 2400, rate: 85, category: 'Installation' },
  { service: 'HVAC', item: 'Duct Fabrication & Installation', unit: 'Sqm', qty: 3200, rate: 120, category: 'Installation' },
  { service: 'HVAC', item: 'Insulation (25mm Class O)', unit: 'Sqm', qty: 3200, rate: 45, category: 'Insulation' },
  { service: 'HVAC', item: 'Condensate Drain Piping', unit: 'RM', qty: 800, rate: 35, category: 'Installation' },
  { service: 'HVAC', item: 'Diffusers & Grilles Supply', unit: 'No.', qty: 350, rate: 180, category: 'Accessories' },
  { service: 'HVAC', item: 'Return Air Grilles', unit: 'No.', qty: 200, rate: 120, category: 'Accessories' },
  { service: 'HVAC', item: 'Fire Dampers', unit: 'No.', qty: 60, rate: 450, category: 'Fire Safety' },
  { service: 'HVAC', item: 'Testing & Commissioning', unit: 'Lot', qty: 1, rate: 35000, category: 'Commissioning' },
  { service: 'Electrical', item: 'Main Distribution Board (MDB)', unit: 'No.', qty: 2, rate: 85000, category: 'Equipment' },
  { service: 'Electrical', item: 'Sub Distribution Board (SDB)', unit: 'No.', qty: 12, rate: 15000, category: 'Equipment' },
  { service: 'Electrical', item: 'Cable Tray (300x100mm)', unit: 'RM', qty: 1500, rate: 95, category: 'Installation' },
  { service: 'Electrical', item: 'Power Cable (4C x 95mm)', unit: 'RM', qty: 800, rate: 320, category: 'Cables' },
  { service: 'Electrical', item: 'Lighting Fixtures - LED Panel', unit: 'No.', qty: 450, rate: 380, category: 'Lighting' },
  { service: 'Electrical', item: 'Emergency Lighting', unit: 'No.', qty: 80, rate: 650, category: 'Lighting' },
  { service: 'Electrical', item: 'DB Wiring & Termination', unit: 'Lot', qty: 1, rate: 45000, category: 'Installation' },
  { service: 'Plumbing', item: 'PPR Pipe Supply & Install (50mm)', unit: 'RM', qty: 1200, rate: 55, category: 'Piping' },
  { service: 'Plumbing', item: 'PPR Pipe Supply & Install (25mm)', unit: 'RM', qty: 2000, rate: 35, category: 'Piping' },
  { service: 'Plumbing', item: 'Water Heater (100L)', unit: 'No.', qty: 15, rate: 2800, category: 'Equipment' },
  { service: 'Plumbing', item: 'Sanitary Fixtures - WC', unit: 'No.', qty: 60, rate: 1200, category: 'Fixtures' },
  { service: 'Plumbing', item: 'Sanitary Fixtures - Basin', unit: 'No.', qty: 60, rate: 800, category: 'Fixtures' },
  { service: 'Fire Fighting', item: 'Fire Pump Set (Diesel + Jockey)', unit: 'Set', qty: 1, rate: 180000, category: 'Equipment' },
  { service: 'Fire Fighting', item: 'Sprinkler Head (Pendant K5.6)', unit: 'No.', qty: 800, rate: 45, category: 'Sprinklers' },
  { service: 'Fire Fighting', item: 'Fire Hose Reel Cabinet', unit: 'No.', qty: 24, rate: 3500, category: 'Equipment' },
  { service: 'Fire Fighting', item: 'Wet Riser Piping (150mm)', unit: 'RM', qty: 350, rate: 280, category: 'Piping' },
  { service: 'Fire Fighting', item: 'Sprinkler Piping (25-50mm)', unit: 'RM', qty: 3000, rate: 65, category: 'Piping' },
];

const thermalLoadData = [
  { floor: 'Basement 1', zone: 'Parking', kw: 0, system: 'Exhaust Only', units: 0 },
  { floor: 'Basement 2', zone: 'Parking', kw: 0, system: 'Exhaust Only', units: 0 },
  { floor: 'Ground Floor', zone: 'Lobby & Reception', kw: 85.5, system: 'VRF', units: 12 },
  { floor: 'Mezzanine', zone: 'Meeting Rooms', kw: 42.3, system: 'VRF', units: 8 },
  { floor: '1st Floor', zone: 'Open Office', kw: 125.8, system: 'VRF', units: 18 },
  { floor: '2nd Floor', zone: 'Open Office', kw: 125.8, system: 'VRF', units: 18 },
  { floor: '3rd Floor', zone: 'Open Office', kw: 125.8, system: 'VRF', units: 18 },
  { floor: '4th Floor', zone: 'Open Office', kw: 125.8, system: 'VRF', units: 18 },
  { floor: '5th Floor', zone: 'Open Office', kw: 125.8, system: 'VRF', units: 18 },
  { floor: '6th Floor', zone: 'Executive Suites', kw: 98.4, system: 'VRF', units: 14 },
  { floor: '7th Floor', zone: 'IT & Server Room', kw: 180.2, system: 'Precision AC', units: 6 },
  { floor: 'Roof', zone: 'Plant Room', kw: 0, system: 'N/A', units: 0 },
];

const totKw = thermalLoadData.reduce((s, d) => s + d.kw, 0);
const totUnits = thermalLoadData.reduce((s, d) => s + d.units, 0);

// ─── 1. CSV FILE ──────────────────────────────────────────────────────────
function generateCSV() {
  console.log('  Generating CSV...');
  const headers = ['Project ID', 'Project Name', 'Client', 'Location', 'Building Type', 'Floors', 'Parking', 'Total Area (sqft)', 'Height (m)', 'Deadline', 'MEP Services', 'Status', 'Priority'];
  const rows = projects.map(p => [p.id, p.name, p.client, p.location, p.type, p.floors, p.parking, p.area, p.height, p.deadline, p.services, p.status, p.priority]);
  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const filePath = path.join(OUT_DIR, 'SABI_Bid_List_2026.csv');
  fs.writeFileSync(filePath, csv);
  console.log(`    -> ${filePath} (${(fs.statSync(filePath).size / 1024).toFixed(1)} KB)`);
  return filePath;
}

// ─── 2. XLSX FILE ─────────────────────────────────────────────────────────
async function generateXLSX() {
  console.log('  Generating XLSX...');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SABI Estimation Department';
  wb.created = new Date();

  // Sheet 1: Bid List
  const ws1 = wb.addWorksheet('Bid List');
  ws1.columns = [
    { header: 'Project ID', key: 'id', width: 12 },
    { header: 'Project Name', key: 'name', width: 30 },
    { header: 'Client', key: 'client', width: 25 },
    { header: 'Location', key: 'location', width: 22 },
    { header: 'Type', key: 'type', width: 14 },
    { header: 'Floors', key: 'floors', width: 8 },
    { header: 'Parking', key: 'parking', width: 9 },
    { header: 'Area (sqft)', key: 'area', width: 14 },
    { header: 'Height (m)', key: 'height', width: 12 },
    { header: 'Deadline', key: 'deadline', width: 14 },
    { header: 'Services', key: 'services', width: 45 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Priority', key: 'priority', width: 12 },
  ];
  // Style header
  ws1.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
  ws1.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1F4E79' } };
  projects.forEach(p => ws1.addRow(p));

  // Sheet 2: BOQ
  const ws2 = wb.addWorksheet('BOQ - Al Reem Tower');
  ws2.columns = [
    { header: 'S.No', key: 'sno', width: 6 },
    { header: 'Service', key: 'service', width: 15 },
    { header: 'Category', key: 'category', width: 15 },
    { header: 'Item Description', key: 'item', width: 40 },
    { header: 'Unit', key: 'unit', width: 8 },
    { header: 'Qty', key: 'qty', width: 8 },
    { header: 'Rate (AED)', key: 'rate', width: 14 },
    { header: 'Amount (AED)', key: 'amount', width: 16 },
  ];
  ws2.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
  ws2.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '2E75B6' } };
  boqItems.forEach((item, i) => {
    ws2.addRow({ sno: i + 1, ...item, amount: item.qty * item.rate });
  });
  // Add total row
  const totalRow = ws2.addRow({ sno: '', service: '', category: '', item: 'GRAND TOTAL', unit: '', qty: '', rate: '', amount: boqItems.reduce((s, i) => s + i.qty * i.rate, 0) });
  totalRow.font = { bold: true };
  totalRow.getCell('amount').numFmt = '#,##0';

  // Sheet 3: Thermal Load
  const ws3 = wb.addWorksheet('Thermal Load Summary');
  ws3.columns = [
    { header: 'Floor', key: 'floor', width: 18 },
    { header: 'Zone', key: 'zone', width: 22 },
    { header: 'Total KW', key: 'kw', width: 12 },
    { header: 'System Type', key: 'system', width: 18 },
    { header: 'Indoor Units', key: 'units', width: 14 },
  ];
  ws3.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
  ws3.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '548235' } };
  thermalLoadData.forEach(d => ws3.addRow(d));
  const totKw = thermalLoadData.reduce((s, d) => s + d.kw, 0);
  const totUnits = thermalLoadData.reduce((s, d) => s + d.units, 0);
  const totalLoadRow = ws3.addRow({ floor: 'TOTAL', zone: '', kw: totKw, system: '', units: totUnits });
  totalLoadRow.font = { bold: true };

  // Format number columns
  [ws2, ws3].forEach(ws => {
    ws.eachRow((row, num) => {
      if (num > 1) {
        row.eachCell(cell => {
          if (typeof cell.value === 'number' && cell.value > 100) {
            cell.numFmt = '#,##0';
          }
        });
      }
    });
  });

  const filePath = path.join(OUT_DIR, 'SABI_BOQ_Al_Reem_Tower.xlsx');
  await wb.xlsx.writeFile(filePath);
  console.log(`    -> ${filePath} (${(fs.statSync(filePath).size / 1024).toFixed(1)} KB)`);
  return filePath;
}

// ─── 3. DOCX FILE (3-4 pages) ────────────────────────────────────────────
async function generateDOCX() {
  console.log('  Generating DOCX...');

  const doc = new Document({
    sections: [{
      properties: {},
      children: [
        // Page 1: Cover / Project Brief
        new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'MEP ESTIMATION REQUEST', bold: true, size: 48, font: 'Arial' })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: 'Al Reem Tower - Dubai Marina', size: 32, font: 'Arial', color: '2E75B6' })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 400 }, children: [new TextRun({ text: 'Prepared by: SABI Estimation Department', size: 22, font: 'Arial', italics: true, color: '666666' })] }),
        new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: 'Date: April 8, 2026', size: 22, font: 'Arial' })] }),
        new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: 'Client: Al Futtaim Group', size: 22, font: 'Arial' })] }),
        new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: 'Reference: RFQ/AFG/2026/0415', size: 22, font: 'Arial' })] }),
        new Paragraph({ spacing: { after: 600 }, children: [] }),

        // Page 2: Project Overview
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: '1. PROJECT OVERVIEW', bold: true })] }),
        new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: 'Al Reem Tower is a Grade-A commercial office building located in Dubai Marina, comprising 24 floors above ground with 4 basement parking levels. The total built-up area is approximately 185,000 square feet with a typical floor-to-floor height of 3.6 meters. The building is designed to achieve LEED Gold certification and will serve as the regional headquarters for multiple multinational corporations.' })] }),
        new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: 'The developer, Al Futtaim Group, requires a comprehensive MEP estimation covering HVAC, Electrical, Plumbing, and Fire Fighting services. The quotation deadline is May 15, 2026, and SABI has been invited to submit a competitive bid based on the attached drawings and specifications.' })] }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: '1.1 Building Details', bold: true })] }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({ children: [
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Parameter', bold: true })] })] }),
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Value', bold: true })] })] }),
            ]}),
            ...[ ['Building Type', 'Commercial Office (Grade A)'], ['Total Floors', '24 + 4 Basement'], ['Total Area', '185,000 sqft'], ['Typical Height', '3.6 m'], ['Location', 'Dubai Marina, Plot 12-B'], ['Developer', 'Al Futtaim Group'], ['Consultant', 'KEO International Consultants'], ['Target Certification', 'LEED Gold'], ['Submission Deadline', 'May 15, 2026'],
            ].map(([k, v]) => new TableRow({ children: [
              new TableCell({ children: [new Paragraph(k)] }),
              new TableCell({ children: [new Paragraph(v)] }),
            ]})),
          ],
        }),

        new Paragraph({ spacing: { before: 400 }, heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: '2. SCOPE OF WORK', bold: true })] }),
        new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: 'SABI shall provide a complete MEP estimation for the following services:' })] }),
        ...['HVAC (Heating, Ventilation & Air Conditioning) - VRF system with FAHU for fresh air', 'Electrical - Power distribution, lighting, emergency systems, earthing & lightning protection', 'Plumbing - Water supply, drainage, hot water system, sanitary fixtures', 'Fire Fighting - Sprinkler system, wet riser, fire pump set, hose reel cabinets'].map(text =>
          new Paragraph({ bullet: { level: 0 }, spacing: { after: 100 }, children: [new TextRun(text)] })
        ),

        // Page 3: HVAC Details
        new Paragraph({ spacing: { before: 400 }, heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: '3. HVAC SYSTEM ANALYSIS', bold: true })] }),
        new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: 'Based on the thermal load calculations from the HVAC drawings, the total calculated cooling load is 1,035.4 kW (294.4 TR). The recommended system is a Variable Refrigerant Flow (VRF) system with dedicated Fresh Air Handling Units (FAHUs) for ventilation.' })] }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: '3.1 Thermal Load Summary', bold: true })] }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({ children: ['Floor', 'Zone', 'Load (kW)', 'System', 'Units'].map(h =>
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })] })
            )}),
            ...thermalLoadData.map(d => new TableRow({ children: [d.floor, d.zone, String(d.kw), d.system, String(d.units)].map(v =>
              new TableCell({ children: [new Paragraph(v)] })
            )})),
            new TableRow({ children: ['TOTAL', '', String(totKw.toFixed(1)), '', String(totUnits)].map(v =>
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: v, bold: true })] })] })
            )}),
          ],
        }),

        new Paragraph({ spacing: { before: 300 }, heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: '3.2 System Breakdown', bold: true })] }),
        new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: 'Total Calculated KW: 1,035.4 kW', bold: true })] }),
        new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: 'FAHU KW: 180.2 kW (Fresh Air Handling)', bold: true })] }),
        new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: 'AC Unit KW: 855.2 kW (Total - FAHU = Net AC Load)', bold: true })] }),
        new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: 'Tonnage: 855.2 / 3.517 = 243.2 TR', bold: true })] }),
        new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: 'System Type: VRF (Variable Refrigerant Flow) — based on tonnage range 50-300 TR' })] }),

        // Page 4: Pricing & Terms
        new Paragraph({ spacing: { before: 400 }, heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: '4. PRICING SUMMARY', bold: true })] }),
        new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: 'The estimated MEP pricing is based on current market rates (Q2 2026) and includes supply, installation, testing, and commissioning of all specified systems. Rates are exclusive of VAT (5%).' })] }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({ children: ['Service', 'Amount (AED)', 'AED/sqft'].map(h =>
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })] })
            )}),
            ...[ ['HVAC', '3,250,000', '17.57'], ['Electrical', '1,850,000', '10.00'], ['Plumbing', '920,000', '4.97'], ['Fire Fighting', '780,000', '4.22'] ].map(([s, a, r]) =>
              new TableRow({ children: [s, a, r].map(v => new TableCell({ children: [new Paragraph(v)] })) })
            ),
            new TableRow({ children: ['TOTAL', '6,800,000', '36.76'].map(v =>
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: v, bold: true })] })] })
            )}),
          ],
        }),

        new Paragraph({ spacing: { before: 300 }, heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: '4.1 Yardstick Comparison', bold: true })] }),
        new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: 'Market benchmark for Grade-A Office (Dubai): AED 32 - 42 per sqft' })] }),
        new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: 'Our estimate: AED 36.76 per sqft — WITHIN RANGE', bold: true, color: '548235' })] }),

        new Paragraph({ spacing: { before: 400 }, heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: '5. TERMS & CONDITIONS', bold: true })] }),
        ...['Prices are valid for 30 days from the date of this quotation', 'Payment terms: 30% advance, 60% progress, 10% upon completion', 'Mobilization period: 2 weeks from receipt of confirmed order', 'Warranty: 12 months from date of handover for all MEP works', 'Excludes: Civil works, architectural finishes, furniture, IT/networking', 'All works shall comply with Dubai Municipality and DEWA regulations'].map(text =>
          new Paragraph({ numbering: { reference: 'default-numbering', level: 0 }, spacing: { after: 80 }, children: [new TextRun({ text, size: 20 })] })
        ),

        new Paragraph({ spacing: { before: 400 }, children: [new TextRun({ text: '\n\nPrepared by: SABI Estimation Department\nApproved by: George Varkey M — Technical Director\nContact: george@sabi.ae | +971 4 XXX XXXX', italics: true, color: '666666' })] }),
      ],
    }],
    numbering: {
      config: [{
        reference: 'default-numbering',
        levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.START, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }],
      }],
    },
  });

  const buffer = await Packer.toBuffer(doc);
  const filePath = path.join(OUT_DIR, 'SABI_MEP_Estimation_Al_Reem_Tower.docx');
  fs.writeFileSync(filePath, buffer);
  console.log(`    -> ${filePath} (${(fs.statSync(filePath).size / 1024).toFixed(1)} KB)`);
  return filePath;
}

// ─── 4. PPTX FILE ─────────────────────────────────────────────────────────
async function generatePPTX() {
  console.log('  Generating PPTX...');
  const pptx = new PptxGenJS();
  pptx.author = 'SABI Estimation Department';
  pptx.title = 'Al Reem Tower - MEP Estimation Summary';

  // Slide 1: Title
  let slide = pptx.addSlide();
  slide.background = { color: '1F4E79' };
  slide.addText('MEP ESTIMATION\nSUMMARY', { x: 0.5, y: 1.0, w: 9, h: 2, fontSize: 40, bold: true, color: 'FFFFFF', align: 'center' });
  slide.addText('Al Reem Tower — Dubai Marina', { x: 0.5, y: 3.2, w: 9, h: 0.8, fontSize: 24, color: '90C8F8', align: 'center' });
  slide.addText('SABI MEP Contractors\nApril 2026', { x: 0.5, y: 4.5, w: 9, h: 0.8, fontSize: 16, color: 'AAAAAA', align: 'center', italic: true });

  // Slide 2: Project Overview
  slide = pptx.addSlide();
  slide.addText('Project Overview', { x: 0.5, y: 0.3, w: 9, h: 0.6, fontSize: 28, bold: true, color: '1F4E79' });
  slide.addTable(
    [
      [{ text: 'Parameter', options: { bold: true, fill: { color: '1F4E79' }, color: 'FFFFFF' } }, { text: 'Details', options: { bold: true, fill: { color: '1F4E79' }, color: 'FFFFFF' } }],
      ['Building', 'Al Reem Tower — 24F + 4B Office'],
      ['Client', 'Al Futtaim Group'],
      ['Location', 'Dubai Marina, Plot 12-B'],
      ['Area', '185,000 sqft'],
      ['Height', '3.6m typical floor-to-floor'],
      ['Consultant', 'KEO International Consultants'],
      ['Deadline', 'May 15, 2026'],
      ['MEP Scope', 'HVAC + Electrical + Plumbing + Fire Fighting'],
    ],
    { x: 0.5, y: 1.2, w: 9, h: 3.5, fontSize: 14, border: { type: 'solid', pt: 0.5, color: 'CCCCCC' }, colW: [3, 6], autoPage: true }
  );

  // Slide 3: HVAC Summary
  slide = pptx.addSlide();
  slide.addText('HVAC System Analysis', { x: 0.5, y: 0.3, w: 9, h: 0.6, fontSize: 28, bold: true, color: '1F4E79' });
  slide.addTable(
    [
      [{ text: 'Metric', options: { bold: true, fill: { color: '548235' }, color: 'FFFFFF' } }, { text: 'Value', options: { bold: true, fill: { color: '548235' }, color: 'FFFFFF' } }],
      ['Total Cooling Load', '1,035.4 kW'],
      ['FAHU Load', '180.2 kW'],
      ['Net AC Load', '855.2 kW'],
      ['Total Tonnage', '294.4 TR'],
      ['System Type', 'VRF (Variable Refrigerant Flow)'],
      ['Outdoor Units', '8 x 22HP'],
      ['Indoor Units (Ducted)', '120 units'],
      ['Indoor Units (Decorative)', '45 units'],
      ['FAHUs', '4 x 5,000 CFM'],
    ],
    { x: 0.5, y: 1.2, w: 9, h: 3.5, fontSize: 14, border: { type: 'solid', pt: 0.5, color: 'CCCCCC' }, colW: [4, 5] }
  );

  // Slide 4: Pricing Summary
  slide = pptx.addSlide();
  slide.addText('MEP Pricing Summary', { x: 0.5, y: 0.3, w: 9, h: 0.6, fontSize: 28, bold: true, color: '1F4E79' });
  slide.addTable(
    [
      [{ text: 'Service', options: { bold: true, fill: { color: '2E75B6' }, color: 'FFFFFF' } }, { text: 'Amount (AED)', options: { bold: true, fill: { color: '2E75B6' }, color: 'FFFFFF' } }, { text: 'AED/sqft', options: { bold: true, fill: { color: '2E75B6' }, color: 'FFFFFF' } }],
      ['HVAC', '3,250,000', '17.57'],
      ['Electrical', '1,850,000', '10.00'],
      ['Plumbing', '920,000', '4.97'],
      ['Fire Fighting', '780,000', '4.22'],
      [{ text: 'TOTAL', options: { bold: true } }, { text: 'AED 6,800,000', options: { bold: true } }, { text: '36.76', options: { bold: true } }],
    ],
    { x: 0.5, y: 1.2, w: 9, h: 2.5, fontSize: 16, border: { type: 'solid', pt: 0.5, color: 'CCCCCC' }, colW: [3.5, 3, 2.5] }
  );
  slide.addText('Yardstick: AED 32-42/sqft (Grade-A Office, Dubai)\nOur Estimate: AED 36.76/sqft — WITHIN RANGE', {
    x: 0.5, y: 4.0, w: 9, h: 0.8, fontSize: 14, color: '548235', bold: true, align: 'center',
  });
  slide.addText('Valid for 30 days | Excl. VAT 5%', { x: 0.5, y: 4.8, w: 9, h: 0.4, fontSize: 11, color: '999999', align: 'center', italic: true });

  // Slide 5: Next Steps
  slide = pptx.addSlide();
  slide.background = { color: '1F4E79' };
  slide.addText('Next Steps', { x: 0.5, y: 0.5, w: 9, h: 0.8, fontSize: 32, bold: true, color: 'FFFFFF', align: 'center' });
  slide.addText(
    '1. Review estimation with Technical Director\n' +
    '2. Finalize service scope and quantities\n' +
    '3. Prepare detailed BOQ spreadsheet\n' +
    '4. Submit quotation to Al Futtaim Group\n' +
    '5. Follow up within 7 days',
    { x: 1, y: 1.8, w: 8, h: 2.5, fontSize: 20, color: 'FFFFFF', lineSpacingMultiple: 1.5 }
  );
  slide.addText('George Varkey M — Technical Director\ngeorge@sabi.ae | SABI MEP Contractors', {
    x: 1, y: 4.5, w: 8, h: 0.8, fontSize: 14, color: '90C8F8', align: 'center', italic: true,
  });

  const filePath = path.join(OUT_DIR, 'SABI_MEP_Presentation_Al_Reem_Tower.pptx');
  await pptx.writeFile({ fileName: filePath });
  console.log(`    -> ${filePath} (${(fs.statSync(filePath).size / 1024).toFixed(1)} KB)`);
  return filePath;
}

// ─── 5. ZIP everything ────────────────────────────────────────────────────
async function main() {
  console.log('\n=== Generating SABI Test Files ===\n');

  const files = [];
  files.push(generateCSV());
  files.push(await generateXLSX());
  files.push(await generateDOCX());
  files.push(await generatePPTX());

  // Add large specification document (text file simulating specs — ~500KB)
  const specPath = path.join(OUT_DIR, 'SABI_MEP_Specifications.csv');
  let specCSV = '"Section","Clause","Title","Description","Standard","Brand/Make","Remarks"\n';
  const sections = ['HVAC', 'Electrical', 'Plumbing', 'Fire Fighting', 'Fire Alarm', 'BMS', 'Drainage'];
  const standards = ['ASHRAE 90.1-2019', 'BS EN 12237', 'NFPA 13', 'IEC 60364', 'BS 6700', 'UL Listed', 'DM Approved', 'DEWA Standard'];
  const brands = ['Daikin', 'Carrier', 'Trane', 'Schneider Electric', 'ABB', 'Siemens', 'Grundfos', 'Victaulic', 'Tyco', 'Honeywell', 'Johnson Controls', 'Emerson'];
  for (let i = 1; i <= 2000; i++) {
    const section = sections[i % sections.length];
    const clause = `${(i % 7) + 1}.${String(i % 20 + 1).padStart(2, '0')}`;
    const titles = ['Supply and install', 'Testing and commissioning of', 'Provide complete', 'Furnish and erect', 'Design and install'];
    const items = ['ductwork system', 'piping network', 'cable tray assembly', 'sprinkler heads', 'control panel', 'isolation valve', 'expansion tank', 'check valve', 'pressure gauge', 'temperature sensor', 'flow switch', 'balancing valve', 'motor starter', 'circuit breaker', 'distribution board', 'conduit system', 'earth pit', 'lightning arrester', 'smoke detector', 'heat detector'];
    const title = `${titles[i % titles.length]} ${items[i % items.length]}`;
    const desc = `${title} as per approved drawings and specifications. Material shall be ${brands[i % brands.length]} or approved equivalent. Installation shall comply with ${standards[i % standards.length]} and local authority requirements. All works to be tested and commissioned as per project QA/QC plan. Contractor to provide 12-month warranty post handover. Shop drawings to be submitted for consultant approval prior to procurement. Coordination with other trades required.`;
    specCSV += `"${section}","${clause}","${title}","${desc}","${standards[i % standards.length]}","${brands[i % brands.length]}","As per approved drawings"\n`;
  }
  fs.writeFileSync(specPath, specCSV);
  files.push(specPath);

  // Add drawing index
  const paddingPath = path.join(OUT_DIR, 'SABI_Drawing_Index.txt');
  let paddingContent = '=== SABI DRAWING INDEX — Al Reem Tower ===\n\n';
  paddingContent += 'This file contains the complete drawing index for the MEP tender package.\n\n';
  for (let i = 1; i <= 500; i++) {
    const disc = ['HVAC', 'Electrical', 'Plumbing', 'Fire Fighting', 'Architectural'][i % 5];
    const type = ['Floor Plan', 'Section', 'Detail', 'Schedule', 'Riser Diagram', 'Single Line'][i % 6];
    const ext = i % 3 === 0 ? 'dwg' : 'pdf';
    paddingContent += `DWG-${String(i).padStart(3, '0')}  |  ${disc.padEnd(16)}  |  ${type.padEnd(18)}  |  ${disc.substring(0,2).toUpperCase()}-${String(i).padStart(3,'0')}-${type.replace(/ /g,'_')}.${ext}  |  Rev ${String.fromCharCode(65 + (i % 4))}  |  ${['Approved','For Construction','For Review','Preliminary'][i % 4]}\n`;
  }
  fs.writeFileSync(paddingPath, paddingContent);
  files.push(paddingPath);

  // Create ZIP
  console.log('\n  Creating ZIP...');
  const zip = new AdmZip();
  for (const f of files) {
    zip.addLocalFile(f);
  }
  const zipPath = path.join(process.cwd(), 'SABI_RFQ_Test_Package.zip');
  zip.writeZip(zipPath);
  const sizeMB = (fs.statSync(zipPath).size / (1024 * 1024)).toFixed(2);
  console.log(`\n=== Done! ===`);
  console.log(`  ZIP: ${zipPath} (${sizeMB} MB)`);
  console.log(`  Files in ZIP:`);
  for (const f of files) {
    const name = path.basename(f);
    const size = (fs.statSync(f).size / 1024).toFixed(1);
    console.log(`    - ${name} (${size} KB)`);
  }
  console.log('');
}

main().catch(err => { console.error('Error:', err); process.exit(1); });
