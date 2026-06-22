import base64
import json
import os
from pathlib import Path

from prepass import extract_pdf_text, prepass_extract, build_known_facts_block

_api_key = os.getenv("ANTHROPIC_API_KEY", "")
_mock_mode = not _api_key or _api_key.startswith("sk-ant-test") or _api_key == "demo"

if not _mock_mode:
    import anthropic
    client = anthropic.Anthropic(api_key=_api_key)
else:
    client = None


def _mock_extract(file_path: str) -> dict:
    """Return realistic dummy data for demo/testing without API key."""
    name = Path(file_path).stem.lower()
    if "ground" in name or "gf" in name:
        floor = "Ground Floor"
        sheet = "1"
    elif "first" in name or "ff" in name or "1" in name:
        floor = "First Floor"
        sheet = "2"
    elif "basement" in name or "b1" in name:
        floor = "Basement"
        sheet = "3"
    elif "kitchen" in name:
        floor = "Ground Floor"
        sheet = "4"
    else:
        floor = "Ground Floor"
        sheet = "1"

    return {
        "drawing_number":    f"CT-A-{sheet.zfill(3)}",
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


def _encode_file(file_path: str) -> tuple[str, str]:
    suffix = Path(file_path).suffix.lower()
    media_map = {
        ".pdf":  "application/pdf",
        ".jpg":  "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png":  "image/png",
        ".tiff": "image/tiff",
        ".tif":  "image/tiff",
    }
    media_type = media_map.get(suffix, "image/jpeg")
    with open(file_path, "rb") as f:
        data = base64.standard_b64encode(f.read()).decode("utf-8")
    return data, media_type


def _repair_json(raw: str) -> str:
    """Strip markdown fences and find the JSON object."""
    raw = raw.strip()
    if raw.startswith("```"):
        parts = raw.split("```")
        for part in parts:
            part = part.strip()
            if part.startswith("json"):
                part = part[4:].strip()
            if part.startswith("{"):
                return part
    start = raw.find("{")
    end = raw.rfind("}")
    if start != -1 and end != -1:
        return raw[start:end+1]
    return raw


def extract_drawing(file_path: str, prepass_hints: dict = None) -> dict:
    """Send drawing to Claude Vision and return extracted fields as dict."""
    if _mock_mode:
        result = _mock_extract(file_path)
        if prepass_hints:
            conf = result.get("confidence", {})
            for k, v in prepass_hints.items():
                result[k] = v
                conf[k] = 0.97
            result["confidence"] = conf
        return result

    data, media_type = _encode_file(file_path)

    known_facts_section = ""
    if prepass_hints:
        block = build_known_facts_block(prepass_hints)
        if block:
            known_facts_section = (
                "The following fields were pre-extracted from the PDF text layer with high confidence. "
                "Use these as ground truth — do not override them unless you see a clear contradiction:\n\n"
                + block + "\n"
            )

    prompt = EXTRACTION_PROMPT_TEMPLATE.format(
        known_facts_section=known_facts_section
    )

    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": data,
                        },
                    },
                    {"type": "text", "text": prompt},
                ],
            }
        ],
    )

    raw = response.content[0].text
    return json.loads(_repair_json(raw))


def extract_drawing_with_prepass(file_path: str) -> tuple[dict, dict]:
    """
    Full two-step extraction:
    1. Extract PDF text layer (free) → regex pre-pass
    2. Call Claude Vision with pre-pass hints injected
    3. Merge: pre-pass wins for fields it found (more reliable than OCR)

    Returns (extracted_dict, prepass_hints_dict)
    """
    prepass_hints = {}
    pdf_text = extract_pdf_text(file_path)
    if pdf_text:
        prepass_hints = prepass_extract(pdf_text)

    extracted = extract_drawing(file_path, prepass_hints if prepass_hints else None)

    # Pre-pass results override AI for matched fields (text layer is ground truth)
    field_map = {
        "drawing_number": "drawing_number",
        "scale":          "scale",
        "date_of_issue":  "date_of_issue",
        "revision_number":"revision_number",
        "sheet_number":   "sheet_number",
        "total_sheets":   "total_sheets",
        "project_name":   "project_name",
        "client_name":    "client_name",
        "drawn_by":       "drawn_by",
        "checked_by":     "checked_by",
        "approved_by":    "approved_by",
    }
    conf = extracted.get("confidence", {})
    for prepass_key, extracted_key in field_map.items():
        if prepass_hints.get(prepass_key):
            extracted[extracted_key] = prepass_hints[prepass_key]
            conf[extracted_key] = 0.97  # text layer = near-certain

    extracted["confidence"] = conf
    return extracted, prepass_hints
