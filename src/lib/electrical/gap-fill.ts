// Targeted gap-fill retry — the "re-scan once" step.
//
// When the post-scan validator (scan-validation.ts) finds REQUIRED sections that
// came back empty, the scan paths make ONE focused follow-up AI call that
// re-reads the SAME drawings looking only for those sections, then merges the
// result back in. This is cheaper + faster than a full re-scan and embodies the
// "extract from file, no assumption" rule: re-read for the real value first;
// only estimate (and mark `provisional`) as a last resort.
//
// This module is PURE (prompt builder + merge) — the AI call itself is made by
// the caller using its existing transport: the in-process path via
// gapFillElectricalSections() in claude-api.ts, the worker via its own JS port
// of buildGapFillPrompt/mergeGapFill in worker/server.js (KEEP IN SYNC).

// Per-section JSON schema fragment the gap-fill prompt asks Claude to return.
// Only the requested keys are emitted. `provisional` is included so estimates
// are labelled.
export const GAP_FILL_SCHEMAS: Record<string, string> = {
  lighting_fixtures:
    '"lighting_fixtures": [{ "type_ref": "string or null", "description": "string", "floor": "string", "qty": number, "provisional": boolean }]',
  power_outlets:
    '"power_outlets": [{ "description": "string", "unit": "No.", "estimated_qty": number, "floor": "string", "provisional": boolean }]',
  containment:
    '"containment": [{ "description": "string", "unit": "m or No.", "estimated_qty": number, "provisional": boolean }]',
  earthing:
    '"earthing": [{ "description": "string", "unit": "No. or m", "qty": number, "provisional": boolean }]',
  metering: '"metering": [{ "description": "string", "qty": number, "provisional": boolean }]',
  mechanical_equipment:
    '"mechanical_equipment": [{ "description": "string", "rating_kw": number_or_null, "rating_a": number_or_null, "count": number }]',
  lv_panels:
    '"lv_panels": [{ "tag": "string", "main_acb_rating_a": number_or_null, "main_acb_breaking_ka": number_or_null, "outgoing_mccbs": [{ "to": "string", "rating_a": number, "count": number }], "capacitor_banks": [{ "kvar": number, "isolator_rating_a": number_or_null }] }]',
  load_summary:
    '"load_summary": [{ "panel": "string", "tcl_kw": number, "standby_kw": number, "demand_factor": number, "max_demand_kw": number }]',
  smdb_inventory:
    '"smdb_inventory": [{ "id": "string", "floor": "string", "rating_a": number_or_null, "cable_size_from_mdb": "string or null", "qty": number_or_null }]',
  db_inventory:
    '"db_inventory": [{ "smdb_id": "string", "db_id": "string", "floor": "string", "rating_a": number_or_null, "cable_size": "string or null" }]',
  incoming_supply:
    '"incoming_supply": { "transformers": [{ "kva": number, "voltage_ratio": "string", "count": number }], "generator": { "kva": number, "type": "diesel" } or null, "ats": { "rating_a": number } or null }',
};

// Human-readable section labels for the prompt.
const GAP_FILL_LABELS: Record<string, string> = {
  lighting_fixtures: 'Lighting fixtures (Section 8)',
  power_outlets: 'Power outlets (Section 7)',
  containment: 'Containment — tray/trunking/conduit (Section 9)',
  earthing: 'Earthing & lightning protection (Section 10)',
  metering: 'Metering (Section 11)',
  mechanical_equipment: 'Mechanical equipment feeders (Section 6)',
  lv_panels: 'LV panels (Section 3)',
  load_summary: 'Load summary (Section 12)',
  smdb_inventory: 'SMDB inventory',
  db_inventory: 'DB inventory',
  incoming_supply: 'Incoming supply — transformers (Section 2)',
};

// Keys this module knows how to gap-fill. Anything else is ignored.
export function gapFillableSections(sections: string[]): string[] {
  return sections.filter((s) => s in GAP_FILL_SCHEMAS);
}

