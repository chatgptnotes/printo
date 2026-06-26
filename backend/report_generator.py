"""
Report generation — Bill of Quantities (BOQ).

Produces a print-friendly HTML report for a single drawing — the full title
block + a trade-grouped Bill of Quantities + the ERP payload — and a
project-level aggregate. Table-based markup (no flexbox/gradients/CSS vars) so
the same HTML renders correctly in the browser and through xhtml2pdf.

The report focuses on extraction + BOQ only; it does not include drawing
compliance review or confidence scoring.
"""

import datetime
from html import escape


FIELD_LABELS = {
    "drawing_number": "Drawing Number", "drawing_title": "Drawing Title",
    "project_name": "Project Name", "project_location": "Project Location",
    "plot_number": "Plot No.",
    "client_name": "Client Name", "contractor_name": "Contractor / Consultant",
    "drawn_by": "Drawn By", "checked_by": "Checked By", "approved_by": "Approved By",
    "date_of_issue": "Date of Issue", "revision_number": "Revision Number",
    "sheet_number": "Sheet Number", "total_sheets": "Total Sheets", "scale": "Scale",
    "floor_level": "Floor Level", "total_floor_area": "Total Floor Area",
    "building_type": "Building Type", "number_of_rooms": "Number of Rooms",
    "door_count": "Door Count", "window_count": "Window Count",
    "dimensions": "Overall Dimensions",
}

# Title-block fields, in report display order.
TITLE_BLOCK_ORDER = [
    "project_name", "client_name", "project_location", "plot_number", "contractor_name",
    "drawing_number", "drawing_title", "floor_level", "building_type",
    "scale", "dimensions", "total_floor_area", "date_of_issue",
    "revision_number", "sheet_number", "total_sheets",
    "drawn_by", "checked_by", "approved_by",
]


