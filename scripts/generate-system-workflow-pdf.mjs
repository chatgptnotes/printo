#!/usr/bin/env node
/**
 * Whole-project workflow + tech architecture PDF for realsoft.example
 * (SABI RFQ -> BOQ pipeline). Self-contained — uses only pdfkit which
 * is already a runtime dependency.
 *
 * Run:  node scripts/generate-system-workflow-pdf.mjs
 * Out:  docs/realsoft-system-workflow.pdf
 */

import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';

const OUT = process.env.OUT_PDF || 'docs/realsoft-system-workflow.pdf';

// ─── palette ──────────────────────────────────────────────────────────────
const C = {
  ink:        '#0B1220',
  text:       '#1F2937',
  mute:       '#6B7280',
  hair:       '#E5E7EB',
  bgSoft:     '#F8FAFC',
  white:      '#FFFFFF',
  brand:      '#0EA5E9',
  brandDark:  '#0369A1',
  accent:     '#F59E0B',
  ok:         '#10B981',
  danger:     '#EF4444',
  phase1:     '#E0F2FE', phase1Bd: '#0284C7',
  phase2:     '#EDE9FE', phase2Bd: '#7C3AED',
  phase3:     '#D1FAE5', phase3Bd: '#059669',
  phase4:     '#FFE4D2', phase4Bd: '#EA580C',
  gateFill:   '#FEF3C7', gateBd:   '#D97706',
  subFill:    '#FCE7F3', subBd:    '#DB2777',
  techBox:    '#F1F5F9', techBd:   '#64748B',
};

const PAGE_W = 595.28;   // A4
const PAGE_H = 841.89;
const MARGIN = 40;

const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });
const out = fs.createWriteStream(path.resolve(process.cwd(), OUT));
doc.pipe(out);

// ─── helpers ──────────────────────────────────────────────────────────────
function h1(text) {
  doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(22).text(text);
  doc.moveDown(0.1);
  const y = doc.y;
  doc.save().moveTo(MARGIN, y).lineTo(MARGIN + 60, y).lineWidth(3).strokeColor(C.brand).stroke().restore();
  doc.moveDown(0.6);
}

function h2(text) {
  doc.moveDown(0.5);
  doc.fillColor(C.brandDark).font('Helvetica-Bold').fontSize(13).text(text);
  doc.moveDown(0.25);
}

function p(text, opts = {}) {
  doc.fillColor(C.text).font('Helvetica').fontSize(10).text(text, { lineGap: 2, ...opts });
}

function bullets(items) {
  doc.fillColor(C.text).font('Helvetica').fontSize(10);
  items.forEach((it) => {
    doc.text(`•  ${it}`, { indent: 6, lineGap: 2 });
  });
}

function chip(x, y, w, h, fill, border, label, labelColor = C.ink) {
  doc.save();
  doc.roundedRect(x, y, w, h, 6).fillAndStroke(fill, border);
  doc.fillColor(labelColor).font('Helvetica-Bold').fontSize(9)
     .text(label, x + 6, y + (h / 2 - 5), { width: w - 12, align: 'center' });
  doc.restore();
}

function box(x, y, w, h, fill, border) {
  doc.save();
  doc.roundedRect(x, y, w, h, 6).fillAndStroke(fill, border);
  doc.restore();
}

function arrow(x1, y1, x2, y2, color = C.mute) {
  doc.save().strokeColor(color).lineWidth(1.2)
     .moveTo(x1, y1).lineTo(x2, y2).stroke();
  // arrowhead
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const ah = 5;
  doc.fillColor(color)
     .moveTo(x2, y2)
     .lineTo(x2 - ah * Math.cos(angle - Math.PI / 6), y2 - ah * Math.sin(angle - Math.PI / 6))
     .lineTo(x2 - ah * Math.cos(angle + Math.PI / 6), y2 - ah * Math.sin(angle + Math.PI / 6))
     .closePath()
     .fill();
  doc.restore();
}

function pageHeader(title) {
  doc.save();
  const halfW = (PAGE_W - MARGIN * 2) / 2;
  doc.fillColor(C.mute).font('Helvetica').fontSize(8)
     .text(`realsoft.example  ·  SABI RFQ to BOQ Pipeline`, MARGIN, MARGIN - 20, { width: halfW, align: 'left' });
  doc.fillColor(C.mute).font('Helvetica').fontSize(8)
     .text(title, MARGIN + halfW, MARGIN - 20, { width: halfW, align: 'right' });
  doc.restore();
  // Reset cursor so subsequent text isn't constrained to the right column.
  doc.x = MARGIN;
  doc.y = MARGIN;
}

