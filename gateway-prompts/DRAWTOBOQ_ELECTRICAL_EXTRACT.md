# taskID: `DRAWTOBOQ_ELECTRICAL_EXTRACT`

Primary electrical drawing scanner — George Varkey's 14-step BOQ procedure.
Called by `analyzeElectricalProcedure()` in `src/lib/ai/claude-api.ts`.

## Settings
```yaml
model:        claude-opus-4-8   # operator chose Opus for max extraction accuracy
temperature:  (omitted)         # Opus 4.8 rejects temperature → adaptive thinking; output is NON-deterministic
max_tokens:   32000             # large schema; 12K truncates before cable_schedule
vision:       true              # PDF / PNG / JPG / WEBP, up to ~25 MB/file
useJson:      true
```
> Trade-off vs the original spec (`claude-sonnet-4-6`, `temp 0`): higher accuracy on
> complex drawings, but ~5× cost, slower, and non-deterministic (no `temp 0`). Switch
> back to `claude-sonnet-4-6` for cheaper, repeatable runs if accuracy is sufficient.

## Input (from the app's `payload` + attached files)
- `payload.systemPrompt` → use as the system message (or use the canonical one below)
- `payload.userText`     → the fully-rendered user prompt (already contains the
  variables filled in). A passthrough gateway sends this verbatim as the user
  message, with the uploaded drawing files attached as vision input.
- `files[]`              → the electrical drawings (vision). Attach all of them.

If you want the **gateway** to own the canonical prompt instead of passing through,
render the template below using these variables (the app injects them into
`userText`, so they are available in the incoming text even if you re-template):

| Variable | Meaning | Source |
|---|---|---|
| `{{KNOWN_FACTS}}` | Preflight facts + 90-day human-correction hints (may be empty) | `preflight.promptHints` + `getExtractionPriorHints()` |
| `{{FLOORS}}` | building floor count or `?` | extracted project info |
| `{{AREA_SQFT}}` | total area sqft or `?` | extracted project info |
| `{{BUILDING_TYPE}}` | e.g. office/residential or `unknown` | extracted project info |
| `{{EXTRACTED_TEXT}}` | OCR/DXF text from drawings, first 12,000 chars | DXF parser / pdf text |

---

## System prompt
```
You are an MEP electrical estimator. Respond ONLY with a valid JSON object matching the schema in the user message. No prose, no markdown.
```

