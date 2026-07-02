// Post-scan validation gate.
//
// Runs after EVERY electrical scan (both the in-process Vercel path in
// app/api/projects/[id]/estimate/route.ts AND the VPS long-scan worker in
// worker/server.js) on the enriched ElectricalProcedureResult, and checks that
// the 14-step procedure produced a complete, take-off-grade result that was
// actually READ FROM THE DRAWING:
//   1. all 14 steps ran (step_log)
//   2. every mandatory BOQ section is present — classified per section as
//      EXTRACTED (read from drawing) · ESTIMATED (all rows provisional, i.e.
//      guessed from geometry, NOT read) · MISSING (empty)
//   3. per-floor enumeration is present (outlets + SMDB→DB cables carry `floor`)
//   4. no aggregated/range rows ("DB-T01 to T15", "per typical floor", "1F–8F")
//
// Policy: FLAG, don't block. We persist the result regardless and attach this
// report to `ai_extraction.scan_validation` so the bid page can surface the
// estimated-vs-missing split. The only hard block stays the 0-cable gate.
// Labels are TERSE on purpose ("Lighting — missing (not in drawing)"). Keep
// this in sync with the JS port in worker/server.js (validateElectricalScan).

import { canonFloorKey, floorIsCovered } from './gap-fill';

export type ScanSeverity = 'error' | 'warning';
export type ScanKind = 'missing' | 'estimated' | 'other';

export interface ScanViolation {
  code: string;
  severity: ScanSeverity;
  kind: ScanKind;
  section: string;
  message: string; // terse: "<Section> — <state>"
  count?: number;
  sample?: string[];
}

export interface ScanValidationReport {
  passed: boolean; // true when there are zero `error`-severity violations
  retried: boolean; // a targeted gap-fill re-read was attempted
  generatedAt: string;
  violations: ScanViolation[];
  stats: {
    stepsDone: number;
    stepsExpected: number;
    cableRuns: number;
    sectionsMissing: string[];
    sectionsEstimated: string[];
    floorsEmpty: string[]; // established floors that produced no per-floor take-off
  };
}

// Minimal shape we read — kept loose so both the TS result and the worker's
// plain-object result satisfy it without importing the full interface.
type RowWithProvisional = { provisional?: boolean };
interface ScanLike {
  step_log?: Array<{ step_num?: number; status?: string }>;
  floor_labels?: string[];
  cable_schedule?: unknown[];
  smdb_inventory?: Array<{ floor?: string | null }>;
  db_inventory?: Array<{ db_id?: string | null; floor?: string | null }>;
  lv_panels?: unknown[];
  mechanical_equipment?: unknown[];
  power_outlets?: Array<{ floor?: string | null; provisional?: boolean }>;
  lighting_fixtures?: Array<{ floor?: string | null; provisional?: boolean }>;
  containment?: RowWithProvisional[];
  earthing?: RowWithProvisional[];
  metering?: RowWithProvisional[];
  load_summary?: unknown[];
  incoming_supply?: { transformers?: unknown[] } | null;
  smdb_to_db_cables?: Array<{ from?: string; to?: string; floor?: string | null }>;
  typical_floor_warning?: string | null;
  stub?: boolean;
}

const EXPECTED_STEPS = 14;

// Sections that MUST be present for an occupiable building (mirrors the prompt's
// "REQUIRED non-empty" list + the structural arrays the BOQ can't be built
// without). `severity` is the weight when the section is MISSING (empty).
const SECTION_RULES: Array<{ key: keyof ScanLike; label: string; severity: ScanSeverity }> = [
  { key: 'cable_schedule', label: 'Cable schedule', severity: 'error' },
  { key: 'smdb_inventory', label: 'SMDBs', severity: 'error' },
  { key: 'db_inventory', label: 'DBs', severity: 'error' },
  { key: 'power_outlets', label: 'Power outlets', severity: 'error' },
  { key: 'lighting_fixtures', label: 'Lighting', severity: 'error' },
  { key: 'containment', label: 'Containment', severity: 'error' },
  { key: 'earthing', label: 'Earthing', severity: 'error' },
  { key: 'metering', label: 'Metering', severity: 'error' },
  { key: 'lv_panels', label: 'LV panels', severity: 'warning' },
  { key: 'mechanical_equipment', label: 'Mechanical', severity: 'warning' },
  { key: 'load_summary', label: 'Load summary', severity: 'warning' },
];

// Tag-range / floor-qualifier patterns the prompt forbids — an aggregated row
// collapses many DBs into one and breaks the per-floor audit trail.
const AGGREGATION_PATTERNS: RegExp[] = [
  /\bto\b/i, // "DB-T01 to T15"
  /\d+\s*[-–]\s*\d+/, // "DB-T01–T15", "1F-8F"
  /per\s+typical/i,
  /typical\s+floor/i,
  /\b(odd|even|all|each)\s+floors?\b/i,
  /\bx\s*\d+\b/i, // "DB-T01 x15"
];

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function looksAggregated(tag: string | null | undefined): boolean {
  if (!tag) return false;
  return AGGREGATION_PATTERNS.some((re) => re.test(tag));
}

