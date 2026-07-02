// Verification for the Cable BOQ Accuracy fixes (docs/CABLE_BOQ_ACCURACY_FIX_PLAN.md):
//   B1 — typical floors multiplied INCLUDING partial floors (top-up, no double)
//   B3 — no template floor → rebuild DB set from db_groups + flag a warning
//   B4 — LV→SMDB lengths computed from typical floor height when scale absent
// Drives the PRODUCTION functions directly. Run: npx tsx scripts/verify-cable-accuracy-fixes.ts
import {
  expandTypicalFloorFeeders,
  backfillLvToSmdbLengths,
} from '../src/lib/electrical/derive-cable-paths';
import { validateElectricalScan } from '../src/lib/electrical/scan-validation';

const checks: Array<[string, boolean]> = [];
const check = (name: string, ok: boolean) => checks.push([name, ok]);

// ── B4 — deterministic LV→SMDB length from typical floor height ──────────────
{
  const r: any = {
    scale_detected: false,
    typical_floor_height_m: 3.2,
    lv_to_smdb_cables: [
      { from: 'LVP-01', to: 'SMDB-5F', size_mm2: 95, length_m: null, confidence: 'low', route_via: null },
      { from: 'LVP-01', to: 'SMDB-G', size_mm2: 70, length_m: 12, confidence: 'high', route_via: null },
    ],
  };
  const out: any = backfillLvToSmdbLengths(r);
  const f5 = out.lv_to_smdb_cables.find((c: any) => c.to === 'SMDB-5F');
  const g = out.lv_to_smdb_cables.find((c: any) => c.to === 'SMDB-G');
  // 4 + 5×3.2 + 0.5 = 20.5 → 21
  check('B4: 5F feeder length computed = 21', f5.length_m === 21);
  check('B4: computed feeder marked provisional', f5.provisional === true);
  check('B4: confident read untouched (12, not provisional)', g.length_m === 12 && !g.provisional);
}

// ── B4 — no floor height → leave length, flag provisional ────────────────────
{
  const r: any = {
    scale_detected: false,
    typical_floor_height_m: null,
    lv_to_smdb_cables: [{ from: 'LVP-01', to: 'SMDB-3F', size_mm2: 95, length_m: null, confidence: 'low', route_via: null }],
  };
  const out: any = backfillLvToSmdbLengths(r);
  const c = out.lv_to_smdb_cables[0];
  check('B4: no height → length stays null but provisional', c.length_m == null && c.provisional === true);
}

// ── B4 — scaled scan trusted (no override at all) ───────────────────────────
{
  const r: any = {
    scale_detected: true,
    typical_floor_height_m: 3.2,
    lv_to_smdb_cables: [{ from: 'LVP-01', to: 'SMDB-5F', size_mm2: 95, length_m: null, confidence: 'low', route_via: null }],
  };
  const out: any = backfillLvToSmdbLengths(r);
  check('B4: scaled scan left untouched', out.lv_to_smdb_cables[0].length_m == null && !out.lv_to_smdb_cables[0].provisional);
}

// George's rule: typical-floor multiplication only runs for tall buildings
// (MORE than 7 typical floors). Fixtures below use 8 floors so the multiply path
// engages; a separate test confirms a <=7-floor building is left untouched.
const T8_SMDB = Array.from({ length: 8 }, (_, i) => ({ id: `SMDB-${i + 1}F`, floor: `${i + 1}F` }));

// ── B1 — partial floor top-up (8-floor tower: 2F read partially, 3F-8F empty) ─
{
  const r: any = {
    smdb_inventory: T8_SMDB,
    smdb_to_db_cables: [
      { from: 'SMDB-1F', to: 'DB-1F-01', floor: '1F', size_mm2: 16, length_m: 20, confidence: 'medium' },
      { from: 'SMDB-1F', to: 'DB-1F-02', floor: '1F', size_mm2: 16, length_m: 22, confidence: 'medium' },
      { from: 'SMDB-2F', to: 'DB-2F-01', floor: '2F', size_mm2: 16, length_m: 20, confidence: 'medium' },
    ],
    db_inventory: [
      { smdb_id: 'SMDB-1F', db_id: 'DB-1F-01', floor: '1F', rating_a: 63, cable_size: '16' },
      { smdb_id: 'SMDB-1F', db_id: 'DB-1F-02', floor: '1F', rating_a: 63, cable_size: '16' },
      { smdb_id: 'SMDB-2F', db_id: 'DB-2F-01', floor: '2F', rating_a: 63, cable_size: '16' },
    ],
  };
  const out: any = expandTypicalFloorFeeders(r);
  const byFloor = (f: string) => out.smdb_to_db_cables.filter((c: any) => c.floor === f);
  // Template 1F (2 DBs) replicated: 2F topped up to 2, 3F-8F (6 floors) get 2 each.
  // 3 existing + 1 (2F) + 12 (3F-8F) = 16.
  check('B1: total feeders 3 → 16 (8-floor tower)', out.smdb_to_db_cables.length === 16);
  check('B1: 1F template intact (2)', byFloor('1F').length === 2);
  check('B1: 2F topped up to 2 (was 1)', byFloor('2F').length === 2);
  check('B1: 8F filled to 2 (was 0)', byFloor('8F').length === 2);
  // The existing DB-2F-01 must not be doubled.
  const dup = byFloor('2F').filter((c: any) => c.to === 'DB-2F-01').length;
  check('B1: existing 2F DB not doubled', dup === 1);
  // The added 2F row is the missing DB-2F-02, flagged low + replica note.
  const added2F = byFloor('2F').find((c: any) => c.to === 'DB-2F-02');
  check('B1: missing 2F DB added (DB-2F-02)', !!added2F);
  check('B1: replica marked low-confidence', added2F && added2F.confidence === 'low');
  check('B1: replica carries note', added2F && /typical-floor replica/.test(added2F.circuit_description || ''));
  check('B1: no no-template warning when template exists', out.typical_floor_warning == null);
}