// ─── PAGE 1 — Cover ───────────────────────────────────────────────────────
function pageCover() {
  // background panel
  doc.save();
  doc.rect(0, 0, PAGE_W, PAGE_H).fill(C.ink);
  // accent bar
  doc.rect(0, 0, 8, PAGE_H).fill(C.brand);
  // top eyebrow
  doc.fillColor(C.brand).font('Helvetica-Bold').fontSize(10)
     .text('SABI ENGINEERING & CONTRACTING LLC  ·  DUBAI, UAE',
           MARGIN, 90, { width: PAGE_W - MARGIN * 2 });
  // title
  doc.fillColor(C.white).font('Helvetica-Bold').fontSize(38)
     .text('realsoft.example', MARGIN, 130, { width: PAGE_W - MARGIN * 2 });
  doc.fillColor(C.white).font('Helvetica').fontSize(20)
     .text('System Workflow & Architecture', MARGIN, 180, { width: PAGE_W - MARGIN * 2 });
  doc.fillColor('#CBD5E1').font('Helvetica').fontSize(13)
     .text('Automated MEP estimation pipeline from RFQ email to client-ready BOQ',
           MARGIN, 215, { width: PAGE_W - MARGIN * 2 });

  // hero strip — phases
  const stripY = 290;
  const stripH = 70;
  const stripW = PAGE_W - MARGIN * 2;
  doc.roundedRect(MARGIN, stripY, stripW, stripH, 10).fill('#0F1B2E');
  const phases = [
    { l: 'Phase 1', s: 'Information Sufficiency', col: C.phase1Bd },
    { l: 'Phase 2', s: 'Bid Decision',            col: C.phase2Bd },
    { l: 'Phase 3', s: 'Quantities',              col: C.phase3Bd },
    { l: 'Phase 4', s: 'Final Quote',             col: C.phase4Bd },
  ];
  const pw = stripW / phases.length;
  phases.forEach((p, i) => {
    const x = MARGIN + i * pw;
    doc.fillColor(p.col).font('Helvetica-Bold').fontSize(11)
       .text(p.l, x + 12, stripY + 14, { width: pw - 24 });
    doc.fillColor(C.white).font('Helvetica').fontSize(10)
       .text(p.s, x + 12, stripY + 32, { width: pw - 24 });
  });

  // headline numbers
  const nums = [
    { v: '15', l: 'MAIN steps' },
    { v: '5',  l: 'Confirmation gates' },
    { v: '14', l: 'Electrical sub-steps' },
    { v: '12', l: 'BOQ sections' },
  ];
  const nx0 = MARGIN, ny0 = 400, nw = (stripW - 30) / 4, nh = 90;
  nums.forEach((n, i) => {
    const x = nx0 + i * (nw + 10);
    doc.roundedRect(x, ny0, nw, nh, 10).fill('#13243E');
    doc.fillColor(C.brand).font('Helvetica-Bold').fontSize(34)
       .text(n.v, x, ny0 + 16, { width: nw, align: 'center' });
    doc.fillColor('#94A3B8').font('Helvetica').fontSize(10)
       .text(n.l, x, ny0 + 60, { width: nw, align: 'center' });
  });

  // tech blurb
  doc.fillColor(C.white).font('Helvetica-Bold').fontSize(13)
     .text('Built on', MARGIN, 540);
  doc.fillColor('#CBD5E1').font('Helvetica').fontSize(11)
     .text('Next.js 14 · React 18 · TypeScript · Tailwind · Supabase (Postgres + S3) · Vercel · '
         + 'Anthropic Claude Sonnet 4.6 (via Nexaproc gateway) · pdfkit · ExcelJS · '
         + 'dxf-parser · pdf-parse · tesseract.js · OpenClaw CLI (WhatsApp) · Gmail API',
           MARGIN, 562, { width: PAGE_W - MARGIN * 2, lineGap: 3 });

  // footer
  doc.fillColor('#64748B').font('Helvetica').fontSize(9)
     .text(`Generated ${new Date().toISOString().slice(0, 10)}  ·  Domain: realsoft.example  ·  Discipline: Electrical (Power)`,
           MARGIN, PAGE_H - 60, { width: PAGE_W - MARGIN * 2, align: 'center' });
  doc.restore();
}

// ─── PAGE 2 — Executive overview ──────────────────────────────────────────
function pageOverview() {
  doc.addPage();
  pageHeader('Overview');
  h1('What this system does');
  p('realsoft.example is an automated estimation pipeline for SABI, an MEP contractor in Dubai. ' +
    'A new RFQ email lands in estimation@sabi.ae; the system reads it, downloads the attached drawings ' +
    'and specs, classifies the discipline (electrical), runs an AI cable-take-off against the drawings, ' +
    'compares the result against market yardstick rates, generates a 12-section Power BOQ PDF, and — ' +
    'after the technical director\'s consent — emails the quotation back to the client.');
  doc.moveDown(0.4);

  h2('Pipeline shape');
  p('The workflow has TWO levels:');
  bullets([
    'MAIN pipeline — 15 steps, 5 confirmation gates, runs from email arrival to quotation sent.',
    'ELECTRICAL sub-pipeline — 14 steps, runs INSIDE main step 11 (Run Pricing) on the Detailed path. ' +
    'It is the cable-take-off procedure: floor plans -> SLD -> cable schedule.',
  ]);

  h2('Two operating lanes');
  bullets([
    'Standard lane — every gate is a human checkpoint (George Varkey M, Technical Director, approves).',
    'INSTANT BOQ lane — the "Run to BOQ" button auto-approves Gates 1–4 and stops only at Gate 5 ' +
    '(Send to Client). Gate 5 is never collapsed; a human always sends the quotation.',
  ]);

  h2('Egress + cost guardrails');
  bullets([
    'Selective SELECTs (no SELECT *) on hot list pages to keep Supabase egress flat.',
    'AI calls go through the Nexaproc gateway with content-hash result caching (re-uploads of the same PDF ' +
    'do not re-bill Claude).',
    'Long take-offs (>300 s) are off-loaded to a VPS worker so Vercel\'s function cap never aborts a run.',
    'Per-error-kind throttled WhatsApp alerts (claude_401 / 429 / 529 / 5xx · gateway_timeout · cost_drift).',
  ]);

  h2('People & environments');
  bullets([
    'Approval authority: George Varkey M — Technical Director (george@sabi.ae).',
    'Source inbox: ESTIMATION_EMAIL (default estimation@sabi.ae) — only mail addressed here is treated as RFQ.',
    'Production: Vercel + Supabase (Postgres + S3-compatible Storage) + a Linode/VPS Express worker.',
  ]);
}

