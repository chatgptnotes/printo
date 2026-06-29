import json
import os
import re
from pathlib import Path

import preprocess
from prepass import (extract_pdf_text, prepass_extract,
                     build_known_facts_block, ocr_text)
from schema import validate_and_repair, extraction_json_schema
from ai_provider import (resolve_provider, ExtractRequest, SidecarError,
                         vision_extract)
from boq_quality import BoqQualityError, infer_discipline, validate_boq_quality


class PartialExtractionError(RuntimeError):
    """Raised when title/scope data exists but BOQ quality is not report-ready."""

    def __init__(self, reason: str, extracted: dict, prepass_hints: dict):
        super().__init__(reason)
        self.reason = reason
        self.extracted = extracted
        self.prepass_hints = prepass_hints


def _env_bool(name: str, default: bool = False) -> bool:
    return (os.getenv(name, str(default)) or "").strip().lower() in ("1", "true", "yes", "on")


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def _speed_profile() -> str:
    return (os.getenv("EXTRACTION_SPEED_PROFILE", "balanced") or "balanced").strip().lower()


def _fast_profile() -> bool:
    return _speed_profile() in ("fast", "speed", "quick")


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
        "project_location":  "Business Bay, Dubai, UAE",
        "plot_number":       "Plot 345-1023",
        "client_name":       "Coral Real Estate Development LLC",
        "contractor_name":   "Gulf Premier Contracting LLC",
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
        "boq_items": [
            {"section": "Concrete / RCC", "description": "RCC M25 for columns, beams & slab (150mm)", "unit": "cu.m", "quantity": "—", "rate": "1450", "origin": "Approved equal — contractor selection", "reference": "S-101"},
            {"section": "Concrete / RCC", "description": "Columns 4.5m × 4.5m grid", "unit": "nos", "quantity": "16", "rate": "—", "origin": "Approved equal — contractor selection", "reference": "S-101"},
            {"section": "Masonry", "description": "AAC block walls, 200mm external / 100mm internal", "unit": "sq.m", "quantity": "—", "rate": "62", "origin": "Bianco / Hamil / approved equal", "reference": "A-201"},
            {"section": "Finishes", "description": "Cement plaster & painting to walls", "unit": "sq.m", "quantity": "—", "rate": "38", "origin": "Jotun / National Paints", "reference": "A-301"},
            {"section": "Finishes", "description": "Ceramic floor tiling", "unit": "sq.m", "quantity": "420", "rate": "95", "origin": "RAK Ceramics / approved equal", "reference": "A-301"},
            {"section": "Doors & Windows", "description": "Teak wood doors", "unit": "nos", "quantity": "8", "rate": "1850", "origin": "Approved joinery — contractor selection", "reference": "A-401"},
            {"section": "Doors & Windows", "description": "UPVC windows", "unit": "nos", "quantity": "12", "rate": "1200", "origin": "Deceuninck / Veka / approved equal", "reference": "A-401"},
            {"section": "LV Switchgear & Distribution", "description": "Final distribution board, 12-way TPN", "unit": "nos", "quantity": "4", "rate": "2400", "origin": "Schneider Electric / ABB / Siemens", "reference": "E-201"},
            {"section": "Cables & Wiring", "description": "LV power cable 4C × 16 sq.mm XLPE/SWA/PVC", "unit": "m", "quantity": "—", "rate": "48", "origin": "Ducab / NCC / Oman Cables", "reference": "E-202"},
            {"section": "Lighting", "description": "Recessed LED panel luminaire 600×600, 36W", "unit": "nos", "quantity": "60", "rate": "165", "origin": "Philips / approved equal", "reference": "E-301"},
        ],
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
            "revision_number":  0.71,   # demo: trips R14 low-confidence warning → red mark
            "approval_stamp":   0.91,
            "dimensions":       0.85,
            "materials":        0.78,
            "room_schedule":    0.88,
            "building_type":    0.95,
            "client_name":      0.92,
            "date_of_issue":    0.97,
        },
        # Normalised [x1,y1,x2,y2] (0..1) on the full sheet — drives red mistake
        # markings on the report image. (Mock guesses the usual title-block layout;
        # a live vision model returns boxes matched to the actual drawing.)
        "field_locations": {
            "project_name":    [0.72, 0.74, 0.97, 0.80],
            "drawing_title":   [0.72, 0.80, 0.97, 0.855],
            "drawing_number":  [0.72, 0.86, 0.86, 0.915],
            "revision_number": [0.72, 0.92, 0.82, 0.975],
            "scale":           [0.83, 0.92, 0.97, 0.975],
            "date_of_issue":   [0.87, 0.86, 0.97, 0.915],
            "approval_stamp":  [0.55, 0.85, 0.70, 0.98],
            "dimensions":      [0.10, 0.04, 0.60, 0.11],
        },
    }

