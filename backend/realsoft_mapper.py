"""
Maps Printo extracted JSON -> RealSoft ERP payload.

Mapping accuracy is built on four pillars:
  1. A declarative FIELD_MAP (one source of truth; ERP names configurable).
  2. Value normalizers (canonical dates/scale/revision/ints/area/dimensions/...).
  3. Confidence-gating — per-field confidence + a low-confidence list in metadata
     (low-trust values are still pushed, but flagged for ERP review).
  4. Validation + a consistent null convention, with mapping_warnings.

ERP field names below are sensible defaults — replace with Coral's exact
DrawingMaster spec when available (edit FIELD_MAP / DERIVED only).
"""

import datetime
import os
import re

REALSOFT_MODULE = os.getenv("REALSOFT_MODULE", "DrawingMaster")
LOW_CONF_THRESHOLD = float(os.getenv("MAP_LOW_CONF_THRESHOLD", "0.6"))
NULL_MODE = os.getenv("MAP_NULL_MODE", "null")        # "null" -> None, "empty" -> ""

_MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


# ── normalizers: each returns (value, warning_or_None) ─────────────────────────
def norm_text(v):
    if v is None:
        return None, None
    s = str(v).strip()
    if s == "" or s.lower() in ("null", "none", "n/a"):
        return None, None
    return s, None


def norm_int(v):
    if v is None:
        return None, None
    m = re.search(r"-?\d+", str(v))
    if not m:
        return None, f"expected integer, got {v!r}"
    return int(m.group()), None


def norm_revision(v):
    s, _ = norm_text(v)
    if s is None:
        return None, None
    # "Rev A" -> "A", "Rev-01" -> "01", "Revision: B" -> "B"
    m = re.match(r"^(?:rev(?:ision)?)[\s:\-]*([A-Za-z0-9]+)$", s, re.IGNORECASE)
    return (m.group(1) if m else s), None


def norm_scale(v):
    s, _ = norm_text(v)
    if s is None:
        return None, None
    m = re.search(r"(\d+)\s*:\s*(\d+)", s)
    if not m:
        return s, f"scale not in 1:N form: {s!r}"
    return f"{m.group(1)}:{m.group(2)}", None


def norm_date(v):
    """Return ISO YYYY-MM-DD. Keep raw + warn if unparseable."""
    s, _ = norm_text(v)
    if s is None:
        return None, None
    # YYYY-MM-DD
    m = re.match(r"^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$", s)
    if m:
        y, mo, d = map(int, m.groups())
        return _iso(y, mo, d, s)
    # DD-MM-YYYY / DD/MM/YYYY
    m = re.match(r"^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$", s)
    if m:
        d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if y < 100:
            y += 2000
        return _iso(y, mo, d, s)
    # "20 Jun 2026" / "Jun 20, 2026"
    m = re.match(r"^(\d{1,2})\s+([A-Za-z]{3,})\.?\s+(\d{4})$", s)
    if m and m.group(2)[:3].lower() in _MONTHS:
        return _iso(int(m.group(3)), _MONTHS[m.group(2)[:3].lower()], int(m.group(1)), s)
    m = re.match(r"^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$", s)
    if m and m.group(1)[:3].lower() in _MONTHS:
        return _iso(int(m.group(3)), _MONTHS[m.group(1)[:3].lower()], int(m.group(2)), s)
    return s, f"unrecognised date format: {s!r}"


def _iso(y, mo, d, raw):
    try:
        return datetime.date(y, mo, d).isoformat(), None
    except ValueError:
        return raw, f"invalid date: {raw!r}"


_AREA_UNITS = {"sq.m": "sq.m", "sqm": "sq.m", "m2": "sq.m", "m²": "sq.m",
               "sq.ft": "sq.ft", "sqft": "sq.ft", "sft": "sq.ft"}


def parse_area(v):
    """('420 sq.m') -> (value:float, unit:str)."""
    s, _ = norm_text(v)
    if s is None:
        return None, None, None
    m = re.search(r"([\d,]+(?:\.\d+)?)\s*(sq\.?\s*m|sqm|m2|m²|sq\.?\s*ft|sqft|sft)", s, re.IGNORECASE)
    if not m:
        num = re.search(r"[\d,]+(?:\.\d+)?", s)
        if num:
            return float(num.group().replace(",", "")), None, f"area unit missing: {s!r}"
        return None, None, f"area unparseable: {s!r}"
    val = float(m.group(1).replace(",", ""))
    unit = _AREA_UNITS.get(re.sub(r"\s+", "", m.group(2).lower()), m.group(2))
    return val, unit, None


