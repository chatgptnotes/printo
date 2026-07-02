#!/usr/bin/env node
/**
 * SABI · RFQ -> QUOTE PIPELINE workflow diagram (electrical-only, v6.0).
 *
 * Mirrors the layout of d:/work/data/sabi-workflow.pdf (v5.0) but with
 * Phase 3 take-off replaced by the 14-step ELECTRICAL sub-pipeline.
 *
 * Run:  node scripts/generate-workflow-pdf.mjs
 * Out:  C:/Users/mrkau/Downloads/sabi-electrical-workflow.pdf
 */

import fs from 'fs';
import PDFDocument from 'pdfkit';

const OUT = process.env.WORKFLOW_PDF_OUT || 'docs/sabi-workflow-electrical.pdf';

// ─── palette ──────────────────────────────────────────────────────────────
const C = {
  ink:     '#0F172A',
  text:    '#1F2937',
  mute:    '#6B7280',
  hair:    '#CBD5E1',
  white:   '#FFFFFF',
  phase1:  '#DBEAFE',  phase1Bd: '#3B82F6',
  phase2:  '#EDE9FE',  phase2Bd: '#8B5CF6',
  phase3:  '#CCFBF1',  phase3Bd: '#14B8A6',
  phase4:  '#FFE4D2',  phase4Bd: '#F97316',
  step:    '#FFFFFF',  stepBd:  '#94A3B8',
  newChip: '#86EFAC',  newBd:   '#16A34A',
  gateFill:'#FEF3C7',  gateBd:  '#D97706',
  reject:  '#FEE2E2',  rejectBd:'#DC2626',
  instant: '#DCFCE7',  instantBd:'#16A34A',
  sub:     '#F1F5F9',  subBd:   '#475569',
};

// ─── pdf ──────────────────────────────────────────────────────────────────
const doc = new PDFDocument({ size: 'A4', layout: 'portrait', margin: 24 });
doc.pipe(fs.createWriteStream(OUT));

const W = doc.page.width;   // 595
const H = doc.page.height;  // 842
const M = 24;
const gutterR = 60;          // right gutter holds the INSTANT BOQ lane and the AUTO-BOQ terminal
const instantLaneOffset = 16; // INSTANT BOQ lane offset from phase right edge

// ─── helpers ──────────────────────────────────────────────────────────────
function box(x, y, w, h, fill, stroke, r = 4) {
  doc.lineWidth(0.8).roundedRect(x, y, w, h, r);
  if (fill) doc.fillAndStroke(fill, stroke || fill);
  else doc.stroke(stroke || C.hair);
}
function tx(x, y, str, opts = {}) {
  doc
    .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
    .fontSize(opts.size || 8)
    .fillColor(opts.color || C.text)
    .text(str, x, y, {
      width: opts.w,
      height: opts.h,
      align: opts.align || 'left',
      lineBreak: opts.lineBreak === true,
    });
}
function arrowHead(x, y, ang, color, ah = 5) {
  doc.save()
    .moveTo(x, y)
    .lineTo(x - ah * Math.cos(ang - 0.4), y - ah * Math.sin(ang - 0.4))
    .lineTo(x - ah * Math.cos(ang + 0.4), y - ah * Math.sin(ang + 0.4))
    .closePath()
    .fillAndStroke(color, color)
    .restore();
}
function arrow(x1, y1, x2, y2, color = C.ink, width = 1, dash = null) {
  doc.save().lineWidth(width).strokeColor(color);
  if (dash) doc.dash(dash.length, { space: dash.space || 3 });
  doc.moveTo(x1, y1).lineTo(x2, y2).stroke();
  doc.restore();
  arrowHead(x2, y2, Math.atan2(y2 - y1, x2 - x1), color);
}
function pathDashed(pts, color, width = 1, dash = { length: 3, space: 3 }) {
  // Polyline with arrowhead at the final point. Arrowhead direction follows
  // the last segment.
  doc.save().lineWidth(width).strokeColor(color).dash(dash.length, { space: dash.space });
  doc.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) doc.lineTo(pts[i][0], pts[i][1]);
  doc.stroke();
  doc.restore();
  const [px1, py1] = pts[pts.length - 2];
  const [px2, py2] = pts[pts.length - 1];
  arrowHead(px2, py2, Math.atan2(py2 - py1, px2 - px1), color);
}
function gateDiamond(cx, cy, w, h, label, opts = {}) {
  doc.save().lineWidth(1.1)
    .moveTo(cx, cy - h / 2)
    .lineTo(cx + w / 2, cy)
    .lineTo(cx, cy + h / 2)
    .lineTo(cx - w / 2, cy)
    .closePath()
    .fillAndStroke(C.gateFill, C.gateBd)
    .restore();
  // Center label vertically by counting newlines.
  const lines = label.split('\n').length;
  const labelH = lines * 9;
  tx(cx - w / 2 + 6, cy - labelH / 2, label, {
    w: w - 12, size: opts.size || 7.5, bold: true, color: C.ink,
    align: 'center', lineBreak: true,
  });
}
function newChip(x, y) {
  box(x, y, 22, 9, C.newChip, C.newBd, 2);
  tx(x + 2, y + 1.5, 'NEW', { size: 5.5, bold: true, color: '#065F46' });
}

