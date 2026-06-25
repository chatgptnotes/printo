"""
Pydantic schema for a drawing extraction result.

Used to validate / repair whatever the AI provider returns (sidecar or mock):
the model output is coerced into this shape, extra keys are dropped, missing
keys default to null/empty. This eliminates the old free-text-JSON parse fragility
and gives the rest of the pipeline a guaranteed structure to work with.

The JSON Schema (see `extraction_json_schema()`) is also sent to the sidecar so a
vision/LLM provider can be asked to emit exactly these fields.
"""

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


class RoomItem(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: Optional[str] = None
    area: Optional[str] = None


class BoqItem(BaseModel):
    """One Bill-of-Quantities line, grouped by trade `section`."""
    model_config = ConfigDict(extra="ignore")
    section: Optional[str] = None       # trade group, e.g. "Concrete / RCC"
    description: Optional[str] = None    # work item description
    unit: Optional[str] = None           # e.g. nos, sq.m, cu.m, m, kg, lump sum
    quantity: Optional[str] = None       # quantity as read/derived from the drawing
    rate: Optional[str] = None           # indicative Dubai 2026 unit rate (AED, number only)
    origin: Optional[str] = None         # AVL approved brand / origin guidance
    reference: Optional[str] = None      # source drawing number / detail tag
    floor: Optional[str] = None          # area/level this row was counted on (per-area take-off)
    provisional: Optional[bool] = None   # True = estimated/unread row (flagged amber, not read)

    @field_validator("section", "description", "unit", "quantity",
                     "rate", "origin", "reference", "floor", mode="before")
    @classmethod
    def _clean(cls, v):
        if v is None:
            return None
        s = str(v).strip()
        return None if s == "" or s.lower() in ("null", "none", "n/a") else s

    @field_validator("provisional", mode="before")
    @classmethod
    def _clean_bool(cls, v):
        if isinstance(v, bool) or v is None:
            return v
        return str(v).strip().lower() in ("true", "1", "yes", "y")


class DrawingExtraction(BaseModel):
    """Canonical extracted-field set for a construction drawing."""
    model_config = ConfigDict(extra="ignore")

    # ── Title block ──
    drawing_number: Optional[str] = None
    drawing_title: Optional[str] = None
    project_name: Optional[str] = None
    project_location: Optional[str] = None
    plot_number: Optional[str] = None
    client_name: Optional[str] = None
    contractor_name: Optional[str] = None
    drawn_by: Optional[str] = None
    checked_by: Optional[str] = None
    approved_by: Optional[str] = None
    date_of_issue: Optional[str] = None
    revision_number: Optional[str] = None
    sheet_number: Optional[str] = None
    total_sheets: Optional[str] = None
    scale: Optional[str] = None

    # ── Floor-plan content ──
    floor_labels: list[str] = Field(default_factory=list)  # every area/level the set covers
    floor_level: Optional[str] = None
    total_floor_area: Optional[str] = None
    building_type: Optional[str] = None
    number_of_rooms: Optional[str] = None
    room_schedule: list[RoomItem] = Field(default_factory=list)
    door_count: Optional[str] = None
    window_count: Optional[str] = None
    dimensions: Optional[str] = None

    # ── Bill of Quantities (trade-grouped line items derived from the drawing) ──
    boq_items: list[BoqItem] = Field(default_factory=list)

    # ── Technical ──
    structural_notes: Optional[str] = None
    materials: list[str] = Field(default_factory=list)
    quantities: Optional[str] = None          # NEW — rules R10/R18 validate this
    approval_stamp: bool = False
    north_arrow: bool = False
    grid_lines: bool = False
    additional_notes: Optional[str] = None

    # ── Per-field self-reported confidence (0..1) ──
    confidence: dict[str, float] = Field(default_factory=dict)

    # ── Per-field bounding boxes on the FULL sheet, normalised 0..1 [x1,y1,x2,y2] ──
    # Used to draw red "mistake" markings on the report image (Pratyaya-style).
    field_locations: dict[str, list[float]] = Field(default_factory=dict)

    @field_validator(
        "drawing_number", "drawing_title", "project_name", "project_location",
        "client_name", "contractor_name", "drawn_by", "checked_by", "approved_by",
        "date_of_issue", "revision_number", "sheet_number", "total_sheets", "scale",
        "floor_level", "total_floor_area", "building_type", "number_of_rooms",
        "door_count", "window_count", "dimensions", "structural_notes",
        "quantities", "additional_notes",
        mode="before",
    )
    @classmethod
    def _coerce_scalar(cls, v):
        """Coerce numbers to str and normalise empty/"null" strings to None."""
        if v is None:
            return None
        if isinstance(v, (int, float)):
            return str(v)
        if isinstance(v, str):
            s = v.strip()
            return None if s == "" or s.lower() in ("null", "none", "n/a") else s
        return v

    @field_validator("materials", mode="before")
    @classmethod
    def _coerce_materials(cls, v):
        if v is None:
            return []
        if isinstance(v, str):
            # accept comma-separated string
            return [p.strip() for p in v.split(",") if p.strip()]
        if isinstance(v, list):
            return [str(x).strip() for x in v if str(x).strip()]
        return []

    @field_validator("confidence", mode="before")
    @classmethod
    def _coerce_confidence(cls, v):
        if not isinstance(v, dict):
            return {}
        out = {}
        for k, val in v.items():
            try:
                out[str(k)] = max(0.0, min(1.0, float(val)))
            except (TypeError, ValueError):
                continue
        return out

    @field_validator("field_locations", mode="before")
    @classmethod
    def _coerce_field_locations(cls, v):
        """Keep only well-formed boxes: 4 finite numbers clamped to 0..1."""
        if not isinstance(v, dict):
            return {}
        out = {}
        for k, box in v.items():
            if not isinstance(box, (list, tuple)) or len(box) != 4:
                continue
            try:
                coords = [max(0.0, min(1.0, float(c))) for c in box]
            except (TypeError, ValueError):
                continue
            out[str(k)] = coords
        return out


def validate_and_repair(data: dict) -> dict:
    """Coerce a raw provider dict into the canonical field shape.

    Tolerant by design: drops unknown keys, fixes types, fills defaults.
    Raises pydantic.ValidationError only on irrecoverable input (caller may retry).
    """
    model = DrawingExtraction.model_validate(data or {})
    return model.model_dump()


def extraction_json_schema() -> dict:
    """JSON Schema for the extraction, sent to the sidecar so a model can target it."""
    return DrawingExtraction.model_json_schema()


# Plain field list (handy for prompts / benchmarks / UI ordering).
SCALAR_FIELDS = [
    "drawing_number", "drawing_title", "project_name", "project_location",
    "plot_number", "client_name", "contractor_name", "drawn_by", "checked_by", "approved_by",
    "date_of_issue", "revision_number", "sheet_number", "total_sheets", "scale",
    "floor_level", "total_floor_area", "building_type", "number_of_rooms",
    "door_count", "window_count", "dimensions", "structural_notes",
    "quantities", "additional_notes",
]
