/**
 * Cable-schedule diff — detects per-line numeric corrections between two
 * runs of the electrical procedure on the same project. Used by the
 * estimate route to capture WHAT changed on a re-run, not just WHETHER the
 * gate-12 reviewer rejected the prior run.
 *
 * Each significant change is logged as a `sabi_corrections` row with a
 * field_path like `quantities.cable_schedule[LVP-01→SMDB-1F].length_m`.
 * That's structured enough for a future cable-length adjuster to mine real
 * (ai_value, human_value) pairs and learn under/over-estimation patterns.
 *
 * What counts as significant:
 *   length_m  — diff > LENGTH_DELTA_M absolute OR > LENGTH_DELTA_PCT relative
 *   size_mm2  — any change to a different standard cable size
 *
 * `from` and `to` tags must match for two lines to be considered the same
 * cable. Cables that exist in only one of the two schedules are skipped
 * (those are additions/removals, not corrections of an existing line).
 */

const LENGTH_DELTA_M = 5;
const LENGTH_DELTA_PCT = 0.1;

export interface CableLine {
  from?: string;
  to?: string;
  size_mm2?: number | null;
  length_m?: number | null;
}

export interface CableDiff {
  fieldPath: string;
  aiValue: number;
  humanValue: number;
  cableKey: string;
  attribute: 'length_m' | 'size_mm2';
}

export function diffCableSchedules(prior: CableLine[] | null | undefined, current: CableLine[] | null | undefined): CableDiff[] {
  if (!prior?.length || !current?.length) return [];
  const priorByKey = new Map<string, CableLine>();
  for (const c of prior) {
    const k = cableKey(c);
    if (k) priorByKey.set(k, c);
  }

  const diffs: CableDiff[] = [];
  for (const cur of current) {
    const k = cableKey(cur);
    if (!k) continue;
    const old = priorByKey.get(k);
    if (!old) continue;

    // Length diff — significant if BOTH absolute and relative thresholds breached
    const oldLen = num(old.length_m);
    const newLen = num(cur.length_m);
    if (oldLen != null && newLen != null && oldLen > 0) {
      const absDiff = Math.abs(newLen - oldLen);
      const relDiff = absDiff / oldLen;
      if (absDiff > LENGTH_DELTA_M && relDiff > LENGTH_DELTA_PCT) {
        diffs.push({
          fieldPath: `quantities.cable_schedule[${k}].length_m`,
          aiValue: oldLen,
          humanValue: newLen,
          cableKey: k,
          attribute: 'length_m',
        });
      }
    }

    // Size diff — any change to a different mm² value counts
    const oldSize = num(old.size_mm2);
    const newSize = num(cur.size_mm2);
    if (oldSize != null && newSize != null && oldSize !== newSize) {
      diffs.push({
        fieldPath: `quantities.cable_schedule[${k}].size_mm2`,
        aiValue: oldSize,
        humanValue: newSize,
        cableKey: k,
        attribute: 'size_mm2',
      });
    }
  }
  return diffs;
}

function cableKey(c: CableLine): string | null {
  if (!c.from || !c.to) return null;
  return `${c.from.toUpperCase()}→${c.to.toUpperCase()}`;
}

function num(x: unknown): number | null {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}
