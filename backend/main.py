import asyncio
import datetime
import io
import json
import os
import re
import shutil
import sqlite3
import time
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, UploadFile, HTTPException, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, StreamingResponse
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

from database        import init_db, get_conn, DB_PATH
from extractor       import extract_drawing_with_prepass
from ai_provider     import provider_status
from realsoft_mapper import map_to_realsoft, average_confidence
from realsoft_client import push_to_realsoft, ping_realsoft, RealSoftAPIError
from report_generator import (generate_report, generate_project_report,
                              html_to_pdf_bytes, plain_summary)
from boq_excel import build_boq_workbook, build_project_workbook
from auth import (verify_login, create_token, require_auth,
                  is_locked, record_failure, clear_failures)
from ai_provider import gateway_erp_map
import base64
import preprocess
import cad_convert

STORAGE_DIR = Path(__file__).parent.parent / "storage"
STORAGE_DIR.mkdir(exist_ok=True)

# Chunked-upload staging. Large files are uploaded in <4 MB chunks (so they fit
# under Vercel's 4.5 MB function-body cap, keeping the whole flow same-origin),
# appended here in order, then assembled by /upload when finalized.
CHUNK_DIR = STORAGE_DIR / "_chunks"
CHUNK_DIR.mkdir(exist_ok=True)


def _safe_upload_id(upload_id: str) -> str:
    safe = "".join(c for c in (upload_id or "") if c.isalnum())[:64]
    if not safe:
        raise HTTPException(400, "Invalid upload id")
    return safe

# Raster formats handled directly + CAD formats rendered to raster (DWG/DXF/DWF).
RASTER_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png", ".tiff", ".tif"}
ALLOWED_EXTENSIONS = RASTER_EXTENSIONS | cad_convert.CAD_SUFFIXES
MAX_FILE_SIZE_MB    = int(os.getenv("MAX_FILE_SIZE_MB", "100"))
# Extraction timeout — the gateway runs Claude CLI on the VPS, which is slower
# than a direct API, so allow more headroom than the original 55s. Configurable.
EXTRACT_TIMEOUT     = float(os.getenv("EXTRACT_TIMEOUT", "110"))
# Extraction now runs in a background job (no request ceiling), so this is just a
# safety bound for batching + gap-fill. Kept under the gateway's 1800s CLAUDE timeout.
VISION_EXTRACT_TIMEOUT = float(os.getenv("VISION_EXTRACT_TIMEOUT", "1500"))

# ERP simulation mode when credentials are absent or placeholder
def _is_real_credential(val: str | None) -> bool:
    return bool(val and val.strip() and not val.strip().startswith("YOUR_"))

_erp_configured = _is_real_credential(os.getenv("REALSOFT_BASE_URL")) and \
                  _is_real_credential(os.getenv("REALSOFT_API_KEY"))

app = FastAPI(title="ERP RealSoft API", version="2.0.0")

