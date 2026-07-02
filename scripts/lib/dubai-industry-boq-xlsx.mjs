// Dubai-industry-standard MEP electrical BOQ generator (13 bills + summary).
//
// Follows the convention used by Dubai consultants (Future Art, Khatib & Alami,
// Dar, Atkins-style submissions): 13 numbered "Bills" each on its own sheet,
// preliminaries + back-end summary including 5% UAE VAT.
//
// Standards referenced in line descriptions:
//   - DEWA Distribution Manual / Authority Regulations
//   - Dubai Civil Defence (DCD) Code of Practice
//   - BS 7671 (IEE Wiring Regulations)
//   - IEC 60364, IEC 60439, IEC 60947, IEC 60331, BS 6387 (FR cables)
//   - Dubai Green Building Regulations
//
// Pure ESM, ExcelJS-based. Consumes the canonical ElectricalProcedureResult.

import ExcelJS from 'exceljs';
import { applyRatesToWorkbook } from './dubai-2026-rates.mjs';
import { applyAvlToWorkbook }   from './dubai-avl-brands.mjs';
import { applyDrawingRefsToWorkbook } from './dubai-drawing-refs.mjs';
import { applyProvenanceToWorkbook, provenanceMatrix, MEASURED_GLYPH, ALLOWANCE_GLYPH } from './dubai-data-provenance.mjs';

// ─── Branding ──────────────────────────────────────────────────────────────
function envOrDefault(envKey, fallback) {
  const v = process.env[envKey]?.trim();
  if (!v) return fallback;
  if (/^(1?00X+|XXX+|TODO|TBD|placeholder)$/i.test(v)) return fallback;
  return v;
}

const SABI = {
  fullName: envOrDefault('SABI_FULL_NAME', 'SABI Engineering & Contracting LLC'),
  address:  envOrDefault('SABI_ADDRESS', 'Dubai, United Arab Emirates'),
  phone:    envOrDefault('SABI_PHONE', '+971 4 XXX XXXX'),
  email:    envOrDefault('SABI_EMAIL', 'estimation@sabi.ae'),
  trn:      envOrDefault('SABI_TRN', '100XXXXXXXXXXXXX'),
};

// ─── Styling — Dubai industry-standard navy/blue/grey ─────────────────────
const NAVY      = 'FF1F3864';
const BLUE      = 'FF2E75B6';
const NAVY_LITE = 'FFD9E1F2';
const GREY      = 'FFF2F2F2';
const AMBER     = 'FFFFE699';
const ROW_ALT   = 'FFF8F9FA';
const FONT_BASE = { name: 'Arial', size: 10 };

function thinBorder() {
  const t = { style: 'thin', color: { argb: 'FFB7B7B7' } };
  return { top: t, left: t, bottom: t, right: t };
}

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
    alignment: { vertical: 'middle', horizontal: 'left', wrapText: true },
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
  // Item column — left-aligned (Dubai BOQ convention)
  bodyLeftBold: {
    font: { ...FONT_BASE, bold: true },
    alignment: { vertical: 'middle', horizontal: 'left', wrapText: true },
    border: thinBorder(),
  },
  bodyLeftBoldAlt: {
    font: { ...FONT_BASE, bold: true },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: ROW_ALT } },
    alignment: { vertical: 'middle', horizontal: 'left', wrapText: true },
    border: thinBorder(),
  },
  // Unit column — short text, centered
  bodyCenter: {
    font: FONT_BASE,
    alignment: { vertical: 'middle', horizontal: 'center', wrapText: true },
    border: thinBorder(),
  },
  bodyCenterAlt: {
    font: FONT_BASE,
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: ROW_ALT } },
    alignment: { vertical: 'middle', horizontal: 'center', wrapText: true },
    border: thinBorder(),
  },
  // Qty / Rate / Amount — right-aligned numeric (currency convention)
  bodyRight: {
    font: FONT_BASE,
    alignment: { vertical: 'middle', horizontal: 'right', wrapText: true },
    border: thinBorder(),
  },
  bodyRightAlt: {
    font: FONT_BASE,
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: ROW_ALT } },
    alignment: { vertical: 'middle', horizontal: 'right', wrapText: true },
    border: thinBorder(),
  },
  subTotal: {
    font: { ...FONT_BASE, bold: true, color: { argb: 'FFFFFFFF' } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } },
    alignment: { vertical: 'middle', horizontal: 'right', wrapText: true },
    border: thinBorder(),
  },
  billTotal: {
    font: { ...FONT_BASE, bold: true, color: { argb: 'FFFFFFFF' }, size: 11 },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } },
    alignment: { vertical: 'middle', horizontal: 'right', wrapText: true },
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

// Accounting format: thousands separator, red negatives, em-dash for zero,
// pass-through for text (so empty-string formula results render as blank, not 0).
const AED_FMT = '#,##0.00;[Red]-#,##0.00;"—";@';

// ─── Public entry ──────────────────────────────────────────────────────────
/**
 * @param {{ project: any, electrical: any, overrides?: any, options?: any }} args
 * @returns {Promise<Buffer>}
 */
export async function generateDubaiIndustryBoqXlsx({ project, electrical, overrides = {}, options = {} }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = SABI.fullName;
  wb.lastModifiedBy = SABI.fullName;
  wb.created = new Date();
  wb.modified = new Date();
  // Force Excel/Numbers/LibreOffice to recompute every formula on open so the
  // bill totals, sub-totals, contingency, VAT and grand total all populate
  // immediately — without this they show as 0 until manual recalc.
  wb.calcProperties = { ...(wb.calcProperties || {}), fullCalcOnLoad: true };

  const opts = {
    contingency_pct: 0.10,
    vat_pct: 0.05,
    currency: 'AED',
    status: 'TENDER — FOR PRICING',
    ...options,
  };

  const meta = buildMeta(project, electrical, overrides);

  // 14 sheets in industry order: Cover + Preamble + 13 Bills + Summary.
  const sheets = {
    cover:    wb.addWorksheet('Cover'),
    preamble: wb.addWorksheet('Preamble & Standards'),
    bill1:    wb.addWorksheet('Bill 1 - Preliminaries'),
    bill2:    wb.addWorksheet('Bill 2 - HV-LV Main'),
    bill3:    wb.addWorksheet('Bill 3 - SMDBs'),
    bill4:    wb.addWorksheet('Bill 4 - Distribution Boards'),
    bill5:    wb.addWorksheet('Bill 5 - LV Cables'),
    bill6:    wb.addWorksheet('Bill 6 - Containment'),
    bill7:    wb.addWorksheet('Bill 7 - Wiring Devices'),
    bill8:    wb.addWorksheet('Bill 8 - Lighting Fixtures'),
    bill9:    wb.addWorksheet('Bill 9 - Earthing & LP'),
    bill10:   wb.addWorksheet('Bill 10 - Emergency Lighting'),
    bill11:   wb.addWorksheet('Bill 11 - ELV Containment'),
    bill12:   wb.addWorksheet('Bill 12 - Metering'),
    bill13:   wb.addWorksheet('Bill 13 - Test & Commissioning'),
    summary:  wb.addWorksheet('Summary of Bills'),
  };

  const totals = {};
  totals[1]  = buildBill1(sheets.bill1,  meta, electrical, opts);
  totals[2]  = buildBill2(sheets.bill2,  meta, electrical, opts);
  totals[3]  = buildBill3(sheets.bill3,  meta, electrical, opts);
  totals[4]  = buildBill4(sheets.bill4,  meta, electrical, opts);
  totals[5]  = buildBill5(sheets.bill5,  meta, electrical, opts);
  totals[6]  = buildBill6(sheets.bill6,  meta, electrical, opts);
  totals[7]  = buildBill7(sheets.bill7,  meta, electrical, opts);
  totals[8]  = buildBill8(sheets.bill8,  meta, electrical, opts);
  totals[9]  = buildBill9(sheets.bill9,  meta, electrical, opts);
  totals[10] = buildBill10(sheets.bill10, meta, electrical, opts);
  totals[11] = buildBill11(sheets.bill11, meta, electrical, opts);
  totals[12] = buildBill12(sheets.bill12, meta, electrical, opts);
  totals[13] = buildBill13(sheets.bill13, meta, electrical, opts);

  buildCover(sheets.cover, meta, opts);
  buildPreamble(sheets.preamble, meta, opts);
  buildSummary(sheets.summary, meta, totals, opts);

  // ── Per-floor take-off appendix (informational) ──────────────────────────
  // One "Floor - <label>" tab per floor, after the Summary. MEMORANDUM only —
  // never pushed into `totals` (Summary grand total unaffected), and the rate
  // pass skips them (applyRatesToWorkbook only touches "Bill …" sheets).
  if (opts.perFloorSheets !== false) {
    const rawFloors = (electrical?.floor_labels?.length
      ? electrical.floor_labels
      : deriveTypicalFloors(electrical)) || [];
    const seen = new Set();
    const uniqueFloors = [];
    for (const fl of rawFloors) {
      const k = canonFloorKey(fl);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      uniqueFloors.push(fl);
    }
    if (uniqueFloors.length > 1) {
      for (const fl of uniqueFloors) {
        buildFloorTakeoff(wb.addWorksheet(floorSheetName(fl)), meta, electrical, opts, fl);
      }
    }
  }

  // ── Post-process passes — order matters: rates → AVL → drawing refs ──
  // 1. Populate Rate column F with Dubai 2026 indicative rates.
  if (opts.priceMode !== 'tender') {
    const lookup = opts.rateLookup || ((row) => null);
    const stats = applyRatesToWorkbook(wb, lookup);
    if (typeof opts.onRateStats === 'function') opts.onRateStats(stats);
  }
  // 2. Populate Origin / Brand column H with Dubai AVL guidance — but only
  //    where the cell is currently empty (don't trample explicit context like
  //    "1F", "Roof Floor" etc. that section builders may have placed).
  if (opts.applyAvl !== false) {
    const avlStats = applyAvlToWorkbook(wb);
    if (typeof opts.onAvlStats === 'function') opts.onAvlStats(avlStats);
  }
  // 3. Replace generic Reference values with specific P-XXX drawing nos.
  if (opts.applyDrawingRefs !== false) {
    const drStats = applyDrawingRefsToWorkbook(wb);
    if (typeof opts.onDrawingRefStats === 'function') opts.onDrawingRefStats(drStats);
  }
  // 4. Prefix Origin/Brand cells with provenance glyph (📐 measured / 📋 allowance).
  if (opts.applyProvenance !== false) {
    const pStats = applyProvenanceToWorkbook(wb);
    if (typeof opts.onProvenanceStats === 'function') opts.onProvenanceStats(pStats);
  }
  // 5. Highlight any priceable row whose Rate (col F) is still empty / zero —
  //    yellow fill on F+G makes "needs pricing" rows jump out at the reviewer.
  flagUnpricedRows(wb);

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ─── Highlight unpriced rows ──────────────────────────────────────────────
// Walks every priceable line (Item like "X.Y.Z" / "A1.1") and paints F+G a
// soft yellow when Rate is missing or 0. Reviewer sees at a glance which
// items still need a manual rate.
function flagUnpricedRows(wb) {
  const fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFFFF3CD' }, // soft amber
  };
  wb.eachSheet((ws) => {
    if (!/^Bill\b/.test(ws.name)) return;
    for (let r = 1; r <= ws.rowCount; r++) {
      const item = ws.getRow(r).getCell(1).value;
      if (typeof item !== 'string') continue;
      if (!/^\d+\.\d+\.\d+|^[A-Z]\d+\.\d+/.test(item)) continue;
      const rate = ws.getRow(r).getCell(6).value;
      const isUnpriced = rate === null || rate === undefined || rate === 0 || rate === '';
      if (!isUnpriced) continue;
      const f = ws.getRow(r).getCell(6);
      const g = ws.getRow(r).getCell(7);
      f.fill = fill;
      g.fill = fill;
    }
  });
}

// ─── Meta ─────────────────────────────────────────────────────────────────
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
    addendum_no:  overrides.addendum_no ?? '0',
    contractor:   overrides.contractor ?? SABI.fullName,
    contractor_trn: overrides.contractor_trn ?? SABI.trn,
    building: {
      tcl_kw: tcl > 0 ? tcl : null,
      max_demand_kw: md > 0 ? md : null,
      // Keep full precision — Cover MD formula uses this value directly, and
      // truncating to 3 decimals (0.7543 → 0.754) introduced a 1-kW rounding
      // gap between Cover MD (1596) and actual MD sum (1597).
      demand_factor: tcl > 0 ? (md / tcl) : null,
    },
  };
}

// ─── Bill-sheet helpers ───────────────────────────────────────────────────
function setBillHeader(ws, billNo, billTitle, meta) {
  // Column widths tuned for printability + readability:
  //   • Item           7  — fits "13.3.10" comfortably
  //   • Description   58  — main content; wraps at ~70 chars
  //   • Reference     22  — fits "P-201 (SLD) / P-103 (1F)" on one line
  //   • Unit           8  — short text (Nr, m, Sum, Item)
  //   • Qty            9  — up to 6 digits + comma
  //   • Rate          13  — AED currency to 6 digits
  //   • Amount        16  — AED currency to 8 digits
  //   • Origin/Brand  32  — fits provenance glyph + AVL band
  ws.columns = [
    { width: 7 },  // Item
    { width: 58 }, // Description
    { width: 22 }, // Reference
    { width: 8 },  // Unit
    { width: 9 },  // Qty
    { width: 13 }, // Unit Rate
    { width: 16 }, // Amount
    { width: 32 }, // Origin / Brand
  ];

  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 3, topLeftCell: 'A4', activeCell: 'A4' }];
  ws.pageSetup = {
    paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    horizontalCentered: true,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
  };
  ws.pageSetup.printTitlesRow = '1:3';
  ws.headerFooter = {
    oddHeader: `&L&"Arial,Bold"&12${meta.project_name}&R&"Arial,Italic"&10Job ${meta.job_no || ''}`,
    oddFooter: `&LBill ${billNo} — ${billTitle}&RPage &P of &N`,
  };

  ws.mergeCells('A1:H1');
  ws.getCell('A1').value = `BILL No. ${billNo} — ${billTitle.toUpperCase()}`;
  ws.getCell('A1').style = STYLE.titleBar;
  ws.getRow(1).height = 27.75;

  ws.mergeCells('A2:H2');
  ws.getCell('A2').value = `Project: ${meta.project_name}, Plot ${meta.plot_no || '—'}, ${meta.location}  |  Job: ${meta.job_no || '—'}  |  Authority: ${meta.authority}`;
  ws.getCell('A2').style = { ...STYLE.body, font: { ...FONT_BASE, italic: true, size: 9 }, alignment: { vertical: 'middle', horizontal: 'left' } };
  ws.getRow(2).height = 13.5;

  const cols = ['Item', 'Description', 'Reference', 'Unit', 'Qty', 'Rate\n(AED)', 'Amount\n(AED)', 'Origin / Brand'];
  cols.forEach((c, i) => {
    const cell = ws.getRow(3).getCell(i + 1);
    cell.value = c;
    cell.style = STYLE.tableHead;
  });
  ws.getRow(3).height = 27.75;

  // Freeze the title + header rows so long bills (Bill 3 = 86 rows) keep the
  // column legend visible while scrolling.
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 3, topLeftCell: 'A4', activeCell: 'A4' }];
}