def _num_rate(v):
    """Leading numeric value from a rate string, else None (mirrors boq_excel._num)."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    import re as _re
    m = _re.search(r"-?\d[\d,]*\.?\d*", str(v))
    if not m:
        return None
    try:
        return float(m.group(0).replace(",", ""))
    except ValueError:
        return None


def _display_val(val):
    if val is None:
        return "—"
    if isinstance(val, bool):
        return "Yes" if val else "—"
    if isinstance(val, list):
        return ", ".join(str(x) for x in val) if val else "—"
    s = str(val).strip()
    return s if s else "—"


def _room_row(r):
    if isinstance(r, dict):
        return r.get("name", "—") or "—", r.get("area", "—") or "—"
    if isinstance(r, str):
        return r, "—"
    return str(r), "—"


def _conf_badge(conf):
    if conf is None:
        return '<span class="badge badge-gray">—</span>'
    if conf >= 0.85:
        return f'<span class="badge badge-green">{conf:.0%}</span>'
    if conf >= 0.60:
        return f'<span class="badge badge-amber">{conf:.0%}</span>'
    return f'<span class="badge badge-red">{conf:.0%}</span>'


def _boq_items(extracted: dict) -> list:
    return [b for b in (extracted.get("boq_items") or []) if isinstance(b, dict)]


def _boq_sections(extracted: dict) -> list:
    out = []
    for it in _boq_items(extracted):
        s = (it.get("section") or "General").strip() or "General"
        if s not in out:
            out.append(s)
    return out


def plain_summary(drawing_meta, extracted) -> str:
    """Plain-text BOQ summary — the editable draft a user reviews before approval."""
    boq = _boq_items(extracted)
    sections = _boq_sections(extracted)
    num = extracted.get("drawing_number") or "no number"
    title = extracted.get("drawing_title")
    proj = extracted.get("project_name") or "—"
    area = extracted.get("total_floor_area")
    title_part = f", {title}" if title else ""
    area_part = f" Total built-up area {area}." if area else ""
    return (
        f"Bill of Quantities for drawing {num}{title_part} — project {proj}.{area_part} "
        f"{len(boq)} line item(s) across {len(sections)} trade section(s)"
        f"{': ' + ', '.join(sections) if sections else ''}. "
        f"Quantities are taken off the uploaded drawing; rates to be applied by the estimator / ERP."
    )


def _corrections_html(corrections: list) -> str:
    if not corrections:
        return ""
    rows = ""
    for c in corrections:
        rows += f"""
          <tr>
            <td>{escape(str(FIELD_LABELS.get(c.get('field'), c.get('field', '—'))))}</td>
            <td class="muted">{escape(_display_val(c.get('original')))}</td>
            <td><strong>{escape(_display_val(c.get('corrected')))}</strong></td>
            <td>{escape(str(c.get('by', '—')))}</td>
            <td class="muted">{escape(str(c.get('at', '—'))[:16])}</td>
          </tr>"""
    return f"""
      <div class="section">
        <h2 class="section-title">Edits — Audit Trail</h2>
        <table class="data-table">
          <thead><tr><th>Field</th><th>Original</th><th>Edited</th>
            <th>By</th><th>When</th></tr></thead>
          <tbody>{rows}</tbody></table></div>"""


_BASE_CSS = """
  @page { size: A4; margin: 1.4cm 1.3cm; }
  * { box-sizing: border-box; }
  body { font-family: Helvetica, Arial, sans-serif; font-size: 11px; color: #1e293b; }
  .page { max-width: 980px; margin: 0 auto; background: #ffffff; }
  .header { background-color: #1a2744; color: #ffffff; padding: 18px 24px; }
  .brand { font-size: 20px; font-weight: bold; }
  .brand span { color: #F7941D; }
  .report-label { font-size: 10px; color: #94a3b8; }
  .header-meta { font-size: 10px; color: #cbd5e1; }
  .ribbon { background-color: #F7941D; color: #1a2744; padding: 8px 24px;
     font-size: 13px; font-weight: bold; letter-spacing: 0.5px; }
  .section { padding: 16px 24px; border-bottom: 1px solid #e2e8f0; }
  .section-title { font-size: 13px; font-weight: bold; color: #1a2744;
     border-bottom: 2px solid #F7941D; padding-bottom: 4px; margin: 0 0 10px; }
  .muted { color: #94a3b8; font-weight: normal; }
  table { border-collapse: collapse; width: 100%; }
  .data-table th { background-color: #f1f5f9; text-align: left; padding: 6px 9px;
     font-size: 9.5px; color: #475569; border: 1px solid #e2e8f0; }
  .data-table td { padding: 6px 9px; border: 1px solid #eef2f7; font-size: 10.5px; }
  .field-name { color: #475569; width: 38%; }
  .group-header td { background-color: #fff3e2; font-weight: bold; color: #b45309;
     font-size: 10px; padding: 6px 9px; }
  .bill-band { background-color: #1a2744; color: #ffffff; font-weight: bold;
     font-size: 11px; padding: 7px 10px; margin-top: 14px; }
  .bill-band span { color: #F7941D; }
  .boq td { vertical-align: top; }
  .boq .num { color: #94a3b8; text-align: center; }
  .boq .ralign { text-align: right; }
  .boq .calign { text-align: center; }
  .subtotal td { background-color: #f1f5f9; font-weight: bold; color: #1a2744;
     font-size: 10px; }
  .billsum td { font-size: 10px; }
  .billsum .total { text-align: right; color: #cbd5e1; }
  .grand td { background-color: #fff3e2; font-weight: bold; color: #b45309; }
  .badge { padding: 1px 7px; border-radius: 9px; font-size: 9.5px; font-weight: bold; }
  .badge-green { background-color: #dcfce7; color: #16a34a; }
  .badge-amber { background-color: #fef3c7; color: #d97706; }
  .badge-red { background-color: #fee2e2; color: #dc2626; }
  .badge-gray { background-color: #f1f5f9; color: #64748b; }
  .stat td { text-align: center; padding: 12px 6px; border: 1px solid #e2e8f0; }
  .stat .v { font-size: 18px; font-weight: bold; color: #1a2744; }
  .stat .l { font-size: 9px; color: #64748b; }
  .summary { font-size: 11.5px; color: #334155; }
  .thumb { border: 1px solid #e2e8f0; padding: 4px; }
  .footer { padding: 12px 24px; text-align: center; font-size: 9px; color: #94a3b8; }
"""


def _title_block_rows(extracted: dict) -> str:
    rows = ""
    for k in TITLE_BLOCK_ORDER:
        v = extracted.get(k)
        if v in (None, "", []):
            continue
        rows += (f'<tr><td class="field-name">{FIELD_LABELS.get(k, k)}</td>'
                 f'<td>{escape(_display_val(v))}</td></tr>')
    return rows or '<tr><td colspan="2" class="muted">No title-block fields detected.</td></tr>'


def _bill_table_head() -> str:
    # Per-line tables stay at four columns (#, Description, Unit, Qty): xhtml2pdf
    # renders a four-column table inside a padded section reliably but crashes on
    # six. Rate / Amount and the commercial roll-up live in the Summary of Bills
    # block below and (with live formulas) in the Excel workbook. Only the side
    # columns get fixed widths; Description is width-less so it takes the rest.
    return (
        '<table class="data-table boq"><thead><tr>'
        '<th style="width:30px">#</th><th>Description</th>'
        '<th style="width:64px">Unit</th><th style="width:88px">Qty</th>'
        '</tr></thead><tbody>'
    )


def _boq_table_html(extracted: dict) -> str:
    """Bill of Quantities rendered the industry way: one Bill per trade section,
    Item / Description / Reference / Unit / Qty / Rate / Amount, a sub-total per
    Bill, then a Summary of Bills. Rates are left for pricing (use the Excel
    workbook for live totals)."""
    items = _boq_items(extracted)
    if not items:
        return ('<div class="section"><h2 class="section-title">Bill of Quantities</h2>'
                '<p class="muted">No BOQ line items were extracted from this drawing.</p></div>')

    sections = _boq_sections(extracted)

    bills_html = ""
    summary_rows = ""
    for bill_no, sec in enumerate(sections, 1):
        sec_items = [it for it in items
                     if ((it.get("section") or "General").strip() or "General") == sec]
        rows = ""
        for k, it in enumerate(sec_items, 1):
            rate = it.get("rate")
            priced = _num_rate(rate) is not None
            meta_bits = []
            if it.get("tag"):
                meta_bits.append(f'Tag {escape(str(it.get("tag")))}')
            if it.get("rating"):
                meta_bits.append(f'Rating: {escape(str(it.get("rating")))}')
            if it.get("cable_size"):
                meta_bits.append(f'Cable: {escape(str(it.get("cable_size")))}')
            if it.get("from_ref") or it.get("to_ref"):
                meta_bits.append(
                    f'From/To: {escape(str(it.get("from_ref") or "—"))} → '
                    f'{escape(str(it.get("to_ref") or "—"))}'
                )
            if it.get("floor"):
                meta_bits.append(f'Area: {escape(str(it.get("floor")))}')
            if it.get("reference"):
                meta_bits.append(f'Ref {escape(str(it.get("reference")))}')
            if it.get("origin"):
                meta_bits.append(f'Brand: {escape(str(it.get("origin")))}')
            meta_bits.append(
                f'Indicative rate: AED {escape(str(rate))}/unit' if priced
                else '<span style="color:#b45309;">Rate: to be priced</span>')
            sub = (f'<div class="muted" style="font-size:8.5px;margin-top:2px;">'
                   f'{" &middot; ".join(meta_bits)}</div>')
            tr_style = '' if priced else ' style="background:#fff4e0;"'
            rows += (
                f'<tr{tr_style}><td class="num">{bill_no}.{k}</td>'
                f'<td>{escape(_display_val(it.get("description")))}{sub}</td>'
                f'<td class="calign">{escape(_display_val(it.get("unit")))}</td>'
                f'<td class="ralign">{escape(_display_val(it.get("quantity")))}</td></tr>'
            )
        bills_html += (
            f'<div class="bill-band">BILL No. {bill_no} <span>|</span> {escape(sec)} '
            f'<span style="float:right;font-weight:normal;">{len(sec_items)} item(s)</span></div>'
            f'{_bill_table_head()}{rows}</tbody></table>'
        )
        summary_rows += (
            f'<tr><td class="calign">{bill_no}</td><td>{escape(sec)}</td>'
            f'<td class="calign">Bill {bill_no}</td><td class="total">—</td></tr>'
        )

    summary_html = (
        '<div class="bill-band" style="margin-top:18px;">SUMMARY OF BILLS</div>'
        '<table class="data-table billsum"><thead><tr>'
        '<th style="width:36px">Bill</th><th>Description</th>'
        '<th style="width:66px">Sheet</th><th style="width:110px">Bill Total (AED)</th>'
        f'</tr></thead><tbody>{summary_rows}'
        '<tr class="subtotal"><td colspan="3" style="text-align:right;">'
        'Sub-Total of Bills (excl. VAT)</td><td class="total">—</td></tr>'
        '<tr class="billsum"><td colspan="3" style="text-align:right;">Contingency (10%)</td>'
        '<td class="total">—</td></tr>'
        '<tr class="billsum"><td colspan="3" style="text-align:right;">VAT (5%)</td>'
        '<td class="total">—</td></tr>'
        '<tr class="grand"><td colspan="3" style="text-align:right;">'
        'GRAND TOTAL (incl. VAT)</td><td class="ralign">—</td></tr>'
        '</tbody></table>'
    )

    return (
        '<div class="section"><h2 class="section-title">Bill of Quantities '
        f'<span class="muted">({len(items)} item(s) &middot; {len(sections)} bill(s))</span></h2>'
        '<p class="muted" style="margin:0 0 8px;font-size:9.5px;">'
        'Quantities taken off the uploaded drawing, grouped into priced Bills by trade. '
        'Unit rates, line amounts and Bill totals are in the downloadable Excel '
        'workbook (live auto-totalling formulas); the Summary of Bills below shows the '
        'commercial roll-up.</p>'
        f'{bills_html}{summary_html}</div>'
    )


def generate_report(drawing_meta, extracted, rule_results, verdict, elapsed,
                    erp_payload, corrections=None, thumbnail_uri=None,
                    approved=True, summary_override=None,
                    approved_by=None, approved_at=None):
    """BOQ report: title block + trade-grouped Bill of Quantities + ERP payload.

    rule_results / verdict are accepted for signature compatibility but unused.
    """
    generated_at = datetime.datetime.now().strftime("%d %b %Y, %H:%M")
    file_name = drawing_meta.get("file_name", "—")
    drawing_id = drawing_meta.get("drawing_id", "—")

    # User-provided project description (captured at upload) — shown only if given.
    proj_desc = (drawing_meta.get("project_description") or "").strip()
    proj_desc_html = ""
    if proj_desc:
        proj_desc_html = (
            '<div class="section"><h2 class="section-title">Project Description</h2>'
            f'<p class="summary">{escape(proj_desc).replace(chr(10), "<br>")}</p></div>'
        )

    boq = _boq_items(extracted)
    sections = _boq_sections(extracted)

    summary = (
        f"Bill of Quantities for <strong>{escape(_display_val(extracted.get('drawing_number')))}</strong>"
        f"{(', ' + escape(str(extracted.get('drawing_title')))) if extracted.get('drawing_title') else ''} — "
        f"project <strong>{escape(_display_val(extracted.get('project_name')))}</strong>. "
        f"<strong>{len(boq)}</strong> line item(s) across <strong>{len(sections)}</strong> trade section(s). "
        f"Quantities are taken off the uploaded drawing; rates to be applied by the estimator / ERP."
    )
    if summary_override:
        summary = escape(str(summary_override)).replace("\n", "<br>")

    draft_banner = ""
    if not approved:
        draft_banner = (
            '<div style="background-color:#fef3c7;color:#92400e;padding:9px 24px;'
            'font-size:12px;font-weight:bold;border-bottom:2px solid #f59e0b;">'
            '&#9208; DRAFT BOQ — awaiting review &amp; approval (not yet pushed to ERP)</div>'
        )
    approval_line = ""
    if approved and approved_by:
        when = str(approved_at or "")[:16].replace("T", " ")
        approval_line = (
            '<div style="background-color:#dcfce7;color:#166534;padding:9px 24px;'
            'font-size:12px;font-weight:bold;border-bottom:2px solid #16a34a;">'
            f'&#10003; Approved by {escape(str(approved_by))}'
            f'{(" on " + when) if when else ""} &nbsp;|&nbsp; pushed to RealSoft</div>'
        )

    def _stat(v, label):
        return f'<td><div class="v">{escape(_display_val(v))}</div><div class="l">{label}</div></td>'
    stat_cells = (
        _stat(extracted.get("total_floor_area"), "FLOOR AREA")
        + _stat(extracted.get("building_type"), "TYPE")
        + _stat(extracted.get("number_of_rooms"), "ROOMS")
        + _stat(extracted.get("door_count"), "DOORS")
        + _stat(extracted.get("window_count"), "WINDOWS")
    )

    room_schedule = extracted.get("room_schedule") or []
    room_html = ""
    if room_schedule:
        rr = "".join(f'<tr><td>{escape(str(name))}</td><td>{escape(str(area))}</td></tr>'
                     for name, area in (_room_row(r) for r in room_schedule))
        room_html = (f'<div class="section"><h2 class="section-title">Room Schedule</h2>'
                     f'<table class="data-table"><thead><tr><th>Room</th><th>Area</th></tr></thead>'
                     f'<tbody>{rr}</tbody></table></div>')

    erp_rows = ""
    if erp_payload:
        data_block = erp_payload.get("data", erp_payload)
        for k, v in (data_block or {}).items():
            erp_rows += f"<tr><td>{escape(str(k))}</td><td>{escape(_display_val(v))}</td></tr>"
    erp_title = ("ERP Payload — RealSoft (simulation)" if approved
                 else "ERP Payload — RealSoft (preview — not yet pushed)")

    thumb_html = ""
    if thumbnail_uri:
        thumb_html = (f'<div class="section"><h2 class="section-title">Source Drawing</h2>'
                      f'<img class="thumb" src="{thumbnail_uri}" style="max-width:100%;" /></div>')

    html = f"""<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>ERP RealSoft — Bill of Quantities #{drawing_id}</title>
<style>{_BASE_CSS}</style></head><body><div class="page">

  <div class="header">
    <table><tr>
      <td><div class="brand">ERP <span>RealSoft</span></div>
          <div class="report-label">Bill of Quantities</div></td>
      <td style="text-align:right;" class="header-meta">
        Generated {generated_at}<br>Drawing #{drawing_id} &nbsp;|&nbsp; {escape(str(file_name))}</td>
    </tr></table>
  </div>

  <div class="ribbon">BILL OF QUANTITIES &nbsp;|&nbsp; {len(boq)} items &nbsp;|&nbsp; {len(sections)} sections &nbsp;|&nbsp; {elapsed}s</div>

  {draft_banner}{approval_line}

  <div class="section">
    <h2 class="section-title">Summary</h2>
    <p class="summary">{summary}</p>
    <table style="margin-top:10px;"><tr class="stat">{stat_cells}</tr></table>
  </div>

  {proj_desc_html}

  <div class="section">
    <h2 class="section-title">Title Block</h2>
    <table class="data-table"><thead><tr><th>Field</th><th>Value</th></tr></thead>
      <tbody>{_title_block_rows(extracted)}</tbody></table>
  </div>

  {_boq_table_html(extracted)}

  {room_html}
  {thumb_html}
  {_corrections_html(corrections)}

  <div class="section">
    <h2 class="section-title">{erp_title}</h2>
    <table class="data-table"><thead><tr><th>ERP Field</th><th>Value</th></tr></thead>
      <tbody>{erp_rows}</tbody></table>
  </div>

  <div class="footer">Generated by ERP RealSoft AI &nbsp;|&nbsp; Coral Business Solutions
    &nbsp;|&nbsp; {generated_at}</div>
</div></body></html>"""
    return html


def generate_project_report(drawings: list) -> str:
    """Project-level aggregate across all processed drawings."""
    generated_at = datetime.datetime.now().strftime("%d %b %Y, %H:%M")
    total = len(drawings)
    done = sum(1 for d in drawings if d.get("status") == "done")
    errors = sum(1 for d in drawings if d.get("status") == "error")

    by_project = {}
    for d in drawings:
        by_project.setdefault(d.get("project_name") or "Unassigned", []).append(d)

    proj_html = ""
    for pname, items in by_project.items():
        rows = ""
        for d in items:
            status = d.get("status", "—")
            scolor = {"done": "#16a34a", "error": "#dc2626"}.get(status, "#64748b")
            rows += f"""<tr>
              <td>#{d.get('id')}</td>
              <td>{escape(_display_val(d.get('drawing_number')))}</td>
              <td>{escape(_display_val(d.get('drawing_title')))}</td>
              <td>{escape(_display_val(d.get('floor_category')))}</td>
              <td style="color:{scolor};font-weight:bold;">{status}</td></tr>"""
        proj_html += f"""<div class="section">
          <h2 class="section-title">{escape(str(pname))} <span class="muted">({len(items)} drawing(s))</span></h2>
          <table class="data-table"><thead><tr><th>ID</th><th>Drawing No.</th><th>Title</th>
            <th>Floor</th><th>Status</th></tr></thead>
          <tbody>{rows}</tbody></table></div>"""

    html = f"""<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>ERP RealSoft — Project BOQ Summary</title><style>{_BASE_CSS}</style></head>
<body><div class="page">
  <div class="header">
    <table><tr>
      <td><div class="brand">ERP <span>RealSoft</span></div>
          <div class="report-label">Project BOQ Summary</div></td>
      <td style="text-align:right;" class="header-meta">Generated {generated_at}<br>
        {len(by_project)} project(s) &nbsp;|&nbsp; {total} drawing(s)</td>
    </tr></table>
  </div>
  <div class="section">
    <h2 class="section-title">Portfolio Overview</h2>
    <table><tr class="stat">
      <td><div class="v">{total}</div><div class="l">TOTAL DRAWINGS</div></td>
      <td><div class="v" style="color:#16a34a;">{done}</div><div class="l">COMPLETED</div></td>
      <td><div class="v" style="color:#dc2626;">{errors}</div><div class="l">ERRORS</div></td>
      <td><div class="v">{len(by_project)}</div><div class="l">PROJECTS</div></td>
    </tr></table>
  </div>
  {proj_html}
  <div class="footer">Generated by ERP RealSoft AI &nbsp;|&nbsp; Coral Business Solutions
    &nbsp;|&nbsp; {generated_at}</div>
</div></body></html>"""
    return html


def html_to_pdf_bytes(html: str) -> bytes | None:
    """Convert report HTML to PDF bytes via xhtml2pdf. Returns None on failure."""
    try:
        import io
        from xhtml2pdf import pisa
        buf = io.BytesIO()
        result = pisa.CreatePDF(html, dest=buf, encoding="utf-8")
        if result.err:
            return None
        return buf.getvalue()
    except Exception:
        return None
