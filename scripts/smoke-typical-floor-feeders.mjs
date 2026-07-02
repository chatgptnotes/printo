#!/usr/bin/env node
/**
 * Typical-floor feeder multiplication smoke test — guards the fix for the
 * under-counted SMDB → DB "floor power lines". When the AI reads the typical
 * floor ONCE, enrichElectricalResult() must replicate that one floor's DB
 * feeders + DBs across every identical floor (×N), one row per floor — and must
 * NOT touch a result that already enumerates every floor (no double count).
 * No network, no DB.
 *
 * Run:  node --import tsx scripts/smoke-typical-floor-feeders.mjs
 */
const { enrichElectricalResult } = await import('../src/lib/electrical/derive-cable-paths.ts');

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
const summary = { run: 0, pass: 0, fail: 0 };
function check(label, ok, detail) {
  summary.run++;
  ok ? summary.pass++ : summary.fail++;
  console.log(`  ${ok ? PASS : FAIL} ${label}${detail ? `  — ${detail}` : ''}`);
}

// 10 identical typical floors (7F-16F), each with a per-floor SMDB. The scan read
// only the 7th floor's 15 DB feeders. After enrichment every typical floor should
// carry its own 15 feeders (= one floor × 10).
const TYPICAL = Array.from({ length: 10 }, (_, i) => `${7 + i}F`); // 7F..16F
const DBS_PER_FLOOR = 15;
const LEN = 25;

const oneFloorCables = Array.from({ length: DBS_PER_FLOOR }, (_, i) => ({
  from: 'SMDB-7F',
  to: `DB-7F-${String(i + 1).padStart(2, '0')}`,
  size_mm2: 16,
  length_m: LEN,
  confidence: 'medium',
  floor: '7F',
  circuit_description: 'apartment DB feeder',
  type: 'submain',
}));
const oneFloorDbs = Array.from({ length: DBS_PER_FLOOR }, (_, i) => ({
  smdb_id: 'SMDB-7F',
  db_id: `DB-7F-${String(i + 1).padStart(2, '0')}`,
  floor: '7F',
  rating_a: 63,
  cable_size: '16mm²',
}));

const baseResult = () => ({
  floors_identified: 11,
  floor_labels: ['Ground', ...TYPICAL],
  smdb_inventory: TYPICAL.map((f) => ({ id: `SMDB-${f}`, floor: f, rating_a: 250 })),
  lv_to_smdb_cables: [],
  cable_schedule: [],
});

const floorOf = (c) => (c.floor || '').trim();
const cablesOn = (rows, f) => rows.filter((c) => floorOf(c) === f).length;

// ── Case 1: one typical floor read → multiplied across all 10 ───────────────
console.log('\nCase 1 — single typical floor read, replicate ×10');
const r1 = enrichElectricalResult({
  ...baseResult(),
  smdb_to_db_cables: oneFloorCables.map((c) => ({ ...c })),
  db_inventory: oneFloorDbs.map((d) => ({ ...d })),
});

check('total SMDB→DB feeders = 15 × 10 floors', r1.smdb_to_db_cables.length === DBS_PER_FLOOR * TYPICAL.length,
  `got ${r1.smdb_to_db_cables.length}`);
check('every typical floor has its 15 feeders', TYPICAL.every((f) => cablesOn(r1.smdb_to_db_cables, f) === DBS_PER_FLOOR),
  TYPICAL.map((f) => `${f}:${cablesOn(r1.smdb_to_db_cables, f)}`).join(' '));
check('every feeder carries a floor (per-floor audit trail)', r1.smdb_to_db_cables.every((c) => floorOf(c) !== ''),
  `${r1.smdb_to_db_cables.filter((c) => floorOf(c) === '').length} blank`);
check('tags re-floored (SMDB-16F / DB-16F-01 exist)',
  r1.smdb_to_db_cables.some((c) => c.from === 'SMDB-16F' && c.to === 'DB-16F-01'));
check('replicas flagged low-confidence', r1.smdb_to_db_cables.filter((c) => c.confidence === 'low').length === DBS_PER_FLOOR * 9,
  `${r1.smdb_to_db_cables.filter((c) => c.confidence === 'low').length} low`);
check('total length = one floor × 10', r1.smdb_to_db_cables.reduce((s, c) => s + (c.length_m || 0), 0) === DBS_PER_FLOOR * LEN * TYPICAL.length,
  `${r1.smdb_to_db_cables.reduce((s, c) => s + (c.length_m || 0), 0)} m`);
check('DB inventory multiplied too (15 × 10)', r1.db_inventory.length === DBS_PER_FLOOR * TYPICAL.length,
  `got ${r1.db_inventory.length}`);

// ── Case 2: all floors already enumerated → no change (no double count) ──────
console.log('\nCase 2 — already enumerated per floor, must NOT double-count');
const allCables = TYPICAL.flatMap((f) => oneFloorCables.map((c, i) => ({
  ...c, from: `SMDB-${f}`, to: `DB-${f}-${String(i + 1).padStart(2, '0')}`, floor: f,
})));
const allDbs = TYPICAL.flatMap((f) => oneFloorDbs.map((d, i) => ({
  ...d, smdb_id: `SMDB-${f}`, db_id: `DB-${f}-${String(i + 1).padStart(2, '0')}`, floor: f,
})));
const r2 = enrichElectricalResult({ ...baseResult(), smdb_to_db_cables: allCables, db_inventory: allDbs });
check('feeder count unchanged (no replication)', r2.smdb_to_db_cables.length === DBS_PER_FLOOR * TYPICAL.length,
  `got ${r2.smdb_to_db_cables.length}`);
check('no low-confidence replicas added', r2.smdb_to_db_cables.every((c) => c.confidence !== 'low'));

console.log(`\n${summary.fail === 0 ? PASS : FAIL} ${summary.pass}/${summary.run} checks passed`);
process.exit(summary.fail === 0 ? 0 : 1);
