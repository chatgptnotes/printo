// Tender-format BOQ XLSX generator (Cover + A–G + Summary, with rate/amount
// formulas + 10% contingency + 5% VAT). Mirrors the customer-supplied
// "BOQ Electrical .xlsx" template structure so contractors can price directly.
//
// Pure ESM. Consumes the canonical ElectricalProcedureResult shape from
// src/lib/ai/claude-api.ts (lv_panels, smdb_inventory, db_groups/db_inventory,
// cable_schedule, containment, earthing, incoming_supply, load_summary).
//
// Usage:
//   import { generateTenderBoqXlsx } from './scripts/lib/tender-boq-xlsx.mjs';
//   const buf = await generateTenderBoqXlsx({ project, electrical, overrides, options });
//   writeFileSync('out.xlsx', buf);

import ExcelJS from 'exceljs';
import { applyRatesToWorkbook } from './dubai-2026-rates.mjs';

// ─── Branding (mirrors src/lib/pipeline/boq-generator.ts) ─────────────────
function envOrDefault(envKey, fallback) {
  const v = process.env[envKey]?.trim();
  if (!v) return fallback;
  if (/^(1?00X+|XXX+|TODO|TBD|placeholder)$/i.test(v)) return fallback;
  return v;
}

const SABI = {
  fullName: envOrDefault('SABI_FULL_NAME', 'SABI Engineering & Contracting LLC'),
  address: envOrDefault('SABI_ADDRESS', 'Dubai, United Arab Emirates'),
  phone: envOrDefault('SABI_PHONE', '+971 4 XXX XXXX'),
  email: envOrDefault('SABI_EMAIL', 'estimation@sabi.ae'),
};

// ─── Styling tokens — matched to customer-supplied template ────────────────
// Two-tone scheme: dark navy for title bars + section totals; medium blue for
// column headers + sub-totals. Arial throughout, matching the template font.
const NAVY      = 'FF1F3864';   // dark navy — title bar, section total
const BLUE      = 'FF2E75B6';   // medium blue — column header, sub-total
const NAVY_LITE = 'FFD9E1F2';   // very light blue — kept for subtle accents
const GREY      = 'FFF2F2F2';
const AMBER     = 'FFFFE699';
const ROW_ALT   = 'FFF8F9FA';
const FONT_BASE = { name: 'Arial', size: 10 };

const STYLE = {
  titleBar: {
    font: { ...FONT_BASE, bold: true, color: { argb: 'FFFFFFFF' }, size: 12 },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } },
    alignment: { vertical: 'middle', horizontal: 'center' },
  },
  sectionTitle: {
    font: { ...FONT_BASE, bold: true, color: { argb: 'FFFFFFFF' } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } },
    alignment: { vertical: 'middle', horizontal: 'left' },
  },
  groupBand: {
    font: { ...FONT_BASE, bold: true, color: { argb: 'FFFFFFFF' } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } },
    alignment: { vertical: 'middle', horizontal: 'left' },
  },
  tableHead: {
    font: { ...FONT_BASE, bold: true, color: { argb: 'FFFFFFFF' } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } },
    alignment: { vertical: 'middle', horizontal: 'center', wrapText: true },
    border: thinBorder(),
  },
  body: {
    font: FONT_BASE,
    alignment: { vertical: 'middle', wrapText: true, horizontal: 'left' },
    border: thinBorder(),
  },
  bodyAlt: {
    font: FONT_BASE,
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: ROW_ALT } },
    alignment: { vertical: 'middle', wrapText: true, horizontal: 'left' },
    border: thinBorder(),
  },
  // Item column — left-aligned, bold (Dubai BOQ convention)
  bodyLeftBold: {
    font: { ...FONT_BASE, bold: true },
    alignment: { vertical: 'middle', horizontal: 'left' },
    border: thinBorder(),
  },
  bodyLeftBoldAlt: {
    font: { ...FONT_BASE, bold: true },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: ROW_ALT } },
    alignment: { vertical: 'middle', horizontal: 'left' },
    border: thinBorder(),
  },
  // Unit column — short text centered.
  bodyCenter: {
    font: FONT_BASE,
    alignment: { vertical: 'middle', horizontal: 'center' },
    border: thinBorder(),
  },
  bodyCenterAlt: {
    font: FONT_BASE,
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: ROW_ALT } },
    alignment: { vertical: 'middle', horizontal: 'center' },
    border: thinBorder(),
  },
  // Qty / Rate / Amount — right-aligned numeric (currency convention)
  bodyRight: {
    font: FONT_BASE,
    alignment: { vertical: 'middle', horizontal: 'right' },
    border: thinBorder(),
  },
  bodyRightAlt: {
    font: FONT_BASE,
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: ROW_ALT } },
    alignment: { vertical: 'middle', horizontal: 'right' },
    border: thinBorder(),
  },
  subTotal: {
    font: { ...FONT_BASE, bold: true, color: { argb: 'FFFFFFFF' } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } },
    alignment: { vertical: 'middle', horizontal: 'right' },
    border: thinBorder(),
  },
  sectionTotal: {
    font: { ...FONT_BASE, bold: true, color: { argb: 'FFFFFFFF' }, size: 11 },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } },
    alignment: { vertical: 'middle', horizontal: 'right' },
    border: thinBorder(),
  },
  reconciliation: {
    font: { ...FONT_BASE, size: 9, italic: true, color: { argb: 'FF7F4F00' } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: AMBER } },
    alignment: { vertical: 'middle', wrapText: true },
    border: thinBorder(),
  },
  statusBanner: {
    font: { ...FONT_BASE, bold: true, color: { argb: 'FFFFFFFF' }, size: 12 },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC00000' } },
    alignment: { vertical: 'middle', horizontal: 'center' },
    border: thinBorder(),
  },
};

// Simple number format — "AED" already lives in the column header.
const AED_FMT = '#,##0.00';

function thinBorder() {
  const t = { style: 'thin', color: { argb: 'FFB7B7B7' } };
  return { top: t, left: t, bottom: t, right: t };
}

// ─── Public entry ──────────────────────────────────────────────────────────
/**
 * @param {{ project: any, electrical: any, overrides?: any, options?: any }} args
 *   project: SABI project record (project_name, location, client_name, ai_extraction.{plot_no,architect,...})
 *   electrical: ElectricalProcedureResult (raw_electrical_procedure)
 *   overrides: { architect?, structural_engineer?, plot_no?, job_no?, drawing_set?, drawing_date?, consultant?, status? }
 *   options: { contingency_pct?: number, vat_pct?: number, currency?: string,
 *              reconciliation_notes?: string[], building_totals?: {tcl_kw, max_demand_kw, demand_factor} }
 * @returns {Promise<Buffer>}
 */