export function buildGapFillPrompt(
  sections: string[],
  buildingInfo: { floors?: number | null; area_sqft?: number | null; building_type?: string | null },
  extractedText = '',
): string {
  const keys = gapFillableSections(sections);
  const labelLines = keys.map((k) => `  - ${GAP_FILL_LABELS[k] || k}`).join('\n');
  const schemaLines = keys.map((k) => `  ${GAP_FILL_SCHEMAS[k]}`).join(',\n');
  return `You are an MEP electrical estimator re-checking a Dubai, UAE drawing set you already scanned.

Building: ${buildingInfo.floors || '?'} floors, ${buildingInfo.area_sqft || '?'} sqft, ${buildingInfo.building_type || 'unknown'} type.

Your first pass did NOT return these sections. Re-read the SAME drawings — check EVERY sheet, the legend/keys, the schedules, and the general notes — and fill ONLY these:
${labelLines}

Rules (strict):
- EXTRACT from the drawing first. Read the real values that are actually shown. Do NOT assume.
- Count per floor where the section is floor-wise (set the \`floor\` field), Basement → Roof.
- ONLY if a value genuinely is not present/legible in the drawing, you may estimate it from the building geometry (floors, dwelling/room count, riser height) as a LAST RESORT — and you MUST set \`provisional\`: true on every such row and keep counts conservative. Never mark an estimate as if it were read from the drawing.
- Do NOT touch, repeat, or change any other section.

Respond ONLY with a single JSON object containing exactly these keys (no prose, no markdown):
{
${schemaLines}
}

Text content from drawings:
${(extractedText || '').substring(0, 12000)}`;
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

// ── Per-floor completeness ────────────────────────────────────────────────
// Floor-wise sections that drive the per-floor BOQ tables (Bills 7 & 8). When a
// floor was established in floor_labels (Step 3) but produced NO rows here, the
// floor gap-fill re-reads just that floor's sheet and appends.
export const FLOOR_WISE_SECTIONS = ['power_outlets', 'lighting_fixtures'] as const;

const FLOOR_ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
  eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13,
  fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18,
  nineteenth: 19, twentieth: 20,
};

// Canonical floor key — collapses the many ways one level gets written
// ("First Floor" / "1F" / "Level 1", "Upper Roof" / "Roof", "Basement 1" / "B1",
// "Swimming Pool Deck" / "Pool Deck") to a single token, so a floor established
// in floor_labels can be matched against the `floor` field on outlet / lighting /
// DB / SMDB rows. Loose by design: this only drives a FLAG (which floors look
// empty) and a targeted re-read — never a block. KEEP IN SYNC with the JS port
// in worker/server.js.
export function canonFloorKey(raw: string | null | undefined): string {
  let t = String(raw ?? '').toLowerCase().trim();
  if (!t) return '';
  for (const w of Object.keys(FLOOR_ORDINALS)) {
    t = t.replace(new RegExp(`\\b${w}\\b`, 'g'), String(FLOOR_ORDINALS[w]));
  }
  if (/\broof\s*top\b|\bupper\s*roof\b|\broof\b|\bterrace\b/.test(t)) return 'roof';
  if (/penthouse|\bph\b/.test(t)) return 'penthouse';
  if (/mezz/.test(t)) return 'mezzanine';
  if (/sub.?basement|basement|cellar|\bb\d\b/.test(t)) { const m = t.match(/(\d+)/); return 'basement' + (m ? m[1] : '1'); }
  if (/lower\s*ground|\blg\b/.test(t)) return 'basement1';
  if (/\bground\b|\bgf\b|\bg\.?f\b|\blobby\b/.test(t) && !/upper\s*ground/.test(t)) return 'ground';
  if (/upper\s*ground|\bug\b/.test(t)) return 'ground';
  if (/podium|car\s*park|parking/.test(t)) { const m = t.match(/(\d+)/); return 'podium' + (m ? m[1] : '1'); }
  const num = t.match(/(\d{1,2})/);
  if (
    num &&
    /\b\d{1,2}\s*(?:st|nd|rd|th)?\s*(?:f|fl|flr|floor)\b|\b(?:f|fl|flr|floor|level|lvl|l)\s*\.?\s*\d{1,2}\b|^\s*\d{1,2}\s*$/.test(t)
  ) {
    return 'f' + num[1];
  }
  // generic named floor (swimming pool deck, amenity, health club, gym, plant…)
  return 'n:' + t.replace(/[^a-z0-9]+/g, ' ').trim();
}

// A label is "covered" when its canonical key matches a section key exactly, or —
// for generic named floors — shares any token (so "Swimming Pool Deck" is covered
// by a row tagged "Pool Deck").
export function floorIsCovered(labelKey: string, sectionKeys: Set<string>): boolean {
  if (!labelKey) return true; // unparseable → don't flag
  if (sectionKeys.has(labelKey)) return true;
  if (labelKey.startsWith('n:')) {
    const lt = labelKey.slice(2).split(' ').filter(Boolean);
    for (const sk of sectionKeys) {
      if (!sk.startsWith('n:')) continue;
      const st = new Set(sk.slice(2).split(' '));
      if (lt.some((x) => st.has(x))) return true;
    }
  }
  return false;
}

