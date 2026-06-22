"""
Generates a professional printable HTML summary report for a processed drawing.
"""

import datetime


def _conf_badge(conf: float | None) -> str:
    if conf is None:
        return '<span class="badge badge-gray">N/A</span>'
    if conf >= 0.85:
        return f'<span class="badge badge-green">{conf:.0%}</span>'
    if conf >= 0.60:
        return f'<span class="badge badge-amber">{conf:.0%}</span>'
    return f'<span class="badge badge-red">{conf:.0%}</span>'


def _verdict_style(verdict: str) -> tuple[str, str, str]:
    if verdict == "PASSED":
        return "#16a34a", "✅", "ALL RULES PASSED"
    if verdict == "WARNING":
        return "#d97706", "⚠️", "PASSED WITH WARNINGS"
    return "#dc2626", "❌", "VALIDATION FAILED"


FIELD_LABELS = {
    "drawing_number":   "Drawing Number",
    "drawing_title":    "Drawing Title",
    "project_name":     "Project Name",
    "project_location": "Project Location",
    "client_name":      "Client Name",
    "contractor_name":  "Contractor / Consultant",
    "drawn_by":         "Drawn By",
    "checked_by":       "Checked By",
    "approved_by":      "Approved By",
    "date_of_issue":    "Date of Issue",
    "revision_number":  "Revision Number",
    "sheet_number":     "Sheet Number",
    "total_sheets":     "Total Sheets",
    "scale":            "Scale",
    "floor_level":      "Floor Level",
    "total_floor_area": "Total Floor Area",
    "building_type":    "Building Type",
    "number_of_rooms":  "Number of Rooms",
    "door_count":       "Door Count",
    "window_count":     "Window Count",
    "structural_notes": "Structural Notes",
    "materials":        "Materials",
    "dimensions":       "Overall Dimensions",
    "approval_stamp":   "Approval Stamp",
    "north_arrow":      "North Arrow",
    "grid_lines":       "Grid Lines",
    "additional_notes": "Additional Notes",
}

FIELD_GROUPS = {
    "Title Block": ["drawing_number", "drawing_title", "project_name", "project_location",
                    "client_name", "contractor_name", "date_of_issue", "revision_number",
                    "sheet_number", "total_sheets", "scale"],
    "Floor Plan Info": ["floor_level", "total_floor_area", "building_type", "number_of_rooms",
                        "door_count", "window_count", "dimensions"],
    "Participants": ["drawn_by", "checked_by", "approved_by"],
    "Technical": ["structural_notes", "materials", "approval_stamp", "north_arrow",
                  "grid_lines", "additional_notes"],
}