export async function generateTenderBoqXlsx({ project, electrical, overrides = {}, options = {} }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = SABI.fullName;
  wb.lastModifiedBy = SABI.fullName;
  wb.created = new Date();
  wb.modified = new Date();

  const opts = {
    contingency_pct: 0.10,
    vat_pct: 0.05,
    currency: 'AED',
    status: 'TENDER — FOR PRICING',
    ...options,
  };

  const meta = buildMeta(project, electrical, overrides);

  // Sheet order matches the customer-supplied template:
  //   Cover · A · B · C · D · E · Summary · F · G
  const sheets = {
    cover:   wb.addWorksheet('Cover'),
    A:       wb.addWorksheet('A - Switchgear & SMDBs'),
    B:       wb.addWorksheet('B - Distribution Boards'),
    C:       wb.addWorksheet('C - Main Cables (LV to SMDB)'),
    D:       wb.addWorksheet('D - Distribution Cables'),
    E:       wb.addWorksheet('E - Cable Management'),
    summary: wb.addWorksheet('Summary of BOQ'),
    F:       wb.addWorksheet('F - Earthing & Bonding'),
    G:       wb.addWorksheet('G - Sundries & T&C'),
  };

  // Track each section's TOTAL cell so the Summary sheet can pull it.
  const totals = {};

  totals.A = buildSheetA(sheets.A, meta, electrical, opts);
  totals.B = buildSheetB(sheets.B, meta, electrical, opts);
  totals.C = buildSheetC(sheets.C, meta, electrical, opts);
  totals.D = buildSheetD(sheets.D, meta, electrical, opts);
  totals.E = buildSheetE(sheets.E, meta, electrical, opts);
  totals.F = buildSheetF(sheets.F, meta, electrical, opts);
  totals.G = buildSheetG(sheets.G, meta, electrical, opts);

  buildCover(sheets.cover, meta, opts);
  buildSummary(sheets.summary, meta, totals, opts);

  // Populate Rate column with indicative Dubai 2026 rates unless caller asked
  // for an unpriced tender form (opts.priceMode === 'tender').
  if (opts.priceMode !== 'tender') {
    const lookup = opts.rateLookup || ((row) => null);
    const stats = applyRatesToWorkbook(wb, lookup);
    if (typeof opts.onRateStats === 'function') opts.onRateStats(stats);
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ─── Meta extraction ──────────────────────────────────────────────────────
function buildMeta(project, electrical, overrides) {
  const enr = (project?.ai_extraction || {});
  const ls = electrical?.load_summary || [];
  const tcl = ls.reduce((s, x) => s + (Number(x?.tcl_kw) || 0), 0);
  const md  = ls.reduce((s, x) => s + (Number(x?.max_demand_kw) || 0), 0);

  return {
    project_name: overrides.project_name ?? project?.project_name ?? enr.project_name ?? 'Electrical Power Distribution Works',
    location:     overrides.location ?? project?.location ?? enr.location ?? '',
    plot_no:      overrides.plot_no ?? enr.plot_no ?? '',
    owner:        overrides.owner ?? project?.client_name ?? enr.owner ?? '',
    architect:    overrides.architect ?? enr.architect ?? '',
    structural:   overrides.structural_engineer ?? enr.structural_engineer ?? '',
    consultant:   overrides.consultant ?? project?.consultant ?? enr.consultant ?? '',
    job_no:       overrides.job_no ?? enr.job_no ?? '',
    drawing_set:  overrides.drawing_set ?? enr.drawing_set ?? '',
    drawing_date: overrides.drawing_date ?? enr.drawing_date ?? new Date().toLocaleDateString('en-GB'),
    authority:    overrides.authority ?? 'DEWA (Dubai Electricity & Water Authority)',
    boq_date:     overrides.boq_date ?? new Date().toLocaleDateString('en-GB'),
    building: {
      tcl_kw: tcl > 0 ? tcl : null,
      max_demand_kw: md > 0 ? md : null,
      demand_factor: tcl > 0 ? Number((md / tcl).toFixed(3)) : null,
    },
  };
}

// ─── Cover sheet ──────────────────────────────────────────────────────────
function buildCover(ws, meta, opts) {
  // Match template column widths exactly: [3, 14, 50, 5, 5, 5, 5, 20, 3]
  ws.columns = [
    { width: 3 }, { width: 14 }, { width: 50 }, { width: 5 }, { width: 5 },
    { width: 5 }, { width: 5 }, { width: 20 }, { width: 3 },
  ];

  ws.pageSetup = {
    paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    horizontalCentered: true,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
  };

  ws.mergeCells('B2:H3');
  ws.getCell('B2').value = 'BILL OF QUANTITIES';
  ws.getCell('B2').style = STYLE.titleBar;
  ws.getRow(2).height = 26;
  ws.getRow(3).height = 26;

  ws.mergeCells('B4:H5');
  ws.getCell('B4').value = 'ELECTRICAL POWER DISTRIBUTION WORKS';
  ws.getCell('B4').style = STYLE.sectionTitle;
  ws.getCell('B4').alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getRow(4).height = 22;
  ws.getRow(5).height = 22;

  // Project metadata block
  const meta_rows = [
    ['Project',     meta.project_name],
    ['Owner',       meta.owner],
    ['Plot No.',    [meta.plot_no, meta.location].filter(Boolean).join(' — ')],
    ['Architect',   meta.architect],
    ['Structural',  meta.structural],
    ['Consultant',  meta.consultant],
    ['Job No.',     meta.job_no],
    ['Drawing Ref', meta.drawing_set],
    ['Drawing Date',meta.drawing_date],
    ['BOQ Date',    meta.boq_date],
    ['Authority',   meta.authority],
    ['Status',      opts.status],
  ];
  let r = 7;
  for (const [k, v] of meta_rows) {
    if (!v) continue;
    ws.getCell(`B${r}`).value = k;
    ws.getCell(`B${r}`).style = { ...STYLE.body, font: { ...STYLE.body.font, bold: true } };
    ws.mergeCells(`C${r}:H${r}`);
    ws.getCell(`C${r}`).value = v;
    ws.getCell(`C${r}`).style = STYLE.body;
    r++;
  }

  // Building totals (from load_summary)
  if (meta.building.tcl_kw != null) {
    r++;
    ws.getCell(`B${r}`).value = 'BUILDING ELECTRICAL LOAD';
    ws.mergeCells(`B${r}:H${r}`);
    ws.getCell(`B${r}`).style = STYLE.groupBand;
    r++;

    const total_rows = [
      ['Total Connected Load (TCL)', `${meta.building.tcl_kw.toFixed(2)} kW`],
      ['Demand Factor',              meta.building.demand_factor != null ? meta.building.demand_factor.toFixed(2) : '—'],
      ['Maximum Demand (MD)',        `~${Math.round(meta.building.max_demand_kw)} kW`],
    ];
    for (const [k, v] of total_rows) {
      ws.getCell(`B${r}`).value = k;
      ws.getCell(`B${r}`).style = { ...STYLE.body, font: { ...STYLE.body.font, bold: true } };
      ws.mergeCells(`C${r}:H${r}`);
      ws.getCell(`C${r}`).value = v;
      ws.getCell(`C${r}`).style = STYLE.body;
      r++;
    }
  }

  // Section index
  r++;
  ws.getCell(`B${r}`).value = 'SUMMARY OF SECTIONS';
  ws.mergeCells(`B${r}:H${r}`);
  ws.getCell(`B${r}`).style = STYLE.groupBand;
  r++;
  const sec_idx = [
    ['A', 'LV Switchgear & Sub-Main Distribution Boards (SMDBs)', 'Sheet A'],
    ['B', 'Distribution Boards (DBs) & Consumer Units',            'Sheet B'],
    ['C', 'LV Power Cables — Main & Rising Mains',                  'Sheet C'],
    ['D', 'LV Power Cables — Distribution (SMDB to DB)',            'Sheet D'],
    ['E', 'Cable Management — Trays, Ladders & Conduits',           'Sheet E'],
    ['F', 'Earthing & Bonding',                                     'Sheet F'],
    ['G', 'Sundries, Accessories & Testing/Commissioning',          'Sheet G'],
  ];
  ws.getCell(`B${r}`).value = 'Section'; ws.getCell(`B${r}`).style = STYLE.tableHead;
  ws.mergeCells(`C${r}:G${r}`);
  ws.getCell(`C${r}`).value = 'Description'; ws.getCell(`C${r}`).style = STYLE.tableHead;
  ws.getCell(`H${r}`).value = 'Sheet Ref'; ws.getCell(`H${r}`).style = STYLE.tableHead;
  r++;
  for (const [k, d, s] of sec_idx) {
    ws.getCell(`B${r}`).value = k; ws.getCell(`B${r}`).style = STYLE.body;
    ws.mergeCells(`C${r}:G${r}`);
    ws.getCell(`C${r}`).value = d; ws.getCell(`C${r}`).style = STYLE.body;
    ws.getCell(`H${r}`).value = s; ws.getCell(`H${r}`).style = STYLE.body;
    r++;
  }

  // Reconciliation banner (only when notes provided)
  if (Array.isArray(opts.reconciliation_notes) && opts.reconciliation_notes.length) {
    r++;
    ws.getCell(`B${r}`).value = 'RECONCILIATION NOTES — corrections applied vs source data';
    ws.mergeCells(`B${r}:H${r}`);
    ws.getCell(`B${r}`).style = STYLE.groupBand;
    r++;
    for (const note of opts.reconciliation_notes) {
      ws.mergeCells(`B${r}:H${r}`);
      ws.getCell(`B${r}`).value = `• ${note}`;
      ws.getCell(`B${r}`).style = STYLE.reconciliation;
      ws.getRow(r).height = Math.max(20, Math.ceil(note.length / 100) * 16);
      r++;
    }
  }

  // Status footer
  r++;
  ws.mergeCells(`B${r}:H${r}`);
  ws.getCell(`B${r}`).value = `STATUS: ${opts.status}`;
  ws.getCell(`B${r}`).style = STYLE.statusBanner;
  ws.getRow(r).height = 22;
  r++;

  ws.mergeCells(`B${r}:H${r}`);
  ws.getCell(`B${r}`).value = 'NOTE: All quantities are ESTIMATED. Cable lengths include 10% routing allowance. Confirm all quantities before procurement.';
  ws.getCell(`B${r}`).style = { ...STYLE.body, font: { italic: true, size: 9 } };
  ws.getRow(r).height = 28;
}

// ─── Common section-sheet helpers ─────────────────────────────────────────
function setSectionHeader(ws, sectionLetter, title, meta) {
  // Match template column widths exactly: [7, 55, 18, 8, 8, 14, 16, 30]
  ws.columns = [
    { width: 7 }, { width: 55 }, { width: 18 }, { width: 8 },
    { width: 8 }, { width: 14 }, { width: 16 }, { width: 30 },
  ];

  // Freeze top 3 rows so column header stays visible while scrolling.
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 3, topLeftCell: 'A4', activeCell: 'A4' }];

  // Print setup — A4 portrait, fit to width, repeat header rows on each printed page.
  ws.pageSetup = {
    paperSize: 9,        // A4
    orientation: 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
    printArea: undefined,
  };
  ws.pageSetup.printTitlesRow = '1:3';
  ws.headerFooter = {
    oddHeader: `&L&"Arial,Bold"&12${meta.project_name}&R&"Arial,Italic"&10Job ${meta.job_no || ''}`,
    oddFooter: `&LSection ${sectionLetter} — ${title}&RPage &P of &N`,
  };

  ws.mergeCells('A1:H1');
  ws.getCell('A1').value = `BILL OF QUANTITIES — SECTION ${sectionLetter}: ${title}`;
  ws.getCell('A1').style = STYLE.titleBar;
  ws.getRow(1).height = 27.75;

  ws.mergeCells('A2:H2');
  ws.getCell('A2').value = `Project: ${meta.project_name}, Plot ${meta.plot_no || '—'}, ${meta.location}  |  Job: ${meta.job_no || '—'}`;
  ws.getCell('A2').style = { ...STYLE.body, font: { ...FONT_BASE, italic: true, size: 9 }, alignment: { vertical: 'middle', horizontal: 'left' } };
  ws.getRow(2).height = 13.5;

  // Column header row
  const cols = ['Item', 'Description', 'Reference', 'Unit', 'Qty', 'Unit Rate\n(AED)', 'Amount\n(AED)', 'Remarks'];
  cols.forEach((c, i) => {
    const cell = ws.getRow(3).getCell(i + 1);
    cell.value = c;
    cell.style = STYLE.tableHead;
  });
  ws.getRow(3).height = 27.75;
}