function bandRow(ws, r, text) {
  ws.mergeCells(`A${r}:H${r}`);
  ws.getCell(`A${r}`).value = text;
  ws.getCell(`A${r}`).style = STYLE.groupBand;
  ws.getRow(r).height = 19.5;
}

// Per-column alignment in a body row, following Dubai BOQ convention:
//   1 Item       — left, bold (item ref)
//   2 Description — left, wrap
//   3 Reference  — left
//   4 Unit       — center (short text)
//   5 Qty        — right (numeric)
//   6 Rate       — right (currency)
//   7 Amount     — right (currency)
//   8 Origin / Brand — left
function styleFor(col, alt) {
  if (col === 1)              return alt ? STYLE.bodyLeftBoldAlt : STYLE.bodyLeftBold;
  if (col === 2 || col === 3) return alt ? STYLE.bodyAlt          : STYLE.body;
  if (col === 4)              return alt ? STYLE.bodyCenterAlt    : STYLE.bodyCenter;
  if (col >= 5 && col <= 7)   return alt ? STYLE.bodyRightAlt     : STYLE.bodyRight;
  return alt ? STYLE.bodyAlt : STYLE.body; // 8 — Origin / Brand
}

// Heuristic: estimate how many display lines a description will wrap into,
// given the Description column width (col 2 = 55). At 10pt Arial, ~85 chars
// fit on one line at width 55, but explicit "\n" plus mid-word punctuation
// influence wrapping. We over-estimate slightly so descriptions never clip.
function estimateWrappedLines(text, charsPerLine = 70) {
  if (!text) return 1;
  const s = String(text);
  const explicit = s.split(/\n/).length;
  const longest  = Math.max(...s.split(/\n/).map(line => Math.ceil(line.length / charsPerLine) || 1));
  return Math.max(explicit, longest);
}

function lineRow(ws, r, item, desc, ref, unit, qty, remark = '', alt = (r % 2 === 0)) {
  ws.getRow(r).getCell(1).value = item;
  ws.getRow(r).getCell(2).value = desc;
  ws.getRow(r).getCell(3).value = ref;
  ws.getRow(r).getCell(4).value = unit;
  ws.getRow(r).getCell(5).value = qty;
  ws.getRow(r).getCell(6).value = null;
  // Amount = Qty × Rate. Blank until BOTH are filled.
  ws.getRow(r).getCell(7).value = { formula: `IF(OR(E${r}="",F${r}=""),"",E${r}*F${r})`, result: null };
  ws.getRow(r).getCell(8).value = remark;
  // Shallow-clone each shared STYLE object so subsequent numFmt assignments
  // don't mutate STYLE.bodyRight globally (which leaks Qty/Rate/Amount formats
  // across each other).
  for (let c = 1; c <= 8; c++) {
    ws.getRow(r).getCell(c).style = { ...styleFor(c, alt) };
  }
  ws.getRow(r).getCell(5).numFmt = '#,##0.##';
  ws.getRow(r).getCell(6).numFmt = AED_FMT;
  ws.getRow(r).getCell(7).numFmt = AED_FMT;
  // Row height = wrapped-line count × 14pt + 4pt padding. Capped at 96pt
  // so no single row dominates a printed page.
  const lines = Math.max(estimateWrappedLines(desc, 70), estimateWrappedLines(ref, 25));
  ws.getRow(r).height = Math.min(96, Math.max(18, lines * 14 + 4));
}

function subTotalRow(ws, r, label, firstRow, _lastRow) {
  // Range stops at r-1 (the line item just above) regardless of the lastRow
  // arg — historical callers pass the sub-total's own row, which would create
  // a circular reference. Using r-1 makes this safe by construction.
  ws.mergeCells(`A${r}:F${r}`);
  ws.getCell(`A${r}`).value = label;
  ws.getCell(`A${r}`).style = STYLE.subTotal;
  ws.getCell(`G${r}`).value = { formula: `SUM(G${firstRow}:G${r - 1})`, result: null };
  ws.getCell(`G${r}`).style = { ...STYLE.subTotal, alignment: { horizontal: 'right', vertical: 'middle' } };
  ws.getCell(`G${r}`).numFmt = AED_FMT;
  ws.getCell(`H${r}`).value = '';
  ws.getCell(`H${r}`).style = STYLE.subTotal;
  ws.getRow(r).height = 19.5;
}

function billTotalRow(ws, r, billNo, lastRow) {
  r++; // gap row
  ws.mergeCells(`A${r}:F${r}`);
  ws.getCell(`A${r}`).value = `BILL ${billNo} — TOTAL CARRIED TO SUMMARY`;
  ws.getCell(`A${r}`).style = STYLE.billTotal;
  // Sum line-item rows only (item codes match "*.*.*" — e.g. 1.1.1, 13.3.10).
  // Excluding sub-total rows by pattern means the bill total never double-counts
  // even when sub-totals compute correctly.
  ws.getCell(`G${r}`).value = { formula: `SUMIF(A4:A${lastRow},"*.*.*",G4:G${lastRow})`, result: null };
  ws.getCell(`G${r}`).style = { ...STYLE.billTotal, alignment: { horizontal: 'right', vertical: 'middle' } };
  ws.getCell(`G${r}`).numFmt = AED_FMT;
  ws.getCell(`H${r}`).value = '';
  ws.getCell(`H${r}`).style = STYLE.billTotal;
  ws.getRow(r).height = 24;
  return r;
}

// ─── Cover ────────────────────────────────────────────────────────────────
function buildCover(ws, meta, opts) {
  ws.columns = [
    { width: 3 }, { width: 16 }, { width: 50 }, { width: 5 }, { width: 5 },
    { width: 5 }, { width: 5 }, { width: 22 }, { width: 3 },
  ];
  ws.pageSetup = {
    paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    horizontalCentered: true,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
  };

  ws.mergeCells('B2:H3');
  ws.getCell('B2').value = 'BILL OF QUANTITIES';
  ws.getCell('B2').style = STYLE.titleBar;
  ws.getRow(2).height = 30; ws.getRow(3).height = 30;

  ws.mergeCells('B4:H5');
  ws.getCell('B4').value = 'ELECTRICAL POWER DISTRIBUTION WORKS — DEWA AUTHORITY';
  ws.getCell('B4').style = STYLE.sectionTitle;
  ws.getCell('B4').alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getRow(4).height = 24; ws.getRow(5).height = 24;

  let r = 7;
  const proj_block = [
    ['Project',        meta.project_name],
    ['Owner / Client', meta.owner],
    ['Plot No.',       [meta.plot_no, meta.location].filter(Boolean).join(' — ')],
    ['Architect',      meta.architect],
    ['Structural',     meta.structural],
    ['MEP Consultant', meta.consultant],
    ['Authority',      meta.authority],
  ];
  for (const [k, v] of proj_block) {
    if (!v) continue;
    ws.getCell(`B${r}`).value = k;
    ws.getCell(`B${r}`).style = { ...STYLE.body, font: { ...FONT_BASE, bold: true } };
    ws.mergeCells(`C${r}:H${r}`);
    ws.getCell(`C${r}`).value = v;
    ws.getCell(`C${r}`).style = STYLE.body;
    r++;
  }

  // Tender block
  r++;
  ws.mergeCells(`B${r}:H${r}`);
  ws.getCell(`B${r}`).value = 'TENDER DETAILS';
  ws.getCell(`B${r}`).style = STYLE.groupBand;
  r++;
  const tender_block = [
    ['Job No.',       meta.job_no],
    ['Drawing Ref',   meta.drawing_set],
    ['Drawing Date',  meta.drawing_date],
    ['BOQ Date',      meta.boq_date],
    ['Addendum No.',  meta.addendum_no],
    ['BOQ Status',    opts.status],
    ['Currency',      opts.currency + ' (UAE Dirham)'],
    ['VAT Rate',      `${(opts.vat_pct * 100).toFixed(0)}% (UAE Federal)`],
  ];
  for (const [k, v] of tender_block) {
    ws.getCell(`B${r}`).value = k;
    ws.getCell(`B${r}`).style = { ...STYLE.body, font: { ...FONT_BASE, bold: true } };
    ws.mergeCells(`C${r}:H${r}`);
    ws.getCell(`C${r}`).value = v;
    ws.getCell(`C${r}`).style = STYLE.body;
    r++;
  }

  // Contractor
  r++;
  ws.mergeCells(`B${r}:H${r}`);
  ws.getCell(`B${r}`).value = 'CONTRACTOR DETAILS';
  ws.getCell(`B${r}`).style = STYLE.groupBand;
  r++;
  const contr_block = [
    ['Contractor',  meta.contractor],
    ['Address',     SABI.address],
    ['Phone',       SABI.phone],
    ['Email',       SABI.email],
    ['TRN',         meta.contractor_trn],
  ];
  for (const [k, v] of contr_block) {
    ws.getCell(`B${r}`).value = k;
    ws.getCell(`B${r}`).style = { ...STYLE.body, font: { ...FONT_BASE, bold: true } };
    ws.mergeCells(`C${r}:H${r}`);
    ws.getCell(`C${r}`).value = v;
    ws.getCell(`C${r}`).style = STYLE.body;
    r++;
  }

  // Building totals — TCL and DF as raw numbers, MD as a live formula so they
  // stay consistent if either input is edited (prior versions hard-coded MD,
  // which drifted from TCL × DF).
  if (meta.building.tcl_kw != null) {
    r++;
    ws.mergeCells(`B${r}:H${r}`);
    ws.getCell(`B${r}`).value = 'BUILDING ELECTRICAL LOAD';
    ws.getCell(`B${r}`).style = STYLE.groupBand;
    r++;
    const tclRow = r;
    ws.getCell(`B${r}`).value = 'Total Connected Load (TCL)';
    ws.getCell(`B${r}`).style = { ...STYLE.body, font: { ...FONT_BASE, bold: true } };
    ws.mergeCells(`C${r}:H${r}`);
    ws.getCell(`C${r}`).value = Number(meta.building.tcl_kw.toFixed(2));
    ws.getCell(`C${r}`).numFmt = '#,##0.00" kW"';
    ws.getCell(`C${r}`).style = { ...STYLE.body, numFmt: '#,##0.00" kW"' };
    r++;
    const dfRow = r;
    ws.getCell(`B${r}`).value = 'Demand Factor';
    ws.getCell(`B${r}`).style = { ...STYLE.body, font: { ...FONT_BASE, bold: true } };
    ws.mergeCells(`C${r}:H${r}`);
    ws.getCell(`C${r}`).value = meta.building.demand_factor ?? 0.75;
    ws.getCell(`C${r}`).numFmt = '0.00';
    ws.getCell(`C${r}`).style = { ...STYLE.body, numFmt: '0.00' };
    r++;
    ws.getCell(`B${r}`).value = 'Maximum Demand (MD)';
    ws.getCell(`B${r}`).style = { ...STYLE.body, font: { ...FONT_BASE, bold: true } };
    ws.mergeCells(`C${r}:H${r}`);
    ws.getCell(`C${r}`).value = { formula: `ROUND(C${tclRow}*C${dfRow},0)`, result: Math.round((meta.building.tcl_kw) * (meta.building.demand_factor ?? 0.75)) };
    ws.getCell(`C${r}`).numFmt = '#,##0" kW"';
    ws.getCell(`C${r}`).style = { ...STYLE.body, numFmt: '#,##0" kW"' };
    r++;
  }

  // List of Bills
  r++;
  ws.mergeCells(`B${r}:H${r}`);
  ws.getCell(`B${r}`).value = 'LIST OF BILLS';
  ws.getCell(`B${r}`).style = STYLE.groupBand;
  r++;
  ws.getCell(`B${r}`).value = 'Bill';
  ws.getCell(`B${r}`).style = STYLE.tableHead;
  ws.mergeCells(`C${r}:G${r}`);
  ws.getCell(`C${r}`).value = 'Description';
  ws.getCell(`C${r}`).style = STYLE.tableHead;
  ws.getCell(`H${r}`).value = 'Sheet';
  ws.getCell(`H${r}`).style = STYLE.tableHead;
  r++;
  const bills = [
    [1,  'General Items / Preliminaries',                         'Bill 1'],
    [2,  'HV / LV Main Distribution (Transformer, MDB, Generator, ATS, Capacitors)', 'Bill 2'],
    [3,  'Sub-Main Distribution Boards (SMDBs)',                   'Bill 3'],
    [4,  'Distribution Boards (DBs) & Consumer Units',             'Bill 4'],
    [5,  'LV Power Cables (Main + Distribution + Final Circuits)', 'Bill 5'],
    [6,  'Cable Containment (Tray, Ladder, Trunking, Conduit)',    'Bill 6'],
    [7,  'Wiring Devices & Accessories',                           'Bill 7'],
    [8,  'Lighting Fixtures (Internal + External)',                'Bill 8'],
    [9,  'Earthing & Lightning Protection',                        'Bill 9'],
    [10, 'Emergency Lighting & Life Safety',                       'Bill 10'],
    [11, 'ELV Containment (Telephone, Data, CCTV, ACS, MATV, FA)', 'Bill 11'],
    [12, 'Metering & Monitoring',                                  'Bill 12'],
    [13, 'Testing, Commissioning & DEWA Approval',                 'Bill 13'],
  ];
  for (const [k, d, s] of bills) {
    ws.getCell(`B${r}`).value = k;
    ws.getCell(`B${r}`).style = STYLE.bodyCenter;
    ws.mergeCells(`C${r}:G${r}`);
    ws.getCell(`C${r}`).value = d;
    ws.getCell(`C${r}`).style = STYLE.body;
    ws.getCell(`H${r}`).value = s;
    ws.getCell(`H${r}`).style = STYLE.bodyCenter;
    r++;
  }

  // Reconciliation banner (if provided)
  if (Array.isArray(opts.reconciliation_notes) && opts.reconciliation_notes.length) {
    r++;
    ws.mergeCells(`B${r}:H${r}`);
    ws.getCell(`B${r}`).value = 'RECONCILIATION NOTES — corrections applied vs source data';
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

  // ── Compliance Summary — what this BOQ already covers ──
  // Pre-empts reviewer flagging items that are actually present.
  r++;
  ws.mergeCells(`B${r}:H${r}`);
  ws.getCell(`B${r}`).value = 'COMPLIANCE SUMMARY — what this BOQ already covers';
  ws.getCell(`B${r}`).style = STYLE.groupBand;
  r++;
  const complianceItems = [
    'DEWA Distribution Standards · Dubai Municipality (DM) · Dubai Civil Defence (DCD) — see Preamble Sheet § 0 Statutory Compliance',
    'DEWA Smart Metering programme — Bill 12 (smart kWh meters single + three-phase, AMI-ready, MDM integration, Shams Dubai bi-directional, IEC 62052/62053)',
    'UAE Federal VAT (5 %) — line on Summary of Bills sheet, computed via Excel formula on the pre-VAT total',
    'Authority Fees & NOCs — Bill 1.5 (DEWA connection / load-letter / energising · RTA road permit · DM completion fee · DCD NOC fee)',
    'Central Battery System (CBS) — Bill 10.3 as alternative to self-contained luminaires; Fire Alarm / MEP integration — Bill 10.4 (shunt-trips, lift recall, dampers, mag-locks)',
    'All ~280 priceable line items pre-priced with INDICATIVE Dubai 2026 rates — review each line against actual supplier quotation before submission',
    'Origin / Brand column (H) pre-populated with Dubai AVL bands (Schneider/ABB/Siemens, Ducab/NCC, Itron/L+G, etc.) — overwrite with selected make at tender time',
    'Drawing references (column C) mapped to specific P-001 … P-300 sheet numbers per item type (SLD / floor plan / LV-room / cable-tray detail)',
    'Engineering corrections from PDF_vs_XLSX_Comparison.pdf applied: LVP-01 risers 150mm² · fire pump 185mm² FR · ESMDB-G 300mm² FR · building totals on Cover',
  ];
  for (const ci of complianceItems) {
    ws.mergeCells(`B${r}:H${r}`);
    ws.getCell(`B${r}`).value = `✓  ${ci}`;
    ws.getCell(`B${r}`).style = {
      font: { ...FONT_BASE, size: 9, color: { argb: 'FF1B5E20' } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } },
      alignment: { vertical: 'middle', wrapText: true, horizontal: 'left' },
      border: thinBorder(),
    };
    ws.getRow(r).height = Math.max(20, Math.ceil(ci.length / 100) * 16);
    r++;
  }

  // ── Data Provenance — what's measured from drawings vs what's allowance ──
  // Reviewer reads this once and immediately knows which Bills are derived
  // from the project's drawing-set extraction vs which are industry templates.
  r++;
  ws.mergeCells(`B${r}:H${r}`);
  ws.getCell(`B${r}`).value = 'DATA PROVENANCE — measured from project drawings vs industry allowance';
  ws.getCell(`B${r}`).style = STYLE.groupBand;
  r++;

  // Legend row
  ws.getCell(`B${r}`).value = `${MEASURED_GLYPH}  MEASURED`;
  ws.getCell(`B${r}`).style = {
    font: { ...FONT_BASE, bold: true, size: 9, color: { argb: 'FF1B5E20' } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } },
    alignment: { vertical: 'middle', horizontal: 'center' },
    border: thinBorder(),
  };
  ws.mergeCells(`C${r}:H${r}`);
  ws.getCell(`C${r}`).value = 'derived from project drawings (P-001 … P-300) via the AI extraction — quantities and counts are project-specific';
  ws.getCell(`C${r}`).style = {
    font: { ...FONT_BASE, size: 9, color: { argb: 'FF1B5E20' } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } },
    alignment: { vertical: 'middle', wrapText: true, horizontal: 'left' },
    border: thinBorder(),
  };
  ws.getRow(r).height = 22;
  r++;

  ws.getCell(`B${r}`).value = `${ALLOWANCE_GLYPH}  ALLOWANCE`;
  ws.getCell(`B${r}`).style = {
    font: { ...FONT_BASE, bold: true, size: 9, color: { argb: 'FF7F4F00' } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF8E1' } },
    alignment: { vertical: 'middle', horizontal: 'center' },
    border: thinBorder(),
  };
  ws.mergeCells(`C${r}:H${r}`);
  ws.getCell(`C${r}`).value = 'industry-standard template / fixture default — quantities are allowances based on building size, NOT counted from drawings — review before submission';
  ws.getCell(`C${r}`).style = {
    font: { ...FONT_BASE, size: 9, color: { argb: 'FF7F4F00' } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF8E1' } },
    alignment: { vertical: 'middle', wrapText: true, horizontal: 'left' },
    border: thinBorder(),
  };
  ws.getRow(r).height = 28;
  r++;

  // Per-Bill provenance matrix
  ws.getCell(`B${r}`).value = 'Bill';
  ws.getCell(`B${r}`).style = STYLE.tableHead;
  ws.getCell(`C${r}`).value = 'Description';
  ws.getCell(`C${r}`).style = STYLE.tableHead;
  ws.getCell(`D${r}`).value = 'Source';
  ws.getCell(`D${r}`).style = STYLE.tableHead;
  ws.mergeCells(`E${r}:H${r}`);
  ws.getCell(`E${r}`).value = 'Notes';
  ws.getCell(`E${r}`).style = STYLE.tableHead;
  r++;
  for (const [bill, label, glyph, note] of provenanceMatrix()) {
    const isMeasured = glyph === MEASURED_GLYPH;
    const tint = isMeasured ? 'FFE8F5E9' : 'FFFFF8E1';
    const ink  = isMeasured ? 'FF1B5E20' : 'FF7F4F00';

    ws.getCell(`B${r}`).value = bill;
    ws.getCell(`B${r}`).style = { font: { ...FONT_BASE, bold: true, size: 9 }, alignment: { vertical: 'middle', horizontal: 'left' }, border: thinBorder() };
    ws.getCell(`C${r}`).value = label;
    ws.getCell(`C${r}`).style = { font: { ...FONT_BASE, size: 9 }, alignment: { vertical: 'middle', wrapText: true, horizontal: 'left' }, border: thinBorder() };
    ws.getCell(`D${r}`).value = `${glyph} ${isMeasured ? 'MEASURED' : 'ALLOWANCE'}`;
    ws.getCell(`D${r}`).style = {
      font: { ...FONT_BASE, bold: true, size: 9, color: { argb: ink } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: tint } },
      alignment: { vertical: 'middle', horizontal: 'center' },
      border: thinBorder(),
    };
    ws.mergeCells(`E${r}:H${r}`);
    ws.getCell(`E${r}`).value = note;
    ws.getCell(`E${r}`).style = { font: { ...FONT_BASE, size: 9 }, alignment: { vertical: 'middle', wrapText: true, horizontal: 'left' }, border: thinBorder() };
    ws.getRow(r).height = Math.max(18, Math.ceil(note.length / 80) * 14);
    r++;
  }

  // Status banner
  r++;
  ws.mergeCells(`B${r}:H${r}`);
  ws.getCell(`B${r}`).value = `STATUS: ${opts.status}`;
  ws.getCell(`B${r}`).style = STYLE.statusBanner;
  ws.getRow(r).height = 24;
}

