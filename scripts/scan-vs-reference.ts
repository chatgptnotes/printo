// Side-by-side check of a scan result against the take-off procedure + an
// optional reference total. Runs the SAME enrichment the BOQ uses, then prints
// the numbers George reviews: LV->SMDB list, floor-wise SMDB->DB schedule,
// lighting per floor, totals, and any "could not multiply" warning.
//
// Usage:
//   npx tsx scripts/scan-vs-reference.ts                         (uses the P-379 fixture)
//   npx tsx scripts/scan-vs-reference.ts --result path/to/scan.json
//   npx tsx scripts/scan-vs-reference.ts --result scan.json --ref-cable-m 22000
//
// "scan.json" = the raw scan object (the `raw_electrical_procedure` value stored
// in sabi_services.ai_extraction, or any saved scan result).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { enrichElectricalResult } from '../src/lib/electrical/derive-cable-paths';

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

const path = arg('--result') ?? 'tests/fixtures/p379-result.json';
const refCableM = arg('--ref-cable-m') ? Number(arg('--ref-cable-m')) : null;

const raw: any = JSON.parse(readFileSync(resolve(path), 'utf8'));
const e: any = enrichElectricalResult(raw);

const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const sum = (arr: any[], f: (x: any) => number) => arr.reduce((s, x) => s + f(x), 0);
const fmt = (n: number) => Math.round(n).toLocaleString();

const lv = e.lv_to_smdb_cables ?? [];
const db = e.smdb_to_db_cables ?? [];
const bulk = e.bulk_cables ?? [];
const lights = e.lighting_fixtures ?? [];

console.log(`\n========== SCAN vs PROCEDURE — ${path} ==========`);
if (e.typical_floor_warning) {
  console.log(`\n  !! WARNING: ${e.typical_floor_warning}`);
}

// ── 1. LV Panel -> SMDB (every SMDB with size + length) ──
console.log(`\n-- 1. LV Panel -> SMDB  (${lv.length} runs) --`);
console.log('   SMDB                 Size       Length   Conf   Flag');
for (const c of lv) {
  const tag = String(c.to ?? '').padEnd(20).slice(0, 20);
  const size = String(c.size_mm2 ? `${c.size_mm2}mm2` : '-').padEnd(10);
  const len = `${fmt(num(c.length_m))} m`.padStart(8);
  const conf = String(c.confidence ?? '-').padEnd(6);
  const flag = c.provisional ? 'PROVISIONAL' : '';
  console.log(`   ${tag} ${size} ${len}  ${conf} ${flag}`);
}
const lvTotal = sum(lv, (c) => num(c.length_m));
console.log(`   LV->SMDB total length: ${fmt(lvTotal)} m`);

// ── 2. SMDB -> DB (floor-wise schedule, replicas shown) ──
const byFloor = new Map<string, any[]>();
for (const c of db) {
  const f = String(c.floor ?? '-');
  (byFloor.get(f) ?? byFloor.set(f, []).get(f)!).push(c);
}
console.log(`\n-- 2. SMDB -> DB  (floor-wise: ${db.length} runs across ${byFloor.size} floors) --`);
console.log('   Floor          DBs   Replicas(copied)   Length');
const floors = [...byFloor.keys()].sort();
for (const f of floors) {
  const rows = byFloor.get(f)!;
  const replicas = rows.filter((c) => /typical-floor replica/.test(c.circuit_description || '')).length;
  const len = sum(rows, (c) => num(c.length_m));
  console.log(`   ${f.padEnd(13)} ${String(rows.length).padStart(4)}   ${String(replicas).padStart(10)}        ${fmt(len).padStart(7)} m`);
}
const dbTotal = sum(db, (c) => num(c.length_m));
console.log(`   SMDB->DB total length: ${fmt(dbTotal)} m`);

// ── 3. Bulk final-circuit cables (provisional by nature) ──
if (bulk.length) {
  console.log(`\n-- 3. Bulk final-circuit cables  (${bulk.length} lines) --`);
  for (const b of bulk) {
    console.log(`   ${String(b.specification ?? '-').padEnd(34).slice(0, 34)} ${fmt(num(b.estimated_length_m)).padStart(8)} m  ${b.provisional ? 'PROVISIONAL' : ''}`);
  }
}
const bulkTotal = sum(bulk, (b) => num(b.estimated_length_m));

// ── 4. Lighting per floor ──
if (lights.length) {
  const lf = new Map<string, number>();
  for (const x of lights) {
    const f = String(x.floor ?? '-');
    lf.set(f, (lf.get(f) ?? 0) + num(x.qty));
  }
  const provis = lights.every((x: any) => x.provisional === true);
  console.log(`\n-- 4. Lighting fixtures  (${lights.length} types${provis ? ', ALL PROVISIONAL' : ', read from drawing'}) --`);
  for (const [f, q] of [...lf.entries()].sort()) console.log(`   ${f.padEnd(15)} ${fmt(q).padStart(6)} fittings`);
}

// ── 5. Totals + reference comparison ──
const grand = lvTotal + dbTotal + bulkTotal;
console.log(`\n-- TOTALS --`);
console.log(`   LV->SMDB:        ${fmt(lvTotal).padStart(9)} m`);
console.log(`   SMDB->DB:        ${fmt(dbTotal).padStart(9)} m`);
console.log(`   Bulk circuits:   ${fmt(bulkTotal).padStart(9)} m`);
console.log(`   GRAND CABLE:     ${fmt(grand).padStart(9)} m`);
if (refCableM != null && Number.isFinite(refCableM)) {
  const diff = grand - refCableM;
  const pct = refCableM ? (diff / refCableM) * 100 : 0;
  console.log(`   Reference:       ${fmt(refCableM).padStart(9)} m`);
  console.log(`   Difference:      ${(diff >= 0 ? '+' : '') + fmt(diff)} m  (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`);
  console.log(`   ${Math.abs(pct) <= 10 ? 'WITHIN 10% — acceptable, confirm procedure for the residual.' : 'OUTSIDE 10% — investigate the floor/section breakdown above.'}`);
}
console.log('');