// ─── 1. title bar ─────────────────────────────────────────────────────────
const titleH = 38;
box(M, M, W - 2 * M, titleH, C.ink, C.ink, 6);
tx(M + 12, M + 5, 'SABI · RFQ -> QUOTE PIPELINE', { size: 13, bold: true, color: C.white });
tx(M + 12, M + 21, 'Electrical-only · 4 phase containers · 5 gates · 14-step electrical sub · INSTANT BOQ (Gates 1-4 auto, Gate 5 human) · v6.3',
  { size: 7.5, color: '#CBD5E1' });
tx(W - M - 90, M + 14, '15 steps · 5 gates', {
  size: 8, bold: true, color: C.white, w: 80, align: 'right',
});

// ─── 2. legend ────────────────────────────────────────────────────────────
let y = M + titleH + 6;
const legY = y;
const legItems = [
  { c: C.step,    bd: C.stepBd,    label: 'Step' },
  { c: C.newChip, bd: C.newBd,     label: 'NEW / changed' },
  { c: C.gateFill,bd: C.gateBd,    label: 'Gate' },
  { c: C.ink,     bd: C.ink,       label: 'Terminal' },
  { c: C.reject,  bd: C.rejectBd,  label: 'Rejection exit' },
  { c: C.instant, bd: C.instantBd, label: 'Instant BOQ (Gates 1-4 auto)' },
];
let lx = M + 4;
for (const item of legItems) {
  box(lx, legY + 2, 12, 8, item.c, item.bd, 2);
  tx(lx + 16, legY + 2.5, item.label, { size: 7, color: C.mute });
  lx += 16 + doc.widthOfString(item.label, { font: 'Helvetica', size: 7 }) + 14;
}
y = legY + 16;

// ─── 3. START ─────────────────────────────────────────────────────────────
const cx = W / 2;
const startW = 80;
box(cx - startW / 2, y, startW, 18, C.ink, C.ink, 9);
tx(cx - startW / 2, y + 4, 'START', { w: startW, size: 9, bold: true, color: C.white, align: 'center' });
y += 18;
arrow(cx, y, cx, y + 10);
y += 10;

// ─── 4. STEP 00 Auto-Filter ───────────────────────────────────────────────
const f00w = 220;
box(cx - f00w / 2, y, f00w, 26, C.step, C.stepBd, 4);
newChip(cx + f00w / 2 - 28, y + 3);
tx(cx - f00w / 2 + 8, y + 4, 'STEP 00 · Auto-Filter', { size: 8, bold: true });
tx(cx - f00w / 2 + 8, y + 14, 'spam · non-MEP · duplicate · wrong addressee', { size: 6.5, color: C.mute });
// off-pipeline ignore branch (left)
box(M + 6, y + 6, 86, 14, C.reject, C.rejectBd, 3);
tx(M + 6, y + 8.5, 'OFF-PIPELINE · IGNORED', { w: 86, size: 6.5, bold: true, color: C.rejectBd, align: 'center' });
arrow(M + 92, y + 13, cx - f00w / 2, y + 13, C.rejectBd, 0.8, { length: 2, space: 2 });
// instant-BOQ branch (right) — bypasses every gate, lands at AUTO-BOQ · SENT terminal
const instantChipW = 100;
const instantChipX = W - M - instantChipW - 4;
box(instantChipX, y + 6, instantChipW, 14, C.instant, C.instantBd, 3);
tx(instantChipX, y + 8.5, 'INSTANT BOQ · 4 AUTO', {
  w: instantChipW, size: 6.5, bold: true, color: C.instantBd, align: 'center',
});
arrow(cx + f00w / 2, y + 13, instantChipX, y + 13, C.instantBd, 0.8, { length: 2, space: 2 });
const instantBypassStart = { x: instantChipX + instantChipW / 2, y: y + 20 };
y += 26;
arrow(cx, y, cx, y + 10);
y += 10;

