/**
 * BOQ PDF Generator — produces a polished, comprehensive client-facing
 * quotation PDF that embeds the per-service component breakdown that previously
 * lived only in the Excel BOQ. Clients now get a self-contained document they
 * can read end-to-end without opening the spreadsheet.
 *
 * Page order:
 *   1.    Cover                    — letterhead, headline numbers, services chip strip
 *   2.    Cover Letter             — professional prose intro from ERP Realsoft
 *   3.    Quotation Summary        — services-at-a-glance table + totals
 *   4..N. Per-Service Detail       — component-level breakdown (same data as Excel sheets)
 *   N+1.  Drawing References       — source drawings used (if any)
 *   N+2.  Terms & Conditions
 *   N+3.  Assumptions & Exclusions
 *
 * Uses pdfkit (pure JS, no native deps) so it works on Vercel.
 */

// IMPORTANT: pdfkit-setup must be imported BEFORE pdfkit so its fs patch
// is installed before pdfkit's StandardFont.init() does its first readFileSync.
import './pdfkit-setup';
import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { Project, Service, Estimation, Attachment } from '@/lib/shared/types';
import { SERVICE_LABELS } from '@/lib/shared/constants';
import { expandServiceToLineItems, SHORT_SERVICE_LABELS } from '@/lib/pipeline/boq-generator';
import { buildPersonalizedNote, type PersonalizedNote } from '@/lib/email/quotation-personalization';
import { supabaseAdmin } from '@/lib/storage/supabase';
import type { ElectricalProcedureResult } from '@/lib/ai/claude-api';
import {
  deriveContainmentRows,
  deriveEarthingRows,
  deriveMeteringRows,
  deriveMechanicalEquipmentRows,
  derivePowerOutletRows,
  demandFactor,
  maxDemandKw,
} from '@/lib/electrical/formulas';

// ─── Branding ─────────────────────────────────────────────────────────────
// Single source of truth for everything visual. Swap the hex values or env
// vars here and every page reflows automatically.
const BRAND = {
  name: 'ERP Realsoft',
  fullName: process.env.SABI_FULL_NAME || 'ERP Realsoft',
  address:  process.env.SABI_ADDRESS   || 'Dubai, United Arab Emirates',
  phone:    process.env.SABI_PHONE     || '+971 4 XXX XXXX',
  email:    process.env.SABI_EMAIL     || 'info@realsoft.example',
  website:  process.env.SABI_WEBSITE   || 'realsoft.example',
  trn:      process.env.SABI_TRN       || '100XXXXXXXXXXXXX',
  tagline:  'MEP Estimation Platform  •  Dubai, UAE',
  color: {
    primary:      '#0F2746',
    primaryDark:  '#081A33',
    primaryLight: '#E6ECF4',
    accent:       '#0E8A5F',
    accentLight:  '#E4F5ED',
    warning:      '#B45309',
    warningLight: '#FEF3E7',
    text:         '#0B1220',
    textMuted:    '#5B6470',
    textSubtle:   '#9AA3AE',
    border:       '#D4DCE6',
    borderLight:  '#EEF1F6',
    rowAlt:       '#F7F9FC',
    panel:        '#F3F6FB',
    chartColors: [
      '#0F2746', '#0E8A5F', '#B45309', '#6B46C1',
      '#2563EB', '#059669', '#DB2777', '#CA8A04',
    ],
  },
};

// Legacy alias — a lot of existing code references `COLOR.*` directly. Keep
// both names pointing at the same object so we don't have to rename every
// call site.
const COLOR = BRAND.color;
const SABI = BRAND;

const VAT_RATE = 0.05;
const QUOTE_VALIDITY_DAYS = 30;

const MARGIN = 50;
const A4_W = 595.28;
const A4_H = 841.89;
const CONTENT_W = A4_W - 2 * MARGIN;
const HEADER_BOTTOM_Y = 110; // first y at which body content can start on header pages
const PAGE_CONTENT_BOTTOM = A4_H - 80; // y limit before we should break the page

// Resolve optional brand PNGs at runtime. Missing files are fine — the layout
// falls back to text-only treatments so nothing breaks on a fresh checkout.
function loadBrandAsset(filename: string): Buffer | null {
  try {
    const p = path.join(process.cwd(), 'public', 'brand', filename);
    if (fs.existsSync(p)) return fs.readFileSync(p);
  } catch { /* noop */ }
  return null;
}
const BRAND_LOGO = loadBrandAsset('realsoft-logo.png');
const BRAND_SIGNATURE = loadBrandAsset('george-signature.png');

interface Totals {
  subtotal: number;
  marginPct: number;
  marginAmt: number;
  net: number;
  vat: number;
  grand: number;
}

export interface GenerateBOQPDFOptions {
  /** Base URL used to generate the QR code on the acceptance page. */
  baseUrl?: string;
}

export async function generateBOQPDF(
  project: Project,
  services: Service[],
  estimation: Estimation,
  attachments?: Attachment[],
  options: GenerateBOQPDFOptions = {}
): Promise<Buffer> {
  // QR code is rendered once up-front because PDFKit needs the raw PNG buffer
  // synchronously during layout. We generate it outside the Promise so we can
  // await it cleanly.
  const bidUrl = `${options.baseUrl || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001'}/bids/${project.id}`;
  let qrPng: Buffer | null = null;
  try {
    qrPng = await QRCode.toBuffer(bidUrl, {
      type: 'png',
      errorCorrectionLevel: 'M',
      margin: 1,
      scale: 6,
      color: { dark: BRAND.color.primary, light: '#FFFFFF' },
    });
  } catch { /* QR is optional — acceptance block still renders without it */ }

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        // We use absolute (x, y) positioning everywhere, so we disable PDFKit's
        // auto-pagination by setting tiny margins. Otherwise text written near
        // the bottom of the page (e.g. footer bars) silently triggers a new page,
        // which cascades into runaway page counts.
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        bufferPages: true,
        info: {
          Title: `Quotation - ${project.project_name || 'Project'}`,
          Author: SABI.fullName,
          Subject: 'MEP Bill of Quantities',
          Creator: 'ERP Realsoft',
        },
      });

      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const requiredServices = services.filter(s => s.is_required);
      const issueDate = new Date();
      const quoteNo = generateQuoteNumber(project.id, issueDate);
      const validUntil = new Date(issueDate);
      validUntil.setDate(validUntil.getDate() + QUOTE_VALIDITY_DAYS);

      const subtotal = requiredServices.reduce((s, x) => s + (x.total_aed || 0), 0);
      const marginPct = estimation.margin_percent || 15;
      const marginAmt = subtotal * marginPct / 100;
      const net = subtotal + marginAmt;
      const vat = net * VAT_RATE;
      const grand = net + vat;
      const totals: Totals = { subtotal, marginPct, marginAmt, net, vat, grand };

      // Build the personalized note once and share it between the cover letter
      // and any other prose section so the PDF and the email speak with one voice.
      const note = buildPersonalizedNote(project, requiredServices, estimation);

      drawCoverPage(doc, project, requiredServices, estimation, quoteNo, issueDate, validUntil, totals);

      doc.addPage();
      drawExecutiveSummaryPage(doc, project, requiredServices, estimation, quoteNo, totals);

      doc.addPage();
      drawCoverLetterPage(doc, project, quoteNo, issueDate, validUntil, totals, note);

      doc.addPage();
      drawSummaryPage(doc, project, requiredServices, estimation, quoteNo, issueDate, validUntil, totals);

      requiredServices.forEach((svc, idx) => {
        doc.addPage();
        drawServiceDetailPage(doc, svc, idx + 1, requiredServices.length, quoteNo);
      });

      if (attachments && attachments.length > 0) {
        doc.addPage();
        drawDrawingReferencesPage(doc, attachments, quoteNo);
      }

      doc.addPage();
      drawTermsPage(doc, quoteNo, qrPng, bidUrl);

      doc.addPage();
      drawExclusionsPage(doc, quoteNo);

      // Final pass — footers/page numbers and (if not yet approved) the
      // DRAFT watermark. Must happen after all pages exist so we know the
      // total page count.
      const isDraft = !estimation.george_approved;
      stampFootersAndPageNumbers(doc, quoteNo, project.project_name || 'Project', isDraft);

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ─── Page 1: Cover ────────────────────────────────────────────────────────
// Full-bleed hero band at top, project block centered, scope chips, footer.
// Intentionally spare — the executive summary page right after carries the
// numbers and KPIs.
function drawCoverPage(
  doc: PDFKit.PDFDocument,
  project: Project,
  services: Service[],
  estimation: Estimation,
  quoteNo: string,
  issueDate: Date,
  validUntil: Date,
  totals: Totals
) {
  // ─ Hero band (top 42% of page) ─
  const heroH = 360;
  doc.rect(0, 0, A4_W, heroH).fillColor(BRAND.color.primary).fill();
  // Subtle diagonal accent strip
  doc.save();
  doc.rect(0, heroH - 48, A4_W, 48).fillColor(BRAND.color.primaryDark).fill();
  doc.restore();
  // Accent hairline
  doc.rect(0, heroH, A4_W, 4).fillColor(BRAND.color.accent).fill();

  // Brand wordmark / logo
  if (BRAND_LOGO) {
    try {
      doc.image(BRAND_LOGO, MARGIN, 44, { height: 42 });
    } catch {
      drawTextWordmark(doc, MARGIN, 44);
    }
  } else {
    drawTextWordmark(doc, MARGIN, 44);
  }

  // Quote ref (top-right)
  doc.fontSize(8).fillColor('#8EA5C0').font('Helvetica-Bold')
    .text('QUOTATION REF.', MARGIN, 50, { width: CONTENT_W, align: 'right', characterSpacing: 1.5 });
  doc.fontSize(11).fillColor('#FFFFFF').font('Helvetica-Bold')
    .text(quoteNo, MARGIN, 64, { width: CONTENT_W, align: 'right' });
  doc.fontSize(8).fillColor('#8EA5C0').font('Helvetica')
    .text(`Issued ${formatDate(issueDate)}  •  Valid until ${formatDate(validUntil)}`,
      MARGIN, 80, { width: CONTENT_W, align: 'right' });

  // Document title, centered within hero
  doc.fontSize(9).fillColor('#8EA5C0').font('Helvetica-Bold')
    .text('BILL OF QUANTITIES', MARGIN, 150, { width: CONTENT_W, align: 'center', characterSpacing: 4 });
  doc.fontSize(34).fillColor('#FFFFFF').font('Helvetica-Bold')
    .text('MEP QUOTATION', MARGIN, 168, { width: CONTENT_W, align: 'center', characterSpacing: 1 });

  // Accent underline beneath title
  const underlineW = 90;
  doc.rect(MARGIN + (CONTENT_W - underlineW) / 2, 212, underlineW, 3)
    .fillColor(BRAND.color.accent).fill();

  // Project name in hero (white, large)
  const projectName = project.project_name || 'Project';
  doc.fontSize(18).fillColor('#FFFFFF').font('Helvetica-Bold')
    .text(projectName, MARGIN, 240, { width: CONTENT_W, align: 'center', ellipsis: true });

  if (project.location) {
    doc.fontSize(10).fillColor('#B5C4D9').font('Helvetica')
      .text(project.location, MARGIN, 266, { width: CONTENT_W, align: 'center' });
  }

  // Client line
  if (project.client_name) {
    doc.fontSize(9).fillColor('#8EA5C0').font('Helvetica-Bold')
      .text('PREPARED FOR', MARGIN, 298, { width: CONTENT_W, align: 'center', characterSpacing: 2 });
    doc.fontSize(12).fillColor('#FFFFFF').font('Helvetica-Bold')
      .text(project.client_name, MARGIN, 312, { width: CONTENT_W, align: 'center' });
  }

  // ─ Body (below hero) ─

  // Scope chips
  if (services.length > 0) {
    doc.fontSize(8).fillColor(BRAND.color.textSubtle).font('Helvetica-Bold')
      .text('SCOPE OF WORKS', MARGIN, heroH + 30, { width: CONTENT_W, align: 'center', characterSpacing: 2 });
    const labels = services.map(s => SHORT_SERVICE_LABELS[s.service_type] || s.service_type);
    drawCenteredChips(doc, labels, heroH + 46);
  }

  // Headline total card — simple horizontal band
  const totalY = heroH + 140;
  doc.roundedRect(MARGIN, totalY, CONTENT_W, 82, 4)
    .fillColor(BRAND.color.panel).fill();
  doc.rect(MARGIN, totalY, 4, 82).fillColor(BRAND.color.accent).fill();

  doc.fontSize(8).fillColor(BRAND.color.textMuted).font('Helvetica-Bold')
    .text('GRAND TOTAL  •  INCLUSIVE OF 5% VAT', MARGIN + 20, totalY + 16,
      { characterSpacing: 2 });
  doc.fontSize(28).fillColor(BRAND.color.primary).font('Helvetica-Bold')
    .text(`AED ${formatMoney(totals.grand)}`, MARGIN + 20, totalY + 30);
  doc.fontSize(8).fillColor(BRAND.color.textMuted).font('Helvetica-Oblique')
    .text(`AED ${numberToWords(totals.grand)} Only`, MARGIN + 20, totalY + 64,
      { width: CONTENT_W - 40 });

  // Yardstick gauge — inline, to the right of the amount if there's room.
  // Drawn as a small horizontal 3-zone bar.
  if (estimation.yardstick_status) {
    drawYardstickGauge(
      doc,
      MARGIN + CONTENT_W - 210,
      totalY + 20,
      200,
      estimation.yardstick_status
    );
  }

  // Bottom footer bar (dark, full-bleed)
  const barH = 44;
  const barY = A4_H - barH;
  doc.rect(0, barY, A4_W, barH).fillColor(BRAND.color.primary).fill();
  doc.rect(0, barY, A4_W, 3).fillColor(BRAND.color.accent).fill();
  doc.fontSize(9).fillColor('#FFFFFF').font('Helvetica-Bold')
    .text(BRAND.fullName, MARGIN, barY + 10, { width: CONTENT_W, align: 'center' });
  doc.fontSize(8).fillColor('#B5C4D9').font('Helvetica')
    .text(`${BRAND.address}  •  ${BRAND.phone}  •  ${BRAND.email}  •  ${BRAND.website}`,
      MARGIN, barY + 24, { width: CONTENT_W, align: 'center' });
}