# Browser CORS. The Next.js frontend talks to this API server-side (BFF proxy), so
# the browser normally never calls it cross-origin. Keep this configurable for any
# direct browser access: set ALLOWED_ORIGINS to a comma-separated list of origins
# (e.g. "https://printo.vercel.app,http://localhost:3000") to lock it down in prod.
_origins_env = os.getenv("ALLOWED_ORIGINS", "*").strip()
_allow_origins = ["*"] if _origins_env == "*" else [o.strip() for o in _origins_env.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allow_origins,
    allow_credentials=_origins_env != "*",
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    init_db()


# ── Authentication ──────────────────────────────────────────────────────────
class LoginRequest(BaseModel):
    identifier: str            # username OR email
    password: str
    remember: bool = False


@app.post("/auth/login")
def auth_login(body: LoginRequest):
    ident = (body.identifier or "").strip()
    if not ident or not body.password:
        raise HTTPException(400, "Username and password are required")

    locked = is_locked(ident)
    if locked:
        raise HTTPException(429, f"Too many attempts. Try again in {locked}s.")

    user = verify_login(ident, body.password)
    if not user:
        record_failure(ident)
        raise HTTPException(401, "Invalid credentials")   # generic — no enumeration

    clear_failures(ident)
    token, expires_in = create_token(user["username"], user["role"], body.remember)
    return {
        "token": token,
        "token_type": "bearer",
        "expires_in": expires_in,
        "user": {"username": user["username"], "email": user["email"], "role": user["role"]},
    }


@app.get("/auth/me")
def auth_me(user: dict = Depends(require_auth)):
    return user


# ── Helpers ────────────────────────────────────────────────────────────────

def now() -> str:
    return datetime.datetime.now().strftime("%H:%M:%S")

def event(icon: str, step: str, message: str, etype: str = "info") -> str:
    line = f"  [{now()}]  {icon}  {step} — {message}"
    return f"data: {json.dumps({'line': line, 'type': etype})}\n\n"


# ── Async job runner ─────────────────────────────────────────────────────────
# Multi-sheet vision takes minutes — longer than the 300s Vercel/nginx request
# ceiling — so the pipeline runs as a background task and the client polls
# GET /drawings/{id}/events. Single uvicorn worker → an in-memory dict suffices;
# results are still persisted to DB + report_data exactly as before.
JOBS: dict[int, dict] = {}
_JOB_TTL_S = 1800   # prune terminal jobs older than this (on each new upload)


def _prune_jobs():
    cutoff = time.time() - _JOB_TTL_S
    for did in [d for d, j in JOBS.items()
                if j.get("phase") in ("done", "error") and j.get("ended", 0) < cutoff]:
        JOBS.pop(did, None)


def _parse_sse(chunk: str) -> dict:
    try:
        return json.loads(chunk.split("data:", 1)[1].strip())
    except Exception:
        return {}


async def _run_job(file_path, file_name, drawing_id, size_mb, strict,
                   floor_category, project_description, discipline):
    """Drain run_pipeline's SSE events into the in-memory buffer for polling."""
    job = JOBS[drawing_id]
    try:
        async for chunk in run_pipeline(file_path, file_name, drawing_id, size_mb,
                                        strict, floor_category, project_description, discipline):
            ev = _parse_sse(chunk)
            if not ev:
                continue
            if ev.get("type") == "done":
                job["done"] = ev
                job["phase"] = "done"
            elif ev.get("line"):
                job["lines"].append({"text": ev["line"], "type": ev.get("type", "info")})
    except Exception as e:
        job["phase"] = "error"
        job["lines"].append({"text": f"Pipeline error: {e}", "type": "error"})
        job["done"] = {"type": "done", "verdict": "ERROR", "drawing_id": drawing_id}
    finally:
        if job.get("phase") not in ("done", "error"):
            job["phase"] = "done"
        job["ended"] = time.time()

def save_drawing_record(file_name: str, file_path: str, floor_category: str,
                         project_description: str = "") -> int:
    conn = get_conn()
    cur = conn.execute(
        "INSERT INTO drawings (file_name, file_path, status, floor_category, project_description) "
        "VALUES (?,?,?,?,?)",
        (file_name, str(file_path), "processing", floor_category, project_description)
    )
    conn.commit()
    rec_id = cur.lastrowid
    conn.close()
    return rec_id

def update_drawing_status(drawing_id: int, status: str,
                           drawing_number: str = None, project_name: str = None,
                           drawing_title: str = None):
    conn = get_conn()
    conn.execute(
        "UPDATE drawings SET status=?, drawing_number=?, project_name=?, drawing_title=? WHERE id=?",
        (status, drawing_number, project_name, drawing_title, drawing_id)
    )
    conn.commit()
    conn.close()

def save_extractions(drawing_id: int, extracted: dict):
    conf = extracted.get("confidence", {})
    conn = get_conn()
    for field, value in extracted.items():
        if field == "confidence":
            continue
        if isinstance(value, list):
            value = json.dumps(value)
        elif isinstance(value, dict):
            value = json.dumps(value)
        conn.execute(
            "INSERT INTO extractions (drawing_id, field_name, field_value, confidence) VALUES (?,?,?,?)",
            (drawing_id, field, str(value) if value is not None else None, conf.get(field))
        )
    conn.commit()
    conn.close()

def save_erp_push(drawing_id: int, payload: dict, status: str, response: str):
    conn = get_conn()
    conn.execute(
        "INSERT INTO erp_pushes (drawing_id, payload, method, status, pushed_at, response) VALUES (?,?,?,?,?,?)",
        (drawing_id, json.dumps(payload), "api", status,
         datetime.datetime.now().isoformat(), response)
    )
    conn.commit()
    conn.close()

REPORT_DIR = Path(__file__).parent.parent / "reports"


def _store_report_data(drawing_id: int, payload: dict):
    """Persist the data needed to regenerate the report on demand (so it can reflect
    later human corrections and render to HTML or PDF)."""
    REPORT_DIR.mkdir(exist_ok=True)
    (REPORT_DIR / f"{drawing_id}.json").write_text(
        json.dumps(payload, default=str), encoding="utf-8")


def _load_report_data(drawing_id: int) -> dict | None:
    path = REPORT_DIR / f"{drawing_id}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _clear_generated_data(drawing_id: int):
    """Remove stale generated output before reprocessing an existing upload."""
    conn = get_conn()
    for table in ("extractions", "exceptions", "corrections", "erp_pushes"):
        conn.execute(f"DELETE FROM {table} WHERE drawing_id=?", (drawing_id,))
    conn.execute(
        "UPDATE drawings SET status='processing', review_status='pending_review', "
        "drawing_number=NULL, project_name=NULL, drawing_title=NULL, "
        "approved_by=NULL, approved_at=NULL, summary_override=NULL "
        "WHERE id=?",
        (drawing_id,),
    )
    conn.commit()
    conn.close()
    (REPORT_DIR / f"{drawing_id}.json").unlink(missing_ok=True)


def _regeneration_target(drawing_id: int) -> dict | None:
    conn = get_conn()
    row = conn.execute(
        "SELECT id, file_name, file_path, floor_category, project_description "
        "FROM drawings WHERE id=?",
        (drawing_id,),
    ).fetchone()
    conn.close()
    if not row:
        return None
    path = Path(row[2])
    return {
        "id": row[0],
        "file_name": row[1],
        "file_path": path,
        "floor_category": row[3] or "Other",
        "project_description": row[4] or "",
        "size_mb": path.stat().st_size / (1024 * 1024) if path.exists() else 0,
    }


async def _run_regeneration_queue(targets: list[dict], strict: bool = False):
    """Regenerate stored drawings sequentially so AI/gateway capacity is not flooded."""
    for target in targets:
        drawing_id = target["id"]
        path = target["file_path"]
        if not path.exists():
            update_drawing_status(drawing_id, "error")
            job = JOBS.setdefault(drawing_id, {"lines": [], "phase": "error", "done": None})
            job["phase"] = "error"
            job["lines"].append({"text": f"Source file missing: {path}", "type": "error"})
            job["done"] = {"type": "done", "verdict": "ERROR", "drawing_id": drawing_id}
            job["ended"] = time.time()
            continue

        _clear_generated_data(drawing_id)
        JOBS[drawing_id] = {"lines": [], "phase": "streaming", "done": None}
        await _run_job(
            path,
            target["file_name"],
            drawing_id,
            target["size_mb"],
            strict,
            target["floor_category"],
            target["project_description"],
            "",
        )


def _corrections_for(drawing_id: int) -> list:
    conn = get_conn()
    rows = conn.execute(
        "SELECT field_name, original_value, corrected_value, corrected_by, corrected_at "
        "FROM corrections WHERE drawing_id=? ORDER BY corrected_at DESC", (drawing_id,)
    ).fetchall()
    conn.close()
    return [{"field": r[0], "original": r[1], "corrected": r[2], "by": r[3], "at": r[4]}
            for r in rows]


def _apply_corrections(drawing_id: int, extracted: dict) -> dict:
    """Overlay the latest human correction per field onto `extracted` (mutated and
    returned) so reports and ERP mapping reflect verified values."""
    latest = {}
    for c in _corrections_for(drawing_id):          # newest-first; keep first seen
        latest.setdefault(c["field"], c["corrected"])
    for field, value in latest.items():
        extracted[field] = value
    return extracted


def _serialize_field_value(value):
    """Normalise an edited field value to the TEXT form stored in `extractions`."""
    if value is None:
        return None
    if isinstance(value, (list, dict)):
        return json.dumps(value)
    return str(value)


def _save_fields(drawing_id: int, fields: dict, corrected_by: str) -> int:
    """Batch-save edited fields as corrections. Records an audit row + updates the
    live extraction for every field whose value actually changed. Returns the count
    of fields changed."""
    conn = get_conn()
    saved = 0
    for field_name, value in (fields or {}).items():
        if not field_name or field_name in ("confidence", "field_locations"):
            continue
        new_val = _serialize_field_value(value)
        row = conn.execute(
            "SELECT field_value FROM extractions WHERE drawing_id=? AND field_name=?",
            (drawing_id, field_name)
        ).fetchone()
        original_value = row[0] if row else None
        if (original_value or "") == (new_val or ""):
            continue                                # no-op edit — skip
        conn.execute(
            "INSERT INTO corrections (drawing_id, field_name, original_value, corrected_value, corrected_by) "
            "VALUES (?,?,?,?,?)",
            (drawing_id, field_name, original_value, new_val, corrected_by)
        )
        if row:
            conn.execute(
                "UPDATE extractions SET field_value=?, validated=1 WHERE drawing_id=? AND field_name=?",
                (new_val, drawing_id, field_name)
            )
        else:
            conn.execute(
                "INSERT INTO extractions (drawing_id, field_name, field_value, validated) VALUES (?,?,?,1)",
                (drawing_id, field_name, new_val)
            )
        saved += 1
    conn.commit()
    conn.close()
    return saved


def set_pending_review(drawing_id: int, extracted: dict):
    """Park a freshly-extracted drawing in the human verification queue."""
    conn = get_conn()
    conn.execute(
        "UPDATE drawings SET status='pending_review', review_status='pending_review', "
        "drawing_number=?, project_name=?, drawing_title=? WHERE id=?",
        (extracted.get("drawing_number"), extracted.get("project_name"),
         extracted.get("drawing_title"), drawing_id)
    )
    conn.commit()
    conn.close()


def _thumbnail_data_uri(file_path: str, max_w: int = 1000) -> str | None:
    """Render/downscale the source drawing to a clean base64 PNG preview."""
    try:
        img_set = preprocess.build_images(file_path, dpi=150)
        raw = img_set.get("full")
        if not raw:
            return None
        from PIL import Image
        import io as _io
        img = Image.open(_io.BytesIO(raw)).convert("RGB")
        if img.width > max_w:
            img = img.resize((max_w, int(img.height * max_w / img.width)), Image.LANCZOS)
        buf = _io.BytesIO()
        img.save(buf, format="PNG")
        return "data:image/png;base64," + base64.standard_b64encode(buf.getvalue()).decode()
    except Exception:
        return None


def _approval_state(drawing_id: int) -> tuple[str, str | None, str | None]:
    """(review_status, approved_by, approved_at) for a drawing; legacy rows → approved."""
    conn = get_conn()
    row = conn.execute(
        "SELECT review_status, approved_by, approved_at FROM drawings WHERE id=?",
        (drawing_id,)
    ).fetchone()
    conn.close()
    if not row:
        return "approved", None, None
    return (row[0] or "approved"), row[1], row[2]


def _rebuild_report_html(drawing_id: int) -> str | None:
    """Regenerate the per-drawing report from stored data + latest corrections.
    Renders a DRAFT banner until the drawing is approved, and uses the user's
    approved summary override when one was saved."""
    data = _load_report_data(drawing_id)
    if not data:
        return None
    extracted = _apply_corrections(drawing_id, dict(data.get("extracted") or {}))
    corrections = _corrections_for(drawing_id)
    thumb = _thumbnail_data_uri(data.get("file_path", ""))   # clean — no markings
    review_status, approved_by, approved_at = _approval_state(drawing_id)
    return generate_report(
        data.get("drawing_meta", {"drawing_id": drawing_id}), extracted, [],
        "GENERATED", data.get("elapsed", 0), data.get("erp_payload", {}),
        corrections=corrections, thumbnail_uri=thumb,
        approved=(review_status == "approved"),
        summary_override=data.get("summary_override"),
        approved_by=approved_by, approved_at=approved_at,
    )


# ── Main SSE Pipeline ─────────────────────────────────────────────────────

async def run_pipeline(file_path: Path, file_name: str, drawing_id: int,
                        file_size_mb: float, strict: bool, floor_category: str,
                        project_description: str = "", discipline: str = ""):
    start       = time.time()
    errors      = []
    warnings    = []
    extracted   = {}
    realsoft_payload = {}
    prepass_count = 0

    yield event("📁", "File received", f"{file_name} ({file_size_mb:.1f} MB) — Category: {floor_category}", "info")
    yield event("💾", "Stored", f"Saved to storage — Drawing ID: {drawing_id}", "info")

    # ── Pre-upload checks ────────────────────────────────────────────────
    yield event("🔍", "Pre-upload checks", "Verifying file format, size, and readability...", "info")

    suffix = Path(file_name).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        msg = f"Unsupported format: {suffix} | Allowed: PDF, JPG, PNG, TIFF, DWG, DXF, DWF"
        yield event("❌", "R01 FAILED", msg, "error")
        errors.append(msg)
        yield _end_failed(errors, warnings, {}, {}, drawing_id, start)
        return
    yield event("✅", "R01 PASSED", f"File format valid — {suffix.upper()} accepted", "success")

    if file_size_mb > MAX_FILE_SIZE_MB:
        msg = f"File too large: {file_size_mb:.1f}MB | Limit: {MAX_FILE_SIZE_MB}MB"
        yield event("❌", "R02 FAILED", msg, "error")
        errors.append(msg)
        yield _end_failed(errors, warnings, {}, {}, drawing_id, start)
        return
    yield event("✅", "R02 PASSED", f"File size OK — {file_size_mb:.1f}MB (limit: {MAX_FILE_SIZE_MB}MB)", "success")
    yield event("✅", "R03 PASSED", "File readable and non-empty", "success")

    # ── CAD render (DWG/DXF/DWF → image) ─────────────────────────────────
    # Construction engineers upload native CAD files. Render them to a raster so
    # the rest of the vision pipeline (blur check, extraction, thumbnail) works.
    work_path = file_path
    if cad_convert.is_cad(suffix):
        yield event("📐", "CAD drawing", f"{suffix[1:].upper()} vector file — rendering to high-resolution image...", "info")
        cad = cad_convert.convert_to_png(str(file_path), STORAGE_DIR)
        if not cad.ok:
            yield event("❌", "CAD CONVERSION FAILED", cad.reason, "error")
            errors.append(cad.reason)
            yield _end_failed(errors, warnings, {}, {}, drawing_id, start)
            return
        work_path = Path(cad.png_path)
        note = f" · {len(cad.text_hints)} text labels found" if cad.text_hints else ""
        yield event("✅", "CAD rendered", f"Vector drawing converted to image (via {cad.converter}){note}", "success")

    # ── Image quality (blur) check ───────────────────────────────────────
    # Skip for CAD: a rendered vector drawing is sharp by construction, so the
    # photo/scan blur gate would only risk false rejections of sparse drawings.
    if cad_convert.is_cad(suffix):
        yield event("✅", "Blur Check", "Skipped — vector CAD render is sharp by construction", "success")
    else:
        score = preprocess.sharpness_score(str(work_path))
        threshold = float(os.getenv("BLUR_THRESHOLD", "100"))
        if score is not None and score < threshold:
            msg = ("Uploaded image is too blurry for report generation — "
                   "please re-upload a clearer scan or photo.")
            yield event("❌", "BLUR CHECK FAILED",
                        f"{msg} (sharpness {score:.0f} < {threshold:.0f})", "error")
            errors.append(msg)
            yield _end_failed(errors, warnings, {}, {}, drawing_id, start, status="blurred")
            return
        yield event("✅", "Blur Check",
                    f"Image sharp enough (sharpness {score:.0f})" if score is not None
                    else "Blur check skipped (OpenCV unavailable)", "success")

    # ── Pre-pass (PDF text layer) ────────────────────────────────────────
    if suffix == ".pdf":
        yield event("🔎", "Pre-pass", "Scanning PDF text layer for title block fields (free extraction)...", "info")
        # prepass happens inside extract_drawing_with_prepass — results reported after

    # ── AI Extraction ────────────────────────────────────────────────────
    yield event("🤖", "AI Vision", "Sending drawing for intelligent field extraction...", "info")
    yield event("⏳", "AI Processing", "Reading title block, floor plan, dimensions, materials, stamps...", "info")

    try:
        extracted, prepass_hints = await asyncio.wait_for(
            asyncio.get_event_loop().run_in_executor(
                None,
                lambda: extract_drawing_with_prepass(
                    str(work_path), floor_category, file_name, project_description, discipline
                ),
            ),
            timeout=VISION_EXTRACT_TIMEOUT
        )
        prepass_count = len(prepass_hints)
    except asyncio.TimeoutError:
        msg = f"AI extraction timed out (>{int(EXTRACT_TIMEOUT)}s) — drawing saved, please retry"
        yield event("⏱️", "Timeout", msg, "error")
        update_drawing_status(drawing_id, "timeout")
        yield f"data: {json.dumps({'type': 'done', 'verdict': 'TIMEOUT'})}\n\n"
        return
    except Exception as e:
        msg = f"AI extraction failed: {str(e)}"
        yield event("❌", "AI Error", msg, "error")
        update_drawing_status(drawing_id, "error")
        yield f"data: {json.dumps({'type': 'done', 'verdict': 'ERROR'})}\n\n"
        return

    if prepass_count:
        yield event("✅", "Pre-pass", f"{prepass_count} fields extracted from PDF text layer (high confidence)", "success")

    field_count = sum(1 for k, v in extracted.items()
                      if k != "confidence" and v not in (None, [], ""))
    yield event("✅", "AI Extraction Complete",
                f"{field_count} fields extracted — project: {extracted.get('project_name', '—')}", "success")
    save_extractions(drawing_id, extracted)

    # ── Build Bill of Quantities ─────────────────────────────────────────
    # The deliverable is extraction + BOQ generation; no drawing-compliance review is run.
    boq = [b for b in (extracted.get("boq_items") or []) if isinstance(b, dict)]
    sections = []
    for it in boq:
        s = (it.get("section") or "General").strip() or "General"
        if s not in sections:
            sections.append(s)
    yield event("📐", "Bill of Quantities",
                f"Generated {len(boq)} BOQ line item(s) across {len(sections)} trade section(s)"
                + (f": {', '.join(sections)}" if sections else ""), "success")

    # ── Map to RealSoft Format (title block + BOQ) ───────────────────────
    yield event("🗺️ ", "ERP Mapping", "Converting title block + BOQ to RealSoft ERP format...", "info")
    avg_conf = average_confidence(extracted)
    realsoft_payload = map_to_realsoft(extracted, drawing_id, file_name, "GENERATED", avg_conf,
                                       project_description)
    gw_data = gateway_erp_map(extracted)
    if gw_data:
        realsoft_payload["data"] = gw_data
        realsoft_payload["metadata"]["mapping_source"] = "gateway"
        yield event("✅", "ERP Mapping (Gateway)", "Mapped via Printo Gateway (ERP_MAP)", "success")
    else:
        realsoft_payload["metadata"]["mapping_source"] = "local"
        yield event("✅", "Mapping Complete",
                    f"JSON payload ready — module: {realsoft_payload.get('module', 'DrawingMaster')}", "success")

    # Mapping is a PREVIEW — the actual ERP push happens at approval time
    # (POST /drawings/{id}/approve), after the user reviews/edits the BOQ.

    # ── Stage for review (review/edit the BOQ, then approve to push) ──────
    elapsed = round(time.time() - start, 1)
    drawing_meta = {
        "file_name":           file_name,
        "drawing_id":          drawing_id,
        "floor_category":      floor_category,
        "discipline":          discipline,
        "project_description": project_description,
        "uploaded_at":         datetime.datetime.now().isoformat(),
    }
    _store_report_data(drawing_id, {
        "drawing_meta":  drawing_meta,
        "extracted":     extracted,
        "verdict":       "GENERATED",
        "elapsed":       elapsed,
        "erp_payload":   realsoft_payload,
        "file_path":     str(file_path),
    })
    set_pending_review(drawing_id, extracted)
    yield event("🧐", "Review BOQ",
                "BOQ ready — review/edit the quantities, then approve to push to ERP", "info")
    yield event("🏁", "Ready for Review",
                f"BOQ generated in {elapsed}s — {len(boq)} line items across {len(sections)} sections", "done")

    yield "data: " + json.dumps({
        "type":             "done",
        "verdict":          "GENERATED",
        "elapsed":          elapsed,
        "errors":           [],
        "warnings":         [],
        "boq_count":        len(boq),
        "sections":         sections,
        "extracted":        extracted,
        "realsoft_payload": realsoft_payload,
        "erp_status":       "pending",
        "needs_review":     True,
        "review_status":    "pending_review",
        "drawing_id":       drawing_id,
        "prepass_count":    prepass_count,
    }) + "\n\n"


def _end_failed(errors, warnings, extracted, payload, drawing_id, start, status="error") -> str:
    update_drawing_status(drawing_id, status)
    elapsed = round(time.time() - start, 1)
    return f"data: {json.dumps({'type': 'done', 'verdict': 'FAILED', 'elapsed': elapsed, 'errors': errors, 'warnings': warnings, 'extracted': extracted, 'realsoft_payload': payload, 'drawing_id': drawing_id})}\n\n"


# ── Endpoints ─────────────────────────────────────────────────────────────

@app.post("/upload/chunk")
def upload_chunk(
    upload_id: str = Form(...),
    index: int = Form(...),
    chunk: UploadFile = File(...),
    _user: dict = Depends(require_auth),
):
    """Append one ordered chunk of a large upload. index 0 starts a fresh file.

    Sync def on purpose: FastAPI runs it in the threadpool so the synchronous disk
    write never blocks the single worker's event loop while other requests (the
    next chunk, health, review) are in flight.
    """
    part = CHUNK_DIR / f"{_safe_upload_id(upload_id)}.part"
    with open(part, "wb" if index == 0 else "ab") as f:
        shutil.copyfileobj(chunk.file, f)
    return {"ok": True, "index": index, "bytes": part.stat().st_size}


@app.post("/upload")
async def upload_drawing(
    file: UploadFile | None = File(default=None),
    upload_id: str | None = Form(default=None),
    file_name: str | None = Form(default=None),
    floor_category: str = Form(default="Other"),
    project_description: str = Form(default=""),
    discipline: str = Form(default=""),
    strict: bool = False,
    _user: dict = Depends(require_auth),
):
    # Two sources: a direct small-file upload, or an assembled chunked upload.
    if upload_id:
        part = CHUNK_DIR / f"{_safe_upload_id(upload_id)}.part"
        if not part.exists() or part.stat().st_size == 0:
            raise HTTPException(400, "No uploaded chunks found for this upload id")
        display_name = file_name or "upload.bin"
        suffix = Path(display_name).suffix.lower()
        if suffix not in ALLOWED_EXTENSIONS:
            part.unlink(missing_ok=True)
            raise HTTPException(
                400,
                f"Unsupported file type: {suffix} | Allowed: PDF, JPG, PNG, TIFF, DWG, DXF, DWF",
            )
        dest = STORAGE_DIR / f"{uuid.uuid4().hex}{suffix}"
        shutil.move(str(part), str(dest))
    elif file is not None:
        display_name = file.filename
        suffix = Path(display_name).suffix.lower()
        if suffix not in ALLOWED_EXTENSIONS:
            raise HTTPException(
                400,
                f"Unsupported file type: {suffix} | Allowed: PDF, JPG, PNG, TIFF, DWG, DXF, DWF",
            )
        dest = STORAGE_DIR / f"{uuid.uuid4().hex}{suffix}"
        with open(dest, "wb") as f:
            shutil.copyfileobj(file.file, f)
    else:
        raise HTTPException(400, "No file or upload_id provided")

    size_mb    = dest.stat().st_size / (1024 * 1024)
    drawing_id = save_drawing_record(display_name, dest, floor_category, project_description)

    # Run the (minutes-long) pipeline in the background; the client polls
    # GET /drawings/{id}/events. Returns immediately so no request hits the 300s cap.
    _prune_jobs()
    JOBS[drawing_id] = {"lines": [], "phase": "streaming", "done": None}
    asyncio.create_task(_run_job(dest, display_name, drawing_id, size_mb, strict,
                                 floor_category, project_description, discipline))
    return {"drawing_id": drawing_id, "status": "processing"}


@app.get("/drawings/{drawing_id:int}/events")
def drawing_events(drawing_id: int, since: int = 0, _user: dict = Depends(require_auth)):
    """Poll a background extraction job: new step-log lines + terminal done payload.
    Falls back to stored DB/report state if the in-memory job is gone (restart)."""
    job = JOBS.get(drawing_id)
    if job is not None:
        lines = job["lines"]
        return {"lines": lines[since:], "next": len(lines),
                "phase": job["phase"], "done": job["done"]}

    conn = get_conn()
    row = conn.execute(
        "SELECT status, review_status FROM drawings WHERE id=?", (drawing_id,)
    ).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "Drawing not found")
    status = row[0] or ""
    if status in ("pending_review", "approved", "done", "error", "blurred", "timeout"):
        verdict = "GENERATED" if status in ("pending_review", "approved", "done") else status.upper()
        return {"lines": [], "next": since, "phase": "done",
                "done": {"type": "done", "verdict": verdict, "drawing_id": drawing_id,
                         "review_status": row[1] or "pending_review"}}
    # 'processing' but no live job → orphaned by a worker restart.
    return {"lines": [], "next": since, "phase": "error",
            "done": {"type": "done", "verdict": "ERROR", "drawing_id": drawing_id},
            "detail": "Processing was interrupted — please re-upload."}


