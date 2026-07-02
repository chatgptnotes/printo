const PDFDocument = require('pdfkit');
const fs = require('fs');

const doc = new PDFDocument({ margin: 50, size: 'A4' });
const output = fs.createWriteStream('/Users/apple/Desktop/anirudh 7 april.pdf');
doc.pipe(output);

const navy = '#1e293b';
const blue = '#2563eb';
const green = '#059669';
const gray = '#6b7280';
const amber = '#d97706';

// ===== PAGE 1: HEADER =====
doc.rect(0, 0, 595, 110).fill(navy);
doc.fontSize(26).fillColor('white').text('ERP Realsoft — Daily Report', 50, 25);
doc.fontSize(13).fillColor('#94a3b8').text('Anirudh | April 7, 2026', 50, 58);
doc.fontSize(10).fillColor('#64748b').text('SABI RFQ-to-BOQ Pipeline | realsoft.example', 50, 78);

doc.moveDown(4);
doc.fillColor(navy);

// ===== SUMMARY =====
doc.fontSize(16).fillColor(blue).text('What Was Done Today');
doc.moveDown(0.4);
doc.fontSize(10).fillColor(navy).text(
  'Replaced the old 23-step pipeline with a new 21-step pipeline that exactly matches the Whimsical flowchart from BT. Implemented 4 human decision gates with specific approval questions, mandatory reject reasons, and branching gate flow logic. Also increased email poll limit from 50 to 100.',
  { width: 495 }
);

doc.moveDown(1);

// ===== COMMITS =====
doc.fontSize(14).fillColor(blue).text('Commits Deployed');
doc.moveDown(0.3);

doc.fontSize(10).fillColor(green).text('1. a015b9c — feat: replace 23-step pipeline with 21-step Whimsical flowchart');
doc.fontSize(9).fillColor(gray).text('   24 files changed, +1026 -231 lines', 65);
doc.moveDown(0.3);
doc.fontSize(10).fillColor(green).text('2. 1ee07ee — fix: increase max email poll from 50 to 100');
doc.fontSize(9).fillColor(gray).text('   1 file changed', 65);

doc.moveDown(1);

// ===== NEW 21-STEP PIPELINE =====
doc.fontSize(14).fillColor(blue).text('New 21-Step Pipeline');
doc.moveDown(0.3);

const phases = [
  { name: 'Phase 1: Email Processing (Steps 1-4)', steps: [
    '1. Read Email', '2. Addressed to Estimation? [diamond]', '3. New Project? [diamond]', '4. Register New Enquiry'
  ]},
  { name: 'Phase 2: Attachment Processing (Steps 5-11)', steps: [
    '5. Open Folder for New Tender', '6. Attachment Available? [diamond]', '7. Unload Attachment to Folder',
    '8. Open Attachment and Extract', '9. List Available Documents', '10. Find Folder Containing Drawings', '11. List Drawings'
  ]},
  { name: 'Phase 3: Building Analysis (Steps 12-13)', steps: [
    '12. Extract Building Details (area, floors, type, height)', '13. Inform Building Details & Reputation Class'
  ]},
  { name: 'Phase 4: Pricing Decision (Steps 14-16)', steps: [
    '14. Prepare Quote? [GATE]', '15. Fast Price Required? [GATE]', '16. Detailed Pricing Required? [GATE]'
  ]},
  { name: 'Phase 5: Detailed Estimation (Steps 17-19)', steps: [
    '17. Follow Detailed Pricing Procedure', '18. Prepare Ratios with Price for Comparison', '19. Present Findings for Consent'
  ]},
  { name: 'Phase 6: Consent & Dispatch (Steps 20-21)', steps: [
    '20. Consent Received? [GATE]', '21. Prepare and Send Quotation'
  ]},
];

phases.forEach(phase => {
  doc.fontSize(10).fillColor(blue).text(phase.name, 55);
  phase.steps.forEach(s => {
    const isGate = s.includes('[GATE]');
    const isDiamond = s.includes('[diamond]');
    const icon = isGate ? '◆' : isDiamond ? '◇' : '○';
    const color = isGate ? amber : navy;
    doc.fontSize(9).fillColor(color).text(`  ${icon} ${s}`, 65);
  });
  doc.moveDown(0.2);
});

doc.moveDown(0.5);

// ===== GATE FLOW =====
doc.fontSize(14).fillColor(blue).text('Gate Decision Flow');
doc.moveDown(0.3);
doc.fontSize(9).fillColor(navy);
doc.text('Gate 14: "Shall we prepare a quotation for this project?"', 55);
doc.text('   → Yes: Move to Gate 15   |   No: Decline project', 65);
doc.moveDown(0.2);
doc.text('Gate 15: "Do you want a quick area-based estimate (Fast Price)?"', 55);
doc.text('   → Yes: Run fast pricing, then Gate 20   |   No: Move to Gate 16', 65);
doc.moveDown(0.2);
doc.text('Gate 16: "Do you want detailed drawing-based estimation?"', 55);
doc.text('   → Yes: Run detailed estimation, then Gate 20   |   No: End', 65);
doc.moveDown(0.2);
doc.text('Gate 20: "Do you approve to prepare and send the quotation?"', 55);
doc.text('   → Yes: Generate Excel BOQ & email to client   |   No: Decline', 65);

// ===== PAGE 2 =====
doc.addPage();

// ===== HVAC 37-STEP PROCEDURE =====
doc.rect(0, 0, 595, 50).fill(navy);
doc.fontSize(16).fillColor('white').text('HVAC 37-Step Procedure (Already Implemented)', 50, 15);

doc.moveDown(2.5);
doc.fillColor(navy);

