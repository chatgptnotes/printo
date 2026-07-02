/**
 * Library-first specification analyzer.
 *
 * Replaces `analyzeSpecifications` Claude call for the common case where spec
 * documents reference known approved-makes by name. Performs:
 *   1. Multi-pattern brand scan against BRAND_DICTIONARY
 *   2. Regex scan against STANDARDS_DICTIONARY
 *   3. Confidence score = function of unique brand hits + standards hits
 *
 * If confidence >= MIN_CONFIDENCE → return library result directly (zero AI cost).
 * If below → caller should fall back to Claude.
 *
 * Cost: ~10ms per 50KB of spec text. $0.
 */
import { BRAND_DICTIONARY, STANDARDS_DICTIONARY, type BrandEntry } from '@/lib/ai/brand-dictionary';
import { getEffectiveBrandDictionary } from '@/lib/ai/brand-harvest';

export interface HeuristicSpecResult {
  requirements: Array<{
    service: string;
    category: string;
    item: string;
    specified_brand: string | null;
    specified_model: string | null;
    standard: string | null;
    remarks: string | null;
  }>;
  approved_makes: string[];
  standards_referenced: string[];
  confidence: number;
  reasoning: string;
  source: 'heuristic';
  hits: { brands: number; standards: number };
}

export const MIN_CONFIDENCE = 0.5;

/**
 * Build a cheap lower-cased haystack once; brand searches reuse it.
 * Strips repeated whitespace so "Schneider  Electric" matches "Schneider Electric".
 */
function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Scan extracted spec text for known brands. Each unique brand yields one entry
 * in `approved_makes`. The first ~200 chars around the first hit are captured
 * as `remarks` so a reviewer can see the surrounding context.
 *
 * Synchronous variant — uses the static dictionary only. Use
 * `analyzeSpecsHeuristicAsync` if you want auto-harvested brands too.
 */
export function analyzeSpecsHeuristic(extractedText: string): HeuristicSpecResult {
  return scanWithDictionary(extractedText, BRAND_DICTIONARY);
}

/**
 * Async variant — pulls in brands harvested from project history (cached 1 h
 * in process). Use for runs in API routes; the static-only synchronous form
 * is fine for unit tests / static analysis.
 */
export async function analyzeSpecsHeuristicAsync(extractedText: string): Promise<HeuristicSpecResult> {
  const dict = await getEffectiveBrandDictionary();
  return scanWithDictionary(extractedText, dict);
}

function scanWithDictionary(extractedText: string, dict: BrandEntry[]): HeuristicSpecResult {
  const haystack = normalize(extractedText);
  const haystackLen = haystack.length;

  const foundBrands = new Map<
    string,
    { brand: string; service: string; category: string; firstIndex: number; remarks: string }
  >();

  for (const entry of dict) {
    const variants = [entry.name, ...(entry.aliases ?? [])];
    for (const v of variants) {
      const needle = v.toLowerCase();
      // Word-boundary check: avoid 'GE' matching 'general' etc.
      const idx = findWordIndex(haystack, needle);
      if (idx === -1) continue;
      if (foundBrands.has(entry.name)) break;
      const start = Math.max(0, idx - 80);
      const end = Math.min(haystackLen, idx + needle.length + 120);
      const remarks = extractedText.substring(start, end).replace(/\s+/g, ' ').trim();
      foundBrands.set(entry.name, {
        brand: entry.name,
        service: entry.service,
        category: entry.category,
        firstIndex: idx,
        remarks,
      });
      break;
    }
  }

  const foundStandards: string[] = [];
  for (const std of STANDARDS_DICTIONARY) {
    if (std.pattern.test(extractedText)) foundStandards.push(std.code);
  }

  const requirements = [...foundBrands.values()].map(b => ({
    service: b.service,
    category: b.category,
    item: `${b.brand} (${b.category})`,
    specified_brand: b.brand,
    specified_model: null,
    standard: null,
    remarks: b.remarks,
  }));

  const approved_makes = [...foundBrands.keys()];

  // Confidence model (Phase 2 — tightened threshold so 2+ brand hits are
  // considered a real spec instead of needing 4+):
  //   0 brands         → 0
  //   1 brand          → 0.4   (was 0.35 — still below MIN_CONFIDENCE, AI fallback)
  //   2 brands         → 0.6   (was 0.55 — now clears MIN_CONFIDENCE on its own)
  //   3 brands         → 0.7
  //   4-9 brands       → 0.8   (was 0.75)
  //   10+ brands       → 0.9
  // +0.05 per standard hit, capped at 0.95.
  let confidence = 0;
  if (approved_makes.length === 1) confidence = 0.4;
  else if (approved_makes.length === 2) confidence = 0.6;
  else if (approved_makes.length === 3) confidence = 0.7;
  else if (approved_makes.length <= 9) confidence = 0.8;
  else if (approved_makes.length >= 10) confidence = 0.9;
  confidence = Math.min(0.95, confidence + Math.min(0.15, foundStandards.length * 0.05));

  const reasoning =
    approved_makes.length === 0
      ? 'No known brands matched in spec text — heuristic produced nothing useful, AI fallback recommended.'
      : `Matched ${approved_makes.length} brand(s) and ${foundStandards.length} standard(s) using dictionary scan. No AI tokens spent.`;

  return {
    requirements,
    approved_makes,
    standards_referenced: foundStandards,
    confidence,
    reasoning,
    source: 'heuristic',
    hits: { brands: approved_makes.length, standards: foundStandards.length },
  };
}

/**
 * Word-boundary substring search. Returns -1 if not found.
 *
 * Why not regex: building 200+ regexes from BRAND_DICTIONARY costs ~20ms;
 * a hand-rolled scan with isWordChar lookahead/behind runs in ~3ms over
 * 50KB on 200 brands. The brand list is the hot loop.
 */
function findWordIndex(haystack: string, needle: string): number {
  if (!needle) return -1;
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) return -1;
    const before = idx === 0 ? ' ' : haystack[idx - 1];
    const after = idx + needle.length >= haystack.length ? ' ' : haystack[idx + needle.length];
    if (!isWordChar(before) && !isWordChar(after)) return idx;
    from = idx + 1;
  }
  return -1;
}

function isWordChar(c: string): boolean {
  return /[a-z0-9]/i.test(c);
}