// ─── 5. PHASE 1 · Information Sufficiency ────────────────────────────────
const fullPhaseW = W - 2 * M;
const narrowPhaseW = fullPhaseW - gutterR;       // for Phase 2/3/4 (bypass lane)
const p1Steps = [
  '01  Read Email',
  '02  Register Enquiry',
  '03  Open Tender Folder',
  '04  Unload Attachments',
  '05  Extract Archive',
  '06  List Documents',
  '07  List Drawings',
  '08  Extract Building + Reputation',
];
const p1RowH = 14;
const p1H = 22 + p1Steps.length * p1RowH + 30;
box(M, y, fullPhaseW, p1H, C.phase1, C.phase1Bd, 8);
tx(M + 10, y + 3, 'PHASE 1 · INFORMATION SUFFICIENCY', { size: 9, bold: true, color: C.phase1Bd });
tx(M + 10, y + 12, 'what do we have · is it usable?', { size: 7, color: C.mute });
const p1StepStartY = y + 22;
let ry = p1StepStartY;
for (const s of p1Steps) {
  box(cx - 130, ry, 260, p1RowH - 2, C.step, C.stepBd, 3);
  tx(cx - 124, ry + 2.5, s, { size: 7.5 });
  ry += p1RowH;
}
// Step 04 → no-attach branch (aligned to row index 3 of the step list)
const s4Top = p1StepStartY + 3 * p1RowH;
box(M + 8, s4Top, 92, 12, C.reject, C.rejectBd, 3);
tx(M + 8, s4Top + 1.5, 'NO ATTACH -> PAUSE', { w: 92, size: 6.5, bold: true, color: C.rejectBd, align: 'center' });
arrow(M + 100, s4Top + 6, cx - 130, s4Top + 6, C.rejectBd, 0.8, { length: 2, space: 2 });
// Gate 1
const g1Cy = ry + 14;
gateDiamond(cx, g1Cy, 220, 22, '09 · GATE 1 — Documents Sufficient?');
box(M + 8, g1Cy - 6, 92, 12, C.reject, C.rejectBd, 3);
tx(M + 8, g1Cy - 4.5, 'NO -> PAUSE · REQUEST', { w: 92, size: 6.5, bold: true, color: C.rejectBd, align: 'center' });
arrow(M + 100, g1Cy, cx - 110, g1Cy, C.rejectBd, 0.8, { length: 2, space: 2 });
y += p1H;
arrow(cx, y, cx, y + 10);
y += 10;

// ─── 6. PHASE 2 · Bid / No-Bid (2-way) ───────────────────────────────────
const p2H = 76;
const phaseRightX = M + narrowPhaseW;            // right edge of narrow phases
box(M, y, narrowPhaseW, p2H, C.phase2, C.phase2Bd, 8);
tx(M + 10, y + 4, 'PHASE 2 · BID / NO-BID', { size: 9, bold: true, color: C.phase2Bd });
tx(M + 10, y + 14, 'go / no-go · proceed to detailed take-off', { size: 7, color: C.mute });
gateDiamond(cx, y + 42, 240, 36, '10 · GATE 2 — Bid Decision (2-way)\nNo-Bid · Detailed');
// No-Bid branch (left)
box(M + 8, y + 38, 92, 18, C.ink, C.ink, 3);
tx(M + 8, y + 41, 'NO-BID · END', { w: 92, size: 7, bold: true, color: C.white, align: 'center' });
tx(M + 8, y + 49.5, 'log · status=declined', { w: 92, size: 5.8, color: '#E5E7EB', align: 'center' });
arrow(cx - 120, y + 47, M + 100, y + 47, C.ink, 0.8);
y += p2H;
arrow(cx, y, cx, y + 10);
y += 10;