const hvacPhases = [
  { name: 'Phase A: Folder Navigation (Steps 1-5)', steps: [
    '1. Open Folder HVAC', '2. Open Folder Ventilation', '3. Open Folder AC',
    '4. Report "no schedule for AC exists" if not found', '5. List drawings folder-wise'
  ]},
  { name: 'Phase B: Drawing Identification (Steps 6-10)', steps: [
    '6. Check for "Thermal Load Summary"', '7. Check for "Equipment Schedule"',
    '8. Check for "AC Equipment Schedule"', '9. Confirm thermal load summary format',
    '10. Confirm equipment schedule format'
  ]},
  { name: 'Phase C: System Analysis (Steps 11-18)', steps: [
    '11. Find principal system of AC', '12. Read thermal load table (zone, unit type, kW)',
    '13. Count Decorative indoor units', '14. Count Ducted indoor units',
    '15. Declare predominantly decorative or ducted', '16. Establish AC system type',
    '17. Identify items NOT indoor units', '18. Identify Chiller / VRF / Package / FAHU / Pumps'
  ]},
  { name: 'Phase D: System Type Declaration (Steps 19-29)', steps: [
    '19-21. VRF: Inverter Tech Compressor, indoor KW >> outdoor KW',
    '22-24. DX Split: indoor KW ≈ outdoor KW',
    '25-27. Chiller: outdoor KW absent for indoor, exists for Chiller',
    '28-29. District Cooling: no chiller but Heat Exchanger exists'
  ]},
  { name: 'Phase E: Pricing Formulas (Steps 30-37)', steps: [
    '30. Read Calculated AC Load total at bottom (kW)',
    '31. VRF → Formula 1', '32. DX → Formula 2',
    '33. Chiller → Formula 3', '34. District Cooling → Formula 4',
    '35. FAHU Flow (CFM)', '36. FAHU Price → Formula 5',
    '37. Total AC Price → Formula 6'
  ]},
];

hvacPhases.forEach(p => {
  doc.fontSize(10).fillColor(blue).text(p.name, 50);
  p.steps.forEach(s => {
    doc.fontSize(9).fillColor(green).text(`  ✓ ${s}`, 60);
  });
  doc.moveDown(0.3);
});

doc.moveDown(0.3);
doc.fontSize(9).fillColor(gray).text('Implemented in: lib/ai/claude-api.ts → analyzeHVACProcedure() | Runs via Claude Sonnet 4.6', 50);

doc.moveDown(1);

// ===== FILES MODIFIED =====
doc.fontSize(14).fillColor(blue).text('Files Modified Today (24 files)');
doc.moveDown(0.3);

const files = [
  'lib/constants.ts — 21 steps, 6 phases, gate questions, status mapping',
  'lib/types.ts — New phases and status types',
  'lib/utils.ts — Updated statusToStep, statusColor, statusLabel',
  'app/api/projects/[id]/gate/route.ts — Gate 14→15→16→20 branching logic',
  'app/api/cron/poll-inbox/route.ts — Steps 1-4, max 100 emails',
  'app/api/projects/[id]/extract/route.ts — Steps 5-14, folder listing',
  'app/api/projects/[id]/estimate/route.ts — Steps 17-20, consent gate',
  'app/api/projects/[id]/services/route.ts — Step 10',
  'app/api/projects/[id]/yardstick/route.ts — Step 18',
  'app/api/projects/[id]/boq/route.ts — Step 21',
  'app/api/projects/[id]/send-quote/route.ts — Step 21',
  'app/api/projects/[id]/classify/route.ts — Step 4',
  'app/api/projects/[id]/approve/route.ts — Step 20',
  'app/api/projects/[id]/reject/route.ts — Step 20, revert map',
  'app/api/projects/process-all/route.ts — All steps updated',
  'app/bids/[id]/page.tsx — Gate card with questions, reject reason',
  'app/bids/page.tsx — 21-step progress bar',
  'app/components/PipelineProgress.tsx — 6 phases display',
  'app/landing/page.tsx — Updated text',
  'app/drawing-ai/page.tsx — Updated text',
  'PROJECT_PLAN.md — April 6 meeting notes + priorities',
];

files.forEach(f => {
  doc.fontSize(8).fillColor(navy).text(`• ${f}`, 55, undefined, { width: 490 });
});

doc.moveDown(1);

// ===== REMAINING =====
doc.fontSize(14).fillColor(blue).text('What\'s Next');
doc.moveDown(0.3);

const remaining = [
  ['P0 — Quick Wins', [
    'Document listing by folder (tree view, not flat)',
    'HVAC formula derivation display (KW → TR → AED math)',
    'Show extracted vs missing info at gate 14',
  ]],
  ['P1 — HVAC Deep', [
    'District Cooling as 5th system type in constants',
    'Indoor unit classification UI',
    'FAHU separate pricing display',
  ]],
  ['P2 — Drawing Intelligence', [
    'AI vision reads AC layouts, counts equipment from drawings',
    'Match client\'s BOQ Excel template format',
    'Use real 0.1 Tender Package for demo',
  ]],
];

remaining.forEach(([title, items]) => {
  doc.fontSize(10).fillColor(amber).text(title, 55);
  items.forEach(item => {
    doc.fontSize(9).fillColor(navy).text(`  ○ ${item}`, 65);
  });
  doc.moveDown(0.3);
});

// ===== FOOTER =====
doc.moveDown(1);
doc.fontSize(8).fillColor(gray).text('Anirudh | ERP Realsoft (realsoft.example) | SABI MEP Estimation Pipeline | April 7, 2026', 50);

doc.end();
output.on('finish', () => console.log('PDF saved to Desktop: anirudh 7 april.pdf'));
