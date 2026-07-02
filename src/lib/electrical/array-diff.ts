/**
 * Generic array-diff helpers for electrical procedure result arrays whose
 * lines have a stable identity. Mirrors `cable-schedule-diff.ts` for two
 * more sections that re-run frequently:
 *   • mechanical_equipment[] — keyed by `description` (case-insensitive)
 *     attributes diffed: count, rating_kw, rating_a
 *   • power_outlets[]        — keyed by `description` (case-insensitive)
 *     attributes diffed: estimated_qty
 *
 * Returns the same `CableDiff`-shaped output as cable-schedule-diff so the
 * estimate route can pipe both into a single `logCorrection()` loop.
 *
 * Significance threshold: `>= MIN_REL_DIFF` relative AND `>= MIN_ABS_DIFF`
 * absolute. Keeps small rounding noise from drowning the corrections table.
 */

const MIN_REL_DIFF = 0.1; // 10 %
const MIN_ABS_DIFF = 1;   // 1 unit

export interface ArrayDiff {
  fieldPath: string;
  aiValue: number;
  humanValue: number;
  cableKey: string;        // for parity with CableDiff — repurposed as line key
  attribute: string;
}

interface MechanicalRow {
  description?: string;
  count?: number | null;
  rating_kw?: number | null;
  rating_a?: number | null;
}

interface OutletRow {
  description?: string;
  unit?: string;
  estimated_qty?: number | null;
}

export function diffMechanicalEquipment(
  prior: MechanicalRow[] | null | undefined,
  current: MechanicalRow[] | null | undefined,
): ArrayDiff[] {
  return diffByDescription(prior as Array<Record<string, unknown>> | null | undefined, current as Array<Record<string, unknown>> | null | undefined, 'quantities.mechanical_equipment', ['count', 'rating_kw', 'rating_a']);
}

export function diffPowerOutlets(
  prior: OutletRow[] | null | undefined,
  current: OutletRow[] | null | undefined,
): ArrayDiff[] {
  return diffByDescription(prior as Array<Record<string, unknown>> | null | undefined, current as Array<Record<string, unknown>> | null | undefined, 'quantities.power_outlets', ['estimated_qty']);
}

function diffByDescription(
  prior: Array<Record<string, unknown>> | null | undefined,
  current: Array<Record<string, unknown>> | null | undefined,
  basePath: string,
  attributes: string[],
): ArrayDiff[] {
  if (!prior?.length || !current?.length) return [];
  const priorByKey = new Map<string, Record<string, unknown>>();
  for (const r of prior) {
    const k = lineKey(r);
    if (k) priorByKey.set(k, r);
  }

  const diffs: ArrayDiff[] = [];
  for (const cur of current) {
    const k = lineKey(cur);
    if (!k) continue;
    const old = priorByKey.get(k);
    if (!old) continue;

    for (const attr of attributes) {
      const oldV = num(old[attr]);
      const newV = num(cur[attr]);
      if (oldV == null || newV == null) continue;
      if (!isSignificant(oldV, newV)) continue;
      diffs.push({
        fieldPath: `${basePath}[${k}].${attr}`,
        aiValue: oldV,
        humanValue: newV,
        cableKey: k,
        attribute: attr,
      });
    }
  }
  return diffs;
}

function lineKey(row: Record<string, unknown>): string | null {
  const desc = row.description as string | undefined;
  if (!desc) return null;
  return desc.trim().toLowerCase().slice(0, 60);
}

function num(x: unknown): number | null {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function isSignificant(oldV: number, newV: number): boolean {
  if (oldV === newV) return false;
  if (oldV === 0) return Math.abs(newV) >= MIN_ABS_DIFF;
  const absDiff = Math.abs(newV - oldV);
  const relDiff = absDiff / Math.abs(oldV);
  return absDiff >= MIN_ABS_DIFF && relDiff >= MIN_REL_DIFF;
}