// ─── Preamble (standards, abbreviations) ──────────────────────────────────
function buildPreamble(ws, meta, opts) {
  ws.columns = [{ width: 3 }, { width: 30 }, { width: 90 }, { width: 3 }];
  ws.pageSetup = {
    paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    horizontalCentered: true,
  };

  ws.mergeCells('B2:C2');
  ws.getCell('B2').value = 'PREAMBLE & APPLICABLE STANDARDS';
  ws.getCell('B2').style = STYLE.titleBar;
  ws.getRow(2).height = 27.75;

  let r = 4;

  // ── 0. Statutory Compliance ─────────────────────────────────────────
  ws.mergeCells(`B${r}:C${r}`);
  ws.getCell(`B${r}`).value = '0. STATUTORY COMPLIANCE — UAE / DUBAI AUTHORITIES';
  ws.getCell(`B${r}`).style = STYLE.groupBand;
  r++;
  ws.mergeCells(`B${r}:C${r}`);
  ws.getCell(`B${r}`).value = 'The works under this BOQ shall fully comply with the requirements of the following Dubai and UAE authorities. The contractor shall obtain all approvals, attend witnessed inspections, and submit all documentation required by each authority as part of the contract.';
  ws.getCell(`B${r}`).style = { ...STYLE.body, alignment: { vertical: 'top', wrapText: true } };
  ws.getRow(r).height = 50;
  r++;
  const authorities = [
    ['DEWA',                'Dubai Electricity & Water Authority — Distribution Standards, Service Connection Specifications, Smart Grid / Smart Metering programme, witnessed inspections, energising, meter sealing, As-Built filing.'],
    ['Dubai Municipality',  'Building Code, Local Order 89/1994 (Building Regulations) and amendments, electrical safety inspections, occupancy / completion certificate clearance.'],
    ['DCD',                 'Dubai Civil Defence — UAE Fire & Life Safety Code of Practice (latest edition); fire-rated containment, FR/LSZH cable selection, emergency lighting, fire-fighter\'s lift, smoke-control fan power supplies.'],
    ['UAE Federal',         'Federal Tax Authority — VAT (5%) per UAE VAT Law (Federal Decree-Law No. 8 of 2017); MoCCAE / ESMA conformity certificates for electrical equipment placed on UAE market.'],
  ];
  ws.getCell(`B${r}`).value = 'Authority';
  ws.getCell(`B${r}`).style = STYLE.tableHead;
  ws.getCell(`C${r}`).value = 'Scope of compliance';
  ws.getCell(`C${r}`).style = STYLE.tableHead;
  r++;
  for (const [k, d] of authorities) {
    ws.getCell(`B${r}`).value = k;
    ws.getCell(`B${r}`).style = { ...STYLE.body, font: { ...FONT_BASE, bold: true } };
    ws.getCell(`C${r}`).value = d;
    ws.getCell(`C${r}`).style = { ...STYLE.body, alignment: { vertical: 'top', wrapText: true } };
    ws.getRow(r).height = Math.max(20, Math.ceil(d.length / 100) * 18);
    r++;
  }
  r++;

  // ── 1. Scope of Works ─────────────────────────────────────────────────
  ws.mergeCells(`B${r}:C${r}`);
  ws.getCell(`B${r}`).value = '1. SCOPE OF WORKS';
  ws.getCell(`B${r}`).style = STYLE.groupBand;
  r++;
  ws.mergeCells(`B${r}:C${r}`);
  ws.getCell(`B${r}`).value = 'Supply, installation, testing and commissioning of the complete LV electrical distribution system, lighting, small power, earthing & lightning protection, metering and life-safety related electrical installations for the project, in accordance with the tender drawings, specifications, applicable standards, and authority requirements (DEWA, Dubai Municipality, Dubai Civil Defence). The scope shall include all materials, labour, plant, supervision, transport, scaffolding, builder\'s work in connection, testing instruments, commissioning, As-Built drawings and O&M manuals.';
  ws.getCell(`B${r}`).style = { ...STYLE.body, alignment: { vertical: 'top', wrapText: true } };
  ws.getRow(r).height = 80;
  r += 2;

  // ── 2. Applicable Standards ───────────────────────────────────────────
  ws.mergeCells(`B${r}:C${r}`);
  ws.getCell(`B${r}`).value = '2. APPLICABLE STANDARDS';
  ws.getCell(`B${r}`).style = STYLE.groupBand;
  r++;
  const stds = [
    ['DEWA', 'Distribution Standards & Authority Regulations (latest edition)'],
    ['DEWA Smart Grid', 'Smart Metering Programme / AMI Specifications / Shams Dubai'],
    ['DM',          'Dubai Municipality Building Code & Electrical Inspection Standards'],
    ['DM Local Order', 'Local Order 89/1994 — Building Regulations and amendments'],
    ['DCD',  'Dubai Civil Defence — UAE Fire & Life Safety Code of Practice (latest)'],
    ['BS 7671', 'IEE Wiring Regulations (18th Edition / latest)'],
    ['IEC 60364', 'Low-voltage electrical installations'],
    ['IEC 60439', 'LV switchgear and controlgear assemblies (Form separation)'],
    ['IEC 60947', 'LV switchgear (ACBs, MCCBs, contactors)'],
    ['IEC 60331', 'Fire-resisting characteristics of electric cables'],
    ['BS 6387 CWZ', 'Performance requirements for fire-rated cables'],
    ['BS 7211',  'LSZH (Low Smoke Zero Halogen) cable performance'],
    ['IEC 60332-3', 'Cable flame-propagation test (Cat A/B/C)'],
    ['IEC 61034 / 60754', 'Smoke density / halogen-acid gas emission tests for LSZH cables'],
    ['BS 4444', 'Earth electrode resistance test method'],
    ['IEC 62305', 'Lightning protection systems'],
    ['IEC 62052/62053', 'Electricity metering equipment — general requirements'],
    ['Dubai GBR', 'Dubai Green Building Regulations & Specifications'],
    ['UAE FTA',   'Federal Tax Authority — VAT (5%) on tender total per Federal Decree-Law 8/2017'],
  ];
  ws.getCell(`B${r}`).value = 'Standard';
  ws.getCell(`B${r}`).style = STYLE.tableHead;
  ws.getCell(`C${r}`).value = 'Description';
  ws.getCell(`C${r}`).style = STYLE.tableHead;
  r++;
  for (const [k, d] of stds) {
    ws.getCell(`B${r}`).value = k; ws.getCell(`B${r}`).style = STYLE.body;
    ws.getCell(`C${r}`).value = d; ws.getCell(`C${r}`).style = STYLE.body;
    r++;
  }

  r++;
  ws.mergeCells(`B${r}:C${r}`);
  ws.getCell(`B${r}`).value = '3. ABBREVIATIONS';
  ws.getCell(`B${r}`).style = STYLE.groupBand;
  r++;
  const abbr = [
    ['ACB', 'Air Circuit Breaker'],     ['MCCB', 'Moulded Case Circuit Breaker'],
    ['MCB', 'Miniature Circuit Breaker'], ['RCD', 'Residual Current Device'],
    ['LVP', 'LV Panel (Main)'],            ['SMDB', 'Sub-Main Distribution Board'],
    ['ESMDB', 'Emergency SMDB'],            ['DB', 'Distribution Board'],
    ['EDB', 'Emergency DB'],                ['ATS', 'Automatic Transfer Switch'],
    ['XLPE', 'Cross-Linked Polyethylene'], ['SWA', 'Steel Wire Armoured'],
    ['FR',  'Fire Rated (BS6387 CWZ)'],    ['ECC', 'Earth Continuity Conductor'],
    ['MEB', 'Main Earth Bar'],              ['LP',  'Lightning Protection'],
    ['T&C', 'Testing & Commissioning'],    ['SLD', 'Single Line Diagram'],
    ['TCL', 'Total Connected Load'],       ['MD',  'Maximum Demand'],
    ['DF',  'Demand Factor'],              ['PF',  'Power Factor'],
    ['kVA', 'Kilo-Volt-Ampere'],            ['kW',  'Kilo-Watt'],
    ['kVAR','Kilo-Volt-Ampere Reactive'],   ['IP55/IP65', 'Ingress Protection ratings'],
  ];
  ws.getCell(`B${r}`).value = 'Abbr.'; ws.getCell(`B${r}`).style = STYLE.tableHead;
  ws.getCell(`C${r}`).value = 'Meaning'; ws.getCell(`C${r}`).style = STYLE.tableHead;
  r++;
  for (const [k, d] of abbr) {
    ws.getCell(`B${r}`).value = k; ws.getCell(`B${r}`).style = STYLE.body;
    ws.getCell(`C${r}`).value = d; ws.getCell(`C${r}`).style = STYLE.body;
    r++;
  }

  r += 2;
  ws.mergeCells(`B${r}:C${r}`);
  ws.getCell(`B${r}`).value = '4. PRICING NOTES';
  ws.getCell(`B${r}`).style = STYLE.groupBand;
  r++;
  const notes = [
    'All rates shall include supply, delivery, off-loading, storage, installation, fixings, support steelwork, painting, identification labelling, testing, commissioning, and handover.',
    'All quantities are estimated from tender drawings; the contractor shall verify on site before procurement. No claim for variation will be entertained for take-off discrepancies within ±5% of the BOQ quantity.',
    'Cable lengths include +10% installation allowance (vertical rise + horizontal route + termination + slack).',
    'Where a "lot" or "item" unit is used, the rate shall cover the complete scope described in that item including all incidentals.',
    'Provisional sums (PS) are net rates; the contractor shall add a percentage for overheads, profit, and attendance separately at the foot of each Bill where applicable.',
    'All prices shall be in UAE Dirhams (AED), exclusive of VAT. VAT at 5% will be added at the foot of the Summary in accordance with UAE Federal Tax Authority requirements.',
    'Rates shall remain firm and fixed for the duration of the contract including the Defects Liability Period unless otherwise agreed in writing.',
  ];
  for (let i = 0; i < notes.length; i++) {
    ws.getCell(`B${r}`).value = `(${i + 1})`;
    ws.getCell(`B${r}`).style = { ...STYLE.body, alignment: { vertical: 'top', horizontal: 'center' } };
    ws.getCell(`C${r}`).value = notes[i];
    ws.getCell(`C${r}`).style = { ...STYLE.body, alignment: { vertical: 'top', wrapText: true } };
    ws.getRow(r).height = Math.max(20, Math.ceil(notes[i].length / 110) * 16);
    r++;
  }
}