def parse_dimensions(v):
    """('22m x 19m') -> (length:float, width:float, unit:str)."""
    s, _ = norm_text(v)
    if s is None:
        return None, None, None, None
    m = re.search(r"([\d.]+)\s*([a-zA-Z]*)\s*[x×*]\s*([\d.]+)\s*([a-zA-Z]*)", s)
    if not m:
        return None, None, None, f"dimensions unparseable: {s!r}"
    length, width = float(m.group(1)), float(m.group(3))
    unit = m.group(2) or m.group(4) or "m"
    return length, width, unit, None


def norm_materials(v):
    if not v:
        return None, 0
    if isinstance(v, list):
        items = [str(x).strip() for x in v if str(x).strip()]
        return ", ".join(items), len(items)
    return str(v), len([p for p in str(v).split(",") if p.strip()])


def yes_no(v):
    return "Yes" if v else "No"


# ── declarative field map: (extracted_field, ERP_field, normalizer) ────────────
# normalizer takes the raw value and returns (value, warning_or_None).
FIELD_MAP = [
    ("drawing_number",   "DrawingNo",       norm_text),
    ("drawing_title",    "DrawingTitle",    norm_text),
    ("project_name",     "ProjectName",     norm_text),
    ("project_location", "ProjectLocation", norm_text),
    ("plot_number",      "PlotNo",          norm_text),
    ("client_name",      "ClientName",      norm_text),
    ("contractor_name",  "ContractorName",  norm_text),
    ("drawn_by",         "DrawnBy",         norm_text),
    ("checked_by",       "CheckedBy",       norm_text),
    ("approved_by",      "ApprovedBy",      norm_text),
    ("date_of_issue",    "DateOfIssue",     norm_date),
    ("revision_number",  "RevisionNo",      norm_revision),
    ("sheet_number",     "SheetNo",         norm_int),
    ("total_sheets",     "TotalSheets",     norm_int),
    ("scale",            "Scale",           norm_scale),
    ("floor_level",      "FloorLevel",      norm_text),
    ("building_type",    "BuildingType",    norm_text),
    ("number_of_rooms",  "NumberOfRooms",   norm_int),
    ("door_count",       "DoorCount",       norm_int),
    ("window_count",     "WindowCount",     norm_int),
    ("quantities",       "Quantities",      norm_text),
    ("structural_notes", "StructuralNotes", norm_text),
    ("additional_notes", "AdditionalNotes", norm_text),
]

# Which extracted field's confidence backs each ERP field (for confidence-gating).
CONF_SOURCE = {
    "DrawingNo": "drawing_number", "DrawingTitle": "drawing_title",
    "ProjectName": "project_name", "ProjectLocation": "project_location",
    "PlotNo": "plot_number",
    "ClientName": "client_name", "ContractorName": "contractor_name",
    "DrawnBy": "drawn_by", "CheckedBy": "checked_by", "ApprovedBy": "approved_by",
    "DateOfIssue": "date_of_issue", "RevisionNo": "revision_number",
    "SheetNo": "sheet_number", "TotalSheets": "total_sheets", "Scale": "scale",
    "FloorLevel": "floor_level", "BuildingType": "building_type",
    "NumberOfRooms": "number_of_rooms", "DoorCount": "door_count",
    "WindowCount": "window_count", "Quantities": "quantities",
    "FloorAreaValue": "total_floor_area", "FloorAreaUnit": "total_floor_area",
    "Materials": "materials", "Dimensions": "dimensions",
    "DimLength": "dimensions", "DimWidth": "dimensions",
    "ApprovalStatus": "approval_stamp",
}


def _null():
    return "" if NULL_MODE == "empty" else None


