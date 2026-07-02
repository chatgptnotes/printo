// Paired tender-format BOQ PDF generator. Same data + section layout as
// the XLSX (Cover + A–G + Summary), rendered for print/consultant review.
// Rate/Amount columns are blank — pricing happens in the XLSX, not here.
//
// Pure ESM, PDFKit-based.

import PDFDocument from 'pdfkit';

const NAVY      = '#1F4E78';
const NAVY_LITE = '#D9E1F2';
const GREY      = '#F2F2F2';
const ROW_ALT   = '#F8F9FA';
const AMBER     = '#FFE699';
const RED       = '#C00000';
const TEXT      = '#1F2937';

const A4 = { w: 595.28, h: 841.89 };
const M  = { top: 36, left: 32, right: 32, bottom: 40 };
const CW = A4.w - M.left - M.right;

// Column widths for section sheets (Item · Description · Reference · Unit · Qty · Rate · Amount · Remarks)
const COLS = {
  item: 32, desc: 250, ref: 60, unit: 26, qty: 30, rate: 50, amount: 50, remark: 0,
};
COLS.remark = CW - (COLS.item + COLS.desc + COLS.ref + COLS.unit + COLS.qty + COLS.rate + COLS.amount);

/**
 * @param {{ project: any, electrical: any, overrides?: any, options?: any }} args
 * @returns {Promise<Buffer>}
 */
export async function generateTenderBoqPdf({ project, electrical, overrides = {}, options = {} }) {
  const opts = {
    contingency_pct: 0.10,
    vat_pct: 0.05,
    currency: 'AED',
    status: 'TENDER — FOR PRICING',
    ...options,
  };
  const meta = buildMeta(project, electrical, overrides);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: M.top, bottom: M.bottom, left: M.left, right: M.right },
      bufferPages: true,
      info: {
        Title: `Power BOQ Tender — ${meta.project_name}`,
        Author: 'SABI Engineering & Contracting LLC',
        Subject: 'Electrical Power BOQ (Tender Format)',
      },
    });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    renderCover(doc, meta, opts);
    renderSection(doc, 'A', 'LV Switchgear & Sub-Main Distribution Boards', meta, sectionARows(electrical));
    renderSection(doc, 'B', 'Distribution Boards (DBs) & Consumer Units',   meta, sectionBRows(electrical));
    renderSection(doc, 'C', 'LV Power Cables — Main & Rising Mains',         meta, sectionCRows(electrical));
    renderSection(doc, 'D', 'LV Power Cables — Distribution (SMDB→DB)',      meta, sectionDRows(electrical));
    renderSection(doc, 'E', 'Cable Management — Trays, Ladders & Conduits', meta, sectionERows(electrical));
    renderSection(doc, 'F', 'Earthing & Bonding',                            meta, sectionFRows(electrical));
    renderSection(doc, 'G', 'Sundries, Accessories & Testing/Commissioning', meta, sectionGRows());
    renderSummary(doc, meta, opts);

    doc.end();
  });
}

// ─── Meta (mirrors xlsx generator) ────────────────────────────────────────
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
    authority:    overrides.authority ?? 'DEWA',
    boq_date:     overrides.boq_date ?? new Date().toLocaleDateString('en-GB'),
    building: {
      tcl_kw: tcl > 0 ? tcl : null,
      max_demand_kw: md > 0 ? md : null,
      demand_factor: tcl > 0 ? Number((md / tcl).toFixed(3)) : null,
    },
  };
}

