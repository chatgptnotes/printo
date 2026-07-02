/**
 * Extraction prompt hints — distils Phase 7's per-field correction data into
 * a short snippet injected into `extractProjectInfo`'s Sonnet prompt. Lets
 * the model warn itself about its own historically-weak fields without
 * spending eval tokens computing them at runtime.
 *
 * What the snippet looks like:
 *   ## Common extraction errors from past projects (last 90 days):
 *   - building_type: 23 corrections, e.g. office→hospital (5×), retail→office (3×)
 *   - floors: 12 corrections, e.g. 5→7 (4×), 3→5 (2×)
 *
 * The model reads these as "double-check yourself on these fields, here's
 * the typical drift" cues. Cheaper than retraining the few-shot, more
 * specific than a generic "be careful" warning.
 *
 * Caching: 1-h in-process. Same TTL as the rate-adjuster — corrections grow
 * slowly enough that hourly refresh is plenty.
 */
import { supabaseAdmin } from '@/lib/storage/supabase';

const HINTS_TTL_MS = 60 * 60 * 1000;
const TOP_FIELDS = 5;
const TOP_CHANGES_PER_FIELD = 3;
const LOOKBACK_DAYS = 90;
// Don't pollute the prompt with rare corrections — fewer than this many in
// the window means the field doesn't have a real pattern yet.
const MIN_CORRECTIONS_PER_FIELD = 3;

interface CachedHints {
  fetchedAt: number;
  snippet: string;
}

let cache: CachedHints | null = null;

interface CorrectionRow {
  field_path: string | null;
  ai_value: unknown;
  human_value: unknown;
}

/**
 * Returns a prompt-injectable snippet, or '' when no actionable corrections
 * exist. Callers concatenate it directly into their prompt — empty string
 * means "no change, ship the prompt as-is".
 */
export async function getExtractionPriorHints(): Promise<string> {
  if (cache && Date.now() - cache.fetchedAt < HINTS_TTL_MS) return cache.snippet;

  let snippet = '';
  try {
    const sinceIso = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();
    const { data } = await supabaseAdmin
      .from('sabi_corrections')
      .select('field_path, ai_value, human_value')
      .like('field_path', 'extraction.%')
      .gte('created_at', sinceIso)
      .limit(2000);

    interface FieldStat {
      count: number;
      changes: Map<string, number>; // 'from→to' → count
    }
    const byField = new Map<string, FieldStat>();
    for (const row of (data ?? []) as CorrectionRow[]) {
      const m = (row.field_path ?? '').match(/^extraction\.([a-z_]+)$/);
      if (!m) continue;
      const field = m[1];
      const stat = byField.get(field) ?? { count: 0, changes: new Map() };
      stat.count += 1;
      const key = `${truncate(row.ai_value)}→${truncate(row.human_value)}`;
      stat.changes.set(key, (stat.changes.get(key) ?? 0) + 1);
      byField.set(field, stat);
    }

    const ranked = [...byField.entries()]
      .filter(([, s]) => s.count >= MIN_CORRECTIONS_PER_FIELD)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, TOP_FIELDS);

    if (ranked.length > 0) {
      const lines = [`## Common extraction errors from past projects (last ${LOOKBACK_DAYS} days — your prior outputs that humans corrected):`];
      for (const [field, s] of ranked) {
        const topChanges = [...s.changes.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, TOP_CHANGES_PER_FIELD)
          .map(([k, c]) => `${k} (${c}×)`)
          .join(', ');
        lines.push(`- **${field}**: ${s.count} corrections, e.g. ${topChanges}`);
      }
      lines.push('Be extra careful on these fields — re-read the source text before answering.');
      snippet = lines.join('\n') + '\n';
    }
  } catch (err) {
    console.warn('[extraction-hints] read failed, shipping no hint:', (err as Error).message);
    snippet = '';
  }

  cache = { fetchedAt: Date.now(), snippet };
  return snippet;
}

/** Force re-read on next call. */
export function invalidateExtractionHintsCache(): void {
  cache = null;
}

function truncate(v: unknown, max = 24): string {
  if (v == null) return 'null';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > max ? s.slice(0, max) + '…' : s;
}