from extraction_prompt import (SYSTEM_PROMPT, EXTRACTION_PROMPT_TEMPLATE,
                               build_discipline_block)


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
    "drawing_number", "drawing_title", "project_name", "project_location", "plot_number",
    "client_name", "contractor_name", "drawn_by", "checked_by", "approved_by",
    "date_of_issue", "revision_number", "sheet_number", "total_sheets", "scale",
]


# Upper bound on the user's BOQ description fed into the prompt. Generous
# (~50k words) so detailed scope/requirements pass through intact; still bounded
# to keep prompt size sane and limit prompt-injection blast radius. Mirrors the
# frontend MAX_DESCRIPTION_CHARS so the two caps stay in sync.
MAX_DESCRIPTION_CHARS = 350_000


def _build_prompt(prepass_hints: dict, project_description: str = "",
                  discipline: str | None = None) -> str:
    known = ""
    if prepass_hints:
        block = build_known_facts_block(prepass_hints)
        if block:
            known = (
                "The following fields were pre-extracted deterministically (text layer / OCR) "
                "with high confidence. Treat them as ground truth — do not override unless the "
                "drawing clearly contradicts them:\n\n" + block + "\n"
            )
    context = ""
    if project_description and project_description.strip():
        desc = project_description.strip()[:MAX_DESCRIPTION_CHARS]
        # The user's description is BOQ-relevant scope/requirements. Treat it as
        # authoritative for WHAT the Bill of Quantities must cover, layered on top
        # of the drawing — but never as a source of title-block identity fields.
        context = (
            "USER-PROVIDED BOQ REQUIREMENTS (read this together with the drawing and treat it "
            "as authoritative for the SCOPE, ITEMS, QUANTITIES, MATERIALS, BRANDS and PRICING of "
            "the Bill of Quantities):\n"
            f'"""\n{desc}\n"""\n'
            'Incorporate these requirements into "boq_items": add, refine, re-section, re-quantity '
            "and re-price line items so the BOQ reflects BOTH what the drawing shows AND what this "
            "text asks for. When the text specifies an item, quantity, unit, material/brand (origin) "
            "or rate, honour it; if it conflicts with the drawing on scope, prefer the user's stated "
            "requirement for the BOQ. Do NOT use this text to fill or change TITLE-BLOCK identity "
            "fields (drawing number, drawing title, project name, location, plot, client, contractor, "
            "drawn/checked/approved by, date, revision, sheet numbers, scale) — those come ONLY from "
            "the drawing.\n"
        )
    return EXTRACTION_PROMPT_TEMPLATE.format(
        known_facts_section=known, project_context_section=context,
        discipline_section=build_discipline_block(discipline),
    )


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