// ─── Cover ────────────────────────────────────────────────────────────────
function renderCover(doc, meta, opts) {
  // Title bar
  doc.rect(M.left, M.top, CW, 50).fill(NAVY);
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(18)
    .text('BILL OF QUANTITIES', M.left, M.top + 12, { width: CW, align: 'center' });
  doc.fontSize(11).text('ELECTRICAL POWER DISTRIBUTION WORKS', M.left, M.top + 32, { width: CW, align: 'center' });
  doc.fillColor(TEXT);

  let y = M.top + 70;
  doc.font('Helvetica-Bold').fontSize(11).text('PROJECT DETAILS', M.left, y);
  y += 18;
  const meta_rows = [
    ['Project',      meta.project_name],
    ['Owner',        meta.owner],
    ['Plot No.',     [meta.plot_no, meta.location].filter(Boolean).join(' — ')],
    ['Architect',    meta.architect],
    ['Structural',   meta.structural],
    ['Consultant',   meta.consultant],
    ['Job No.',      meta.job_no],
    ['Drawing Ref',  meta.drawing_set],
    ['Drawing Date', meta.drawing_date],
    ['BOQ Date',     meta.boq_date],
    ['Authority',    meta.authority],
  ].filter(([, v]) => !!v);

  doc.font('Helvetica').fontSize(10);
  for (const [k, v] of meta_rows) {
    doc.font('Helvetica-Bold').text(k, M.left, y, { width: 110, continued: false });
    doc.font('Helvetica').text(String(v), M.left + 115, y, { width: CW - 115 });
    y += 16;
  }

  // Building totals
  if (meta.building.tcl_kw != null) {
    y += 10;
    doc.rect(M.left, y, CW, 20).fill(NAVY);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(11)
      .text('BUILDING ELECTRICAL LOAD', M.left + 8, y + 5);
    doc.fillColor(TEXT);
    y += 24;

    const totals = [
      ['Total Connected Load (TCL)',  `${meta.building.tcl_kw.toFixed(2)} kW`],
      ['Demand Factor',                meta.building.demand_factor != null ? meta.building.demand_factor.toFixed(2) : '—'],
      ['Maximum Demand (MD)',          `~${Math.round(meta.building.max_demand_kw)} kW`],
    ];
    for (const [k, v] of totals) {
      doc.font('Helvetica-Bold').fontSize(10).text(k, M.left, y, { width: 200 });
      doc.font('Helvetica').text(v, M.left + 210, y, { width: CW - 210 });
      y += 16;
    }
  }

  // Reconciliation banner
  if (Array.isArray(opts.reconciliation_notes) && opts.reconciliation_notes.length) {
    y += 14;
    doc.rect(M.left, y, CW, 18).fill(AMBER);
    doc.fillColor('#7F4F00').font('Helvetica-Bold').fontSize(10)
      .text('RECONCILIATION NOTES — corrections applied vs source data', M.left + 8, y + 4);
    doc.fillColor(TEXT);
    y += 22;
    doc.font('Helvetica').fontSize(9);
    for (const note of opts.reconciliation_notes) {
      const h = doc.heightOfString(`• ${note}`, { width: CW - 16 });
      doc.fillColor('#7F4F00').text(`• ${note}`, M.left + 8, y, { width: CW - 16 });
      y += h + 4;
    }
    doc.fillColor(TEXT);
  }

  // Status banner
  y += 14;
  doc.rect(M.left, y, CW, 24).fill(RED);
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(13)
    .text(`STATUS: ${opts.status}`, M.left, y + 6, { width: CW, align: 'center' });
  doc.fillColor(TEXT);
}

// ─── Section page ─────────────────────────────────────────────────────────
function renderSection(doc, letter, title, meta, groups) {
  doc.addPage();
  let y = M.top;

  doc.rect(M.left, y, CW, 22).fill(NAVY);
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(11)
    .text(`SECTION ${letter} — ${title.toUpperCase()}`, M.left + 8, y + 6);
  doc.fillColor(TEXT);
  y += 26;

  doc.font('Helvetica').fontSize(8.5).fillColor('#6B7280')
    .text(`Project: ${meta.project_name}, Plot ${meta.plot_no || '—'} | Job: ${meta.job_no || '—'}`, M.left, y);
  doc.fillColor(TEXT);
  y += 14;

  // Column header
  y = drawHeaderRow(doc, y);

  for (const g of groups) {
    y = ensureRoomFor(doc, y, 24);
    doc.rect(M.left, y, CW, 16).fill(NAVY);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(9)
      .text(g.title, M.left + 6, y + 4);
    doc.fillColor(TEXT);
    y += 18;

    let i = 0;
    for (const row of g.rows) {
      const h = rowHeight(doc, row);
      y = ensureRoomFor(doc, y, h);
      const isAlt = i % 2 === 1;
      drawRow(doc, y, h, row, isAlt);
      y += h;
      i++;
    }

    // Sub-total band
    y = ensureRoomFor(doc, y, 18);
    doc.rect(M.left, y, CW, 16).fill(GREY);
    doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(9.5)
      .text(g.subtotalLabel || `Sub-Total ${letter}`, M.left + 6, y + 4, { width: CW * 0.7 });
    doc.text('—', M.left + colX('amount'), y + 4, { width: COLS.amount, align: 'right' });
    y += 20;
  }

  // Section total
  y = ensureRoomFor(doc, y, 24);
  doc.rect(M.left, y, CW, 22).fill(NAVY);
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(11)
    .text(`SECTION ${letter} — TOTAL`, M.left + 6, y + 6, { width: CW * 0.7 });
  doc.text('—', M.left + colX('amount'), y + 6, { width: COLS.amount, align: 'right' });
  doc.fillColor(TEXT);
}