function bandRow(ws, r, text) {
  ws.mergeCells(`A${r}:H${r}`);
  ws.getCell(`A${r}`).value = text;
  ws.getCell(`A${r}`).style = STYLE.groupBand;
  ws.getRow(r).height = 19.5;
}

// Per-column alignment: 1=Item left/bold · 2-3=left wrap · 4=Unit center · 5-7=right (numeric/currency) · 8=left
function styleFor(col, alt) {
  if (col === 1)              return alt ? STYLE.bodyLeftBoldAlt : STYLE.bodyLeftBold;
  if (col === 2 || col === 3) return alt ? STYLE.bodyAlt          : STYLE.body;
  if (col === 4)              return alt ? STYLE.bodyCenterAlt    : STYLE.bodyCenter;
  if (col >= 5 && col <= 7)   return alt ? STYLE.bodyRightAlt     : STYLE.bodyRight;
  return alt ? STYLE.bodyAlt : STYLE.body;
}

function lineRow(ws, r, item, desc, ref, unit, qty, remark = '', alt = false) {
  ws.getRow(r).getCell(1).value = item;
  ws.getRow(r).getCell(2).value = desc;
  ws.getRow(r).getCell(3).value = ref;
  ws.getRow(r).getCell(4).value = unit;
  ws.getRow(r).getCell(5).value = qty;
  ws.getRow(r).getCell(6).value = null;
  ws.getRow(r).getCell(7).value = { formula: `IF(OR(E${r}="",F${r}=""),"",E${r}*F${r})`, result: null };
  ws.getRow(r).getCell(8).value = remark;
  for (let c = 1; c <= 8; c++) {
    ws.getRow(r).getCell(c).style = styleFor(c, alt);
  }
  ws.getRow(r).getCell(5).numFmt = '#,##0';
  ws.getRow(r).getCell(6).numFmt = AED_FMT;
  ws.getRow(r).getCell(7).numFmt = AED_FMT;
  // Word-wrap for long descriptions
  if (typeof desc === 'string' && desc.length > 80) {
    ws.getRow(r).height = Math.min(72, 18 + Math.ceil(desc.length / 80) * 13);
  } else {
    ws.getRow(r).height = 18;
  }
}

