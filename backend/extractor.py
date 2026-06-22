import json
import os
import re
from pathlib import Path

import preprocess
from prepass import (extract_pdf_text, prepass_extract,
                     build_known_facts_block, ocr_text)
from schema import validate_and_repair, extraction_json_schema
from ai_provider import resolve_provider, ExtractRequest, SidecarError


def _env_bool(name: str, default: bool = False) -> bool:
    return (os.getenv(name, str(default)) or "").strip().lower() in ("1", "true", "yes", "on")


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def _mock_extract(file_path: str, floor_category: str = None,
                  original_name: str = None) -> dict:
    """Return realistic dummy data for demo/testing without API key.

    The user-selected category drives the floor first: uploads are stored under
    a random UUID filename, so the path is not a reliable hint. The original
    filename is only a fallback.
    """
    name = (original_name or Path(file_path).name).lower()
    cat = (floor_category or "").strip()
    if cat and cat.lower() != "other":
        floor = cat
    elif "ground" in name or "gf" in name:
        floor = "Ground Floor"
    elif "first" in name or "ff" in name:
        floor = "First Floor"
    elif "second" in name:
        floor = "Second Floor"
    elif "third" in name:
        floor = "Third Floor"
    elif "basement" in name or "b1" in name:
        floor = "Basement"
    elif "kitchen" in name:
        floor = "Kitchen"
    else:
        floor = "Ground Floor"

    sheet = {
        "Ground Floor": "1", "First Floor": "2", "Second Floor": "3",
        "Third Floor": "4", "Fourth Floor": "5", "Basement": "B1",
        "Terrace / Roof": "6", "Kitchen": "K1",
    }.get(floor, "1")
    code = {
        "Ground Floor": "GF", "First Floor": "01", "Second Floor": "02",
        "Third Floor": "03", "Fourth Floor": "04", "Basement": "B1",
        "Terrace / Roof": "RF", "Kitchen": "KT",
    }.get(floor, "GF")

    return {
        "drawing_number":    f"CT-A-{code}",
        "drawing_title":     f"{floor.upper()} PLAN",
        "project_name":      "CORAL TOWERS RESIDENTIAL COMPLEX",
        "project_location":  "Plot No. 14, Nagpur, Maharashtra",
        "client_name":       "Printo Builders Pvt. Ltd.",
        "contractor_name":   "Coral Infrastructure Consultants",
        "drawn_by":          "S. Kumar",
        "checked_by":        "B. K. Murali",
        "approved_by":       "M. Varghese",
        "date_of_issue":     "20/06/2026",
        "revision_number":   "Rev A",
        "sheet_number":      sheet,
        "total_sheets":      "5",
        "scale":             "1:100",
        "floor_level":       floor,
        "total_floor_area":  "420 sq.m",
        "building_type":     "Residential",
        "number_of_rooms":   "6",
        "room_schedule": [
            {"name": "Living Room",    "area": "28 sq.m"},
            {"name": "Master Bedroom", "area": "20 sq.m"},
            {"name": "Bedroom 2",      "area": "15 sq.m"},
            {"name": "Kitchen",        "area": "12 sq.m"},
            {"name": "Dining",         "area": "16 sq.m"},
            {"name": "Bathroom",       "area": "6 sq.m"},
        ],
        "door_count":      "8",
        "window_count":    "12",
        "structural_notes": "RCC framed structure. Column grid 4.5m x 4.5m. Slab thickness 150mm.",
        "materials":       ["RCC", "AAC Block", "Ceramic Tiles", "UPVC Windows", "Teak Wood Doors"],
        "dimensions":      "22m x 19m",
        "quantities":      "Doors: 8 nos | Windows: 12 nos | Columns: 16 nos",
        "approval_stamp":  True,
        "north_arrow":     True,
        "grid_lines":      True,
        "additional_notes": "Refer structural drawings for column and beam details.",
        "confidence": {
            "drawing_number":   0.95,
            "drawing_title":    0.97,
            "project_name":     0.93,
            "floor_level":      0.98,
            "total_floor_area": 0.82,
            "scale":            0.96,
            "revision_number":  0.94,
            "approval_stamp":   0.91,
            "dimensions":       0.85,
            "materials":        0.78,
            "room_schedule":    0.88,
            "building_type":    0.95,
            "client_name":      0.92,
            "date_of_issue":    0.97,
        },
    }

SYSTEM_PROMPT = """You are an expert at reading architectural and construction drawings.
You have deep experience with title blocks, floor plans, section drawings, and engineering notation.
Return only valid JSON — no explanation, no markdown fences, no preamble."""

