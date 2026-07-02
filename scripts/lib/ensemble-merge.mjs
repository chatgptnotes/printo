// 5-agent consensus merge for electrical drawing scans — REFERENCE IMPLEMENTATION.
//
// Pure, deterministic, dependency-free ESM. Takes the N raw ElectricalProcedure
// results from N independent scans of the SAME drawing and merges them into one
// consensus result + an agreement report ("confirmed by k/N agents").
//
// Rules (see plan there-is-point-like-snoopy-lantern.md §Phase 3):
//   inclusion  union   — recall-critical structural sections (cables, boards,
//                        inventories, outlets, lighting): keep an item ANY run
//                        found, so a single sharp run is never out-voted.
//              majority — noisy free-text lists (containment/earthing/metering):
//                        keep only items >= MAJORITY runs found.
//   numeric    median  — resists one wild run (lower-mid on ties = deterministic).
//   categorical plurality — most common value, lexicographic tie-break.
//   provisional majority of the bucket's rows.
//   floor      vote over canonFloorKey, emit the modal original label.
//   agreement  presence/R per item, folded into a per-section + per-row report.
//
// Determinism: every bucket list is sorted by key before reducing, so
// mergeEnsembleResults([a,b,c]) deep-equals mergeEnsembleResults([c,a,b]).
//
// This is the implementation we unit-test offline and run from the eval harness.
// Once Phase 0 validates the approach it gets ported to the canonical
// src/lib/electrical/ensemble-merge.ts + the worker/server.js JS port — KEEP IN
// SYNC at that point.

// ----------------------------------------------------------------------------
// Canonical keys
// ----------------------------------------------------------------------------

const FLOOR_ORDINALS = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
  eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13,
  fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18,
  nineteenth: 19, twentieth: 20,
};

// Faithful copy of canonFloorKey() in src/lib/electrical/gap-fill.ts — KEEP IN SYNC.
export function canonFloorKey(raw) {
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
  return 'n:' + t.replace(/[^a-z0-9]+/g, ' ').trim();
}