// ─── 7. PHASE 3 · Quantities (electrical sub-pipeline) ───────────────────
const p3H = 184;
box(M, y, narrowPhaseW, p3H, C.phase3, C.phase3Bd, 8);
tx(M + 10, y + 4, 'PHASE 3 · QUANTITIES', { size: 9, bold: true, color: C.phase3Bd });
tx(M + 10, y + 14, 'detailed proposal · 14-step electrical sub-pipeline at MAIN step 11',
  { size: 7, color: C.mute });

// Step 11 wrapper card
const wrapX = M + 14;
const wrapW = narrowPhaseW - 28;
const wrapY = y + 26;
const wrapH = 118;
box(wrapX, wrapY, wrapW, wrapH, C.sub, C.subBd, 6);
tx(wrapX + 8, wrapY + 4, 'STEP 11 · Run Pricing  ->  ELECTRICAL SUB-PIPELINE',
  { size: 8.5, bold: true, color: C.ink });
tx(wrapX + 8, wrapY + 14, 'POST /api/projects/[id]/estimate · Claude Sonnet 4.6 · activity_log.sub_pipeline = "electrical"',
  { size: 6.5, color: C.mute });

// 14 sub-steps in two columns of 7
const subSteps = [
  '1   Open the Drawing',
  '2   List Available Drawings',
  '3   Establish Floors & Heights',
  '4   Find Drawing Scale',
  '5   Identify LV Room / MDB',
  '6   Check Schematic / SLD',
  '7   Note SMDBs from LV Panel',
  '8   Identify SMDBs in Floor Plans',
  '9   Establish Cable Routes',
  '10  Estimate Cable Lengths LV->SMDB',
  '11  SMDB -> DB Identification',
  '12  Identify DB Locations per SMDB',
  '13  Estimate Cable Length per DB',
  '14  Prepare Cable Schedule  [GATE]',
];
const innerPad = 8;
const colGap = 8;
const colW = (wrapW - innerPad * 2 - colGap) / 2;
const subRowH = 11;
const gridY = wrapY + 26;
for (let i = 0; i < subSteps.length; i++) {
  const col = i < 7 ? 0 : 1;
  const row = i % 7;
  const sx = wrapX + innerPad + col * (colW + colGap);
  const sy = gridY + row * subRowH;
  const isGate = subSteps[i].includes('[GATE]');
  box(sx, sy, colW, subRowH - 2, isGate ? C.gateFill : C.step, isGate ? C.gateBd : C.stepBd, 2);
  tx(sx + 4, sy + 1.5, subSteps[i], { size: 6.8, bold: isGate });
}

// Gate 3 (= electrical sub gate 14, MAIN gate 12)
const g3Cy = y + p3H - 14;
gateDiamond(cx, g3Cy, 280, 22, '12 · GATE 3 — Confirm Quantities? (Cable Schedule)');
// Gate 3 revert
box(M + 8, g3Cy - 6, 92, 12, C.reject, C.rejectBd, 3);
tx(M + 8, g3Cy - 4.5, 'NO -> REVISE · loop', { w: 92, size: 6.5, bold: true, color: C.rejectBd, align: 'center' });
arrow(M + 100, g3Cy, cx - 140, g3Cy, C.rejectBd, 0.8, { length: 2, space: 2 });
y += p3H;
arrow(cx, y, cx, y + 10);
y += 10;

// ─── 8. PHASE 4 · Final Quote ────────────────────────────────────────────
const p4H = 122;
const phase4Top = y;
box(M, y, narrowPhaseW, p4H, C.phase4, C.phase4Bd, 8);
tx(M + 10, y + 3, 'PHASE 4 · FINAL QUOTE', { size: 9, bold: true, color: C.phase4Bd });
tx(M + 10, y + 12, 'yardstick -> margin -> consent -> send', { size: 7, color: C.mute });

// Step 13 yardstick
box(cx - 130, y + 24, 260, 13, C.step, C.stepBd, 3);
tx(cx - 124, y + 27, '13  Yardstick Check (below / above market)', { size: 7.5 });
arrow(cx, y + 37, cx, y + 44);

