"""BOQ extraction quality gates.

These checks prevent the system from generating a polished report from demo,
mock, or obviously incomplete extraction data. They are intentionally stricter
for electrical drawing sets because a shallow 10-line civil-style BOQ is worse
than a clear extraction failure.
"""

from __future__ import annotations

import os
import re
from pathlib import Path


class BoqQualityError(RuntimeError):
    """Raised when extracted BOQ data is not good enough to report."""


MOCK_MARKERS = (
    "coral towers",
    "coral real estate",
    "ct-a-gf",
    "ct-a-01",
    "ct-a-b1",
    "business bay, dubai",
)

ELECTRICAL_HINTS = (
    "power", "electrical", "dewa", "sld", "single line", "single-line",
    "lv", "hv", "mdb", "smdb", "db-", "distribution board", "panel",
    "cable", "containment", "conduit", "tray", "lighting", "earthing",
    "meter", "generator", "ats", "transformer",
)

ELECTRICAL_GROUPS = {
    "incoming_hv_lv": (
        "incoming", "hv", "lv main", "transformer", "generator", "ats",
        "mdb", "main distribution", "capacitor",
    ),
    "smdb": ("smdb", "sub-main", "sub main"),
    "db": ("distribution board", "consumer unit", " db-", "db "),
    "cables": ("cable", "xlpe", "swa", "pvc", "cu/", "4c", "1c"),
    "containment": ("containment", "tray", "trunking", "conduit", "ladder"),
    "wiring_devices": ("socket", "switch", "spur", "isolator", "accessories"),
    "lighting": ("lighting", "luminaire", "led", "emergency light"),
    "earthing": ("earthing", "earth", "lightning protection", "bonding"),
    "metering_testing": ("meter", "testing", "commissioning", "as-built", "inspection"),
}

CIVIL_SECTIONS = (
    "concrete", "rcc", "masonry", "finishes", "doors", "windows",
    "waterproofing",
)


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def _text_blob(extracted: dict, source_name: str = "", discipline: str = "",
               source_text: str = "") -> str:
    bits: list[str] = [source_name or "", discipline or "", source_text[:20000] if source_text else ""]
    for key in ("drawing_number", "drawing_title", "project_name", "floor_level", "quantities"):
        bits.append(str(extracted.get(key) or ""))
    for item in extracted.get("boq_items") or []:
        if isinstance(item, dict):
            bits.extend(str(item.get(k) or "") for k in ("section", "description", "reference", "floor"))
    return " ".join(bits).lower()


def infer_discipline(source_name: str = "", source_text: str = "",
                     requested: str | None = None) -> str:
    """Best-effort discipline inference used only to select stricter guidance."""
    req = (requested or "").strip().lower()
    if req and req not in ("auto", "auto-detect", "general", "other"):
        return req
    blob = f"{Path(source_name or '').name} {source_text[:20000] if source_text else ''}".lower()
    if any(h in blob for h in ELECTRICAL_HINTS):
        return "electrical"
    return req or "general"


def _has_mock_markers(blob: str) -> bool:
    return any(marker in blob for marker in MOCK_MARKERS)


def _electrical_group_hits(blob: str) -> set[str]:
    hits: set[str] = set()
    for group, needles in ELECTRICAL_GROUPS.items():
        if any(n in blob for n in needles):
            hits.add(group)
    return hits


def validate_boq_quality(extracted: dict, *, source_name: str = "",
                         discipline: str = "", source_text: str = "") -> None:
    """Raise BoqQualityError when extraction is too weak to become a report."""
    items = [i for i in (extracted.get("boq_items") or []) if isinstance(i, dict)]
    blob = _text_blob(extracted, source_name, discipline, source_text)
    errors: list[str] = []

    if _has_mock_markers(blob):
        errors.append("extraction contains built-in demo/mock markers")

    if not items:
        errors.append("no BOQ line items were extracted")

    inferred = infer_discipline(source_name, source_text, discipline)
    is_electrical = inferred == "electrical" or any(h in blob for h in ELECTRICAL_HINTS)

    if is_electrical:
        min_items = _env_int("ELECTRICAL_MIN_BOQ_ITEMS", 25)
        if len(items) < min_items:
            errors.append(
                f"electrical BOQ has only {len(items)} line item(s); expected at least {min_items}"
            )

        hits = _electrical_group_hits(blob)
        min_groups = _env_int("ELECTRICAL_MIN_SECTION_GROUPS", 5)
        if len(hits) < min_groups:
            missing = sorted(set(ELECTRICAL_GROUPS) - hits)
            errors.append(
                f"electrical BOQ covers only {len(hits)} scope group(s); "
                f"missing likely groups: {', '.join(missing[:6])}"
            )

        sections = [(i.get("section") or "").lower() for i in items]
        civil_hits = sum(1 for sec in sections if any(c in sec for c in CIVIL_SECTIONS))
        if civil_hits and civil_hits >= max(3, len(items) // 3):
            errors.append("electrical drawing produced mostly civil/architectural BOQ sections")

    if errors:
        raise BoqQualityError("; ".join(errors))