// Tag identity is positional — uppercase + strip non-alphanumerics, keep digits
// so DB-T01 != DB-T10 != DB-T1.
export function canonTag(s) {
  return String(s ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

// Ordered so multi-word phrases collapse before single words. Applied before
// punctuation-strip so "socket outlet" matches.
const DESC_SYNONYMS = [
  [/(\d+)\s*a(?:mp(?:ere)?s?)?\b/g, '$1a'],                 // 13 amp / 13 amps / 13a -> 13a
  [/socket\s*outlets?\b|sockets?\b|\bsso\b/g, 'socket'],
  [/\btwin\b|\bdouble\b|\b2\s*g(?:ang)?\b/g, 'twin'],
  [/\bsingle\b|\b1\s*g(?:ang)?\b/g, 'single'],
  [/\bweather\s*proof\b|\bwp\b/g, 'wp'],
  [/\bluminaires?\b|\bfittings?\b|lighting\s*fixtures?|light\s*fixtures?|down\s*lights?\b/g, 'light'],
  [/cable\s*trays?\b|\btrays?\b/g, 'tray'],
  [/\bnos?\b|\bqty\b|\bpcs\b|\bpieces?\b|\bunits?\b/g, ''],
];
const STOPWORDS = new Set(['the', 'for', 'of', 'with', 'type', 'a', 'an', 'and', 'to']);

// Word-order-independent canonical description. Deterministic, no fuzzy/LLM.
export function canonDesc(s) {
  let t = String(s ?? '').toLowerCase();
  for (const [re, rep] of DESC_SYNONYMS) t = t.replace(re, rep);
  t = t.replace(/[^a-z0-9]+/g, ' ').trim();
  const toks = t.split(/\s+/).filter((w) => w && !STOPWORDS.has(w));
  toks.sort();
  return toks.join(' ');
}

// ----------------------------------------------------------------------------
// Field-type tables for per-attribute reconciliation
// ----------------------------------------------------------------------------

const NUMERIC = new Set([
  'size_mm2', 'length_m', 'rating_a', 'estimated_qty', 'qty', 'connected_load_kw',
  'rating_kw', 'kva', 'kvar', 'count', 'main_acb_rating_a', 'main_acb_breaking_ka',
  'isolator_rating_a', 'capacitor_bank_kvar', 'per_floor_qty', 'floors', 'total_qty',
  'demand_factor', 'tcl_kw', 'standby_kw', 'max_demand_kw', 'page_no', 'size_mm',
  'estimated_length_m', 'rating',
]);
const INTEGER = new Set(['count', 'qty', 'estimated_qty', 'floors', 'per_floor_qty', 'total_qty', 'page_no']);
const BOOL_MAJORITY = new Set(['provisional', 'scale_detected', 'schematic_available']);
// Nested arrays inside lv_panels — merged separately, not by reconcileRow.
const NESTED_SKIP = new Set(['outgoing_mccbs', 'capacitor_banks']);

// ----------------------------------------------------------------------------
// Reducers
// ----------------------------------------------------------------------------

function median(values) {
  const a = values
    .filter((v) => v != null && Number.isFinite(Number(v)))
    .map(Number)
    .sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = (a.length - 1) >> 1; // lower-mid -> always an existing value, deterministic
  return a[mid];
}

function medianField(values, integer) {
  const m = median(values);
  if (m == null) return null;
  return integer ? Math.floor(m + 0.5) : m; // round half up
}

// Most frequent value; tie -> lexicographically smallest normalized form.
// Emits the original (un-normalized) value of the winner.
function plurality(values) {
  const counts = new Map(); // normKey -> { count, orig }
  for (const v of values) {
    if (v == null || v === '') continue;
    const k = String(v).trim().toLowerCase();
    if (!counts.has(k)) counts.set(k, { count: 0, orig: v });
    counts.get(k).count++;
  }
  if (!counts.size) return null;
  const sorted = [...counts.entries()].sort((a, b) => b[1].count - a[1].count || (a[0] < b[0] ? -1 : 1));
  return sorted[0][1].orig;
}

// provisional/flags: true only if a strict majority of the bucket's rows say true.
function majorityTrue(values) {
  const present = values.filter((v) => v != null);
  if (!present.length) return false;
  const t = present.filter((v) => v === true).length;
  return t * 2 > present.length;
}

function voteFloor(values) {
  const byKey = new Map(); // canonKey -> Map(originalLabel -> count)
  for (const v of values) {
    if (v == null || v === '') continue;
    const key = canonFloorKey(v);
    if (!byKey.has(key)) byKey.set(key, new Map());
    const labels = byKey.get(key);
    labels.set(v, (labels.get(v) || 0) + 1);
  }
  if (!byKey.size) return values.find((v) => v != null) ?? null;
  let bestKey = null;
  let bestCount = -1;
  for (const [key, labels] of [...byKey.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const c = [...labels.values()].reduce((s, x) => s + x, 0);
    if (c > bestCount) { bestCount = c; bestKey = key; }
  }
  const labels = byKey.get(bestKey);
  let bestLabel = null;
  let bc = -1;
  for (const [lab, c] of [...labels.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (c > bc) { bc = c; bestLabel = lab; }
  }
  return bestLabel;
}

function mode(values, tieHigh = true) {
  const counts = new Map();
  for (const v of values) if (v != null) counts.set(v, (counts.get(v) || 0) + 1);
  if (!counts.size) return null;
  let best = null;
  let bc = -1;
  for (const [v, c] of [...counts.entries()].sort((a, b) => (tieHigh ? b[0] - a[0] : a[0] - b[0]))) {
    if (c > bc) { bc = c; best = v; }
  }
  return best;
}

// Reduce a bucket of rows (one or more per contributing run) into one row.
function reconcileRow(rows) {
  const out = {};
  const keys = new Set();
  for (const r of rows) for (const k of Object.keys(r || {})) keys.add(k);
  for (const k of keys) {
    if (NESTED_SKIP.has(k)) continue;
    const vals = rows.map((r) => (r ? r[k] : undefined)).filter((v) => v !== undefined);
    if (k === 'floor') { out[k] = voteFloor(vals); continue; }
    if (BOOL_MAJORITY.has(k)) { out[k] = majorityTrue(vals.map((v) => v === true)); continue; }
    if (NUMERIC.has(k)) { out[k] = medianField(vals, INTEGER.has(k)); continue; }
    const objVals = vals.filter((v) => v && typeof v === 'object');
    if (objVals.length) { out[k] = objVals[0]; continue; }
    out[k] = plurality(vals);
  }
  return out;
}

// lv_panels carry nested arrays; merge them by their own keys.
function reconcileLvPanel(rows) {
  const out = reconcileRow(rows);
  const mccbRuns = rows.map((r) => (Array.isArray(r?.outgoing_mccbs) ? r.outgoing_mccbs : []));
  const capRuns = rows.map((r) => (Array.isArray(r?.capacitor_banks) ? r.capacitor_banks : []));
  out.outgoing_mccbs = mergeRows(mccbRuns, rows.length, 'union', (r) => canonTag(r.to), false).rows;
  out.capacitor_banks = mergeRows(capRuns, rows.length, 'union', (r) => `${r.kvar}`, false).rows;
  return out;
}

// ----------------------------------------------------------------------------
// Bucketing + Jaccard near-duplicate collapse
// ----------------------------------------------------------------------------

const KEY_FNS = {
  cable_schedule: (r) => `${canonTag(r.from)}>${canonTag(r.to)}`,
  lv_to_smdb_cables: (r) => `${canonTag(r.from)}>${canonTag(r.to)}`,
  smdb_to_db_cables: (r) => `${canonTag(r.from)}>${canonTag(r.to)}`,
  smdb_inventory: (r) => `${canonTag(r.id)}@${canonFloorKey(r.floor)}`,
  db_inventory: (r) => `${canonTag(r.smdb_id)}/${canonTag(r.db_id)}@${canonFloorKey(r.floor)}`,
  power_outlets: (r) => `${canonDesc(r.description)}@${canonFloorKey(r.floor)}`,
  lighting_fixtures: (r) => `${r.type_ref ? canonTag(r.type_ref) : canonDesc(r.description)}@${canonFloorKey(r.floor)}`,
  containment: (r) => canonDesc(r.description),
  earthing: (r) => canonDesc(r.description),
  metering: (r) => canonDesc(r.description),
  mechanical_equipment: (r) => canonDesc(r.description),
  lv_panels: (r) => canonTag(r.tag),
  load_summary: (r) => canonDesc(r.panel),
  db_groups: (r) => canonDesc(r.tag_pattern),
  bulk_cables: (r) => canonDesc(r.specification),
  drawings_found: (r) => canonDesc(r.filename),
};

export function keyFor(section, row) {
  const fn = KEY_FNS[section];
  return fn ? fn(row) : canonDesc(JSON.stringify(row));
}

const SECTIONS_WITH_FLOOR_DESC_KEY = new Set(['power_outlets', 'lighting_fixtures']);

function leadingNumToken(desc) {
  const m = desc.match(/\b(\d+[a-z]?)\b/);
  return m ? m[1] : '';
}

function jaccard(aSet, bSet) {
  let inter = 0;
  for (const x of aSet) if (bSet.has(x)) inter++;
  const uni = aSet.size + bSet.size - inter;
  return uni === 0 ? 0 : inter / uni;
}

// Confluent union-find over description-keyed buckets: collapse two buckets whose
// token sets are Jaccard>=0.6 AND share the same floor part AND the same leading
// numeric token ("13a"). Never merges across floors. Single pass over a sorted
// list, smaller key folds into larger -> order-independent.
function collapseNearDuplicates(buckets, withFloor) {
  const entries = [...buckets.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const parent = new Map(entries.map(([k]) => [k, k]));
  const find = (k) => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
  const meta = new Map();
  for (const [k] of entries) {
    const [descPart, floorPart = ''] = withFloor ? splitFloor(k) : [k, ''];
    meta.set(k, { tokens: new Set(descPart.split(' ').filter(Boolean)), floor: floorPart, num: leadingNumToken(descPart) });
  }
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i][0];
      const b = entries[j][0];
      const ma = meta.get(a);
      const mb = meta.get(b);
      if (ma.floor !== mb.floor) continue;
      if (ma.num !== mb.num) continue;
      if (jaccard(ma.tokens, mb.tokens) >= 0.6) {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb); // fold into lexicographically smaller
      }
    }
  }
  const merged = new Map(); // rep -> { runs:Set, rows:[] }
  for (const [k, info] of entries) {
    const rep = find(k);
    if (!merged.has(rep)) merged.set(rep, { runs: new Set(), rows: [] });
    const m = merged.get(rep);
    for (const ri of info.runs) m.runs.add(ri);
    m.rows.push(...info.rows);
  }
  return merged;
}

function splitFloor(key) {
  const at = key.lastIndexOf('@');
  return at === -1 ? [key, ''] : [key.slice(0, at), key.slice(at + 1)];
}

// Core array-section merge. runsRows: array (per run) of row arrays.
function mergeRows(runsRows, R, inclusion, keyFn, jaccardPass, withFloorKey = false) {
  const buckets = new Map(); // key -> { runs:Set<runIdx>, rows:[] }
  runsRows.forEach((rows, runIdx) => {
    for (const row of Array.isArray(rows) ? rows : []) {
      const key = keyFn(row);
      if (!buckets.has(key)) buckets.set(key, { runs: new Set(), rows: [] });
      const b = buckets.get(key);
      b.runs.add(runIdx);
      b.rows.push(row);
    }
  });
  const collapsed = jaccardPass ? collapseNearDuplicates(buckets, withFloorKey) : buckets;
  const MAJORITY = Math.floor(R / 2) + 1;
  const kept = [];
  for (const [key, b] of [...collapsed.entries()].sort((a, c) => (a[0] < c[0] ? -1 : 1))) {
    const presence = b.runs.size;
    if (inclusion === 'majority' && presence < MAJORITY) continue;
    kept.push({ key, presence, row: b.rows });
  }
  return { rows: kept.map((k) => k.row), entries: kept };
}

// ----------------------------------------------------------------------------
// Top-level merge
// ----------------------------------------------------------------------------

const ARRAY_SECTIONS = [
  ['cable_schedule', 'union', false],
  ['lv_to_smdb_cables', 'union', false],
  ['smdb_to_db_cables', 'union', false],
  ['smdb_inventory', 'union', false],
  ['db_inventory', 'union', false],
  ['power_outlets', 'union', true],
  ['lighting_fixtures', 'union', true],
  ['mechanical_equipment', 'union', true],
  ['containment', 'majority', true],
  ['earthing', 'majority', true],
  ['metering', 'majority', true],
  ['load_summary', 'union', false],
  ['db_groups', 'union', true],
  ['bulk_cables', 'union', true],
  ['drawings_found', 'union', true],
];

function emptySupply() {
  return { transformers: [], generator: null, ats: null, hv_ducts: null, mobile_generator_provision: null };
}

function floorRank(key) {
  if (key.startsWith('basement')) return -100 + (parseInt(key.slice(8), 10) || 1);
  if (key === 'ground') return 0;
  if (key === 'mezzanine') return 0.5;
  if (key.startsWith('podium')) return 1 + (parseInt(key.slice(6), 10) || 1) * 0.01;
  if (key.startsWith('f')) return parseInt(key.slice(1), 10) || 0;
  if (key === 'penthouse') return 900;
  if (key === 'roof') return 1000;
  return 800;
}

export function mergeEnsembleResults(results, opts = {}) {
  const runs = (results || []).filter((r) => r && typeof r === 'object');
  const R = runs.length;
  if (R === 0) return { result: null, agreement: null };
  if (R === 1) {
    return { result: runs[0], agreement: oneRunAgreement(runs[0], opts.requested ?? 1) };
  }
  const MAJORITY = Math.floor(R / 2) + 1;
  const out = {};
  const agreement = {
    runs: { requested: opts.requested ?? R, succeeded: R, failed: (opts.requested ?? R) - R },
    sections: {},
    perRow: {},
    overall: 0,
  };

  for (const [section, inclusion, jaccardPass] of ARRAY_SECTIONS) {
    const runsRows = runs.map((r) => (Array.isArray(r[section]) ? r[section] : []));
    const withFloorKey = SECTIONS_WITH_FLOOR_DESC_KEY.has(section);
    const { entries } = mergeRows(runsRows, R, inclusion, (row) => keyFor(section, row), jaccardPass, withFloorKey);
    const reconcile = section === 'lv_panels' ? reconcileLvPanel : reconcileRow;
    out[section] = entries.map((e) => reconcile(e.row));
    recordAgreement(agreement, section, entries, R, MAJORITY);
  }

  // lv_panels — union, nested merge.
  {
    const runsRows = runs.map((r) => (Array.isArray(r.lv_panels) ? r.lv_panels : []));
    const { entries } = mergeRows(runsRows, R, 'union', (row) => keyFor('lv_panels', row), false);
    out.lv_panels = entries.map((e) => reconcileLvPanel(e.row));
    recordAgreement(agreement, 'lv_panels', entries, R, MAJORITY);
  }

  out.incoming_supply = mergeIncoming(runs, R, MAJORITY, agreement);

  // Scalars / metadata.
  out.floors_identified = mode(runs.map((r) => r.floors_identified), true);
  out.floor_labels = mergeFloorLabels(runs);
  out.typical_floor_height_m = mergeNullableMedian(runs.map((r) => r.typical_floor_height_m), R);
  out.drawing_scale = plurality(runs.map((r) => r.drawing_scale).filter((v) => v != null));
  out.scale_detected = majorityTrue(runs.map((r) => r.scale_detected === true));
  out.schematic_available = majorityTrue(runs.map((r) => r.schematic_available === true));
  out.schematic_filename = plurality(runs.map((r) => r.schematic_filename).filter((v) => v != null));
  out.mdb_info = reconcileRow(runs.map((r) => r.mdb_info || {}));
  out.step_log = mergeStepLog(runs);

  // Overall agreement = mean of section means (mandatory sections weighted x2).
  const MANDATORY = new Set(['cable_schedule', 'smdb_inventory', 'db_inventory', 'power_outlets', 'lighting_fixtures', 'containment', 'earthing', 'metering']);
  let wSum = 0;
  let w = 0;
  for (const [section, s] of Object.entries(agreement.sections)) {
    if (s.kept === 0) continue;
    const weight = MANDATORY.has(section) ? 2 : 1;
    wSum += s.mean * weight;
    w += weight;
  }
  agreement.overall = w ? +(wSum / w).toFixed(4) : 1;

  const medConf = median(runs.map((r) => r.confidence).filter((v) => v != null));
  out.confidence = medConf == null ? agreement.overall : +(medConf * agreement.overall).toFixed(4);

  return { result: out, agreement };
}

function recordAgreement(agreement, section, entries, R, MAJORITY) {
  let unanimous = 0;
  let majority = 0;
  let contested = 0;
  let sum = 0;
  const perRow = {};
  for (const e of entries) {
    const a = e.presence / R;
    perRow[e.key] = +a.toFixed(3);
    sum += a;
    if (e.presence === R) unanimous++;
    else if (e.presence >= MAJORITY) majority++;
    else contested++;
  }
  agreement.sections[section] = {
    kept: entries.length,
    unanimous,
    majority,
    contested,
    mean: entries.length ? +(sum / entries.length).toFixed(4) : 1,
  };
  if (entries.length) agreement.perRow[section] = perRow;
}

function mergeIncoming(runs, R, MAJORITY, agreement) {
  const supplies = runs.map((r) => r.incoming_supply || {});
  const out = emptySupply();
  const txRuns = supplies.map((s) => (Array.isArray(s.transformers) ? s.transformers : []));
  const { entries } = mergeRows(
    txRuns, R, 'union',
    (r) => `${r.kva}/${String(r.voltage_ratio || '').toLowerCase().replace(/\s+/g, '')}`,
    false,
  );
  out.transformers = entries.map((e) => reconcileRow(e.row));
  recordAgreement(agreement, 'incoming_supply.transformers', entries, R, MAJORITY);
  for (const key of ['generator', 'ats', 'hv_ducts', 'mobile_generator_provision']) {
    const objs = supplies.map((s) => s[key]).filter((v) => v && typeof v === 'object');
    out[key] = objs.length >= MAJORITY ? reconcileRow(objs) : null;
  }
  return out;
}

function mergeFloorLabels(runs) {
  const byKey = new Map();
  for (const r of runs) {
    for (const lab of Array.isArray(r.floor_labels) ? r.floor_labels : []) {
      if (lab == null || lab === '') continue;
      const key = canonFloorKey(lab);
      if (!byKey.has(key)) byKey.set(key, new Map());
      const m = byKey.get(key);
      m.set(lab, (m.get(lab) || 0) + 1);
    }
  }
  const out = [];
  for (const [key, labels] of byKey.entries()) {
    let best = null;
    let bc = -1;
    for (const [lab, c] of [...labels.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      if (c > bc) { bc = c; best = lab; }
    }
    out.push({ key, label: best });
  }
  out.sort((a, b) => floorRank(a.key) - floorRank(b.key) || (a.key < b.key ? -1 : 1));
  return out.map((o) => o.label);
}

function mergeNullableMedian(values, R) {
  const nonNull = values.filter((v) => v != null && Number.isFinite(Number(v)));
  if (nonNull.length * 2 <= R) return null; // majority null -> stay null (no guessed default)
  return median(nonNull);
}

function mergeStepLog(runs) {
  const STATUS_RANK = { done: 3, skipped: 2, not_found: 1 };
  const byStep = new Map();
  for (const r of runs) {
    for (const s of Array.isArray(r.step_log) ? r.step_log : []) {
      const n = s?.step_num;
      if (n == null) continue;
      const prev = byStep.get(n);
      if (!prev || (STATUS_RANK[s.status] || 0) > (STATUS_RANK[prev.status] || 0)) byStep.set(n, s);
    }
  }
  return [...byStep.values()].sort((a, b) => a.step_num - b.step_num);
}

function oneRunAgreement(result, requested) {
  const sections = {};
  const perRow = {};
  for (const [section] of ARRAY_SECTIONS) {
    const rows = Array.isArray(result[section]) ? result[section] : [];
    sections[section] = { kept: rows.length, unanimous: rows.length, majority: 0, contested: 0, mean: 1 };
    if (rows.length) {
      const pr = {};
      for (const row of rows) pr[keyFor(section, row)] = 1;
      perRow[section] = pr;
    }
  }
  return { runs: { requested, succeeded: 1, failed: requested - 1 }, sections, perRow, overall: 1 };
}