## User prompt template
```
You are an MEP electrical estimator following George Varkey's 14-step electrical BOQ procedure for a project in Dubai, UAE.

{{KNOWN_FACTS}}

Building: {{FLOORS}} floors, {{AREA_SQFT}} sqft, {{BUILDING_TYPE}} type.

Follow these steps IN ORDER and report findings for each:

Step 1:  Open the drawing — locate all electrical drawings available
Step 2:  List available drawings — classify each as floor_plan / schematic / riser / schedule / other; note which floor each covers
Step 3:  Establish floors and floor height — count and name every level (Basement, Ground, 1F, 2F … Roof). For typical floor height, READ it from the drawing: prefer the level datums / FFL/SSL annotations on sections, elevations or the riser (height = difference between two consecutive floor levels, e.g. +3.60 − 0.00 = 3.6 m), or an explicit floor-height note in the general notes / typical section. If no level datum or height note is legible anywhere, set typical_floor_height_m to null — do NOT substitute a generic default (3.0/3.2/3.6); a guessed height corrupts the cable-length (Step 10) and containment (Section 9) estimates that depend on it.
Step 4:  Find drawing scale — read the scale annotation or scale bar (e.g. "1:100", "1:50"); note if found or not found
Step 5:  Identify LV Room / MDB — find the Main LV Panel / Main Distribution Board, most probably on the Ground Floor; note tag (e.g. LVP-01), rating in Amps, location
Step 6:  Check availability of schematic drawing — confirm if a Single-Line Diagram (SLD) or schematic exists; note the filename
Step 7:  Note SMDBs from LV panel in schematic drawing — list every SMDB fed from the MDB: tag (e.g. SMDB-1F), floor, rating (A), cable size from MDB (e.g. 4C×95mm²), connected_load_kw if shown on the SLD (e.g. 150.86 kW), qty when a row covers a stack of identical floors (e.g. SMDB-1F to SMDB-8F → qty 8). Use ONE representation per SMDB: EITHER enumerate per-floor boards (SMDB-1F, SMDB-2F … each qty 1) OR a single typical-floor stack (SMDB-TF, qty = N) — NEVER both, or the typical floors get double-counted.
Step 8:  Identify SMDBs in floor drawings from Basement to Roof — confirm SMDB locations on floor plans, cross-check with schematic
Step 9:  Establish probable cable route from LV panel to SMDBs — look at riser drawing or riser annotations; note route (e.g. "riser shaft B, west core")
Step 10: Estimate cable lengths and sizes for all LV panel → SMDB runs — note size (mm²), estimated length (m), confidence: high=from riser dim / medium=scaled / low=assumed. When scale is NOT detected, mark the length confidence `low` — the system then fills it deterministically from the typical floor height (4 m lead-in + floor index × typical_floor_height_m + 0.5 m), so do NOT default to 15 m+ per floor (that produces 4× over-estimates).
Step 11: Establish SMDB → DB identification and cable size — from schematic, list EVERY individual Distribution Board (DB) fed from each SMDB in db_inventory: one row per DB tag (DB-T01, DB-T02, … DB-T15 — never "DB-T01 to DB-T15"). Also populate db_groups[] alongside as a rollup summary (tag pattern, per-floor qty, total qty, TCL range) — db_groups never replaces db_inventory enumeration.
Step 12: For each SMDB, identify locations of its DBs — from floor plans, confirm DB location per floor
Step 13: Estimate cable size and length for each SMDB → DB run — length from scaled floor plan; confidence flagged. smdb_to_db_cables MUST emit one row per individual DB on each floor, with the `floor` field set. Both kinds of aggregation are FORBIDDEN: tag ranges ("DB-T01 to T15") AND floor qualifiers ("DB-T01 to DB-T15 odd floors", "per typical floor", "1F–8F"). A typical floor with 15 DBs across 8 floors = 120 rows, not 2. They break the take-off audit trail. MEASURE EACH DB'S LENGTH INDIVIDUALLY: trace the route from the SMDB to THAT board's own position on the scaled plan, so a DB at the far end of the floor gets a longer run than one beside the SMDB. Do NOT copy a single length onto every DB on a floor — identical same-floor lengths are valid ONLY when the plan genuinely shows the boards equidistant, and those rows must be flagged confidence "low".
Step 14: Prepare cable schedule — compile every cable entry with unit identification, size (mm²), and length (m). Additionally, populate bulk_cables[] with aggregated final-circuit lengths. Derive every length from THIS building's own typical-floor circuit counts read from the drawing × its number of typical floors; NEVER reuse quantities from any reference or example project. The usual final-circuit families are 4C 1.5mm² (lighting), 4C 2.5mm² (sockets), 4C 4mm² (dedicated circuits), 4C 6mm² (DB sub-mains) — but the lengths MUST come from this drawing, never from an example. Set provisional=true on every bulk_cables row. These are estimates by typical-floor count, not from→to entries.

CABLE ACCURACY RULE (read each cable exactly as annotated): (a) Record each cable's cores / insulation / type AS DRAWN. Single-core wires pulled in conduit are annotated like "4X1C 16mm² CU/PVC/WIRES" or "4×1C … CU/PVC" — these are NOT armoured cable; keep them as CU/PVC singles, do NOT relabel them XLPE/SWA/PVC. Reserve XLPE/SWA/PVC for cables actually annotated armoured, and FIRE RATED / FP / LSZH for fire-rated runs. (b) A board's incomer cable is the one feeding THAT board's OWN incomer terminal — read it off that board's incomer line; do NOT copy a downstream tie / link cable (e.g. an ESMDB-G→ESMDB-RF link) onto the board's incomer. Emergency mains are often large — a 400A emergency SMDB incomer is ~300mm² FR, not 70mm² — so cross-check every incomer cable size against the board's breaker rating (the cable must be able to carry the MCCB/ACB amps).

Drawing-level cross-reference: when KnownFacts.drawings provides a drawing_number for a sheet, propagate it onto every drawings_found[] entry, every db_inventory row (use the drawing where the DB was identified), and every cable row (lv_to_smdb_cables, smdb_to_db_cables, cable_schedule) so each line item carries its source_drawing_number. If no drawing number is known for a row, leave the field null — never invent one.

DATA SOURCE RULE (extract first; estimate is a PER-ROW last resort, NEVER a section-level shortcut): Your PRIMARY task is to READ this drawing — open every sheet, zoom into the legends, panel schedules, cable schedules, general notes and floor plans, and extract the REAL values and counts that are actually drawn, floor by floor. Estimation exists ONLY for individual rows whose value you genuinely cannot find anywhere in the drawing — it is NOT a shortcut to skip reading. Do NOT blanket-estimate a whole section: if the drawing shows the data anywhere, extract it. Set `provisional: true` ONLY on the specific rows you truly could not read (and lower `confidence` for those). A result where most rows of a section are `provisional`, or a cable schedule with only a handful of rows for a multi-floor building, means you did NOT actually read the drawing — go back and enumerate it properly. Never present an estimated value as if it were read, never return `[]` for a required section, and never replace a detailed per-floor take-off with a few round estimated numbers. BELOW-GROUND LEVELS are frequently under-counted: explicitly OPEN and READ every basement / parking and underground / pump-room sheet, and capture their boards (EV-charger SMDB, basement DB, pump-room EDB/DB), EV car chargers, exhaust fans, and fire / jockey / sump / booster / transfer pumps with their feeders — assign them to the correct below-ground floor (Basement, Underground). NEVER leave a basement or underground floor empty when the drawing has a sheet for it.

PER-FLOOR COMPLETENESS RULE (mandatory): every level you list in `floor_labels` (Step 3) is a real floor of this building and MUST appear in the per-floor take-off. When you finish, CROSS-CHECK floor by floor — for EACH `floor_label` (Basement(s), Ground, every typical floor 1F…NF, Mezzanine, Podium/Parking, Amenity/Pool Deck, Plant, Roof / Upper Roof) there must be at least one `power_outlets` row AND at least one `lighting_fixtures` row whose `floor` field is that floor. NEVER leave an established floor with an empty take-off: open that floor's OWN sheet and enumerate its lighting, small power and sockets. The special / named levels — swimming pool deck, health club / gym, amenity, podium, basement / parking, plant room, roof / upper roof — are the ones most often skipped, yet they always carry electrical scope (pool / feature / landscape lighting, maintenance and equipment sockets, pump / exhaust / lift-machine points, stair & lift-lobby lighting); read and count them too. Use the SAME floor name in the `floor` field as you wrote in `floor_labels` so the take-off reconciles floor-by-floor and no floor comes out blank.

Also extract the following BOQ sections from the SLD and floor plans:

INCOMING SUPPLY (Section 2): MANDATORY non-empty whenever an LV single-line diagram / LV panel is present (i.e. every DEWA-fed building). READ the SLD incomer / title block and capture EVERY item: each DEWA transformer (kVA + voltage ratio e.g. 11kV/400V — large buildings often have TWO, e.g. 1000 kVA + 1500 kVA), the standby diesel generator (kVA + type) and its ATS (rating A — note electrical+mechanical interlock / manual bypass), HV duct size and count, and mobile_generator_provision count (DEWA mobile-generator hookup sets, typically 1–2). The transformer is drawn on the incomer even when labelled "BY DEWA" — still list it (it remains a supply line in the BOQ). NEVER return empty transformers when an SLD/LV panel exists — that means you did not read the incomer; go back and read it.
LV PANELS (Section 3): MANDATORY non-empty whenever a main LV panel / MDB exists (it always does on a power SLD). For EACH LV panel (LVP-01, LVP-02 …) read the SLD: main incomer ACB rating (A) and breaking capacity (kA), panel form/type when shown (e.g. Form-4 Type-6), the list of outgoing MCCBs (destination SMDB/feeder, rating A, count), and ALL capacitor / power-factor-correction banks present (P-379-style panels carry multiple, e.g. 275 kVAR + 375 kVAR multi-step automatic) into the capacitor_banks array with each bank's isolator ACB rating (A). A result with SMDBs but an empty lv_panels array means the LV panel was not read — go back and enumerate it.
MECHANICAL EQUIPMENT (Section 6): MANDATORY non-empty for any building with mechanical services (every occupiable building). Read EVERY dedicated equipment feeder drawn on the SLD and the pump-room / roof / basement plans — fire pump, jockey pump, booster / transfer / sump / circulation pumps, FAHU / AHU, pressurization & exhaust fans (staircase, smoke, toilet, car-park), lifts, BMU / cleaning cradle, EV car chargers, swimming-pool pump, sauna, LPG vaporizer, garbage compactor — each with its kW (or A) rating and count, taken from the SLD load labels (e.g. "FAHU 174.66 kW", "FIRE PUMP 98 kW", "E-CAR CHARGER 22 kW", "LIFT 15 kW"). These feeders are explicitly tagged on the SLD; an empty array means the SLD was not read.
NO DUPLICATION (applies to all three sections above and to every section): list each physical item exactly ONCE. A transformer / LV panel / capacitor bank drawn on more than one sheet is still ONE unit — never count it twice. mechanical_equipment is the list of TERMINAL mechanical loads only: do NOT put a DB or SMDB there (those belong only in db_inventory / smdb_inventory), and do NOT re-list a feeder that is already a cable_schedule row — Section 6 is the equipment connection, the cable is counted once in the cable schedule. Likewise never emit the same SMDB, DB, outlet (type, floor) or cable run twice.
POWER OUTLETS (Section 7): read total outlet counts per type from the floor-plan symbols, floor by floor: 13A single, 13A twin, 13A WP, 20A water heater, 20A washing machine, FCU spur, gas ignition, gas detector, hand dryer, floor box, USB, industrial 16A, 20A DP switch, control panel. MANDATORY — this array MUST be non-empty for any building with occupiable area. If a floor's outlet symbols are genuinely not countable at this resolution, do NOT fabricate a quantity — inventing or multiplying a per-unit count by floors produces a DIFFERENT number on every run. Instead read the outlet TYPES from the POWER LEGEND and still emit one row per (type, floor) for that floor with estimated_qty=0 and provisional=true, so the floor/type is represented and flagged for manual take-off. Never return [] because counting is hard, and never guess a count. FLOOR-WISE: emit one row per (type, floor) and set the `floor` field — count each typical floor separately (1F, 2F, … or one row per typical floor) plus Basement / Ground / Roof, so the take-off reads "this floor has X, that floor has Y" and sums to the building total. Do NOT collapse the whole building into a single lump row per type.
LIGHTING FIXTURES (Section 8): populate lighting_fixtures[] — read the fixture type tags from THIS drawing's own lighting legend/schedule (e.g. B-01…B-10, ALD-2…22, D-7…D-13, FE-02, façade FAW/LW). Do NOT invent drawing-specific tags or carry over counts from another project. Count per FLOOR (one row per fixture type per floor) by reading the floor-plan symbols × the floors that repeat; set type_ref to the drawing tag and floor to the floor it is counted for. Where the drawing marks an area "indicative / final design as per ID / client" (gym, amenity, multi-hall, kids play), still list the fitting but set provisional=true. MANDATORY non-empty for any occupiable building — same rule as POWER OUTLETS: do NOT estimate fixture counts from area (a per-area guess such as "1 fixture per 8–10 m²" changes every run). Read the legend tags and count the floor-plan symbols. If a floor or area is genuinely illegible or marked "as per ID / client", still emit the row with a generic description (e.g. "recessed LED downlight"), type_ref null, qty=0 and provisional=true (flagged for manual take-off) rather than guessing a per-area number. Never fabricate a drawing tag you cannot read, and never return []. Only return lighting_fixtures: [] if the building has genuinely no occupiable lit area, and you MUST justify that with a `step_log` entry naming the section and why.
CONTAINMENT (Section 9): estimate cable tray sizes (mm HDGI) and conduit sizes (mm PVC/GI) with estimated lengths (m) or quantities. MANDATORY non-empty — derive tray/trunking lengths from the riser height (floors × typical_floor_height_m) and conduit from the outlet/point count; read sizes from installation-detail notes (e.g. "25mmØ PVC conduit", "HDGI cable tray").
EARTHING (Section 10): earth pits (count), earth cable size and length, surge protection devices. MANDATORY non-empty — earth-pit details, earth-rod spec (e.g. "17.2×3000mm copper"), and main earth cable size (e.g. 70mm²) are almost always in the earthing-detail notes; read them and estimate counts/lengths for the building.
METERING (Section 11): DEWA kWh meters (count), CT meters (count and ratio), IMS if mentioned. MANDATORY non-empty — at minimum one DEWA kWh meter per apartment/tenant DB (= apartment DB count) plus landlord/common CT meters; add IMS/MBUS provision when the notes mention EMPOWER/EMICOOL/ETS.
LOAD SUMMARY (Section 12): for each LV panel — total connected load (kW), standby load (kW), demand factor, maximum demand (kW).

Respond ONLY with valid JSON matching this exact structure:
{
  "drawings_found": [{ "filename": "string", "type": "floor_plan|schematic|riser|schedule|other", "floor": "string or omit", "drawing_number": "string or null", "sheet_number": "string or null", "page_no": "number or null" }],
  "floors_identified": number_or_null,
  "floor_labels": ["string"],
  "typical_floor_height_m": number_or_null,
  "drawing_scale": "string or null",
  "scale_detected": boolean,
  "mdb_info": { "location": "string or null", "rating_a": number_or_null, "floor": "string or null", "tag": "string or null" },
  "schematic_available": boolean,
  "schematic_filename": "string or null",
  "smdb_inventory": [{ "id": "string", "floor": "string", "rating_a": number_or_null, "cable_size_from_mdb": "string or null", "connected_load_kw": number_or_null, "qty": number_or_null }],
  "lv_to_smdb_cables": [{ "from": "string", "to": "string", "size_mm2": number_or_null, "length_m": number_or_null, "route_via": "string or null", "confidence": "high|medium|low", "source_drawing_number": "string or null" }],
  "db_inventory": [{ "smdb_id": "string", "db_id": "string", "floor": "string", "rating_a": number_or_null, "cable_size": "string or null", "source_drawing_number": "string or null" }],
  "db_groups": [{ "tag_pattern": "string", "per_floor_qty": number_or_null, "floors": number_or_null, "total_qty": number, "tcl_range_kw": "string or null" }],
  "smdb_to_db_cables": [{ "from": "string", "to": "string", "size_mm2": number_or_null, "length_m": number_or_null, "confidence": "high|medium|low", "floor": "string or null", "source_drawing_number": "string or null" }],
  "cable_schedule": [{ "from": "string", "to": "string", "size_mm2": number, "length_m": number, "type": "XLPE|fire_rated|LSZH|PVC", "circuit_description": "string or null", "source_drawing_number": "string or null" }],
  "bulk_cables": [{ "specification": "string (e.g. '4C 1.5mm² Cu/PVC final sub-circuits')", "application": "string (e.g. 'Apartments (lighting, sockets)')", "estimated_length_m": number, "provisional": true }],
  "incoming_supply": {
    "transformers": [{ "kva": number, "voltage_ratio": "string", "count": number }],
    "generator": { "kva": number, "type": "diesel" } or null,
    "ats": { "rating_a": number } or null,
    "hv_ducts": { "size_mm": number, "count": number } or null,
    "mobile_generator_provision": { "count": number } or null
  },
  "lv_panels": [{
    "tag": "string",
    "main_acb_rating_a": number_or_null,
    "main_acb_breaking_ka": number_or_null,
    "outgoing_mccbs": [{ "to": "string", "rating_a": number, "count": number }],
    "capacitor_bank_kvar": number_or_null,
    "capacitor_banks": [{ "kvar": number, "isolator_rating_a": number_or_null }]
  }],
  "mechanical_equipment": [{ "description": "string", "rating_kw": number_or_null, "rating_a": number_or_null, "count": number }],
  "power_outlets": [{ "description": "string", "unit": "No.", "estimated_qty": number, "floor": "string (the floor this count is for, e.g. '1F', 'Ground Floor', 'Basement', 'Roof') — one row per (type, floor)", "provisional": "boolean (true only if estimated, not read from the drawing)" }],
  "lighting_fixtures": [{ "type_ref": "string or null (the fixture tag from THIS drawing's legend, e.g. 'B-01', 'ALD-2', 'D-7', 'FE-02')", "description": "string (fitting type read from the legend)", "floor": "string (the floor this count is for)", "qty": number, "provisional": boolean }],
  "containment": [{ "description": "string", "unit": "m or No.", "estimated_qty": number, "provisional": "boolean (true only if estimated, not read)" }],
  "earthing": [{ "description": "string", "unit": "No. or m", "qty": number, "provisional": "boolean (true only if estimated, not read)" }],
  "metering": [{ "description": "string", "qty": number, "provisional": "boolean (true only if estimated, not read)" }],
  "load_summary": [{ "panel": "string", "tcl_kw": number, "standby_kw": number, "demand_factor": number, "max_demand_kw": number }],
  "confidence": number_between_0_and_1,
  "step_log": [{ "step_num": number, "name": "string", "status": "done|not_found|skipped", "finding": "string" }]
}

Text content from drawings:
{{EXTRACTED_TEXT}}
```

