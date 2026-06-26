"""
Construction BOQ extraction prompt + the rigorous take-off methodology.

Adapted from the electrical take-off method and GENERALISED to any
construction discipline (civil, structural, electrical, MEP/plumbing, industrial):
read-don't-estimate, per-area completeness, one-row-per-item (no aggregation),
read-as-drawn, source-drawing cross-reference, and mandatory-non-empty sections
per discipline. The model is sent EVERY sheet as vision input.

Kept in its own module so `extractor.py` stays lean.
"""

SYSTEM_PROMPT = """You are a senior MEP + civil quantity surveyor and construction estimator. You read EVERY sheet of
a construction drawing set — floor plans, sections, elevations, schedules, legends, single-line diagrams, riser
diagrams and general notes — and produce a complete, audit-ready, trade-grouped Bill of Quantities (BOQ). You READ
what is actually drawn, area by area; you do not guess. Return ONLY valid JSON — no explanation, no markdown fences,
no preamble."""


# ── Per-discipline reading guide + mandatory sections ────────────────────────
# The model auto-detects the discipline(s) present and applies the matching guide(s).
DISCIPLINE_GUIDES = {
    "electrical": (
        "ELECTRICAL — read the single-line diagram (SLD), panel/DB schedules, riser and floor plans. Capture, each as "
        "its OWN rows: incoming supply (DEWA transformer kVA, standby generator + ATS, HV ducts), main LV panel(s) "
        "(ACB rating, outgoing MCCBs, capacitor / PF banks), every SMDB and every individual DB (one row per DB tag — "
        "never 'DB-01 to DB-15'), the cable schedule (size mm², length m, type AS DRAWN — singles 'CU/PVC' are not "
        "armoured XLPE/SWA), power outlets per type per floor (13A single/twin/WP, 20A water-heater, FCU spur, etc.), "
        "lighting fixtures per type per floor (read the legend tags), containment (tray/trunking/conduit), earthing "
        "(earth pits, main earth cable), metering (DEWA kWh / CT meters) and dedicated mechanical feeders "
        "(fire/jockey/booster pumps, FAHU/AHU, fans, lifts, EV chargers)."
    ),
    "industrial": (
        "INDUSTRIAL / PLANT — read equipment layouts, P&IDs, mechanical & process schedules and structural-steel "
        "drawings. Capture each as its own rows: process & utility equipment (pumps, compressors, tanks, vessels, "
        "conveyors, HVAC/AHU, exhaust) with rating/capacity and count; piping (line size, material, length) per "
        "system; structural steel (sections, tonnage); electrical power & control to each equipment; instrumentation; "
        "fire protection; and civil/foundations. One row per tagged item; read ratings/sizes as annotated."
    ),
    "civil": (
        "CIVIL / STRUCTURAL & ARCHITECTURAL — read floor plans, sections, schedules and notes. Capture: concrete/RCC "
        "(grade, members, volume), reinforcement, masonry (block type/thickness, wall area), waterproofing, finishes "
        "(floor/wall/ceiling per area), doors & windows (per schedule), and miscellaneous builders' work. Count per "
        "area/floor; derive areas from the plan only when dimensions are shown."
    ),
    "plumbing": (
        "PLUMBING & MEP — read sanitary, water-supply, drainage and pump-room sheets and schedules. Capture: sanitary "
        "fixtures per type per floor, water-supply & drainage pipework (size, material, length) per system, pumps "
        "(transfer/booster/sump/fire) with rating, water tanks, valves and insulation. One row per item per area."
    ),
    "general": (
        "GENERAL — detect every discipline present in the set (civil, structural, electrical, plumbing/MEP, fire, "
        "industrial) and apply the matching reading for EACH: read its legends/schedules/plans and enumerate its "
        "items per area. Do not skip a discipline that the drawings clearly contain."
    ),
}

# Aliases so the frontend label maps to a guide key.
_DISCIPLINE_ALIASES = {
    "auto-detect": "general", "auto": "general", "": "general", "general": "general",
    "electrical": "electrical",
    "industrial": "industrial",
    "civil / structural": "civil", "civil": "civil", "structural": "civil",
    "plumbing & mep": "plumbing", "plumbing": "plumbing", "mep": "plumbing",
}