def generate_report(
    drawing_meta: dict,
    extracted: dict,
    rule_results: list,
    verdict: str,
    elapsed: float,
    erp_payload: dict,
) -> str:
    conf = extracted.get("confidence", {})
    verdict_color, verdict_icon, verdict_text = _verdict_style(verdict)
    generated_at = datetime.datetime.now().strftime("%d %b %Y, %H:%M")

    field_count = sum(
        1 for k, v in extracted.items()
        if k not in ("confidence",) and v not in (None, [], "", False)
    )
    conf_values = [v for v in conf.values() if v is not None]
    avg_conf = sum(conf_values) / len(conf_values) if conf_values else 0.0
    passed_rules = sum(1 for r in rule_results if r.passed)
    total_rules = len(rule_results)
    error_count = sum(1 for r in rule_results if not r.passed and r.severity == "ERROR")
    warn_count = sum(1 for r in rule_results if not r.passed and r.severity == "WARNING")

    floor_cat = drawing_meta.get("floor_category", "—")
    file_name = drawing_meta.get("file_name", "—")
    drawing_id = drawing_meta.get("drawing_id", "—")

    # ── Field group rows ──────────────────────────────────────────────────────
    field_sections_html = ""
    for group_name, fields in FIELD_GROUPS.items():
        rows = ""
        has_data = False
        for key in fields:
            val = extracted.get(key)
            if val is None:
                continue
            has_data = True
            label = FIELD_LABELS.get(key, key)
            if isinstance(val, list):
                display = ", ".join(str(x) for x in val) if val else "—"
            elif isinstance(val, bool):
                display = "✅ Yes" if val else "—"
            else:
                display = str(val)
            badge = _conf_badge(conf.get(key))
            rows += f"""
            <tr>
              <td class="field-name">{label}</td>
              <td class="field-value">{display}</td>
              <td class="field-conf">{badge}</td>
            </tr>"""
        if has_data:
            field_sections_html += f"""
          <tr class="group-header"><td colspan="3">{group_name}</td></tr>
          {rows}"""

    # ── Room schedule ─────────────────────────────────────────────────────────
    room_schedule = extracted.get("room_schedule") or []
    room_table_html = ""
    if room_schedule:
        room_rows = "".join(
            f'<tr><td>{r.get("name","—")}</td><td>{r.get("area","—")}</td></tr>'
            for r in room_schedule
        )
        room_table_html = f"""
      <div class="section">
        <h2 class="section-title">Room Schedule</h2>
        <table class="data-table">
          <thead><tr><th>Room</th><th>Area</th></tr></thead>
          <tbody>{room_rows}</tbody>
        </table>
      </div>"""

    # ── Validation rows ───────────────────────────────────────────────────────
    val_rows = ""
    for r in rule_results:
        if r.passed:
            icon, cls = "✅", "row-pass"
        elif r.severity == "ERROR":
            icon, cls = "❌", "row-error"
        else:
            icon, cls = "⚠️", "row-warn"
        val_rows += f"""
          <tr class="{cls}">
            <td>{icon}</td>
            <td><code>{r.rule_id}</code></td>
            <td>{r.field_name}</td>
            <td>{r.message}</td>
            <td>{r.severity if not r.passed else "PASS"}</td>
          </tr>"""

    # ── ERP simulation ────────────────────────────────────────────────────────
    erp_rows = ""
    if erp_payload:
        data_block = erp_payload.get("data", erp_payload)
        for k, v in list(data_block.items())[:12]:
            erp_rows += f"<tr><td>{k}</td><td>{v}</td></tr>"

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Printo — Drawing Extraction Report</title>
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{ font-family: system-ui, -apple-system, sans-serif; font-size: 13px;
          color: #1e293b; background: #f8fafc; }}
  .page {{ max-width: 960px; margin: 0 auto; background: #fff;
           box-shadow: 0 1px 8px rgba(0,0,0,.12); }}

  /* Header */
  .header {{ background: #1a2744; color: #fff; padding: 28px 36px 20px; }}
  .header-top {{ display: flex; justify-content: space-between; align-items: flex-start; }}
  .brand {{ font-size: 22px; font-weight: 700; letter-spacing: .5px; }}
  .brand span {{ color: #60a5fa; }}
  .report-label {{ font-size: 11px; color: #94a3b8; margin-top: 2px; }}
  .header-meta {{ font-size: 11px; color: #94a3b8; text-align: right; }}
  .header-meta strong {{ color: #e2e8f0; display: block; font-size: 13px; }}
  .meta-row {{ display: flex; gap: 32px; margin-top: 16px; flex-wrap: wrap; }}
  .meta-item {{ font-size: 12px; color: #94a3b8; }}
  .meta-item strong {{ color: #fff; display: block; font-size: 13px; margin-bottom: 2px; }}

  /* Verdict */
  .verdict-bar {{ background: {verdict_color}; color: #fff;
                  padding: 14px 36px; display: flex; align-items: center;
                  gap: 12px; font-size: 15px; font-weight: 700; }}
  .stats-row {{ display: flex; gap: 0; border-bottom: 1px solid #e2e8f0; }}
  .stat-box {{ flex: 1; padding: 16px 20px; border-right: 1px solid #e2e8f0;
               text-align: center; }}
  .stat-box:last-child {{ border-right: none; }}
  .stat-val {{ font-size: 26px; font-weight: 700; color: #1a2744; }}
  .stat-label {{ font-size: 11px; color: #64748b; margin-top: 2px; }}

  /* Sections */
  .section {{ padding: 24px 36px; border-bottom: 1px solid #e2e8f0; }}
  .section:last-child {{ border-bottom: none; }}
  .section-title {{ font-size: 14px; font-weight: 700; color: #1a2744;
                    margin-bottom: 14px; padding-bottom: 6px;
                    border-bottom: 2px solid #2563eb; display: inline-block; }}

  /* Tables */
  .data-table {{ width: 100%; border-collapse: collapse; }}
  .data-table th {{ background: #f1f5f9; text-align: left; padding: 8px 10px;
                    font-size: 11px; font-weight: 600; color: #475569;
                    text-transform: uppercase; letter-spacing: .4px; }}
  .data-table td {{ padding: 7px 10px; border-bottom: 1px solid #f1f5f9; }}
  .data-table tr:last-child td {{ border-bottom: none; }}
  .field-name {{ font-weight: 500; color: #374151; width: 220px; }}
  .field-value {{ color: #111827; }}
  .field-conf {{ width: 80px; text-align: center; }}
  .group-header td {{ background: #eff6ff; font-weight: 700; font-size: 11px;
                       color: #1d4ed8; text-transform: uppercase; letter-spacing: .5px;
                       padding: 6px 10px; }}

  /* Badges */
  .badge {{ display: inline-block; padding: 2px 8px; border-radius: 10px;
            font-size: 11px; font-weight: 600; }}
  .badge-green {{ background: #dcfce7; color: #16a34a; }}
  .badge-amber {{ background: #fef3c7; color: #d97706; }}
  .badge-red   {{ background: #fee2e2; color: #dc2626; }}
  .badge-gray  {{ background: #f1f5f9; color: #64748b; }}

  /* Validation rows */
  .row-pass td {{ color: #166534; }}
  .row-warn td {{ color: #92400e; background: #fffbeb; }}
  .row-error td {{ color: #991b1b; background: #fff1f2; }}
  .row-pass td, .row-warn td, .row-error td {{ padding: 7px 10px;
    border-bottom: 1px solid #f1f5f9; }}
  code {{ background: #f1f5f9; padding: 1px 5px; border-radius: 3px;
          font-size: 11px; font-family: monospace; }}

  /* Footer */
  .footer {{ background: #f8fafc; padding: 16px 36px; text-align: center;
             font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; }}

  @media print {{
    body {{ background: #fff; }}
    .page {{ box-shadow: none; }}
    .no-print {{ display: none; }}
  }}
</style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="header">
    <div class="header-top">
      <div>
        <div class="brand">PRIN<span>TO</span></div>
        <div class="report-label">Drawing Extraction Report</div>
      </div>
      <div class="header-meta">
        <strong>Generated {generated_at}</strong>
        Drawing ID: #{drawing_id} &nbsp;|&nbsp; File: {file_name}
      </div>
    </div>
    <div class="meta-row">
      <div class="meta-item">
        <strong>{extracted.get("project_name") or "—"}</strong>Project Name
      </div>
      <div class="meta-item">
        <strong>{extracted.get("drawing_number") or "—"}</strong>Drawing Number
      </div>
      <div class="meta-item">
        <strong>{floor_cat}</strong>Category
      </div>
      <div class="meta-item">
        <strong>{extracted.get("floor_level") or "—"}</strong>Floor Level
      </div>
      <div class="meta-item">
        <strong>{elapsed}s</strong>Processing Time
      </div>
    </div>
  </div>

  <!-- Verdict -->
  <div class="verdict-bar">
    {verdict_icon} &nbsp; EXTRACTION {verdict_text}
  </div>

  <!-- Stats -->
  <div class="stats-row">
    <div class="stat-box">
      <div class="stat-val">{field_count}</div>
      <div class="stat-label">Fields Extracted</div>
    </div>
    <div class="stat-box">
      <div class="stat-val">{avg_conf:.0%}</div>
      <div class="stat-label">Avg Confidence</div>
    </div>
    <div class="stat-box">
      <div class="stat-val">{passed_rules}/{total_rules}</div>
      <div class="stat-label">Rules Passed</div>
    </div>
    <div class="stat-box">
      <div class="stat-val" style="color:#dc2626">{error_count}</div>
      <div class="stat-label">Errors</div>
    </div>
    <div class="stat-box">
      <div class="stat-val" style="color:#d97706">{warn_count}</div>
      <div class="stat-label">Warnings</div>
    </div>
  </div>

  <!-- Extracted Fields -->
  <div class="section">
    <h2 class="section-title">Extracted Fields</h2>
    <table class="data-table">
      <thead>
        <tr>
          <th>Field</th>
          <th>Extracted Value</th>
          <th>Confidence</th>
        </tr>
      </thead>
      <tbody>{field_sections_html}</tbody>
    </table>
  </div>

  <!-- Room Schedule -->
  {room_table_html}

  <!-- Validation -->
  <div class="section">
    <h2 class="section-title">Validation Results</h2>
    <table class="data-table">
      <thead>
        <tr>
          <th style="width:32px"></th>
          <th style="width:80px">Rule</th>
          <th style="width:140px">Field</th>
          <th>Message</th>
          <th style="width:80px">Severity</th>
        </tr>
      </thead>
      <tbody>{val_rows}</tbody>
    </table>
  </div>

  <!-- ERP Simulation -->
  <div class="section">
    <h2 class="section-title">ERP Simulation — RealSoft Data</h2>
    <p style="font-size:12px;color:#64748b;margin-bottom:12px;">
      Data ready to push to RealSoft ERP via RealData Hub once credentials are configured.
    </p>
    <table class="data-table">
      <thead><tr><th>ERP Field</th><th>Value</th></tr></thead>
      <tbody>{erp_rows}</tbody>
    </table>
  </div>

  <!-- Footer -->
  <div class="footer">
    Generated by <strong>Printo AI</strong> &nbsp;|&nbsp;
    Powered by <strong>Claude Vision (Anthropic)</strong> &nbsp;|&nbsp;
    <strong>Coral Business Solutions</strong> &nbsp;|&nbsp;
    {generated_at}
  </div>

</div>
</body>
</html>"""

    return html