function subTotalRow(ws, r, label, firstRow, lastRow) {
  ws.mergeCells(`A${r}:F${r}`);
  ws.getCell(`A${r}`).value = label;
  ws.getCell(`A${r}`).style = STYLE.subTotal;
  ws.getCell(`G${r}`).value = { formula: `SUM(G${firstRow}:G${lastRow})`, result: null };
  ws.getCell(`G${r}`).style = { ...STYLE.subTotal, alignment: { horizontal: 'center', vertical: 'middle' } };
  ws.getCell(`G${r}`).numFmt = AED_FMT;
  ws.getCell(`H${r}`).value = '';
  ws.getCell(`H${r}`).style = STYLE.subTotal;
  ws.getRow(r).height = 19.5;
}

function sectionTotalRow(ws, r, sectionLetter, firstRow, lastRow) {
  r++; // gap row
  ws.mergeCells(`A${r}:F${r}`);
  ws.getCell(`A${r}`).value = `SECTION ${sectionLetter} — TOTAL`;
  ws.getCell(`A${r}`).style = STYLE.sectionTotal;
  ws.getCell(`G${r}`).value = { formula: `SUMIF(G4:G${lastRow},"<>")`, result: null };
  ws.getCell(`G${r}`).style = { ...STYLE.sectionTotal, alignment: { horizontal: 'center', vertical: 'middle' } };
  ws.getCell(`G${r}`).numFmt = AED_FMT;
  ws.getCell(`H${r}`).value = '';
  ws.getCell(`H${r}`).style = STYLE.sectionTotal;
  ws.getRow(r).height = 24;
  return r;
}

// ─── Section A — Switchgear & SMDBs ───────────────────────────────────────
function buildSheetA(ws, meta, e, opts) {
  setSectionHeader(ws, 'A', 'LV SWITCHGEAR & SUB-MAIN DISTRIBUTION BOARDS', meta);
  let r = 4;

  // ── A1 LV Panels (LVP-01, LVP-02, ATS, generator, capacitor banks) ──
  bandRow(ws, r++, 'A1 — LV PANELS & MAIN SWITCHGEAR (Supply, Install, Test & Commission)');
  let n = 0;
  let firstA1 = r;
  for (const p of (e?.lv_panels || [])) {
    n++;
    const desc = panelDescription(p);
    const cap = (p.capacitor_banks?.length ? p.capacitor_banks : (p.capacitor_bank_kvar ? [{ kvar: p.capacitor_bank_kvar }] : []));
    lineRow(ws, r++, `A1.${n}`, desc, e?.schematic_filename || 'SLD', 'Nr', 1,
      `${p.tag} main panel`, n % 2 === 0);
    for (const b of cap) {
      n++;
      lineRow(ws, r++, `A1.${n}`,
        `Capacitor Bank — ${b.kvar} kVAR, 415V, automatic PF correction for ${p.tag}.`,
        'SLD', 'Nr', 1, `${p.tag} PF correction`, n % 2 === 0);
    }
  }
  if (e?.incoming_supply?.ats) {
    n++;
    lineRow(ws, r++, `A1.${n}`,
      `Automatic Transfer Switch (ATS) Panel — 415V, ${e.incoming_supply.ats.rating_a}A, 4P. Complete with controls and interlocking.`,
      'SLD', 'Nr', 1, 'Mains/Gen changeover', n % 2 === 0);
  }
  if (e?.incoming_supply?.generator) {
    n++;
    const g = e.incoming_supply.generator;
    lineRow(ws, r++, `A1.${n}`,
      `Standby Generator — ${g.kva} kVA, 415V/3Ph/50Hz, ${g.type || 'diesel'}, weatherproof canopy, AMF panel, fuel tank, exhaust, anti-vibration mounts. Complete installed and commissioned.`,
      'SLD', 'Nr', 1, 'Backup to essential', n % 2 === 0);
  }
  if (firstA1 < r) {
    subTotalRow(ws, r, 'Sub-Total A1', firstA1, r - 1);
    r += 2;
  }

  // ── A2 Typical-floor SMDBs ──
  const smdbs = e?.smdb_inventory || [];
  const typical = smdbs.filter(s => /^[1-8]F$/i.test(s.floor || ''));
  const others  = smdbs.filter(s => !/^[1-8]F$/i.test(s.floor || ''));

  if (typical.length) {
    bandRow(ws, r++, 'A2 — SUB-MAIN DISTRIBUTION BOARDS (SMDBs) — Typical Floors');
    const firstA2 = r;
    typical.forEach((s, i) => {
      const incomer = s.rating_a ? `${s.rating_a}A TP MCCB 35kA` : 'TP MCCB';
      const cable = findFeederCable(e, s.id);
      lineRow(ws, r++, `A2.${i + 1}`,
        `${s.id}: Floor-standing SMDB, ${incomer} incomer, 415V, outgoing MCCBs as per SLD. Incl. busbar, earth bar, DIN rail, metering provisions. Supply, install, test & commission.${cable ? ` Connected load: ${s.connected_load_kw ?? '—'} kW.` : ''}`,
        'SLD', 'Nr', 1, `${s.floor} — ${(s.connected_load_kw ?? '—')} kW`, i % 2 === 1);
    });
    subTotalRow(ws, r, 'Sub-Total A2', firstA2, r - 1);
    r += 2;
  }

  // ── A3 Other SMDBs (G, RF, EV, ESMDB, retail) ──
  if (others.length) {
    bandRow(ws, r++, 'A3 — SMDBs — Ground Floor, Roof, Services & Emergency');
    const firstA3 = r;
    others.forEach((s, i) => {
      const incomer = s.rating_a ? `${s.rating_a}A TP MCCB 35kA` : 'TP MCCB';
      const isEmerg = /^ESMDB|emergency/i.test(s.id);
      const isRetail = /SH|retail|shop/i.test(s.id);
      const qty = s.qty ?? 1;
      const desc = isRetail
        ? `${s.id}: Wall-mounted retail shop SMDB, ${incomer} incomer, outgoing MCCBs for retail unit. Supply, install, test & commission.`
        : isEmerg
          ? `${s.id} (Emergency SMDB): ${s.floor === 'RF' ? 'Wall-mounted' : 'Floor-standing'} emergency board, ${incomer} incomer, fire-rated cable terminations, generator-backed via ATS. Supply, install, test & commission.`
          : `${s.id}: ${s.floor === 'RF' ? 'Floor-standing' : 'Wall-mounted'} SMDB, ${incomer} incomer, outgoing MCCBs as per SLD. Supply, install, test & commission.`;
      lineRow(ws, r++, `A3.${i + 1}`, desc,
        'SLD', 'Nr', qty, `${s.floor} — ${(s.connected_load_kw ?? '—')} kW`, i % 2 === 1);
    });
    subTotalRow(ws, r, 'Sub-Total A3', firstA3, r - 1);
    r += 2;
  }

  return sectionTotalRow(ws, r, 'A', 4, r - 1);
}

