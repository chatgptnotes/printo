import json
import re
import time
from pathlib import Path

import jwt
import requests
import streamlit as st
import streamlit.components.v1 as components

API_URL = "http://127.0.0.1:8000"
ROOT_DIR = Path(__file__).parent.parent
SAMPLE_DIR = ROOT_DIR / "test_drawings"

st.set_page_config(
    page_title="Printo — Drawing Intelligence",
    page_icon="📐",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ══════════════════════════════════════════════════════════════════════════════
# THEME — Pratyaya-inspired dark navy + orange
#   bg #070d1b · surface #0d1526 · border #1e2d4a · accent #F7941D
# ══════════════════════════════════════════════════════════════════════════════
st.markdown("""
<style>
  :root {
    --bg:#070d1b; --surface:#0d1526; --surface-2:#0a1020; --border:#1e2d4a;
    --text:#f1f5f9; --muted:#94a3b8; --dim:#64748b;
    --orange:#F7941D; --orange-light:#FDB46A; --blue:#60a5fa;
    --pass:#10b981; --warn:#f59e0b; --fail:#dc2626;
  }

  /* Hide Streamlit chrome */
  #MainMenu, footer, header { visibility: hidden; }
  .block-container { padding-top: 1.2rem; padding-bottom: 2rem; max-width: 1240px; }
  .stApp { background:
      radial-gradient(1200px 600px at 80% -10%, rgba(247,148,29,0.08), transparent 60%),
      radial-gradient(900px 500px at 0% 0%, rgba(96,165,250,0.06), transparent 55%),
      var(--bg); }

  /* ── Marquee keyframes (from Pratyaya globals.css) ── */
  @keyframes marquee { 0%{transform:translateX(0)} 100%{transform:translateX(-50%)} }
  .marquee-wrap { overflow:hidden; border-top:1px solid var(--border);
    border-bottom:1px solid var(--border); background:var(--surface-2);
    padding:12px 0; margin:20px 0 4px; border-radius:8px; }
  .marquee { display:flex; width:max-content; animation:marquee 32s linear infinite; }
  .marquee .tag { display:flex; align-items:center; white-space:nowrap;
    color:var(--dim); font-size:11px; font-weight:700; letter-spacing:.18em;
    text-transform:uppercase; padding:0 22px; }
  .marquee .tag .dot { margin-left:22px; color:rgba(247,148,29,.45); }

  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.35} }
  .pulse-dot { width:7px; height:7px; border-radius:50%; background:var(--orange);
    display:inline-block; animation:pulse 1.8s ease-in-out infinite; }

  /* ── Hero ── */
  .hero { position:relative; border:1px solid var(--border); border-radius:20px;
    background:
      radial-gradient(700px 380px at 88% 30%, rgba(247,148,29,0.12), transparent 60%),
      linear-gradient(135deg, #0b1326 0%, #0d1526 60%, #0a1020 100%);
    padding:38px 40px; overflow:hidden; box-shadow:0 20px 60px rgba(0,0,0,.35); }
  .hero-grid { display:flex; align-items:center; gap:24px; flex-wrap:wrap; }
  .hero-left { flex:1 1 420px; }
  .hero-right { flex:0 0 360px; display:flex; justify-content:center; }
  .badge { display:inline-flex; align-items:center; gap:8px;
    background:rgba(247,148,29,.10); border:1px solid rgba(247,148,29,.28);
    color:var(--orange); font-size:11px; font-weight:800; letter-spacing:.15em;
    text-transform:uppercase; padding:7px 14px; border-radius:999px; margin-bottom:18px; }
  .hero h1 { font-size:46px; line-height:1.04; font-weight:900; color:#fff;
    letter-spacing:-.02em; margin:0 0 14px; }
  .hero h1 .grad { background:linear-gradient(90deg,#F7941D,#FDB46A,#F7941D);
    -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; }
  .hero p.sub { color:var(--muted); font-size:15px; line-height:1.6; max-width:520px;
    margin:0 0 22px; }
  .hero-stats { display:flex; gap:28px; flex-wrap:wrap; }
  .hstat .v { font-size:26px; font-weight:900; color:#fff; }
  .hstat .v small { color:var(--orange); font-size:18px; }
  .hstat .l { font-size:11px; color:var(--dim); text-transform:uppercase;
    letter-spacing:.08em; margin-top:2px; }

  /* ── Section eyebrow + title ── */
  .eyebrow { color:var(--orange); font-size:11px; font-weight:800;
    letter-spacing:.2em; text-transform:uppercase; margin-bottom:6px; }
  .sec-title { font-size:18px; font-weight:800; color:#fff; margin-bottom:16px; }
  .sec-rule { display:inline-block; font-size:13px; font-weight:800; color:#fff;
    border-bottom:2px solid var(--orange); padding-bottom:5px; margin:6px 0 14px; }

  /* ── Cards ── */
  .card { background:var(--surface); border:1px solid var(--border);
    border-radius:14px; padding:18px 20px; }
  .step-card { background:var(--surface); border:1px solid var(--border);
    border-radius:14px; padding:20px; height:100%;
    transition:transform .18s ease, box-shadow .18s ease, border-color .18s ease; }
  .step-card:hover { transform:translateY(-3px); border-color:rgba(247,148,29,.45);
    box-shadow:0 12px 32px rgba(247,148,29,.15); }
  .step-num { width:38px; height:38px; border-radius:10px; display:flex;
    align-items:center; justify-content:center; font-weight:900; font-size:16px;
    color:#0b1326; background:linear-gradient(135deg,#F7941D,#FDB46A); margin-bottom:12px; }
  .step-card h4 { color:#fff; font-size:15px; font-weight:800; margin:0 0 6px; }
  .step-card p { color:var(--muted); font-size:12.5px; line-height:1.5; margin:0; }

  /* ── Sample chips ── */
  .sample-cap { color:var(--muted); font-size:12px; margin:2px 0 8px; }

  /* ── Verdict banners ── */
  .verdict { padding:16px 20px; border-radius:12px; font-weight:800; font-size:15px;
    margin-bottom:14px; display:flex; align-items:center; gap:10px; }
  .verdict-pass { background:rgba(16,185,129,.12); border:1px solid rgba(16,185,129,.4); color:#6ee7b7; }
  .verdict-warn { background:rgba(245,158,11,.12); border:1px solid rgba(245,158,11,.4); color:#fcd34d; }
  .verdict-fail { background:rgba(220,38,38,.12); border:1px solid rgba(220,38,38,.4); color:#fca5a5; }

  /* ── Metric cards ── */
  .metric-row { display:flex; gap:12px; margin:8px 0 4px; flex-wrap:wrap; }
  .metric-card { flex:1 1 120px; background:var(--surface); border:1px solid var(--border);
    border-radius:12px; padding:16px; text-align:center; }
  .metric-val { font-size:28px; font-weight:900; color:#fff; }
  .metric-label { font-size:10.5px; color:var(--dim); margin-top:4px;
    text-transform:uppercase; letter-spacing:.06em; }

  /* ── Event stream (terminal) ── */
  .term { background:#05080f; border:1px solid var(--border); border-radius:10px;
    padding:8px; max-height:380px; overflow-y:auto; }
  .term-bar { display:flex; gap:6px; padding:6px 8px 10px; }
  .term-bar i { width:10px; height:10px; border-radius:50%; display:inline-block; }
  .event-line { display:flex; gap:8px; padding:4px 8px; border-radius:5px;
    font-size:12px; font-family:'JetBrains Mono','Courier New',monospace; margin-bottom:2px;
    border-left:2px solid transparent; }
  .event-success { background:rgba(16,185,129,.07); color:#6ee7b7; border-left-color:var(--pass); }
  .event-error   { background:rgba(220,38,38,.08);  color:#fca5a5; border-left-color:var(--fail); }
  .event-warning { background:rgba(245,158,11,.07); color:#fcd34d; border-left-color:var(--warn); }
  .event-info    { background:rgba(96,165,250,.05); color:#cbd5e1; border-left-color:var(--blue); }
  .event-done    { background:rgba(247,148,29,.10); color:#FDB46A; font-weight:800;
    border-left-color:var(--orange); }

  /* ── Field groups ── */
  .field-group-header { background:rgba(96,165,250,.08); color:#93c5fd; font-size:10.5px;
    font-weight:800; text-transform:uppercase; letter-spacing:.08em;
    padding:7px 11px; border-radius:6px; margin:12px 0 4px; }
  .field-row { display:flex; align-items:center; padding:7px 4px;
    border-bottom:1px solid var(--border); gap:8px; }
  .field-name { color:var(--muted); font-size:12px; font-weight:500; min-width:170px; }
  .field-val  { color:#f1f5f9; font-size:13px; flex:1; font-weight:600; }

  /* ── Confidence badges + heatmap ── */
  .conf-high { background:rgba(16,185,129,.15); color:#6ee7b7; padding:2px 9px;
    border-radius:10px; font-size:11px; font-weight:700; }
  .conf-med  { background:rgba(245,158,11,.15); color:#fcd34d; padding:2px 9px;
    border-radius:10px; font-size:11px; font-weight:700; }
  .conf-low  { background:rgba(220,38,38,.15); color:#fca5a5; padding:2px 9px;
    border-radius:10px; font-size:11px; font-weight:700; }
  .conf-na   { background:rgba(148,163,184,.12); color:var(--dim); padding:2px 9px;
    border-radius:10px; font-size:11px; }
  .heat-wrap { display:flex; flex-wrap:wrap; gap:7px; margin-top:6px; }
  .heat-chip { padding:6px 11px; border-radius:8px; font-size:11px; font-weight:700;
    border:1px solid var(--border); display:flex; flex-direction:column; gap:1px; }
  .heat-chip .hk { font-size:9.5px; font-weight:600; opacity:.8; text-transform:uppercase;
    letter-spacing:.04em; }

  /* ── Rule rows ── */
  .rule-pass { color:#6ee7b7; font-size:12px; padding:6px 8px;
    border-bottom:1px solid var(--border); }
  .rule-warn { color:#fcd34d; background:rgba(245,158,11,.08); font-size:12px;
    padding:7px 9px; border-radius:6px; margin-bottom:4px; border-left:2px solid var(--warn); }
  .rule-fail { color:#fca5a5; background:rgba(220,38,38,.09); font-size:12px;
    padding:7px 9px; border-radius:6px; margin-bottom:4px; border-left:2px solid var(--fail); }

  /* ── Drawing canvas frame ── */
  .canvas-frame { border:1px solid var(--border); border-radius:14px; overflow:hidden;
    background:var(--surface-2); position:relative; }
  .canvas-frame .cap { display:flex; align-items:center; justify-content:space-between;
    padding:9px 14px; background:var(--surface); border-bottom:1px solid var(--border);
    font-size:11px; color:var(--muted); font-weight:700; letter-spacing:.05em;
    text-transform:uppercase; }
  .canvas-frame .cap .live { color:var(--orange); display:flex; align-items:center; gap:6px; }

  /* ── Status badges ── */
  .status-done { background:rgba(16,185,129,.15); color:#6ee7b7; padding:2px 9px;
    border-radius:10px; font-size:11px; font-weight:700; }
  .status-error { background:rgba(220,38,38,.15); color:#fca5a5; padding:2px 9px;
    border-radius:10px; font-size:11px; font-weight:700; }
  .status-processing { background:rgba(96,165,250,.15); color:#93c5fd; padding:2px 9px;
    border-radius:10px; font-size:11px; font-weight:700; }
  .status-other { background:rgba(148,163,184,.12); color:var(--muted); padding:2px 9px;
    border-radius:10px; font-size:11px; }

  /* Buttons */
  .stButton > button { border-radius:10px; font-weight:700; }

  /* ── Dropdown / selectbox hardening (keep popover above the 3D iframe &
        guarantee readable options on the dark theme) ── */
  div[data-baseweb="select"] > div { background:var(--surface) !important;
    border-color:var(--border) !important; }
  div[data-baseweb="popover"], div[data-baseweb="popover"] * { z-index:2147483000 !important; }
  ul[data-baseweb="menu"] { background:#0d1526 !important;
    border:1px solid var(--border) !important; }
  ul[data-baseweb="menu"] li { color:#f1f5f9 !important; }
  ul[data-baseweb="menu"] li:hover { background:rgba(247,148,29,.16) !important; }
  /* component iframes (3D model) must not sit above popovers */
  iframe[title="streamlit_component"] { position:relative; z-index:0; }
</style>
""", unsafe_allow_html=True)

# ══════════════════════════════════════════════════════════════════════════════
# Session state
# ══════════════════════════════════════════════════════════════════════════════
for key, default in [
    ("active_tab", "Upload"),
    ("last_result", {}),
    ("last_drawing_id", None),
    ("last_image_bytes", None),
    ("last_image_type", None),
    ("last_image_name", None),
    ("pending_job", None),
    ("nav_stack", []),
    ("form_dirty", False),     # unsaved edits on the current page
    ("confirm_back", False),   # showing "discard changes?" confirmation
    ("auth_token", None),      # JWT held server-side in session (not browser localStorage)
    ("auth_user", None),       # {username, email, role}
    ("login_error", None),
]:
    if key not in st.session_state:
        st.session_state[key] = default


# ══════════════════════════════════════════════════════════════════════════════
# Navigation system — history stack + reusable Back component
#   Streamlit has no browser router, so we keep our own per-session history
#   stack. go_to() pushes; go_back() pops with a safe fallback to the home tab.
# ══════════════════════════════════════════════════════════════════════════════
HOME_TAB = "Upload"   # landing/dashboard — Back is hidden here


def go_to(tab: str):
    """Navigate to a tab, remembering where we came from (for the Back button)."""
    if tab != st.session_state.active_tab:
        st.session_state.nav_stack.append(st.session_state.active_tab)
        st.session_state.active_tab = tab
    # Leaving a page clears any unsaved-edit state for that page.
    st.session_state.form_dirty = False
    st.session_state.confirm_back = False
    st.rerun()


def go_back():
    """Return to the previous tab. Falls back to HOME_TAB if history is empty
    (e.g. the user deep-linked straight into a page)."""
    st.session_state.active_tab = (
        st.session_state.nav_stack.pop() if st.session_state.nav_stack else HOME_TAB
    )
    st.session_state.form_dirty = False
    st.session_state.confirm_back = False
    st.rerun()


def render_back_bar():
    """Global Back control. Placed once after the header so it covers every page.

    - Hidden on the home/landing tab (HOME_TAB).
    - If the page has unsaved edits (form_dirty), Back first asks to discard.
    - Always safe: empty history falls back to HOME_TAB inside go_back().
    """
    if st.session_state.active_tab == HOME_TAB:
        return

    # Unsaved-changes confirmation flow (Streamlit equivalent of "close modal first").
    if st.session_state.confirm_back:
        st.warning("⚠️  You have unsaved changes on this page. Discard them and go back?")
        d1, d2, _ = st.columns([1.2, 1.2, 5])
        if d1.button("Discard & go back", type="primary", use_container_width=True):
            go_back()
        if d2.button("Stay on page", use_container_width=True):
            st.session_state.confirm_back = False
            st.rerun()
        st.divider()
        return

    prev = st.session_state.nav_stack[-1] if st.session_state.nav_stack else HOME_TAB
    bcol, _ = st.columns([1.4, 6])
    with bcol:
        if st.button(f"←  Back to {prev}", use_container_width=True, key="global_back",
                     help="Return to the previous screen"):
            if st.session_state.form_dirty:
                st.session_state.confirm_back = True   # intercept → confirm first
                st.rerun()
            else:
                go_back()


# ══════════════════════════════════════════════════════════════════════════════
# Authentication
#   The JWT lives in st.session_state — server-side, per-session, NOT in browser
#   localStorage and not reachable by page JS (so it can't be stolen via XSS), the
#   Streamlit-native equivalent of an HttpOnly cookie. The FastAPI API independently
#   enforces the token on every protected route; this gate is the UX layer.
# ══════════════════════════════════════════════════════════════════════════════
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def api_headers() -> dict:
    """Authorization header for authenticated API calls (empty if logged out)."""
    tok = st.session_state.get("auth_token")
    return {"Authorization": f"Bearer {tok}"} if tok else {}


def report_url(path: str) -> str:
    """Build a report/export URL that carries the token as a query param, so links
    opened in a new BROWSER tab (which has no access to the server-side session) are
    still authenticated. Tokens are short-lived; production should prefer cookies."""
    tok = st.session_state.get("auth_token") or ""
    sep = "&" if "?" in path else "?"
    return f"{API_URL}{path}{sep}token={tok}"


def _token_valid(tok: str) -> bool:
    """Locally check token presence + expiry (no signature check — the API verifies
    the signature). Avoids a network round-trip on every Streamlit rerun."""
    if not tok:
        return False
    try:
        claims = jwt.decode(tok, options={"verify_signature": False})
        return float(claims.get("exp", 0)) > time.time()
    except Exception:
        return False


def do_logout():
    for k in ("auth_token", "auth_user"):
        st.session_state[k] = None
    st.session_state.nav_stack = []
    st.session_state.active_tab = "Upload"
    st.rerun()


def render_login():
    """Centered login card. Gate: nothing else renders until authenticated."""
    st.markdown("""
    <div style="text-align:center;margin:6vh 0 0;">
      <div style="font-size:30px;font-weight:900;color:#fff;letter-spacing:.5px;">
        PRIN<span style="color:#F7941D">TO</span></div>
      <div style="color:#94a3b8;font-size:13px;margin-top:2px;">
        AI Drawing Intelligence — please sign in</div>
    </div>
    """, unsafe_allow_html=True)

    _, mid, _ = st.columns([1, 1.3, 1])
    with mid:
        with st.container(border=True):
            # Show/Hide toggle lives OUTSIDE the form so it toggles immediately
            # (in-form widgets only update on submit).
            show_pw = st.checkbox("Show password", key="login_show")

            with st.form("login_form", clear_on_submit=False):
                identifier = st.text_input("User ID or Email", key="login_id",
                                           placeholder="Admin")
                password = st.text_input(
                    "Password", key="login_pw",
                    type="default" if show_pw else "password",
                    placeholder="••••••••")
                cc1, cc2 = st.columns([1, 1])
                remember = cc1.checkbox("Remember me", key="login_remember")
                cc2.markdown(
                    "<div style='text-align:right;font-size:12px;margin-top:6px;'>"
                    "<a href='#' style='color:#60a5fa;text-decoration:none;'>Forgot password?</a></div>",
                    unsafe_allow_html=True)
                submitted = st.form_submit_button("🔐  Sign In", type="primary",
                                                  use_container_width=True)

            if submitted:
                ident = (identifier or "").strip()
                # ── client-side validation ──
                if not ident or not password:
                    st.session_state.login_error = "Please enter both your ID/email and password."
                elif "@" in ident and not EMAIL_RE.match(ident):
                    st.session_state.login_error = "That doesn't look like a valid email address."
                else:
                    with st.spinner("Signing in…"):
                        try:
                            r = requests.post(
                                f"{API_URL}/auth/login",
                                json={"identifier": ident, "password": password,
                                      "remember": bool(remember)},
                                timeout=10)
                        except Exception as e:
                            r = None
                            st.session_state.login_error = f"Cannot reach server: {e}"
                    if r is not None:
                        if r.status_code == 200:
                            data = r.json()
                            st.session_state.auth_token = data["token"]
                            st.session_state.auth_user = data["user"]
                            st.session_state.login_error = None
                            st.toast(f"Welcome, {data['user']['username']}!", icon="✅")
                            st.rerun()
                        elif r.status_code == 429:
                            st.session_state.login_error = r.json().get("detail", "Too many attempts.")
                        else:
                            st.session_state.login_error = "Invalid credentials. Please try again."

            if st.session_state.get("login_error"):
                st.error(st.session_state.login_error)
                st.toast(st.session_state.login_error, icon="⚠️")

        st.caption("🔒 Secured with bcrypt + JWT. Sessions are held server-side.")


# ══════════════════════════════════════════════════════════════════════════════
# Static data + helpers
# ══════════════════════════════════════════════════════════════════════════════
FLOOR_CATEGORIES = [
    "Ground Floor", "First Floor", "Second Floor", "Third Floor",
    "Fourth Floor", "Basement", "Terrace / Roof", "Kitchen", "Other"
]

MARQUEE_TAGS = [
    "Title Block", "Drawing Number", "Floor Area", "Room Schedule", "Dimensions",
    "Materials", "Approval Stamp", "Revision", "Scale", "Door / Window Count",
    "Grid Lines", "North Arrow", "18 Validation Rules", "RealSoft ERP",
]

SAMPLE_DRAWINGS = [
    {"file": "ground_floor_plan.png", "label": "Ground Floor Plan", "floor": "Ground Floor", "icon": "🏠"},
    {"file": "first_floor_plan.png",  "label": "First Floor Plan",  "floor": "First Floor",  "icon": "🏢"},
    {"file": "basement_plan.png",     "label": "Basement Plan",     "floor": "Basement",     "icon": "🅿️"},
]

FIELD_GROUPS = {
    "📋 Title Block": [
        ("drawing_number", "Drawing Number"), ("drawing_title", "Drawing Title"),
        ("project_name", "Project Name"), ("project_location", "Project Location"),
        ("client_name", "Client Name"), ("contractor_name", "Contractor"),
        ("date_of_issue", "Date of Issue"), ("revision_number", "Revision"),
        ("sheet_number", "Sheet No."), ("total_sheets", "Total Sheets"), ("scale", "Scale"),
    ],
    "🏠 Floor Plan Info": [
        ("floor_level", "Floor Level"), ("total_floor_area", "Floor Area"),
        ("building_type", "Building Type"), ("number_of_rooms", "No. of Rooms"),
        ("door_count", "Door Count"), ("window_count", "Window Count"),
        ("dimensions", "Overall Dimensions"),
    ],
    "👷 Participants": [
        ("drawn_by", "Drawn By"), ("checked_by", "Checked By"), ("approved_by", "Approved By"),
    ],
    "🔧 Technical": [
        ("structural_notes", "Structural Notes"), ("materials", "Materials"),
        ("approval_stamp", "Approval Stamp"), ("north_arrow", "North Arrow"),
        ("grid_lines", "Grid Lines"), ("additional_notes", "Additional Notes"),
    ],
}

# Friendly labels for the confidence heatmap
HEAT_LABELS = {
    "drawing_number": "Drawing No.", "drawing_title": "Title", "project_name": "Project",
    "floor_level": "Floor", "total_floor_area": "Area", "scale": "Scale",
    "revision_number": "Revision", "approval_stamp": "Stamp", "dimensions": "Dimensions",
    "materials": "Materials", "room_schedule": "Rooms", "building_type": "Type",
    "client_name": "Client", "date_of_issue": "Date",
}


def _conf_html(c):
    if c is None:
        return '<span class="conf-na">N/A</span>'
    if c >= 0.85:
        return f'<span class="conf-high">{c:.0%}</span>'
    if c >= 0.60:
        return f'<span class="conf-med">{c:.0%}</span>'
    return f'<span class="conf-low">{c:.0%}</span>'


def _heat_color(c):
    """Return (bg, border, text) for a confidence heat chip."""
    if c is None:
        return "rgba(148,163,184,.10)", "var(--border)", "#94a3b8"
    if c >= 0.85:
        return "rgba(16,185,129,.14)", "rgba(16,185,129,.45)", "#6ee7b7"
    if c >= 0.60:
        return "rgba(245,158,11,.14)", "rgba(245,158,11,.45)", "#fcd34d"
    return "rgba(220,38,38,.14)", "rgba(220,38,38,.45)", "#fca5a5"


def _fmt_val(val):
    if val is None:
        return "—"
    if isinstance(val, bool):
        return "✅ Yes" if val else "✗ No"
    if isinstance(val, list):
        return ", ".join(str(x) for x in val) if val else "—"
    return str(val)


def _guess_media_type(name: str) -> str:
    suffix = Path(name).suffix.lower()
    return {
        ".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".png": "image/png", ".tiff": "image/tiff", ".tif": "image/tiff",
    }.get(suffix, "image/png")


# ── Interactive 3D hero visual (Three.js — drag to rotate, scroll to zoom) ────
def threejs_building_html() -> str:
    return """
<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  html,body{margin:0;height:100%;overflow:hidden;font-family:system-ui,sans-serif;}
  body{border:1px solid #1e2d4a;border-radius:16px;box-sizing:border-box;
    background:radial-gradient(560px 320px at 72% 22%, rgba(247,148,29,.12), transparent 60%),
               linear-gradient(135deg,#0b1326,#0a1020);}
  #c{width:100%;height:100%;display:block;cursor:grab;}
  #c:active{cursor:grabbing;}
  .tag{position:absolute;top:12px;left:14px;font-size:10px;font-weight:800;
    letter-spacing:.18em;text-transform:uppercase;color:#F7941D;}
  .hint{position:absolute;bottom:10px;left:0;right:0;text-align:center;
    font-size:10px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;
    color:#5b6b85;pointer-events:none;}
</style></head><body>
  <canvas id="c"></canvas>
  <div class="tag">● Live 3D Model</div>
  <div class="hint">drag to rotate · scroll to zoom</div>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js"></script>
  <script>
    const canvas = document.getElementById('c');
    const renderer = new THREE.WebGLRenderer({canvas, antialias:true, alpha:true});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(6.5, 5, 7.5);

    scene.add(new THREE.AmbientLight(0x8aa0c0, 0.75));
    const dir = new THREE.DirectionalLight(0xffffff, 0.9); dir.position.set(5,10,7); scene.add(dir);
    const pt = new THREE.PointLight(0xF7941D, 0.9, 50); pt.position.set(-5,6,-2); scene.add(pt);

    const g = new THREE.Group(); scene.add(g);
    const grid = new THREE.GridHelper(11, 11, 0x2b4a78, 0x1b2c4a);
    grid.position.y = -1.65; g.add(grid);

    const navy = new THREE.MeshStandardMaterial({color:0x16233d, metalness:0.35, roughness:0.55});
    // [w, h, d, y, isTop]
    const floors = [[3.2,0.95,3.2,-1.0,false],[2.75,0.95,2.75,0.0,false],[2.3,0.95,2.3,1.0,true]];
    floors.forEach(function(s){
      const geo = new THREE.BoxGeometry(s[0], s[1], s[2]);
      const mesh = new THREE.Mesh(geo, navy.clone()); mesh.position.y = s[3]; g.add(mesh);
      const edge = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({color: s[4] ? 0xF7941D : 0x2b4a78}));
      edge.position.y = s[3]; g.add(edge);
    });

    // pulsing orange scan ring
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.9, 0.035, 10, 64),
      new THREE.MeshBasicMaterial({color:0xF7941D}));
    ring.rotation.x = Math.PI/2; g.add(ring);

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.autoRotate = true; controls.autoRotateSpeed = 1.2;
    controls.enablePan = false; controls.minDistance = 5; controls.maxDistance = 16;
    controls.target.set(0, 0.2, 0);

    function resize(){
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== w || canvas.height !== h){
        renderer.setSize(w, h, false);
        camera.aspect = w / h; camera.updateProjectionMatrix();
      }
    }
    let t = 0;
    function loop(){
      requestAnimationFrame(loop); resize();
      t += 0.02; ring.position.y = 1.55 + Math.sin(t) * 0.9;
      controls.update(); renderer.render(scene, camera);
    }
    loop();
  </script>
</body></html>"""


def run_pipeline_ui(file_bytes: bytes, file_name: str, media_type: str,
                    floor_cat: str, strict: bool) -> dict:
    """Stream the upload pipeline and render the live terminal log. Returns final payload."""
    st.markdown('<div class="eyebrow" style="margin-top:8px">Live Pipeline</div>'
                '<div class="sec-title">⚙️ Processing — AI is reading the drawing</div>',
                unsafe_allow_html=True)

    progress_bar = st.progress(0, text="Starting…")
    st.markdown(
        '<div class="term-bar"><i style="background:#fca5a5"></i>'
        '<i style="background:#fcd34d"></i><i style="background:#6ee7b7"></i></div>',
        unsafe_allow_html=True,
    )
    stream_placeholder = st.empty()
    stream_lines, progress, final_data = [], 0, {}

    try:
        with requests.post(
            f"{API_URL}/upload",
            files={"file": (file_name, file_bytes, media_type)},
            data={"floor_category": floor_cat, "strict": str(strict).lower()},
            headers=api_headers(),
            stream=True, timeout=120,
        ) as resp:
            for raw_line in resp.iter_lines():
                if not raw_line:
                    continue
                line = raw_line.decode("utf-8")
                if not line.startswith("data:"):
                    continue
                payload = json.loads(line[5:].strip())

                # The final payload carries "verdict"; note the 🏁 "Complete" log line
                # is also type=="done" but only has "line" — render it, don't stop on it.
                if payload.get("type") == "done" and "verdict" in payload:
                    final_data = payload
                    progress_bar.progress(100, text="✅ Complete")
                    break

                etype = payload.get("type", "info")
                text = payload.get("line", "")
                stream_lines.append((text, etype))

                html_lines = "".join(
                    f'<div class="event-line event-{t}">{l}</div>'
                    for l, t in stream_lines
                )
                stream_placeholder.markdown(
                    f'<div class="term">{html_lines}</div>', unsafe_allow_html=True
                )

                if any(r in text for r in ("R01", "R02", "R03")):
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

    return final_data


def start_job(file_bytes: bytes, file_name: str, media_type: str, floor_cat: str):
    """Persist the chosen drawing and switch into processing on next run."""
    st.session_state.pending_job = {
        "bytes": file_bytes, "name": file_name, "type": media_type, "floor": floor_cat,
    }
    st.session_state.active_tab = "Upload"
    st.rerun()


# ══════════════════════════════════════════════════════════════════════════════
# AUTH GATE — nothing below renders until the user is signed in
# ══════════════════════════════════════════════════════════════════════════════
if not _token_valid(st.session_state.get("auth_token")):
    st.session_state.auth_token = None
    render_login()
    st.stop()


# ══════════════════════════════════════════════════════════════════════════════
# Header
# ══════════════════════════════════════════════════════════════════════════════
st.markdown("""
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
  <div>
    <div style="font-size:24px;font-weight:900;letter-spacing:.5px;color:#fff">
      PRIN<span style="color:#F7941D">TO</span>
      <span style="font-size:13px;font-weight:500;color:#94a3b8;margin-left:8px">
        AI Drawing Intelligence Platform</span>
    </div>
  </div>
  <div style="background:rgba(247,148,29,.12);border:1px solid rgba(247,148,29,.3);
    color:#F7941D;padding:5px 14px;border-radius:999px;font-size:11px;font-weight:800;
    letter-spacing:.1em">DEMO v2.0</div>
</div>
""", unsafe_allow_html=True)

# ══════════════════════════════════════════════════════════════════════════════
# Sidebar
# ══════════════════════════════════════════════════════════════════════════════
with st.sidebar:
    # Signed-in user + logout
    _u = st.session_state.get("auth_user") or {}
    st.markdown(f"**👤 {_u.get('username', '—')}** &nbsp;"
                f"<span style='color:#94a3b8;font-size:11px;'>({_u.get('role', '')})</span>",
                unsafe_allow_html=True)
    if st.button("🚪 Logout", use_container_width=True):
        do_logout()
    st.divider()

    st.markdown("### ⚙️ Dashboard")
    try:
        health = requests.get(f"{API_URL}/health", timeout=3).json()
        st.success(f"Server online · v{health.get('version', '—')}")
        if health.get("erp_mode") == "live":
            st.success("RealSoft ERP: Live")
        else:
            st.info("RealSoft ERP: Simulation")
        # AI extraction provider (gateway | sidecar | mock)
        _prov = health.get("ai_provider")
        if _prov == "gateway":
            st.success(f"AI: Gateway · {health.get('ai_model', 'printo-gateway')}")
        elif _prov == "sidecar":
            st.success(f"AI: Sidecar · {health.get('ai_mode','?')} · {health.get('ai_model','')}")
        else:
            st.info("AI: Mock (demo data) — gateway/sidecar offline")
        c1, c2 = st.columns(2)
        c1.metric("Total", health.get("total_drawings", 0))
        c2.metric("Done", health.get("completed", 0))
    except Exception:
        st.error("Backend offline\n\n`uvicorn main:app --port 8000`")

    st.divider()
    strict = st.toggle("Strict Mode", value=False, help="Treat warnings as errors")
    st.divider()

    st.markdown("**Navigation**")
    for tab in ["Upload", "Results", "Report", "History"]:
        icon = {"Upload": "📤", "Results": "📊", "Report": "📄", "History": "🗂️"}[tab]
        if st.button(f"{icon} {tab}", use_container_width=True,
                     type="primary" if st.session_state.active_tab == tab else "secondary"):
            go_to(tab)

# Global Back control — rendered once, covers every page (hidden on the home tab).
render_back_bar()

# ══════════════════════════════════════════════════════════════════════════════
# TAB: UPLOAD
# ══════════════════════════════════════════════════════════════════════════════
if st.session_state.active_tab == "Upload":

    # If a job was queued (sample click or upload), process it now.
    job = st.session_state.pending_job
    if job:
        st.session_state.pending_job = None
        final = run_pipeline_ui(job["bytes"], job["name"], job["type"],
                                job["floor"], strict)
        if final:
            st.session_state.last_result = final
            st.session_state.last_drawing_id = final.get("drawing_id")
            st.session_state.last_image_bytes = job["bytes"]
            st.session_state.last_image_type = job["type"]
            st.session_state.last_image_name = job["name"]
            go_to("Results")   # remembers Upload so Back returns home
        st.stop()

    # ── Hero (text + interactive 3D model) ──────────────────────────────────────
    hcol1, hcol2 = st.columns([1.3, 1], gap="large")
    with hcol1:
        st.markdown("""
        <div class="hero" style="min-height:440px;display:flex;align-items:center">
          <div class="hero-left">
            <div class="badge"><span class="pulse-dot"></span> AI Compliance &amp; Extraction Gateway</div>
            <h1>Construction Drawings,<br><span class="grad">Read &amp; Verified by AI</span></h1>
            <p class="sub">Drop a floor plan, section, or elevation — Printo extracts the title
            block, room schedule, dimensions and materials, validates against 18 rules, and
            maps it to RealSoft ERP. In seconds, not days.</p>
            <div class="hero-stats">
              <div class="hstat"><div class="v">~14<small>s</small></div><div class="l">Per drawing</div></div>
              <div class="hstat"><div class="v">26+</div><div class="l">Fields extracted</div></div>
              <div class="hstat"><div class="v">18</div><div class="l">Validation rules</div></div>
            </div>
          </div>
        </div>
        """, unsafe_allow_html=True)
    with hcol2:
        components.html(threejs_building_html(), height=440)

    # ── Marquee ────────────────────────────────────────────────────────────────
    tags_html = "".join(f'<span class="tag">{t}<span class="dot">·</span></span>'
                        for t in MARQUEE_TAGS)
    st.markdown(
        f'<div class="marquee-wrap"><div class="marquee">{tags_html}{tags_html}</div></div>',
        unsafe_allow_html=True,
    )

    # ── How it works (3D-ish step cards) ────────────────────────────────────────
    st.markdown('<div class="eyebrow" style="margin-top:22px">Process</div>'
                '<div class="sec-title">From drawing to ERP in four steps</div>',
                unsafe_allow_html=True)
    steps = [
        ("1", "Upload", "Drop a PDF or image of any architectural drawing."),
        ("2", "AI Extract", "Claude Vision reads the title block & plan into structured data."),
        ("3", "Validate", "18 ClearSoft rules check completeness & confidence."),
        ("4", "Push to ERP", "Mapped to RealSoft format and pushed — with a full report."),
    ]
    cols = st.columns(4)
    for col, (n, title, desc) in zip(cols, steps):
        col.markdown(
            f'<div class="step-card"><div class="step-num">{n}</div>'
            f'<h4>{title}</h4><p>{desc}</p></div>', unsafe_allow_html=True
        )

    st.markdown("<div style='height:18px'></div>", unsafe_allow_html=True)

    # ── Try a sample + Upload ────────────────────────────────────────────────────
    col_sample, col_up = st.columns([1, 1])

    with col_sample:
        st.markdown('<div class="sec-rule">⚡ Try a sample drawing</div>', unsafe_allow_html=True)
        st.markdown('<div class="sample-cap">One click — runs the full pipeline instantly.</div>',
                    unsafe_allow_html=True)
        for s in SAMPLE_DRAWINGS:
            path = SAMPLE_DIR / s["file"]
            exists = path.exists()
            if st.button(f"{s['icon']}  {s['label']}", key=f"sample_{s['file']}",
                         use_container_width=True, disabled=not exists):
                start_job(path.read_bytes(), s["file"], _guess_media_type(s["file"]), s["floor"])
            if not exists:
                st.caption(f"⚠️ {s['file']} not found in test_drawings/")

    with col_up:
        st.markdown('<div class="sec-rule">📤 Or upload your own</div>', unsafe_allow_html=True)
        floor_cat = st.selectbox("Floor / Category", FLOOR_CATEGORIES)
        uploaded = st.file_uploader(
            "Select drawing (PDF / JPG / PNG / TIFF)",
            type=["pdf", "jpg", "jpeg", "png", "tiff"],
        )
        st.markdown('<div class="sample-cap">Max 20 MB · floor plans, sections, elevations</div>',
                    unsafe_allow_html=True)
        if st.button("🚀  Process Drawing", type="primary", use_container_width=True,
                     disabled=uploaded is None):
            start_job(uploaded.getvalue(), uploaded.name,
                      uploaded.type or _guess_media_type(uploaded.name), floor_cat)


# ══════════════════════════════════════════════════════════════════════════════
# TAB: RESULTS
# ══════════════════════════════════════════════════════════════════════════════
elif st.session_state.active_tab == "Results":
    result = st.session_state.get("last_result", {})
    drawing_id = st.session_state.get("last_drawing_id")

    if not result:
        st.info("No drawing processed yet. Go to the **Upload** tab to process one.")
        st.stop()

    verdict = result.get("verdict", "—")
    extracted = result.get("extracted", {})
    errors = result.get("errors", [])
    warnings = result.get("warnings", [])
    elapsed = result.get("elapsed", 0)
    erp_status = result.get("erp_status", "—")
    prepass_count = result.get("prepass_count", 0)
    conf = extracted.get("confidence", {})

    # Verdict banner
    if verdict == "PASSED":
        st.markdown(f'<div class="verdict verdict-pass">✅ EXTRACTION COMPLETE — ALL RULES PASSED '
                    f'&nbsp;·&nbsp; {elapsed}s &nbsp;·&nbsp; ERP: {str(erp_status).upper()}</div>',
                    unsafe_allow_html=True)
    elif verdict == "WARNING":
        st.markdown(f'<div class="verdict verdict-warn">⚠️ COMPLETE — {len(warnings)} WARNING(S) '
                    f'&nbsp;·&nbsp; {elapsed}s &nbsp;·&nbsp; ERP: {str(erp_status).upper()}</div>',
                    unsafe_allow_html=True)
    else:
        st.markdown(f'<div class="verdict verdict-fail">❌ VALIDATION FAILED — {len(errors)} ERROR(S) '
                    f'&nbsp;·&nbsp; {elapsed}s</div>', unsafe_allow_html=True)

    # Metric scorecard
    field_count = sum(1 for k, v in extracted.items()
                      if k != "confidence" and v not in (None, [], ""))
    conf_vals = [v for v in conf.values() if v is not None]
    avg_conf = sum(conf_vals) / len(conf_vals) if conf_vals else 0.0
    prepass_note = f" · {prepass_count} from PDF text" if prepass_count else ""
    vcolor = "#6ee7b7" if verdict == "PASSED" else ("#fcd34d" if verdict == "WARNING" else "#fca5a5")
    st.markdown(f"""
    <div class="metric-row">
      <div class="metric-card"><div class="metric-val">{field_count}</div>
        <div class="metric-label">Fields{prepass_note}</div></div>
      <div class="metric-card"><div class="metric-val">{avg_conf:.0%}</div>
        <div class="metric-label">Avg Confidence</div></div>
      <div class="metric-card"><div class="metric-val" style="color:{vcolor}">{verdict}</div>
        <div class="metric-label">Verdict</div></div>
      <div class="metric-card"><div class="metric-val" style="color:#fca5a5">{len(errors)}</div>
        <div class="metric-label">Errors</div></div>
      <div class="metric-card"><div class="metric-val" style="color:#fcd34d">{len(warnings)}</div>
        <div class="metric-label">Warnings</div></div>
    </div>
    """, unsafe_allow_html=True)

    # Confidence heatmap
    heat_items = [(k, conf.get(k)) for k in HEAT_LABELS if k in conf]
    if heat_items:
        chips = ""
        for k, c in heat_items:
            bg, bd, tx = _heat_color(c)
            label = HEAT_LABELS.get(k, k)
            val = f"{c:.0%}" if c is not None else "N/A"
            chips += (f'<div class="heat-chip" style="background:{bg};border-color:{bd};color:{tx}">'
                      f'<span class="hk">{label}</span>{val}</div>')
        st.markdown('<div class="eyebrow" style="margin-top:10px">Confidence Heatmap</div>'
                    f'<div class="heat-wrap">{chips}</div>', unsafe_allow_html=True)

    st.markdown("<div style='height:14px'></div>", unsafe_allow_html=True)

    # ── Side-by-side: drawing canvas + extracted fields ──────────────────────────
    col_img, col_fields = st.columns([2, 3])

    with col_img:
        st.markdown('<div class="sec-rule">Source Drawing</div>', unsafe_allow_html=True)
        img_bytes = st.session_state.get("last_image_bytes")
        img_type = st.session_state.get("last_image_type") or ""
        st.markdown('<div class="canvas-frame"><div class="cap"><span>Drawing Canvas</span>'
                    '<span class="live">● analysed</span></div>', unsafe_allow_html=True)
        if img_bytes and "pdf" not in img_type.lower():
            st.image(img_bytes, use_column_width=True)
        elif img_bytes and "pdf" in img_type.lower():
            st.info("📄 PDF processed — open the full Report tab to view the rendered drawing.")
        else:
            st.caption("Preview unavailable for this drawing.")
        st.markdown('</div>', unsafe_allow_html=True)

    with col_fields:
        st.markdown('<div class="sec-rule">Extracted Data</div>', unsafe_allow_html=True)
        for group_label, fields in FIELD_GROUPS.items():
            group_html = ""
            for key, label in fields:
                val = extracted.get(key)
                if val is None or val == [] or val == "":
                    continue
                group_html += (f'<div class="field-row"><span class="field-name">{label}</span>'
                               f'<span class="field-val">{_fmt_val(val)}</span>'
                               f'{_conf_html(conf.get(key))}</div>')
            if group_html:
                st.markdown(f'<div class="field-group-header">{group_label}</div>{group_html}',
                            unsafe_allow_html=True)

        room_schedule = extracted.get("room_schedule") or []
        if room_schedule:
            st.markdown('<div class="field-group-header">🛋️ Room Schedule</div>',
                        unsafe_allow_html=True)
            st.table([{"Room": r.get("name", "—"), "Area": r.get("area", "—")}
                      for r in room_schedule])

    # ── Validation + correction ──────────────────────────────────────────────────
    st.markdown("<div style='height:8px'></div>", unsafe_allow_html=True)
    col_val, col_corr = st.columns([3, 2])

    with col_val:
        st.markdown('<div class="sec-rule">Validation Results</div>', unsafe_allow_html=True)
        if errors:
            for e in errors:
                st.markdown(f'<div class="rule-fail">❌ {e}</div>', unsafe_allow_html=True)
        if warnings:
            for w in warnings:
                st.markdown(f'<div class="rule-warn">⚠️ {w}</div>', unsafe_allow_html=True)
        if not errors and not warnings:
            st.markdown('<div class="rule-pass">✅ All validation rules passed</div>',
                        unsafe_allow_html=True)
        erp_payload = result.get("realsoft_payload", {})
        if erp_payload:
            meta = erp_payload.get("metadata", {}) or {}
            low_conf = meta.get("low_confidence_fields", [])
            warns = meta.get("mapping_warnings", [])
            if low_conf:
                st.caption(f"⚠️ {len(low_conf)} ERP field(s) flagged low-confidence: "
                           f"{', '.join(low_conf)}")
            if warns:
                st.caption(f"🛠️ {len(warns)} mapping warning(s) — see payload metadata")
            with st.expander("📦 ERP Payload (RealSoft format)"):
                st.json(erp_payload)

    with col_corr:
        st.markdown('<div class="sec-rule">✏️ Human Verification</div>', unsafe_allow_html=True)
        all_keys = [k for k in extracted if k != "confidence"]
        if all_keys:
            field_to_edit = st.selectbox("Field to correct", all_keys, key="correction_field")
            original_val = _fmt_val(extracted.get(field_to_edit))
            new_val = st.text_input("Corrected value", value=original_val,
                                    key="correction_val")
            # Flag unsaved edits so the Back button can warn before leaving.
            st.session_state.form_dirty = (new_val.strip() != original_val.strip())
            if st.button("💾 Save Correction", type="secondary", use_container_width=True):
                if drawing_id:
                    try:
                        requests.patch(
                            f"{API_URL}/drawings/{drawing_id}/correction",
                            json={"field_name": field_to_edit, "corrected_value": new_val,
                                  "corrected_by": (st.session_state.get("auth_user") or {}).get("username", "user")},
                            headers=api_headers(), timeout=5)
                        st.session_state.form_dirty = False   # saved → no longer dirty
                        st.success(f"Saved correction for '{field_to_edit}'")
                    except Exception as e:
                        st.error(f"Save failed: {e}")

    # ── Export ────────────────────────────────────────────────────────────────────
    st.divider()
    ec1, ec2, ec3, ec4 = st.columns(4)
    if drawing_id:
        ec1.link_button("📄 View Report", report_url(f"/report/{drawing_id}"),
                        use_container_width=True)
        try:
            pdf_bytes = requests.get(f"{API_URL}/report/{drawing_id}/pdf",
                                     headers=api_headers(), timeout=20).content
            ec2.download_button("⬇️ Download PDF", data=pdf_bytes,
                                file_name=f"printo_report_{drawing_id}.pdf",
                                mime="application/pdf", use_container_width=True)
        except Exception:
            ec2.button("⬇️ PDF (unavailable)", disabled=True, use_container_width=True)
        try:
            excel_bytes = requests.get(f"{API_URL}/export/{drawing_id}/excel",
                                       headers=api_headers(), timeout=10).content
            ec3.download_button("📊 Excel", data=excel_bytes,
                                file_name=f"printo_drawing_{drawing_id}.xlsx",
                                mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                                use_container_width=True)
        except Exception:
            ec3.button("📊 Excel (unavailable)", disabled=True, use_container_width=True)
        if ec4.button("➡️ Open Report Tab", use_container_width=True):
            go_to("Report")


# ══════════════════════════════════════════════════════════════════════════════
# TAB: REPORT
# ══════════════════════════════════════════════════════════════════════════════
elif st.session_state.active_tab == "Report":
    drawing_id = st.session_state.get("last_drawing_id")
    if not drawing_id:
        st.info("Process a drawing first to view its report.")
        st.stop()

    rt1, rt2 = st.columns([1, 1])
    rt1.link_button("🔗 Open Report in New Tab", report_url(f"/report/{drawing_id}"),
                    use_container_width=True)
    try:
        pdf_bytes = requests.get(f"{API_URL}/report/{drawing_id}/pdf",
                                 headers=api_headers(), timeout=20).content
        rt2.download_button("⬇️ Download PDF", data=pdf_bytes,
                            file_name=f"printo_report_{drawing_id}.pdf",
                            mime="application/pdf", use_container_width=True)
    except Exception:
        rt2.button("⬇️ PDF (unavailable)", disabled=True, use_container_width=True)

    try:
        html_report = requests.get(f"{API_URL}/report/{drawing_id}",
                                   headers=api_headers(), timeout=10).text
        components.html(html_report, height=820, scrolling=True)
    except Exception as e:
        st.error(f"Could not load report: {e}")


# ══════════════════════════════════════════════════════════════════════════════
# TAB: HISTORY
# ══════════════════════════════════════════════════════════════════════════════
elif st.session_state.active_tab == "History":
    st.markdown('<div class="sec-rule">Processing History</div>', unsafe_allow_html=True)

    hb1, hb2, hb3 = st.columns([1, 1.4, 1.4])
    if hb1.button("🔄 Refresh", use_container_width=True):
        st.rerun()
    hb2.link_button("📊 Project Summary Report", report_url("/report/project"),
                    use_container_width=True)
    try:
        proj_pdf = requests.get(f"{API_URL}/report/project/pdf",
                                headers=api_headers(), timeout=25).content
        hb3.download_button("⬇️ Project PDF", data=proj_pdf,
                            file_name="printo_project_report.pdf",
                            mime="application/pdf", use_container_width=True)
    except Exception:
        hb3.button("⬇️ Project PDF (unavailable)", disabled=True, use_container_width=True)

    try:
        drawings = requests.get(f"{API_URL}/drawings", headers=api_headers(), timeout=5).json()
    except Exception:
        st.error("Backend not reachable.")
        st.stop()

    if not drawings:
        st.info("No drawings processed yet.")
        st.stop()

    for d in drawings:
        status = d.get("status", "—")
        badge = {
            "done": '<span class="status-done">✅ Done</span>',
            "error": '<span class="status-error">❌ Error</span>',
            "processing": '<span class="status-processing">⏳ Processing</span>',
        }.get(status, f'<span class="status-other">{status}</span>')

        with st.expander(f"#{d['id']}  ·  {d.get('file_name', '—')}  ·  "
                         f"{d.get('floor_category', '—')}  ·  {d.get('uploaded_at', '—')[:16]}"):
            c1, c2 = st.columns(2)
            c1.markdown(f"""
            **Status:** {badge}
            **Drawing No.:** {d.get('drawing_number') or '—'}
            **Title:** {d.get('drawing_title') or '—'}
            **Project:** {d.get('project_name') or '—'}
            """, unsafe_allow_html=True)
            c2.markdown(f"""
            **Floor:** {d.get('floor_category') or '—'}
            **Uploaded:** {d.get('uploaded_at', '—')[:16]}
            """, unsafe_allow_html=True)

            hc1, hc2 = st.columns(2)
            if hc1.button("📊 View Results", key=f"res_{d['id']}"):
                try:
                    detail = requests.get(f"{API_URL}/drawings/{d['id']}",
                                          headers=api_headers(), timeout=5).json()
                    extr = {e["field"]: e["value"] for e in detail.get("extractions", [])}
                    conf_map = {e["field"]: e["confidence"]
                                for e in detail.get("extractions", [])
                                if e["confidence"] is not None}
                    extr["confidence"] = conf_map
                    st.session_state.last_result = {"extracted": extr, "errors": [],
                                                    "warnings": [], "verdict": status,
                                                    "elapsed": 0, "erp_status": "—"}
                    st.session_state.last_drawing_id = d["id"]
                    st.session_state.last_image_bytes = None
                    go_to("Results")   # remembers History for Back
                except Exception as e:
                    st.error(str(e))
            hc2.link_button("📄 Report", report_url(f"/report/{d['id']}"), use_container_width=True)