function drawHeaderRow(doc, y) {
  doc.rect(M.left, y, CW, 20).fill(NAVY_LITE);
  doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(8.5);
  let x = M.left;
  const headers = [
    ['Item',   COLS.item],
    ['Description', COLS.desc],
    ['Reference',   COLS.ref],
    ['Unit',        COLS.unit],
    ['Qty',         COLS.qty],
    ['Rate (AED)',  COLS.rate],
    ['Amount (AED)', COLS.amount],
    ['Remarks',     COLS.remark],
  ];
  for (const [text, w] of headers) {
    doc.text(text, x + 3, y + 6, { width: w - 6, align: 'center' });
    x += w;
  }
  return y + 22;
}

function colX(key) {
  let x = 0;
  const order = ['item', 'desc', 'ref', 'unit', 'qty', 'rate', 'amount', 'remark'];
  for (const k of order) {
    if (k === key) return x;
    x += COLS[k];
  }
  return x;
}

function rowHeight(doc, row) {
  doc.font('Helvetica').fontSize(8.5);
  const h = doc.heightOfString(row.desc || '', { width: COLS.desc - 6 });
  return Math.max(16, h + 6);
}

function drawRow(doc, y, h, row, isAlt) {
  if (isAlt) doc.rect(M.left, y, CW, h).fill(ROW_ALT);
  doc.fillColor(TEXT).font('Helvetica').fontSize(8.5);
  const items = [
    [row.item || '',                         COLS.item,   'left'],
    [row.desc || '',                         COLS.desc,   'left'],
    [row.ref || '',                          COLS.ref,    'left'],
    [row.unit || '',                         COLS.unit,   'center'],
    [row.qty != null ? String(row.qty) : '', COLS.qty,    'right'],
    ['',                                     COLS.rate,   'right'],   // blank for pricing
    ['',                                     COLS.amount, 'right'],
    [row.remark || '',                       COLS.remark, 'left'],
  ];
  let x = M.left;
  for (const [val, w, align] of items) {
    doc.text(String(val), x + 3, y + 3, { width: w - 6, height: h - 6, align, lineBreak: true });
    x += w;
  }
  // thin border
  doc.lineWidth(0.3).strokeColor('#E5E7EB');
  doc.rect(M.left, y, CW, h).stroke();
}

function ensureRoomFor(doc, y, needed) {
  if (y + needed > A4.h - M.bottom) {
    doc.addPage();
    return drawHeaderRow(doc, M.top);
  }
  return y;
}