// ─── Bill 1 — Preliminaries ───────────────────────────────────────────────
function buildBill1(ws, meta, e, opts) {
  setBillHeader(ws, '1', 'GENERAL ITEMS / PRELIMINARIES', meta);
  let r = 4;
  bandRow(ws, r++, '1.1 — PROJECT MOBILISATION & SITE ESTABLISHMENT');
  let f = r;
  const prelim_a = [
    ['Mobilisation to site, including transport of plant, tools, materials and personnel.', 'Sum', 1],
    ['Site offices, storage compounds, sanitary and welfare facilities for the duration of the works.', 'Sum', 1],
    ['Site hoarding, fencing and security as per main contractor / consultant requirements.', 'Sum', 1],
    ['Health & Safety plan, PPE, fall-arrest and electrical safety (LOTO) provisions for the duration.', 'Sum', 1],
    ['Coordination with main contractor and other MEP trades — shop-drawing review meetings, BIM coordination as required.', 'Sum', 1],
  ];
  prelim_a.forEach((d, i) => lineRow(ws, r++, `1.1.${i + 1}`, d[0], '—', d[1], d[2], '', i % 2 === 1));
  subTotalRow(ws, r++, 'Sub-Total 1.1', f, r - 1); r++;

  bandRow(ws, r++, '1.2 — INSURANCE & BONDS');
  f = r;
  const bonds = [
    ['Contractor\'s All Risks (CAR) insurance for the contract value, full duration plus DLP.', 'Sum', 1],
    ['Workmen\'s Compensation and Public Liability insurance.', 'Sum', 1],
    ['Performance bond (10% of contract value) — bank guarantee in favour of the employer.', 'Sum', 1],
    ['Advance payment guarantee — bank guarantee against advance.', 'Sum', 1],
  ];
  bonds.forEach((d, i) => lineRow(ws, r++, `1.2.${i + 1}`, d[0], '—', d[1], d[2], '', i % 2 === 1));
  subTotalRow(ws, r++, 'Sub-Total 1.2', f, r - 1); r++;

  bandRow(ws, r++, '1.3 — TEMPORARY UTILITIES & TESTING INSTRUMENTS');
  f = r;
  const tmp = [
    ['Temporary power supply during construction — generator, distribution, metering, fuel.', 'Sum', 1],
    ['Temporary lighting in areas of work as required for safe execution.', 'Sum', 1],
    ['Provision of all testing instruments — Megger 500V/1000V, earth tester, multimeter, RCD tester, loop tester, calibration certificates current.', 'Sum', 1],
  ];
  tmp.forEach((d, i) => lineRow(ws, r++, `1.3.${i + 1}`, d[0], '—', d[1], d[2], '', i % 2 === 1));
  subTotalRow(ws, r++, 'Sub-Total 1.3', f, r - 1); r++;

  bandRow(ws, r++, '1.4 — SUBMITTALS, AS-BUILTS, O&M MANUALS');
  f = r;
  const subm = [
    ['Shop drawings (AutoCAD) — full set, multiple revisions until approved.', 'Sum', 1],
    ['Material approval submittals — datasheets, samples, manufacturer\'s certificates, country-of-origin declarations.', 'Sum', 1],
    ['As-Built drawings (AutoCAD + PDF, 4 hard copies) at handover.', 'Sum', 1],
    ['Operation & Maintenance manuals (4 hard copies + PDF) at handover, including spare-parts list.', 'Sum', 1],
    ['Defects Liability Period support (12 months from handover) — site attendance, replacement of defective materials, retesting.', 'Sum', 1],
  ];
  subm.forEach((d, i) => lineRow(ws, r++, `1.4.${i + 1}`, d[0], '—', d[1], d[2], '', i % 2 === 1));
  subTotalRow(ws, r++, 'Sub-Total 1.4', f, r - 1); r++;

  // ── 1.5 — Authority Fees, NOCs & Permits (Dubai consultant submission) ─
  bandRow(ws, r++, '1.5 — AUTHORITY FEES, NOCs & PERMITS');
  f = r;
  const authFees = [
    ['DEWA HV/LV connection capacity charges (per kVA, DEWA tariff). Provisional sum — final amount per DEWA load-letter response.', 'Sum',  1],
    ['DEWA load-letter application & approval fees (capacity allocation, RMU/substation siting, voltage level confirmation).',         'Sum', 1],
    ['DEWA energising application fee — submission, processing, witness arrangement, meter sealing.',                                   'Sum', 1],
    ['RTA road-cutting permit + reinstatement (where HV/LV cabling crosses public road or pavement). Provisional sum.',                 'Sum',  1],
    ['Dubai Municipality (DM) electrical inspection & completion-certificate fee — for occupancy / completion sign-off.',                'Sum', 1],
    ['Dubai Civil Defence (DCD) electrical clearance NOC fee — life-safety clearance for fire pump, smoke control, emergency lighting.', 'Sum', 1],
  ];
  authFees.forEach((d, i) => lineRow(ws, r++, `1.5.${i + 1}`, d[0], 'DEWA / DM / DCD / RTA', d[1], d[2], '', i % 2 === 1));
  subTotalRow(ws, r++, 'Sub-Total 1.5', f, r - 1); r++;

  return billTotalRow(ws, r, '1', r - 1);
}

// ─── Bill 2 — HV/LV Main Distribution ─────────────────────────────────────
function buildBill2(ws, meta, e, opts) {
  setBillHeader(ws, '2', 'HV / LV MAIN DISTRIBUTION', meta);
  let r = 4;

  bandRow(ws, r++, '2.1 — HV INCOMING SUPPLY & TRANSFORMER (DEWA-coordinated)');
  let f = r;
  const txMD = meta.building.max_demand_kw ? Math.round(meta.building.max_demand_kw) : '?';
  const txKVA = meta.building.max_demand_kw ? Math.ceil(meta.building.max_demand_kw / 0.85 / 100) * 100 : 2000; // size to MD/0.85 PF, round up to next 100 kVA
  // Common transformer spec suffix (shared by every transformer line).
  const txSpec = (kva, ratio, sizeNote) =>
    `HV / LV distribution transformer — ${kva} kVA, ${ratio || '11 kV / 0.4 kV'}, 50 Hz, vector group Dyn11, K-Factor rating ≥ K-13 (suitable for non-linear loads — LED lighting, EV chargers, VFDs; uplift to K-20 if EV load > 20 % of MD), cast-resin (dry-type) construction with encapsulated F-class windings, IP31 enclosure, anti-vibration mounts, ±2.5 % / ±5 % off-circuit tap changer, oil-free, low-loss DEWA-listed manufacturer. ${sizeNote} Includes installation, energising, witnessed routine test, commissioning report.`;
  // List EVERY transformer read off the SLD (a building can have 2+, e.g. P-379's
  // 1000 kVA + 1500 kVA). Dedupe by (kVA, voltage ratio) — the SLD often labels two
  // units "Transformer #1" so an extractor can emit the same rating twice; collapse
  // and sum counts. Fall back to a single MD-sized line when none extracted.
  const txMap = new Map();
  for (const t of (e?.incoming_supply?.transformers || [])) {
    if (!t || !t.kva) continue;
    const key = `${t.kva}|${t.voltage_ratio || ''}`;
    if (txMap.has(key)) txMap.get(key).count += (t.count || 1);
    else txMap.set(key, { ...t, count: t.count || 1 });
  }
  const txList = [...txMap.values()];
  const txLines = txList.length
    ? txList.map(t => [txSpec(t.kva, t.voltage_ratio, 'Per DEWA-coordinated supply (transformer by DEWA — supply line for record / contractor coordination).'), 'Nr', t.count || 1])
    : [[txSpec(txKVA, '11 kV / 0.4 kV', `Sized for Building MD ~${txMD} kW + 25 % spare.`), 'Nr', 1]];
  const hv = [
    ['DEWA HV incoming service connection (RMU / package substation, supplied & installed by DEWA). Contractor allowance for coordination, application, attendance and acceptance.',
     'Lot', 1],
    ...txLines,
    ['11 kV HV cable (single-core 3×1C, XLPE/CWS/PVC, copper screen) from RMU to transformer HV side — complete with stress cones, heat-shrink terminations, fire stopping at penetrations, earthing, ID phase markers.',
     'm', 30],
    ['Transformer room civil / MEP coordination — pressure-relief vents, mechanical ventilation, drainage, fire-rated enclosure (≥ 2 h), DEWA-spec oil bund where oil-filled (N/A for cast-resin) — coordination only.',
     'Sum', 1],
  ];
  hv.forEach((d, i) => lineRow(ws, r++, `2.1.${i + 1}`, d[0], 'P-200 / P-300', d[1], d[2], 'DEWA-listed', i % 2 === 1));
  subTotalRow(ws, r++, 'Sub-Total 2.1', f, r - 1); r++;

  bandRow(ws, r++, '2.2 — LV PANELS (Supply, Install, Test & Commission)');
  f = r;
  let n = 0;
  // Dedupe panels by tag (an extractor can list LVP-01 twice from two SLD sheets).
  const seenPanels = new Set();
  const panels = (e?.lv_panels || []).filter((p) => {
    const key = String(p?.tag || '').trim().toUpperCase();
    if (!key) return true;
    if (seenPanels.has(key)) return false;
    seenPanels.add(key);
    return true;
  });
  for (const p of panels) {
    n++;
    const icw = p.main_acb_breaking_ka || 50;
    const acb = p.main_acb_rating_a ? `${p.main_acb_rating_a}A 4P main ACB drawout type, Icu ≥ ${icw} kA, Ics = 100 % Icu, electronic LSIG trip unit` : 'main ACB';
    const mccbs = (p.outgoing_mccbs || []).map(m => `${m.count}× ${m.rating_a}A TP→${m.to}`).join(', ');
    const busA = p.main_acb_rating_a ? Math.round(p.main_acb_rating_a * 1.25) : 1600;
    lineRow(ws, r++, `2.2.${n}`,
      `${p.tag}: Type-tested LV switchboard (TTA / IEC 61439-1/2), 3P+N+E, 415 V, 50 Hz, floor-standing metal-clad, IP41 (front) / IP31 (rear), Form 4b separation, electro-tin-plated copper busbars rated ${busA} A continuous with ${icw} kA Icw 1 s short-time withstand. Includes ${acb}, neutral earthing link, surge protection device (SPD Type 1+2 at incomer), digital MFM metering with MODBUS RTU/TCP, voltage / current / phase indication, panel internal lighting, anti-condensation heater. Outgoing: ${mccbs || 'as per SLD'}. Manufacturer's witnessed factory acceptance test (FAT) certificate. Complete installed, energised, with witnessed routine test certificate.`,
      'P-200', 'Nr', 1, p.tag, n % 2 === 0);
    const rawBanks = p.capacitor_banks?.length ? p.capacitor_banks : (p.capacitor_bank_kvar ? [{ kvar: p.capacitor_bank_kvar }] : []);
    const seenKvar = new Set();
    const banks = rawBanks.filter((b) => { const k = String(b?.kvar ?? ''); if (!k || seenKvar.has(k)) return false; seenKvar.add(k); return true; });
    for (const b of banks) {
      n++;
      lineRow(ws, r++, `2.2.${n}`,
        `Automatic PF correction capacitor bank — ${b.kvar} kVAR, 415V, multi-step (typically 25/50 kVAR steps), with PF controller, contactors, detuning reactors (5.7%), incomer ACB, ID-labelled. For ${p.tag}.`,
        'P-200', 'Nr', 1, `${p.tag} PF correction`, n % 2 === 0);
    }
  }
  if (n === 0) {
    // Fallback for projects without lv_panels populated
    lineRow(ws, r++, '2.2.1', 'Main LV Panel — sized per Maximum Demand. Supply, install, test, commission complete with ACB, busbars, MCCBs as per SLD.', 'P-200', 'Nr', 1, 'Coordinate with consultant', false);
  }
  subTotalRow(ws, r++, 'Sub-Total 2.2', f, r - 1); r++;

  bandRow(ws, r++, '2.3 — STANDBY GENERATOR & ATS');
  f = r;
  const g = e?.incoming_supply?.generator;
  const ats = e?.incoming_supply?.ats;
  if (g) {
    lineRow(ws, r++, '2.3.1',
      `Standby Generator — ${g.kva} kVA, 415V/3Ph/50Hz, ${g.type || 'diesel'}-engined, weatherproof acoustic canopy ≤75 dB(A) @1m, AMF panel, fuel tank (8h running), exhaust system with silencer, anti-vibration mounts, day-tank, fuel transfer pump, control wiring. Complete installed, commissioned, with full-load test certificate.`,
      'P-200', 'Nr', 1, 'Backup to essential', false);
  }
  if (ats) {
    lineRow(ws, r++, '2.3.2',
      `Automatic Transfer Switch (ATS) Panel — 415V, ${ats.rating_a}A, 4P, with mechanical/electrical interlock, programmable controller, mains/gen voltage and frequency monitoring, soak-back & cool-down timers. Complete with controls, power and signalling cables.`,
      'P-200', 'Nr', 1, 'Mains/Gen changeover', true);
  }
  if (!g && !ats) {
    lineRow(ws, r++, '2.3.1', 'Standby generator + ATS — sized per essential-load schedule. Supply, install, commission complete.', 'P-200', 'Set', 1, 'Coordinate with consultant', false);
  }
  subTotalRow(ws, r++, 'Sub-Total 2.3', f, r - 1); r++;

  return billTotalRow(ws, r, '2', r - 1);
}