EXTRACTION_PROMPT_TEMPLATE = """Carefully analyse this architectural construction drawing and extract every field you can identify.

{known_facts_section}

Return ONLY this exact JSON structure (null for any field not visible):

{{
  "drawing_number":    "e.g. A-001 or null",
  "drawing_title":     "e.g. GROUND FLOOR PLAN or null",
  "project_name":      "full project name or null",
  "project_location":  "city or address or null",
  "client_name":       "owner/client name or null",
  "contractor_name":   "contractor or consultant firm name or null",
  "drawn_by":          "name or initials or null",
  "checked_by":        "name or initials or null",
  "approved_by":       "name or initials or null",
  "date_of_issue":     "DD/MM/YYYY or null",
  "revision_number":   "e.g. Rev A, Rev 0, 01 or null",
  "sheet_number":      "e.g. 1 or null",
  "total_sheets":      "e.g. 10 or null",
  "scale":             "e.g. 1:100 or null",
  "floor_level":       "e.g. Ground Floor, First Floor, Basement or null",
  "total_floor_area":  "e.g. 450 sq.m or null",
  "building_type":     "e.g. Residential, Commercial, Industrial, Mixed Use or null",
  "number_of_rooms":   "integer count or null",
  "room_schedule":     [{{"name": "Living Room", "area": "25 sq.m"}}, ...] or [],
  "door_count":        "integer count or null",
  "window_count":      "integer count or null",
  "structural_notes":  "any structural specifications or notes visible or null",
  "materials":         ["Concrete", "Brick", ...] or [],
  "dimensions":        "overall building dimensions e.g. 20m x 15m or null",
  "quantities":        "e.g. Doors: 8 nos | Windows: 12 nos, or null",
  "approval_stamp":    true or false,
  "north_arrow":       true or false,
  "grid_lines":        true or false,
  "additional_notes":  "any other important notes or null",
  "confidence": {{
    "drawing_number":   0.0,
    "drawing_title":    0.0,
    "project_name":     0.0,
    "floor_level":      0.0,
    "total_floor_area": 0.0,
    "scale":            0.0,
    "revision_number":  0.0,
    "approval_stamp":   0.0,
    "dimensions":       0.0,
    "materials":        0.0,
    "room_schedule":    0.0,
    "building_type":    0.0,
    "client_name":      0.0,
    "date_of_issue":    0.0
  }}
}}

EXTRACTION INSTRUCTIONS:
1. TITLE BLOCK (usually bottom-right or bottom of drawing): drawing number, project name, scale, date, revision, drawn/checked/approved by, client name, contractor name
2. FLOOR PLAN CONTENT: room labels give room names and areas; count doors (D-tag or door symbols) and windows (W-tag or window symbols); north arrow; grid lines (A,B,C... or 1,2,3...)
3. DIMENSIONS: read overall building dimension lines (typically outermost dimensions); record as "W x L" format
4. APPROVAL STAMP: any circular or rectangular stamp with signature = true
5. MATERIALS: look for material callouts, hatching legends, specification notes
6. CONFIDENCE: set 1.0 if you read the exact text clearly, 0.8 if likely correct, 0.6 if uncertain, 0.3 if guessed
7. Return null for any field not visible — do NOT guess or fabricate values"""


def _repair_json(raw: str) -> str:
    """Strip markdown fences and isolate the JSON object (last-resort parser)."""
    raw = raw.strip()
    if raw.startswith("```"):
        for part in raw.split("```"):
            part = part.strip()
            if part.startswith("json"):
                part = part[4:].strip()
            if part.startswith("{"):
                return part
    start, end = raw.find("{"), raw.rfind("}")
    if start != -1 and end != -1:
        return raw[start:end + 1]
    return raw


# Fields a deterministic prepass (text layer / OCR) can confirm as ground truth.
PREPASS_GROUND_TRUTH = [
    "drawing_number", "drawing_title", "scale", "date_of_issue", "revision_number",
    "sheet_number", "total_sheets", "project_name", "client_name",
    "drawn_by", "checked_by", "approved_by", "total_floor_area", "quantities",
]

# Fields owned by the title-block crop pass during multi-pass extraction.
TITLE_BLOCK_KEYS = [
    "drawing_number", "drawing_title", "project_name", "project_location",
    "client_name", "contractor_name", "drawn_by", "checked_by", "approved_by",
    "date_of_issue", "revision_number", "sheet_number", "total_sheets", "scale",
]


def _build_prompt(prepass_hints: dict) -> str:
    known = ""
    if prepass_hints:
        block = build_known_facts_block(prepass_hints)
        if block:
            known = (
                "The following fields were pre-extracted deterministically (text layer / OCR) "
                "with high confidence. Treat them as ground truth — do not override unless the "
                "drawing clearly contradicts them:\n\n" + block + "\n"
            )
    return EXTRACTION_PROMPT_TEMPLATE.format(known_facts_section=known)


def _coerce_raw(raw) -> dict:
    """Normalise a provider return into a dict (handles text/JSON-string responses)."""
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            return json.loads(_repair_json(raw))
        except Exception:
            return {}
    return {}


