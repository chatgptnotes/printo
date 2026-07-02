/**
 * Electrical sub-pipeline pre-pass — replaces several AI-derived findings with
 * deterministic regex/lookup work BEFORE the Claude vision call.
 *
 * Targets electrical procedure Steps 2, 4, 6, 7 (and partially 5 + 11):
 *   Step 2  — List Available Drawings  → filename classification
 *   Step 4  — Find Drawing Scale       → regex on extracted text
 *   Step 5  — Identify LV Room / MDB   → regex on extracted text
 *   Step 6  — Schematic Availability   → filename match
 *   Step 7  — SMDBs from LV Panel      → regex on schematic text
 *  Step 11 — SMDB → DB identification  → regex on schematic text
 *
 * Output is a partial `ElectricalProcedureResult` slice that the caller can:
 *   (a) merge into the final result if Claude returns null/empty for that field
 *   (b) inject into the Claude prompt as "already-known facts" so Sonnet
 *       doesn't waste output tokens re-deriving them.
 */

export interface ElectricalPrePassResult {
  drawings_found: Array<{ filename: string; type: string; floor?: string }>;
  drawing_scale: string | null;
  scale_detected: boolean;
  schematic_available: boolean;
  schematic_filename: string | null;
  mdb_info: { tag: string | null; rating_a: number | null; floor: string | null };
  smdb_inventory: Array<{ id: string; floor: string; rating_a: number | null; cable_size_from_mdb: string | null }>;
  db_inventory: Array<{ smdb_id: string; db_id: string; floor: string; rating_a: number | null; cable_size: string | null }>;
  // Free-form text snippet to inject into the AI prompt as context
  context_block: string;
  // Per-field provenance for debugging/auditing
  source: 'pre-pass';
}

interface AttachmentLike {
  filename: string;
  text?: string | null;
}

const FLOOR_TOKENS = [
  { re: /\b(?:basement|bsmt|b1|b2)\b/i, label: 'Basement' },
  { re: /\b(?:ground[\s_-]?floor|gnd|gf)\b/i, label: 'Ground' },
  { re: /\b(?:mezzanine|mez)\b/i, label: 'Mezzanine' },
  { re: /\b(?:roof|terrace)\b/i, label: 'Roof' },
];

export function runElectricalPrePass(
  attachments: AttachmentLike[],
): ElectricalPrePassResult {
  const drawings_found: ElectricalPrePassResult['drawings_found'] = [];
  let schematic_filename: string | null = null;
  let schematic_text = '';
  let combined_text = '';

  for (const att of attachments) {
    const fn = (att.filename || '').toLowerCase();
    const type = classifyDrawingType(fn);
    const floor = inferFloor(fn);
    drawings_found.push({ filename: att.filename, type, ...(floor ? { floor } : {}) });

    if (type === 'schematic' && !schematic_filename) {
      schematic_filename = att.filename;
      schematic_text = att.text || '';
    }
    if (att.text) combined_text += '\n' + att.text;
  }

  // Step 4 — drawing scale (search schematic first, then any text)
  const scaleSource = schematic_text || combined_text;
  const scaleMatch = scaleSource.match(/\b1\s*[:×x]\s*(\d{2,4})\b/i);
  const drawing_scale = scaleMatch ? `1:${scaleMatch[1]}` : null;

  // Step 5 — MDB / LV panel tag + rating
  const mdb_info = extractMdbInfo(combined_text);

  // Step 7 — SMDB inventory from schematic text
  const smdb_inventory = extractSmdbInventory(schematic_text || combined_text);

  // Step 11 — DB tags by SMDB (best-effort)
  const db_inventory = extractDbInventory(schematic_text || combined_text, smdb_inventory);

  // Build a context block to inject into the AI prompt — saves Sonnet from
  // re-deriving these and keeps its output focused on the vision-only steps.
  const lines: string[] = [];
  lines.push('## Pre-pass findings (already extracted from drawing text — confirm or extend, do not re-derive)');
  lines.push(`Drawings found: ${drawings_found.length}`);
  if (drawing_scale) lines.push(`Drawing scale: ${drawing_scale}`);
  if (schematic_filename) lines.push(`Schematic file: ${schematic_filename}`);
  else lines.push('Schematic file: NOT FOUND in attachment list');
  if (mdb_info.tag || mdb_info.rating_a) {
    lines.push(`MDB candidate: tag=${mdb_info.tag ?? '?'} rating=${mdb_info.rating_a ?? '?'}A floor=${mdb_info.floor ?? '?'}`);
  }
  if (smdb_inventory.length > 0) {
    lines.push(`SMDB candidates (${smdb_inventory.length}):`);
    for (const s of smdb_inventory.slice(0, 30)) {
      lines.push(`  - ${s.id} floor=${s.floor} rating=${s.rating_a ?? '?'}A cable=${s.cable_size_from_mdb ?? '?'}`);
    }
  }
  const context_block = lines.join('\n');

  return {
    drawings_found,
    drawing_scale,
    scale_detected: drawing_scale !== null,
    schematic_available: schematic_filename !== null,
    schematic_filename,
    mdb_info,
    smdb_inventory,
    db_inventory,
    context_block,
    source: 'pre-pass',
  };
}

