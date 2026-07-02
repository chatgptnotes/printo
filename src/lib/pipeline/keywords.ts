import { supabaseAdmin } from '@/lib/storage/supabase';
import { RFQ_KEYWORDS } from '@/lib/shared/constants';

export interface KeywordObject {
  text: string;
  category: string;
  added_at: string;
}

export const KEYWORD_CATEGORIES = [
  { id: 'rfq_language', label: 'RFQ Language', color: 'blue' },
  { id: 'mep_discipline', label: 'MEP Discipline', color: 'green' },
  { id: 'commercial', label: 'Commercial', color: 'amber' },
  { id: 'project_scope', label: 'Project Scope', color: 'purple' },
  { id: 'uncategorized', label: 'Uncategorized', color: 'gray' },
] as const;

/** Load flat keyword strings for classification. Reads DB first, falls back to constants. */
export async function loadKeywordsFromDB(): Promise<string[]> {
  try {
    const { data } = await supabaseAdmin
      .from('sabi_settings')
      .select('value')
      .eq('key', 'rfq_keywords')
      .single();

    if (data?.value) {
      const raw = (data.value as any).keywords;
      if (!Array.isArray(raw) || raw.length === 0) return RFQ_KEYWORDS;
      // Handle both old format (string[]) and new format (KeywordObject[])
      if (typeof raw[0] === 'string') return raw;
      return raw.map((k: KeywordObject) => k.text);
    }
  } catch {
    // Table doesn't exist or no entry — use defaults
  }
  return RFQ_KEYWORDS;
}

/** Load full keyword objects for the master page UI. */
export async function loadKeywordObjectsFromDB(): Promise<{ source: string; keywords: string[]; keywordObjects: KeywordObject[] }> {
  try {
    const { data } = await supabaseAdmin
      .from('sabi_settings')
      .select('value')
      .eq('key', 'rfq_keywords')
      .single();

    if (data?.value) {
      const raw = (data.value as any).keywords;
      if (!Array.isArray(raw) || raw.length === 0) {
        return { source: 'defaults', ...defaultsToObjects() };
      }
      // Old format: string[] → convert to objects
      if (typeof raw[0] === 'string') {
        const objects = (raw as string[]).map(text => ({
          text,
          category: guessCategory(text),
          added_at: '',
        }));
        return { source: 'database', keywords: raw, keywordObjects: objects };
      }
      // New format: KeywordObject[]
      return {
        source: 'database',
        keywords: raw.map((k: KeywordObject) => k.text),
        keywordObjects: raw,
      };
    }
  } catch {
    // fall through
  }
  return { source: 'defaults', ...defaultsToObjects() };
}

function defaultsToObjects() {
  const keywordObjects = RFQ_KEYWORDS.map(text => ({
    text,
    category: guessCategory(text),
    added_at: '',
  }));
  return { keywords: RFQ_KEYWORDS, keywordObjects };
}

/** Auto-categorize a keyword based on its text. */
function guessCategory(text: string): string {
  const t = text.toLowerCase();
  const mep = ['mep', 'hvac', 'plumbing', 'electrical', 'fire fighting', 'fire alarm', 'drainage', 'bms'];
  if (mep.some(m => t.includes(m))) return 'mep_discipline';
  const rfq = ['rfq', 'request for quotation', 'request for proposal', 'tender', 'bid invitation', 'invitation to bid', 'enquiry', 'please quote', 'kindly quote', 'submit your offer'];
  if (rfq.some(r => t.includes(r))) return 'rfq_language';
  const commercial = ['best price', 'competitive price', 'price breakdown', 'cost breakdown', 'project cost', 'quotation', 'formal quotation', 'pricing request', 'quotation required'];
  if (commercial.some(c => t.includes(c))) return 'commercial';
  const scope = ['bill of quantities', 'boq', 'scope of work', 'site visit'];
  if (scope.some(s => t.includes(s))) return 'project_scope';
  return 'uncategorized';
}