// ── George's rule — building with <=7 typical floors is NOT auto-replicated ──
{
  const r: any = {
    smdb_inventory: [{ id: 'SMDB-1F', floor: '1F' }, { id: 'SMDB-2F', floor: '2F' }, { id: 'SMDB-3F', floor: '3F' }],
    smdb_to_db_cables: [
      { from: 'SMDB-1F', to: 'DB-1F-01', floor: '1F', size_mm2: 16, length_m: 20, confidence: 'medium' },
      { from: 'SMDB-1F', to: 'DB-1F-02', floor: '1F', size_mm2: 16, length_m: 22, confidence: 'medium' },
      { from: 'SMDB-2F', to: 'DB-2F-01', floor: '2F', size_mm2: 16, length_m: 20, confidence: 'medium' },
    ],
    db_inventory: [],
  };
  const out: any = expandTypicalFloorFeeders(r);
  check('George: <=7 floors left as scanned (3 feeders, no replicas)', out.smdb_to_db_cables.length === 3 && out.typical_floor_warning == null);
}

// ── B1 — fully-enumerated 8-floor tower left untouched (no double-count) ─────
{
  const r: any = {
    smdb_inventory: T8_SMDB,
    smdb_to_db_cables: Array.from({ length: 8 }, (_, i) => ({
      from: `SMDB-${i + 1}F`, to: `DB-${i + 1}F-01`, floor: `${i + 1}F`, size_mm2: 16, length_m: 20, confidence: 'medium',
    })),
    db_inventory: [],
  };
  const out: any = expandTypicalFloorFeeders(r);
  check('B1: already-complete tower unchanged (8)', out.smdb_to_db_cables.length === 8);
}

// ── B3 — no template floor (8-floor tower), db_groups present → rebuild + warn ─
{
  const r: any = {
    smdb_inventory: T8_SMDB,
    smdb_to_db_cables: [],
    db_inventory: [],
    db_groups: [{ tag_pattern: 'DB-T01 to DB-T03', per_floor_qty: 3, floors: 8, total_qty: 24, tcl_range_kw: null }],
  };
  const out: any = expandTypicalFloorFeeders(r);
  check('B3: rebuilt 24 DBs from db_groups (3 tags × 8 floors)', out.db_inventory.length === 24);
  check('B3: warning set + mentions rebuild', /could not run/.test(out.typical_floor_warning || '') && /Rebuilt 24/.test(out.typical_floor_warning || ''));
  // Validator surfaces it.
  const rep = validateElectricalScan({ ...out, floor_labels: T8_SMDB.map(s => s.floor), step_log: Array.from({ length: 14 }, (_, i) => ({ step_num: i + 1 })) });
  check('B3: validator emits TYPICAL_FLOOR_NOT_MULTIPLIED', rep.violations.some(v => v.code === 'TYPICAL_FLOOR_NOT_MULTIPLIED'));
}

// ── B3 — no template, no db_groups (8-floor tower) → warn only, no fabrication ─
{
  const r: any = {
    smdb_inventory: T8_SMDB,
    smdb_to_db_cables: [],
    db_inventory: [],
  };
  const out: any = expandTypicalFloorFeeders(r);
  check('B3: no db_groups → no DBs fabricated', out.db_inventory.length === 0);
  check('B3: warning still set', /could not run/.test(out.typical_floor_warning || '') && /under-counted/.test(out.typical_floor_warning || ''));
}

let failed = 0;
console.log('── Cable accuracy fixes (B1/B3/B4) ──');
for (const [name, ok] of checks) { console.log(`  ${ok ? '✅' : '❌'} ${name}`); if (!ok) failed++; }
console.log(`\n${failed === 0 ? `✅ ALL ${checks.length} PASS` : `❌ ${failed}/${checks.length} FAILED`}`);
if (failed) process.exit(1);