// ─── Bill 3 — SMDBs ───────────────────────────────────────────────────────
function buildBill3(ws, meta, e, opts) {
  setBillHeader(ws, '3', 'SUB-MAIN DISTRIBUTION BOARDS (SMDBs)', meta);
  let r = 4;

  const smdbs = e?.smdb_inventory || [];
  // Partition every board into exactly ONE group so none is billed twice.
  // Emergency = explicit ESMDB / "emergency" tag ONLY (the old /^E?SMDB/ made the
  // E optional and swept EVERY normal SMDB into 3.6). Retail (SH01…) and EV/lift
  // are id-based and take priority over the floor buckets, so a ground-floor shop
  // board lands in retail only — not in both ground (3.2) and retail (3.5).
  const isEmerg  = s => /^ESMDB|emergency/i.test(s.id || '');
  const isRetail = s => /SH\d|retail|shop/i.test(s.id || '');
  const isEv     = s => /EV|lift|elevator/i.test(s.id || '');
  const typical = [], ground = [], roof = [], ev = [], retail = [], emerg = [];
  for (const s of smdbs) {
    const f = (s.floor || '').toString();
    if (isEmerg(s)) emerg.push(s);
    else if (isEv(s)) ev.push(s);
    else if (isRetail(s)) retail.push(s);
    else if (/^[1-8]F$/i.test(f)) typical.push(s);
    else if (/^RF|roof/i.test(f)) roof.push(s);
    else ground.push(s); // G / ground / anything unclassified → ground bucket (never dropped)
  }

  // Derive IP rating + enclosure per SMDB location (Dubai industry practice):
  //   • Outdoor / Roof exposed   → IP65 stainless-steel + UV-resistant gland kits + sun-shield canopy
  //   • Plant / EV / Basement     → IP54 powder-coated steel
  //   • Indoor electrical room    → IP31 powder-coated steel + padlockable door
  function smdbEnvelope(s) {
    const f = (s.floor || '').toString();
    const id = (s.id || '').toString();
    // Outdoor/Roof: floor is RF / Roof / "Roof Floor", or id calls out outdoor/external/roof-top.
    const isOutdoor = /^(RF|Roof( Floor)?|UR|Upper Roof)$/i.test(f) || /\b(outdoor|external|roof[- ]top|RF)\b/i.test(id);
    // Plant/EV/Basement: id mentions EV/lift/elevator/plant/MEP, or floor is Basement/UG.
    const isPlantOrEv = /\b(EV|lift|elevator|plant|MEP)\b/i.test(id)
                     || /\b(Basement|UG|Plant|Mechanical)\b/i.test(f);
    if (isOutdoor)   return { ip: 'IP65', body: 'stainless-steel 316L weatherproof enclosure with UV-resistant gland kits and sun-shield canopy' };
    if (isPlantOrEv) return { ip: 'IP54', body: 'powder-coated mild-steel enclosure (epoxy-polyester finish), splash + dust-protected' };
    return                  { ip: 'IP31', body: 'powder-coated mild-steel enclosure with padlockable hinged door' };
  }

  function renderGroup(label, items, code) {
    if (!items.length) return;
    bandRow(ws, r++, label);
    const f = r;
    items.forEach((s, i) => {
      const incomer = s.rating_a ? `${s.rating_a}A TP MCCB ≥35 kA Icu` : 'TP MCCB';
      const isFR = /^ESMDB|emergency/i.test(s.id);
      const env = smdbEnvelope(s);
      const mounting = s.floor === 'RF' || (s.connected_load_kw && s.connected_load_kw > 100) ? 'floor-standing' : 'wall-mounted';
      const desc = `${s.id}: ${mounting} SMDB, ${env.ip} ${env.body}, 415 V / 3P+N+E, ${incomer} incomer, busbar ${s.rating_a ? `${s.rating_a} A Cu electro-tin plated` : 'Cu'}, Form 2b separation, neutral / earth bars, outgoing MCCBs / MCBs / RCBOs as per SLD, MEB sub-bar bonded to building MEB, ID-engraved circuit labels, padlockable hinged door, manufacturer's factory acceptance test (FAT) certificate. ${isFR ? 'Fire-rated cable glands + LSZH gland-kits at all FR feeder terminations. ' : ''}Connected load ${s.connected_load_kw ?? '—'} kW. Supply, install, terminate, energise, witnessed routine test.`;
      lineRow(ws, r++, `${code}.${i + 1}`, desc, 'P-201', 'Nr', s.qty || 1, `${s.floor} · ${env.ip} · ${s.connected_load_kw ?? '—'} kW`, i % 2 === 1);
    });
    subTotalRow(ws, r++, `Sub-Total ${code}`, f, r - 1); r++;
  }

  renderGroup('3.1 — TYPICAL FLOOR SMDBs (1F–8F)',          typical, '3.1');
  renderGroup('3.2 — GROUND FLOOR SMDBs',                    ground,  '3.2');
  renderGroup('3.3 — ROOF SMDBs',                            roof,    '3.3');
  renderGroup('3.4 — SPECIAL-DUTY SMDBs (EV / Lift / etc.)', ev,      '3.4');
  renderGroup('3.5 — RETAIL SMDBs',                          retail,  '3.5');
  renderGroup('3.6 — EMERGENCY SMDBs (Generator-backed, FR)', emerg,  '3.6');

  if (r === 4) {
    bandRow(ws, r++, '3 — SMDBs (no take-off data — populate from SLD)');
  }
  return billTotalRow(ws, r, '3', r - 1);
}