function panelDescription(p) {
  const acb = p.main_acb_rating_a ? `${p.main_acb_rating_a}A main ACB${p.main_acb_breaking_ka ? ` (${p.main_acb_breaking_ka} kA)` : ''}` : 'main ACB';
  const mccbs = (p.outgoing_mccbs || []).map(m => `${m.count}× ${m.rating_a}A TP to ${m.to}`).join(', ');
  return `${p.tag}: 3P+N+E, 415V, 50Hz, floor-standing, metal-clad LV switchboard, incl. ${acb}, busbars, metering. Outgoing: ${mccbs || 'as per SLD'}. Complete as per SLD.`;
}

function findFeederCable(e, smdbId) {
  return (e?.lv_to_smdb_cables || []).find(c => c.to === smdbId)
    || (e?.cable_schedule || []).find(c => c.to === smdbId);
}

// ─── Section B — Distribution Boards ──────────────────────────────────────
function buildSheetB(ws, meta, e, opts) {
  setSectionHeader(ws, 'B', 'DISTRIBUTION BOARDS (DBs) & CONSUMER UNITS', meta);
  let r = 4;

  if (e?.db_groups?.length) {
    // Group by typical-floor / ground / roof / emergency by tag pattern
    const groups = {
      typical:   e.db_groups.filter(g => /typical|apartment|floor/i.test(g.tag_pattern)),
      ground:    e.db_groups.filter(g => /ground|GF|lobby|car ?park|retail|shop/i.test(g.tag_pattern)),
      roof:      e.db_groups.filter(g => /roof|RF|plant|mechanical|EV/i.test(g.tag_pattern)),
      emergency: e.db_groups.filter(g => /emergency|EDB|fire/i.test(g.tag_pattern)),
      other:     [],
    };
    const placed = new Set();
    Object.values(groups).flat().forEach(g => placed.add(g.tag_pattern));
    groups.other = e.db_groups.filter(g => !placed.has(g.tag_pattern));

    const renderGroup = (label, items, prefix) => {
      if (!items.length) return;
      bandRow(ws, r++, label);
      const first = r;
      items.forEach((g, i) => {
        const ref = g.tcl_range_kw ? `TCL ${g.tcl_range_kw} kW` : 'SLD';
        const qty = g.total_qty || g.per_floor_qty || 1;
        lineRow(ws, r++, `${prefix}.${i + 1}`,
          `${g.tag_pattern}: Flush/surface-mounted DB, TP incomer MCCB, outgoing MCBs per DEWA requirements. IP4X. Supply, install, test & commission.`,
          ref, 'Nr', qty, g.per_floor_qty != null ? `${g.per_floor_qty}/floor × ${g.floors} floors` : '', i % 2 === 1);
      });
      subTotalRow(ws, r, `Sub-Total ${prefix}`, first, r - 1);
      r += 2;
    };

    renderGroup('B1 — RESIDENTIAL FLOOR DISTRIBUTION BOARDS', groups.typical, 'B1');
    renderGroup('B2 — GROUND FLOOR DISTRIBUTION BOARDS', groups.ground, 'B2');
    renderGroup('B3 — ROOF, SERVICES & SPECIALIST DISTRIBUTION BOARDS', groups.roof, 'B3');
    renderGroup('B4 — EMERGENCY DISTRIBUTION BOARDS', groups.emergency, 'B4');
    renderGroup('B5 — OTHER DISTRIBUTION BOARDS', groups.other, 'B5');
  } else if (e?.db_inventory?.length) {
    bandRow(ws, r++, 'B1 — DISTRIBUTION BOARDS (per cable schedule)');
    const first = r;
    e.db_inventory.forEach((db, i) => {
      lineRow(ws, r++, `B1.${i + 1}`,
        `${db.db_id}: Distribution board fed from ${db.smdb_id}, ${db.rating_a ? `${db.rating_a}A TP` : 'TP'} incomer. ${db.cable_size || ''}`,
        'SLD', 'Nr', 1, db.floor || '', i % 2 === 1);
    });
    subTotalRow(ws, r, 'Sub-Total B1', first, r - 1);
    r += 2;
  } else {
    bandRow(ws, r++, 'B — Distribution Boards (no take-off data — populate from cable schedule)');
  }

  return sectionTotalRow(ws, r, 'B', 4, r - 1);
}