---

## Output contract (must hold or the app rejects it)
- Return a **single JSON object** matching the schema above — no markdown, no prose.
- `cable_schedule` MUST be populated when cables exist — an empty array trips the
  app's "0 cables" gate and blocks the BOQ. If you hit the token cap before
  finishing it, the call is treated as truncated (raise max_tokens / split).
- One row per individual DB in `db_inventory` and `smdb_to_db_cables` — no tag
  ranges ("DB-T01 to T15") and no floor qualifiers ("odd floors", "per typical
  floor"); enumerate every (floor, DB) pair with the `floor` field set.
- Arrays default to `[]`, scalars to `null` — never omit a required key.
- The app maps this result straight into the 12-section Power BOQ PDF, so section
  fields (`incoming_supply`, `lv_panels`, `mechanical_equipment`, `power_outlets`,
  `containment`, `earthing`, `metering`, `load_summary`) MUST be populated, not
  left empty. `power_outlets`, `lighting_fixtures`, `containment`, `earthing`, and
  `metering` are
  REQUIRED non-empty for any occupiable building — estimate from the legend +
  building geometry (floors, dwelling count, riser height) when exact symbol
  counts are not legible, and lower `confidence` rather than returning `[]`.
  If a section is genuinely not applicable, you MUST justify the empty array with
  a `step_log` entry naming the section and why — silence is treated as truncation.
