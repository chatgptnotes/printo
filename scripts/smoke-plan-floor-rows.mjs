#!/usr/bin/env node
/**
 * Riser-diagram floor-row smoke test — guards the fix for the "empty Basement row"
 * bug. Boards must land on the floor row whose label matches their .floor exactly,
 * even when two labels would otherwise collide on the same floorRank (Basement vs
 * Underground both ranked -1; Roof vs Upper Roof both 900). No network, no DB.
 *
 * Run:  node --import tsx scripts/smoke-plan-floor-rows.mjs
 */
const { buildPlanModel } = await import('../src/lib/plan/build-model.ts');

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
const summary = { run: 0, pass: 0, fail: 0 };
function check(label, ok, detail) {
  summary.run++;
  ok ? summary.pass++ : summary.fail++;
  console.log(`  ${ok ? PASS : FAIL} ${label}${detail ? `  — ${detail}` : ''}`);
}

// Synthetic extraction mirroring the real bid e08c8af2… floor set: two below-ground
// labels (Underground, Basement) and two above-roof labels (Pool Deck, Upper Roof)
// that previously collided. One board on each colliding floor proves the row gets it.
const elec = {
  floors_identified: 6,
  floor_labels: ['Underground', 'Basement', 'Ground', '1F', 'Roof', 'Pool Deck', 'Upper Roof'],
  mdb_info: { tag: 'MDB', floor: 'Ground', rating_a: 2500 },
  lv_panels: [],
  smdb_inventory: [
    { id: 'SMDB-UG', floor: 'Underground', rating_a: 160 },
    { id: 'SMDB-B', floor: 'Basement', rating_a: 125 },
    { id: 'SMDB-RF', floor: 'Roof', rating_a: 100 },
    { id: 'SMDB-UR', floor: 'Upper Roof', rating_a: 63 },
    { id: 'SMDB-PD', floor: 'Pool Deck', rating_a: 63 },
  ],
  db_inventory: [
    { db_id: 'DB-UG1', smdb_id: 'SMDB-UG', floor: 'Underground', rating_a: 40 },
  ],
  cable_schedule: [],
};

const model = buildPlanModel(elec, { floors: 6 });
const byLabel = Object.fromEntries(model.floors.map((f) => [f.label, f]));
const countOn = (label) => model.panels.filter((p) => p.floorIndex === byLabel[label].index).length;

console.log('\nFloor-row placement (exact-match wins over rank ties)');
check('Underground row keeps its 2 boards (SMDB-UG + DB-UG1)', countOn('Underground') === 2, `got ${countOn('Underground')}`);
check('Basement row gets its 1 board (was 0 before fix)', countOn('Basement') === 1, `got ${countOn('Basement')}`);
check('Roof row gets exactly its 1 board', countOn('Roof') === 1, `got ${countOn('Roof')}`);
check('Upper Roof row gets its 1 board (no longer collapses into Roof)', countOn('Upper Roof') === 1, `got ${countOn('Upper Roof')}`);
check('Pool Deck row gets its 1 board', countOn('Pool Deck') === 1, `got ${countOn('Pool Deck')}`);

const totalBoards = elec.smdb_inventory.length + elec.db_inventory.length + 1 /* MDB */;
check('every board placed (none lost)', model.panels.length === totalBoards, `placed ${model.panels.length} / ${totalBoards}`);

// Floors that genuinely have boards in the input must not render empty (label-only
// floors like 1F here legitimately have no boxes and are fine).
const floorsWithData = new Set([
  elec.mdb_info.floor,
  ...elec.smdb_inventory.map((s) => s.floor),
  ...elec.db_inventory.map((d) => d.floor),
]);
const shouldBeEmpty = [...floorsWithData].filter((f) => byLabel[f] && countOn(f) === 0);
check('no floor row with data renders empty', shouldBeEmpty.length === 0, shouldBeEmpty.join(', ') || '(none)');

console.log('\nRow ordering (rank ascending → distinct, correctly ordered)');
const order = [...model.floors].sort((a, b) => a.index - b.index).map((f) => f.label);
const want = ['Underground', 'Basement', 'Ground', '1F', 'Roof', 'Pool Deck', 'Upper Roof'];
check('bottom→top order is Underground→…→Upper Roof', JSON.stringify(order) === JSON.stringify(want), order.join(' → '));

console.log(`\n${summary.fail === 0 ? PASS : FAIL} ${summary.pass}/${summary.run} checks passed`);
process.exit(summary.fail === 0 ? 0 : 1);