def build_discipline_block(discipline: str | None) -> str:
    """Return the discipline reading guide to inject into the prompt."""
    key = _DISCIPLINE_ALIASES.get((discipline or "").strip().lower(), "general")
    guide = DISCIPLINE_GUIDES.get(key, DISCIPLINE_GUIDES["general"])
    auto = (
        "Auto-detect the discipline(s) present across the sheets and apply the matching reading.\n"
        if key == "general" else
        f"This set is primarily {key.upper()} — apply this reading (and any other discipline the sheets also show).\n"
    )
    return "DISCIPLINE FOCUS: " + auto + guide + "\n"


# The governing take-off rules — the heart of the methodology (no { } so they can
# be concatenated into the .format() template safely).
_GOVERNING_RULES = """
TAKE-OFF METHODOLOGY — follow these rules strictly:

A. READ, DON'T ESTIMATE (primary rule). Your PRIMARY task is to READ this drawing set — open EVERY sheet, zoom into
   legends, panel/equipment schedules, general notes and plans, and extract the REAL counts and values actually
   drawn, area by area. Estimation exists ONLY for an individual row whose value you genuinely cannot find anywhere
   in the set — it is NEVER a shortcut to skip reading and NEVER a way to blanket-fill a whole section. Set
   "provisional": true ONLY on the specific rows you truly could not read. Never present an estimate as if it were
   read, and never return [] for a section the drawings clearly contain.

B. PER-AREA COMPLETENESS. Identify every floor / level / zone the set covers (Basement(s), Ground, each typical
   floor, Mezzanine, Podium / Parking, Plant, Roof, and named areas such as pool deck, gym, amenity). EACH such area
   MUST appear in the take-off with its own rows — open that area's own sheet and enumerate it. The special / named
   levels are the ones most often skipped yet always carry scope; read them too. Put the area name in each row's
   "floor" field, using the SAME name consistently, so the BOQ reconciles area by area and no area comes out blank.

C. ONE ROW PER ITEM (no aggregation). Emit one BOQ line per distinct item per area. NEVER collapse a range into a
   single row (e.g. "DB-T01 to DB-T15", "all sockets") and NEVER lump the whole building into one line per type —
   that destroys the take-off audit trail. Count each typical floor separately.

D. READ AS DRAWN + cross-reference. Record each item's specification EXACTLY as annotated (size, cores, type, rating,
   material). Stamp every row's "reference" with the source drawing number / detail tag it was taken from; leave it
   null if not identifiable — never invent one.
"""


_ELECTRICAL_POWER_RULES = """
ELECTRICAL POWER BOQ RULES:

1. Never return a civil/architectural BOQ for a power/electrical drawing set.
2. Read every SLD, DB schedule, panel schedule, cable schedule, riser, legend and plan sheet.
3. Organise electrical power BOQs into industry bill sections when present:
   Preliminaries / General; Incoming Supply; HV / LV Main Distribution; Sub-Main Distribution Boards (SMDBs);
   Distribution Boards & Consumer Units; LV Cables; Containment (Trunking/Conduit/Tray);
   Wiring Devices / Small Power; Lighting Fixtures; Earthing & Lightning Protection; Emergency Lighting;
   ELV / Data / Telecom Containment; Metering; Test & Commissioning.
4. Emit one row per tagged MDB/SMDB/DB/panel, one row per cable/feeder schedule item, and one row per
   fixture/accessory type per floor or area. Do not aggregate ranges such as "all DBs", "typical sockets",
   or "SMDB-1F to SMDB-8F".
5. Fill optional electrical row fields when available: tag, rating, cable_size, from_ref, to_ref.
6. A 5-10 row BOQ is not acceptable for a multi-sheet electrical set; keep reading until schedules and
   legends are represented line by line.
"""