// ─── PAGE 3 — End-to-end architecture diagram ─────────────────────────────
function pageArchitecture() {
  doc.addPage();
  pageHeader('Architecture');
  h1('End-to-end architecture');
  p('Single-page mental model — every shape on this diagram maps to a folder in src/ or to ' +
    'an external system. Solid arrows are data; dashed arrows are control / events.');
  doc.moveDown(0.4);

  // diagram bounds
  const D = { x: MARGIN, y: doc.y + 10, w: PAGE_W - MARGIN * 2, h: 460 };
  // panel
  doc.save().roundedRect(D.x, D.y, D.w, D.h, 10).fill(C.bgSoft).restore();

  // — Top row: external systems —
  const extY = D.y + 18;
  const extH = 46;
  const extW = (D.w - 40) / 3;
  const ext = [
    { l: 'Gmail',          s: 'OAuth · estimation@sabi.ae',     col: '#FECACA', bd: '#DC2626' },
    { l: 'Anthropic',      s: 'Claude Sonnet 4.6',              col: '#FED7AA', bd: '#EA580C' },
    { l: 'WhatsApp',       s: 'OpenClaw CLI',                   col: '#BBF7D0', bd: '#059669' },
  ];
  ext.forEach((e, i) => {
    const x = D.x + 10 + i * (extW + 10);
    doc.save().roundedRect(x, extY, extW, extH, 6).fillAndStroke(e.col, e.bd).restore();
    doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(10).text(e.l, x, extY + 8, { width: extW, align: 'center' });
    doc.fillColor(C.text).font('Helvetica').fontSize(8).text(e.s, x, extY + 24, { width: extW, align: 'center' });
  });

  // — Row 2: Vercel edge / Next.js (full width) —
  const v = { x: D.x + 30, y: extY + extH + 28, w: D.w - 60, h: 54 };
  doc.save().roundedRect(v.x, v.y, v.w, v.h, 8).fillAndStroke('#DBEAFE', '#3B82F6').restore();
  doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(11).text('Next.js 14 (App Router) on Vercel', v.x, v.y + 6, { width: v.w, align: 'center' });
  doc.fillColor(C.text).font('Helvetica').fontSize(8).text(
    'src/app/api/* route handlers   ·   middleware.ts (auth)   ·   src/app/* pages (React 18 + Tailwind)',
    v.x, v.y + 22, { width: v.w, align: 'center' });
  doc.fillColor(C.text).font('Helvetica').fontSize(8).text(
    'cron: /api/cron/poll-inbox (15 min)   ·   /api/projects/[id]/{extract,estimate,gate,bid-decision,send-quote}',
    v.x, v.y + 36, { width: v.w, align: 'center' });

  // — Row 3: lib pillars —
  const libY = v.y + v.h + 28;
  const libH = 78;
  const libW = (D.w - 50) / 4;
  const libs = [
    { l: 'src/lib/ai',         s: 'ai-provider · claude-api · nexaproc-client · result-cache · budget-guard', col: '#FEF3C7', bd: '#D97706' },
    { l: 'src/lib/pipeline',   s: 'estimation-engine · yardstick-orchestrator · boq-orchestrator · rate-adjuster',     col: '#E0E7FF', bd: '#4F46E5' },
    { l: 'src/lib/electrical', s: 'pre-pass · sld-spatial-parser · derive-cable-paths · cable-schedule-diff · formulas (DEWA/IEC)', col: '#FCE7F3', bd: '#DB2777' },
    { l: 'src/lib/pdf · /excel',s: 'boq-pdf-generator (pdfkit) · dubai-industry-boq-xlsx (ExcelJS) · ocr-pdf · ocr-image', col: '#D1FAE5', bd: '#059669' },
  ];
  libs.forEach((l, i) => {
    const x = D.x + 10 + i * (libW + 10);
    doc.save().roundedRect(x, libY, libW, libH, 6).fillAndStroke(l.col, l.bd).restore();
    doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(9).text(l.l, x + 6, libY + 6, { width: libW - 12 });
    doc.fillColor(C.text).font('Helvetica').fontSize(8).text(l.s, x + 6, libY + 22, { width: libW - 12, lineGap: 1 });
  });

  // — Row 4: persistence —
  const pY = libY + libH + 24;
  const pH = 56;
  const supaW = D.w * 0.55;
  const workerW = D.w - 60 - supaW;

  // Supabase
  doc.save().roundedRect(D.x + 30, pY, supaW, pH, 8).fillAndStroke('#DCFCE7', '#16A34A').restore();
  doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(10)
     .text('Supabase  ·  PostgreSQL + Storage (S3-compatible)', D.x + 36, pY + 5, { width: supaW - 12 });
  doc.fillColor(C.text).font('Helvetica').fontSize(7.5)
     .text('sabi_projects · sabi_attachments · sabi_emails · sabi_services · sabi_estimations',
           D.x + 36, pY + 22, { width: supaW - 12 });
  doc.fillColor(C.text).font('Helvetica').fontSize(7.5)
     .text('sabi_activity_log · sabi_yardstick_rates · sabi_no_bid_log · sabi-attachments bucket',
           D.x + 36, pY + 36, { width: supaW - 12 });

  // VPS worker
  const wx = D.x + 30 + supaW + 10;
  doc.save().roundedRect(wx, pY, workerW, pH, 8).fillAndStroke('#FFE4D2', '#EA580C').restore();
  doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(10).text('VPS worker', wx + 6, pY + 5, { width: workerW - 12 });
  doc.fillColor(C.text).font('Helvetica').fontSize(7.5)
     .text('worker/server.js · Express · Node 22 · undici', wx + 6, pY + 22, { width: workerW - 12 });
  doc.fillColor(C.text).font('Helvetica').fontSize(7.5)
     .text('async take-off · bypass 300 s cap', wx + 6, pY + 36, { width: workerW - 12 });

  // — Row 5: AI gateway pill —
  const gY = pY + pH + 22;
  const gW = 280, gH = 36;
  const gX = D.x + (D.w - gW) / 2;
  doc.save().roundedRect(gX, gY, gW, gH, 8).fillAndStroke('#FBBF24', '#B45309').restore();
  doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(10)
     .text('Nexaproc AI Gateway (chatgptnotes/AI-aas)', gX, gY + 4, { width: gW, align: 'center' });
  doc.fillColor(C.text).font('Helvetica').fontSize(8)
     .text('single egress · per-tenant rate + cost control · taskID prompt registry', gX, gY + 19, { width: gW, align: 'center' });

  // arrows — gmail/anthropic/whatsapp -> vercel
  ext.forEach((e, i) => {
    const x = D.x + 10 + i * (extW + 10) + extW / 2;
    arrow(x, extY + extH, x, v.y - 2, e.bd);
  });
  // vercel -> libs
  libs.forEach((_l, i) => {
    const x = D.x + 10 + i * (libW + 10) + libW / 2;
    arrow(x, v.y + v.h, x, libY - 2, C.mute);
  });
  // libs -> supabase / worker (combined two arrows)
  arrow(D.x + 10 + (libW + 10) * 1.5, libY + libH, D.x + 30 + supaW / 2, pY - 2, C.mute);
  arrow(D.x + 10 + (libW + 10) * 2.5 + libW / 2, libY + libH, wx + workerW / 2, pY - 2, C.mute);
  // libs/ai -> gateway (straight down from src/lib/ai box)
  arrow(D.x + 10 + libW / 2, libY + libH, gX + gW / 2 - 60, gY - 2, '#B45309');
  // gateway -> anthropic via L-shape on the right edge to avoid crossing libs
  const gwOutX = gX + gW * 0.6;
  const railX  = D.x + D.w - 16;
  doc.save().strokeColor('#B45309').lineWidth(1.2)
     .moveTo(gwOutX, gY)
     .lineTo(gwOutX, libY + libH + 8)
     .lineTo(railX,  libY + libH + 8)
     .lineTo(railX,  extY + extH + 14)
     .stroke().restore();
  // arrowhead pointing up into Anthropic box
  arrow(railX, extY + extH + 14, D.x + 10 + extW + 10 + extW / 2, extY + extH + 2, '#B45309');

  // legend
  const lgY = D.y + D.h - 18;
  doc.fillColor(C.mute).font('Helvetica').fontSize(8)
     .text('Solid = data flow   ·   Coloured boxes = production system   ·   src/lib/* boxes = code modules',
           D.x, lgY, { width: D.w, align: 'center' });
}