// ─── Section C — Main Cables (LV → SMDB) ──────────────────────────────────
function buildSheetC(ws, meta, e, opts) {
  setSectionHeader(ws, 'C', 'LV POWER CABLES — MAIN & RISING MAINS (LV Panel to SMDBs)', meta);
  let r = 4;

  const cables = e?.cable_schedule || [];
  const lvTags = new Set((e?.lv_panels || []).map(p => p.tag));
  const lvCables = cables.filter(c => lvTags.has(c.from) || /^(LVP|LV-?\d|MDB)/i.test(c.from || ''));

  const xlpe = lvCables.filter(c => !isFireRated(c));
  const fr   = lvCables.filter(c => isFireRated(c));

  if (xlpe.length) {
    bandRow(ws, r++, 'C1 — XLPE/SWA/PVC LV CABLES (LV Panel to SMDB) — Supply & Install incl. fixings, glands, terminations');
    const first = r;
    xlpe.forEach((c, i) => {
      const cores = c.cores || 4;
      lineRow(ws, r++, `C1.${i + 1}`,
        `${cores}C × ${c.size_mm2}mm² XLPE/SWA/PVC 600/1000V armoured cable — ${c.from} to ${c.to}${c.circuit_description ? ` (${c.circuit_description})` : ''}. Installed in cable tray/ladder. Incl. cable glands, lugs, ferrules and terminations at both ends.`,
        e?.schematic_filename || 'SLD', 'm', Math.round(c.length_m || 0),
        '', i % 2 === 1);
    });
    subTotalRow(ws, r, 'Sub-Total C1 (XLPE/SWA)', first, r - 1);
    r += 2;
  }

  if (fr.length) {
    bandRow(ws, r++, 'C2 — FIRE-RATED (FR) CABLES — Emergency & Fire Services Rising Mains');
    const first = r;
    fr.forEach((c, i) => {
      const cores = c.cores || 4;
      lineRow(ws, r++, `C2.${i + 1}`,
        `${cores}C × ${c.size_mm2}mm² Fire-Rated (BS6387 CWZ / IEC 60331) cable — ${c.from} to ${c.to}${c.circuit_description ? ` (${c.circuit_description})` : ''}. Installed in dedicated fire-rated conduit/tray.`,
        'SLD', 'm', Math.round(c.length_m || 0),
        '', i % 2 === 1);
    });
    subTotalRow(ws, r, 'Sub-Total C2 (Fire Rated)', first, r - 1);
    r += 2;
  }

  // ECC allowance — derived from main cable lengths (~80% of total)
  const totalMain = lvCables.reduce((s, c) => s + (Number(c.length_m) || 0), 0);
  if (totalMain > 0) {
    bandRow(ws, r++, 'C3 — EARTH CONTINUITY CONDUCTORS (ECC) for Rising Mains');
    const first = r;
    lineRow(ws, r++, 'C3.1',
      '1C × 35mm² bare/green-yellow XLPE ECC — alongside fire-rated cables.', 'SLD', 'm',
      Math.round(fr.reduce((s, c) => s + (Number(c.length_m) || 0), 0)), 'Allow per FR run', false);
    lineRow(ws, r++, 'C3.2',
      '1C × 10mm²–70mm² bare/green-yellow XLPE ECC — alongside all XLPE rising mains. (Allow per run)',
      'SLD', 'm', Math.round(totalMain * 0.85), 'Estimate — confirm per run', true);
    subTotalRow(ws, r, 'Sub-Total C3 (ECC)', first, r - 1);
    r += 2;
  }

  return sectionTotalRow(ws, r, 'C', 4, r - 1);
}

function isFireRated(c) {
  const t = (c.type || '').toLowerCase();
  const d = (c.circuit_description || '').toLowerCase();
  return /fire|fr|cwz|emerg/i.test(t) || /fire pump|emergency|fire alarm|essential|esmdb/i.test(d);
}

// ─── Section D — Distribution Cables (SMDB → DB) ──────────────────────────
function buildSheetD(ws, meta, e, opts) {
  setSectionHeader(ws, 'D', 'LV POWER CABLES — DISTRIBUTION (SMDB to DB)', meta);
  let r = 4;

  // Use smdb_to_db_cables when present; otherwise fall back to filtering the
  // unified cable_schedule for entries whose source is NOT an LV main panel.
  let cables = e?.smdb_to_db_cables || [];
  if (!cables.length) {
    const lvTags = new Set((e?.lv_panels || []).map(p => p.tag));
    cables = (e?.cable_schedule || []).filter(c => {
      const f = c.from || '';
      const isLv = lvTags.has(f) || /^(LVP|LV-?\d|MDB)/i.test(f);
      return !isLv;
    });
  }

  if (cables.length) {
    // Bucket by emergency vs normal based on the source SMDB id
    const emergency = cables.filter(c => /^E|^ESMDB|emergency/i.test(c.from));
    const normal    = cables.filter(c => !emergency.includes(c));

    if (normal.length) {
      bandRow(ws, r++, 'D1 — XLPE/SWA/PVC DISTRIBUTION CABLES — SMDB to DB');
      const first = r;
      normal.forEach((c, i) => {
        const cores = c.cores || 4;
        lineRow(ws, r++, `D1.${i + 1}`,
          `${cores}C × ${c.size_mm2}mm² XLPE/SWA/PVC 600/1000V armoured cable — ${c.from} to ${c.to}.`,
          'SLD', 'm', Math.round(c.length_m || 0),
          '', i % 2 === 1);
      });
      subTotalRow(ws, r, 'Sub-Total D1', first, r - 1);
      r += 2;
    }

    if (emergency.length) {
      bandRow(ws, r++, 'D2 — EMERGENCY DISTRIBUTION CABLES (Fire Rated)');
      const first = r;
      emergency.forEach((c, i) => {
        const cores = c.cores || 4;
        lineRow(ws, r++, `D2.${i + 1}`,
          `${cores}C × ${c.size_mm2}mm² Fire-Rated cable — ${c.from} to ${c.to}.`,
          'SLD', 'm', Math.round(c.length_m || 0),
          '', i % 2 === 1);
      });
      subTotalRow(ws, r, 'Sub-Total D2', first, r - 1);
      r += 2;
    }
  }

  // Bulk cables (final-circuit aggregated lengths — e.g. 1.5/2.5/4/6 mm² Cu/PVC)
  if (e?.bulk_cables?.length) {
    bandRow(ws, r++, 'D3 — FINAL CIRCUIT CABLES (Aggregated by size)');
    const first = r;
    e.bulk_cables.forEach((b, i) => {
      lineRow(ws, r++, `D3.${i + 1}`, b.specification, 'SLD', 'm',
        Math.round(b.estimated_length_m || 0), b.application, i % 2 === 1);
    });
    subTotalRow(ws, r, 'Sub-Total D3 (Final Circuits)', first, r - 1);
    r += 2;
  }

  if (r === 4) {
    bandRow(ws, r++, 'D — Distribution Cables (no take-off data)');
  }

  return sectionTotalRow(ws, r, 'D', 4, r - 1);
}