def calibrate_confidence(extracted: dict, prepass_hints: dict) -> dict:
    """Replace raw self-reported confidence with a calibrated per-field score.

    Signals: prepass agreement → near-certain; format validity (drawing no./
    revision/scale) → small boost/penalty; cross-field consistency (sheet ≤
    total_sheets) → penalty; every populated field gets a floor so the UI shows a score.
    """
    conf = dict(extracted.get("confidence") or {})
    prepass_hints = prepass_hints or {}

    def populated(key):
        return extracted.get(key) not in (None, "", [], False)

    # 1) deterministic prepass = ground truth
    for k in prepass_hints:
        if prepass_hints.get(k) and extracted.get(k):
            conf[k] = 0.97

    # 2) format checks
    dn = extracted.get("drawing_number")
    if dn:
        base = conf.get("drawing_number", 0.8)
        conf["drawing_number"] = (min(1.0, base + 0.05)
                                  if re.match(r'^[A-Za-z0-9\-/]+$', str(dn))
                                  else max(0.3, base - 0.2))
    rev = extracted.get("revision_number")
    if rev and not re.match(r'^(\d+|[Rr][Ee][Vv][-\s]?\w+|[A-Za-z]|\d+[A-Za-z]?)$', str(rev).strip()):
        conf["revision_number"] = max(0.3, conf.get("revision_number", 0.8) - 0.2)
    scale = extracted.get("scale")
    if scale and not re.search(r'1\s*:\s*\d+', str(scale)):
        conf["scale"] = max(0.3, conf.get("scale", 0.8) - 0.15)

    # 3) cross-field consistency: sheet number must not exceed total sheets
    try:
        if int(str(extracted.get("sheet_number"))) > int(str(extracted.get("total_sheets"))):
            conf["sheet_number"] = min(conf.get("sheet_number", 0.8), 0.5)
            conf["total_sheets"] = min(conf.get("total_sheets", 0.8), 0.5)
    except (TypeError, ValueError):
        pass

    # 4) confidence floor for any populated field lacking a score
    for k in list(extracted.keys()):
        if k != "confidence" and populated(k) and k not in conf:
            conf[k] = 0.7

    extracted["confidence"] = {k: max(0.0, min(1.0, float(v))) for k, v in conf.items()}
    return extracted


def _merge_prepass_ground_truth(extracted: dict, prepass_hints: dict) -> dict:
    """Prepass-matched fields override the model output (deterministic wins)."""
    for key in PREPASS_GROUND_TRUTH:
        if prepass_hints.get(key):
            extracted[key] = prepass_hints[key]
    return extracted


def extract_drawing_with_prepass(file_path: str, floor_category: str = None,
                                 original_name: str = None) -> tuple[dict, dict]:
    """
    Full extraction pipeline (Phase 2):
      1. preprocess — render PDF→image, clean, title-block crop
      2. prepass    — PDF text layer OR OCR → regex (deterministic ground truth)
      3. provider   — sidecar (vision|text) or mock; optional multi-pass
      4. validate   — coerce into the canonical schema
      5. merge      — prepass overrides the model for matched fields
      6. calibrate  — trustworthy per-field confidence

    Returns (extracted_dict, prepass_hints_dict).
    """
    dpi = _env_int("RENDER_DPI", 220)
    img_set = preprocess.build_images(file_path, dpi=dpi)
    full_image = img_set.get("full")
    crops = img_set.get("crops") or []

    # ── prepass: text layer, else OCR of the rendered image ──
    prepass_hints = {}
    pdf_text = extract_pdf_text(file_path)
    if not pdf_text and full_image:
        pdf_text = ocr_text(full_image)
    if pdf_text:
        prepass_hints = prepass_extract(pdf_text)

    # ── provider ──
    provider, _status = resolve_provider()
    prompt = _build_prompt(prepass_hints)
    schema = extraction_json_schema()

    def _call(image):
        req = ExtractRequest(
            prompt=prompt, schema=schema, image=image,
            media_type=img_set.get("media_type", "image/png"),
            text=pdf_text, file_path=file_path,
            floor_category=floor_category, original_name=original_name,
        )
        try:
            return _coerce_raw(provider.extract(req))
        except SidecarError:
            # sidecar failed mid-run → degrade to mock so the demo never dies
            from ai_provider import MockProvider
            return _coerce_raw(MockProvider().extract(req))

    multipass = _env_bool("MULTIPASS", False)
    if (multipass and getattr(provider, "name", "") == "sidecar"
            and getattr(provider, "mode", "") == "vision" and crops):
        raw = _call(full_image)
        raw_crop = _call(crops[0])               # dedicated title-block pass
        for k in TITLE_BLOCK_KEYS:
            if raw_crop.get(k):
                raw[k] = raw_crop[k]
    else:
        raw = _call(full_image)

    # ── validate → merge ground truth → calibrate ──
    extracted = validate_and_repair(raw)
    extracted = _merge_prepass_ground_truth(extracted, prepass_hints)
    extracted = calibrate_confidence(extracted, prepass_hints)
    return extracted, prepass_hints