// ─── PAGE 4 — Email-to-quote sequence ─────────────────────────────────────
function pageSequence() {
  doc.addPage();
  pageHeader('Sequence');
  h1('How a single RFQ flows end-to-end');
  p('Each row is one event in time. The system column shows where the work happens.');
  doc.moveDown(0.4);

  const rows = [
    ['1', 'New email arrives at estimation@sabi.ae', 'Gmail',                              '—'],
    ['2', 'Cron polls Gmail every 15 min',           'Vercel cron · /api/cron/poll-inbox', 'sabi_emails INSERT'],
    ['3', 'Subject + body keyword pre-filter',       'lib/email/gmail-sync',                'RFQ_KEYWORDS hit'],
    ['4', 'AI classification (priority + RFQ-or-not)','lib/ai/claude-api.classifyEmail',     'sabi_projects status=classified'],
    ['5', 'Operator opens the bid detail page',      'app/bids/[id]/page.tsx',              '—'],
    ['6', 'Run Extract — unzip + parse PDFs/specs',  '/api/projects/[id]/extract',          'sabi_attachments + storage'],
    ['7', 'AI building extraction (floors, area, type)','lib/ai/claude-api.extractProjectInfo', 'sabi_projects.building_*'],
    ['8', 'Discipline tag for every drawing',        'lib/ai/classifyDrawingDiscipline',    'sabi_attachments.discipline'],
    ['9', 'Gate 1 — Documents Sufficient (binary)',   '/api/projects/[id]/gate',             'docs_sufficient_pending'],
    ['10','Gate 2 — Bid Decision (no_bid · detailed)','/api/projects/[id]/bid-decision',     'bid_decision_pending'],
    ['11','Run Pricing -> ENTERS electrical sub-pipeline','/api/projects/[id]/estimate',       'estimating'],
    ['11.a','Pre-pass: SLD spatial · DXF text · OCR',  'lib/electrical/pre-pass',             'cache hash'],
    ['11.b','Claude vision call (14-step prompt)',    'gateway -> claude CLI on VPS',         'ElectricalProcedureResult JSON'],
    ['11.c','Long runs (>300 s) dispatched to VPS',   'worker/server.js',                    'async write-back'],
    ['11.d','Enrich result + diff against fixture',   'derive-cable-paths · cable-schedule-diff','cable_schedule rows'],
    ['12','Gate 3 — Confirm Quantities (=cable schedule)','/api/projects/[id]/gate',         'pricing_pending -> boq_generating'],
    ['12.x','Auto-render 12-section Power BOQ PDF',   'pdf/boq-pdf-generator + pdfkit',      'storage://boq/{id}/power-boq.pdf'],
    ['13','Yardstick check (rates vs benchmarks)',    'pipeline/yardstick-orchestrator',     'yardstick_checked'],
    ['14','Gate 4 — Confirm Total (AED + variance)',  '/api/projects/[id]/gate',             'consent_pending'],
    ['15','Gate 5 — Consent -> Send (HUMAN)',          '/api/projects/[id]/gate',             'sending -> sent'],
    ['x', 'Quotation email + PDF dispatched',         'lib/email/send-quotation',            'Gmail thread reply'],
  ];

  // table
  const tableX = MARGIN;
  const tableW = PAGE_W - MARGIN * 2;
  const cols = [24, 240, 175, tableW - 24 - 240 - 175];
  const headers = ['#', 'What happens', 'Where (route / module)', 'DB / artifact'];

  // header
  let y = doc.y + 4;
  doc.save().rect(tableX, y, tableW, 22).fill(C.ink).restore();
  let cx = tableX + 6;
  headers.forEach((h, i) => {
    doc.fillColor(C.white).font('Helvetica-Bold').fontSize(9)
       .text(h, cx, y + 7, { width: cols[i] - 6 });
    cx += cols[i];
  });
  y += 22;

  // rows
  rows.forEach((r, idx) => {
    const isSub = r[0].includes('.');
    const isGate = /Gate/.test(r[1]);
    const rowH = 22;
    const fill = isGate ? C.gateFill : (isSub ? C.subFill : (idx % 2 === 0 ? C.white : C.bgSoft));
    doc.save().rect(tableX, y, tableW, rowH).fill(fill).restore();
    cx = tableX + 6;
    r.forEach((cell, i) => {
      const isFirst = i === 0;
      const fontSize = 8.5;
      doc.fillColor(isGate ? C.gateBd : C.text)
         .font(isFirst ? 'Helvetica-Bold' : 'Helvetica')
         .fontSize(fontSize)
         .text(cell, cx, y + 7, { width: cols[i] - 6, ellipsis: true, height: rowH - 6 });
      cx += cols[i];
    });
    // hairline under
    doc.save().moveTo(tableX, y + rowH).lineTo(tableX + tableW, y + rowH)
       .lineWidth(0.5).strokeColor(C.hair).stroke().restore();
    y += rowH;
  });

  doc.x = MARGIN;
  doc.y = y + 6;
  doc.fillColor(C.mute).font('Helvetica-Oblique').fontSize(8)
     .text('Yellow rows = confirmation gates. Pink rows = electrical sub-pipeline (lives inside main step 11 on the Detailed path).',
           MARGIN, y + 6, { width: PAGE_W - MARGIN * 2 });
}

