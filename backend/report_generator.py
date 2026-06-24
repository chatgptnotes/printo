"""
Summary report generation.

Produces a polished, print-friendly HTML report for a single drawing and a
project-level aggregate report. The HTML is intentionally **table-based** (no
flexbox / gradients / CSS variables) so the same markup renders correctly both
in the browser and through xhtml2pdf (`html_to_pdf_bytes`).

Sections (per-drawing): exec summary + quality score, drawing thumbnail,
extracted fields, room schedule, confidence chart, validation, corrections
audit trail, ERP payload.
"""

import datetime
from html import escape


# ── small helpers ─────────────────────────────────────────────────────────────
def _conf_badge(conf):
    if conf is None:
        return '<span class="badge badge-gray">N/A</span>'
    if conf >= 0.85:
        return f'<span class="badge badge-green">{conf:.0%}</span>'
    if conf >= 0.60:
        return f'<span class="badge badge-amber">{conf:.0%}</span>'
    return f'<span class="badge badge-red">{conf:.0%}</span>'


def _conf_color(conf):
    if conf is None:
        return "#cbd5e1"
    if conf >= 0.85:
        return "#16a34a"
    if conf >= 0.60:
        return "#d97706"
    return "#dc2626"


def _verdict_style(verdict):
    if verdict == "PASSED":
        return "#16a34a", "PASS", "ALL RULES PASSED"
    if verdict == "WARNING":
        return "#d97706", "WARN", "PASSED WITH WARNINGS"
    return "#dc2626", "FAIL", "VALIDATION FAILED"


def _room_row(r):
    """Normalise one room-schedule entry to (name, area).

    The extractor/AI is untrusted: an entry may be a {"name","area"} dict, a
    bare string (just the room name), or something else. Never assume a dict.
    """
    if isinstance(r, dict):
        return r.get("name", "—") or "—", r.get("area", "—") or "—"
    if isinstance(r, str):
        return r, "—"
    return str(r), "—"


FIELD_LABELS = {
    "drawing_number": "Drawing Number", "drawing_title": "Drawing Title",
    "project_name": "Project Name", "project_location": "Project Location",
    "client_name": "Client Name", "contractor_name": "Contractor / Consultant",
    "drawn_by": "Drawn By", "checked_by": "Checked By", "approved_by": "Approved By",
    "date_of_issue": "Date of Issue", "revision_number": "Revision Number",
    "sheet_number": "Sheet Number", "total_sheets": "Total Sheets", "scale": "Scale",
    "floor_level": "Floor Level", "total_floor_area": "Total Floor Area",
    "building_type": "Building Type", "number_of_rooms": "Number of Rooms",
    "door_count": "Door Count", "window_count": "Window Count",
    "structural_notes": "Structural Notes", "materials": "Materials",
    "quantities": "Quantities", "dimensions": "Overall Dimensions",
    "approval_stamp": "Approval Stamp", "north_arrow": "North Arrow",
    "grid_lines": "Grid Lines", "additional_notes": "Additional Notes",
}

FIELD_GROUPS = {
    "Title Block": ["drawing_number", "drawing_title", "project_name", "project_location",
                    "client_name", "contractor_name", "date_of_issue", "revision_number",
                    "sheet_number", "total_sheets", "scale"],
    "Floor Plan Info": ["floor_level", "total_floor_area", "building_type", "number_of_rooms",
                        "door_count", "window_count", "dimensions"],
    "Participants": ["drawn_by", "checked_by", "approved_by"],
    "Technical": ["structural_notes", "materials", "quantities", "approval_stamp",
                  "north_arrow", "grid_lines", "additional_notes"],
}

# Fields that meaningfully count toward "completeness" of an extraction.
KEY_FIELDS = [
    "drawing_number", "drawing_title", "project_name", "scale", "revision_number",
    "sheet_number", "floor_level", "total_floor_area", "building_type",
    "dimensions", "materials", "quantities", "approval_stamp", "drawn_by",
]


def quality_score(extracted: dict, rule_results: list) -> tuple[int, str, str]:
    """Composite extraction-quality score 0–100.

    Blends field completeness (key fields populated), average calibrated
    confidence, and rule pass-rate. Returns (score, label, color).
    """
    conf = extracted.get("confidence", {}) or {}

    def populated(k):
        return extracted.get(k) not in (None, "", [], False)

    completeness = sum(1 for k in KEY_FIELDS if populated(k)) / len(KEY_FIELDS)
    conf_vals = [v for v in conf.values() if v is not None]
    avg_conf = sum(conf_vals) / len(conf_vals) if conf_vals else 0.0
    total = len(rule_results) or 1
    pass_rate = sum(1 for r in rule_results if r.passed) / total

    score = round(100 * (0.30 * completeness + 0.40 * avg_conf + 0.30 * pass_rate))
    if score >= 85:
        return score, "Excellent", "#16a34a"
    if score >= 70:
        return score, "Good", "#16a34a"
    if score >= 50:
        return score, "Fair", "#d97706"
    return score, "Needs Review", "#dc2626"