// ─── Section content extractors (mirror XLSX generator) ───────────────────
function sectionARows(e) {
  const groups = [];
  const lvRows = [];
  let n = 0;
  for (const p of (e?.lv_panels || [])) {
    n++;
    const acb = p.main_acb_rating_a ? `${p.main_acb_rating_a}A main ACB` : 'main ACB';
    const mccbs = (p.outgoing_mccbs || []).map(m => `${m.count}× ${m.rating_a}A→${m.to}`).join(', ');
    lvRows.push({
      item: `A1.${n}`,
      desc: `${p.tag}: 3P+N+E, 415V, floor-standing LV switchboard with ${acb}, busbars, metering. Outgoing: ${mccbs || 'as per SLD'}.`,
      ref: 'SLD', unit: 'Nr', qty: 1, remark: `${p.tag} main panel`,
    });
    const banks = p.capacitor_banks?.length ? p.capacitor_banks : (p.capacitor_bank_kvar ? [{ kvar: p.capacitor_bank_kvar }] : []);
    for (const b of banks) {
      n++;
      lvRows.push({
        item: `A1.${n}`,
        desc: `Capacitor Bank — ${b.kvar} kVAR, 415V, automatic PF correction for ${p.tag}.`,
        ref: 'SLD', unit: 'Nr', qty: 1, remark: `${p.tag} PF correction`,
      });
    }
  }
  if (e?.incoming_supply?.ats) {
    n++;
    lvRows.push({ item: `A1.${n}`, desc: `Automatic Transfer Switch (ATS) Panel — 415V, ${e.incoming_supply.ats.rating_a}A, 4P. Complete with controls and interlocking.`, ref: 'SLD', unit: 'Nr', qty: 1, remark: 'Mains/Gen changeover' });
  }
  if (e?.incoming_supply?.generator) {
    n++;
    const g = e.incoming_supply.generator;
    lvRows.push({ item: `A1.${n}`, desc: `Standby Generator — ${g.kva} kVA, ${g.type || 'diesel'}, weatherproof canopy, AMF panel, fuel tank, exhaust. Complete installed and commissioned.`, ref: 'SLD', unit: 'Nr', qty: 1, remark: 'Backup' });
  }
  if (lvRows.length) groups.push({ title: 'A1 — LV Panels & Main Switchgear', rows: lvRows, subtotalLabel: 'Sub-Total A1' });

  const smdbs = e?.smdb_inventory || [];
  const typical = smdbs.filter(s => /^[1-8]F$/i.test(s.floor || ''));
  const others  = smdbs.filter(s => !/^[1-8]F$/i.test(s.floor || ''));

  if (typical.length) {
    groups.push({
      title: 'A2 — SMDBs (Typical Floors)',
      rows: typical.map((s, i) => ({
        item: `A2.${i + 1}`,
        desc: `${s.id}: Floor-standing SMDB, ${s.rating_a ? `${s.rating_a}A TP MCCB` : 'TP MCCB'} incomer, outgoing MCCBs as per SLD. Connected load: ${s.connected_load_kw ?? '—'} kW.`,
        ref: 'SLD', unit: 'Nr', qty: 1, remark: `${s.floor}`,
      })),
      subtotalLabel: 'Sub-Total A2',
    });
  }

  if (others.length) {
    groups.push({
      title: 'A3 — SMDBs (Ground/Roof/Services/Emergency)',
      rows: others.map((s, i) => ({
        item: `A3.${i + 1}`,
        desc: `${s.id}: SMDB with ${s.rating_a ? `${s.rating_a}A TP MCCB` : 'TP MCCB'} incomer, outgoing MCCBs as per SLD.`,
        ref: 'SLD', unit: 'Nr', qty: s.qty ?? 1, remark: `${s.floor} — ${s.connected_load_kw ?? '—'} kW`,
      })),
      subtotalLabel: 'Sub-Total A3',
    });
  }
  return groups;
}

function sectionBRows(e) {
  if (!e?.db_groups?.length && !e?.db_inventory?.length) return [];
  const rows = (e.db_groups || []).map((g, i) => ({
    item: `B1.${i + 1}`,
    desc: `${g.tag_pattern}: TP incomer MCCB, outgoing MCBs per DEWA. IP4X.`,
    ref: g.tcl_range_kw ? `TCL ${g.tcl_range_kw} kW` : 'SLD',
    unit: 'Nr', qty: g.total_qty || g.per_floor_qty || 1,
    remark: g.per_floor_qty != null ? `${g.per_floor_qty}/floor × ${g.floors}` : '',
  }));
  if (rows.length) return [{ title: 'B1 — Distribution Boards', rows, subtotalLabel: 'Sub-Total B1' }];
  const invRows = (e.db_inventory || []).map((d, i) => ({
    item: `B1.${i + 1}`,
    desc: `${d.db_id}: DB fed from ${d.smdb_id}, ${d.rating_a ? `${d.rating_a}A TP` : 'TP'} incomer.`,
    ref: 'SLD', unit: 'Nr', qty: 1, remark: d.floor || '',
  }));
  return invRows.length ? [{ title: 'B1 — Distribution Boards', rows: invRows, subtotalLabel: 'Sub-Total B1' }] : [];
}