// ─── PAGE 5 — MAIN pipeline (15 steps · 5 gates) ──────────────────────────
function pageMainPipeline() {
  doc.addPage();
  pageHeader('MAIN pipeline');
  h1('MAIN pipeline — 15 steps · 5 confirmation gates');
  p('Source: src/lib/shared/constants.ts -> MAIN_PIPELINE_STEPS. Status mapping in MAIN_STATUS_TO_STEP. ' +
    'Phases align with sabi-workflow.pdf v6.0.');
  doc.moveDown(0.5);

  const steps = [
    { n: 1,  ph: 1, name: 'Read Email',                   gate: false, status: 'classified',         desc: 'Poll inbox; pick mails to estimation@sabi.ae' },
    { n: 2,  ph: 1, name: 'Register New Enquiry',          gate: false, status: 'enquiry_registered', desc: 'Create sabi_projects row · project_name + source' },
    { n: 3,  ph: 1, name: 'Open Tender Folder',            gate: false, status: 'folder_opened',      desc: 'Create S3 prefix in sabi-attachments bucket' },
    { n: 4,  ph: 1, name: 'Unload Attachments',            gate: false, status: 'attachment_unloaded',desc: 'Save attachments · notify if none' },
    { n: 5,  ph: 1, name: 'Extract Archive',               gate: false, status: 'extracting',         desc: 'Unzip / unrar · parse PDFs · OCR if needed' },
    { n: 6,  ph: 1, name: 'List Available Documents',      gate: false, status: 'documents_listed',   desc: 'Inventory + type tag (drawing/spec/schedule)' },
    { n: 7,  ph: 1, name: 'List Drawings',                 gate: false, status: 'drawings_listed',    desc: 'Discipline tag every drawing (electrical only)' },
    { n: 8,  ph: 1, name: 'Extract Building + Reputation', gate: false, status: 'building_extracted', desc: 'Floors, area/floor, building type, height · tier' },
    { n: 9,  ph: 1, name: 'Documents Sufficient',          gate: 1,     status: 'docs_sufficient_pending', desc: 'GATE 1 — binary: enough drawings/specs?' },
    { n: 10, ph: 2, name: 'Bid Decision',                  gate: 2,     status: 'bid_decision_pending',    desc: 'GATE 2 — 2-way: No-Bid · Detailed' },
    { n: 11, ph: 3, name: 'Run Pricing',                   gate: false, status: 'estimating',         desc: 'Enters Electrical Sub (14 steps) on Detailed path' },
    { n: 12, ph: 3, name: 'Confirm Quantities',            gate: 3,     status: 'pricing_pending',    desc: 'GATE 3 — cable schedule review · auto-renders BOQ' },
    { n: 13, ph: 4, name: 'Yardstick Check',               gate: false, status: 'yardstick_checked',  desc: 'Compare AED against benchmark by building type' },
    { n: 14, ph: 4, name: 'Confirm Total',                 gate: 4,     status: 'confirm_total_pending', desc: 'GATE 4 — review total + yardstick variance' },
    { n: 15, ph: 4, name: 'Consent Received & Send',       gate: 5,     status: 'consent_pending',    desc: 'GATE 5 — HUMAN ONLY · dispatch quotation' },
  ];

  const phaseColors = {
    1: { fill: C.phase1, bd: C.phase1Bd, label: 'Phase 1 · Information Sufficiency' },
    2: { fill: C.phase2, bd: C.phase2Bd, label: 'Phase 2 · Bid Decision' },
    3: { fill: C.phase3, bd: C.phase3Bd, label: 'Phase 3 · Quantities' },
    4: { fill: C.phase4, bd: C.phase4Bd, label: 'Phase 4 · Final Quote' },
  };

  // grid: 3 columns × 5 rows
  const cols = 3, rows = 5;
  const gridW = PAGE_W - MARGIN * 2;
  const cardW = (gridW - (cols - 1) * 8) / cols;
  const cardH = 96;
  const startY = doc.y + 10;

  steps.forEach((s, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const x = MARGIN + c * (cardW + 8);
    const y = startY + r * (cardH + 10);
    const ph = phaseColors[s.ph];
    box(x, y, cardW, cardH, C.white, ph.bd);
    // phase strip on left
    doc.save().rect(x, y, 5, cardH).fill(ph.bd).restore();
    // step number
    doc.fillColor(ph.bd).font('Helvetica-Bold').fontSize(18)
       .text(String(s.n), x + 12, y + 8, { width: 26 });
    // gate badge (top-right, drawn first so title can avoid it)
    const hasGate = !!s.gate;
    if (hasGate) {
      const bx = x + cardW - 32, by = y + 8;
      doc.save().roundedRect(bx, by, 26, 13, 4).fillAndStroke(C.gateFill, C.gateBd).restore();
      doc.fillColor(C.gateBd).font('Helvetica-Bold').fontSize(7.5)
         .text(`G${s.gate}`, bx, by + 3, { width: 26, align: 'center' });
    }
    // name — width reduced when gate badge present
    const nameW = cardW - 50 - (hasGate ? 30 : 4);
    doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(10)
       .text(s.name, x + 42, y + 9, { width: nameW, lineGap: 1 });
    // desc
    doc.fillColor(C.text).font('Helvetica').fontSize(8)
       .text(s.desc, x + 42, y + 38, { width: cardW - 50, lineGap: 1, height: cardH - 56, ellipsis: true });
    // status pill
    doc.fillColor(C.mute).font('Helvetica-Oblique').fontSize(7)
       .text(`status: ${s.status}`, x + 42, y + cardH - 14, { width: cardW - 50, ellipsis: true });
  });

  // legend
  const legY = startY + rows * (cardH + 10) + 4;
  doc.fillColor(C.mute).font('Helvetica').fontSize(8);
  let lx = MARGIN;
  Object.entries(phaseColors).forEach(([ , v]) => {
    doc.save().roundedRect(lx, legY, 10, 10, 2).fill(v.bd).restore();
    doc.fillColor(C.text).font('Helvetica').fontSize(8).text(v.label, lx + 14, legY + 1);
    lx += 130;
  });
}