function classifyDrawingType(fn: string): string {
  if (/(?:sld|single[\s_-]?line|schematic|riser[\s_-]?diagram)/i.test(fn)) return 'schematic';
  if (/riser/i.test(fn)) return 'riser';
  if (/(?:schedule|panel[\s_-]?schedule|cable[\s_-]?schedule|load[\s_-]?schedule)/i.test(fn)) return 'schedule';
  if (/(?:floor[\s_-]?plan|layout|plan|power|lighting)/i.test(fn)) return 'floor_plan';
  return 'other';
}

function inferFloor(fn: string): string | null {
  for (const t of FLOOR_TOKENS) {
    if (t.re.test(fn)) return t.label;
  }
  const m = fn.match(/\b(\d{1,2})[\s_-]?f(?:loor)?\b/i);
  if (m) return `${m[1]}F`;
  return null;
}

function extractMdbInfo(text: string): ElectricalPrePassResult['mdb_info'] {
  if (!text) return { tag: null, rating_a: null, floor: null };
  const tagRe = /\b(?:LVP[-\s]?\d{1,3}|MDB[-\s]?\d{0,3}|MAIN\s+DB)\b/i;
  const tagMatch = text.match(tagRe);
  const tag = tagMatch ? tagMatch[0].toUpperCase().replace(/\s+/g, '-') : null;

  // Rating in A within ~80 chars of the tag
  let rating_a: number | null = null;
  if (tagMatch) {
    const around = text.substring(Math.max(0, tagMatch.index! - 80), tagMatch.index! + 200);
    const ampMatch = around.match(/(\d{3,4})\s*A\b/);
    if (ampMatch) rating_a = parseInt(ampMatch[1], 10);
  }

  // Floor — most MDBs are on Ground or Basement
  let floor: string | null = null;
  if (/ground[\s_-]?floor|\bgf\b/i.test(text)) floor = 'Ground';
  else if (/basement|\bb1\b/i.test(text)) floor = 'Basement';

  return { tag, rating_a, floor };
}

function extractSmdbInventory(text: string): ElectricalPrePassResult['smdb_inventory'] {
  if (!text) return [];
  const out: ElectricalPrePassResult['smdb_inventory'] = [];
  const seen = new Set<string>();

  // SMDB tags can be SMDB-1F, SMDB-GF, SMDB-B01-A, SMDB1, etc.
  const re = /\bSMDB[-\s]?[A-Z0-9]{1,8}(?:-[A-Z0-9]{1,4})?\b/gi;
  for (const m of text.matchAll(re)) {
    const id = m[0].toUpperCase().replace(/\s+/g, '-');
    if (seen.has(id)) continue;
    seen.add(id);

    const around = text.substring(Math.max(0, m.index! - 60), m.index! + 200);
    const ampMatch = around.match(/(\d{2,4})\s*A\b/);
    const cableMatch = around.match(/(\d)\s*C\s*[x×]?\s*(\d+(?:\.\d+)?)\s*mm[²2]?/i);

    let floor = '';
    const floorTokenMatch = id.match(/-?(\d{1,2}F|GF|B\d?|R)\b/i);
    if (floorTokenMatch) floor = floorTokenMatch[1].toUpperCase();

    out.push({
      id,
      floor,
      rating_a: ampMatch ? parseInt(ampMatch[1], 10) : null,
      cable_size_from_mdb: cableMatch ? `${cableMatch[1]}C×${cableMatch[2]}mm²` : null,
    });
  }

  return out.slice(0, 100);
}

function extractDbInventory(
  text: string,
  smdbs: ElectricalPrePassResult['smdb_inventory'],
): ElectricalPrePassResult['db_inventory'] {
  if (!text || smdbs.length === 0) return [];
  const out: ElectricalPrePassResult['db_inventory'] = [];
  const seen = new Set<string>();

  // Match DB-T01, DB-1, DB1A, etc. — exclude already-matched SMDBs.
  const re = /\bDB[-\s]?[A-Z]?\d{1,3}[A-Z]?\b/gi;
  for (const m of text.matchAll(re)) {
    const id = m[0].toUpperCase().replace(/\s+/g, '-');
    if (id.startsWith('SMDB')) continue;
    const key = id;
    if (seen.has(key)) continue;
    seen.add(key);

    const around = text.substring(Math.max(0, m.index! - 60), m.index! + 200);
    const ampMatch = around.match(/(\d{1,3})\s*A\b/);
    const cableMatch = around.match(/(\d)\s*C\s*[x×]?\s*(\d+(?:\.\d+)?)\s*mm[²2]?/i);

    out.push({
      smdb_id: smdbs[0]?.id ?? '',
      db_id: id,
      floor: '',
      rating_a: ampMatch ? parseInt(ampMatch[1], 10) : null,
      cable_size: cableMatch ? `${cableMatch[1]}C×${cableMatch[2]}mm²` : null,
    });
  }

  return out.slice(0, 200);
}