@app.get("/drawings")
def list_drawings(_user: dict = Depends(require_auth)):
    conn = get_conn()
    rows = conn.execute(
        "SELECT id, file_name, uploaded_at, status, drawing_number, drawing_title, project_name, floor_category "
        "FROM drawings ORDER BY id DESC"
    ).fetchall()
    conn.close()
    return [
        {"id": r[0], "file_name": r[1], "uploaded_at": r[2], "status": r[3],
         "drawing_number": r[4], "drawing_title": r[5], "project_name": r[6],
         "floor_category": r[7]}
        for r in rows
    ]


@app.post("/drawings/regenerate-all")
async def regenerate_all_drawings(strict: bool = False, _user: dict = Depends(require_auth)):
    """Re-run extraction/report generation for every stored upload.

    Existing generated rows and report JSON are cleared per drawing immediately
    before that drawing is reprocessed. The queue runs sequentially in the
    background; clients can poll /drawings/{id}/events for individual progress.
    """
    conn = get_conn()
    ids = [r[0] for r in conn.execute("SELECT id FROM drawings ORDER BY id").fetchall()]
    conn.close()
    targets = []
    missing = []
    busy = []
    for drawing_id in ids:
        if drawing_id in JOBS and JOBS[drawing_id].get("phase") == "streaming":
            busy.append(drawing_id)
            continue
        target = _regeneration_target(drawing_id)
        if not target:
            continue
        if not target["file_path"].exists():
            missing.append(drawing_id)
        targets.append(target)
    if not targets:
        return {"queued": 0, "drawing_ids": [], "missing_source_ids": missing, "busy_ids": busy}

    _prune_jobs()
    for target in targets:
        JOBS[target["id"]] = {
            "lines": [{"text": "Queued for report regeneration", "type": "info"}],
            "phase": "queued",
            "done": None,
        }
    asyncio.create_task(_run_regeneration_queue(targets, strict))
    return {
        "queued": len(targets),
        "drawing_ids": [t["id"] for t in targets],
        "missing_source_ids": missing,
        "busy_ids": busy,
    }