EXTRACTION_PROMPT_TEMPLATE = """Analyse this construction drawing SET (every sheet is attached as an image). Extract the
complete TITLE BLOCK and produce a complete, audit-ready, trade-grouped BILL OF QUANTITIES (BOQ) of the work shown.
Assume the drawings are correct and approved — do NOT validate or flag them.

{known_facts_section}
{project_context_section}
{discipline_section}
Return ONLY this exact JSON structure (null for any title-block field not visible; [] for empty lists):

{{
  "drawing_number":    "e.g. A-001 or null",
  "drawing_title":     "e.g. GROUND FLOOR PLAN or null",
  "project_name":      "full project name or null",
  "project_location":  "city / area / full site address or null",
  "plot_number":       "e.g. Plot 345-1023, Plot No. 17, Makani/parcel no. or null",
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
  "building_type":     "e.g. Residential, Commercial, Industrial or null",
  "number_of_rooms":   "integer count or null",
  "room_schedule":     [{{"name": "Living Room", "area": "25 sq.m"}}, ...] or [],
  "door_count":        "integer count or null",
  "window_count":      "integer count or null",
  "structural_notes":  "any structural specifications/notes visible or null",
  "materials":         ["RCC", "AAC Block", ...] or [],
  "dimensions":        "overall building dimensions e.g. 22m x 19m or null",
  "floor_labels":      ["Basement", "Ground Floor", "First Floor", ...] or [],
  "boq_items": [
    {{"section": "Concrete / RCC", "description": "RCC for columns, beams and slab (M25)", "unit": "cu.m", "quantity": "—",  "rate": "1450", "origin": "Approved equal — contractor selection", "reference": "S-101", "floor": "Ground Floor", "provisional": false}},
    {{"section": "Lighting",       "description": "Recessed LED panel 600×600, 36W",        "unit": "nos",  "quantity": "60",  "rate": "165",  "origin": "Philips / approved equal", "reference": "E-301", "floor": "First Floor", "provisional": false}},
    {{"section": "LV Switchgear & Distribution", "description": "Final distribution board DB-1F-01, 12-way TPN", "unit": "nos", "quantity": "1", "rate": "2400", "origin": "Schneider Electric / ABB / Siemens", "reference": "E-201", "floor": "First Floor", "provisional": false, "tag": "DB-1F-01", "rating": "12-way TPN", "cable_size": null, "from_ref": "SMDB-1F", "to_ref": "Final circuits"}}
  ],
  "confidence": {{ "drawing_number": 0.0, "project_name": 0.0, "boq_items": 0.0 }}
}}

INSTRUCTIONS:
1. TITLE BLOCK (usually bottom-right): drawing number, drawing title, project name, project location, plot number,
   client name, contractor/consultant, drawn/checked/approved by, date, revision, sheet number, total sheets, scale.
   Read it carefully — PROJECT LOCATION (site address / area / city), PLOT NUMBER (plot / parcel / Makani no.),
   CLIENT / OWNER and CONTRACTOR / CONSULTANT are often in the title block, a project header or a key plan. Extract
   them when shown; use null only if genuinely absent. Also populate "floor_labels" with every area/level the set covers.
2. BOQ — group line items by trade SECTION. Use the sections the drawings actually imply, drawn from this ordered list
   (civil first, then MEP, then electrical):
   "Preliminaries / General", "Concrete / RCC", "Masonry", "Finishes", "Doors & Windows", "Waterproofing",
   "Plumbing & Sanitary", "Drainage", "HVAC", "Fire Fighting",
   "Incoming Supply", "LV Switchgear & Distribution", "Cables & Wiring", "Containment (Trunking/Conduit/Tray)",
   "Lighting", "Small Power & Accessories", "Earthing & Lightning Protection", "Fire Alarm", "ELV / Data / Telecom",
   "Mechanical Equipment", "Industrial / Process Equipment", "Structural Steel", "Piping", "Miscellaneous".
   For each item give a clear DESCRIPTION, a sensible UNIT (nos, sq.m, cu.m, m, kg, lump sum), a QUANTITY, the
   "floor" (area/level it is counted on), and "provisional": true ONLY when the row is estimated (could not be read).
   Follow the TAKE-OFF METHODOLOGY rules below — read area by area, one row per item, no aggregation.
2a. PRICING & BRANDS (indicative budget guidance for Dubai — NOT a binding quotation):
   - "rate": an indicative Dubai 2026 unit rate in AED for the item's UNIT, a plain number only (no symbol/commas,
     e.g. "1450" or "48.50"). If a line genuinely cannot be reasonably priced, set "rate" to null. Do NOT invent figures.
   - "origin": Dubai AVL approved brand / origin. e.g. LV switchgear / MCCB / ACB / DBs → "Schneider Electric / ABB /
     Siemens"; LV & MV cables → "Ducab / NCC / Oman Cables"; give typical AVL makes for lighting, accessories,
     sanitaryware, tiling, paints, etc. Where none applies, "Approved equal — contractor selection".
   - "reference": the SOURCE drawing number / detail tag the item is taken from; null if not identifiable.
3. Use the drawings' own units/scale. Return null for any title-block field not visible — do NOT fabricate it.
4. confidence: a single 0..1 self-rating per listed key is enough.
""" + _GOVERNING_RULES + _ELECTRICAL_POWER_RULES