function sectionCRows(e) {
  const cables = e?.cable_schedule || [];
  const lvTags = new Set((e?.lv_panels || []).map(p => p.tag));
  const lv = cables.filter(c => lvTags.has(c.from) || /^(LVP|LV|MDB)/i.test(c.from || ''));
  const xlpe = lv.filter(c => !isFR(c));
  const fr   = lv.filter(c => isFR(c));
  const groups = [];
  if (xlpe.length) groups.push({
    title: 'C1 — XLPE/SWA/PVC LV Cables',
    rows: xlpe.map((c, i) => ({
      item: `C1.${i + 1}`,
      desc: `${c.cores || 4}C × ${c.size_mm2}mm² XLPE/SWA/PVC armoured — ${c.from} to ${c.to}${c.circuit_description ? ` (${c.circuit_description})` : ''}. Incl. glands, lugs, terminations.`,
      ref: 'SLD', unit: 'm', qty: Math.round(c.length_m || 0),
      remark: '',
    })),
    subtotalLabel: 'Sub-Total C1',
  });
  if (fr.length) groups.push({
    title: 'C2 — Fire-Rated (FR) Cables',
    rows: fr.map((c, i) => ({
      item: `C2.${i + 1}`,
      desc: `${c.cores || 4}C × ${c.size_mm2}mm² Fire-Rated (BS6387 CWZ) — ${c.from} to ${c.to}${c.circuit_description ? ` (${c.circuit_description})` : ''}.`,
      ref: 'SLD', unit: 'm', qty: Math.round(c.length_m || 0),
      remark: '',
    })),
    subtotalLabel: 'Sub-Total C2',
  });
  return groups;
}

function isFR(c) {
  const t = (c.type || '').toLowerCase();
  const d = (c.circuit_description || '').toLowerCase();
  return /fire|fr|cwz|emerg/i.test(t) || /fire pump|emergency|fire alarm|essential|esmdb/i.test(d);
}

function sectionDRows(e) {
  let cables = e?.smdb_to_db_cables || [];
  if (!cables.length) {
    const lvTags = new Set((e?.lv_panels || []).map(p => p.tag));
    cables = (e?.cable_schedule || []).filter(c => {
      const f = c.from || '';
      return !(lvTags.has(f) || /^(LVP|LV-?\d|MDB)/i.test(f));
    });
  }
  const groups = [];
  const emergency = cables.filter(c => /^E|^ESMDB|emergency/i.test(c.from));
  const normal    = cables.filter(c => !emergency.includes(c));

  if (normal.length) groups.push({
    title: 'D1 — XLPE/SWA/PVC Distribution Cables',
    rows: normal.map((c, i) => ({
      item: `D1.${i + 1}`,
      desc: `${c.cores || 4}C × ${c.size_mm2}mm² XLPE/SWA/PVC — ${c.from} to ${c.to}.`,
      ref: 'SLD', unit: 'm', qty: Math.round(c.length_m || 0),
    })),
    subtotalLabel: 'Sub-Total D1',
  });
  if (emergency.length) groups.push({
    title: 'D2 — Emergency Distribution Cables (FR)',
    rows: emergency.map((c, i) => ({
      item: `D2.${i + 1}`,
      desc: `${c.cores || 4}C × ${c.size_mm2}mm² Fire-Rated — ${c.from} to ${c.to}.`,
      ref: 'SLD', unit: 'm', qty: Math.round(c.length_m || 0),
    })),
    subtotalLabel: 'Sub-Total D2',
  });
  if (e?.bulk_cables?.length) groups.push({
    title: 'D3 — Final Circuit Cables (Aggregated)',
    rows: e.bulk_cables.map((b, i) => ({
      item: `D3.${i + 1}`,
      desc: b.specification,
      ref: 'SLD', unit: 'm', qty: Math.round(b.estimated_length_m || 0),
      remark: b.application,
    })),
    subtotalLabel: 'Sub-Total D3',
  });
  return groups;
}