// Text-only fallback when no logo PNG is available.
function drawTextWordmark(doc: PDFKit.PDFDocument, x: number, y: number) {
  doc.fontSize(26).fillColor('#FFFFFF').font('Helvetica-Bold')
    .text(BRAND.name, x, y, { characterSpacing: 4 });
  doc.fontSize(7).fillColor('#8EA5C0').font('Helvetica')
    .text(BRAND.tagline.toUpperCase(), x, y + 30, { characterSpacing: 1.5 });
}

// ─── Page 2: Executive Summary ───────────────────────────────────────────
// Single-page visual dashboard. Everything a busy reader needs on one view:
// grand total, KPI tiles, service-split donut, yardstick gauge.
function drawExecutiveSummaryPage(
  doc: PDFKit.PDFDocument,
  project: Project,
  services: Service[],
  estimation: Estimation,
  quoteNo: string,
  totals: Totals
) {
  drawHeaderBar(doc, 'EXECUTIVE SUMMARY', quoteNo);

  let y = HEADER_BOTTOM_Y + 6;

  // ─ Hero total card ─
  const heroH = 96;
  doc.rect(MARGIN, y, CONTENT_W, heroH).fillColor(BRAND.color.primary).fill();
  doc.rect(MARGIN, y, CONTENT_W, 3).fillColor(BRAND.color.accent).fill();

  doc.fontSize(8).fillColor('#8EA5C0').font('Helvetica-Bold')
    .text('GRAND TOTAL  •  INCLUSIVE OF 5% VAT', MARGIN + 20, y + 18,
      { characterSpacing: 2 });
  doc.fontSize(30).fillColor('#FFFFFF').font('Helvetica-Bold')
    .text(`AED ${formatMoney(totals.grand)}`, MARGIN + 20, y + 32);
  doc.fontSize(8).fillColor('#B5C4D9').font('Helvetica-Oblique')
    .text(`AED ${numberToWords(totals.grand)} Only`, MARGIN + 20, y + 72,
      { width: CONTENT_W - 40 });

  // Right side of hero: subtotal → margin → net → VAT → grand (mini)
  const miniX = MARGIN + CONTENT_W - 200;
  const miniRows: Array<[string, number]> = [
    ['Subtotal',              totals.subtotal],
    [`Margin (${totals.marginPct}%)`, totals.marginAmt],
    ['Net',                   totals.net],
    ['VAT (5%)',              totals.vat],
  ];
  miniRows.forEach((row, i) => {
    const ry = y + 20 + i * 13;
    doc.fontSize(7).fillColor('#8EA5C0').font('Helvetica').text(row[0], miniX, ry, { width: 100 });
    doc.fontSize(7).fillColor('#FFFFFF').font('Helvetica-Bold')
      .text(formatMoney(row[1]), miniX + 100, ry, { width: 100, align: 'right' });
  });

  y += heroH + 18;

  // ─ KPI tiles (4-up) ─
  const kpiH = 68;
  const kpiGap = 10;
  const kpiW = (CONTENT_W - kpiGap * 3) / 4;

  const totalKw = services.reduce((s, x) => s + (x.total_kw || 0), 0);
  const totalTr = services.reduce((s, x) => s + (x.tonnage || 0), 0);
  const area = project.total_area_sqft || 0;
  const costPerSqft = area > 0 ? totals.net / area : 0;

  const kpis: Array<{ label: string; value: string; hint?: string }> = [
    {
      label: 'AED / SQFT',
      value: costPerSqft > 0 ? costPerSqft.toFixed(0) : '—',
      hint:  'Net, pre-VAT',
    },
    {
      label: 'BUILT-UP AREA',
      value: area > 0 ? `${(area / 1000).toFixed(1)}k` : '—',
      hint:  area > 0 ? 'sqft' : '',
    },
    {
      label: 'HVAC CAPACITY',
      value: totalTr > 0 ? `${Math.round(totalTr)}` : '—',
      hint:  totalTr > 0 ? 'TR' : '',
    },
    {
      label: 'TOTAL LOAD',
      value: totalKw > 0 ? `${Math.round(totalKw)}` : '—',
      hint:  totalKw > 0 ? 'kW' : '',
    },
  ];

  kpis.forEach((kpi, i) => {
    const x = MARGIN + i * (kpiW + kpiGap);
    doc.roundedRect(x, y, kpiW, kpiH, 4).fillColor(BRAND.color.panel).fill();
    doc.rect(x, y, 3, kpiH).fillColor(BRAND.color.accent).fill();
    doc.fontSize(7).fillColor(BRAND.color.textMuted).font('Helvetica-Bold')
      .text(kpi.label, x + 12, y + 12, { width: kpiW - 20, characterSpacing: 1 });
    doc.fontSize(22).fillColor(BRAND.color.primary).font('Helvetica-Bold')
      .text(kpi.value, x + 12, y + 26, { width: kpiW - 20 });
    if (kpi.hint) {
      doc.fontSize(7).fillColor(BRAND.color.textSubtle).font('Helvetica')
        .text(kpi.hint, x + 12, y + 52, { width: kpiW - 20 });
    }
  });

  y += kpiH + 22;

  // ─ Service split donut + legend ─
  const panelH = 200;
  doc.roundedRect(MARGIN, y, CONTENT_W, panelH, 4)
    .fillColor('#FFFFFF').strokeColor(BRAND.color.border).lineWidth(0.6).fillAndStroke();

  doc.fontSize(9).fillColor(BRAND.color.primary).font('Helvetica-Bold')
    .text('COST DISTRIBUTION BY SERVICE', MARGIN + 16, y + 14, { characterSpacing: 1 });

  // Donut — centered in the left half
  const donutCx = MARGIN + 120;
  const donutCy = y + panelH / 2 + 6;
  const donutR  = 58;
  const donutInner = 34;

  const slices = services.map((svc, i) => ({
    value: svc.total_aed || 0,
    label: SHORT_SERVICE_LABELS[svc.service_type] || svc.service_type,
    color: BRAND.color.chartColors[i % BRAND.color.chartColors.length],
  })).filter(s => s.value > 0);

  const donutTotal = slices.reduce((s, x) => s + x.value, 0);

  if (donutTotal > 0) {
    drawDonut(doc, donutCx, donutCy, donutR, donutInner, slices);

    // Centre label
    doc.fontSize(7).fillColor(BRAND.color.textMuted).font('Helvetica-Bold')
      .text('SUBTOTAL', donutCx - 40, donutCy - 14, { width: 80, align: 'center', characterSpacing: 1 });
    doc.fontSize(11).fillColor(BRAND.color.primary).font('Helvetica-Bold')
      .text(formatMoneyShort(donutTotal), donutCx - 40, donutCy - 2, { width: 80, align: 'center' });
    doc.fontSize(6).fillColor(BRAND.color.textSubtle).font('Helvetica')
      .text('AED', donutCx - 40, donutCy + 12, { width: 80, align: 'center' });

    // Legend — right side
    const legendX = MARGIN + 240;
    const legendTop = y + 44;
    const rowH = 22;
    slices.slice(0, 7).forEach((slice, i) => {
      const ry = legendTop + i * rowH;
      // Colour chip
      doc.roundedRect(legendX, ry + 4, 10, 10, 2).fillColor(slice.color).fill();
      // Label
      doc.fontSize(9).fillColor(BRAND.color.text).font('Helvetica-Bold')
        .text(slice.label, legendX + 18, ry + 3, { width: 180, ellipsis: true });
      // Amount + percentage
      const pct = ((slice.value / donutTotal) * 100).toFixed(0);
      doc.fontSize(9).fillColor(BRAND.color.textMuted).font('Helvetica')
        .text(`AED ${formatMoney(slice.value)}`, legendX + 200, ry + 3, { width: 130, align: 'right' });
      doc.fontSize(8).fillColor(BRAND.color.accent).font('Helvetica-Bold')
        .text(`${pct}%`, legendX + 200, ry + 3, { width: 170, align: 'right' });
    });
  } else {
    doc.fontSize(9).fillColor(BRAND.color.textMuted).font('Helvetica-Oblique')
      .text('No priced services available.', MARGIN + 16, y + panelH / 2);
  }

  y += panelH + 18;

  // ─ Yardstick gauge strip ─
  if (estimation.yardstick_status) {
    const gaugeH = 56;
    doc.roundedRect(MARGIN, y, CONTENT_W, gaugeH, 4)
      .fillColor('#FFFFFF').strokeColor(BRAND.color.border).lineWidth(0.6).fillAndStroke();
    doc.fontSize(9).fillColor(BRAND.color.primary).font('Helvetica-Bold')
      .text('MARKET YARDSTICK', MARGIN + 16, y + 12, { characterSpacing: 1 });
    drawYardstickGauge(doc, MARGIN + 180, y + 16, CONTENT_W - 196, estimation.yardstick_status);
    y += gaugeH + 4;
  }
}

// ─── Chart primitives ────────────────────────────────────────────────────

function drawDonut(
  doc: PDFKit.PDFDocument,
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  slices: Array<{ value: number; color: string }>
) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total <= 0) return;

  // Start angle at top (−π/2) and sweep clockwise.
  let startAngle = -Math.PI / 2;
  for (const slice of slices) {
    const sweep = (slice.value / total) * Math.PI * 2;
    const endAngle = startAngle + sweep;
    drawAnnularSlice(doc, cx, cy, outerR, innerR, startAngle, endAngle, slice.color);
    startAngle = endAngle;
  }
}