// One focused re-read prompt for floors that came back EMPTY. Re-reads only those
// floors' sheets for the floor-wise sections and tags rows with the floor name
// EXACTLY as listed, so mergeFloorGapFill can append them.
export function buildFloorGapFillPrompt(
  emptyFloors: string[],
  buildingInfo: { floors?: number | null; area_sqft?: number | null; building_type?: string | null },
  extractedText = '',
): string {
  const floorList = emptyFloors.map((f) => `  - ${f}`).join('\n');
  const schemaLines = FLOOR_WISE_SECTIONS.map((k) => `  ${GAP_FILL_SCHEMAS[k]}`).join(',\n');
  return `You are an MEP electrical estimator re-checking a Dubai, UAE drawing set you already scanned.

Building: ${buildingInfo.floors || '?'} floors, ${buildingInfo.area_sqft || '?'} sqft, ${buildingInfo.building_type || 'unknown'} type.

Your first pass produced a take-off for the other floors but returned NOTHING for these floors — they are MISSING from the power-outlet and lighting take-off:
${floorList}

Open the sheet(s) for EACH of these floors and read them properly. These are real levels of this building (basement / parking, plant / roof, pool deck, amenity, podium) and they DO carry electrical scope — lighting, small power and sockets, plus pump / exhaust / equipment and feature / pool / landscape points. Enumerate per floor:
  - power_outlets — one row per (type, floor)
  - lighting_fixtures — one row per fixture type per floor

Rules (strict):
- EXTRACT from the drawing first; read what is actually drawn on that floor's own sheet. Do NOT assume.
- Set the \`floor\` field to the floor name EXACTLY as written in the list above so it merges correctly.
- If a floor genuinely has little occupiable area (open roof, plant deck, void), still return at minimum its maintenance / stair / lift-lobby / plant lighting and sockets, and set \`provisional\`: true on those rows.
- Estimation is a LAST RESORT only — set \`provisional\`: true on any estimated row. Never return an empty take-off for a listed floor.
- Do NOT touch, repeat, or change any floor that is not listed above.

Respond ONLY with a single JSON object containing exactly these keys (no prose, no markdown):
{
${schemaLines}
}

Text content from drawings:
${(extractedText || '').substring(0, 12000)}`;
}

// Append re-read rows for the empty floors into the floor-wise sections. Only
// rows whose floor matches a requested empty floor AND is not already present get
// appended — so already-populated floors are never touched or double-counted.
export function mergeFloorGapFill<T>(
  result: T,
  gap: Record<string, unknown> | null | undefined,
  emptyFloors: string[],
): T {
  if (!gap || typeof gap !== 'object') return result;
  const targetKeys = new Set(emptyFloors.map(canonFloorKey).filter(Boolean));
  if (targetKeys.size === 0) return result;
  const merged: Record<string, unknown> = { ...(result as Record<string, unknown>) };
  for (const key of FLOOR_WISE_SECTIONS) {
    const existing = arr(merged[key]) as Array<{ floor?: string | null }>;
    const present = new Set(existing.map((row) => canonFloorKey(row?.floor)).filter(Boolean));
    const incoming = (arr(gap[key]) as Array<{ floor?: string | null }>).filter((row) => {
      const k = canonFloorKey(row?.floor);
      return k !== '' && targetKeys.has(k) && !present.has(k);
    });
    if (incoming.length > 0) merged[key] = [...existing, ...incoming];
  }
  return merged as T;
}

// Merge gap-fill output into the result: for each requested section, replace
// ONLY when it was empty in `result` and the gap call returned something.
// Never overwrite already-populated data. Returns a new object.
export function mergeGapFill<T>(
  result: T,
  gap: Record<string, unknown> | null | undefined,
  sections: string[],
): T {
  if (!gap || typeof gap !== 'object') return result;
  const merged: Record<string, unknown> = { ...(result as Record<string, unknown>) };
  for (const key of gapFillableSections(sections)) {
    if (key === 'incoming_supply') {
      const current = (merged.incoming_supply as { transformers?: unknown[] } | null) || null;
      const incoming = (gap.incoming_supply as { transformers?: unknown[] } | null) || null;
      if (arr(current?.transformers).length === 0 && arr(incoming?.transformers).length > 0) {
        merged.incoming_supply = incoming;
      }
      continue;
    }
    if (arr(merged[key]).length === 0 && arr(gap[key]).length > 0) {
      merged[key] = gap[key];
    }
  }
  return merged as T;
}