// ─── PAGE 6 — Electrical sub-pipeline (14 steps) ──────────────────────────
function pageElectricalSub() {
  doc.addPage();
  pageHeader('Electrical sub-pipeline');
  h1('Electrical sub-pipeline — 14 steps');
  p('Runs inside MAIN step 11 (Run Pricing) on the Detailed path. Source: ELECTRICAL_SUB_PIPELINE in ' +
    'src/lib/shared/constants.ts. Claude Sonnet 4.6 scans each drawing through a single 14-step prompt; ' +
    'the JSON result is enriched (lib/electrical/derive-cable-paths) and validated (cable-schedule-diff).');
  doc.moveDown(0.4);

  const sub = [
    [1,  'Open the Drawing',                       'Locate every electrical drawing in the attachment set'],
    [2,  'List Available Drawings',                'Classify: floor_plan / schematic / riser / schedule / other'],
    [3,  'Establish Floors and Floor Height',      'Count + name every level · note typical floor height (m)'],
    [4,  'Find Drawing Scale',                     'Read scale annotation or scale bar (1:100 / 1:50)'],
    [5,  'Identify LV Room / MDB',                 'Find Main LV Panel · tag, rating (A), location'],
    [6,  'Check Schematic Drawing Availability',   'Confirm SLD / schematic exists · note filename'],
    [7,  'Note SMDBs from LV Panel',               'From SLD: tag · floor · rating · cable size (e.g. 4C×95mm²)'],
    [8,  'Identify SMDBs in Floor Drawings',       'Confirm SMDB locations Basement -> Roof'],
    [9,  'Establish Cable Route LV -> SMDBs',       'Read riser / annotations · note probable route'],
    [10, 'Estimate Cable Lengths LV -> SMDBs',      'mm² + length (m) + confidence: high/medium/low'],
    [11, 'Establish SMDB -> DB Identification',     'From SLD: every DB fed from each SMDB'],
    [12, 'Identify DB Locations per SMDB',         'From floor plans · floor by floor'],
    [13, 'Estimate Cable Size + Length per DB',    'Scaled floor-plan measurement · per-run confidence'],
    [14, 'GATE — Cable Schedule Review',           'Compile every cable entry · approve to render Power BOQ'],
  ];

  // 2 columns
  const cols = 2;
  const gridW = PAGE_W - MARGIN * 2;
  const cardW = (gridW - 10) / cols;
  const cardH = 50;
  const startY = doc.y + 6;

  sub.forEach(([n, name, desc], i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const x = MARGIN + c * (cardW + 10);
    const y = startY + r * (cardH + 6);
    const isGate = n === 14;
    const fill = isGate ? C.gateFill : C.white;
    const border = isGate ? C.gateBd : C.subBd;
    box(x, y, cardW, cardH, fill, border);
    doc.save().rect(x, y, 4, cardH).fill(isGate ? C.gateBd : C.subBd).restore();

    doc.fillColor(isGate ? C.gateBd : C.subBd).font('Helvetica-Bold').fontSize(16)
       .text(String(n), x + 12, y + 6, { width: 30 });
    doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(10)
       .text(name, x + 46, y + 8, { width: cardW - 56 });
    doc.fillColor(C.text).font('Helvetica').fontSize(8)
       .text(desc, x + 46, y + 22, { width: cardW - 56, lineGap: 1 });
  });

  // result panel
  const ry = startY + Math.ceil(sub.length / cols) * (cardH + 6) + 16;
  box(MARGIN, ry, gridW, 96, '#FFFBEB', C.gateBd);
  doc.fillColor(C.gateBd).font('Helvetica-Bold').fontSize(11)
     .text('On Gate 14 approval', MARGIN + 12, ry + 10);
  doc.fillColor(C.text).font('Helvetica').fontSize(9)
     .text('1.  status pricing_pending -> boq_generating', MARGIN + 12, ry + 30);
  doc.text('2.  generateElectricalPowerBOQ() runs (lib/pdf/boq-pdf-generator.ts)', MARGIN + 12);
  doc.text('3.  12-section Power BOQ PDF stored at  storage://sabi-attachments/boq/{id}/power-boq.pdf', MARGIN + 12);
  doc.text('4.  status -> boq_ready  ·  project re-enters MAIN step 13 (Yardstick)', MARGIN + 12);
}

// ─── PAGE 7 — AI routing + cost controls ──────────────────────────────────
function pageAi() {
  doc.addPage();
  pageHeader('AI routing');
  h1('AI provider routing & cost controls');
  p('src/lib/ai/ai-provider.ts is the router. Different functions go to different providers. ' +
    'All calls can be routed through the Nexaproc gateway by setting USE_AI_GATEWAY=true.');
  doc.moveDown(0.4);

  // Provider routing table
  h2('Per-function provider matrix');
  const matrix = [
    ['classifyEmail',                'Claude Haiku 4.5',                       'Email RFQ classification'],
    ['extractProjectInfo',           'Claude Sonnet 4.6',                      'Building info from spec PDF'],
    ['classifyDrawingDiscipline',    'rules-only (no AI call)',                'Per-drawing discipline tag'],
    ['classifyReputation',           'rules-only (no AI call)',                'Source-of-enquiry tier'],
    ['analyzeSpecifications',        'Claude Sonnet 4.6',                      'Spec doc requirements'],
    ['analyzeElectricalProcedure',   'Claude Sonnet 4.6',                      '14-step electrical take-off'],
    ['analyzeElectricalDrawing',     'Claude Sonnet 4.6',                      'Single-drawing electrical pass'],
  ];

  const tableX = MARGIN;
  const tableW = PAGE_W - MARGIN * 2;
  const cols = [180, 215, tableW - 180 - 215];
  const headers = ['Function', 'Provider env', 'What it does'];
  let y = doc.y + 4;
  doc.save().rect(tableX, y, tableW, 22).fill(C.ink).restore();
  let cx = tableX + 6;
  headers.forEach((h, i) => {
    doc.fillColor(C.white).font('Helvetica-Bold').fontSize(9).text(h, cx, y + 7, { width: cols[i] - 6 });
    cx += cols[i];
  });
  y += 22;
  matrix.forEach((r, idx) => {
    const fill = idx % 2 === 0 ? C.white : C.bgSoft;
    doc.save().rect(tableX, y, tableW, 18).fill(fill).restore();
    cx = tableX + 6;
    r.forEach((cell, i) => {
      doc.fillColor(C.text).font(i === 0 ? 'Courier' : 'Helvetica').fontSize(8.5)
         .text(cell, cx, y + 5, { width: cols[i] - 6 });
      cx += cols[i];
    });
    doc.save().moveTo(tableX, y + 18).lineTo(tableX + tableW, y + 18).lineWidth(0.5).strokeColor(C.hair).stroke().restore();
    y += 18;
  });
  doc.x = MARGIN;
  doc.y = y + 8;

  h2('Cost guardrails');
  bullets([
    'Result cache (lib/ai/result-cache.ts) — content-hash key on the input drawings; same PDF set hits cache, no Claude call.',
    'Fixture replay (lib/ai/test-fixture-replay.ts) — golden test fixtures replayed instead of live AI in test envs.',
    'Budget guard (lib/ai/budget-guard.ts) — hard ceiling per project · trips before runaway spend.',
    'Throttled WhatsApp alerts on claude_401 / 429 / 529 / 5xx · gateway_timeout · cost_drift · cohort_drift (lib/notifications/api-alert.ts).',
    'Daily cron /api/cron/ai-cost-drift watches per-project token spend versus rolling baseline.',
  ]);

  h2('Long-running take-offs (the >300 s problem)');
  p('Claude Opus on a 9.6 MB power PDF + the 14-step prompt regularly exceeds Vercel\'s 300 s function cap. ' +
    'The estimate route sets maxDuration=300 but, when worker-dispatch is enabled, off-loads to a VPS:');
  bullets([
    'POST -> /api/projects/[id]/estimate detects long-run conditions and calls dispatchEstimateToWorker().',
    'worker/server.js (Express, Node 22) calls the Nexaproc gateway with a 1200 s headersTimeout via undici dispatcher.',
    'Worker writes the ElectricalProcedureResult back to Supabase + sets status pricing_pending.',
    'The bid-detail page polls until the status changes — no UI change required.',
  ]);
}