function sectionERows(e) {
  if (!e?.containment?.length) return [];
  return [{
    title: 'E1 — Cable Trays, Ladders & Conduits',
    rows: e.containment.map((c, i) => ({
      item: `E1.${i + 1}`,
      desc: `${c.description}, c/w supports, brackets, bends, tees, fixings.`,
      ref: 'SLD', unit: c.unit || 'm', qty: Math.round(c.estimated_qty || 0),
    })),
    subtotalLabel: 'Sub-Total E1',
  }];
}

function sectionFRows(e) {
  const items = e?.earthing || [];
  if (items.length) return [{
    title: 'F1 — Main Earthing System',
    rows: items.map((it, i) => ({
      item: `F1.${i + 1}`, desc: it.description, ref: 'SLD',
      unit: it.unit || 'Nr', qty: Math.round(it.qty || 0),
    })),
    subtotalLabel: 'Sub-Total F1',
  }];
  // Defaults if no earthing data
  const defaults = [
    ['Main earth bar (MEB) in LV room — 50×6mm copper busbar.', 'Nr', 2],
    ['Earth pit (BS 7430 / DEWA) — 1200mm copper-bonded steel rod, inspection chamber. Resistance test < 1 Ω.', 'Nr', 4],
    ['1C × 95mm² bare copper earth conductor — MEB to earth pits and DEWA earth terminal.', 'm', 30],
    ['1C × 50mm² green/yellow PVC earth conductor — MEB to structural steel bonding points.', 'm', 40],
    ['Supplementary bonding conductor — 4mm² green/yellow to all metallic pipework, trays, equipment.', 'Item', 1],
  ];
  return [{
    title: 'F1 — Main Earthing System (defaults)',
    rows: defaults.map((d, i) => ({
      item: `F1.${i + 1}`, desc: d[0], ref: 'DEWA', unit: d[1], qty: d[2],
    })),
    subtotalLabel: 'Sub-Total F1',
  }];
}

function sectionGRows() {
  const sundries = [
    ['Cable identification labels — self-adhesive ferrules at both ends.', 'Item', 1],
    ['Cable cleats and ties — stainless steel, max 400mm vertical / 900mm horizontal.', 'Item', 1],
    ['Fire stopping — intumescent compounds, collars, pillows at fire-rated penetrations.', 'Item', 1],
    ['Smoke / fire barriers at electrical-riser floor penetrations.', 'Nr', 12],
    ['Temporary power supply during construction — provisional sum.', 'Sum', 1],
  ];
  const tnc = [
    ['Insulation resistance testing (500V Megger) — full report.', 'Item', 1],
    ['Continuity and polarity testing of all circuits.', 'Item', 1],
    ['Earth fault loop impedance testing at all boards.', 'Item', 1],
    ['RCD testing at all RCD-protected circuits.', 'Item', 1],
    ['ATS changeover testing — simulate mains failure, verify switchover.', 'Item', 1],
    ['Power factor correction verification — record before/after.', 'Item', 1],
    ['Full DEWA inspection and approval — provisional sum.', 'Sum', 1],
    ['As-built drawings (AutoCAD + PDF) and O&M Manuals.', 'Item', 1],
  ];
  return [
    {
      title: 'G1 — Accessories & Sundries',
      rows: sundries.map((d, i) => ({ item: `G1.${i + 1}`, desc: d[0], ref: '—', unit: d[1], qty: d[2] })),
      subtotalLabel: 'Sub-Total G1',
    },
    {
      title: 'G2 — Testing & Commissioning',
      rows: tnc.map((d, i) => ({ item: `G2.${i + 1}`, desc: d[0], ref: 'DEWA/IEC', unit: d[1], qty: d[2] })),
      subtotalLabel: 'Sub-Total G2',
    },
  ];
}