// EXTRACTED / ESTIMATED / MISSING. A section is ESTIMATED when it has rows but
// EVERY row is flagged `provisional` (guessed from geometry, not read).
function sectionState(rows: unknown[]): 'extracted' | 'estimated' | 'missing' {
  if (rows.length === 0) return 'missing';
  const allProvisional = (rows as RowWithProvisional[]).every((r) => r && r.provisional === true);
  return allProvisional ? 'estimated' : 'extracted';
}

export function validateElectricalScan(result: ScanLike | null | undefined): ScanValidationReport {
  const violations: ScanViolation[] = [];
  const sectionsMissing: string[] = [];
  const sectionsEstimated: string[] = [];
  const r = result || {};

  // The dev/no-key stub ships intentionally sparse sample data — never flag it.
  const isStub = r.stub === true;

  // ── 1. All 14 steps ran ────────────────────────────────────────────────
  // A step counts as "covered" if it appears in step_log under ANY status —
  // 'not_found'/'skipped' are legitimate outcomes, not incomplete work. Step
  // gaps are warnings (audit-trail signal); an absent log is one warning.
  const stepLog = asArray(r.step_log) as Array<{ step_num?: number; status?: string }>;
  const coveredSteps = new Set(
    stepLog.filter((s) => typeof s.step_num === 'number').map((s) => s.step_num as number),
  );
  if (!isStub) {
    if (stepLog.length === 0) {
      violations.push({
        code: 'STEPS_LOG_MISSING',
        severity: 'warning',
        kind: 'other',
        section: 'step_log',
        message: `Steps — no step log (can't confirm all ${EXPECTED_STEPS} ran)`,
      });
    } else {
      const missingSteps: number[] = [];
      for (let n = 1; n <= EXPECTED_STEPS; n++) if (!coveredSteps.has(n)) missingSteps.push(n);
      if (missingSteps.length > 0) {
        violations.push({
          code: 'STEPS_INCOMPLETE',
          severity: 'warning',
          kind: 'other',
          section: 'step_log',
          message: `Steps — ${missingSteps.length}/${EXPECTED_STEPS} not logged (${missingSteps.join(', ')})`,
          count: missingSteps.length,
        });
      }
    }
  }

  // ── 2. Mandatory sections: extracted / estimated / missing ─────────────
  if (!isStub) {
    for (const rule of SECTION_RULES) {
      const state = sectionState(asArray(r[rule.key]));
      if (state === 'missing') {
        sectionsMissing.push(String(rule.key));
        violations.push({
          code: 'SECTION_MISSING',
          severity: rule.severity,
          kind: 'missing',
          section: String(rule.key),
          message: `${rule.label} — missing (not in drawing)`,
        });
      } else if (state === 'estimated') {
        sectionsEstimated.push(String(rule.key));
        violations.push({
          code: 'SECTION_ESTIMATED',
          severity: 'warning',
          kind: 'estimated',
          section: String(rule.key),
          message: `${rule.label} — estimated, verify`,
        });
      }
    }
    // incoming_supply is an object, not an array — check its transformers.
    if (asArray(r.incoming_supply?.transformers).length === 0) {
      sectionsMissing.push('incoming_supply');
      violations.push({
        code: 'SECTION_MISSING',
        severity: 'warning',
        kind: 'missing',
        section: 'incoming_supply',
        message: 'Incoming supply — missing (no transformers)',
      });
    }
  }

  // ── 3. Per-floor enumeration present ───────────────────────────────────
  const outlets = asArray(r.power_outlets) as Array<{ floor?: string | null }>;
  const outletsNoFloor = outlets.filter((o) => !o.floor || String(o.floor).trim() === '').length;
  if (!isStub && outlets.length > 0 && outletsNoFloor === outlets.length) {
    violations.push({
      code: 'OUTLETS_NOT_PER_FLOOR',
      severity: 'warning',
      kind: 'other',
      section: 'power_outlets',
      message: 'Power outlets — not split per floor',
      count: outletsNoFloor,
    });
  }

  const dbCables = asArray(r.smdb_to_db_cables) as Array<{ from?: string; to?: string; floor?: string | null }>;
  const cablesNoFloor = dbCables.filter((c) => !c.floor || String(c.floor).trim() === '').length;
  if (!isStub && dbCables.length > 0 && cablesNoFloor === dbCables.length) {
    violations.push({
      code: 'DB_CABLES_NOT_PER_FLOOR',
      severity: 'warning',
      kind: 'other',
      section: 'smdb_to_db_cables',
      message: 'SMDB→DB cables — not split per floor',
      count: cablesNoFloor,
    });
  }

  // ── 4. No aggregated / range rows ──────────────────────────────────────
  const aggDbTags = (asArray(r.db_inventory) as Array<{ db_id?: string | null }>)
    .map((d) => d.db_id)
    .filter(looksAggregated) as string[];
  if (aggDbTags.length > 0) {
    violations.push({
      code: 'DB_AGGREGATED',
      severity: 'error',
      kind: 'other',
      section: 'db_inventory',
      message: `DBs — ${aggDbTags.length} aggregated rows (enumerate individually)`,
      count: aggDbTags.length,
      sample: aggDbTags.slice(0, 5),
    });
  }
  const aggCableTags = dbCables.map((c) => c.to).filter(looksAggregated) as string[];
  if (aggCableTags.length > 0) {
    violations.push({
      code: 'DB_CABLES_AGGREGATED',
      severity: 'error',
      kind: 'other',
      section: 'smdb_to_db_cables',
      message: `SMDB→DB cables — ${aggCableTags.length} aggregated destinations`,
      count: aggCableTags.length,
      sample: aggCableTags.slice(0, 5),
    });
  }

  // ── 5. Every established floor has a per-floor take-off ────────────────
  // A floor named in floor_labels (Step 3) must show up in at least one
  // floor-wise section. Floors that were established but produced no rows are
  // flagged (warning, not block) and drive the targeted floor re-read. Named
  // levels (pool deck, basement, roof) are the usual offenders.
  const floorsEmpty: string[] = [];
  const floorLabels = (asArray(r.floor_labels) as string[]).filter(
    (l) => typeof l === 'string' && l.trim() !== '',
  );
  const floorWiseRows: Array<{ floor?: string | null }> = [
    ...(asArray(r.power_outlets) as Array<{ floor?: string | null }>),
    ...(asArray(r.lighting_fixtures) as Array<{ floor?: string | null }>),
    ...(asArray(r.db_inventory) as Array<{ floor?: string | null }>),
    ...(asArray(r.smdb_inventory) as Array<{ floor?: string | null }>),
    ...(asArray(r.smdb_to_db_cables) as Array<{ floor?: string | null }>),
  ];
  const sectionFloorKeys = new Set<string>();
  for (const row of floorWiseRows) {
    const k = canonFloorKey(row?.floor);
    if (k) sectionFloorKeys.add(k);
  }
  if (!isStub && floorLabels.length >= 2 && sectionFloorKeys.size > 0) {
    const seen = new Set<string>();
    for (const label of floorLabels) {
      const k = canonFloorKey(label);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      if (!floorIsCovered(k, sectionFloorKeys)) floorsEmpty.push(label.trim());
    }
    if (floorsEmpty.length > 0) {
      violations.push({
        code: 'FLOORS_EMPTY',
        severity: 'warning',
        kind: 'missing',
        section: 'floors',
        message: `Floors with no take-off — ${floorsEmpty.length} empty, re-scan: ${floorsEmpty.slice(0, 8).join(', ')}`,
        count: floorsEmpty.length,
        sample: floorsEmpty.slice(0, 8),
      });
    }
  }

  // ── 6. Typical-floor multiplication could not run ──────────────────────
  // expandTypicalFloorFeeders (B3) sets this when there was no fully-read
  // template floor to multiply, so the SMDB→DB cable take-off for the typical
  // floors is under-counted. Flag it loudly rather than ship a silent low total.
  if (!isStub && typeof r.typical_floor_warning === 'string' && r.typical_floor_warning.trim() !== '') {
    violations.push({
      code: 'TYPICAL_FLOOR_NOT_MULTIPLIED',
      severity: 'warning',
      kind: 'other',
      section: 'smdb_to_db_cables',
      message: r.typical_floor_warning.trim(),
    });
  }

  const passed = violations.every((v) => v.severity !== 'error');
  return {
    passed,
    retried: false,
    generatedAt: new Date().toISOString(),
    violations,
    stats: {
      stepsDone: coveredSteps.size,
      stepsExpected: EXPECTED_STEPS,
      cableRuns: asArray(r.cable_schedule).length,
      sectionsMissing,
      sectionsEstimated,
      floorsEmpty,
    },
  };
}

// One-line human summary for the activity log / console.
export function summarizeScanValidation(report: ScanValidationReport): string {
  if (report.violations.length === 0) {
    return `Scan complete — all ${report.stats.stepsExpected} steps + every section read from the drawing.`;
  }
  const missing = report.stats.sectionsMissing.length;
  const estimated = report.stats.sectionsEstimated.length;
  const prefix = report.retried ? 'After re-scan: ' : '';
  const head = report.passed
    ? `${prefix}complete${estimated ? `, ${estimated} estimated` : ''}`
    : `${prefix}INCOMPLETE — ${missing} missing${estimated ? `, ${estimated} estimated` : ''}`;
  const detail = report.violations
    .slice(0, 5)
    .map((v) => (v.severity === 'error' ? '✗ ' : '⚠ ') + v.message)
    .join(' · ');
  return `${head}. ${detail}`;
}