def plain_summary(drawing_meta, extracted, rule_results, verdict) -> str:
    """Plain-text executive summary — the editable draft a user reviews and approves
    before the final report is generated. Mirrors the HTML summary in generate_report
    without markup, so it round-trips cleanly through an editable textarea."""
    conf = extracted.get("confidence", {}) or {}
    field_count = sum(1 for k, v in extracted.items()
                      if k != "confidence" and v not in (None, [], "", False))
    conf_values = [v for v in conf.values() if v is not None]
    avg_conf = sum(conf_values) / len(conf_values) if conf_values else 0.0
    passed_rules = sum(1 for r in rule_results if r.passed)
    total_rules = len(rule_results)
    error_count = sum(1 for r in rule_results if not r.passed and r.severity == "ERROR")
    warn_count = sum(1 for r in rule_results if not r.passed and r.severity == "WARNING")
    score, score_label, _ = quality_score(extracted, rule_results)

    floor_cat = (drawing_meta or {}).get("floor_category") or ""
    num = extracted.get("drawing_number") or "no number"
    title = extracted.get("drawing_title")
    proj = extracted.get("project_name") or "—"
    title_part = f", {title}" if title else ""
    return (
        f"This {floor_cat.lower() + ' ' if floor_cat else ''}drawing "
        f"({num}{title_part}) for project {proj} yielded {field_count} populated "
        f"fields at {avg_conf:.0%} average confidence. {passed_rules} of {total_rules} "
        f"validation rules passed ({error_count} error(s), {warn_count} warning(s)). "
        f"Overall extraction quality is rated {score_label} ({score}/100)."
    )


def _display_val(val):
    if val is None:
        return "—"
    if isinstance(val, bool):
        return "Yes" if val else "—"
    if isinstance(val, list):
        return ", ".join(str(x) for x in val) if val else "—"
    return str(val)


def _confidence_chart_html(extracted: dict, limit: int = 14) -> str:
    """Horizontal confidence bars (weakest first) — two-cell tables, PDF-safe."""
    conf = extracted.get("confidence", {}) or {}
    items = [(k, c) for k, c in conf.items()
             if c is not None and extracted.get(k) not in (None, "", [], False)]
    if not items:
        return ""
    items.sort(key=lambda kv: kv[1])          # weakest at top
    rows = ""
    for k, c in items[:limit]:
        label = FIELD_LABELS.get(k, k)
        pct = max(2, int(round(c * 100)))
        color = _conf_color(c)
        rows += f"""
        <tr>
          <td class="bar-label">{label}</td>
          <td class="bar-cell">
            <table class="bar"><tr>
              <td style="width:{pct}%;background-color:{color};">&nbsp;</td>
              <td style="width:{100 - pct}%;background-color:#edf1f7;">&nbsp;</td>
            </tr></table>
          </td>
          <td class="bar-pct">{c:.0%}</td>
        </tr>"""
    return f"""
      <div class="section">
        <h2 class="section-title">Confidence by Field <span class="muted">(lowest first)</span></h2>
        <table class="bars">{rows}</table>
      </div>"""