def map_to_realsoft(extracted: dict, drawing_id: int, file_name: str,
                    validation_verdict: str, ai_confidence_avg: float,
                    project_description: str = "") -> dict:
    data = {}
    warnings = []

    # 1) table-driven scalar fields
    for src, erp, fn in FIELD_MAP:
        val, warn = fn(extracted.get(src))
        data[erp] = val if val is not None else _null()
        if warn:
            warnings.append(f"{erp}: {warn}")

    # 2) structured: area, dimensions, materials
    area_val, area_unit, area_warn = parse_area(extracted.get("total_floor_area"))
    data["FloorAreaValue"] = area_val if area_val is not None else _null()
    data["FloorAreaUnit"] = area_unit if area_unit is not None else _null()
    if area_warn:
        warnings.append(f"FloorArea: {area_warn}")

    dl, dw, dunit, dim_warn = parse_dimensions(extracted.get("dimensions"))
    data["Dimensions"] = (extracted.get("dimensions") or _null())
    data["DimLength"] = dl if dl is not None else _null()
    data["DimWidth"] = dw if dw is not None else _null()
    data["DimUnit"] = dunit if dunit is not None else _null()
    if dim_warn:
        warnings.append(f"Dimensions: {dim_warn}")

    mat_str, mat_count = norm_materials(extracted.get("materials"))
    data["Materials"] = mat_str if mat_str is not None else _null()
    data["MaterialsCount"] = mat_count

    # 3) derived / boolean fields
    if extracted.get("approval_stamp"):
        data["ApprovalStatus"] = "Approved"
    elif validation_verdict == "FAILED":
        data["ApprovalStatus"] = "Rejected"
    else:
        data["ApprovalStatus"] = "Pending"
    data["NorthArrow"] = yes_no(extracted.get("north_arrow"))
    data["GridLines"] = yes_no(extracted.get("grid_lines"))

    # 4) confidence-gating (flag mode): per-field confidence + low-confidence list
    conf = extracted.get("confidence", {}) or {}
    field_confidence, low_conf = {}, []
    for erp_field, src in CONF_SOURCE.items():
        c = conf.get(src)
        if c is None:
            continue
        field_confidence[erp_field] = round(float(c), 3)
        present = data.get(erp_field) not in (None, "", [])
        if present and c < LOW_CONF_THRESHOLD:
            low_conf.append(erp_field)

    # 4b) Bill of Quantities — trade-grouped line items carried into the ERP
    boq_items = [
        {
            "section":     (b.get("section") or "General"),
            "description": b.get("description"),
            "unit":        b.get("unit"),
            "quantity":    b.get("quantity"),
            "rate":        b.get("rate"),
            "origin":      b.get("origin"),
            "reference":   b.get("reference"),
            "floor":       b.get("floor"),
            "tag":         b.get("tag"),
            "rating":      b.get("rating"),
            "cable_size":  b.get("cable_size"),
            "from_ref":    b.get("from_ref"),
            "to_ref":      b.get("to_ref"),
        }
        for b in (extracted.get("boq_items") or []) if isinstance(b, dict)
    ]
    data["BoqItemCount"] = len(boq_items)

    # 5) validation pass over the built payload
    warnings += _validate(data)

    null_fields = sum(1 for v in data.values() if v in (None, ""))
    return {
        "module": REALSOFT_MODULE,
        "action": "CREATE",
        "data": data,
        "boq_items": boq_items,
        "metadata": {
            "source":                 "PRINTO_AI",
            "source_file":            file_name,
            "project_description":    project_description or "",
            "printo_record_id":       drawing_id,
            "ai_confidence_avg":      round(ai_confidence_avg, 3),
            "status":                 validation_verdict,
            "extracted_at":           datetime.datetime.now().isoformat(),
            "boq_item_count":         len(boq_items),
            "boq_sections":           sorted({i["section"] for i in boq_items}),
            "field_confidence":       field_confidence,
            "mapping_warnings":       warnings,
            "mapped_fields":          len(data) - null_fields,
            "null_fields":            null_fields,
        },
    }


def _validate(data: dict) -> list:
    """Type/format checks on the built payload; returns warnings (non-fatal)."""
    w = []
    d = data.get("DateOfIssue")
    if d and not re.match(r"^\d{4}-\d{2}-\d{2}$", str(d)):
        w.append(f"DateOfIssue not ISO: {d!r}")
    s = data.get("Scale")
    if s and not re.match(r"^\d+:\d+$", str(s)):
        w.append(f"Scale not canonical: {s!r}")
    for f in ("SheetNo", "TotalSheets", "NumberOfRooms", "DoorCount", "WindowCount"):
        v = data.get(f)
        if v not in (None, "") and not isinstance(v, int):
            w.append(f"{f} not integer: {v!r}")
    sn, ts = data.get("SheetNo"), data.get("TotalSheets")
    if isinstance(sn, int) and isinstance(ts, int) and sn > ts:
        w.append(f"SheetNo {sn} > TotalSheets {ts}")
    return w


def average_confidence(extracted: dict) -> float:
    conf = extracted.get("confidence", {})
    scores = [v for v in conf.values() if isinstance(v, (int, float))]
    return sum(scores) / len(scores) if scores else 0.0


# ── runnable self-test (verification) ──────────────────────────────────────────
if __name__ == "__main__":
    import json
    sample = {
        "drawing_number": "CT-A-101", "drawing_title": "GROUND FLOOR PLAN",
        "project_name": "CORAL TOWERS", "revision_number": "Rev A",
        "sheet_number": "1", "total_sheets": "5", "scale": "1 : 100",
        "date_of_issue": "20/06/2026", "total_floor_area": "420 sq.m",
        "dimensions": "22m x 19m", "number_of_rooms": "6", "door_count": "8 nos",
        "materials": ["RCC", "AAC Block"], "approval_stamp": True,
        "north_arrow": True, "grid_lines": True, "quantities": "Doors: 8 | Windows: 12",
        "confidence": {"drawing_number": 0.97, "scale": 0.95, "materials": 0.55,
                       "date_of_issue": 0.9, "dimensions": 0.5, "revision_number": 0.94},
    }
    payload = map_to_realsoft(sample, 1, "ground_floor_plan.png", "PASSED",
                              average_confidence(sample))
    print(json.dumps(payload, indent=2, default=str))