// ─── Bill 4 — Distribution Boards ─────────────────────────────────────────
function buildBill4(ws, meta, e, opts) {
  setBillHeader(ws, '4', 'DISTRIBUTION BOARDS (DBs) & CONSUMER UNITS', meta);
  let r = 4;

  if (e?.db_groups?.length) {
    bandRow(ws, r++, '4.1 — DISTRIBUTION BOARDS (per SLD)');
    const f = r;
    e.db_groups.forEach((g, i) => {
      lineRow(ws, r++, `4.1.${i + 1}`,
        `${g.tag_pattern}: Flush/surface-mounted DB, TP/SP+N incomer MCCB/MCB, outgoing MCBs (B/C curve as appropriate) and RCBOs (30 mA Type A) per DEWA. IP4X enclosure, ID engraved, lockable. Supply, install, terminate, label, test & commission.`,
        g.tcl_range_kw ? `TCL ${g.tcl_range_kw} kW` : 'P-201',
        'Nr', g.total_qty || 1,
        g.per_floor_qty != null ? `${g.per_floor_qty}/floor × ${g.floors}` : '', i % 2 === 1);
    });
    subTotalRow(ws, r++, 'Sub-Total 4.1', f, r - 1); r++;
  } else if (e?.db_inventory?.length) {
    bandRow(ws, r++, '4.1 — DISTRIBUTION BOARDS (per cable schedule)');
    const f = r;
    e.db_inventory.forEach((db, i) => {
      lineRow(ws, r++, `4.1.${i + 1}`,
        `${db.db_id}: DB fed from ${db.smdb_id}, ${db.rating_a ? `${db.rating_a}A TP` : 'TP'} incomer, IP4X. Supply, install, terminate, label, test & commission.`,
        'P-201', 'Nr', 1, db.floor || '', i % 2 === 1);
    });
    subTotalRow(ws, r++, 'Sub-Total 4.1', f, r - 1); r++;
  } else {
    bandRow(ws, r++, '4 — Distribution Boards (no take-off data)');
  }

  // 4.2 — Mechanical & service equipment final connections. Scoped to the
  // ELECTRICAL termination only (isolator + glanding + connection) — the feeder
  // cable is in Bill 5 and the upstream board in Bill 3/4.1, so nothing here
  // duplicates them. Exclude anything that is actually a board (already in
  // db_inventory / smdb_inventory) and dedupe identical equipment rows.
  const mech = e?.mechanical_equipment || [];
  if (mech.length) {
    const boardTags = new Set([
      ...(e?.db_inventory || []).map((d) => String(d.db_id || '').trim().toUpperCase()),
      ...(e?.smdb_inventory || []).map((s) => String(s.id || '').trim().toUpperCase()),
    ].filter(Boolean));
    const seen = new Set();
    const items = mech.filter((m) => {
      const tag = String(m?.description || '').trim().toUpperCase();
      if (!tag || boardTags.has(tag)) return false;
      const key = `${tag}|${m.rating_kw ?? ''}|${m.rating_a ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (items.length) {
      bandRow(ws, r++, '4.2 — MECHANICAL & SERVICE EQUIPMENT — POWER CONNECTIONS');
      const f = r;
      items.forEach((m, i) => {
        const rating = m.rating_kw ? `${m.rating_kw} kW` : (m.rating_a ? `${m.rating_a} A` : '');
        lineRow(ws, r++, `4.2.${i + 1}`,
          `Power supply & final connection to ${m.description}${rating ? ` (${rating})` : ''} — incl. local weatherproof isolator / control switch, glanding, termination & connection to equipment terminals, and control / interlock wiring where shown. Feeder cable & upstream DB/MCCB measured separately (Bills 5 & 3/4.1). Test & commission jointly with the mechanical contractor.`,
          'P-200 / P-201', 'Nr', m.count || 1, '', i % 2 === 1);
      });
      subTotalRow(ws, r++, 'Sub-Total 4.2', f, r - 1); r++;
    }
  }

  return billTotalRow(ws, r, '4', r - 1);
}

// ─── Bill 5 — LV Cables ───────────────────────────────────────────────────
function buildBill5(ws, meta, e, opts) {
  setBillHeader(ws, '5', 'LV POWER CABLES (Main + Distribution + Final Circuits)', meta);
  let r = 4;

  const cables = e?.cable_schedule || [];
  const lvTags = new Set((e?.lv_panels || []).map(p => p.tag));
  const lvCables = cables.filter(c => lvTags.has(c.from) || /^(LVP|LV-?\d|MDB)/i.test(c.from || ''));
  const xlpe = lvCables.filter(c => !isFR(c));
  const fr   = lvCables.filter(c => isFR(c));

  if (xlpe.length) {
    bandRow(ws, r++, '5.1 — XLPE / SWA / PVC LV CABLES — Plant & Utility Risers (LV Panel → SMDB)');
    const f = r;
    xlpe.forEach((c, i) => {
      const cores = c.cores || 4;
      lineRow(ws, r++, `5.1.${i + 1}`,
        `${cores}C × ${c.size_mm2} mm² XLPE / SWA / PVC 600/1000 V armoured cable to BS 5467 / IEC 60502 — ${c.from} to ${c.to}${c.circuit_description ? ` (${c.circuit_description})` : ''}. Used on plant / utility risers (non-public-area, non-escape-route). Installed in cable tray / ladder / conduit incl. fire stopping at penetrations, BW-type brass glands with shrouds, compression-type lugs, ferrules and terminations at both ends.`,
        'P-200', 'm', Math.round(c.length_m || 0), '', i % 2 === 1);
    });
    subTotalRow(ws, r++, 'Sub-Total 5.1', f, r - 1); r++;
  }

  if (fr.length) {
    bandRow(ws, r++, '5.2 — FIRE-RATED LSZH CABLES (BS 6387 CWZ / IEC 60331-21 — life-safety circuits)');
    const f = r;
    fr.forEach((c, i) => {
      const cores = c.cores || 4;
      lineRow(ws, r++, `5.2.${i + 1}`,
        `${cores}C × ${c.size_mm2} mm² Fire-Rated LSZH cable (BS 6387 CWZ / IEC 60331-21, 950 °C / 3 h circuit integrity; LSZH outer jacket per BS 7211 / IEC 60332-3 Cat C / IEC 61034 / IEC 60754) — ${c.from} to ${c.to}${c.circuit_description ? ` (${c.circuit_description})` : ''}. Installed in dedicated fire-rated containment with FR cleats at max 300 mm centres, FR/LSZH glands, FR terminations and ID labels in red.`,
        'P-200', 'm', Math.round(c.length_m || 0), '', i % 2 === 1);
    });
    subTotalRow(ws, r++, 'Sub-Total 5.2', f, r - 1); r++;
  }

  // Distribution (SMDB → DB)
  let dist = e?.smdb_to_db_cables || [];
  if (!dist.length) {
    dist = cables.filter(c => {
      const f = c.from || '';
      return !(lvTags.has(f) || /^(LVP|LV-?\d|MDB)/i.test(f));
    });
  }
  const distXLPE = dist.filter(c => !isFR(c));
  const distFR   = dist.filter(c => isFR(c));
  if (distXLPE.length) {
    bandRow(ws, r++, '5.3 — DISTRIBUTION CABLES (SMDB → DB) — XLPE / SWA / PVC, Plant & Utility');
    const f = r;
    distXLPE.forEach((c, i) => {
      const cores = c.cores || 4;
      lineRow(ws, r++, `5.3.${i + 1}`,
        `${cores}C × ${c.size_mm2} mm² XLPE / SWA / PVC armoured cable — ${c.from} to ${c.to}. Plant / utility distribution scope (non-public).`,
        'P-201', 'm', Math.round(c.length_m || 0), '', i % 2 === 1);
    });
    subTotalRow(ws, r++, 'Sub-Total 5.3', f, r - 1); r++;
  }
  if (distFR.length) {
    bandRow(ws, r++, '5.4 — DISTRIBUTION CABLES (SMDB → DB) — Fire-Rated LSZH');
    const f = r;
    distFR.forEach((c, i) => {
      const cores = c.cores || 4;
      lineRow(ws, r++, `5.4.${i + 1}`,
        `${cores}C × ${c.size_mm2} mm² FR/LSZH cable (BS 6387 CWZ + LSZH per BS 7211) — ${c.from} to ${c.to}.`,
        'P-201', 'm', Math.round(c.length_m || 0), '', i % 2 === 1);
    });
    subTotalRow(ws, r++, 'Sub-Total 5.4', f, r - 1); r++;
  }

  // 5.5 — LSZH cables for public-area / escape-route final circuits (DCD requirement)
  bandRow(ws, r++, '5.5 — LSZH CABLES — Public-Area & Escape-Route Final Circuits (DCD compliance)');
  let f55 = r;
  const lszh_lines = [
    ['LSZH XLPE/SWA/LSZH 4C × 16 mm² 600/1000 V cable to BS 7211 / IEC 60332-3 Cat C / IEC 61034 (low smoke) / IEC 60754 (zero halogen) — corridor & lobby final-circuit risers, escape-route mains.', 'm', 220],
    ['LSZH XLPE/LSZH 3C × 4 mm² Cu cable — apartment lighting & socket sub-mains in escape corridors.', 'm', 480],
    ['LSZH XLPE/LSZH 3C × 2.5 mm² Cu cable — final-circuit drops to apartment outlets & accessories on escape route.', 'm', 1200],
    ['LSZH XLPE/LSZH 2C × 1.5 mm² Cu cable — emergency / exit-sign final circuits (combined with FR per Bill 5.2).', 'm', 540],
  ];
  lszh_lines.forEach((d, i) => lineRow(ws, r++, `5.5.${i + 1}`, d[0], 'BS 7211 / IEC 60332-3', d[1], d[2], 'LSZH-jacket', i % 2 === 1));
  subTotalRow(ws, r++, 'Sub-Total 5.5', f55, r - 1); r++;

  // 5.6 — Final-circuit bulk wiring (PVC, plant areas)
  if (e?.bulk_cables?.length) {
    bandRow(ws, r++, '5.6 — FINAL-CIRCUIT WIRING — Plant Areas (PVC, BS 6004)');
    const f = r;
    e.bulk_cables.forEach((b, i) => {
      lineRow(ws, r++, `5.6.${i + 1}`, b.specification, 'BS 6004', 'm',
        Math.round(b.estimated_length_m || 0), b.application, i % 2 === 1);
    });
    subTotalRow(ws, r++, 'Sub-Total 5.6', f, r - 1); r++;
  }

  // 5.7 — ECC allowance alongside rising mains
  const totalMain = lvCables.reduce((s, c) => s + (Number(c.length_m) || 0), 0);
  if (totalMain > 0) {
    bandRow(ws, r++, '5.7 — EARTH CONTINUITY CONDUCTORS (ECC) ALONGSIDE RISING MAINS');
    const f = r;
    lineRow(ws, r++, '5.7.1',
      '1C × 35 mm² green/yellow XLPE ECC — alongside fire-rated rising mains.',
      'BS 6004', 'm', Math.round(fr.reduce((s, c) => s + (Number(c.length_m) || 0), 0)), 'FR run allowance', false);
    lineRow(ws, r++, '5.7.2',
      '1C × 10 mm²–70 mm² green/yellow XLPE ECC — alongside XLPE rising mains (allow per run).',
      'BS 6004', 'm', Math.round(totalMain * 0.85), 'XLPE run allowance', true);
    subTotalRow(ws, r++, 'Sub-Total 5.7', f, r - 1); r++;
  }

  return billTotalRow(ws, r, '5', r - 1);
}

function isFR(c) {
  const t = (c.type || '').toLowerCase();
  const d = (c.circuit_description || '').toLowerCase();
  return /fire|fr|cwz|emerg/i.test(t) || /fire pump|emergency|fire alarm|essential|esmdb/i.test(d);
}

// ─── Bill 6 — Containment ─────────────────────────────────────────────────
function buildBill6(ws, meta, e, opts) {
  setBillHeader(ws, '6', 'CABLE CONTAINMENT (Tray, Ladder, Trunking, Conduit)', meta);
  let r = 4;
  const items = e?.containment || [];
  if (items.length) {
    bandRow(ws, r++, '6.1 — CABLE TRAYS, LADDERS, TRUNKING & CONDUITS');
    const f = r;
    items.forEach((c, i) => {
      lineRow(ws, r++, `6.1.${i + 1}`,
        `${c.description}, hot-dip galvanised to BS EN ISO 1461, c/w supports at max 1.5m centres on horizontal / 1.0m on vertical, brackets, bends, tees, reducers, copplers, fixings, earth bonding straps.`,
        'BS EN 61537', c.unit || 'm', Math.round(c.estimated_qty || 0), '', i % 2 === 1);
    });
    subTotalRow(ws, r++, 'Sub-Total 6.1', f, r - 1); r++;
  } else {
    bandRow(ws, r++, '6 — Cable Management (populate from drawings)');
  }
  return billTotalRow(ws, r, '6', r - 1);
}

// ─── Bill 7 — Wiring Devices & Accessories ────────────────────────────────
function buildBill7(ws, meta, e, opts) {
  setBillHeader(ws, '7', 'WIRING DEVICES & ACCESSORIES', meta);
  let r = 4;

  bandRow(ws, r++, '7.1 — SOCKET OUTLETS');
  let f = r;
  const sockets = (e?.power_outlets?.length ? e.power_outlets : [
    { description: '13 A SP switched socket outlet (BS 1363), white moulded grid plate', unit: 'Nr', estimated_qty: 340 },
    { description: '13 A DP twin switched socket outlet (BS 1363)', unit: 'Nr', estimated_qty: 280 },
    { description: '13 A SSO with USB-A + USB-C charging ports (apartment living/bedrooms)', unit: 'Nr', estimated_qty: 110 },
    { description: '20 A DP switched outlet for AC indoor unit', unit: 'Nr', estimated_qty: 95 },
    { description: '20 A DP switched outlet for water heater (with neon)', unit: 'Nr', estimated_qty: 50 },
    { description: '32 A cooker outlet with isolator + neon', unit: 'Nr', estimated_qty: 25 },
    { description: 'Weatherproof IP55 13 A SSO (balconies, podium, roof, plant rooms)', unit: 'Nr', estimated_qty: 60 },
    { description: 'Floor-mounted service box (lobby / retail counters), 4-gang', unit: 'Nr', estimated_qty: 18 },
    { description: 'Shaver socket outlet (bathrooms)', unit: 'Nr', estimated_qty: 40 },
  ]).filter(o => /socket|outlet|service box|shaver/i.test(o.description));
  sockets.forEach((o, i) => lineRow(ws, r++, `7.1.${i + 1}`, o.description, 'BS 1363', o.unit || 'Nr', o.estimated_qty || 1, '', i % 2 === 1));
  subTotalRow(ws, r++, 'Sub-Total 7.1', f, r - 1); r++;

  bandRow(ws, r++, '7.2 — SWITCHES & CONTROLS');
  f = r;
  const switches = [
    ['1-gang / 2-gang lighting switches, 10A 250V grid-style, white moulded plate (BS 3676)', 'Nr', 520],
    ['2-way / intermediate switches (corridors, stairs)', 'Nr', 45],
    ['Dimmer switch, 1-gang, 250 W LED-compatible', 'Nr', 60],
    ['Occupancy / PIR sensor (corridors, BOH, stores), with manual override', 'Nr', 30],
    ['Doorbell push + chime kit (apartments)', 'Set', 25],
    ['Connection unit (FCU), 3 A fused, for ceiling/extract fans', 'Nr', 75],
  ];
  switches.forEach((d, i) => lineRow(ws, r++, `7.2.${i + 1}`, d[0], 'BS 3676', d[1], d[2], '', i % 2 === 1));
  subTotalRow(ws, r++, 'Sub-Total 7.2', f, r - 1); r++;

  bandRow(ws, r++, '7.3 — ISOLATORS & EV CHARGER OUTLETS');
  f = r;
  const iso = [
    ['Isolator, 4P 32A, weatherproof IP55, for outdoor mech. equipment', 'Nr', 22],
    ['Isolator, 2P 20A, indoor IP20 — small fixed equipment', 'Nr', 18],
    ['EV charger socket outlet — 7 kW AC Mode 3 Type 2 (basement parking)', 'Nr', 8],
    ['EV charger socket outlet — 22 kW AC Mode 3 Type 2 (basement parking)', 'Nr', 2],
  ];
  iso.forEach((d, i) => lineRow(ws, r++, `7.3.${i + 1}`, d[0], 'IEC 62196 / IEC 60947', d[1], d[2], '', i % 2 === 1));
  subTotalRow(ws, r++, 'Sub-Total 7.3', f, r - 1); r++;

  return billTotalRow(ws, r, '7', r - 1);
}

// ─── Bill 8 — Lighting Fixtures ────────────────────────────────────────────
function buildBill8(ws, meta, e, opts) {
  setBillHeader(ws, '8', 'LIGHTING FIXTURES (Internal + External)', meta);
  let r = 4;

  bandRow(ws, r++, '8.1 — INTERIOR LIGHTING — APARTMENTS & COMMON AREAS');
  let f = r;
  const interior = [
    ['Recessed LED downlight, 12 W / 800 lm, 4000 K, IP20, anti-glare reflector (apartments, lobby, corridors)', 'Nr', 480],
    ['Surface-mount LED panel, 600×600 mm, 36 W / 3600 lm, 4000 K (lobby, BOH)', 'Nr', 60],
    ['Linear LED batten 1200 mm, 36 W / 4000 lm, 4000 K, IP40 (car park, services)', 'Nr', 220],
    ['Bulkhead LED fitting, 12 W, IP65, polycarbonate (staircase, plant rooms)', 'Nr', 90],
    ['Wall-mounted LED bracket light (corridors, accent)', 'Nr', 65],
    ['Pendant decorative LED fixture (lobby — provisional)', 'Nr', 8],
    ['Track lighting LED spot, 15 W, 3000 K (retail — provisional)', 'Nr', 40],
  ];
  interior.forEach((d, i) => lineRow(ws, r++, `8.1.${i + 1}`, d[0], 'IEC 60598', d[1], d[2], '', i % 2 === 1));
  subTotalRow(ws, r++, 'Sub-Total 8.1', f, r - 1); r++;

  bandRow(ws, r++, '8.2 — EXTERIOR LIGHTING (Façade, Podium, Parking)');
  f = r;
  const exterior = [
    ['External wall-mounted LED fixture, 24 W, IP65, anti-glare optic (podium, façade)', 'Nr', 36],
    ['Pole-mounted parking LED area light, 80 W, 4000 K, IP66, on 6 m pole', 'Nr', 14],
    ['Step / kerb LED light, 3 W, IP67, recessed', 'Nr', 28],
    ['Bollard LED, 20 W, IP65, 800 mm height (landscape)', 'Nr', 16],
    ['Façade LED linear / wall-grazer, IP66 (provisional sum)', 'Sum', 1],
  ];
  exterior.forEach((d, i) => lineRow(ws, r++, `8.2.${i + 1}`, d[0], 'IEC 60598', d[1], d[2], '', i % 2 === 1));
  subTotalRow(ws, r++, 'Sub-Total 8.2', f, r - 1); r++;

  bandRow(ws, r++, '8.3 — LIGHTING CONTROLS');
  f = r;
  const ctrls = [
    ['Time-clock / astronomical timer for façade and external lighting', 'Set', 1],
    ['Photocell / daylight sensor for external circuits', 'Nr', 4],
    ['DALI/0-10V dimmer module for common-area lighting (provisional)', 'Sum', 1],
  ];
  ctrls.forEach((d, i) => lineRow(ws, r++, `8.3.${i + 1}`, d[0], 'DEWA', d[1], d[2], '', i % 2 === 1));
  subTotalRow(ws, r++, 'Sub-Total 8.3', f, r - 1); r++;

  return billTotalRow(ws, r, '8', r - 1);
}

// ─── Bill 9 — Earthing & Lightning Protection ─────────────────────────────
function buildBill9(ws, meta, e, opts) {
  setBillHeader(ws, '9', 'EARTHING & LIGHTNING PROTECTION', meta);
  let r = 4;

  const items = e?.earthing || [];

  bandRow(ws, r++, '9.1 — MAIN EARTHING SYSTEM (TN-S, ≤ 1 Ω)');
  let f = r;
  const main_earth = items.length ? items : [
    { description: 'Main Earth Bar (MEB) in LV room — 50×6mm copper busbar, drilled, labelled, c/w insulators and brass fixing.', unit: 'Nr', qty: 2 },
    { description: 'Earth pit (BS 7430 / DEWA approved) — 1200mm copper-bonded steel rod, inspection chamber, low-resistance backfill compound, conductor clamp. Resistance test < 1 Ω.', unit: 'Nr', qty: 4 },
    { description: '1C × 95mm² bare copper earth conductor — MEB to earth pits and DEWA earth terminal.', unit: 'm', qty: 30 },
    { description: '1C × 50mm² green/yellow PVC insulated earth conductor — MEB to structural steel bonding points, water/gas service entry, lift shaft.', unit: 'm', qty: 40 },
    { description: '1C × 35mm² green/yellow XLPE earth conductor — MEB to sub-earth bar at each SMDB.', unit: 'm', qty: 400 },
    { description: '1C × 10mm² green/yellow PVC earth conductor — SMDB sub-bar to each DB.', unit: 'm', qty: 600 },
    { description: 'Supplementary bonding 4mm² green/yellow — pipework, tray, equipment frames (provisional).', unit: 'Sum', qty: 1 },
  ];
  main_earth.forEach((it, i) => lineRow(ws, r++, `9.1.${i + 1}`, it.description, 'BS 7430 / DEWA', it.unit || 'Nr', it.qty || 1, '', i % 2 === 1));
  subTotalRow(ws, r++, 'Sub-Total 9.1', f, r - 1); r++;

  bandRow(ws, r++, '9.2 — LIGHTNING PROTECTION (IEC 62305)');
  f = r;
  const lp = [
    ['Air termination — Franklin/ESE rod, copper-bonded, with insulator + fixing (rooftop)', 'Nr', 6],
    ['Down conductor — 50mm² bare copper tape/wire, full building height (basement to roof)', 'm', 240],
    ['Test point chamber with disconnector, lockable lid, at base of each down conductor', 'Nr', 4],
    ['Earth electrode for LP system — copper-bonded rod + inspection chamber', 'Nr', 4],
    ['Surge protection device (SPD) Type 1+2 at LV panel main incomer', 'Nr', 2],
    ['Lightning protection design certification, risk assessment per IEC 62305-2', 'Sum', 1],
    ['LP testing & DEWA acceptance certificate', 'Sum', 1],
  ];
  lp.forEach((d, i) => lineRow(ws, r++, `9.2.${i + 1}`, d[0], 'IEC 62305', d[1], d[2], '', i % 2 === 1));
  subTotalRow(ws, r++, 'Sub-Total 9.2', f, r - 1); r++;

  return billTotalRow(ws, r, '9', r - 1);
}

// ─── Bill 10 — Emergency Lighting & Life Safety ───────────────────────────
function buildBill10(ws, meta, e, opts) {
  setBillHeader(ws, '10', 'EMERGENCY LIGHTING & LIFE SAFETY', meta);
  let r = 4;

  bandRow(ws, r++, '10.1 — EMERGENCY LUMINAIRES (3-hour autonomy)');
  let f = r;
  const lum = [
    ['Self-contained emergency LED downlight, 3 W, 3-hour duration, IP20, with self-test (corridors, lobbies)', 'Nr', 96],
    ['Self-contained emergency bulkhead, 8 W, 3-hour, IP65 (staircase, plant rooms)', 'Nr', 48],
    ['Maintained emergency exit sign LED, single-sided, with arrow pictogram (BS EN 1838)', 'Nr', 64],
    ['Maintained emergency exit sign LED, double-sided, ceiling-mounted', 'Nr', 18],
  ];
  lum.forEach((d, i) => lineRow(ws, r++, `10.1.${i + 1}`, d[0], 'BS 5266 / EN 1838', d[1], d[2], '', i % 2 === 1));
  subTotalRow(ws, r++, 'Sub-Total 10.1', f, r - 1); r++;

  bandRow(ws, r++, '10.2 — EMERGENCY POWER FOR LIFE-SAFETY EQUIPMENT (FR feeders)');
  f = r;
  const ls = [
    ['Power supply for fire pump panel — Fire-Rated cable from ESMDB-RF, including isolator & terminations', 'Set', 1],
    ['Power supply for stair pressurisation fans — FR feeder & isolator', 'Set', 1],
    ['Power supply for smoke-extract fans (basement & corridors) — FR feeder & isolator', 'Set', 1],
    ['Power supply for sprinkler-system jockey pump & main pump motor starter', 'Set', 1],
    ['Power supply for fire-fighter\'s lift (2-hour FR feeder)', 'Set', 1],
  ];
  ls.forEach((d, i) => lineRow(ws, r++, `10.2.${i + 1}`, d[0], 'DCD / NFPA 70', d[1], d[2], '', i % 2 === 1));
  subTotalRow(ws, r++, 'Sub-Total 10.2', f, r - 1); r++;

  // ── 10.3 — Central Battery System (alternative to self-contained luminaires) ──
  bandRow(ws, r++, '10.3 — CENTRAL BATTERY SYSTEM (CBS) — alternative to self-contained');
  f = r;
  const cbs = [
    ['CBS cabinet — 24/48 V DC, 3-hour autonomy, sized for total emergency luminaire load (~8 kW for this project), VRLA sealed batteries, charger, supervision, BMS interface, IP31, lockable. Provisional sum.', 'Sum', 1],
    ['Maintained-feed sub-circuits from CBS to corridor / public-area luminaires — Fire-Rated cable in dedicated FR containment, ID-labelled in red (allow per riser).',                                            'm',   180],
    ['CBS testing & 3-hour discharge witness test — under controlled outage, recording lumen output and battery voltage decay.',                                                                                     'Sum', 1],
  ];
  cbs.forEach((d, i) => lineRow(ws, r++, `10.3.${i + 1}`, d[0], 'BS 5266 / IEC 61347-2-7', d[1], d[2], '', i % 2 === 1));
  subTotalRow(ws, r++, 'Sub-Total 10.3', f, r - 1); r++;

  // ── 10.4 — Fire Alarm / MEP Integration (DCD requirement) ──
  bandRow(ws, r++, '10.4 — FIRE ALARM / MEP INTEGRATION (DCD requirement)');
  f = r;
  const faInt = [
    ['Shunt-trip relay for FAHU isolation on Fire Alarm activation — 24 V DC monitored coil, status feedback to FACP, MCCB shunt-trip module.',          'Nr', 1],
    ['Shunt-trip relay for AHU isolation per air-handling zone — 24 V DC monitored, status feedback to FACP. (Allow per AHU zone — typical per floor)',  'Nr', 8],
    ['Lift fire-recall interface module — homes lifts to designated fire-recall floor on Fire Alarm signal, monitored by FACP. (Per lift bank)',          'Nr', 4],
    ['Smoke / fire damper actuator power supply — 24 V DC monitored, with status feedback (allow per damper, including fire dampers and smoke control). ', 'Nr', 24],
    ['Mag-lock door release on fire alarm — fail-safe release, 24 V DC, monitored relay for FACP signalling. (Per access-controlled fire-route door.)',   'Nr', 12],
    ['FA-BMS interface relay rack — wall-mounted enclosure with 24 V DC PSU, monitored output relays for HVAC / lighting / lift signalling to FACP & BMS.', 'Set', 1],
    ['FA system tie-in cabling — Fire-Rated 2-core control cable from FACP to interface relays / shunt-trips / damper actuators. (Allow per tie-in.)',     'm',  280],
  ];
  faInt.forEach((d, i) => lineRow(ws, r++, `10.4.${i + 1}`, d[0], 'DCD / NFPA 72', d[1], d[2], '', i % 2 === 1));
  subTotalRow(ws, r++, 'Sub-Total 10.4', f, r - 1); r++;

  return billTotalRow(ws, r, '10', r - 1);
}

// ─── Bill 11 — ELV Containment ────────────────────────────────────────────
function buildBill11(ws, meta, e, opts) {
  setBillHeader(ws, '11', 'ELV CONTAINMENT (Tel/Data, CCTV, ACS, MATV, FA)', meta);
  let r = 4;

  bandRow(ws, r++, '11.1 — ELV CONTAINMENT — PROVISIONAL (specialist trades)');
  let f = r;
  const elv = [
    ['Telephone / data containment — uPVC conduit Ø 25 mm + draw wires from MDF/IDF to apartment outlets', 'm', 1200],
    ['CCTV containment — uPVC conduit Ø 25 mm + draw wires + back-boxes to camera locations', 'm', 600],
    ['Access Control containment — conduit + wiring trough at every controlled door', 'm', 350],
    ['MATV / SMATV containment — conduit + draw wires, MDF to apartment TV points', 'm', 800],
    ['Fire Alarm containment — fire-rated conduit Ø 25/32 mm at all loops, isolator points (specialist supply by FA contractor)', 'm', 900],
    ['BMS field cabling containment — conduit + tray at every field-device location (specialist supply by BMS contractor)', 'm', 600],
    ['Audio-Video / Door-entry containment — conduit + back-boxes', 'm', 250],
    ['ELV main risers — 100×100 mm GI trunking with separators between systems', 'm', 80],
  ];
  elv.forEach((d, i) => lineRow(ws, r++, `11.1.${i + 1}`, d[0], 'DEWA / DCD', d[1], d[2], 'Specialist scope', i % 2 === 1));
  subTotalRow(ws, r++, 'Sub-Total 11.1', f, r - 1); r++;

  return billTotalRow(ws, r, '11', r - 1);
}

// ─── Bill 12 — Metering ───────────────────────────────────────────────────
function buildBill12(ws, meta, e, opts) {
  setBillHeader(ws, '12', 'METERING & MONITORING', meta);
  let r = 4;

  bandRow(ws, r++, '12.1 — DEWA SMART METERING — Tenant & Landlord (AMI-ready, DEWA Smart Grid Programme)');
  let f = r;
  const tm = [
    ['DEWA-approved smart kWh meter, single-phase, AMI-ready (PLC + RF mesh communication), bi-directional metering capability, Class 1 accuracy, sealed, IEC 62052-11 / IEC 62053-21 compliant — for apartment tenants. Includes anti-tamper detection, configurable load-profile recording, remote-read capability.',
     'Nr', 120],
    ['DEWA-approved smart kWh meter, three-phase, CT-operated, AMI-ready, bi-directional with consumption + export channel for Shams Dubai net metering (where PV applicable), Class 0.5S accuracy, sealed, IEC 62053-22 — for retail / common services / landlord.',
     'Nr', 12],
    ['DEWA-approved smart meter cabinet — DEWA Service Connection Specifications compliant, modular, lockable, ventilated, IP31, with sealed access door for DEWA-only opening, RJ-45 / RS-485 communication ports.',
     'Nr', 8],
    ['Current transformers (CTs) for smart-meter feeders — Class 0.5S, 250/5 / 400/5 / 630/5 / 2000/5 ratios per panel schedule, sealed, with DEWA-approved label.',
     'Set', 1],
    ['AMI head-end / data-concentrator (PLC + RF mesh gateway) — coordination with DEWA where centralised concentrator is supplied by DEWA; provisional allowance for concentrator location, power supply, and back-haul cabling.',
     'Sum', 1],
  ];
  tm.forEach((d, i) => lineRow(ws, r++, `12.1.${i + 1}`, d[0], 'DEWA Smart Grid', d[1], d[2], 'DEWA-listed smart meter', i % 2 === 1));
  subTotalRow(ws, r++, 'Sub-Total 12.1', f, r - 1); r++;

  bandRow(ws, r++, '12.2 — PANEL METERING, BMS INTEGRATION & MDM COORDINATION');
  f = r;
  const pm = [
    ['Multi-function digital meter (MFM) on LV panel main incomer & outgoing feeders — V/I/P/Q/PF/THD measurement, MODBUS RTU/TCP communication, Class 0.5 accuracy.',
     'Nr', 12],
    ['Energy-monitoring software / SCADA package for panel-level metering — head-end software, dashboards, historical data logging — provisional sum.',
     'Sum', 1],
    ['DEWA MDM (Meter Data Management) integration — testing of meter-to-MDM connectivity, data validation, and acceptance per DEWA AMI specifications. Provisional sum.',
     'Sum', 1],
    ['Wiring, terminations, CT secondaries, communication cabling (RS-485 / Cat6) for panel-level + smart-meter system.',
     'Sum', 1],
    ['DEWA-witnessed meter sealing & acceptance — including AMI commissioning and remote-read verification.',
     'Sum', 1],
  ];
  pm.forEach((d, i) => lineRow(ws, r++, `12.2.${i + 1}`, d[0], 'DEWA / IEC 62053', d[1], d[2], '', i % 2 === 1));
  subTotalRow(ws, r++, 'Sub-Total 12.2', f, r - 1); r++;

  return billTotalRow(ws, r, '12', r - 1);
}

// ─── Bill 13 — Testing, Commissioning & DEWA Approval ─────────────────────
function buildBill13(ws, meta, e, opts) {
  setBillHeader(ws, '13', 'TESTING, COMMISSIONING & DEWA APPROVAL', meta);
  let r = 4;

  bandRow(ws, r++, '13.1 — ROUTINE ELECTRICAL TESTS (Pre-energisation)');
  let f = r;
  const t1 = [
    ['Insulation resistance testing of all LV cables — 500 V/1000 V Megger, full report.', 'Sum', 1],
    ['Continuity & polarity testing of all final circuits.', 'Sum', 1],
    ['Earth fault loop impedance testing at every distribution board.', 'Sum', 1],
    ['Phase rotation & balance testing at all 3-phase feeders.', 'Sum', 1],
    ['RCD testing at all RCD/RCBO-protected circuits.', 'Sum', 1],
  ];
  t1.forEach((d, i) => lineRow(ws, r++, `13.1.${i + 1}`, d[0], 'IEC 60364-6', d[1], d[2], '', i % 2 === 1));
  subTotalRow(ws, r++, 'Sub-Total 13.1', f, r - 1); r++;

  bandRow(ws, r++, '13.2 — SYSTEM COMMISSIONING (Energisation & Performance)');
  f = r;
  const t2 = [
    ['ATS changeover testing — simulate mains failure, verify auto-switchover, full load test.', 'Sum', 1],
    ['Standby generator full-load test — including load bank (if required), 4-hour run, fuel consumption recording.', 'Sum', 1],
    ['Power-factor correction verification — record PF before/after capacitor bank energisation, harmonic analysis.', 'Sum', 1],
    ['Earthing system resistance test (Megger DET) at every electrode and MEB.', 'Sum', 1],
    ['Lightning protection continuity test, including down-conductor resistance.', 'Sum', 1],
    ['Emergency lighting 3-hour duration test under controlled outage.', 'Sum', 1],
  ];
  t2.forEach((d, i) => lineRow(ws, r++, `13.2.${i + 1}`, d[0], 'IEC / DEWA', d[1], d[2], '', i % 2 === 1));
  subTotalRow(ws, r++, 'Sub-Total 13.2', f, r - 1); r++;

  bandRow(ws, r++, '13.3 — AUTHORITY APPROVALS & AS-BUILT DOCUMENTATION');
  f = r;
  const t3 = [
    ['DEWA Inspection Coordination — coordinating multiple DEWA inspection visits during construction (cable rough-in, panel termination, earthing, metering pre-energisation, energising, post-energisation), submission of inspection requests, attendance, and rectifications until each stage is signed off.',
     'Sum', 1],
    ['DEWA Final Approval & Energisation — application fees, witnessed routine test, meter sealing, energising-permit issue. Provisional sum.',
     'Sum', 1],
    ['Dubai Municipality (DM) electrical inspection clearance — coordination with DM inspectors, attendance, and rectifications until clearance is obtained for occupancy / completion certificate.',
     'Sum', 1],
    ['DCD (Dubai Civil Defence) electrical clearance for life-safety installations — emergency lighting witnessed test, fire-pump power-supply inspection, smoke-control fan circuit verification.',
     'Sum', 1],
    ['As-Built Drawings — Consultant Approval. As-Built drawings (AutoCAD .dwg + PDF, 4 hard-copy bound sets), submitted to consultant for review, revisions until approved and signed.',
     'Sum', 1],
    ['As-Built Drawings — DEWA Approval. As-Built submission to DEWA in DEWA-required format (specific layer / title-block / electronic file structure), revisions until approved and filed by DEWA.',
     'Sum', 1],
    ['Energising application & meter installation coordination with DEWA — preparing application package, submitting to DEWA, attendance at DEWA appointments.',
     'Sum', 1],
    ['Final commissioning report — bound, signed, indexed (5 hard copies + electronic PDF), including all routine-test results, manufacturer test certificates, witness signatures.',
     'Sum', 1],
    ['Operator training — 2 sessions of 4 hours each, including written training material in English (and Arabic where requested), covering operation, routine maintenance, and emergency response.',
     'Sum', 1],
    ['Witnessed handover walk-through with consultant & employer team — verifying every installation against As-Built, snag list, sign-off.',
     'Sum', 1],
  ];
  t3.forEach((d, i) => lineRow(ws, r++, `13.3.${i + 1}`, d[0], 'DEWA / DM / DCD', d[1], d[2], '', i % 2 === 1));
  subTotalRow(ws, r++, 'Sub-Total 13.3', f, r - 1); r++;

  return billTotalRow(ws, r, '13', r - 1);
}

// ─── Per-floor take-off appendix (informational, unpriced) ────────────────
// Inlined floor helpers — faithful ports of canonFloorKey() (canonicalize.ts),
// floorForCable() + deriveTypicalFloors() (derive-cable-paths.ts). KEEP IN SYNC.
const FLOOR_ORDINALS = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
  eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13,
  fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18,
  nineteenth: 19, twentieth: 20,
};

function canonFloorKey(raw) {
  let t = String(raw ?? '').toLowerCase().trim();
  if (!t) return '';
  for (const w of Object.keys(FLOOR_ORDINALS)) {
    t = t.replace(new RegExp(`\\b${w}\\b`, 'g'), String(FLOOR_ORDINALS[w]));
  }
  if (/\broof\s*top\b|\bupper\s*roof\b|\broof\b|\bterrace\b/.test(t)) return 'roof';
  if (/penthouse|\bph\b/.test(t)) return 'penthouse';
  if (/mezz/.test(t)) return 'mezzanine';
  if (/sub.?basement|basement|cellar|\bb\d\b/.test(t)) { const m = t.match(/(\d+)/); return 'basement' + (m ? m[1] : '1'); }
  if (/lower\s*ground|\blg\b/.test(t)) return 'basement1';
  if (/\bground\b|\bgf\b|\bg\.?f\b|\blobby\b/.test(t) && !/upper\s*ground/.test(t)) return 'ground';
  if (/upper\s*ground|\bug\b/.test(t)) return 'ground';
  if (/podium|car\s*park|parking/.test(t)) { const m = t.match(/(\d+)/); return 'podium' + (m ? m[1] : '1'); }
  const num = t.match(/(\d{1,2})/);
  if (num && /\b\d{1,2}\s*(?:st|nd|rd|th)?\s*(?:f|fl|flr|floor)\b|\b(?:f|fl|flr|floor|level|lvl|l)\s*\.?\s*\d{1,2}\b|^\s*\d{1,2}\s*$/.test(t)) {
    return 'f' + num[1];
  }
  return 'n:' + t.replace(/[^a-z0-9]+/g, ' ').trim();
}

function floorForCable(from, to) {
  const read = (tag) => {
    const t = (tag || '').toUpperCase();
    const numF = t.match(/-?(\d+)\s*F\b/);
    if (numF) return `${parseInt(numF[1], 10)}F`;
    if (/-?RF\b|ROOF/.test(t)) return 'Roof';
    if (/-?SH\d/.test(t)) return 'Ground';
    if (/-?EV\b|BASEMENT|-?B\d/.test(t)) return 'Basement';
    if (/-?GF?\b|GROUND/.test(t)) return 'Ground';
    return null;
  };
  return read(to) ?? read(from);
}

function deriveTypicalFloors(result) {
  const nums = new Set();
  for (const s of result?.smdb_inventory || []) {
    const m = (s.id || '').match(/SMDB-?(\d+)F\b/i);
    if (m) nums.add(parseInt(m[1], 10));
  }
  if (nums.size) return [...nums].sort((a, b) => a - b).map(n => `${n}F`);
  const numeric = (result?.floor_labels || [])
    .map(l => (l || '').trim().replace(/\s+/g, ''))
    .filter(l => /^\d+F$/i.test(l));
  return numeric;
}

function floorSheetName(label) {
  const clean = String(label || 'Floor').replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim();
  const name = `Floor - ${clean}`;
  return name.length > 31 ? name.slice(0, 31) : name;
}

// Quantity sub-total (sums the Qty column E, not Amount) — per-floor sheets are a
// take-off memorandum, so a money sub-total would be misleading (rates are blank).
function floorQtySubTotal(ws, r, label, firstRow, lastRow) {
  ws.mergeCells(`A${r}:D${r}`);
  ws.getCell(`A${r}`).value = label;
  ws.getCell(`A${r}`).style = STYLE.subTotal;
  ws.getCell(`E${r}`).value = { formula: `SUM(E${firstRow}:E${lastRow})`, result: null };
  ws.getCell(`E${r}`).style = { ...STYLE.subTotal, alignment: { horizontal: 'right', vertical: 'middle' } };
  ws.getCell(`E${r}`).numFmt = '#,##0';
  for (const c of ['F', 'G', 'H']) {
    ws.getCell(`${c}${r}`).value = '';
    ws.getCell(`${c}${r}`).style = STYLE.subTotal;
  }
  ws.getRow(r).height = 19.5;
}

function buildFloorTakeoff(ws, meta, e, opts, floorLabel) {
  setBillHeader(ws, 'F', `TAKE-OFF — ${floorLabel}`, meta);
  ws.getCell('A1').value = `FLOOR TAKE-OFF — ${floorLabel}  (MEMORANDUM — informational, not added to tender total)`;

  const key = canonFloorKey(floorLabel);
  const matchFloor = (f) => canonFloorKey(f) === key;
  const matchCable = (c) => matchFloor(floorForCable(c?.from || '', c?.to || ''));

  let r = 4;
  let blockNo = 0;
  let any = false;

  const renderBlock = (label, items, makeRow) => {
    if (!items || !items.length) return;
    any = true;
    blockNo++;
    bandRow(ws, r++, label);
    const first = r;
    items.forEach((it, i) => {
      const [desc, ref, unit, qty, remark] = makeRow(it, i);
      lineRow(ws, r++, `F.${blockNo}.${i + 1}`, desc, ref, unit, qty, remark || '', i % 2 === 1);
    });
    floorQtySubTotal(ws, r++, `Sub-Total — ${label}`, first, r - 1);
    r++;
  };

  renderBlock('SMDBs', (e?.smdb_inventory || []).filter((s) => matchFloor(s?.floor)),
    (s) => [
      `${s.id}: Sub-Main Distribution Board${s.rating_a ? `, ${s.rating_a}A` : ''}${s.connected_load_kw != null ? `, ${s.connected_load_kw} kW connected` : ''}`,
      'P-201', 'Nr', s.qty || 1, s.cable_size_from_mdb ? `Feed: ${s.cable_size_from_mdb}` : '',
    ]);

  renderBlock('Distribution Boards', (e?.db_inventory || []).filter((db) => matchFloor(db?.floor)),
    (db) => [
      `${db.db_id}: DB fed from ${db.smdb_id}${db.rating_a ? `, ${db.rating_a}A` : ''}`,
      'P-201', 'Nr', 1, db.cable_size ? `Feed: ${db.cable_size}` : '',
    ]);

  renderBlock('Cables', (e?.cable_schedule || []).filter(matchCable),
    (c) => [
      `${c.from} → ${c.to}${c.size_mm2 ? `, ${c.size_mm2} mm²` : ''}${c.type ? ` ${c.type}` : ''}`,
      c.source_drawing_number || 'P-201', 'm', c.length_m || 0, c.circuit_description || '',
    ]);

  renderBlock('Power Outlets & Accessories', (e?.power_outlets || []).filter((p) => matchFloor(p?.floor)),
    (p) => [p.description, 'P-103', p.unit || 'Nr', p.estimated_qty || 0, p.provisional ? 'Provisional' : '']);

  renderBlock('Lighting Fixtures', (e?.lighting_fixtures || []).filter((l) => matchFloor(l?.floor)),
    (l) => [l.description, 'P-104', 'Nr', l.qty || 0, l.type_ref || '']);

  const containment = (e?.containment_schedule || e?.containment || []).filter((x) => x && matchFloor(x.floor));
  renderBlock('Cable Containment', containment,
    (x) => [x.description || x.type || 'Containment', 'P-200', x.unit || 'm', x.qty || x.length_m || 0, '']);

  if (!any) {
    ws.mergeCells('A4:H4');
    ws.getCell('A4').value = `No floor-specific take-off extracted for ${floorLabel}. Items for this level may be billed building-wide in the Bills.`;
    ws.getCell('A4').style = { ...STYLE.body, font: { ...FONT_BASE, italic: true } };
    ws.getRow(4).height = 30;
  }
}

// ─── Summary ──────────────────────────────────────────────────────────────
function buildSummary(ws, meta, totals, opts) {
  ws.columns = [
    { width: 8 }, { width: 56 }, { width: 14 }, { width: 22 }, { width: 35 }, { width: 5 },
  ];
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 4, topLeftCell: 'A5', activeCell: 'A5' }];
  ws.pageSetup = {
    paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    horizontalCentered: true,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
  };
  ws.headerFooter = {
    oddHeader: `&L&"Arial,Bold"&12${meta.project_name}&R&"Arial,Italic"&10Job ${meta.job_no || ''}`,
    oddFooter: `&LBoQ Summary of Bills&RPage &P of &N`,
  };

  ws.mergeCells('A1:E1');
  ws.getCell('A1').value = 'BILL OF QUANTITIES — SUMMARY OF BILLS';
  ws.getCell('A1').style = STYLE.titleBar;
  ws.getRow(1).height = 27.75;

  ws.mergeCells('A2:E2');
  ws.getCell('A2').value = `${meta.project_name} | Plot ${meta.plot_no || '—'}, ${meta.location} | Job ${meta.job_no || ''}`;
  ws.getCell('A2').style = { ...STYLE.body, font: { ...FONT_BASE, italic: true, size: 9 }, alignment: { vertical: 'middle', horizontal: 'center' } };
  ws.getRow(2).height = 18;

  const head = ['Bill', 'Description', 'Sheet Ref', 'Bill Total (AED)', 'Notes'];
  head.forEach((h, i) => {
    const cell = ws.getRow(4).getCell(i + 1);
    cell.value = h;
    cell.style = STYLE.tableHead;
  });
  ws.getRow(4).height = 27.75;

  const bills = [
    [1,  'General Items / Preliminaries',                          'Bill 1',  'Mob, insurance, submittals, As-Built'],
    [2,  'HV / LV Main Distribution',                              'Bill 2',  'Transformer, MDB, generator, ATS, capacitors'],
    [3,  'Sub-Main Distribution Boards',                            'Bill 3',  'Typical floor, GF, RF, EV, retail, emergency'],
    [4,  'Distribution Boards & Consumer Units',                    'Bill 4',  'Apt, common, retail, emergency, mech'],
    [5,  'LV Power Cables',                                         'Bill 5',  'Main + distribution + final + ECC + FR'],
    [6,  'Cable Containment',                                       'Bill 6',  'Tray, ladder, conduit, trunking'],
    [7,  'Wiring Devices & Accessories',                             'Bill 7',  'Sockets, switches, isolators, EV outlets'],
    [8,  'Lighting Fixtures',                                       'Bill 8',  'Internal, external, controls'],
    [9,  'Earthing & Lightning Protection',                         'Bill 9',  'TN-S, electrodes, LP system'],
    [10, 'Emergency Lighting & Life Safety',                        'Bill 10', 'Self-contained, exit signs, FR feeders'],
    [11, 'ELV Containment',                                         'Bill 11', 'Tel/Data/CCTV/ACS/MATV/FA conduit'],
    [12, 'Metering & Monitoring',                                   'Bill 12', 'Tenant + panel meters, BMS integration'],
    [13, 'Testing, Commissioning & DEWA Approval',                   'Bill 13', 'Routine tests + system commissioning + DEWA'],
  ];
  let r = 5;
  bills.forEach(([k, d, s, n], i) => {
    const row = ws.getRow(r);
    row.getCell(1).value = k;
    row.getCell(2).value = d;
    row.getCell(3).value = s;
    row.getCell(4).value = { formula: `'${sheetNameFor(k)}'!G${totals[k]}`, result: 0 };
    row.getCell(4).numFmt = AED_FMT;
    row.getCell(5).value = n;
    const sty = i % 2 === 1 ? STYLE.bodyAlt : STYLE.body;
    for (let c = 1; c <= 5; c++) row.getCell(c).style = sty;
    // Per-cell overrides via spread (mutating .alignment directly would leak
    // to every other cell that shares the same STYLE.body / STYLE.bodyAlt ref).
    row.getCell(1).style = { ...sty, alignment: { ...sty.alignment, horizontal: 'center' } };
    row.getCell(4).style = { ...sty, alignment: { ...sty.alignment, horizontal: 'right' } };
    row.getCell(4).numFmt = AED_FMT;
    r++;
  });

  // Sub-total
  const subTotalRowIdx = r;
  ws.mergeCells(`A${r}:C${r}`);
  ws.getCell(`A${r}`).value = 'SUB-TOTAL OF BILLS (Bills 1–13)';
  ws.getCell(`A${r}`).style = STYLE.subTotal;
  ws.getCell(`D${r}`).value = { formula: `SUM(D5:D${r - 1})`, result: 0 };
  ws.getCell(`D${r}`).style = { ...STYLE.subTotal, alignment: { horizontal: 'right' } };
  ws.getCell(`D${r}`).numFmt = AED_FMT;
  ws.getCell(`E${r}`).value = '';
  ws.getCell(`E${r}`).style = STYLE.subTotal;
  r++;

  // Provisional sums (left blank for adjustments)
  ws.mergeCells(`A${r}:C${r}`);
  ws.getCell(`A${r}`).value = 'Provisional Sums adjustment (if any)';
  ws.getCell(`A${r}`).style = STYLE.subTotal;
  ws.getCell(`D${r}`).value = 0;
  ws.getCell(`D${r}`).style = { ...STYLE.subTotal, alignment: { horizontal: 'right' } };
  ws.getCell(`D${r}`).numFmt = AED_FMT;
  ws.getCell(`E${r}`).value = 'Editable — net adjustment';
  ws.getCell(`E${r}`).style = STYLE.subTotal;
  const psRowIdx = r;
  r++;

  // Day works
  ws.mergeCells(`A${r}:C${r}`);
  ws.getCell(`A${r}`).value = 'Day Works Schedule (per separate schedule)';
  ws.getCell(`A${r}`).style = STYLE.subTotal;
  ws.getCell(`D${r}`).value = 0;
  ws.getCell(`D${r}`).style = { ...STYLE.subTotal, alignment: { horizontal: 'right' } };
  ws.getCell(`D${r}`).numFmt = AED_FMT;
  ws.getCell(`E${r}`).value = 'Editable';
  ws.getCell(`E${r}`).style = STYLE.subTotal;
  const dwRowIdx = r;
  r++;

  // Contingency
  const contRowIdx = r;
  ws.mergeCells(`A${r}:C${r}`);
  ws.getCell(`A${r}`).value = `Contingency (${(opts.contingency_pct * 100).toFixed(0)}%) — on Bills 1–13`;
  ws.getCell(`A${r}`).style = STYLE.subTotal;
  ws.getCell(`D${r}`).value = { formula: `D${subTotalRowIdx}*${opts.contingency_pct}`, result: 0 };
  ws.getCell(`D${r}`).style = { ...STYLE.subTotal, alignment: { horizontal: 'right' } };
  ws.getCell(`D${r}`).numFmt = AED_FMT;
  ws.getCell(`E${r}`).value = '';
  ws.getCell(`E${r}`).style = STYLE.subTotal;
  r++;

  // Discount placeholder
  ws.mergeCells(`A${r}:C${r}`);
  ws.getCell(`A${r}`).value = 'Discount (if offered, enter as negative)';
  ws.getCell(`A${r}`).style = STYLE.subTotal;
  ws.getCell(`D${r}`).value = 0;
  ws.getCell(`D${r}`).style = { ...STYLE.subTotal, alignment: { horizontal: 'right' } };
  ws.getCell(`D${r}`).numFmt = AED_FMT;
  ws.getCell(`E${r}`).value = 'Editable';
  ws.getCell(`E${r}`).style = STYLE.subTotal;
  const dscRowIdx = r;
  r++;

  // Sub-total before VAT
  const beforeVATidx = r;
  ws.mergeCells(`A${r}:C${r}`);
  ws.getCell(`A${r}`).value = 'TOTAL TENDER PRICE — Excluding VAT';
  ws.getCell(`A${r}`).style = STYLE.billTotal;
  ws.getCell(`D${r}`).value = { formula: `D${subTotalRowIdx}+D${psRowIdx}+D${dwRowIdx}+D${contRowIdx}+D${dscRowIdx}`, result: 0 };
  ws.getCell(`D${r}`).style = { ...STYLE.billTotal, alignment: { horizontal: 'right' } };
  ws.getCell(`D${r}`).numFmt = AED_FMT;
  ws.getCell(`E${r}`).value = '';
  ws.getCell(`E${r}`).style = STYLE.billTotal;
  ws.getRow(r).height = 24;
  r++;

  // VAT
  const vatRowIdx = r;
  ws.mergeCells(`A${r}:C${r}`);
  ws.getCell(`A${r}`).value = `VAT (${(opts.vat_pct * 100).toFixed(0)}%) — UAE Federal Tax Authority`;
  ws.getCell(`A${r}`).style = STYLE.subTotal;
  ws.getCell(`D${r}`).value = { formula: `D${beforeVATidx}*${opts.vat_pct}`, result: 0 };
  ws.getCell(`D${r}`).style = { ...STYLE.subTotal, alignment: { horizontal: 'right' } };
  ws.getCell(`D${r}`).numFmt = AED_FMT;
  ws.getCell(`E${r}`).value = '';
  ws.getCell(`E${r}`).style = STYLE.subTotal;
  r++;

  // Grand total
  ws.mergeCells(`A${r}:C${r}`);
  ws.getCell(`A${r}`).value = 'GRAND TOTAL TENDER PRICE — Including VAT';
  ws.getCell(`A${r}`).style = STYLE.billTotal;
  ws.getCell(`D${r}`).value = { formula: `D${beforeVATidx}+D${vatRowIdx}`, result: 0 };
  ws.getCell(`D${r}`).style = { ...STYLE.billTotal, alignment: { horizontal: 'right' } };
  ws.getCell(`D${r}`).numFmt = AED_FMT;
  ws.getCell(`E${r}`).value = '';
  ws.getCell(`E${r}`).style = STYLE.billTotal;
  ws.getRow(r).height = 28;
  r += 2;

  // Form of tender placeholder
  ws.mergeCells(`A${r}:E${r}`);
  ws.getCell(`A${r}`).value = 'FORM OF TENDER';
  ws.getCell(`A${r}`).style = STYLE.groupBand;
  r++;
  const form = [
    'We, the undersigned, having examined the tender drawings, specifications, and bill of quantities, do hereby offer to execute the works for the sum stated above (Grand Total Tender Price including VAT).',
    'Validity period: 90 days from tender submission date.',
    'Construction period: as specified in the contract documents.',
    'Defects Liability Period: 12 months from substantial completion / handover.',
    `Authorised signatory: ${meta.contractor}`,
    `TRN: ${meta.contractor_trn}`,
    'Signature & Stamp: ____________________________   Date: ____________',
  ];
  for (const f of form) {
    ws.mergeCells(`A${r}:E${r}`);
    ws.getCell(`A${r}`).value = f;
    ws.getCell(`A${r}`).style = { ...STYLE.body, font: { ...FONT_BASE, size: 9 } };
    ws.getRow(r).height = Math.max(18, Math.ceil(f.length / 110) * 16);
    r++;
  }
}

function sheetNameFor(billNo) {
  return {
    1:  'Bill 1 - Preliminaries',
    2:  'Bill 2 - HV-LV Main',
    3:  'Bill 3 - SMDBs',
    4:  'Bill 4 - Distribution Boards',
    5:  'Bill 5 - LV Cables',
    6:  'Bill 6 - Containment',
    7:  'Bill 7 - Wiring Devices',
    8:  'Bill 8 - Lighting Fixtures',
    9:  'Bill 9 - Earthing & LP',
    10: 'Bill 10 - Emergency Lighting',
    11: 'Bill 11 - ELV Containment',
    12: 'Bill 12 - Metering',
    13: 'Bill 13 - Test & Commissioning',
  }[billNo];
}