// Gate 4 (Confirm Total)
const g4Cy = y + 56;
gateDiamond(cx, g4Cy, 200, 22, '14 · GATE 4 — Confirm Total?');
box(M + 8, g4Cy - 6, 92, 12, C.reject, C.rejectBd, 3);
tx(M + 8, g4Cy - 4.5, 'NO -> revise pricing', { w: 92, size: 6.5, bold: true, color: C.rejectBd, align: 'center' });
arrow(M + 100, g4Cy, cx - 100, g4Cy, C.rejectBd, 0.8, { length: 2, space: 2 });
arrow(cx, g4Cy + 11, cx, g4Cy + 18);

// Gate 5 (Consent → Send)
const g5Cy = y + 86;
gateDiamond(cx, g5Cy, 200, 22, '15 · GATE 5 — Consent -> Send');
box(M + 8, g5Cy - 6, 92, 12, C.reject, C.rejectBd, 3);
tx(M + 8, g5Cy - 4.5, 'NO -> HOLD · do not send', { w: 92, size: 6.5, bold: true, color: C.rejectBd, align: 'center' });
arrow(M + 100, g5Cy, cx - 100, g5Cy, C.rejectBd, 0.8, { length: 2, space: 2 });
arrow(cx, g5Cy + 11, cx, g5Cy + 18);

// END · SENT (standard path) — INSTANT BOQ lane lands at Gate 5 (human send),
// not its own terminal, so both paths share the same final SENT exit.
const endY = g5Cy + 18;
const endW = 100;
box(cx - endW / 2, endY, endW, 14, C.ink, C.ink, 8);
tx(cx - endW / 2, endY + 3, 'END · SENT', { w: endW, size: 9, bold: true, color: C.white, align: 'center' });

// ─── 9. Bypass lane — INSTANT BOQ (Step 00 → Gate 5 right side) ──────────
// Auto-approves Gates 1, 2, 3, 4. Only Gate 5 (Consent → Send) remains human.
const instantLaneX = phaseRightX + instantLaneOffset;

// INSTANT BOQ: STEP 00 chip → inner gutter → into Gate 5 right side
const iStartX = instantBypassStart.x;
const iStartY = instantBypassStart.y;
const g5RightX = cx + 100;
pathDashed(
  [
    [iStartX, iStartY],
    [instantLaneX, iStartY],
    [instantLaneX, g5Cy],
    [g5RightX, g5Cy],
  ],
  C.instantBd,
  1.2,
  { length: 3, space: 3 }
);
doc.save();
doc.rotate(-90, { origin: [instantLaneX, (iStartY + g5Cy) / 2] });
tx(instantLaneX - 42, (iStartY + g5Cy) / 2 - 4, 'INSTANT BOQ · GATES 1-4 AUTO', {
  size: 6.5, bold: true, color: C.instantBd, w: 84, align: 'center',
});
doc.restore();

y += p4H;

// ─── 10. footer reference table ───────────────────────────────────────────
y += 6;
const footH = 56;
box(M, y, fullPhaseW, footH, '#F8FAFC', C.hair, 4);
tx(M + 10, y + 3, 'REJECTION EXITS · QUICK REFERENCE', {
  size: 7.5, bold: true, color: C.ink,
});
const footCols = [
  {
    title: 'TERMINAL',
    rows: ['Auto-Filter (spam / non-MEP)', 'Gate 2 No-Bid (logged · declined)'],
  },
  {
    title: 'PAUSE (resumable)',
    rows: ['Step 04 — no attachments', 'Gate 1 — insufficient docs', 'Gate 5 — consent held'],
  },
  {
    title: 'REVERT (loop back)',
    rows: ['Gate 3 — revise quantities', 'Gate 4 — revise pricing'],
  },
  {
    title: 'INSTANT BOQ',
    rows: ['Right after Auto-Filter', 'Auto-approves Gates 1-4', 'Stops at Gate 5 (human Send)'],
  },
];
const fcw = (fullPhaseW - 20) / 4;
for (let i = 0; i < footCols.length; i++) {
  const fx = M + 10 + i * fcw;
  tx(fx, y + 14, footCols[i].title, {
    size: 6.8, bold: true, color: C.rejectBd, w: fcw - 4,
  });
  for (let j = 0; j < footCols[i].rows.length; j++) {
    tx(fx, y + 23 + j * 8, '· ' + footCols[i].rows[j], {
      size: 6, color: C.mute, w: fcw - 4,
    });
  }
}

doc.end();
console.log(`Wrote ${OUT}`);