// Draws one annular slice (outer arc + inner arc) filled with `color`.
// Uses cubic bezier approximation of the arcs — pdfkit's path API.
function drawAnnularSlice(
  doc: PDFKit.PDFDocument,
  cx: number,
  cy: number,
  R: number,
  r: number,
  a0: number,
  a1: number,
  color: string
) {
  const steps = Math.max(2, Math.ceil((a1 - a0) / (Math.PI / 8)));
  const dA = (a1 - a0) / steps;

  doc.save();
  doc.moveTo(cx + R * Math.cos(a0), cy + R * Math.sin(a0));
  // Outer arc, forward
  for (let i = 1; i <= steps; i++) {
    const a = a0 + dA * i;
    doc.lineTo(cx + R * Math.cos(a), cy + R * Math.sin(a));
  }
  // Inner arc, backward
  for (let i = steps; i >= 0; i--) {
    const a = a0 + dA * i;
    doc.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  doc.closePath();
  doc.fillColor(color).fill();
  doc.restore();
}

// Horizontal 3-zone gauge showing where the quote sits vs. market range.
// `status` is one of 'within_range' | 'below_market' | 'above_market'.
function drawYardstickGauge(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  status: string
) {
  const h = 12;
  const zoneW = width / 3;

  // Three zones: below (amber), within (green), above (amber)
  doc.rect(x, y, zoneW, h).fillColor(BRAND.color.warningLight).fill();
  doc.rect(x + zoneW, y, zoneW, h).fillColor(BRAND.color.accentLight).fill();
  doc.rect(x + zoneW * 2, y, zoneW, h).fillColor(BRAND.color.warningLight).fill();

  // Zone borders
  doc.rect(x, y, width, h).strokeColor(BRAND.color.border).lineWidth(0.6).stroke();

  // Marker position
  let markerX: number;
  switch (status) {
    case 'below_market': markerX = x + zoneW * 0.5; break;
    case 'above_market': markerX = x + zoneW * 2.5; break;
    default:             markerX = x + zoneW * 1.5; break;
  }
  // Triangle marker
  doc.save();
  doc.polygon([markerX - 5, y - 4], [markerX + 5, y - 4], [markerX, y + 2])
    .fillColor(BRAND.color.primary).fill();
  doc.rect(markerX - 1, y - 2, 2, h + 4).fillColor(BRAND.color.primary).fill();
  doc.restore();

  // Zone labels
  doc.fontSize(7).fillColor(BRAND.color.textMuted).font('Helvetica-Bold');
  doc.text('BELOW MARKET', x, y + h + 4, { width: zoneW, align: 'center', characterSpacing: 0.5 });
  doc.text('WITHIN RANGE', x + zoneW, y + h + 4, { width: zoneW, align: 'center', characterSpacing: 0.5 });
  doc.text('ABOVE MARKET', x + zoneW * 2, y + h + 4, { width: zoneW, align: 'center', characterSpacing: 0.5 });
}

// ─── Page 3: Cover Letter ────────────────────────────────────────────────
function drawCoverLetterPage(
  doc: PDFKit.PDFDocument,
  project: Project,
  quoteNo: string,
  issueDate: Date,
  validUntil: Date,
  totals: Totals,
  note: PersonalizedNote
) {
  drawHeaderBar(doc, 'COVER LETTER', quoteNo);

  let y = HEADER_BOTTOM_Y + 6;

  // Date
  doc.fontSize(10).fillColor(COLOR.text).font('Helvetica')
    .text(formatDate(issueDate), MARGIN, y, { width: CONTENT_W, align: 'right' });
  y += 30;

  // Recipient block
  doc.fontSize(10).fillColor(COLOR.textMuted).font('Helvetica-Bold').text('TO', MARGIN, y);
  y += 14;
  doc.fontSize(11).fillColor(COLOR.text).font('Helvetica-Bold')
    .text(project.client_name || 'Esteemed Client', MARGIN, y);
  y += 16;
  if (project.email_from) {
    doc.fontSize(9).fillColor(COLOR.textMuted).font('Helvetica')
      .text(`Attn: ${project.email_from}`, MARGIN, y);
    y += 12;
  }
  if (project.location) {
    doc.fontSize(9).fillColor(COLOR.textMuted).text(project.location, MARGIN, y);
    y += 12;
  }
  y += 18;

  // Subject line
  doc.fontSize(10).fillColor(COLOR.primary).font('Helvetica-Bold')
    .text('SUBJECT:', MARGIN, y, { continued: true })
    .fillColor(COLOR.text).font('Helvetica')
    .text(`  Quotation for MEP Works — ${project.project_name || 'Project'}`);
  y += 22;

  doc.fontSize(10).fillColor(COLOR.primary).font('Helvetica-Bold')
    .text('REF:', MARGIN, y, { continued: true })
    .fillColor(COLOR.text).font('Helvetica')
    .text(`  ${quoteNo}`);
  y += 28;

  // Salutation — personalized
  doc.fontSize(11).fillColor(COLOR.text).font('Helvetica').text(note.greeting, MARGIN, y);
  y += 24;

  // Body paragraphs (personalized)
  const para = (text: string) => {
    doc.fontSize(10).fillColor(COLOR.text).font('Helvetica')
      .text(text, MARGIN, y, { width: CONTENT_W, align: 'justify', lineGap: 3 });
    y = doc.y + 12;
  };

  // Opening: warm thank-you with date + RFQ subject
  para(note.opening);

  // Scope sentence + headline number stitched together
  para(
    `${note.scopeLine} The grand total — inclusive of 5% VAT — is ` +
    `AED ${formatMoney(totals.grand)}, valid until ${formatDate(validUntil)}.`
  );

  // Project context (building type, location, floors, area)
  para(note.projectContextLine);

  // Optional yardstick callout (only when within market range)
  if (note.yardstickLine) {
    para(note.yardstickLine);
  }

  // ERP Realsoft capability paragraph (static — the company introduction)
  para(
    `ERP Realsoft helps MEP estimation teams turn RFQs, drawings, specifications, and scope notes into ` +
    `structured quotation packages with clear quantities, assumptions, and pricing traceability. ` +
    `The platform supports HVAC, electrical, plumbing, fire-fighting, BMS and ELV scopes — backed by ` +
    `transparent reporting and a review-ready BOQ workflow.`
  );

  // Closing — priority-aware
  para(note.closing);

  y += 6;
  doc.fontSize(10).fillColor(COLOR.text).font('Helvetica').text('Yours sincerely,', MARGIN, y);
  y += 46;

  // Signature block
  doc.moveTo(MARGIN, y).lineTo(MARGIN + 200, y).strokeColor(COLOR.text).lineWidth(0.8).stroke();
  y += 6;
  doc.fontSize(11).fillColor(COLOR.primary).font('Helvetica-Bold').text(note.signatureName, MARGIN, y);
  y += 14;
  doc.fontSize(9).fillColor(COLOR.textMuted).font('Helvetica').text(note.signatureTitle, MARGIN, y);
  y += 11;
  doc.text(SABI.fullName, MARGIN, y);
}

// ─── Page 3: Quotation Summary ───────────────────────────────────────────
function drawSummaryPage(
  doc: PDFKit.PDFDocument,
  project: Project,
  services: Service[],
  estimation: Estimation,
  quoteNo: string,
  issueDate: Date,
  validUntil: Date,
  totals: Totals
) {
  drawHeaderBar(doc, 'QUOTATION SUMMARY', quoteNo);

  let y = HEADER_BOTTOM_Y + 6;

  // ─ TO block ─
  doc.fontSize(8).fillColor(COLOR.textSubtle).font('Helvetica-Bold').text('TO', MARGIN, y, { characterSpacing: 1 });
  y += 12;
  doc.fontSize(11).fillColor(COLOR.text).font('Helvetica-Bold')
    .text(project.client_name || 'Client', MARGIN, y);
  y += 14;
  if (project.email_from) {
    doc.fontSize(9).fillColor(COLOR.textMuted).font('Helvetica')
      .text(`Attn: ${project.email_from}`, MARGIN, y);
    y += 12;
  }
  if (project.location) {
    doc.fontSize(9).fillColor(COLOR.textMuted).text(project.location, MARGIN, y);
    y += 12;
  }
  y += 14;

  // ─ Project Details panel ─
  const panelY = y;
  const panelH = 84;
  doc.rect(MARGIN, panelY, CONTENT_W, panelH).fillColor(COLOR.panel).fill();
  doc.rect(MARGIN, panelY, 4, panelH).fillColor(COLOR.primary).fill();

  doc.fontSize(8).fillColor(COLOR.primary).font('Helvetica-Bold')
    .text('PROJECT DETAILS', MARGIN + 14, panelY + 10, { characterSpacing: 1 });

  const detailsRows: Array<[string, string, string, string]> = [
    ['Project',       project.project_name || 'N/A',                                'Quote Ref',  quoteNo],
    ['Building Type', project.building_type || 'N/A',                                'Issue Date', formatDate(issueDate)],
    ['Built-Up Area', project.total_area_sqft ? `${project.total_area_sqft.toLocaleString()} sqft` : 'N/A',
                                                                                     'Valid Until', formatDate(validUntil)],
    ['Floors',        project.floors ? `${project.floors}` : 'N/A',                  'Margin',     `${estimation.margin_percent || 15}%`],
  ];

  let dy = panelY + 26;
  detailsRows.forEach(([l1, v1, l2, v2]) => {
    doc.fontSize(8).fillColor(COLOR.textMuted).font('Helvetica-Bold').text(l1, MARGIN + 14, dy, { width: 80 });
    doc.fontSize(9).fillColor(COLOR.text).font('Helvetica').text(v1, MARGIN + 90, dy, { width: 180 });
    doc.fontSize(8).fillColor(COLOR.textMuted).font('Helvetica-Bold').text(l2, MARGIN + 286, dy, { width: 80 });
    doc.fontSize(9).fillColor(COLOR.text).font('Helvetica').text(v2, MARGIN + 360, dy, { width: 130 });
    dy += 14;
  });

  y = panelY + panelH + 18;

  // ─ Services & Pricing table ─
  doc.fontSize(10).fillColor(COLOR.primary).font('Helvetica-Bold')
    .text('SERVICES & PRICING', MARGIN, y, { characterSpacing: 1 });
  y += 16;

  // Build a properly-bordered grid table with vertical column dividers.
  // Use SHORT labels in the summary so long names like "BMS (Building
  // Management System)" don't push the next column off-axis.
  const sumCols: TableCol[] = [
    { header: '#',            width: 28,  align: 'center' },
    { header: 'MEP SERVICE',  width: 150, align: 'left'   },
    { header: 'SYSTEM TYPE',  width: 110, align: 'left'   },
    { header: 'QUANTITY',     width: 75,  align: 'center' },
    { header: 'AMOUNT (AED)', width: CONTENT_W - 28 - 150 - 110 - 75, align: 'right' },
  ];

  const sumRows: string[][] = services.map((svc, idx) => {
    const qty = svc.tonnage ? `${svc.tonnage} TR`
      : (svc.quantity ? `${svc.quantity}` : '-');
    return [
      `${idx + 1}`,
      SHORT_SERVICE_LABELS[svc.service_type] || svc.service_type,
      svc.system_type || '-',
      qty,
      formatMoney(svc.total_aed || 0),
    ];
  });

  y = drawGridTable(doc, MARGIN, y, sumCols, sumRows, { boldLastCol: true });
  y += 18;

  // ─ Totals block — proper bordered table aligned to right edge ─
  const totalsW = 280;
  const totalsLabelW = 170;
  const totalsValueW = totalsW - totalsLabelW;
  const totalsX = MARGIN + CONTENT_W - totalsW;
  const totalRowH = 22;

  const drawTotalRow = (label: string, value: number, bold = false, fillBg?: string) => {
    if (fillBg) {
      doc.rect(totalsX, y, totalsW, totalRowH).fillColor(fillBg).fill();
    }
    doc.fontSize(10).fillColor(COLOR.text).font(bold ? 'Helvetica-Bold' : 'Helvetica')
      .text(label, totalsX + 12, y + 7, { width: totalsLabelW - 16 });
    doc.fontSize(10).fillColor(COLOR.text).font(bold ? 'Helvetica-Bold' : 'Helvetica')
      .text(formatMoney(value), totalsX + totalsLabelW, y + 7,
        { width: totalsValueW - 12, align: 'right' });
    // Row border
    doc.rect(totalsX, y, totalsW, totalRowH).strokeColor(COLOR.border).lineWidth(0.4).stroke();
    // Vertical divider between label and value
    doc.moveTo(totalsX + totalsLabelW, y).lineTo(totalsX + totalsLabelW, y + totalRowH)
      .strokeColor(COLOR.border).lineWidth(0.4).stroke();
    y += totalRowH;
  };

  drawTotalRow('Subtotal', totals.subtotal);
  drawTotalRow(`Margin (${totals.marginPct}%)`, totals.marginAmt);
  drawTotalRow('Net Amount', totals.net, true, COLOR.panel);
  drawTotalRow(`VAT (${(VAT_RATE * 100).toFixed(0)}%)`, totals.vat);

  // Grand total bar — same column geometry as the rows above
  const grandH = 32;
  doc.rect(totalsX, y, totalsW, grandH).fillColor(COLOR.primary).fill();
  // Inner accent stripe at top
  doc.rect(totalsX, y, totalsW, 3).fillColor(COLOR.accent).fill();

  doc.fontSize(11).fillColor('#FFFFFF').font('Helvetica-Bold')
    .text('GRAND TOTAL (AED)', totalsX + 12, y + 11,
      { width: totalsLabelW - 16, characterSpacing: 0.5 });
  doc.fontSize(14).fillColor('#FFFFFF').font('Helvetica-Bold')
    .text(formatMoney(totals.grand), totalsX + totalsLabelW, y + 10,
      { width: totalsValueW - 12, align: 'right' });
  y += grandH + 8;

  // Amount in words
  doc.fontSize(9).fillColor(COLOR.text).font('Helvetica-Bold').text('Amount in Words:', MARGIN, y);
  y += 12;
  doc.fontSize(9).fillColor(COLOR.primary).font('Helvetica-Oblique')
    .text(`AED ${numberToWords(totals.grand)} Only`, MARGIN, y, { width: CONTENT_W });
  y += 28;

  // "How to read this document" hint
  doc.fontSize(8).fillColor(COLOR.textMuted).font('Helvetica-Oblique')
    .text(
      `Component-level breakdowns for each service follow on the next ${services.length} ` +
      `page${services.length === 1 ? '' : 's'}. ` +
      `Terms & conditions and assumptions are included at the end of this document.`,
      MARGIN, y, { width: CONTENT_W, align: 'center' }
    );
  y += 30;

  // Signature blocks
  const sigY = Math.min(y, A4_H - 130);
  doc.fontSize(9).fillColor(COLOR.primary).font('Helvetica-Bold');
  doc.text('PREPARED BY', MARGIN, sigY, { characterSpacing: 1 });
  doc.text('APPROVED BY', MARGIN + CONTENT_W / 2, sigY, { characterSpacing: 1 });

  doc.moveTo(MARGIN, sigY + 36).lineTo(MARGIN + 200, sigY + 36).strokeColor(COLOR.text).stroke();
  doc.moveTo(MARGIN + CONTENT_W / 2, sigY + 36).lineTo(MARGIN + CONTENT_W / 2 + 200, sigY + 36).stroke();

  doc.fontSize(10).fillColor(COLOR.text).font('Helvetica-Bold')
    .text('Estimation Department', MARGIN, sigY + 42);
  doc.text('George Varkey M', MARGIN + CONTENT_W / 2, sigY + 42);

  doc.fontSize(8).fillColor(COLOR.textMuted).font('Helvetica')
    .text(SABI.name + ' Team', MARGIN, sigY + 56);
  doc.text('Company Owner', MARGIN + CONTENT_W / 2, sigY + 56);
}

// ─── Pages 4..N: Per-Service Detail ──────────────────────────────────────
function drawServiceDetailPage(
  doc: PDFKit.PDFDocument,
  svc: Service,
  index: number,
  total: number,
  quoteNo: string
) {
  const fullLabel = SERVICE_LABELS[svc.service_type] || svc.service_type;
  drawHeaderBar(doc, `SERVICE ${index} OF ${total}  •  ${fullLabel.toUpperCase()}`, quoteNo);

  let y = HEADER_BOTTOM_Y + 4;

  // ─ Service info strip — clean 2-column layout with vertical divider ─
  // Left zone holds the title + system info; right zone holds the subtotal.
  // Geometry is locked so the two halves cannot collide.
  const stripH = 76;
  const leftZoneW = Math.round(CONTENT_W * 0.62);
  const rightZoneW = CONTENT_W - leftZoneW;
  const leftZoneX = MARGIN;
  const rightZoneX = MARGIN + leftZoneW;

  // Background panel
  doc.rect(MARGIN, y, CONTENT_W, stripH).fillColor(COLOR.panel).fill();
  // Left accent stripe
  doc.rect(MARGIN, y, 4, stripH).fillColor(COLOR.accent).fill();
  // Vertical divider between left and right zones
  doc.moveTo(rightZoneX, y + 10).lineTo(rightZoneX, y + stripH - 10)
    .strokeColor(COLOR.border).lineWidth(0.6).stroke();
  // Outer border
  doc.rect(MARGIN, y, CONTENT_W, stripH).strokeColor(COLOR.primary).lineWidth(1).stroke();

  // ─ LEFT ZONE: title + system info ─
  const leftPad = 16;
  const leftTextX = leftZoneX + leftPad;
  const leftTextW = leftZoneW - leftPad - 12;

  // Tiny label
  doc.fontSize(8).fillColor(COLOR.accent).font('Helvetica-Bold')
    .text('MEP SERVICE', leftTextX, y + 10, { width: leftTextW, characterSpacing: 1.5 });

  // Service title — width clamped to left zone, can NOT overflow into right zone
  doc.fontSize(15).fillColor(COLOR.primary).font('Helvetica-Bold')
    .text(fullLabel, leftTextX, y + 22, { width: leftTextW, ellipsis: true });

  // Sub-info row (System / KW / TR or Quantity / Rate)
  const subInfo: string[] = [];
  if (svc.system_type) subInfo.push(`System: ${titleCaseSystemType(svc.system_type)}`);
  if (svc.service_type === 'hvac') {
    if (svc.total_kw)   subInfo.push(`Total: ${svc.total_kw} kW`);
    if (svc.fahu_kw)    subInfo.push(`FAHU: ${svc.fahu_kw} kW`);
    if (svc.ac_unit_kw) subInfo.push(`AC Units: ${svc.ac_unit_kw} kW`);
    if (svc.tonnage)    subInfo.push(`Capacity: ${svc.tonnage} TR`);
  } else {
    if (svc.quantity)   subInfo.push(`Quantity: ${svc.quantity}`);
    if (svc.unit_rate_aed) subInfo.push(`Unit Rate: AED ${formatMoney(svc.unit_rate_aed)}`);
  }
  if (subInfo.length > 0) {
    doc.fontSize(8).fillColor(COLOR.textMuted).font('Helvetica')
      .text(subInfo.join('  •  '), leftTextX, y + 50, {
        width: leftTextW,
        ellipsis: true,
      });
  }

  // ─ RIGHT ZONE: subtotal label + big number ─
  const rightPad = 16;
  const rightTextX = rightZoneX + rightPad;
  const rightTextW = rightZoneW - rightPad * 2;

  doc.fontSize(8).fillColor(COLOR.textMuted).font('Helvetica-Bold')
    .text('SUBTOTAL (AED)', rightTextX, y + 14, {
      width: rightTextW,
      align: 'right',
      characterSpacing: 1.5,
    });

  // Auto-fit the big number — drop one font size if the value is very large
  // (8-digit amounts can overflow the right zone at 18pt).
  const subtotalStr = formatMoney(svc.total_aed || 0);
  const bigFontSize = subtotalStr.length > 12 ? 16 : 18;
  doc.fontSize(bigFontSize).fillColor(COLOR.primary).font('Helvetica-Bold')
    .text(subtotalStr, rightTextX, y + 32, {
      width: rightTextW,
      align: 'right',
    });

  doc.fontSize(7).fillColor(COLOR.textSubtle).font('Helvetica')
    .text('inclusive of margin, exclusive of VAT', rightTextX, y + 56, {
      width: rightTextW,
      align: 'right',
    });

  y += stripH + 14;

  // ─ Derivation lineage chip ─
  // One-liner showing how the subtotal was calculated, so the client can
  // audit the math without reading the component table. Sources pull from
  // service extraction fields.
  const lineage = buildLineageLine(svc);
  if (lineage) {
    const chipH = 28;
    doc.roundedRect(MARGIN, y, CONTENT_W, chipH, 4)
      .fillColor(BRAND.color.accentLight).strokeColor(BRAND.color.accent).lineWidth(0.8).fillAndStroke();
    doc.fontSize(7).fillColor(BRAND.color.accent).font('Helvetica-Bold')
      .text('DERIVATION', MARGIN + 12, y + 6, { characterSpacing: 1.5 });
    doc.fontSize(9).fillColor(BRAND.color.text).font('Helvetica')
      .text(lineage, MARGIN + 90, y + 9, { width: CONTENT_W - 100, ellipsis: true });
    y += chipH + 12;
  } else {
    y += 8;
  }

  // ─ Breakdown table title ─
  doc.fontSize(10).fillColor(COLOR.primary).font('Helvetica-Bold')
    .text('COMPONENT BREAKDOWN', MARGIN, y, { characterSpacing: 1 });
  y += 16;

  const items = expandServiceToLineItems(svc);

  if (items.length === 0) {
    doc.rect(MARGIN, y, CONTENT_W, 36).fillColor(COLOR.panel).fill();
    doc.rect(MARGIN, y, CONTENT_W, 36).strokeColor(COLOR.border).lineWidth(0.4).stroke();
    doc.fontSize(9).fillColor(COLOR.textMuted).font('Helvetica-Oblique')
      .text('No detailed breakdown available for this service.', MARGIN, y + 13,
        { width: CONTENT_W, align: 'center' });
    y += 44;
  } else {
    // Build a properly-bordered grid for the breakdown
    const breakdownCols: TableCol[] = [
      { header: '#',           width: 28,  align: 'center' },
      { header: 'DESCRIPTION', width: CONTENT_W - 28 - 50 - 50 - 95 - 105, align: 'left' },
      { header: 'UNIT',        width: 50,  align: 'center' },
      { header: 'QTY',         width: 50,  align: 'center' },
      { header: 'RATE (AED)',  width: 95,  align: 'right' },
      { header: 'TOTAL (AED)', width: 105, align: 'right' },
    ];

    // Page-break aware: drawGridTable is single-shot, so we slice items into
    // page-sized chunks. Each chunk gets its own table with its own header.
    let remaining = items.map((item, idx) => [
      `${idx + 1}`,
      item.description,
      item.unit,
      `${item.quantity}`,
      formatMoney(item.unit_rate_aed),
      formatMoney(item.total_aed),
    ]);

    while (remaining.length > 0) {
      const rowH = 26;
      const headerH = 26;
      // Reserve room for the service total bar (38) + a 30pt footer cushion
      const reserved = 38 + 30;
      const availableH = PAGE_CONTENT_BOTTOM - y - reserved;
      const rowsThatFit = Math.max(1, Math.floor((availableH - headerH) / rowH));
      const chunk = remaining.slice(0, rowsThatFit);
      remaining = remaining.slice(rowsThatFit);

      y = drawGridTable(doc, MARGIN, y, breakdownCols, chunk, {
        rowH,
        headerH,
        boldLastCol: true,
      });

      if (remaining.length > 0) {
        doc.addPage();
        drawHeaderBar(doc, `${fullLabel.toUpperCase()} (CONTINUED)`, quoteNo);
        y = HEADER_BOTTOM_Y + 4;
        doc.fontSize(10).fillColor(COLOR.primary).font('Helvetica-Bold')
          .text('COMPONENT BREAKDOWN (CONTINUED)', MARGIN, y, { characterSpacing: 1 });
        y += 16;
      }
    }
  }

  // ─ Service total bar ─
  y += 10;
  if (y + 38 > PAGE_CONTENT_BOTTOM - 30) {
    doc.addPage();
    drawHeaderBar(doc, `${fullLabel.toUpperCase()} (CONTINUED)`, quoteNo);
    y = HEADER_BOTTOM_Y + 4;
  }

  const subBarH = 36;
  doc.rect(MARGIN, y, CONTENT_W, subBarH).fillColor(COLOR.primary).fill();
  doc.rect(MARGIN, y, CONTENT_W, 3).fillColor(COLOR.accent).fill();
  doc.fontSize(11).fillColor('#FFFFFF').font('Helvetica-Bold')
    .text(`${fullLabel.toUpperCase()} SUBTOTAL`, MARGIN + 14, y + 13,
      { width: CONTENT_W * 0.6, characterSpacing: 1 });
  doc.fontSize(15).fillColor('#FFFFFF').font('Helvetica-Bold')
    .text(`AED ${formatMoney(svc.total_aed || 0)}`,
      MARGIN + CONTENT_W * 0.5, y + 11,
      { width: CONTENT_W * 0.5 - 14, align: 'right' });
  y += subBarH + 12;

  // Note
  doc.fontSize(8).fillColor(COLOR.textMuted).font('Helvetica-Oblique')
    .text(
      `Component values above are derived using industry-standard MEP cost ratios. ` +
      `Final pricing is rolled up into the Quotation Summary on the previous page.`,
      MARGIN, y, { width: CONTENT_W, align: 'center' }
    );
}

// ─── Drawing References Page ─────────────────────────────────────────────
// Card grid — each source document gets a framed tile with a type badge,
// filename, discipline chip, and file size. Paginates automatically.
function drawDrawingReferencesPage(
  doc: PDFKit.PDFDocument,
  attachments: Attachment[],
  quoteNo: string
) {
  drawHeaderBar(doc, 'DRAWING REFERENCES', quoteNo);

  let y = HEADER_BOTTOM_Y + 4;

  doc.fontSize(9).fillColor(COLOR.textMuted).font('Helvetica')
    .text(
      'The following source drawings, schedules, and documents form the basis of this estimate. ' +
      'Should any of these be revised, the corresponding line items in this quotation may need to be updated.',
      MARGIN, y, { width: CONTENT_W, align: 'left', lineGap: 2 }
    );
  y = doc.y + 16;

  const cardH = 78;
  const cardGap = 10;
  const cardW = (CONTENT_W - cardGap) / 2;
  let gridTop = y;
  let cardIdx = 0;

  for (let i = 0; i < attachments.length; i++) {
    const col = cardIdx % 2;
    const row = Math.floor(cardIdx / 2);
    const cardX = MARGIN + col * (cardW + cardGap);
    const cardY = gridTop + row * (cardH + cardGap);

    if (cardY + cardH > PAGE_CONTENT_BOTTOM - 30) {
      doc.addPage();
      drawHeaderBar(doc, 'DRAWING REFERENCES (CONTINUED)', quoteNo);
      gridTop = HEADER_BOTTOM_Y + 4;
      cardIdx = 0;
      i--;
      continue;
    }

    drawDrawingCard(doc, cardX, cardY, cardW, cardH, attachments[i], i);
    cardIdx++;
  }
}

function drawDrawingCard(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  h: number,
  att: Attachment,
  idx: number
) {
  // Card background
  doc.roundedRect(x, y, w, h, 4)
    .fillColor('#FFFFFF').strokeColor(BRAND.color.border).lineWidth(0.6).fillAndStroke();
  doc.rect(x, y, 3, h).fillColor(BRAND.color.accent).fill();

  // Type badge — coloured square with the file extension
  const iconSize = 46;
  const iconX = x + 14;
  const iconY = y + (h - iconSize) / 2;
  const extension = (att.filename || '').split('.').pop()?.toUpperCase().slice(0, 4) || '—';

  doc.roundedRect(iconX, iconY, iconSize, iconSize, 4)
    .fillColor(BRAND.color.primaryLight).fill();
  doc.fontSize(11).fillColor(BRAND.color.primary).font('Helvetica-Bold')
    .text(extension, iconX, iconY + iconSize / 2 - 5, { width: iconSize, align: 'center' });
  doc.fontSize(6).fillColor(BRAND.color.textMuted).font('Helvetica')
    .text(`#${idx + 1}`, iconX + 4, iconY + 4, { width: iconSize - 8, align: 'right' });

  // Text area right of icon
  const tx = iconX + iconSize + 12;
  const tw = x + w - tx - 12;

  doc.fontSize(9).fillColor(BRAND.color.primary).font('Helvetica-Bold')
    .text(att.filename || '-', tx, y + 12, { width: tw, ellipsis: true });

  doc.fontSize(7).fillColor(BRAND.color.textMuted).font('Helvetica')
    .text(friendlyFileType((att as any).file_type), tx, y + 26, { width: tw });

  // Discipline tag (bottom-left)
  const discipline = titleCase((att as any).discipline);
  if (discipline && discipline !== '-') {
    doc.fontSize(7).font('Helvetica-Bold');
    const tagW = Math.min(doc.widthOfString(discipline.toUpperCase()) + 14, tw * 0.6);
    doc.roundedRect(tx, y + h - 22, tagW, 14, 7)
      .fillColor(BRAND.color.accentLight).fill();
    doc.fillColor(BRAND.color.accent)
      .text(discipline.toUpperCase(), tx, y + h - 18, { width: tagW, align: 'center', characterSpacing: 0.8 });
  }

  // File size (bottom-right)
  const sizeBytes = (att as any).size_bytes;
  if (sizeBytes) {
    doc.fontSize(7).fillColor(BRAND.color.textSubtle).font('Helvetica')
      .text(humanFileSize(sizeBytes), tx, y + h - 18, { width: tw, align: 'right' });
  }
}

function humanFileSize(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024)      return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

// ─── Terms & Conditions ──────────────────────────────────────────────────
// Two-column compact T&C layout + full-width client acceptance block with
// optional QR code linking back to the live bid.
function drawTermsPage(doc: PDFKit.PDFDocument, quoteNo: string, qrPng?: Buffer | null, bidUrl?: string) {
  drawHeaderBar(doc, 'TERMS & CONDITIONS', quoteNo);

  let y = HEADER_BOTTOM_Y + 4;

  const terms: Array<[string, string]> = [
    ['Validity',          `Valid for ${QUOTE_VALIDITY_DAYS} days from the issue date. Prices may be revised thereafter.`],
    ['Payment Terms',     '50% advance with PO. 40% on progress milestones. 10% retention against handover.'],
    ['Currency',          'All prices quoted in UAE Dirhams (AED).'],
    ['VAT',               '5% VAT per UAE Federal Tax Authority regulations, included in the Grand Total.'],
    ['Delivery Period',   'Per agreed schedule. Imported equipment lead times: 8–12 weeks typical.'],
    ['Warranty',          '12 months from handover, against manufacturing defects. Excludes wear-and-tear.'],
    ['Variations',        'Any variation to scope or specification quoted separately, with prior written approval.'],
    ['Insurance',         'Public Liability and Contractor\'s All Risk (CAR) insurance included throughout works.'],
    ['Force Majeure',     'Neither party liable for delays arising from circumstances beyond reasonable control.'],
    ['Disputes',          'Disputes resolved amicably; failing which, subject to the courts of Dubai, UAE.'],
    ['Authority Approvals','Statutory approvals (DEWA, Civil Defence, Municipality) by main contractor unless stated.'],
    ['Site Access',       'Site access during normal hours (Sun–Thu, 08:00–18:00). After-hours by agreement.'],
  ];

  // Two-column rendering
  const gutter = 16;
  const colW = (CONTENT_W - gutter) / 2;
  const mid = Math.ceil(terms.length / 2);
  const leftItems  = terms.slice(0, mid);
  const rightItems = terms.slice(mid);

  const termTop = y;
  let ly = termTop;
  let ry = termTop;

  const drawTerm = (col: 'left' | 'right', idx: number, label: string, text: string, startY: number): number => {
    const x = col === 'left' ? MARGIN : MARGIN + colW + gutter;
    // Number bubble
    doc.circle(x + 9, startY + 9, 9).fillColor(BRAND.color.primary).fill();
    doc.fontSize(8).fillColor('#FFFFFF').font('Helvetica-Bold')
      .text(`${idx + 1}`, x, startY + 4, { width: 18, align: 'center' });
    // Label
    doc.fontSize(9).fillColor(BRAND.color.primary).font('Helvetica-Bold')
      .text(label, x + 24, startY + 2, { width: colW - 28 });
    // Body
    doc.fontSize(8).fillColor(BRAND.color.text).font('Helvetica')
      .text(text, x + 24, startY + 14, { width: colW - 28, lineGap: 1 });
    const h = doc.heightOfString(text, { width: colW - 28, lineGap: 1 });
    return startY + Math.max(h + 14, 30) + 8;
  };

  leftItems.forEach((t, i) => { ly = drawTerm('left', i, t[0], t[1], ly); });
  rightItems.forEach((t, i) => { ry = drawTerm('right', i + mid, t[0], t[1], ry); });

  y = Math.max(ly, ry) + 14;

  // Acceptance block (full width, always fits because T&C is now compact)
  if (y + 130 > PAGE_CONTENT_BOTTOM) {
    doc.addPage();
    drawHeaderBar(doc, 'CLIENT ACCEPTANCE', quoteNo);
    y = HEADER_BOTTOM_Y + 4;
  }
  doc.rect(MARGIN, y, CONTENT_W, 26).fillColor(BRAND.color.accent).fill();
  doc.fontSize(11).fillColor('#FFFFFF').font('Helvetica-Bold')
    .text('CLIENT ACCEPTANCE', MARGIN + 12, y + 8, { characterSpacing: 1 });
  y += 36;

  const qrSize = 90;
  const linesRight = qrPng ? MARGIN + CONTENT_W - qrSize - 16 : MARGIN + CONTENT_W;
  const acceptanceTop = y;

  doc.fontSize(9).fillColor(BRAND.color.text).font('Helvetica');
  ['Name', 'Designation', 'Signature', 'Date', 'Company Stamp'].forEach(label => {
    doc.fillColor(BRAND.color.textMuted).font('Helvetica-Bold').text(label, MARGIN, y, { width: 100 });
    doc.moveTo(MARGIN + 110, y + 10).lineTo(linesRight, y + 10)
      .strokeColor(BRAND.color.border).lineWidth(0.5).stroke();
    y += 22;
  });

  if (qrPng) {
    const qrX = MARGIN + CONTENT_W - qrSize;
    const qrY = acceptanceTop;
    // Frame around QR
    doc.roundedRect(qrX - 6, qrY - 6, qrSize + 12, qrSize + 24, 4)
      .fillColor('#FFFFFF').strokeColor(BRAND.color.border).lineWidth(0.6).fillAndStroke();
    doc.image(qrPng, qrX, qrY, { width: qrSize, height: qrSize });
    doc.fontSize(7).fillColor(BRAND.color.textMuted).font('Helvetica-Bold')
      .text('SCAN TO VIEW BID', qrX, qrY + qrSize + 4, { width: qrSize, align: 'center', characterSpacing: 0.8 });
    void bidUrl; // URL is already encoded in the QR
  }
}

// ─── Assumptions & Exclusions ────────────────────────────────────────────
// Two-column layout: INCLUDED (✓ accent) on the left, EXCLUDED (✗ warning)
// on the right. Easier to scan side-by-side than a long single column.
function drawExclusionsPage(doc: PDFKit.PDFDocument, quoteNo: string) {
  drawHeaderBar(doc, 'ASSUMPTIONS & EXCLUSIONS', quoteNo);

  let y = HEADER_BOTTOM_Y + 4;

  // Intro strip
  doc.fontSize(9).fillColor(COLOR.textMuted).font('Helvetica')
    .text(
      'This page clarifies what is and isn\'t covered by the quotation. Items marked ✓ are included in the ' +
      'priced scope; items marked ✗ are explicitly excluded and would require a separate line item.',
      MARGIN, y, { width: CONTENT_W, lineGap: 2, align: 'left' }
    );
  y = doc.y + 16;

  const assumptions = [
    'All MEP works carried out per approved drawings, specifications, and equipment schedules.',
    'Site ready and accessible during normal working hours (Sun–Thu, 08:00–18:00).',
    'Power, water, scaffolding, and temporary storage provided by the main contractor.',
    'Civil cutting, chasing, core-drilling, and making-good by the main contractor.',
    'Existing services assumed to be in good working condition.',
    'Equipment specifications as per the approved vendor list and equipment schedule.',
    'Standard manufacturer lead times apply for imported equipment (8–12 weeks).',
    'Material rates valid as of the quotation issue date.',
    'False ceiling, floor finishes, and architectural penetrations coordinated with main contractor.',
    'Working drawings, shop drawings, and as-built drawings included in scope.',
  ];

  const exclusions = [
    'Civil works, structural modifications, false ceilings, and architectural finishes.',
    'Building permits, NOC fees, DEWA connection charges, and authority approval fees.',
    'Builder\'s Work in Connection (BWIC) — cutting, chasing, making-good of structural elements.',
    'Statutory and regulatory inspection charges.',
    'Furniture, Fixtures, and Equipment (FF&E) and loose appliances.',
    'Extra Low Voltage (ELV) systems unless specifically listed in the BOQ.',
    'External works, site development, and works beyond the building footprint.',
    'Testing & commissioning of third-party equipment.',
    'Operation & Maintenance (O&M) contract beyond the warranty period.',
    'Spare parts beyond the manufacturer\'s standard first-fill set.',
    'Any items not explicitly listed in the BOQ or specifications.',
  ];

  const gutter = 16;
  const colW = (CONTENT_W - gutter) / 2;
  const leftX = MARGIN;
  const rightX = MARGIN + colW + gutter;

  // Two column headers
  drawSectionHeader(doc, leftX,  y, colW, 'ASSUMPTIONS  ✓ INCLUDED',       BRAND.color.accent);
  drawSectionHeader(doc, rightX, y, colW, 'EXCLUSIONS  ✗ NOT INCLUDED',    BRAND.color.warning);
  y += 32;

  const leftTop = y;
  let ly = y;
  let ry = y;

  assumptions.forEach((item) => {
    ly = drawCheckItem(doc, leftX, ly, colW, item, BRAND.color.accent, '✓');
  });

  exclusions.forEach((item) => {
    ry = drawCheckItem(doc, rightX, ry, colW, item, BRAND.color.warning, '✗');
  });

  // Suppress unused var warning
  void leftTop;
}

// One bulleted item — a small coloured tile with a check/x, then the text.
function drawCheckItem(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  text: string,
  color: string,
  mark: string
): number {
  const markSize = 14;
  const textX = x + markSize + 8;
  const textW = w - markSize - 8;

  // Little coloured square marker
  doc.roundedRect(x, y + 1, markSize, markSize, 2).fillColor(color).fill();
  doc.fontSize(9).fillColor('#FFFFFF').font('Helvetica-Bold')
    .text(mark, x, y + 2, { width: markSize, align: 'center' });

  doc.fontSize(8.5).fillColor(BRAND.color.text).font('Helvetica')
    .text(text, textX, y + 2, { width: textW, lineGap: 1 });
  const h = doc.heightOfString(text, { width: textW, lineGap: 1 });
  return y + Math.max(h, markSize) + 8;
}

// Simple flat pill-style section header used on this page.
function drawSectionHeader(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  label: string,
  color: string
) {
  doc.roundedRect(x, y, w, 22, 3).fillColor(color).fill();
  doc.fontSize(9).fillColor('#FFFFFF').font('Helvetica-Bold')
    .text(label, x + 12, y + 7, { width: w - 24, characterSpacing: 1 });
}

// ─── Header / Footer helpers ─────────────────────────────────────────────
function drawHeaderBar(doc: PDFKit.PDFDocument, title: string, quoteNo: string) {
  // Top accent strip
  doc.rect(0, 0, A4_W, 6).fillColor(COLOR.primary).fill();
  doc.rect(0, 6, A4_W, 2).fillColor(COLOR.accent).fill();

  // SABI brand on left
  doc.fontSize(14).fillColor(COLOR.primary).font('Helvetica-Bold')
    .text(SABI.name, MARGIN, 22);

  doc.fontSize(8).fillColor(COLOR.textMuted).font('Helvetica')
    .text(SABI.fullName, MARGIN, 40);

  // Quote ref on right
  if (quoteNo) {
    doc.fontSize(8).fillColor(COLOR.textMuted).font('Helvetica-Bold')
      .text('QUOTE REF', MARGIN, 22, { width: CONTENT_W, align: 'right', characterSpacing: 1 });
    doc.fontSize(9).fillColor(COLOR.primary).font('Helvetica-Bold')
      .text(quoteNo, MARGIN, 36, { width: CONTENT_W, align: 'right' });
  }

  // Divider
  doc.moveTo(MARGIN, 64).lineTo(A4_W - MARGIN, 64)
    .strokeColor(COLOR.border).lineWidth(0.8).stroke();

  // Section title
  doc.fontSize(13).fillColor(COLOR.primary).font('Helvetica-Bold')
    .text(title, MARGIN, 78, { width: CONTENT_W, align: 'center', characterSpacing: 2 });
}

function stampFootersAndPageNumbers(doc: PDFKit.PDFDocument, quoteNo: string, projectName?: string, isDraft?: boolean) {
  const range = doc.bufferedPageRange();
  const total = range.count;
  for (let i = 0; i < total; i++) {
    doc.switchToPage(i);

    if (isDraft) {
      doc.save();
      doc.rotate(-30, { origin: [A4_W / 2, A4_H / 2] });
      doc.fontSize(96).fillColor(COLOR.warning).opacity(0.12).font('Helvetica-Bold')
        .text('DRAFT', 0, A4_H / 2 - 60, { width: A4_W, align: 'center' });
      doc.opacity(1);
      doc.restore();
    }

    // Skip the cover page — it has its own bottom contact bar
    if (i === 0) continue;

    const footerY = A4_H - 38;
    // Thin divider above footer
    doc.moveTo(MARGIN, footerY).lineTo(A4_W - MARGIN, footerY)
      .strokeColor(COLOR.border).lineWidth(0.5).stroke();

    doc.fontSize(7).fillColor(COLOR.textSubtle).font('Helvetica')
      .text(projectName ? `${SABI.fullName}  •  ${projectName}` : SABI.fullName,
        MARGIN, footerY + 8, { width: CONTENT_W * 0.4, align: 'left' });

    doc.fontSize(7).fillColor(COLOR.textSubtle).font('Helvetica')
      .text(`${quoteNo}  •  ${SABI.email}`,
        MARGIN + CONTENT_W * 0.2, footerY + 8, { width: CONTENT_W * 0.6, align: 'center' });

    doc.fontSize(7).fillColor(COLOR.textSubtle).font('Helvetica-Bold')
      .text(`Page ${i + 1} of ${total}`,
        MARGIN, footerY + 8, { width: CONTENT_W, align: 'right' });

    doc.fontSize(6).fillColor(COLOR.textSubtle).font('Helvetica')
      .text(`Generated by realsoft.example  •  TRN: ${SABI.trn}`,
        MARGIN, footerY + 20, { width: CONTENT_W, align: 'center' });
  }
}

// ─── Reusable bordered grid table ─────────────────────────────────────────
interface TableCol {
  header: string;
  width: number;
  align?: 'left' | 'center' | 'right';
}

interface GridTableOptions {
  rowH?: number;
  headerH?: number;
  fontSize?: number;
  headerFontSize?: number;
  /** When true, the rightmost column renders in bold (used for amount columns) */
  boldLastCol?: boolean;
  /** Padding on left + right of each cell */
  cellPadX?: number;
}

/**
 * Draws a clean bordered table at (x, startY). Returns the y coordinate
 * immediately below the bottom border so callers can continue the layout.
 *
 * Features:
 *   - Primary-color header row with bold white labels
 *   - Vertical column dividers (light grey, hairline)
 *   - Horizontal row borders
 *   - Zebra striping on alternating rows
 *   - Outer border slightly thicker than inner gridlines
 */
function drawGridTable(
  doc: PDFKit.PDFDocument,
  x: number,
  startY: number,
  cols: TableCol[],
  rows: string[][],
  opts: GridTableOptions = {}
): number {
  const rowH = opts.rowH ?? 26;
  const headerH = opts.headerH ?? 26;
  const fontSize = opts.fontSize ?? 9;
  const headerFontSize = opts.headerFontSize ?? 9;
  const padX = opts.cellPadX ?? 8;
  const boldLastCol = opts.boldLastCol ?? false;

  const totalW = cols.reduce((s, c) => s + c.width, 0);
  // Pre-compute the left edge of each column (for cell content + dividers)
  const colX: number[] = [];
  let cursor = x;
  for (const c of cols) { colX.push(cursor); cursor += c.width; }

  let y = startY;

  // ─ Header row ─
  doc.rect(x, y, totalW, headerH).fillColor(COLOR.primary).fill();
  doc.fontSize(headerFontSize).fillColor('#FFFFFF').font('Helvetica-Bold');
  cols.forEach((c, i) => {
    doc.text(c.header, colX[i] + padX, y + (headerH - headerFontSize) / 2 - 1, {
      width: c.width - padX * 2,
      align: c.align || 'left',
    });
  });
  // Header bottom rule (accent color, thicker)
  doc.moveTo(x, y + headerH).lineTo(x + totalW, y + headerH)
    .strokeColor(COLOR.accent).lineWidth(1.5).stroke();
  y += headerH;

  // ─ Body rows ─
  rows.forEach((row, rowIdx) => {
    // Zebra stripe
    if (rowIdx % 2 === 1) {
      doc.rect(x, y, totalW, rowH).fillColor(COLOR.rowAlt).fill();
    }

    cols.forEach((c, colIdx) => {
      const isLast = colIdx === cols.length - 1;
      const useBold = boldLastCol && isLast;
      doc.fontSize(fontSize).fillColor(COLOR.text).font(useBold ? 'Helvetica-Bold' : 'Helvetica')
        .text(row[colIdx] ?? '', colX[colIdx] + padX, y + (rowH - fontSize) / 2 - 1, {
          width: c.width - padX * 2,
          align: c.align || 'left',
          ellipsis: true,
        });
    });

    // Row bottom border (hairline)
    doc.moveTo(x, y + rowH).lineTo(x + totalW, y + rowH)
      .strokeColor(COLOR.border).lineWidth(0.4).stroke();

    y += rowH;
  });

  // ─ Vertical column dividers (full height of the body, hairline) ─
  const bodyTop = startY + headerH;
  const bodyBottom = y;
  for (let i = 1; i < cols.length; i++) {
    doc.moveTo(colX[i], bodyTop).lineTo(colX[i], bodyBottom)
      .strokeColor(COLOR.border).lineWidth(0.4).stroke();
  }

  // ─ Outer border (full table height, slightly thicker) ─
  doc.rect(x, startY, totalW, y - startY)
    .strokeColor(COLOR.primary).lineWidth(1).stroke();

  return y;
}

// ─── Drawing helpers ──────────────────────────────────────────────────────
function drawCenteredChips(doc: PDFKit.PDFDocument, labels: string[], y: number) {
  if (labels.length === 0) return;

  doc.fontSize(9).font('Helvetica-Bold');
  const padX = 12;
  const gap = 8;
  const widths = labels.map(l => doc.widthOfString(l) + padX * 2);
  // Wrap into lines so total width per line ≤ CONTENT_W
  const lines: number[][] = [[]];
  let lineWidth = 0;
  widths.forEach((w, i) => {
    const projected = lineWidth + (lines[lines.length - 1].length > 0 ? gap : 0) + w;
    if (projected > CONTENT_W && lines[lines.length - 1].length > 0) {
      lines.push([i]);
      lineWidth = w;
    } else {
      lines[lines.length - 1].push(i);
      lineWidth = projected;
    }
  });

  const chipH = 22;
  let cy = y;
  for (const line of lines) {
    const lineW = line.reduce((s, i, k) => s + widths[i] + (k > 0 ? gap : 0), 0);
    let cx = MARGIN + (CONTENT_W - lineW) / 2;
    for (const i of line) {
      doc.roundedRect(cx, cy, widths[i], chipH, 11).fillColor(COLOR.primaryLight).fill();
      doc.fontSize(9).fillColor(COLOR.primary).font('Helvetica-Bold')
        .text(labels[i], cx, cy + 6, { width: widths[i], align: 'center' });
      cx += widths[i] + gap;
    }
    cy += chipH + 8;
  }
}

// ─── Utility helpers ──────────────────────────────────────────────────────
function generateQuoteNumber(projectId: string, date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const suffix = projectId.replace(/-/g, '').slice(-4).toUpperCase();
  return `RS-${yyyy}${mm}${dd}-${suffix}`;
}

function formatDate(d: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${String(d.getDate()).padStart(2, '0')}-${months[d.getMonth()]}-${d.getFullYear()}`;
}

function formatMoney(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Short compact form: 1_250_000 → "1.25M", 320_000 → "320K", 450 → "450".
function formatMoneyShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

// One-line auditable derivation for the service detail page. Shows the math
// that produced the subtotal so the client can eyeball the arithmetic.
function buildLineageLine(svc: Service): string | null {
  if (svc.service_type === 'hvac' && svc.total_kw) {
    const pieces: string[] = [];
    if (svc.total_kw) pieces.push(`Total ${svc.total_kw} kW`);
    if (svc.fahu_kw)  pieces.push(`− FAHU ${svc.fahu_kw} kW`);
    if (svc.ac_unit_kw) pieces.push(`= AC ${svc.ac_unit_kw} kW`);
    if (svc.tonnage)   pieces.push(`→ ${svc.tonnage} TR`);
    if (svc.unit_rate_aed) pieces.push(`@ AED ${formatMoney(svc.unit_rate_aed)}/TR`);
    if (svc.total_aed) pieces.push(`= AED ${formatMoney(svc.total_aed)}`);
    return pieces.length >= 3 ? pieces.join(' ') : null;
  }
  if (svc.quantity && svc.unit_rate_aed && svc.total_aed) {
    return `${svc.quantity} × AED ${formatMoney(svc.unit_rate_aed)} = AED ${formatMoney(svc.total_aed)}`;
  }
  return null;
}

function titleCase(s: string | null | undefined): string {
  if (!s) return '-';
  return s.split(/[\s_]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

function titleCaseSystemType(s: string | null | undefined): string {
  if (!s) return '-';
  return s
    .split(/\s+/)
    .map(word => {
      if (/^(HVAC|VRF|BMS|MEP|AHU|FCU|FAHU|MDB|SMDB|DEWA|LPG|TR|KW|UPS|ELV|CO2|DCP)$/i.test(word)) {
        return word.toUpperCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

function friendlyFileType(t: string | null | undefined): string {
  if (!t) return '-';
  const map: Record<string, string> = {
    drawing_autocad: 'AutoCAD Drawing',
    drawing_pdf: 'PDF Drawing',
    schedule_excel: 'Equipment Schedule',
    specification: 'Specification',
    bid_invitation: 'Bid Invitation',
    image: 'Image / Photo',
  };
  return map[t] || titleCase(t);
}

function numberToWords(num: number): string {
  if (num === 0) return 'Zero';
  if (num < 0) return 'Negative ' + numberToWords(-num);

  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
  const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function below1000(n: number): string {
    if (n === 0) return '';
    if (n < 10) return ones[n];
    if (n < 20) return teens[n - 10];
    if (n < 100) {
      const t = Math.floor(n / 10);
      const o = n % 10;
      return tens[t] + (o ? '-' + ones[o] : '');
    }
    const h = Math.floor(n / 100);
    const rem = n % 100;
    return ones[h] + ' Hundred' + (rem ? ' ' + below1000(rem) : '');
  }

  const integer = Math.floor(num);
  const fils = Math.round((num - integer) * 100);

  let result = '';
  const billion = Math.floor(integer / 1_000_000_000);
  const million = Math.floor((integer % 1_000_000_000) / 1_000_000);
  const thousand = Math.floor((integer % 1_000_000) / 1000);
  const remainder = integer % 1000;

  if (billion) result += below1000(billion) + ' Billion ';
  if (million) result += below1000(million) + ' Million ';
  if (thousand) result += below1000(thousand) + ' Thousand ';
  if (remainder) result += below1000(remainder);

  result = result.trim();
  if (!result) result = 'Zero';

  if (fils > 0) {
    result += ' and ' + below1000(fils) + ' Fils';
  }

  return result;
}

// ─── Electrical Power BOQ Generator ───────────────────────────────────────────
// Produces a structured 12-section Power BOQ PDF matching P-379_POWER_BOQ format.

/**
 * Backfill empty/missing AI sections with formula-derived rows and recompute
 * deterministic load-summary fields. Called once after fetching `r` so the PDF
 * always renders against the most-correct numbers regardless of what AI returned.
 *
 * Sections 9, 10, 11 fill only when AI returned nothing (preserves AI nuance
 * when it actually produced rows). Section 12 demand_factor + max_demand_kw
 * are *always* recomputed from tcl_kw — these are deterministic per DEWA §5.4
 * and AI tends to drift on rounding.
 */
function backfillWithFormulas(
  r: ElectricalProcedureResult,
  project: Project,
): ElectricalProcedureResult {
  const out: ElectricalProcedureResult = { ...r };

  // S9 — Containment from cable schedule when AI returned nothing
  if (!out.containment || out.containment.length === 0) {
    const cs = (out.cable_schedule || []).map(c => ({
      size_mm2: c.size_mm2 ?? 0,
      length_m: c.length_m ?? 0,
    }));
    if (cs.length > 0) {
      out.containment = deriveContainmentRows(cs).map(row => ({
        description: row.description,
        unit: row.unit,
        estimated_qty: row.estimated_qty,
        provisional: true, // generic — derived from formula, NOT read from drawing
      }));
    }
  }

  // S10 — Earthing from floor count + building type
  if (!out.earthing || out.earthing.length === 0) {
    const floors = project.floors ?? null;
    const heightM = (project.typical_height_m ?? 3) * (project.floors ?? 1);
    out.earthing = deriveEarthingRows(floors, project.building_type, heightM).map(row => ({
      description: row.description,
      unit: row.unit,
      qty: row.estimated_qty,
      provisional: true, // generic — derived from formula, NOT read from drawing
    }));
  }

  // S11 — Metering from LV-panel count (apartments not in Project schema; pass null)
  if (!out.metering || out.metering.length === 0) {
    const lvPanelCount = out.lv_panels?.length ?? 1;
    out.metering = deriveMeteringRows(null, lvPanelCount).map(row => ({
      description: row.description,
      qty: row.estimated_qty,
      provisional: true, // generic — derived from formula, NOT read from drawing
    }));
  }

  // S6 — Mechanical equipment isolators when AI missed them
  if (!out.mechanical_equipment || out.mechanical_equipment.length === 0) {
    const heightM = (project.typical_height_m ?? 3) * (project.floors ?? 1);
    out.mechanical_equipment = deriveMechanicalEquipmentRows({
      floors: project.floors,
      buildingHeightM: heightM,
      buildingType: project.building_type,
    }).map(row => ({
      description: row.description,
      count: row.count,
      rating_kw: row.rating_kw,
      rating_a: row.rating_a,
    }));
  }

  // S7 — Power outlets when AI missed them
  if (!out.power_outlets || out.power_outlets.length === 0) {
    out.power_outlets = derivePowerOutletRows({
      floors: project.floors,
      totalAreaSqft: project.total_area_sqft,
      areaPerFloorSqft: project.area_per_floor_sqft,
      buildingType: project.building_type,
    }).map(row => ({
      description: row.description,
      unit: row.unit,
      estimated_qty: row.estimated_qty,
      provisional: true, // generic — derived from formula, NOT read from drawing
    }));
  }

  // S12 — Normalise + recompute. AI returns load_summary in two different
  // shapes: the canonical {panel, tcl_kw, standby_kw, demand_factor, max_demand_kw}
  // and a free-form {area, connected_load_kw, demand_load_kw} variant. Map
  // either to the canonical shape so the renderer just sees one schema, then
  // recompute demand_factor + max_demand_kw from tcl_kw via DEWA §5.4.
  if (out.load_summary?.length) {
    out.load_summary = out.load_summary.map((ls: Record<string, unknown>) => {
      const tcl = Number.isFinite(Number(ls.tcl_kw))
        ? Number(ls.tcl_kw)
        : Number.isFinite(Number(ls.connected_load_kw))
        ? Number(ls.connected_load_kw)
        : 0;
      const panel = (ls.panel as string | undefined) ?? (ls.area as string | undefined) ?? '—';
      const standby = Number.isFinite(Number(ls.standby_kw)) ? Number(ls.standby_kw) : 0;
      return {
        panel,
        tcl_kw: tcl,
        standby_kw: standby,
        demand_factor: demandFactor(tcl),
        max_demand_kw: maxDemandKw(tcl),
      };
    });
  }

  // S2 — Incoming Supply transformers. AI often returns {transformers: []}.
  // Derive transformer kVA from total max demand (×1.25 reserve margin,
  // round up to next standard rating) per UAE DEWA practice.
  if (!out.incoming_supply || (!out.incoming_supply.transformers?.length && !out.incoming_supply.generator)) {
    const totalMd = (out.load_summary || []).reduce(
      (sum, ls) => sum + (Number.isFinite(Number(ls.max_demand_kw)) ? Number(ls.max_demand_kw) : 0),
      0,
    );
    if (totalMd > 0) {
      const reqKva = (totalMd * 1.25) / 0.9; // PF 0.9
      const stdKva = standardTransformerKva(reqKva);
      const heightM = (project.typical_height_m ?? 3) * (project.floors ?? 1);
      out.incoming_supply = {
        ...(out.incoming_supply ?? { transformers: [], generator: null, ats: null, hv_ducts: null }),
        transformers: out.incoming_supply?.transformers?.length
          ? out.incoming_supply.transformers
          : [{ kva: stdKva, voltage_ratio: '11/0.4 kV', count: 1 }],
        generator: out.incoming_supply?.generator
          ?? (project.floors && project.floors >= 4
            ? { kva: standardGeneratorKva(totalMd * 0.35), type: 'Diesel' }
            : null),
      };
    }
  }

  // S3 — LV Panels. When AI returns lv_panels=[], synthesise from SMDB
  // groupings. Group SMDBs by their feeder cable size (proxy for which LV
  // panel they hang off): same cable spec → same parent panel.
  if ((!out.lv_panels || out.lv_panels.length === 0) && out.smdb_inventory?.length) {
    const smdbsByFeeder = new Map<string, typeof out.smdb_inventory>();
    for (const smdb of out.smdb_inventory) {
      const key = (smdb.cable_size_from_mdb || 'unknown').replace(/\s+/g, ' ').trim();
      if (!smdbsByFeeder.has(key)) smdbsByFeeder.set(key, []);
      smdbsByFeeder.get(key)!.push(smdb);
    }
    const totalLoadByPanel: number[] = [];
    let panelIdx = 1;
    out.lv_panels = [];
    for (const [, smdbs] of smdbsByFeeder) {
      const panelLoad = smdbs.reduce((s, x) => s + (Number(x.connected_load_kw) || 0), 0);
      const panelCurrent = panelLoad * 1000 / (Math.sqrt(3) * 400 * 0.9);
      const acbRating = standardAcbFrame(panelCurrent * 1.25);
      const capKvar = panelLoad > 100 ? Math.round(panelLoad * 0.3 / 25) * 25 : null;
      out.lv_panels.push({
        tag: `LVP-${String(panelIdx).padStart(2, '0')}`,
        main_acb_rating_a: acbRating,
        main_acb_breaking_ka: acbRating <= 1600 ? 50 : 65,
        outgoing_mccbs: smdbs.map(s => ({
          to: s.id,
          rating_a: s.rating_a ?? 0,
          count: s.qty ?? 1,
        })),
        capacitor_bank_kvar: capKvar,
        capacitor_banks: capKvar ? [{ kvar: capKvar, isolator_rating_a: null }] : undefined,
      });
      totalLoadByPanel.push(panelLoad);
      panelIdx++;
    }
  }

  return out;
}

/** Round up to the next IEC 60076 standard transformer kVA rating. */
function standardTransformerKva(kva: number): number {
  const standards = [500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000];
  for (const s of standards) if (s >= kva) return s;
  return 4000;
}

/** Round up to the next standard generator kVA rating. */
function standardGeneratorKva(kw: number): number {
  const kva = kw / 0.8;
  const standards = [80, 100, 125, 150, 200, 250, 300, 400, 500, 630, 800, 1000];
  for (const s of standards) if (s >= kva) return s;
  return 1250;
}

/** Round up to the next IEC 60947 standard ACB frame size (Amps). */
function standardAcbFrame(amps: number): number {
  const frames = [630, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000, 5000, 6300];
  for (const f of frames) if (f >= amps) return f;
  return 6300;
}

export async function generateElectricalPowerBOQ(
  project: Project,
  projectId: string
): Promise<Buffer> {
  // Fetch the electrical procedure result from sabi_services
  const { data: svc } = await supabaseAdmin
    .from('sabi_services')
    .select('ai_extraction')
    .eq('project_id', projectId)
    .eq('service_type', 'electrical')
    .single();

  const rRaw: ElectricalProcedureResult | null = (svc?.ai_extraction as any)?.raw_electrical_procedure ?? null;
  const r: ElectricalProcedureResult | null = rRaw ? backfillWithFormulas(rRaw, project) : null;

  // Title-block enrichment lives in sabi_projects.ai_extraction (JSONB) since
  // these fields don't have dedicated columns. Falls back to project columns
  // for fields that DO exist (consultant in JSONB only; client_name as column).
  const enr = ((project as any).ai_extraction as Record<string, any> | undefined) ?? {};
  const consultantStr = enr.consultant ?? (project as any).consultant ?? null;
  const plotNo = enr.plot_no ?? null;
  const architect = enr.architect ?? null;
  const structuralEngineer = enr.structural_engineer ?? null;
  const drawingSet = enr.drawing_set ?? null;
  const jobNo = enr.job_no ?? null;

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        bufferPages: true,
        info: {
          Title: `Power BOQ — ${project.project_name || 'Project'}`,
          Author: BRAND.fullName,
          Subject: 'Electrical Power Bill of Quantities',
          Creator: 'ERP Realsoft',
        },
      });

      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const issueDate = new Date();
      const C = COLOR;
      const M = MARGIN;
      const CW = CONTENT_W;

      // Helper: section header bar
      function sectionHeader(title: string) {
        const y = doc.y + 10;
        doc.rect(M, y, CW, 20).fill(C.primary);
        doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(9).text(title, M + 6, y + 5, { width: CW - 12 });
        doc.fillColor(C.text).font('Helvetica').fontSize(8.5);
        doc.moveDown(0.3);
      }

      // Helper: "generic estimate" banner under a section whose rows were ALL
      // backfilled from formulas (A2) — flags provisional allowances so an
      // estimate is never mistaken for a drawing-read quantity.
      const allProvisional = (rows?: Array<{ provisional?: boolean }>) =>
        Array.isArray(rows) && rows.length > 0 && rows.every(x => x?.provisional === true);
      function provisionalBanner() {
        doc.fillColor('#B00020').font('Helvetica-Oblique').fontSize(7.5)
           .text('⚠ GENERIC ESTIMATE — not read from the drawing; provisional allowance (verify before submission).',
             M + 6, doc.y, { width: CW - 12 });
        doc.fillColor(C.text).font('Helvetica').fontSize(8.5);
        doc.moveDown(0.3);
      }

      // Helper: table row
      function tableRow(cols: string[], widths: number[], isHeader = false, isAlt = false) {
        const y = doc.y;
        if (y > PAGE_CONTENT_BOTTOM) { doc.addPage(); }
        const rowY = doc.y;
        if (isHeader) doc.rect(M, rowY, CW, 16).fill(C.primaryLight);
        else if (isAlt) doc.rect(M, rowY, CW, 14).fill(C.rowAlt);
        doc.fillColor(isHeader ? C.primary : C.text)
           .font(isHeader ? 'Helvetica-Bold' : 'Helvetica')
           .fontSize(8);
        let x = M;
        cols.forEach((col, i) => {
          doc.text(col, x + 3, rowY + (isHeader ? 3 : 2), { width: widths[i] - 6, lineBreak: false });
          x += widths[i];
        });
        doc.moveDown(isHeader ? 1.1 : 0.9);
      }

      // ── Cover header ──
      doc.rect(0, 0, A4_W, 60).fill(C.primary);
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(14)
         .text(`${project.project_name || 'Electrical Power BOQ'} — POWER BOQ`, M, 18, { width: CW });
      const subLine = [
        plotNo && `Plot ${plotNo}`,
        project.location && `${project.location}`,
        project.client_name && `Owner: ${project.client_name}`,
        consultantStr && `Consultant: ${consultantStr}`,
        jobNo && `Job ${jobNo}`,
        drawingSet && `Drawing Set ${drawingSet}`,
        `Date: ${issueDate.toLocaleDateString('en-GB')}`,
      ].filter(Boolean).join(' · ');
      doc.font('Helvetica').fontSize(8).text(subLine, M, 38, { width: CW });
      doc.moveDown(0);
      doc.y = 70;

      // ── Section 1: Project Summary ──
      sectionHeader('1. PROJECT SUMMARY');
      const summaryRows: [string, string][] = [
        ['Project', project.project_name || '—'],
        ...(plotNo ? [['Plot No.', plotNo] as [string, string]] : []),
        ['Location', project.location || '—'],
        ['Owner / Client', project.client_name || '—'],
        ...(architect ? [['Architect', architect] as [string, string]] : []),
        ...(structuralEngineer ? [['Structural Engineer', structuralEngineer] as [string, string]] : []),
        ['Consultant', consultantStr || '—'],
        ...(drawingSet ? [['Drawing Set', drawingSet] as [string, string]] : []),
        ...(jobNo ? [['Job No.', jobNo] as [string, string]] : []),
        ['Date', issueDate.toLocaleDateString('en-GB')],
        ['Authority', 'DEWA (Dubai Electricity & Water Authority)'],
        ['Discipline', 'Electrical (Power) — single discipline'],
      ];
      if (r?.load_summary?.length) {
        const totalTCL = r.load_summary.reduce((s, x) => s + (x.tcl_kw || 0), 0);
        const totalMD  = r.load_summary.reduce((s, x) => s + (x.max_demand_kw || 0), 0);
        summaryRows.push(['Building Total Connected Load', `${totalTCL.toFixed(2)} kW`]);
        summaryRows.push(['Building Maximum Demand', `~${totalMD.toFixed(0)} kW`]);
      }
      const hw = [CW * 0.35, CW * 0.65];
      tableRow(['Field', 'Value'], hw, true);
      summaryRows.forEach(([f, v], i) => tableRow([f, v], hw, false, i % 2 === 1));
      doc.moveDown(0.5);

      // ── Section 2: Incoming Supply ──
      if (r?.incoming_supply) {
        const is = r.incoming_supply;
        sectionHeader('2. INCOMING SUPPLY & TRANSFORMERS');
        const iw = [30, CW - 30 - 60 - 40, 60, 40];
        tableRow(['#', 'Description', 'Unit', 'Qty'], iw, true);
        let idx = 1;
        (is.transformers ?? []).forEach(t => {
          tableRow([`2.${idx++}`, `${t.kva} kVA Transformer, ${t.voltage_ratio}, 50 Hz`, 'No.', String(t.count)], iw, false, idx % 2 === 0);
        });
        if (is.generator) tableRow([`2.${idx++}`, `${is.generator.kva} kVA Standby ${is.generator.type} Generator with ATS`, 'No.', '1'], iw, false, idx % 2 === 0);
        if (is.ats) tableRow([`2.${idx++}`, `${is.ats.rating_a}A Automatic Transfer Switch (ATS)`, 'No.', '1'], iw, false, idx % 2 === 0);
        if (is.hv_ducts) tableRow([`2.${idx++}`, `${is.hv_ducts.count}×${is.hv_ducts.size_mm}mm DEWA UPVC duct for incoming HV cable`, 'Set', '1'], iw, false, idx % 2 === 0);
        if (is.mobile_generator_provision) tableRow([`2.${idx++}`, `Mobile Generator provision (per DEWA requirement)`, 'Set', String(is.mobile_generator_provision.count)], iw, false, idx % 2 === 0);
        doc.moveDown(0.5);
      }

      // ── Section 3: LV Panels ──
      if (r?.lv_panels?.length) {
        sectionHeader('3. LV PANELS');
        const lw = [30, CW - 30 - 80 - 40, 80, 40];
        tableRow(['#', 'Description', 'Rating', 'Qty'], lw, true);
        let idx = 1;
        r.lv_panels.forEach(p => {
          tableRow([`3.${idx++}`, `${p.tag} main ACB, 4P`, p.main_acb_rating_a ? `${p.main_acb_rating_a} A, ${p.main_acb_breaking_ka ?? '?'} kA` : '—', '1'], lw, false, idx % 2 === 0);
          (p.outgoing_mccbs ?? []).forEach(m => {
            tableRow([`3.${idx++}`, `${p.tag} outgoing MCCBs to ${m.to}`, `${m.rating_a} A TP`, String(m.count)], lw, false, idx % 2 === 0);
          });
          // Prefer multi-bank list when present (e.g. P-379 LVP-02 = 375 + 275 kVAR);
          // fall back to legacy single capacitor_bank_kvar.
          const banks = p.capacitor_banks?.length
            ? p.capacitor_banks
            : (p.capacitor_bank_kvar ? [{ kvar: p.capacitor_bank_kvar, isolator_rating_a: null }] : []);
          banks.forEach(b => {
            tableRow([`3.${idx++}`, `${b.kvar} kVAR multi-step automatic capacitor bank panel (${p.tag})`, '—', '1'], lw, false, idx % 2 === 0);
            if (b.isolator_rating_a) {
              tableRow([`3.${idx++}`, `${p.tag} capacitor isolator ACB`, `${b.isolator_rating_a} A`, '1'], lw, false, idx % 2 === 0);
            }
          });
        });
        doc.moveDown(0.5);
      }

      // ── Section 4: SMDBs ──
      // P-379 layout: # | Tag | Connected Load (kW) | Feeder Cable | Qty.
      // connected_load_kw and qty are optional in the schema — render '—' when missing.
      if (r?.smdb_inventory?.length) {
        sectionHeader('4. SUB-MAIN DISTRIBUTION BOARDS (SMDB)');
        const sw = [30, 90, 70, CW - 30 - 90 - 70 - 30, 30];
        tableRow(['#', 'Tag', 'Connected Load (kW)', 'Feeder Cable', 'Qty'], sw, true);
        r.smdb_inventory.forEach((smdb, i) => {
          const cable = r.lv_to_smdb_cables.find(c => c.to === smdb.id);
          const cableStr = cable
            ? `${cable.size_mm2 ?? '?'}mm²`
            : smdb.cable_size_from_mdb || '—';
          const loadStr = smdb.connected_load_kw != null ? smdb.connected_load_kw.toFixed(2) : '—';
          const qtyStr = smdb.qty != null ? String(smdb.qty) : '1';
          tableRow([`4.${i + 1}`, `${smdb.id} (${smdb.floor})`, loadStr, cableStr, qtyStr], sw, false, i % 2 === 1);
        });
        doc.moveDown(0.5);
      }

      // ── Section 5: DBs ──
      // P-379 layout aggregates by tag pattern: # | Tag | Per-floor Qty | Floors | Total Qty | TCL Range.
      // Prefer db_groups when present; fall back to per-row db_inventory listing.
      if (r?.db_groups?.length) {
        sectionHeader('5. APARTMENT / SHOP / SERVICE DISTRIBUTION BOARDS (DB)');
        const dw = [30, CW - 30 - 60 - 50 - 60 - 80, 60, 50, 60, 80];
        tableRow(['#', 'Tag', 'Per-floor Qty', 'Floors', 'Total Qty', 'TCL Range'], dw, true);
        r.db_groups.forEach((g, i) => {
          tableRow([
            `5.${i + 1}`,
            g.tag_pattern,
            g.per_floor_qty != null ? String(g.per_floor_qty) : '—',
            g.floors != null ? String(g.floors) : '—',
            String(g.total_qty),
            g.tcl_range_kw ? `${g.tcl_range_kw} kW` : '—',
          ], dw, false, i % 2 === 1);
        });
        doc.moveDown(0.5);
      } else if (r?.db_inventory?.length) {
        sectionHeader('5. DISTRIBUTION BOARDS (DB)');
        const dw = [30, 80, 80, CW - 30 - 80 - 80 - 60 - 30, 60, 30];
        tableRow(['#', 'DB Tag', 'SMDB', 'Floor', 'Cable Size', 'Qty'], dw, true);
        r.db_inventory.forEach((db, i) => {
          tableRow([`5.${i + 1}`, db.db_id, db.smdb_id, db.floor, db.cable_size || '—', '1'], dw, false, i % 2 === 1);
        });
        doc.moveDown(0.5);
      }

      // ── Section 6: Mechanical Equipment ──
      if (r?.mechanical_equipment?.length) {
        sectionHeader('6. MECHANICAL & SERVICE EQUIPMENT (Isolators + Dedicated Feeders)');
        const mw = [30, CW - 30 - 80 - 30, 80, 30];
        tableRow(['#', 'Description', 'Rating', 'Qty'], mw, true);
        r.mechanical_equipment.forEach((eq, i) => {
          const rating = eq.rating_kw ? `${eq.rating_kw} kW` : eq.rating_a ? `${eq.rating_a} A` : '—';
          tableRow([`6.${i + 1}`, eq.description, rating, String(eq.count)], mw, false, i % 2 === 1);
        });
        doc.moveDown(0.5);
      }

      // ── Section 7: Power Outlets ──
      if (r?.power_outlets?.length) {
        sectionHeader('7. POWER OUTLETS & ACCESSORIES');
        if (allProvisional(r.power_outlets)) provisionalBanner();
        const ow = [30, CW - 30 - 50 - 70, 50, 70];
        tableRow(['#', 'Description', 'Unit', 'Est. Qty'], ow, true);
        r.power_outlets.forEach((o, i) => {
          tableRow([`7.${i + 1}`, o.description, o.unit, `~${o.estimated_qty}`], ow, false, i % 2 === 1);
        });
        doc.moveDown(0.5);
      }

      // ── Section 8: Cable Schedule ──
      // P-379 lists from→to mains first (8.1…8.x), then aggregated final-circuit
      // bulk lengths (8.x+1…8.n) for apartment lighting/sockets/sub-mains.
      const mainCables = r?.cable_schedule ?? [];
      const bulkCables = r?.bulk_cables ?? [];
      if (mainCables.length || bulkCables.length) {
        if (doc.y > PAGE_CONTENT_BOTTOM - 60) doc.addPage();
        sectionHeader('8. CABLES (Main Distribution — measured from SLD; lengths via scaled floor plans)');
        const cw2 = [30, CW * 0.28, CW * 0.32, 70];
        tableRow(['#', 'Cable Specification', 'Application', 'Est. Length (m)'], cw2, true);
        let cableIdx = 0;
        mainCables.forEach(c => {
          cableIdx++;
          const spec = `${c.size_mm2}mm² ${c.type.toUpperCase()}`;
          const app = `${c.from} → ${c.to}${c.circuit_description ? ` (${c.circuit_description})` : ''}`;
          tableRow([`8.${cableIdx}`, spec, app, `~${c.length_m}`], cw2, false, cableIdx % 2 === 0);
        });
        bulkCables.forEach(b => {
          cableIdx++;
          tableRow(
            [`8.${cableIdx}`, b.specification, b.application, `~${b.estimated_length_m.toLocaleString()}`],
            cw2,
            false,
            cableIdx % 2 === 0,
          );
        });
        doc.moveDown(0.5);
      }

      // ── Section 9: Containment ──
      if (r?.containment?.length) {
        sectionHeader('9. CONTAINMENT (Cable Tray, Trunking, Conduit)');
        if (allProvisional(r.containment)) provisionalBanner();
        const tw = [30, CW - 30 - 50 - 70, 50, 70];
        tableRow(['#', 'Description', 'Unit', 'Est. Qty'], tw, true);
        r.containment.forEach((c, i) => {
          tableRow([`9.${i + 1}`, c.description, c.unit, `~${c.estimated_qty}`], tw, false, i % 2 === 1);
        });
        doc.moveDown(0.5);
      }

      // ── Section 10: Earthing ──
      if (r?.earthing?.length) {
        sectionHeader('10. EARTHING & LIGHTNING PROTECTION');
        if (allProvisional(r.earthing)) provisionalBanner();
        const ew = [30, CW - 30 - 50 - 50, 50, 50];
        tableRow(['#', 'Description', 'Unit', 'Qty'], ew, true);
        r.earthing.forEach((e, i) => {
          tableRow([`10.${i + 1}`, e.description, e.unit, String(e.qty)], ew, false, i % 2 === 1);
        });
        doc.moveDown(0.5);
      }

      // ── Section 11: Metering ──
      if (r?.metering?.length) {
        sectionHeader('11. METERING & MONITORING');
        if (allProvisional(r.metering)) provisionalBanner();
        const mew = [30, CW - 30 - 50, 50];
        tableRow(['#', 'Description', 'Qty'], mew, true);
        r.metering.forEach((m, i) => {
          tableRow([`11.${i + 1}`, m.description, String(m.qty)], mew, false, i % 2 === 1);
        });
        doc.moveDown(0.5);
      }

      // ── Section 12: Load Summary ──
      if (r?.load_summary?.length) {
        sectionHeader('12. SUMMARY OF ELECTRICAL LOADS');
        const lsw = [CW * 0.3, CW * 0.17, CW * 0.17, CW * 0.18, CW * 0.18];
        tableRow(['Panel', 'TCL (kW)', 'Standby (kW)', 'Demand Factor', 'Max Demand (kW)'], lsw, true);
        // Null-safe field reads — AI sometimes omits standby_kw, demand_factor,
        // or max_demand_kw on edge-case panels. Using ?? 0 here so a single
        // missing field never crashes the whole PDF render.
        const numOr = (v: unknown) => Number.isFinite(Number(v)) ? Number(v) : 0;
        r.load_summary.forEach((ls, i) => {
          tableRow(
            [
              ls.panel ?? '—',
              numOr(ls.tcl_kw).toFixed(2),
              numOr(ls.standby_kw).toFixed(2),
              numOr(ls.demand_factor).toFixed(2),
              numOr(ls.max_demand_kw).toFixed(2),
            ],
            lsw,
            false,
            i % 2 === 1,
          );
        });
        if (r.load_summary.length > 1) {
          const totalTCL = r.load_summary.reduce((s, x) => s + numOr(x.tcl_kw), 0);
          const totalMD  = r.load_summary.reduce((s, x) => s + numOr(x.max_demand_kw), 0);
          tableRow(['TOTAL BUILDING', totalTCL.toFixed(2), '—', '—', `~${totalMD.toFixed(2)}`], lsw, true);
        }
        doc.moveDown(0.5);
      }

      // Footer
      doc.fontSize(7).fillColor(C.textMuted)
         .text(`Generated by ERP Realsoft RFQ-to-BOQ pipeline (realsoft.example) · ${issueDate.toLocaleDateString('en-GB')}`, M, A4_H - 30, { width: CW, align: 'center' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