// ─── PAGE 8 — Database + storage reference ────────────────────────────────
function pageDb() {
  doc.addPage();
  pageHeader('Database');
  h1('Database & storage reference');
  p('Supabase (PostgreSQL). Migrations live in supabase/migrations/. Everything is project-scoped via project_id.');
  doc.moveDown(0.4);

  const tables = [
    { t: 'sabi_emails',             p: 'Raw Gmail messages synced from estimation@sabi.ae'                           },
    { t: 'sabi_email_attachments',  p: 'Attachment metadata at the email level (pre-project)'                        },
    { t: 'sabi_projects',           p: 'One row per RFQ. Status drives the pipeline; bid_decision drives the path.'   },
    { t: 'sabi_attachments',        p: 'Attachment rows scoped to a project · file_type · discipline · storage_path' },
    { t: 'sabi_services',           p: 'MEP services per project · confidence (high/medium/low) · pricing_source'    },
    { t: 'sabi_estimations',        p: 'Calculation results · margin · final_quote_aed · yardstick_status'           },
    { t: 'sabi_activity_log',       p: 'Audit trail per step · sub_pipeline column distinguishes MAIN vs electrical' },
    { t: 'sabi_yardstick_rates',    p: 'Market benchmark rates by building type / discipline / region'               },
    { t: 'sabi_no_bid_log',         p: 'Terminal-exit audit · Gate 13 No-Bid + 7-day auto-escalation'                 },
    { t: 'sabi_corrections',        p: 'Human corrections to AI output · feeds rate-adjuster + nb-tune'              },
    { t: 'sabi_settings',           p: 'KV store · gmail_sync_state, feature flags'                                   },
  ];

  // table of tables
  const tx = MARGIN, tw = PAGE_W - MARGIN * 2;
  const c = [180, tw - 180];
  let y = doc.y + 2;
  doc.save().rect(tx, y, tw, 22).fill(C.ink).restore();
  doc.fillColor(C.white).font('Helvetica-Bold').fontSize(9).text('Table', tx + 8, y + 7, { width: c[0] - 8 });
  doc.fillColor(C.white).font('Helvetica-Bold').fontSize(9).text('Purpose', tx + c[0] + 8, y + 7, { width: c[1] - 16 });
  y += 22;
  tables.forEach((row, idx) => {
    const fill = idx % 2 === 0 ? C.white : C.bgSoft;
    doc.save().rect(tx, y, tw, 22).fill(fill).restore();
    doc.fillColor(C.brandDark).font('Courier-Bold').fontSize(9).text(row.t, tx + 8, y + 7, { width: c[0] - 8 });
    doc.fillColor(C.text).font('Helvetica').fontSize(9).text(row.p, tx + c[0] + 8, y + 7, { width: c[1] - 16 });
    doc.save().moveTo(tx, y + 22).lineTo(tx + tw, y + 22).lineWidth(0.5).strokeColor(C.hair).stroke().restore();
    y += 22;
  });

  doc.x = MARGIN;
  doc.y = y + 12;
  h2('Storage layout (sabi-attachments bucket)');
  bullets([
    'projects/{id}/raw/{filename}            — original files extracted from email attachments',
    'projects/{id}/extracted/{filename}      — files unzipped from archive attachments',
    'boq/{id}/power-boq.pdf                   — generated 12-section Power BOQ',
    'boq/{id}/power-boq.xlsx                  — Industry-format BOQ workbook (ExcelJS)',
    'preview/{id}/{att}.png                   — drawing thumbnails for the file viewer',
  ]);
}

// ─── PAGE 9 — File processing matrix ──────────────────────────────────────
function pageFiles() {
  doc.addPage();
  pageHeader('File processing');
  h1('File-format processing matrix');
  p('How each uploaded file is handled before the AI sees it.');
  doc.moveDown(0.4);

  const rows = [
    ['PDF',          'pdf-parse -> text · pdfjs-dist -> page render · ocr-pdf if image-only',           'Sent to Claude as vision'],
    ['PNG / JPG',    'Buffer passed straight through · ocr-image when text needed',                    'Vision input'],
    ['DXF',          'dxf-parser server-side (lib/drawing/dxf-text-extractor.ts) · layer + TEXT/MTEXT', 'Text features feed AI as context'],
    ['DWG',          'No native parser — REJECTED with operator hint',                                  '"Convert to PDF or DXF"'],
    ['ZIP / RAR',    'adm-zip · node-unrar-js · entry-cap zip-bomb guard',                             'Recurse into extracted files'],
    ['XLSX / XLS',   'ExcelJS read · panel-schedule-parser · xlsx-schedule-parser',                    'Structured rows feed AI'],
    ['DOC / DOCX',   'mammoth -> text · spec-doc-loader',                                                'Spec text feeds AI'],
    ['Images (TIFF/BMP)', 'tesseract.js OCR fallback',                                                  'OCR text feeds AI'],
    ['EML / MSG',    'gmail.extractBody · stripQuotedReplies',                                          'Email text feeds classifier'],
  ];

  const tx = MARGIN, tw = PAGE_W - MARGIN * 2;
  const c = [80, 280, tw - 80 - 280];
  const headers = ['Format', 'Pipeline', 'AI usage'];
  let y = doc.y + 2;
  doc.save().rect(tx, y, tw, 22).fill(C.ink).restore();
  let cx = tx + 8;
  headers.forEach((h, i) => {
    doc.fillColor(C.white).font('Helvetica-Bold').fontSize(9).text(h, cx, y + 7, { width: c[i] - 16 });
    cx += c[i];
  });
  y += 22;
  rows.forEach((r, idx) => {
    const fill = idx % 2 === 0 ? C.white : C.bgSoft;
    const isReject = r[0] === 'DWG';
    doc.save().rect(tx, y, tw, 24).fill(isReject ? '#FEE2E2' : fill).restore();
    cx = tx + 8;
    r.forEach((cell, i) => {
      doc.fillColor(isReject ? C.danger : C.text).font(i === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5)
         .text(cell, cx, y + 7, { width: c[i] - 16, lineGap: 1 });
      cx += c[i];
    });
    doc.save().moveTo(tx, y + 24).lineTo(tx + tw, y + 24).lineWidth(0.5).strokeColor(C.hair).stroke().restore();
    y += 24;
  });

  doc.x = MARGIN;
  doc.y = y + 12;
  h2('Discipline detection — two passes');
  bullets([
    'Pass 1 (extract route): classifyDrawingDiscipline() scores filename + extracted text against keyword tables.',
    'Pass 2 (estimate route): re-classifies live · rejects files whose stored OR detected discipline is in NON_ELECTRICAL_DISCIPLINES.',
    'NON_ELECTRICAL_DISCIPLINES = { hvac, plumbing, fire_fighting, fire_alarm, bms, lpg, drainage }.',
    'Skipped files come back in the 422 response so the operator can see exactly why each file was excluded.',
  ]);

  h2('Power BOQ — 12 sections');
  bullets([
    '1. Project Summary    ·  2. Incoming Supply & Transformers  ·  3. LV Panels',
    '4. Sub-Main DB (SMDB) ·  5. Distribution Boards (DB)         ·  6. Mechanical & Service Equipment',
    '7. Power Outlets      ·  8. Cables — Main Distribution        ·  9. Containment',
    '10. Earthing & LP    ·  11. Metering & Monitoring             ·  12. Summary of Electrical Loads',
  ]);
}