@app.post("/drawings/{drawing_id:int}/regenerate")
async def regenerate_drawing(drawing_id: int, strict: bool = False,
                             _user: dict = Depends(require_auth)):
    """Re-run extraction/report generation for one stored upload."""
    if drawing_id in JOBS and JOBS[drawing_id].get("phase") == "streaming":
        raise HTTPException(409, "Drawing is already processing")
    target = _regeneration_target(drawing_id)
    if not target:
        raise HTTPException(404, "Drawing not found")
    if not target["file_path"].exists():
        raise HTTPException(404, f"Source file missing: {target['file_path']}")

    _prune_jobs()
    JOBS[drawing_id] = {
        "lines": [{"text": "Queued for report regeneration", "type": "info"}],
        "phase": "queued",
        "done": None,
    }
    asyncio.create_task(_run_regeneration_queue([target], strict))
    return {"queued": True, "drawing_id": drawing_id}


@app.get("/drawings/{drawing_id}")
def get_drawing(drawing_id: int, _user: dict = Depends(require_auth)):
    conn = get_conn()
    row = conn.execute("SELECT * FROM drawings WHERE id=?", (drawing_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Drawing not found")
    fields = conn.execute(
        "SELECT field_name, field_value, confidence, validated, flagged FROM extractions WHERE drawing_id=?",
        (drawing_id,)
    ).fetchall()
    pushes = conn.execute(
        "SELECT method, status, pushed_at, response FROM erp_pushes WHERE drawing_id=?",
        (drawing_id,)
    ).fetchall()
    corrections = conn.execute(
        "SELECT field_name, original_value, corrected_value, corrected_by, corrected_at "
        "FROM corrections WHERE drawing_id=? ORDER BY corrected_at DESC",
        (drawing_id,)
    ).fetchall()
    conn.close()
    return {
        "drawing":    dict(zip(
            ["id", "file_name", "file_path", "uploaded_at", "status",
             "drawing_number", "drawing_title", "project_name", "floor_category"], row
        )),
        "extractions": [{"field": f[0], "value": f[1], "confidence": f[2]} for f in fields],
        "erp_pushes":  [{"method": p[0], "status": p[1], "pushed_at": p[2]} for p in pushes],
        "corrections": [{"field": c[0], "original": c[1], "corrected": c[2],
                         "by": c[3], "at": c[4]} for c in corrections],
    }


@app.patch("/drawings/{drawing_id}/correction")
def save_correction(drawing_id: int, body: dict, _user: dict = Depends(require_auth)):
    field_name      = body.get("field_name")
    corrected_value = body.get("corrected_value")
    corrected_by    = body.get("corrected_by", "user")
    if not field_name:
        raise HTTPException(400, "field_name required")

    conn = get_conn()
    orig = conn.execute(
        "SELECT field_value FROM extractions WHERE drawing_id=? AND field_name=?",
        (drawing_id, field_name)
    ).fetchone()
    original_value = orig[0] if orig else None

    conn.execute(
        "INSERT INTO corrections (drawing_id, field_name, original_value, corrected_value, corrected_by) "
        "VALUES (?,?,?,?,?)",
        (drawing_id, field_name, original_value, corrected_value, corrected_by)
    )
    conn.execute(
        "UPDATE extractions SET field_value=?, validated=1 WHERE drawing_id=? AND field_name=?",
        (corrected_value, drawing_id, field_name)
    )
    conn.commit()
    conn.close()
    return {"message": f"Correction saved for {field_name}"}


# ── Human-in-the-loop verification: review → edit → approve ────────────────────

@app.get("/drawings/{drawing_id}/review")
def get_review(drawing_id: int, _user: dict = Depends(require_auth)):
    """Everything the BOQ review screen needs: extracted fields, BOQ rows, an
    editable summary, the ERP payload preview, source thumbnail, and approval state."""
    conn = get_conn()
    row = conn.execute(
        "SELECT file_name, status, review_status, approved_by, approved_at, summary_override "
        "FROM drawings WHERE id=?", (drawing_id,)
    ).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "Drawing not found")

    review_status = row[2] or "approved"
    data = _load_report_data(drawing_id)
    if not data:
        # Processed but no report payload (e.g. failed pre-checks) — return the shell.
        return {
            "drawing_id": drawing_id, "file_name": row[0], "status": row[1],
            "review_status": review_status, "approved_by": row[3], "approved_at": row[4],
            "verdict": None, "elapsed": 0, "extracted": {}, "summary_draft": "",
            "summary_override": row[5], "erp_payload": {}, "thumbnail_uri": None,
        }

    extracted = _apply_corrections(drawing_id, dict(data.get("extracted") or {}))
    thumb = _thumbnail_data_uri(data.get("file_path", ""))   # clean image — no markings
    summary_draft = plain_summary(data.get("drawing_meta", {}), extracted)
    return {
        "drawing_id":       drawing_id,
        "file_name":        row[0],
        "status":           row[1],
        "review_status":    review_status,
        "approved_by":      row[3],
        "approved_at":      row[4],
        "verdict":          "GENERATED",
        "elapsed":          data.get("elapsed", 0),
        "extracted":        extracted,
        "boq_items":        extracted.get("boq_items") or [],
        "project_description": (data.get("drawing_meta") or {}).get("project_description", ""),
        "summary_draft":    summary_draft,
        "summary_override": data.get("summary_override") or row[5],
        "erp_payload":      data.get("erp_payload", {}),
        "thumbnail_uri":    thumb,
    }


@app.put("/drawings/{drawing_id}/fields")
def save_fields(drawing_id: int, body: dict, user: dict = Depends(require_auth)):
    """Batch-save edited fields (cross-verification 'Save Draft')."""
    fields = body.get("fields")
    if not isinstance(fields, dict):
        raise HTTPException(400, "Body must include a 'fields' object")
    corrected_by = body.get("corrected_by") or user.get("username") or "user"
    n = _save_fields(drawing_id, fields, corrected_by)

    # Persist an edited BOQ (full replacement) into the stored report data.
    if isinstance(body.get("boq_items"), list):
        data = _load_report_data(drawing_id)
        if data:
            extracted = dict(data.get("extracted") or {})
            extracted["boq_items"] = body["boq_items"]
            data["extracted"] = extracted
            _store_report_data(drawing_id, data)

    return {"message": f"Saved {n} field edit(s) + BOQ", "saved": n}


@app.post("/drawings/{drawing_id}/approve")
def approve_drawing(drawing_id: int, body: dict, user: dict = Depends(require_auth)):
    """Finalize a reviewed drawing: persist any last edits, re-map and push the
    verified data to ERP, store the approved summary, and unlock the final report."""
    data = _load_report_data(drawing_id)
    if not data:
        raise HTTPException(404, "Nothing to approve — process the drawing first")

    approved_by = body.get("approved_by") or user.get("username") or "user"
    summary_override = body.get("summary_override")
    fields = body.get("fields")
    if isinstance(fields, dict):
        _save_fields(drawing_id, fields, approved_by)

    extracted = _apply_corrections(drawing_id, dict(data.get("extracted") or {}))
    # Apply any edited BOQ from the review screen (full replacement list).
    if isinstance(body.get("boq_items"), list):
        extracted["boq_items"] = body["boq_items"]

    # Re-map to ERP on the reviewed data, then push (or simulate).
    _meta = data.get("drawing_meta") or {}
    file_name = _meta.get("file_name", "")
    project_description = _meta.get("project_description", "")
    avg_conf = average_confidence(extracted)
    realsoft_payload = map_to_realsoft(extracted, drawing_id, file_name, "GENERATED", avg_conf,
                                       project_description)
    gw_data = gateway_erp_map(extracted)
    if gw_data:
        realsoft_payload["data"] = gw_data
        realsoft_payload["metadata"]["mapping_source"] = "gateway"
    else:
        realsoft_payload["metadata"]["mapping_source"] = "local"

    erp_status, erp_message = "simulated", "Simulation mode — no ERP credentials"
    if _erp_configured:
        try:
            api_response = push_to_realsoft(realsoft_payload)
            save_erp_push(drawing_id, realsoft_payload, "sent", json.dumps(api_response))
            erp_status = "sent"
            erp_message = f"RealSoft responded: HTTP {api_response.get('status_code')}"
        except RealSoftAPIError as e:
            save_erp_push(drawing_id, realsoft_payload, "failed", str(e))
            erp_status, erp_message = "failed", str(e)
    else:
        save_erp_push(drawing_id, realsoft_payload, "simulated", erp_message)

    approved_at = datetime.datetime.now().isoformat()
    data["extracted"]        = extracted
    data["verdict"]          = "GENERATED"
    data["erp_payload"]      = realsoft_payload
    data["summary_override"] = summary_override
    data["approved_by"]      = approved_by
    data["approved_at"]      = approved_at
    _store_report_data(drawing_id, data)

    conn = get_conn()
    conn.execute(
        "UPDATE drawings SET review_status='approved', approved_by=?, approved_at=?, "
        "summary_override=?, status='done' WHERE id=?",
        (approved_by, approved_at, summary_override, drawing_id)
    )
    conn.commit()
    conn.close()
    return {
        "message":      "BOQ approved & pushed",
        "drawing_id":   drawing_id,
        "verdict":      "GENERATED",
        "erp_status":   erp_status,
        "erp_message":  erp_message,
        "approved_by":  approved_by,
        "approved_at":  approved_at,
    }


@app.post("/drawings/{drawing_id}/reopen")
def reopen_drawing(drawing_id: int, _user: dict = Depends(require_auth)):
    """Send an approved drawing back to 'pending_review' so it can be edited again."""
    conn = get_conn()
    row = conn.execute("SELECT id FROM drawings WHERE id=?", (drawing_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Drawing not found")
    conn.execute(
        "UPDATE drawings SET review_status='pending_review', status='pending_review', "
        "approved_by=NULL, approved_at=NULL WHERE id=?", (drawing_id,)
    )
    conn.commit()
    conn.close()
    return {"message": "Reopened for editing", "drawing_id": drawing_id,
            "review_status": "pending_review"}


def _all_drawings_for_project_report() -> list:
    """Gather drawings + per-drawing average confidence for the aggregate report."""
    conn = get_conn()
    rows = conn.execute(
        "SELECT id, drawing_number, drawing_title, project_name, floor_category, status "
        "FROM drawings ORDER BY id"
    ).fetchall()
    out = []
    for r in rows:
        avg = conn.execute(
            "SELECT AVG(confidence) FROM extractions WHERE drawing_id=? AND confidence IS NOT NULL",
            (r[0],)
        ).fetchone()[0]
        out.append({"id": r[0], "drawing_number": r[1], "drawing_title": r[2],
                    "project_name": r[3], "floor_category": r[4], "status": r[5],
                    "avg_conf": avg})
    conn.close()
    return out


@app.get("/report/project", response_class=HTMLResponse)
def get_project_report(_user: dict = Depends(require_auth)):
    return HTMLResponse(content=generate_project_report(_all_drawings_for_project_report()))


@app.get("/report/project/pdf")
def get_project_report_pdf(_user: dict = Depends(require_auth)):
    pdf = html_to_pdf_bytes(generate_project_report(_all_drawings_for_project_report()))
    if not pdf:
        raise HTTPException(500, "PDF generation failed")
    return StreamingResponse(
        io.BytesIO(pdf), media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="erp_realsoft_project_report.pdf"'})


@app.get("/report/{drawing_id}", response_class=HTMLResponse)
def get_report(drawing_id: int, _user: dict = Depends(require_auth)):
    html = _rebuild_report_html(drawing_id)
    if html is None:
        raise HTTPException(404, "Report not yet generated — process the drawing first")
    return HTMLResponse(content=html)


@app.get("/report/{drawing_id}/pdf")
def get_report_pdf(drawing_id: int, _user: dict = Depends(require_auth)):
    html = _rebuild_report_html(drawing_id)
    if html is None:
        raise HTTPException(404, "Report not yet generated — process the drawing first")
    pdf = html_to_pdf_bytes(html)
    if not pdf:
        raise HTTPException(500, "PDF generation failed")
    return StreamingResponse(
        io.BytesIO(pdf), media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="erp_realsoft_report_{drawing_id}.pdf"'})


@app.get("/export/{drawing_id:int}/excel")
def export_excel(drawing_id: int, _user: dict = Depends(require_auth)):
    """Industry-format Bill of Quantities workbook for one drawing.

    Cover -> one Bill sheet per trade section (Item/Description/Reference/Unit/
    Qty/Rate/Amount with live formulas) -> Summary of Bills (cross-sheet totals,
    contingency, VAT, grand total). Built from the same stored report data + human
    corrections that drive the PDF, so the two deliverables always agree.
    """
    data = _load_report_data(drawing_id)
    if not data:
        raise HTTPException(404, "BOQ not yet generated — process the drawing first")

    extracted = _apply_corrections(drawing_id, dict(data.get("extracted") or {}))
    data = {**data, "extracted": extracted}
    review_status, approved_by, approved_at = _approval_state(drawing_id)

    xlsx = build_boq_workbook(
        data, approved=(review_status == "approved"),
        approved_by=approved_by, approved_at=approved_at,
    )
    dno = (extracted.get("drawing_number") or f"drawing_{drawing_id}")
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", str(dno)).strip("_") or f"drawing_{drawing_id}"
    return StreamingResponse(
        io.BytesIO(xlsx),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="BOQ_{safe}.xlsx"'},
    )


# ── RealSoft ERP — connection test, manual transfer, history ────────────────
REALSOFT_MODULE = os.getenv("REALSOFT_MODULE", "DrawingMaster")


def _mask_base_url(url: str | None) -> str:
    """Return scheme://host[:port] only — never expose any embedded credentials."""
    if not url:
        return ""
    try:
        from urllib.parse import urlparse
        p = urlparse(url)
        if not p.hostname:
            return url
        return f"{p.scheme}://{p.hostname}" + (f":{p.port}" if p.port else "")
    except Exception:
        return url


def _push_one(drawing_id: int) -> dict:
    """(Re)send a single drawing's stored ERP payload to RealSoft, recording the
    attempt in erp_pushes. Falls back to 'simulated' when no real credentials are
    configured, matching the upload pipeline's behaviour."""
    data = _load_report_data(drawing_id)
    if not data or not data.get("erp_payload"):
        return {"drawing_id": drawing_id, "status": "skipped",
                "message": "No report payload — process the drawing first"}
    payload = data["erp_payload"]

    if not _erp_configured:
        save_erp_push(drawing_id, payload, "simulated", "Simulation mode — no ERP credentials")
        return {"drawing_id": drawing_id, "status": "simulated",
                "message": "RealSoft credentials not configured — recorded as simulation"}

    try:
        resp = push_to_realsoft(payload)
        save_erp_push(drawing_id, payload, "sent", json.dumps(resp))
        return {"drawing_id": drawing_id, "status": "sent",
                "status_code": resp.get("status_code"),
                "pushed_at": resp.get("pushed_at"),
                "message": f"Sent — RealSoft responded HTTP {resp.get('status_code')}"}
    except RealSoftAPIError as e:
        save_erp_push(drawing_id, payload, "failed", str(e))
        return {"drawing_id": drawing_id, "status": "failed", "message": str(e)}


def _list_erp_pushes() -> list[dict]:
    """Latest ERP push per drawing, joined with the drawing's file/project."""
    conn = get_conn()
    rows = conn.execute(
        "SELECT e.id, e.drawing_id, d.file_name, d.project_name, e.status, e.pushed_at, e.response "
        "FROM erp_pushes e LEFT JOIN drawings d ON d.id = e.drawing_id "
        "WHERE e.id IN (SELECT MAX(id) FROM erp_pushes GROUP BY drawing_id) "
        "ORDER BY e.id DESC"
    ).fetchall()
    conn.close()
    return [
        {"id": rid, "drawing_id": did, "file_name": fname, "project_name": project,
         "status": status, "pushed_at": pushed_at, "response_summary": (response or "")[:160]}
        for rid, did, fname, project, status, pushed_at, response in rows
    ]


@app.get("/erp/status")
async def erp_status(_user: dict = Depends(require_auth)):
    """Connection link/test for the RealSoft API."""
    reachable = False
    if _erp_configured:
        reachable = await asyncio.get_event_loop().run_in_executor(None, ping_realsoft)
    return {
        "configured": _erp_configured,
        "reachable":  reachable,
        "base_url":   _mask_base_url(os.getenv("REALSOFT_BASE_URL")),
        "module":     REALSOFT_MODULE,
        "mode":       "live" if _erp_configured else "simulation",
    }


@app.post("/erp/push/{drawing_id:int}")
async def erp_push(drawing_id: int, _user: dict = Depends(require_auth)):
    """Manually (re)send one drawing's report to RealSoft — also used to retry failures."""
    result = await asyncio.get_event_loop().run_in_executor(None, _push_one, drawing_id)
    if result["status"] == "skipped":
        raise HTTPException(404, result["message"])
    return result


@app.post("/erp/push-all")
async def erp_push_all(only: str = "all", _user: dict = Depends(require_auth)):
    """Bulk transfer stored reports to RealSoft. only = all | failed | pending."""
    conn = get_conn()
    rows = conn.execute(
        "SELECT d.id, (SELECT status FROM erp_pushes e WHERE e.drawing_id = d.id "
        "ORDER BY e.id DESC LIMIT 1) AS last_status FROM drawings d ORDER BY d.id"
    ).fetchall()
    conn.close()

    targets = []
    for did, last_status in rows:
        if _load_report_data(did) is None:
            continue
        if only == "failed" and last_status != "failed":
            continue
        if only == "pending" and last_status == "sent":
            continue
        targets.append(did)

    results = []
    loop = asyncio.get_event_loop()
    for did in targets:
        results.append(await loop.run_in_executor(None, _push_one, did))

    summary = {"total": len(results), "sent": 0, "failed": 0, "simulated": 0, "results": results}
    for r in results:
        if r["status"] in summary:
            summary[r["status"]] += 1
    return summary


@app.get("/erp/pushes")
def erp_pushes(_user: dict = Depends(require_auth)):
    """ERP push history — latest attempt per drawing."""
    return _list_erp_pushes()


@app.get("/export/project/excel")
def export_project_excel(_user: dict = Depends(require_auth)):
    """Combined BOQ workbook across every drawing: an Overview sheet + one
    consolidated, filterable line-item sheet (Drawing/Section/Item/Description/
    Unit/Qty/Rate/Amount) so a whole portfolio can be priced in one place."""
    conn = get_conn()
    rows = conn.execute(
        "SELECT id, file_name, project_name, drawing_number, drawing_title, floor_category "
        "FROM drawings ORDER BY id"
    ).fetchall()
    conn.close()

    drawings = []
    for did, fname, project, dno, dtitle, floor in rows:
        data = _load_report_data(did)
        if data:
            extracted = _apply_corrections(did, dict(data.get("extracted") or {}))
        else:
            extracted = {"drawing_number": dno, "drawing_title": dtitle,
                         "project_name": project}
        drawings.append({
            "id": did, "file_name": fname, "floor_category": floor,
            "extracted": extracted,
        })

    xlsx = build_project_workbook(drawings)
    return StreamingResponse(
        io.BytesIO(xlsx),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="Project_BOQ.xlsx"'},
    )


@app.get("/health")
def health():
    realsoft_reachable = ping_realsoft() if _erp_configured else False
    conn = get_conn()
    total = conn.execute("SELECT COUNT(*) FROM drawings").fetchone()[0]
    done  = conn.execute("SELECT COUNT(*) FROM drawings WHERE status='done'").fetchone()[0]
    conn.close()

    ai = provider_status()   # {ai_provider, sidecar_reachable, mode, model, ...}
    return {
        "status":             "ok",
        "version":            "2.1.0",
        "total_drawings":     total,
        "completed":          done,
        "erp_mode":           "live" if _erp_configured else "simulation",
        # AI extraction provider (sidecar | mock)
        "ai_provider":        ai.get("ai_provider"),
        "ai_mode":            ai.get("mode"),
        "ai_model":           ai.get("model"),
        "sidecar_reachable":  ai.get("sidecar_reachable"),
        "mock_extraction":    ai.get("ai_provider") == "mock",
        "realsoft_reachable": realsoft_reachable,
        "realsoft_url":       os.getenv("REALSOFT_BASE_URL", "not configured"),
    }