// ─── Section E — Cable Management ─────────────────────────────────────────
function buildSheetE(ws, meta, e, opts) {
  setSectionHeader(ws, 'E', 'CABLE MANAGEMENT — TRAYS, LADDERS & CONDUITS', meta);
  let r = 4;
  const items = e?.containment || [];
  if (items.length) {
    bandRow(ws, r++, 'E1 — CABLE TRAYS, LADDERS & CONDUITS');
    const first = r;
    items.forEach((c, i) => {
      lineRow(ws, r++, `E1.${i + 1}`,
        `${c.description}, c/w supports, brackets, bends, tees, fixings.`,
        'SLD', c.unit || 'm', Math.round(c.estimated_qty || 0), '', i % 2 === 1);
    });
    subTotalRow(ws, r, 'Sub-Total E1', first, r - 1);
    r += 2;
  } else {
    bandRow(ws, r++, 'E — Cable Management (no take-off data)');
  }
  return sectionTotalRow(ws, r, 'E', 4, r - 1);
}

// ─── Section F — Earthing & Bonding ───────────────────────────────────────
function buildSheetF(ws, meta, e, opts) {
  setSectionHeader(ws, 'F', 'EARTHING & BONDING', meta);
  let r = 4;
  const items = e?.earthing || [];
  if (items.length) {
    bandRow(ws, r++, 'F1 — MAIN EARTHING SYSTEM');
    const first = r;
    items.forEach((it, i) => {
      lineRow(ws, r++, `F1.${i + 1}`, it.description, 'SLD',
        it.unit || 'Nr', Math.round(it.qty || 0), '', i % 2 === 1);
    });
    subTotalRow(ws, r, 'Sub-Total F1', first, r - 1);
    r += 2;
  } else {
    bandRow(ws, r++, 'F — Earthing & Bonding (use defaults)');
    const first = r;
    const defaults = [
      ['Main earth bar (MEB) in LV room — 50×6mm copper busbar.', 'Nr', 2],
      ['Earth pit (BS 7430 / DEWA) — 1200mm copper-bonded steel rod, inspection chamber, backfill, conductor clamp. Resistance test < 1 Ω.', 'Nr', 4],
      ['1C × 95mm² bare copper earth conductor — MEB to earth pits and DEWA earth terminal.', 'm', 30],
      ['1C × 50mm² green/yellow PVC earth conductor — MEB to structural steel bonding points.', 'm', 40],
      ['Supplementary bonding conductor — 4mm² green/yellow to all metallic pipework, trays, equipment frames. Provisional sum.', 'Sum', 1],
    ];
    defaults.forEach((d, i) => lineRow(ws, r++, `F1.${i + 1}`, d[0], 'DEWA', d[1], d[2], '', i % 2 === 1));
    subTotalRow(ws, r, 'Sub-Total F1', first, r - 1);
    r += 2;
  }
  return sectionTotalRow(ws, r, 'F', 4, r - 1);
}

// ─── Section G — Sundries & T&C (universal template) ──────────────────────
function buildSheetG(ws, meta, e, opts) {
  setSectionHeader(ws, 'G', 'SUNDRIES, ACCESSORIES & TESTING/COMMISSIONING', meta);
  let r = 4;

  bandRow(ws, r++, 'G1 — ACCESSORIES & SUNDRIES');
  let first = r;
  const sundries = [
    ['Cable identification labels — self-adhesive ferrules at both ends. Include as-installed labelling matching cable schedule.', 'Sum', 1],
    ['Cable cleats and ties — stainless steel, max 400mm spacing on vertical runs and 900mm on horizontal.', 'Sum', 1],
    ['Fire stopping — intumescent compounds, collars, pillows at all cable penetrations through fire-rated walls/slabs/risers. Restore fire rating.', 'Sum', 1],
    ['Smoke / fire barriers at all electrical-riser floor penetrations — proprietary fire-rated barrier system. Allow per floor.', 'Nr', 12],
    ['Temporary power supply during construction — provisional sum.', 'Sum', 1],
  ];
  sundries.forEach((d, i) => lineRow(ws, r++, `G1.${i + 1}`, d[0], '—', d[1], d[2], '', i % 2 === 1));
  subTotalRow(ws, r, 'Sub-Total G1', first, r - 1);
  r += 2;

  bandRow(ws, r++, 'G2 — TESTING & COMMISSIONING');
  first = r;
  const tnc = [
    ['Insulation resistance testing (500V Megger) of all LV cables. Report included.', 'Sum', 1],
    ['Continuity and polarity testing of all circuits.', 'Sum', 1],
    ['Earth fault loop impedance testing at all boards.', 'Sum', 1],
    ['RCD testing at all RCD-protected circuits.', 'Sum', 1],
    ['ATS changeover testing — simulate mains failure, verify auto-switchover. Include full load test.', 'Sum', 1],
    ['Power factor correction verification — record PF before/after capacitor bank energisation.', 'Sum', 1],
    ['Full DEWA inspection and approval — application fees, inspections, rectifications until final approval. Provisional sum.', 'Sum', 1],
    ['As-built drawings (AutoCAD + PDF) and O&M Manuals — full set for LV distribution system.', 'Sum', 1],
  ];
  tnc.forEach((d, i) => lineRow(ws, r++, `G2.${i + 1}`, d[0], 'DEWA/IEC', d[1], d[2], '', i % 2 === 1));
  subTotalRow(ws, r, 'Sub-Total G2', first, r - 1);
  r += 2;

  return sectionTotalRow(ws, r, 'G', 4, r - 1);
}