// ─── Summary page ────────────────────────────────────────────────────────
function renderSummary(doc, meta, opts) {
  doc.addPage();
  let y = M.top;

  doc.rect(M.left, y, CW, 26).fill(NAVY);
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(14)
    .text('BILL OF QUANTITIES — SUMMARY', M.left, y + 7, { width: CW, align: 'center' });
  doc.fillColor(TEXT);
  y += 32;

  doc.font('Helvetica').fontSize(9).fillColor('#6B7280')
    .text(`${meta.project_name} | Plot ${meta.plot_no || '—'}, ${meta.location} | ${meta.job_no || ''}`,
          M.left, y, { width: CW, align: 'center' });
  doc.fillColor(TEXT);
  y += 24;

  // Header
  const colsW = [50, 290, 80, 100, 0];
  colsW[4] = CW - colsW.slice(0, 4).reduce((a, b) => a + b, 0);
  const headers = ['Section', 'Description', 'Sheet Ref', 'Sub-Total (AED)', 'Notes'];
  doc.rect(M.left, y, CW, 22).fill(NAVY_LITE);
  doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(9.5);
  let x = M.left;
  for (let i = 0; i < headers.length; i++) {
    doc.text(headers[i], x + 4, y + 7, { width: colsW[i] - 8, align: i === 3 ? 'right' : 'left' });
    x += colsW[i];
  }
  y += 24;

  const sections = [
    ['A', 'LV Switchgear & SMDBs',                       'Sheet A', 'See sheet'],
    ['B', 'Distribution Boards & Consumer Units',        'Sheet B', 'See sheet'],
    ['C', 'LV Cables — Main & Rising Mains',             'Sheet C', 'See sheet'],
    ['D', 'LV Cables — Distribution',                    'Sheet D', 'See sheet'],
    ['E', 'Cable Management',                            'Sheet E', 'See sheet'],
    ['F', 'Earthing & Bonding',                          'Sheet F', 'See sheet'],
    ['G', 'Sundries & Testing/Commissioning',            'Sheet G', 'See sheet'],
  ];
  doc.font('Helvetica').fontSize(9.5);
  sections.forEach((s, i) => {
    if (i % 2 === 1) doc.rect(M.left, y, CW, 18).fill(ROW_ALT);
    doc.fillColor(TEXT);
    let xx = M.left;
    [s[0], s[1], s[2], '—', s[3]].forEach((v, j) => {
      doc.text(String(v), xx + 4, y + 5, { width: colsW[j] - 8, align: j === 3 ? 'right' : 'left' });
      xx += colsW[j];
    });
    y += 18;
  });

  y += 6;
  // Sub-total / contingency / VAT / grand total
  const summary_rows = [
    ['SUB-TOTAL (Sections A–G)', '—', GREY],
    [`Contingency (${(opts.contingency_pct * 100).toFixed(0)}%)`, '—', GREY],
    [`VAT (${(opts.vat_pct * 100).toFixed(0)}%)`, '—', GREY],
    ['GRAND TOTAL (incl. Contingency & VAT)', '—', NAVY],
  ];
  for (const [label, val, bg] of summary_rows) {
    const isGrand = bg === NAVY;
    doc.rect(M.left, y, CW, isGrand ? 26 : 22).fill(bg);
    doc.fillColor(isGrand ? '#FFFFFF' : TEXT)
      .font('Helvetica-Bold').fontSize(isGrand ? 12 : 10);
    doc.text(label, M.left + 6, y + (isGrand ? 8 : 6), { width: CW - 110 });
    doc.text(val, M.left + CW - 100, y + (isGrand ? 8 : 6), { width: 90, align: 'right' });
    doc.fillColor(TEXT);
    y += isGrand ? 28 : 22;
  }

  y += 14;
  doc.font('Helvetica-Oblique').fontSize(9).fillColor('#6B7280')
    .text('INSTRUCTIONS: Pricing happens in the paired XLSX. The PDF mirrors the layout for review/print only — Rate and Amount columns are intentionally blank.',
          M.left, y, { width: CW });
}