def _gap_fill_prompt(missing_floors: list[str]) -> str:
    floors = ", ".join(missing_floors)
    return (
        "You already scanned this drawing SET (all sheets are attached). Your first pass returned NO Bill-of-Quantities "
        f"rows for these areas/floors: {floors}.\n"
        "Open the sheet(s) for EACH of these areas and read them properly — they are real parts of this project and "
        "carry scope (lighting, small power/sockets, finishes, pumps/equipment, etc.). Return ONLY a JSON object "
        '{"boq_items": [ ... ]} with one row per distinct item per area, each row\'s "floor" set EXACTLY to the area '
        "name from the list above, following the same fields (section, description, unit, quantity, rate, origin, "
        "reference, floor, provisional). Estimation is a last resort — set provisional=true on any estimated row. "
        "Do NOT include rows for any area that is not in the list above."
    )


def _gap_fill(raw: dict, sheets: list, media_type: str) -> dict:
    """One re-read pass: if a floor the model itself listed has NO take-off rows,
    re-ask only for those floors and append the results (never replace)."""
    if not isinstance(raw, dict):
        return raw
    items = [it for it in (raw.get("boq_items") or []) if isinstance(it, dict)]
    labels = [str(l).strip() for l in (raw.get("floor_labels") or []) if str(l).strip()]
    covered = {(it.get("floor") or "").strip().lower() for it in items}
    missing = [l for l in labels if l.lower() not in covered]
    if not missing:
        return raw
    try:
        more = _coerce_raw(vision_extract(
            SYSTEM_PROMPT, _gap_fill_prompt(missing), sheets, media_type, extraction_json_schema()))
        extra = [e for e in (more.get("boq_items") or []) if isinstance(e, dict)]
        if extra:
            raw["boq_items"] = items + extra
    except SidecarError:
        pass
    return raw


def _schedule_legend_prompt(discipline: str | None, project_description: str = "") -> str:
    context = f"\nProject context: {project_description.strip()}\n" if project_description else ""
    return (
        "You are doing a second, focused BOQ extraction pass on the same construction drawing set. "
        "Ignore marketing text and do not invent scope.\n"
        f"{context}"
        f"Discipline focus already detected: {discipline or 'general'}.\n"
        "Open only the schedules, legends, notes, symbols, risers, single-line diagrams, panel schedules, "
        "room schedules, door/window schedules, material legends, equipment schedules and title blocks. "
        "Return ONLY additional or better-detailed BOQ rows that can be read from those schedule/legend areas. "
        "Use one row per tag/item/type per floor/area. Preserve exact ratings, cable sizes, materials, quantities, "
        "references and floors when visible. If a schedule is absent or unreadable, return an empty boq_items list. "
        "Return valid JSON using the normal extraction schema."
    )


def _schedule_legend_pass(raw: dict, sheets: list, media_type: str,
                          discipline: str | None, project_description: str = "") -> dict:
    """Focused second pass for dense schedule/legend information.

    This supplements, never replaces, the main plan take-off. It catches rows that
    are often missed because schedules and legends are text-dense.
    """
    if not isinstance(raw, dict) or not sheets or not _env_bool("SCHEDULE_LEGEND_PASS", not _fast_profile()):
        return raw
    limit = max(1, _env_int("SCHEDULE_LEGEND_MAX_SHEETS", 8))
    selected = sheets[:limit]
    try:
        supplement = _coerce_raw(vision_extract(
            SYSTEM_PROMPT,
            _schedule_legend_prompt(discipline, project_description),
            selected,
            media_type,
            extraction_json_schema(),
        ))
    except SidecarError:
        return raw
    if not isinstance(supplement, dict) or not supplement.get("boq_items"):
        return raw
    return _merge_extractions([raw, supplement])


def _collect_ocr_text(full_image: bytes | None, crops: list[bytes]) -> str | None:
    """OCR the full sheet and title-block crops when PDF text is missing or thin."""
    parts: list[str] = []
    if full_image:
        text = ocr_text(full_image)
        if text:
            parts.append(text)
    crop_limit = max(0, _env_int("OCR_CROP_MAX", 3))
    for crop in crops[:crop_limit]:
        text = ocr_text(crop)
        if text:
            parts.append(text)
    joined = "\n".join(parts).strip()
    return joined or None