// ─── PAGE 10 — Repo map + glossary ────────────────────────────────────────
function pageRepoMap() {
  doc.addPage();
  pageHeader('Repo map');
  h1('Source-tree map');
  p('Where to look when something needs changing.');
  doc.moveDown(0.4);

  const map = [
    ['src/app/api/cron/poll-inbox',         'Gmail polling cron — every 15 min'],
    ['src/app/api/projects/route.ts',       'List projects (bid list)'],
    ['src/app/api/projects/[id]',           'Project CRUD + sub-routes'],
    ['    extract/',                         'Phase 1 extraction (steps 4–8)'],
    ['    estimate/',                        'Phase 3 entry — runs electrical sub-pipeline'],
    ['    bid-decision/',                    'Gate 2 — 2-way (no_bid · detailed)'],
    ['    gate/',                            'Binary gates 9, 12, 14, 15'],
    ['    cable-schedule/',                  'Cable schedule editor endpoints'],
    ['    yardstick/',                       'Manual yardstick re-run'],
    ['    boq/  ·  power-boq/',              'BOQ Excel + Power BOQ PDF download'],
    ['    send-quote/',                      'Email dispatch (Gate 5 trigger)'],
    ['src/app/bids/[id]/page.tsx',           'Bid detail page (5056 lines · main UI)'],
    ['src/app/inbox/page.tsx',               'Email inbox view'],
    ['src/components/pipeline/',             'Workflow UI · sidebar, step timeline, modals'],
    ['src/lib/shared/constants.ts',          'MAIN_PIPELINE_STEPS · ELECTRICAL_SUB_PIPELINE · gates'],
    ['src/lib/ai/',                          'Provider router · Claude · gateway · cache'],
    ['src/lib/electrical/',                  'Pre-pass · SLD parser · cable derivation · DEWA formulas'],
    ['src/lib/pipeline/',                    'Estimation engine · yardstick · BOQ · rate adjuster'],
    ['src/lib/pdf/',                         'pdfkit setup · BOQ PDF generator · OCR'],
    ['src/lib/excel/',                       'Industry-format BOQ workbook (ExcelJS)'],
    ['src/lib/drawing/',                     'DXF text · scale detect · symbol counter · floor counter'],
    ['src/lib/email/',                       'Gmail OAuth · sync · send · personalization'],
    ['src/lib/storage/',                     'Supabase client · S3 multipart · activity logger'],
    ['src/lib/notifications/',               'Throttled WhatsApp alerts (api-alert.ts)'],
    ['supabase/migrations/',                 'SQL schema migrations'],
    ['worker/server.js',                     'VPS background worker (Express + undici)'],
    ['scripts/',                             'CLI generators · seeders · fixtures'],
  ];

  const tx = MARGIN, tw = PAGE_W - MARGIN * 2;
  const c = [240, tw - 240];
  let y = doc.y + 2;
  doc.save().rect(tx, y, tw, 22).fill(C.ink).restore();
  doc.fillColor(C.white).font('Helvetica-Bold').fontSize(9).text('Path', tx + 8, y + 7, { width: c[0] - 8 });
  doc.fillColor(C.white).font('Helvetica-Bold').fontSize(9).text('Purpose', tx + c[0] + 8, y + 7, { width: c[1] - 16 });
  y += 22;
  map.forEach((row, idx) => {
    const isIndent = row[0].startsWith('  ');
    const fill = idx % 2 === 0 ? C.white : C.bgSoft;
    doc.save().rect(tx, y, tw, 16).fill(fill).restore();
    doc.fillColor(isIndent ? C.mute : C.brandDark).font('Courier').fontSize(8.5).text(row[0], tx + 8, y + 4, { width: c[0] - 8 });
    doc.fillColor(C.text).font('Helvetica').fontSize(8.5).text(row[1], tx + c[0] + 8, y + 4, { width: c[1] - 16 });
    y += 16;
  });
  doc.x = MARGIN;
  doc.y = y + 4;

  h2('Glossary');
  bullets([
    'RFQ — Request For Quotation. The inbound email this system processes.',
    'BOQ — Bill of Quantities. The output document with line-item pricing.',
    'MDB / SMDB / DB — Main · Sub-main · Distribution boards (electrical hierarchy).',
    'SLD — Single-Line Diagram (the one-line schematic of the electrical system).',
    'Gate — A confirmation checkpoint. Binary (approve / revise) or 2-way (no-bid / detailed).',
    'Yardstick — Market benchmark rate. Used to sanity-check the AI estimate.',
    'INSTANT BOQ lane — auto-approve gates 1–4, stop at Gate 5. The "Run to BOQ" button.',
  ]);
}

// ─── render ───────────────────────────────────────────────────────────────
pageCover();
pageOverview();
pageArchitecture();
pageSequence();
pageMainPipeline();
pageElectricalSub();
pageAi();
pageDb();
pageFiles();
pageRepoMap();

// ─── footer + page numbers ────────────────────────────────────────────────
const range = doc.bufferedPageRange();
for (let i = 0; i < range.count; i++) {
  doc.switchToPage(i);
  if (i === 0) continue;  // skip cover
  doc.fontSize(8).fillColor(C.mute).font('Helvetica')
     .text(`${i + 1} / ${range.count}`,
           MARGIN, PAGE_H - 24, { width: PAGE_W - MARGIN * 2, align: 'right' });
  doc.text('realsoft.example  ·  System Workflow & Architecture',
           MARGIN, PAGE_H - 24, { width: PAGE_W - MARGIN * 2, align: 'left' });
}

doc.end();
out.on('finish', () => {
  const stat = fs.statSync(path.resolve(process.cwd(), OUT));
  console.log(`✓ wrote ${OUT}  (${(stat.size / 1024).toFixed(1)} KB)`);
});
