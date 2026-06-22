import json
import requests
import streamlit as st
import streamlit.components.v1 as components

API_URL = "http://127.0.0.1:8000"

st.set_page_config(
    page_title="Printo — Drawing Intelligence",
    page_icon="📐",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ── Custom CSS ────────────────────────────────────────────────────────────────
st.markdown("""
<style>
  /* Hide Streamlit chrome */
  #MainMenu, footer, header { visibility: hidden; }
  .block-container { padding-top: 1rem; padding-bottom: 1rem; }

  /* App header */
  .app-header {
    background: linear-gradient(135deg, #1a2744 0%, #1e3a5f 100%);
    color: #fff; padding: 18px 28px; border-radius: 10px;
    margin-bottom: 20px; display: flex; align-items: center;
    justify-content: space-between;
  }
  .app-header h1 { font-size: 26px; font-weight: 800; margin: 0;
                    letter-spacing: .5px; }
  .app-header h1 span { color: #60a5fa; }
  .app-header p { margin: 4px 0 0; font-size: 13px; color: #94a3b8; }
  .app-header .badge-demo {
    background: #2563eb; color: #fff; padding: 4px 12px;
    border-radius: 20px; font-size: 11px; font-weight: 700;
    letter-spacing: .5px;
  }

  /* Verdict banners */
  .verdict-pass { background:#dcfce7; border-left:4px solid #16a34a;
    color:#166534; padding:14px 18px; border-radius:6px;
    font-weight:700; font-size:15px; margin-bottom:12px; }
  .verdict-warn { background:#fef3c7; border-left:4px solid #d97706;
    color:#92400e; padding:14px 18px; border-radius:6px;
    font-weight:700; font-size:15px; margin-bottom:12px; }
  .verdict-fail { background:#fee2e2; border-left:4px solid #dc2626;
    color:#991b1b; padding:14px 18px; border-radius:6px;
    font-weight:700; font-size:15px; margin-bottom:12px; }

  /* Metric cards */
  .metric-row { display:flex; gap:12px; margin:12px 0; }
  .metric-card {
    flex:1; background:#fff; border:1px solid #e2e8f0;
    border-radius:8px; padding:14px 16px; text-align:center;
    box-shadow:0 1px 3px rgba(0,0,0,.06);
  }
  .metric-val { font-size:28px; font-weight:800; color:#1a2744; }
  .metric-label { font-size:11px; color:#64748b; margin-top:3px;
                  text-transform:uppercase; letter-spacing:.4px; }

  /* Event stream */
  .event-line {
    display:flex; align-items:flex-start; gap:8px;
    padding:5px 8px; border-radius:4px; font-size:12px;
    font-family: 'Courier New', monospace; margin-bottom:2px;
  }
  .event-success { background:#f0fdf4; color:#166534; }
  .event-error   { background:#fff1f2; color:#991b1b; }
  .event-warning { background:#fffbeb; color:#92400e; }
  .event-info    { background:#f8fafc; color:#334155; }
  .event-done    { background:#eff6ff; color:#1d4ed8; font-weight:700; }

  /* Field groups */
  .field-group-header {
    background:#eff6ff; color:#1d4ed8; font-size:11px;
    font-weight:700; text-transform:uppercase; letter-spacing:.5px;
    padding:6px 10px; border-radius:4px; margin:10px 0 4px;
  }
  .field-row {
    display:flex; align-items:center; padding:6px 4px;
    border-bottom:1px solid #f1f5f9; gap:8px;
  }
  .field-name { color:#374151; font-size:12px; font-weight:500; min-width:180px; }
  .field-val  { color:#111827; font-size:13px; flex:1; }

  /* Confidence badges */
  .conf-high  { background:#dcfce7; color:#16a34a; padding:2px 8px;
                border-radius:10px; font-size:11px; font-weight:600; }
  .conf-med   { background:#fef3c7; color:#d97706; padding:2px 8px;
                border-radius:10px; font-size:11px; font-weight:600; }
  .conf-low   { background:#fee2e2; color:#dc2626; padding:2px 8px;
                border-radius:10px; font-size:11px; font-weight:600; }
  .conf-na    { background:#f1f5f9; color:#64748b; padding:2px 8px;
                border-radius:10px; font-size:11px; }

  /* Rule rows */
  .rule-pass { color:#166534; font-size:12px; padding:5px 0;
               border-bottom:1px solid #f1f5f9; }
  .rule-warn { color:#92400e; background:#fffbeb; font-size:12px;
               padding:5px 6px; border-radius:4px; margin-bottom:3px; }
  .rule-fail { color:#991b1b; background:#fff1f2; font-size:12px;
               padding:5px 6px; border-radius:4px; margin-bottom:3px; }

  /* Upload zone */
  .upload-hint { font-size:12px; color:#64748b; margin-top:4px; }

  /* Section title */
  .sec-title {
    font-size:14px; font-weight:700; color:#1a2744;
    border-bottom:2px solid #2563eb; padding-bottom:4px;
    display:inline-block; margin-bottom:12px;
  }

  /* Status badge */
  .status-done { background:#dcfce7; color:#166534; padding:2px 8px;
    border-radius:10px; font-size:11px; font-weight:600; }
  .status-error { background:#fee2e2; color:#dc2626; padding:2px 8px;
    border-radius:10px; font-size:11px; font-weight:600; }
  .status-processing { background:#dbeafe; color:#1d4ed8; padding:2px 8px;
    border-radius:10px; font-size:11px; font-weight:600; }
  .status-other { background:#f1f5f9; color:#475569; padding:2px 8px;
    border-radius:10px; font-size:11px; }
</style>
""", unsafe_allow_html=True)

# ── Session state ─────────────────────────────────────────────────────────────
for key, default in [
    ("active_tab",  "Upload"),
    ("last_result", {}),
    ("last_drawing_id", None),
    ("edit_field",  None),
]:
    if key not in st.session_state:
        st.session_state[key] = default

# ── Header ────────────────────────────────────────────────────────────────────
st.markdown("""
<div class="app-header">
  <div>
    <h1>PRIN<span>TO</span> &nbsp; <small style="font-size:14px;font-weight:400;color:#94a3b8">
      AI Drawing Intelligence Platform</small></h1>
    <p>Upload construction drawings → AI extracts structured data → Validate → Push to RealSoft ERP</p>
  </div>
  <div class="badge-demo">DEMO v2.0</div>
</div>
""", unsafe_allow_html=True)

# ── Sidebar ───────────────────────────────────────────────────────────────────
with st.sidebar:
    st.markdown("### ⚙️ Printo Dashboard")
    try:
        health = requests.get(f"{API_URL}/health", timeout=3).json()
        st.success(f"Server: Online (v{health.get('version','—')})")
        erp_mode = health.get("erp_mode", "simulation")
        if erp_mode == "live":
            st.success("RealSoft ERP: Live")
        else:
            st.info("RealSoft ERP: Simulation Mode")
        col1, col2 = st.columns(2)
        col1.metric("Total", health.get("total_drawings", 0))
        col2.metric("Done",  health.get("completed", 0))
    except Exception:
        st.error("Backend offline\n`uvicorn backend.main:app --reload --port 8000`")

    st.divider()
    strict = st.toggle("Strict Mode", value=False,
                       help="Treat warnings as errors")
    st.divider()

    # Tab nav
    st.markdown("**Navigation**")
    for tab in ["Upload", "Results", "Report", "History"]:
        icon = {"Upload": "📤", "Results": "📊", "Report": "📄", "History": "🗂️"}[tab]
        if st.button(f"{icon} {tab}", use_container_width=True,
                     type="primary" if st.session_state.active_tab == tab else "secondary"):
            st.session_state.active_tab = tab
            st.rerun()

# ── Helpers ───────────────────────────────────────────────────────────────────
FLOOR_CATEGORIES = [
    "Ground Floor", "First Floor", "Second Floor", "Third Floor",
    "Fourth Floor", "Basement", "Terrace / Roof", "Kitchen", "Other"
]

FIELD_GROUPS = {
    "📋 Title Block": [
        ("drawing_number",  "Drawing Number"),
        ("drawing_title",   "Drawing Title"),
        ("project_name",    "Project Name"),
        ("project_location","Project Location"),
        ("client_name",     "Client Name"),
        ("contractor_name", "Contractor"),
        ("date_of_issue",   "Date of Issue"),
        ("revision_number", "Revision"),
        ("sheet_number",    "Sheet No."),
        ("total_sheets",    "Total Sheets"),
        ("scale",           "Scale"),
    ],
    "🏠 Floor Plan Info": [
        ("floor_level",     "Floor Level"),
        ("total_floor_area","Floor Area"),
        ("building_type",   "Building Type"),
        ("number_of_rooms", "No. of Rooms"),
        ("door_count",      "Door Count"),
        ("window_count",    "Window Count"),
        ("dimensions",      "Overall Dimensions"),
    ],
    "👷 Participants": [
        ("drawn_by",        "Drawn By"),
        ("checked_by",      "Checked By"),
        ("approved_by",     "Approved By"),
    ],
    "🔧 Technical": [
        ("structural_notes","Structural Notes"),
        ("materials",       "Materials"),
        ("approval_stamp",  "Approval Stamp"),
        ("north_arrow",     "North Arrow"),
        ("grid_lines",      "Grid Lines"),
        ("additional_notes","Additional Notes"),
    ],
}

def _conf_html(c):
    if c is None:
        return '<span class="conf-na">N/A</span>'
    if c >= 0.85:
        return f'<span class="conf-high">{c:.0%}</span>'
    if c >= 0.60:
        return f'<span class="conf-med">{c:.0%}</span>'
    return f'<span class="conf-low">{c:.0%}</span>'

def _fmt_val(val):
    if val is None:
        return "—"
    if isinstance(val, bool):
        return "✅ Yes" if val else "✗ No"
    if isinstance(val, list):
        return ", ".join(str(x) for x in val) if val else "—"
    return str(val)


# ════════════════════════════════════════════════════════════════════════════
# TAB: UPLOAD
# ════════════════════════════════════════════════════════════════════════════
if st.session_state.active_tab == "Upload":
    col_up, col_hint = st.columns([2, 1])

    with col_up:
        st.markdown('<div class="sec-title">Upload Construction Drawing</div>',
                    unsafe_allow_html=True)
        floor_cat = st.selectbox("Floor / Category", FLOOR_CATEGORIES)
        uploaded  = st.file_uploader(
            "Select drawing (PDF / JPG / PNG / TIFF)",
            type=["pdf", "jpg", "jpeg", "png", "tiff"],
        )
        st.markdown('<div class="upload-hint">Max 20 MB &nbsp;|&nbsp; '
                    'Architectural floor plans, section drawings, elevations</div>',
                    unsafe_allow_html=True)

        go = st.button("🚀  Process Drawing", type="primary",
                       use_container_width=True, disabled=uploaded is None)

    with col_hint:
        st.markdown("""
        **What Printo extracts:**
        - Drawing number, title, scale
        - Project name, client, contractor
        - Floor level, area, room schedule
        - Dimensions, materials, stamps
        - 18 ClearSoft validation rules
        - Summary report + Excel export
        """)

    if uploaded and go:
        st.markdown("---")
        st.markdown("#### ⚙️ Processing Pipeline")
        stream_placeholder = st.empty()
        progress_bar = st.progress(0, text="Starting…")
        stream_lines = []
        progress = 0

        final_data = {}
        try:
            with requests.post(
                f"{API_URL}/upload",
                files={"file": (uploaded.name, uploaded.getvalue(), uploaded.type)},
                data={"floor_category": floor_cat, "strict": str(strict).lower()},
                stream=True,
                timeout=90,
            ) as resp:
                for raw_line in resp.iter_lines():
                    if not raw_line:
                        continue
                    line = raw_line.decode("utf-8")
                    if not line.startswith("data:"):
                        continue
                    payload = json.loads(line[5:].strip())

                    if payload.get("type") == "done":
                        final_data = payload
                        progress_bar.progress(100, text="Complete")
                        break

                    etype = payload.get("type", "info")
                    text  = payload.get("line", "")
                    stream_lines.append((text, etype))

                    # Build colored HTML stream
                    html_lines = "".join(
                        f'<div class="event-line event-{t}">{l}</div>'
                        for l, t in stream_lines
                    )
                    stream_placeholder.markdown(
                        f'<div style="max-height:360px;overflow-y:auto;background:#f8fafc;'
                        f'border:1px solid #e2e8f0;border-radius:8px;padding:10px">'
                        f'{html_lines}</div>',
                        unsafe_allow_html=True,
                    )

                    # Advance progress
                    if "R01" in text or "R02" in text or "R03" in text:
                        progress = min(progress + 5, 15)
                    elif "Pre-pass" in text:
                        progress = min(progress + 5, 20)
                    elif "Claude" in text or "AI Processing" in text:
                        progress = min(progress + 15, 70)
                    elif "Extraction Complete" in text:
                        progress = min(progress + 5, 75)
                    elif "Rules" in text or "R0" in text or "R1" in text:
                        progress = min(progress + 3, 88)
                    elif "ERP" in text or "RealSoft" in text:
                        progress = min(progress + 5, 95)
                    elif "Report" in text:
                        progress = min(progress + 2, 98)
                    progress_bar.progress(progress, text=text.strip()[:80])

        except Exception as e:
            st.error(f"Connection error: {e}")

        if final_data:
            st.session_state.last_result    = final_data
            st.session_state.last_drawing_id = final_data.get("drawing_id")
            st.session_state.active_tab     = "Results"
            st.rerun()


# ════════════════════════════════════════════════════════════════════════════
# TAB: RESULTS
# ════════════════════════════════════════════════════════════════════════════
elif st.session_state.active_tab == "Results":
    result = st.session_state.get("last_result", {})
    drawing_id = st.session_state.get("last_drawing_id")

    if not result:
        st.info("No drawing processed yet. Go to **Upload** tab to process a drawing.")
        st.stop()

    verdict   = result.get("verdict", "—")
    extracted = result.get("extracted", {})
    errors    = result.get("errors", [])
    warnings  = result.get("warnings", [])
    elapsed   = result.get("elapsed", 0)
    erp_status = result.get("erp_status", "—")
    prepass_count = result.get("prepass_count", 0)
    conf = extracted.get("confidence", {})

    # Verdict banner
    if verdict == "PASSED":
        st.markdown(f'<div class="verdict-pass">✅ &nbsp; EXTRACTION COMPLETE — ALL RULES PASSED &nbsp;|&nbsp; '
                    f'{elapsed}s &nbsp;|&nbsp; ERP: {erp_status.upper()}</div>',
                    unsafe_allow_html=True)
    elif verdict == "WARNING":
        st.markdown(f'<div class="verdict-warn">⚠️ &nbsp; EXTRACTION COMPLETE — {len(warnings)} WARNING(S) &nbsp;|&nbsp; '
                    f'{elapsed}s &nbsp;|&nbsp; ERP: {erp_status.upper()}</div>',
                    unsafe_allow_html=True)
    else:
        st.markdown(f'<div class="verdict-fail">❌ &nbsp; VALIDATION FAILED — {len(errors)} ERROR(S) &nbsp;|&nbsp; '
                    f'{elapsed}s</div>', unsafe_allow_html=True)

    # Metrics
    field_count = sum(1 for k, v in extracted.items()
                      if k != "confidence" and v not in (None, [], ""))
    conf_vals = [v for v in conf.values() if v is not None]
    avg_conf = sum(conf_vals) / len(conf_vals) if conf_vals else 0.0
    prepass_note = f" ({prepass_count} from PDF text layer)" if prepass_count else ""
    st.markdown(f"""
    <div class="metric-row">
      <div class="metric-card">
        <div class="metric-val">{field_count}</div>
        <div class="metric-label">Fields Extracted{prepass_note}</div>
      </div>
      <div class="metric-card">
        <div class="metric-val">{avg_conf:.0%}</div>
        <div class="metric-label">Avg Confidence</div>
      </div>
      <div class="metric-card">
        <div class="metric-val" style="color:{'#16a34a' if verdict=='PASSED' else '#dc2626'}">{verdict}</div>
        <div class="metric-label">Verdict</div>
      </div>
      <div class="metric-card">
        <div class="metric-val">{len(errors)}</div>
        <div class="metric-label">Errors</div>
      </div>
      <div class="metric-card">
        <div class="metric-val">{len(warnings)}</div>
        <div class="metric-label">Warnings</div>
      </div>
    </div>
    """, unsafe_allow_html=True)

    col_left, col_right = st.columns([3, 2])

    # ── Left: Extracted Fields ────────────────────────────────────────────
    with col_left:
        st.markdown('<div class="sec-title">Extracted Data</div>', unsafe_allow_html=True)

        for group_label, fields in FIELD_GROUPS.items():
            group_html = ""
            for key, label in fields:
                val = extracted.get(key)
                if val is None or val == [] or val == "":
                    continue
                display = _fmt_val(val)
                badge   = _conf_html(conf.get(key))
                group_html += (
                    f'<div class="field-row">'
                    f'<span class="field-name">{label}</span>'
                    f'<span class="field-val">{display}</span>'
                    f'{badge}</div>'
                )

            if group_html:
                st.markdown(
                    f'<div class="field-group-header">{group_label}</div>'
                    f'{group_html}',
                    unsafe_allow_html=True,
                )

        # Room schedule
        room_schedule = extracted.get("room_schedule") or []
        if room_schedule:
            st.markdown('<div class="field-group-header">🛋️ Room Schedule</div>',
                        unsafe_allow_html=True)
            st.table([{"Room": r.get("name", "—"), "Area": r.get("area", "—")}
                      for r in room_schedule])

        # Human correction
        st.markdown("---")
        st.markdown("**✏️ Correct a field** (human verification)")
        all_keys = [k for k in extracted if k != "confidence"]
        field_to_edit = st.selectbox("Select field to correct", all_keys,
                                     key="correction_field")
        current_val = _fmt_val(extracted.get(field_to_edit))
        new_val = st.text_input("Corrected value", value=current_val,
                                key="correction_val")
        if st.button("💾 Save Correction", type="secondary"):
            if drawing_id:
                try:
                    requests.patch(
                        f"{API_URL}/drawings/{drawing_id}/correction",
                        json={"field_name": field_to_edit,
                              "corrected_value": new_val,
                              "corrected_by": "demo_user"},
                        timeout=5,
                    )
                    st.success(f"Correction saved for '{field_to_edit}'")
                except Exception as e:
                    st.error(f"Save failed: {e}")

    # ── Right: Validation Results ─────────────────────────────────────────
    with col_right:
        st.markdown('<div class="sec-title">Validation Results</div>',
                    unsafe_allow_html=True)

        if errors:
            for e in errors:
                st.markdown(f'<div class="rule-fail">❌ {e}</div>',
                            unsafe_allow_html=True)
        if warnings:
            for w in warnings:
                st.markdown(f'<div class="rule-warn">⚠️ {w}</div>',
                            unsafe_allow_html=True)
        if not errors and not warnings:
            st.markdown('<div class="rule-pass">✅ All validation rules passed</div>',
                        unsafe_allow_html=True)

        # ERP payload
        erp_payload = result.get("realsoft_payload", {})
        if erp_payload:
            with st.expander("📦 ERP Payload (RealSoft format)"):
                st.json(erp_payload)

    # ── Export buttons ────────────────────────────────────────────────────
    st.divider()
    ec1, ec2, ec3 = st.columns(3)
    if drawing_id:
        ec1.link_button("📄 View Full Report",
                        f"{API_URL}/report/{drawing_id}",
                        use_container_width=True)
        try:
            excel_bytes = requests.get(
                f"{API_URL}/export/{drawing_id}/excel", timeout=10
            ).content
            ec2.download_button(
                "📊 Download Excel",
                data=excel_bytes,
                file_name=f"printo_drawing_{drawing_id}.xlsx",
                mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                use_container_width=True,
            )
        except Exception:
            ec2.button("📊 Excel (unavailable)", disabled=True,
                       use_container_width=True)
        if ec3.button("➡️ View Report Tab", use_container_width=True):
            st.session_state.active_tab = "Report"
            st.rerun()


# ════════════════════════════════════════════════════════════════════════════
# TAB: REPORT
# ════════════════════════════════════════════════════════════════════════════
elif st.session_state.active_tab == "Report":
    drawing_id = st.session_state.get("last_drawing_id")

    if not drawing_id:
        st.info("Process a drawing first to view its report.")
        st.stop()

    rc1, rc2 = st.columns([1, 5])
    with rc1:
        if st.button("⬅️ Back to Results"):
            st.session_state.active_tab = "Results"
            st.rerun()
    with rc2:
        st.link_button("🔗 Open Report in New Tab",
                       f"{API_URL}/report/{drawing_id}")

    try:
        html_report = requests.get(f"{API_URL}/report/{drawing_id}", timeout=10).text
        components.html(html_report, height=820, scrolling=True)
    except Exception as e:
        st.error(f"Could not load report: {e}")


# ════════════════════════════════════════════════════════════════════════════
# TAB: HISTORY
# ════════════════════════════════════════════════════════════════════════════
elif st.session_state.active_tab == "History":
    st.markdown('<div class="sec-title">Processing History</div>',
                unsafe_allow_html=True)

    if st.button("🔄 Refresh"):
        st.rerun()

    try:
        drawings = requests.get(f"{API_URL}/drawings", timeout=5).json()
    except Exception:
        st.error("Backend not reachable.")
        st.stop()

    if not drawings:
        st.info("No drawings processed yet.")
        st.stop()

    for d in drawings:
        status = d.get("status", "—")
        if status == "done":
            badge = '<span class="status-done">✅ Done</span>'
        elif status == "error":
            badge = '<span class="status-error">❌ Error</span>'
        elif status == "processing":
            badge = '<span class="status-processing">⏳ Processing</span>'
        else:
            badge = f'<span class="status-other">{status}</span>'

        with st.expander(
            f"#{d['id']}  |  {d.get('file_name','—')}  |  "
            f"{d.get('floor_category','—')}  |  {d.get('uploaded_at','—')[:16]}"
        ):
            col1, col2 = st.columns(2)
            col1.markdown(f"""
            **Status:** {badge}
            **Drawing No.:** {d.get('drawing_number') or '—'}
            **Title:** {d.get('drawing_title') or '—'}
            **Project:** {d.get('project_name') or '—'}
            """, unsafe_allow_html=True)
            col2.markdown(f"""
            **Floor:** {d.get('floor_category') or '—'}
            **Uploaded:** {d.get('uploaded_at', '—')[:16]}
            """, unsafe_allow_html=True)

            hc1, hc2 = st.columns(2)
            if hc1.button("📊 View Results", key=f"res_{d['id']}"):
                # Load from API
                try:
                    detail = requests.get(f"{API_URL}/drawings/{d['id']}", timeout=5).json()
                    extr = {e["field"]: e["value"] for e in detail.get("extractions", [])}
                    conf_map = {e["field"]: e["confidence"]
                                for e in detail.get("extractions", [])
                                if e["confidence"] is not None}
                    extr["confidence"] = conf_map
                    st.session_state.last_result    = {"extracted": extr, "errors": [],
                                                        "warnings": [], "verdict": status,
                                                        "elapsed": 0, "erp_status": "—"}
                    st.session_state.last_drawing_id = d["id"]
                    st.session_state.active_tab     = "Results"
                    st.rerun()
                except Exception as e:
                    st.error(str(e))
            hc2.link_button("📄 Report", f"{API_URL}/report/{d['id']}",
                             use_container_width=True)
