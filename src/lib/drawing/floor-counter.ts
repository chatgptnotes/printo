/**
 * Extract a list of floor labels from drawing title-block / level-schedule text.
 *
 * Replaces sub-step 3 of `analyzeElectricalProcedure` (Sonnet vision) for the
 * common case where the title block contains a level schedule like:
 *   "B2, B1, GF, M, 1F, 2F, 3F, 4F, ROOF"
 * or                                                                            *   "Basement 2 / Basement 1 / Ground / Mezzanine / Levels 1-7 / Roof"
 *
 * Returns an ordered, deduplicated list. Caller decides whether to fall back
 * to Sonnet (e.g. when this returns < 1 floor).
 */

const TOKEN_PATTERNS: Array<{ regex: RegExp; toLabel: (m: RegExpMatchArray) => string }> = [
  // Basement: B1, B2, BSMT, BASEMENT 1
  { regex: /\bB(\d{1,2})\b/gi, toLabel: m => `B${parseInt(m[1], 10)}` },
  { regex: /\bbasement\s*(\d{1,2})\b/gi, toLabel: m => `B${parseInt(m[1], 10)}` },
  // Ground floor variants
  { regex: /\bG(?:F|ROUND)?\s*(?:FLOOR|FLR|LEVEL|LVL)?\b/gi, toLabel: () => 'GF' },
  // Mezzanine
  { regex: /\bM(?:EZZ|EZZANINE)?\s*(?:FLOOR|FLR|LEVEL|LVL)?\b/gi, toLabel: () => 'MEZZ' },
  // Numbered floors: 1F, 2F, L1, LEVEL 3, FLOOR 5
  { regex: /\b([1-9]\d?)\s*(?:F|FL|FLR|FLOOR|LEVEL|LVL|ST|ND|RD|TH)\b/gi, toLabel: m => `${parseInt(m[1], 10)}F` },
  { regex: /\b(?:L|LEVEL|LVL|FLOOR)\s*([1-9]\d?)\b/gi, toLabel: m => `${parseInt(m[1], 10)}F` },
  // Roof / penthouse
  { regex: /\b(?:ROOF|PENTHOUSE|PH)\b/gi, toLabel: () => 'ROOF' },
];

// "Levels 1-7" / "Floors 2 to 5" → expand to 1F..7F
const RANGE_PATTERN = /\b(?:levels?|floors?|flrs?|lvls?)\s*(\d{1,2})\s*(?:-|to|–|—)\s*(\d{1,2})\b/gi;

const ORDER_RANK: Record<string, number> = {
  // Basements first (most negative), then GF/MEZZ, then numbered, then ROOF
  ROOF: 1000,
  MEZZ: 0.5,
  GF: 0,
};

function rankOf(label: string): number {
  if (label in ORDER_RANK) return ORDER_RANK[label];
  if (label.startsWith('B')) {
    const n = parseInt(label.slice(1), 10);
    return Number.isFinite(n) ? -n : -1;
  }
  if (label.endsWith('F')) {
    const n = parseInt(label.slice(0, -1), 10);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function extractFloors(text: string): string[] {
  if (!text) return [];

  const found = new Set<string>();

  // Expand ranges first
  for (const m of text.matchAll(RANGE_PATTERN)) {
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    if (Number.isFinite(a) && Number.isFinite(b) && a <= b && b - a < 50) {
      for (let i = a; i <= b; i++) found.add(`${i}F`);
    }
  }

  for (const { regex, toLabel } of TOKEN_PATTERNS) {
    for (const m of text.matchAll(regex)) {
      found.add(toLabel(m));
    }
  }

  return [...found].sort((a, b) => rankOf(a) - rankOf(b));
}
