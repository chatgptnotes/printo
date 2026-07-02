// Offline unit tests for the consensus merge — no API calls, runs free.
//   node scripts/ensemble-merge.test.mjs
import { mergeEnsembleResults, canonTag, canonDesc, canonFloorKey, keyFor } from './lib/ensemble-merge.mjs';

let pass = 0;
let fail = 0;
function ok(name, cond) {
  if (cond) { pass++; } else { fail++; console.error(`  FAIL: ${name}`); }
}
function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

// Minimal result builder — only the fields a test touches; the merge tolerates the rest.
function res(over = {}) {
  return {
    cable_schedule: [], smdb_inventory: [], db_inventory: [], power_outlets: [],
    lighting_fixtures: [], containment: [], earthing: [], metering: [],
    mechanical_equipment: [], lv_panels: [], load_summary: [], floor_labels: [],
    incoming_supply: { transformers: [] }, confidence: 0.8, step_log: [], ...over,
  };
}

// --- canon helpers ---
ok('canonTag DB-T01 != DB-T10', canonTag('DB-T01') !== canonTag('DB-T10'));
ok('canonTag DB-T01 != DB-T1', canonTag('DB-T01') !== canonTag('DB-T1'));
ok('canonTag normalizes punctuation/case', canonTag('smdb 1f') === canonTag('SMDB-1F'));
ok('canonDesc word-order independent', canonDesc('13A twin socket') === canonDesc('twin socket 13A'));
ok('canonDesc synonym sso=socket', canonDesc('13A twin SSO') === canonDesc('13A twin socket outlet'));
ok('canonDesc amp normalization', canonDesc('13 Amp twin socket') === canonDesc('13A twin socket'));
ok('canonFloorKey collapses First Floor/1F', canonFloorKey('First Floor') === canonFloorKey('1F'));

// --- R===1 short-circuit returns the lone result unchanged ---
{
  const r = res({ cable_schedule: [{ from: 'MDB', to: 'SMDB1', size_mm2: 95, length_m: 40 }] });
  const { result, agreement } = mergeEnsembleResults([r]);
  ok('R=1 returns same result object', result === r);
  ok('R=1 agreement overall = 1', agreement.overall === 1);
}

// --- order independence: merge([a,b,c]) deep-equals merge([c,b,a]) ---
{
  const a = res({ cable_schedule: [{ from: 'MDB', to: 'SMDB1', size_mm2: 95, length_m: 42 }], power_outlets: [{ description: '13A twin socket', floor: '1F', estimated_qty: 6, provisional: false }] });
  const b = res({ cable_schedule: [{ from: 'MDB', to: 'SMDB1', size_mm2: 95, length_m: 44 }], power_outlets: [{ description: 'twin socket 13A', floor: 'First Floor', estimated_qty: 7, provisional: false }] });
  const c = res({ cable_schedule: [{ from: 'MDB', to: 'SMDB1', size_mm2: 120, length_m: 80 }], power_outlets: [{ description: '13A twin SSO', floor: '1F', estimated_qty: 6, provisional: true }] });
  const f1 = mergeEnsembleResults([a, b, c]).result;
  const f2 = mergeEnsembleResults([c, b, a]).result;
  ok('order independent', stable(f1) === stable(f2));
}

// --- numeric median resists outlier; lower-mid is deterministic ---
{
  const mk = (len) => res({ cable_schedule: [{ from: 'MDB', to: 'SMDB1', size_mm2: 95, length_m: len }] });
  const { result } = mergeEnsembleResults([mk(42), mk(44), mk(43), mk(80), mk(43)]);
  ok('median length ignores 80 outlier', result.cable_schedule[0].length_m === 43);
}
{
  const mk = (sz) => res({ cable_schedule: [{ from: 'MDB', to: 'SMDB1', size_mm2: sz, length_m: 40 }] });
  const { result } = mergeEnsembleResults([mk(95), mk(95), mk(95), mk(120), mk(95)]);
  ok('median size = majority 95', result.cable_schedule[0].size_mm2 === 95);
}
{
  // even count -> lower-mid (an actually-reported value, never invented)
  const mk = (q) => res({ power_outlets: [{ description: 'x', floor: '1F', estimated_qty: q }] });
  const { result } = mergeEnsembleResults([mk(10), mk(20)]);
  ok('even-count qty uses lower-mid (10)', result.power_outlets[0].estimated_qty === 10);
}

// --- union keeps an item only ONE run found (recall) ---
{
  const found = res({ cable_schedule: [{ from: 'MDB', to: 'EV-SMDB', size_mm2: 50, length_m: 30 }] });
  const empty = res();
  const { result, agreement } = mergeEnsembleResults([found, empty, empty, empty, empty]);
  ok('union keeps 1/5 cable', result.cable_schedule.length === 1);
  ok('1/5 flagged contested', agreement.sections.cable_schedule.contested === 1);
  ok('perRow agreement = 0.2', agreement.perRow.cable_schedule[keyFor('cable_schedule', { from: 'MDB', to: 'EV-SMDB' })] === 0.2);
}

// --- majority drops a noisy free-text item only ONE run found ---
{
  const found = res({ containment: [{ description: 'odd tray', unit: 'm', estimated_qty: 5 }] });
  const empty = res();
  const { result } = mergeEnsembleResults([found, empty, empty, empty, empty]);
  ok('majority drops 1/5 containment', result.containment.length === 0);
}

// --- no cross-floor merge: same outlet type, different floors stay separate ---
{
  const mk = (fl) => res({ power_outlets: [{ description: '13A twin socket', floor: fl, estimated_qty: 6 }] });
  const { result } = mergeEnsembleResults([mk('1F'), mk('2F'), mk('1F'), mk('2F'), mk('1F')]);
  ok('1F and 2F outlets not merged', result.power_outlets.length === 2);
}

// --- Jaccard near-duplicate collapse: same item, 3 wordings, same floor ---
{
  const a = res({ power_outlets: [{ description: '13A twin switched socket outlet', floor: '1F', estimated_qty: 6 }] });
  const b = res({ power_outlets: [{ description: 'twin 13A socket', floor: '1F', estimated_qty: 6 }] });
  const c = res({ power_outlets: [{ description: '13A twin socket general power', floor: '1F', estimated_qty: 6 }] });
  const { result } = mergeEnsembleResults([a, b, c]);
  ok('worded-differently outlets collapse to 1', result.power_outlets.length === 1);
}

// --- provisional = majority of bucket rows ---
{
  const t = res({ power_outlets: [{ description: 'x', floor: '1F', estimated_qty: 6, provisional: true }] });
  const f = res({ power_outlets: [{ description: 'x', floor: '1F', estimated_qty: 6, provisional: false }] });
  const { result } = mergeEnsembleResults([t, t, f]); // 2 true / 3 -> true
  ok('provisional majority true', result.power_outlets[0].provisional === true);
}

// --- floors_identified = mode, tie -> higher ---
{
  const mk = (n) => res({ floors_identified: n });
  const { result } = mergeEnsembleResults([mk(8), mk(8), mk(9)]);
  ok('floors_identified mode = 8', result.floors_identified === 8);
}

// --- typical_floor_height_m: majority null -> stays null (no guessed default) ---
{
  const mk = (h) => res({ typical_floor_height_m: h });
  const { result } = mergeEnsembleResults([mk(null), mk(null), mk(3.6)]);
  ok('majority-null height stays null', result.typical_floor_height_m === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
