// Offline unit tests for the deterministic scan-result ordering — no API calls, runs free.
//   node scripts/canonicalize.test.mjs
//
// The sort lives in three KEPT-IN-SYNC copies: src/lib/electrical/canonicalize.ts
// (app), worker/server.js (long-scan worker), and the algorithm below. The canon*
// key helpers are imported from the proven reference (scripts/lib/ensemble-merge.mjs),
// which is the exact source those copies were ported from — so this validates the
// real key functions plus the ordering algorithm they feed.
import { canonTag, canonDesc, canonFloorKey } from './lib/ensemble-merge.mjs';

let pass = 0;
let fail = 0;
function ok(name, cond) {
  if (cond) { pass++; } else { fail++; console.error(`  FAIL: ${name}`); }
}
function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v == null ? null : v);
}

// --- mirror of floorRank / the sort, identical to canonicalize.ts + worker/server.js ---
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
function by(keyFn) {
  return (a, b) => {
    const ka = keyFn(a), kb = keyFn(b);
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    const sa = stable(a), sb = stable(b);
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  };
}
const fr = (f) => String(Math.round(floorRank(canonFloorKey(f)) * 100 + 100000)).padStart(8, '0');
function sortResult(result) {
  const s = (arr, cmp) => (Array.isArray(arr) ? [...arr].sort(cmp) : arr);
  return {
    ...result,
    smdb_inventory: s(result.smdb_inventory, by((r) => `${fr(r.floor)}|${canonTag(r.id)}`)),
    db_inventory: s(result.db_inventory, by((r) => `${fr(r.floor)}|${canonTag(r.smdb_id)}/${canonTag(r.db_id)}`)),
    cable_schedule: s(result.cable_schedule, by((r) => `${fr(r.floor)}|${canonTag(r.from)}>${canonTag(r.to)}`)),
    power_outlets: s(result.power_outlets, by((r) => `${fr(r.floor)}|${canonDesc(r.description)}`)),
    containment: s(result.containment, by((r) => canonDesc(r.description))),
  };
}

const shuffleReverse = (a) => [...a].reverse();
const shuffleRotate = (a) => (a.length ? [...a.slice(1), a[0]] : a);

// --- fixture: a realistic multi-floor result with rows in arbitrary order ---
const base = {
  cable_schedule: [
    { from: 'SMDB-2F', to: 'DB-2F-01', size_mm2: 16, length_m: 12, type: 'XLPE', circuit_description: null, floor: '2F' },
    { from: 'LVP-01', to: 'SMDB-G', size_mm2: 95, length_m: 30, type: 'XLPE', circuit_description: null, floor: 'Ground' },
    { from: 'SMDB-RF', to: 'DB-RF-01', size_mm2: 16, length_m: 8, type: 'XLPE', circuit_description: null, floor: 'Roof' },
    { from: 'SMDB-B1', to: 'DB-B1-01', size_mm2: 25, length_m: 20, type: 'XLPE', circuit_description: null, floor: 'Basement' },
  ],
  db_inventory: [
    { smdb_id: 'SMDB-2F', db_id: 'DB-T10', floor: '2F', rating_a: 63, cable_size: '16' },
    { smdb_id: 'SMDB-2F', db_id: 'DB-T01', floor: '2F', rating_a: 63, cable_size: '16' },
    { smdb_id: 'SMDB-2F', db_id: 'DB-T1', floor: '2F', rating_a: 63, cable_size: '16' },
  ],
  power_outlets: [
    { description: '13A twin socket', unit: 'No.', estimated_qty: 20, floor: '2F' },
    { description: '13 Amp twin socket outlet', unit: 'No.', estimated_qty: 5, floor: 'Ground' },
  ],
  containment: [
    { description: 'Cable tray 300mm', unit: 'm', estimated_qty: 100 },
    { description: 'Conduit 25mm', unit: 'm', estimated_qty: 200 },
  ],
  smdb_inventory: [],
};

// --- order-independence: any input order yields the identical sorted output ---
{
  const variants = [
    base,
    { ...base, cable_schedule: shuffleReverse(base.cable_schedule), db_inventory: shuffleRotate(base.db_inventory), power_outlets: shuffleReverse(base.power_outlets), containment: shuffleReverse(base.containment) },
    { ...base, cable_schedule: shuffleRotate(base.cable_schedule), db_inventory: shuffleReverse(base.db_inventory), containment: shuffleRotate(base.containment) },
  ];
  const sorted = variants.map((v) => stable(sortResult(v)));
  ok('order-independent: reversed input == base', sorted[0] === sorted[1]);
  ok('order-independent: rotated input == base', sorted[0] === sorted[2]);
}

// --- pure reorder: multiset of rows preserved (nothing dropped, added, or rewritten) ---
{
  const out = sortResult(base);
  for (const k of ['cable_schedule', 'db_inventory', 'power_outlets', 'containment']) {
    const inSet = base[k].map(stable).sort();
    const outSet = out[k].map(stable).sort();
    ok(`pure reorder: ${k} multiset preserved`, stable(inSet) === stable(outSet));
  }
}

// --- concrete ordering expectations ---
{
  const out = sortResult(base);
  const floors = out.cable_schedule.map((c) => c.floor);
  ok('floors order basement→ground→2F→roof', stable(floors) === stable(['Basement', 'Ground', '2F', 'Roof']));
  const dbs = out.db_inventory.map((d) => d.db_id);
  ok('DB tags: T01 before T10, T1 distinct', dbs.indexOf('DB-T01') < dbs.indexOf('DB-T10') && dbs.includes('DB-T1'));
}

// --- equivalent descriptions collapse to the same sort key (stable adjacency) ---
ok('canonDesc collapses amp/word-order variants', canonDesc('13A twin socket') === canonDesc('13 Amp twin socket outlet'));

console.log(`\ncanonicalize: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