def _merge_extractions(results: list[dict]) -> dict:
    """Merge per-batch vision results: title-block scalars (first non-empty wins),
    boq_items concatenated (per-area, no aggregation) with exact dups removed, and
    floor_labels unioned (order-preserving)."""
    merged: dict = {}
    boq: list = []
    labels: list = []
    seen: set = set()
    for r in results:
        if not isinstance(r, dict):
            continue
        for k, v in r.items():
            if k == "boq_items":
                for it in (v or []):
                    if not isinstance(it, dict):
                        continue
                    key = (str(it.get("section")), str(it.get("description")),
                           str(it.get("unit")), str(it.get("floor")))
                    if key in seen:
                        continue
                    seen.add(key)
                    boq.append(it)
            elif k == "floor_labels":
                for lbl in (v or []):
                    if lbl not in labels:
                        labels.append(lbl)
            elif not merged.get(k):
                merged[k] = v
    merged["boq_items"] = boq
    merged["floor_labels"] = labels
    return merged


def extract_drawing_with_prepass(file_path: str, floor_category: str = None,
                                 original_name: str = None,
                                 project_description: str = "",
                                 discipline: str = None) -> tuple[dict, dict]:
    """
    Full extraction pipeline:
      1. preprocess — render PDF→image(s), clean, title-block crop
      2. prepass    — PDF text layer OR OCR → regex (deterministic ground truth)
      3. extract    — multi-sheet Anthropic vision (every sheet) when a key is set,
                      else legacy single-image sidecar/mock; one gap-fill re-read
      4. validate   — coerce into the canonical schema
      5. merge      — prepass overrides the model for matched fields
      6. calibrate  — trustworthy per-field confidence

    Returns (extracted_dict, prepass_hints_dict).
    """
    fast = _fast_profile()
    dpi = _env_int("RENDER_DPI", 180 if fast else 220)
    img_set = preprocess.build_images(file_path, dpi=dpi)
    full_image = img_set.get("full")
    crops = img_set.get("crops") or []
    media_type = img_set.get("media_type", "image/png")

    # ── prepass: text layer plus OCR when the text layer is absent or thin ──
    prepass_hints = {}
    pdf_text = extract_pdf_text(file_path)
    min_text_chars = _env_int("OCR_MIN_TEXT_CHARS", 250)
    if len((pdf_text or "").strip()) < min_text_chars:
        ocr = _collect_ocr_text(full_image, crops)
        if ocr:
            pdf_text = ((pdf_text or "").strip() + "\n" + ocr).strip()
    if pdf_text:
        prepass_hints = prepass_extract(pdf_text)

    effective_discipline = infer_discipline(original_name or file_path, pdf_text, discipline)
    prompt = _build_prompt(prepass_hints, project_description, effective_discipline)
    schema = extraction_json_schema()
    raw: dict | None = None
    sheets: list[bytes] = []
    vision_error: Exception | None = None

    def _run_vision(prompt_text: str) -> dict | None:
        if not sheets:
            return None
        batch_size = _env_int("VISION_BATCH_SIZE", 5)
        if len(sheets) <= batch_size:
            return _coerce_raw(vision_extract(SYSTEM_PROMPT, prompt_text, sheets, media_type, schema))
        results = []
        for i in range(0, len(sheets), batch_size):
            results.append(_coerce_raw(vision_extract(
                SYSTEM_PROMPT, prompt_text, sheets[i:i + batch_size], media_type, schema)))
        return _merge_extractions(results)

    # ── Preferred: multi-sheet vision — send every sheet at once. The dispatcher
    #    prefers the AI Gateway (Claude CLI, no API key), else a direct key. ──
    try:
        total = _env_int("VISION_MAX_TOTAL_SHEETS", 8 if fast else 20)   # bound runaway cost
        sheet_dpi = _env_int("SHEET_RENDER_DPI", 160 if fast else 200)
        max_long_edge = _env_int("VISION_MAX_LONG_EDGE", 1280 if fast else 1568)
        sheet_set = preprocess.build_sheet_images(
            file_path,
            dpi=sheet_dpi,
            max_sheets=total,
            max_long_edge=max_long_edge,
        )
        sheets = sheet_set.get("sheets") or ([full_image] if full_image else [])
        raw = _run_vision(prompt)
        # Gap-fill re-reads any floor the model listed but left empty. Now runs in
        # the background job (no request ceiling), so it's on by default.
        if raw is not None and _env_bool("VISION_GAPFILL", not fast):
            raw = _gap_fill(raw, sheets, media_type)
        if raw is not None:
            raw = _schedule_legend_pass(raw, sheets, media_type, effective_discipline, project_description)
    except SidecarError as e:
        vision_error = e
        raw = None  # no vision provider / call failed - degrade below

    # ── Fallback: legacy single-image sidecar / mock ──
    if raw is None:
        provider, _status = resolve_provider()
        if getattr(provider, "name", "") == "mock" and not _env_bool("ALLOW_MOCK_EXTRACTION", False):
            detail = f" Previous vision error: {vision_error}" if vision_error else ""
            raise SidecarError("No real AI extraction provider is available; refusing to generate mock BOQ." + detail)

        def _call(image):
            req = ExtractRequest(
                prompt=prompt, schema=schema, image=image, media_type=media_type,
                text=pdf_text, file_path=file_path, system=SYSTEM_PROMPT,
                floor_category=floor_category, original_name=original_name,
            )
            return _coerce_raw(provider.extract(req))

        multipass = _env_bool("MULTIPASS", False)
        if (multipass and getattr(provider, "mode", "") == "vision" and crops):
            raw = _call(full_image)
            raw_crop = _call(crops[0])               # dedicated title-block pass
            for k in TITLE_BLOCK_KEYS:
                if raw_crop.get(k):
                    raw[k] = raw_crop[k]
        else:
            try:
                raw = _call(full_image)
            except SidecarError as e:
                detail = f" Previous vision error: {vision_error}" if vision_error else ""
                raise SidecarError(f"AI extraction provider failed: {e}.{detail}") from e

    # ── validate → merge ground truth → calibrate ──
    extracted = validate_and_repair(raw)
    extracted = _merge_prepass_ground_truth(extracted, prepass_hints)
    extracted = calibrate_confidence(extracted, prepass_hints)
    try:
        validate_boq_quality(
            extracted,
            source_name=original_name or file_path,
            discipline=effective_discipline,
            source_text=pdf_text,
        )
    except BoqQualityError as first_error:
        retry_raw = None
        retry_discipline = "General"
        if sheets and _env_bool("BOQ_QUALITY_RETRY", not fast):
            retry_prompt = _build_prompt(prepass_hints, project_description, retry_discipline)
            retry_raw = _run_vision(retry_prompt)
        if retry_raw:
            retry_extracted = validate_and_repair(retry_raw)
            retry_extracted = _merge_prepass_ground_truth(retry_extracted, prepass_hints)
            retry_extracted = calibrate_confidence(retry_extracted, prepass_hints)
            try:
                validate_boq_quality(
                    retry_extracted,
                    source_name=original_name or file_path,
                    discipline=retry_discipline,
                    source_text=pdf_text,
                )
                extracted = retry_extracted
            except BoqQualityError as retry_error:
                reason = (
                    f"{first_error}. Retried with automatic/general discipline guidance, "
                    f"but the result was still not report-ready: {retry_error}"
                )
                raise PartialExtractionError(reason, retry_extracted, prepass_hints) from retry_error
        else:
            raise PartialExtractionError(str(first_error), extracted, prepass_hints) from first_error
    return extracted, prepass_hints