def _corrections_html(corrections: list) -> str:
    if not corrections:
        return ""
    rows = ""
    for c in corrections:
        rows += f"""
          <tr>
            <td>{FIELD_LABELS.get(c.get('field'), c.get('field', '—'))}</td>
            <td class="muted">{_display_val(c.get('original'))}</td>
            <td><strong>{_display_val(c.get('corrected'))}</strong></td>
            <td>{c.get('by', '—')}</td>
            <td class="muted">{str(c.get('at', '—'))[:16]}</td>
          </tr>"""
    return f"""
      <div class="section">
        <h2 class="section-title">Human Corrections — Audit Trail</h2>
        <table class="data-table">
          <thead><tr><th>Field</th><th>Original (AI)</th><th>Corrected</th>
            <th>By</th><th>When</th></tr></thead>
          <tbody>{rows}</tbody>
        </table>
      </div>"""


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
  .verdict-bar { color: #ffffff; padding: 9px 24px; font-size: 13px; font-weight: bold; }
  .section { padding: 16px 24px; border-bottom: 1px solid #e2e8f0; }
  .section-title { font-size: 13px; font-weight: bold; color: #1a2744;
     border-bottom: 2px solid #F7941D; padding-bottom: 4px; margin: 0 0 10px; }
  .muted { color: #94a3b8; font-weight: normal; }
  table { border-collapse: collapse; width: 100%; }
  .data-table th { background-color: #f1f5f9; text-align: left; padding: 6px 9px;
     font-size: 9.5px; color: #475569; border: 1px solid #e2e8f0; }
  .data-table td { padding: 6px 9px; border: 1px solid #eef2f7; font-size: 10.5px; }
  .field-name { color: #475569; width: 38%; }
  .field-conf { width: 70px; text-align: center; }
  .group-header td { background-color: #eef4ff; font-weight: bold; color: #1d4ed8;
     font-size: 9.5px; padding: 5px 9px; }
  .badge { padding: 1px 7px; border-radius: 9px; font-size: 9.5px; font-weight: bold; }
  .badge-green { background-color: #dcfce7; color: #16a34a; }
  .badge-amber { background-color: #fef3c7; color: #d97706; }
  .badge-red { background-color: #fee2e2; color: #dc2626; }
  .badge-gray { background-color: #f1f5f9; color: #64748b; }
  .row-pass td { color: #166534; }
  .row-warn td { background-color: #fffbeb; color: #92400e; }
  .row-error td { background-color: #fff1f2; color: #991b1b; }
  code { font-family: Courier, monospace; background-color: #f1f5f9; font-size: 9.5px; }
  .bars td { padding: 3px 4px; font-size: 10px; vertical-align: middle; }
  .bar-label { width: 32%; color: #475569; }
  .bar-pct { width: 44px; text-align: right; font-weight: bold; }
  .bar { width: 100%; height: 11px; }
  .bar td { padding: 0; height: 11px; }
  .stat td { text-align: center; padding: 12px 6px; border: 1px solid #e2e8f0; }
  .stat .v { font-size: 22px; font-weight: bold; color: #1a2744; }
  .stat .l { font-size: 9px; color: #64748b; }
  .summary { font-size: 11.5px; color: #334155; }
  .thumb { border: 1px solid #e2e8f0; padding: 4px; }
  .footer { padding: 12px 24px; text-align: center; font-size: 9px; color: #94a3b8; }
"""


def generate_report(drawing_meta, extracted, rule_results, verdict, elapsed,
                    erp_payload, corrections=None, thumbnail_uri=None,
                    approved=True, summary_override=None,
                    approved_by=None, approved_at=None):
    conf = extracted.get("confidence", {}) or {}
    vcolor, vtag, vtext = _verdict_style(verdict)
    generated_at = datetime.datetime.now().strftime("%d %b %Y, %H:%M")

    field_count = sum(1 for k, v in extracted.items()
                      if k != "confidence" and v not in (None, [], "", False))
    conf_values = [v for v in conf.values() if v is not None]
    avg_conf = sum(conf_values) / len(conf_values) if conf_values else 0.0
    passed_rules = sum(1 for r in rule_results if r.passed)
    total_rules = len(rule_results)
    error_count = sum(1 for r in rule_results if not r.passed and r.severity == "ERROR")
    warn_count = sum(1 for r in rule_results if not r.passed and r.severity == "WARNING")
    score, score_label, score_color = quality_score(extracted, rule_results)

    file_name = drawing_meta.get("file_name", "—")
    drawing_id = drawing_meta.get("drawing_id", "—")
    floor_cat = drawing_meta.get("floor_category", "—")

    # plain-language exec summary
    summary = (
        f"This {floor_cat.lower() if floor_cat else ''} drawing "
        f"(<strong>{extracted.get('drawing_number') or 'no number'}</strong>"
        f"{', ' + extracted.get('drawing_title') if extracted.get('drawing_title') else ''}) "
        f"for project <strong>{extracted.get('project_name') or '—'}</strong> yielded "
        f"<strong>{field_count}</strong> populated fields at <strong>{avg_conf:.0%}</strong> "
        f"average confidence. {passed_rules} of {total_rules} validation rules passed "
        f"({error_count} error(s), {warn_count} warning(s)). Overall extraction quality is "
        f"rated <strong style=\"color:{score_color}\">{score_label} ({score}/100)</strong>."
    )

    # A user-approved summary overrides the auto-generated one (escaped, newlines kept).
    if summary_override:
        summary = escape(str(summary_override)).replace("\n", "<br>")

    # Draft / approval banners — communicate verification state at the top of the report.
    draft_banner = ""
    if not approved:
        draft_banner = (
            '<div style="background-color:#fef3c7;color:#92400e;padding:9px 24px;'
            'font-size:12px;font-weight:bold;border-bottom:2px solid #f59e0b;">'
            '&#9208; DRAFT — AWAITING HUMAN VERIFICATION &amp; APPROVAL '
            '(not yet pushed to ERP)</div>'
        )
    approval_line = ""
    if approved and approved_by:
        when = str(approved_at or "")[:16].replace("T", " ")
        approval_line = (
            '<div style="background-color:#dcfce7;color:#166534;padding:9px 24px;'
            'font-size:12px;font-weight:bold;border-bottom:2px solid #16a34a;">'
            f'&#10003; Verified &amp; approved by {escape(str(approved_by))}'
            f'{(" on " + when) if when else ""}</div>'
        )
    erp_title = ("ERP Payload — RealSoft (simulation)" if approved
                 else "ERP Payload — RealSoft (preview — not yet pushed)")

    # field group rows
    field_sections_html = ""
    for group_name, fields in FIELD_GROUPS.items():
        rows, has = "", False
        for key in fields:
            val = extracted.get(key)
            if val in (None, "", []):
                continue
            has = True
            rows += f"""<tr><td class="field-name">{FIELD_LABELS.get(key, key)}</td>
              <td>{_display_val(val)}</td>
              <td class="field-conf">{_conf_badge(conf.get(key))}</td></tr>"""
        if has:
            field_sections_html += (f'<tr class="group-header"><td colspan="3">{group_name}</td></tr>{rows}')

    # room schedule
    room_schedule = extracted.get("room_schedule") or []
    room_html = ""
    if room_schedule:
        rr = "".join(f'<tr><td>{name}</td><td>{area}</td></tr>'
                     for name, area in (_room_row(r) for r in room_schedule))
        room_html = f"""<div class="section"><h2 class="section-title">Room Schedule</h2>
          <table class="data-table"><thead><tr><th>Room</th><th>Area</th></tr></thead>
          <tbody>{rr}</tbody></table></div>"""

    # validation rows
    val_rows = ""
    for r in rule_results:
        if r.passed:
            tag, cls = "PASS", "row-pass"
        elif r.severity == "ERROR":
            tag, cls = "ERROR", "row-error"
        else:
            tag, cls = "WARN", "row-warn"
        val_rows += f"""<tr class="{cls}"><td><code>{r.rule_id}</code></td>
          <td>{r.field_name}</td><td>{r.message}</td><td>{tag}</td></tr>"""

    # erp payload (+ low-confidence flags)
    erp_rows, erp_note = "", ""
    if erp_payload:
        data_block = erp_payload.get("data", erp_payload)
        low_conf_fields = (erp_payload.get("metadata", {}) or {}).get("low_confidence_fields", [])
        for k, v in data_block.items():
            flag = ' <span class="badge badge-amber">review</span>' if k in low_conf_fields else ""
            erp_rows += f"<tr><td>{k}</td><td>{_display_val(v)}{flag}</td></tr>"
        if low_conf_fields:
            erp_note = (f'<p class="muted" style="margin-bottom:8px;">'
                        f'{len(low_conf_fields)} field(s) flagged low-confidence for ERP review: '
                        f'{", ".join(low_conf_fields)}.</p>')

    thumb_html = ""
    if thumbnail_uri:
        thumb_html = f"""<div class="section"><h2 class="section-title">Source Drawing</h2>
          <img class="thumb" src="{thumbnail_uri}" style="max-width:100%;" /></div>"""

    html = f"""<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>ERP RealSoft — Drawing Extraction Report #{drawing_id}</title>
<style>{_BASE_CSS}</style></head><body><div class="page">

  <div class="header">
    <table><tr>
      <td><div class="brand">ERP <span>RealSoft</span></div>
          <div class="report-label">Drawing Extraction Report</div></td>
      <td style="text-align:right;" class="header-meta">
        Generated {generated_at}<br>Drawing #{drawing_id} &nbsp;|&nbsp; {file_name}</td>
    </tr></table>
  </div>

  <div class="verdict-bar" style="background-color:{vcolor};">[{vtag}] EXTRACTION {vtext}
    &nbsp;|&nbsp; {elapsed}s</div>

  {draft_banner}{approval_line}

  <!-- Exec summary + quality score -->
  <div class="section">
    <h2 class="section-title">Executive Summary</h2>
    <table><tr>
      <td style="width:74%;vertical-align:top;"><p class="summary">{summary}</p></td>
      <td style="width:26%;text-align:center;vertical-align:middle;">
        <div style="font-size:40px;font-weight:bold;color:{score_color};">{score}</div>
        <div style="font-size:10px;color:#64748b;">QUALITY SCORE</div>
        <div style="font-size:11px;font-weight:bold;color:{score_color};">{score_label}</div>
      </td>
    </tr></table>
    <table style="margin-top:10px;"><tr class="stat">
      <td><div class="v">{field_count}</div><div class="l">FIELDS</div></td>
      <td><div class="v">{avg_conf:.0%}</div><div class="l">AVG CONFIDENCE</div></td>
      <td><div class="v">{passed_rules}/{total_rules}</div><div class="l">RULES PASSED</div></td>
      <td><div class="v" style="color:#dc2626;">{error_count}</div><div class="l">ERRORS</div></td>
      <td><div class="v" style="color:#d97706;">{warn_count}</div><div class="l">WARNINGS</div></td>
    </tr></table>
  </div>

  {thumb_html}

  <div class="section">
    <h2 class="section-title">Extracted Fields</h2>
    <table class="data-table"><thead><tr><th>Field</th><th>Value</th><th>Conf.</th></tr></thead>
      <tbody>{field_sections_html}</tbody></table>
  </div>

  {room_html}
  {_confidence_chart_html(extracted)}

  <div class="section">
    <h2 class="section-title">Validation Results</h2>
    <table class="data-table"><thead><tr><th style="width:70px">Rule</th>
      <th style="width:130px">Field</th><th>Message</th><th style="width:64px">Status</th></tr></thead>
      <tbody>{val_rows}</tbody></table>
  </div>

  {_corrections_html(corrections)}

  <div class="section">
    <h2 class="section-title">{erp_title}</h2>
    {erp_note}
    <table class="data-table"><thead><tr><th>ERP Field</th><th>Value</th></tr></thead>
      <tbody>{erp_rows}</tbody></table>
  </div>

  <div class="footer">Generated by ERP RealSoft AI &nbsp;|&nbsp; Coral Business Solutions
    &nbsp;|&nbsp; {generated_at}</div>
</div></body></html>"""
    return html


def generate_project_report(drawings: list) -> str:
    """Project-level aggregate across all processed drawings (POC milestone M5)."""
    generated_at = datetime.datetime.now().strftime("%d %b %Y, %H:%M")
    total = len(drawings)
    done = sum(1 for d in drawings if d.get("status") == "done")
    errors = sum(1 for d in drawings if d.get("status") == "error")
    confs = [d["avg_conf"] for d in drawings if d.get("avg_conf") is not None]
    avg_conf = sum(confs) / len(confs) if confs else 0.0

    # group by project
    by_project = {}
    for d in drawings:
        by_project.setdefault(d.get("project_name") or "Unassigned", []).append(d)

    proj_html = ""
    for pname, items in by_project.items():
        rows = ""
        for d in items:
            badge = _conf_badge(d.get("avg_conf"))
            status = d.get("status", "—")
            scolor = {"done": "#16a34a", "error": "#dc2626"}.get(status, "#64748b")
            rows += f"""<tr>
              <td>#{d.get('id')}</td>
              <td>{d.get('drawing_number') or '—'}</td>
              <td>{d.get('drawing_title') or '—'}</td>
              <td>{d.get('floor_category') or '—'}</td>
              <td style="color:{scolor};font-weight:bold;">{status}</td>
              <td style="text-align:center;">{badge}</td></tr>"""
        proj_html += f"""<div class="section">
          <h2 class="section-title">{pname} <span class="muted">({len(items)} drawing(s))</span></h2>
          <table class="data-table"><thead><tr><th>ID</th><th>Drawing No.</th><th>Title</th>
            <th>Floor</th><th>Status</th><th>Avg Conf.</th></tr></thead>
          <tbody>{rows}</tbody></table></div>"""

    html = f"""<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>ERP RealSoft — Project Summary Report</title><style>{_BASE_CSS}</style></head>
<body><div class="page">
  <div class="header">
    <table><tr>
      <td><div class="brand">ERP <span>RealSoft</span></div>
          <div class="report-label">Project Summary Report</div></td>
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
      <td><div class="v">{avg_conf:.0%}</div><div class="l">AVG CONFIDENCE</div></td>
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