// ─── Summary sheet ────────────────────────────────────────────────────────
function buildSummary(ws, meta, totals, opts) {
  // Match template column widths exactly: [10, 52, 14, 20, 45, 5]
  ws.columns = [
    { width: 10 }, { width: 52 }, { width: 14 }, { width: 20 }, { width: 45 }, { width: 5 },
  ];

  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 4, topLeftCell: 'A5', activeCell: 'A5' }];
  ws.pageSetup = {
    paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    horizontalCentered: true,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
  };
  ws.headerFooter = {
    oddHeader: `&L&"Arial,Bold"&12${meta.project_name}&R&"Arial,Italic"&10Job ${meta.job_no || ''}`,
    oddFooter: `&LBOQ Summary&RPage &P of &N`,
  };

  ws.mergeCells('A1:E1');
  ws.getCell('A1').value = 'BILL OF QUANTITIES — SUMMARY';
  ws.getCell('A1').style = STYLE.titleBar;
  ws.getRow(1).height = 27.75;

  ws.mergeCells('A2:E2');
  ws.getCell('A2').value = `${meta.project_name} | Plot ${meta.plot_no || '—'}, ${meta.location} | ${meta.job_no || ''}`;
  ws.getCell('A2').style = { ...STYLE.body, font: { ...FONT_BASE, italic: true, size: 9 }, alignment: { vertical: 'middle', horizontal: 'center' } };
  ws.getRow(2).height = 18;

  // Header row
  const head = ['Section', 'Description', 'Sheet Ref', 'Sub-Total (AED)', 'Notes'];
  head.forEach((h, i) => {
    const cell = ws.getRow(4).getCell(i + 1);
    cell.value = h;
    cell.style = STYLE.tableHead;
  });
  ws.getRow(4).height = 27.75;

  const sections = [
    ['A', 'LV Switchgear & Sub-Main Distribution Boards (SMDBs)', 'Sheet A', totals.A, 'LV panels, ATS, gen, SMDBs'],
    ['B', 'Distribution Boards (DBs) & Consumer Units',            'Sheet B', totals.B, 'Apt + comm + retail + emerg'],
    ['C', 'LV Power Cables — Main & Rising Mains (LV→SMDB)',        'Sheet C', totals.C, 'XLPE/SWA + Fire-Rated + ECC'],
    ['D', 'LV Power Cables — Distribution (SMDB→DB)',                'Sheet D', totals.D, 'Distribution cables + bulk'],
    ['E', 'Cable Management — Trays, Ladders & Conduits',            'Sheet E', totals.E, 'GI ladder, tray, conduit'],
    ['F', 'Earthing & Bonding',                                      'Sheet F', totals.F, 'Earth pits, MEB, conductors'],
    ['G', 'Sundries, Accessories & T&C',                             'Sheet G', totals.G, 'Labels, fire stop, T&C, DEWA'],
  ];
  let r = 5;
  sections.forEach(([k, d, s, totalRow, n], i) => {
    const row = ws.getRow(r);
    row.getCell(1).value = k;
    row.getCell(2).value = d;
    row.getCell(3).value = s;
    // Cross-sheet formula referencing the section TOTAL row.
    row.getCell(4).value = { formula: `'${sheetNameFor(k)}'!G${totalRow}`, result: 0 };
    row.getCell(4).numFmt = AED_FMT;
    row.getCell(5).value = n;
    const sty = i % 2 === 1 ? STYLE.bodyAlt : STYLE.body;
    for (let c = 1; c <= 5; c++) row.getCell(c).style = sty;
    row.getCell(4).alignment = { horizontal: 'right', vertical: 'middle' };
    r++;
  });

  // Sub-total / contingency / VAT / grand total
  const subTotalRowIdx = r;
  ws.mergeCells(`A${r}:C${r}`);
  ws.getCell(`A${r}`).value = 'SUB-TOTAL (Sections A–G)';
  ws.getCell(`A${r}`).style = STYLE.subTotal;
  ws.getCell(`D${r}`).value = { formula: `SUM(D5:D${r - 1})`, result: 0 };
  ws.getCell(`D${r}`).style = { ...STYLE.subTotal, alignment: { horizontal: 'right' } };
  ws.getCell(`D${r}`).numFmt = AED_FMT;
  ws.getCell(`E${r}`).value = '';
  ws.getCell(`E${r}`).style = STYLE.subTotal;
  r++;

  const contRowIdx = r;
  ws.mergeCells(`A${r}:C${r}`);
  ws.getCell(`A${r}`).value = `Contingency (${(opts.contingency_pct * 100).toFixed(0)}%)`;
  ws.getCell(`A${r}`).style = STYLE.subTotal;
  ws.getCell(`D${r}`).value = { formula: `D${subTotalRowIdx}*${opts.contingency_pct}`, result: 0 };
  ws.getCell(`D${r}`).style = { ...STYLE.subTotal, alignment: { horizontal: 'right' } };
  ws.getCell(`D${r}`).numFmt = AED_FMT;
  ws.getCell(`E${r}`).value = '';
  ws.getCell(`E${r}`).style = STYLE.subTotal;
  r++;

  const vatRowIdx = r;
  ws.mergeCells(`A${r}:C${r}`);
  ws.getCell(`A${r}`).value = `VAT (${(opts.vat_pct * 100).toFixed(0)}%)`;
  ws.getCell(`A${r}`).style = STYLE.subTotal;
  ws.getCell(`D${r}`).value = { formula: `(D${subTotalRowIdx}+D${contRowIdx})*${opts.vat_pct}`, result: 0 };
  ws.getCell(`D${r}`).style = { ...STYLE.subTotal, alignment: { horizontal: 'right' } };
  ws.getCell(`D${r}`).numFmt = AED_FMT;
  ws.getCell(`E${r}`).value = '';
  ws.getCell(`E${r}`).style = STYLE.subTotal;
  r++;

  ws.mergeCells(`A${r}:C${r}`);
  ws.getCell(`A${r}`).value = 'GRAND TOTAL (incl. Contingency & VAT)';
  ws.getCell(`A${r}`).style = STYLE.sectionTotal;
  ws.getCell(`D${r}`).value = { formula: `D${subTotalRowIdx}+D${contRowIdx}+D${vatRowIdx}`, result: 0 };
  ws.getCell(`D${r}`).style = { ...STYLE.sectionTotal, alignment: { horizontal: 'right' } };
  ws.getCell(`D${r}`).numFmt = AED_FMT;
  ws.getCell(`E${r}`).value = '';
  ws.getCell(`E${r}`).style = STYLE.sectionTotal;
  ws.getRow(r).height = 26;
  r += 2;

  ws.mergeCells(`A${r}:E${r}`);
  ws.getCell(`A${r}`).value = 'INSTRUCTIONS: Enter unit rates (AED) in column F of each section sheet. Per-row Amounts and section totals roll up here automatically.';
  ws.getCell(`A${r}`).style = { ...STYLE.body, font: { italic: true, size: 9 } };
  ws.getRow(r).height = 28;
}

function sheetNameFor(letter) {
  return {
    A: 'A - Switchgear & SMDBs',
    B: 'B - Distribution Boards',
    C: 'C - Main Cables (LV to SMDB)',
    D: 'D - Distribution Cables',
    E: 'E - Cable Management',
    F: 'F - Earthing & Bonding',
    G: 'G - Sundries & T&C',
  }[letter];
}
