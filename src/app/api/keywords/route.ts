import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { RFQ_KEYWORDS } from '@/lib/shared/constants';
import { loadKeywordObjectsFromDB, KeywordObject } from '@/lib/pipeline/keywords';
import { requireAuth } from '@/lib/shared/api-auth';

export const dynamic = 'force-dynamic';

// GET: return current keywords (enriched objects + flat array for backward compat)
export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const result = await loadKeywordObjectsFromDB();
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ source: 'defaults', keywords: RFQ_KEYWORDS, keywordObjects: [] });
  }
}

// POST: save updated keywords to DB
export async function POST(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json();
    const { keywords, keywordObjects } = body as {
      keywords?: string[];
      keywordObjects?: KeywordObject[];
    };

    let toSave: KeywordObject[];

    if (keywordObjects && Array.isArray(keywordObjects)) {
      // New format: enriched objects from master page
      const seen = new Set<string>();
      toSave = keywordObjects
        .filter(k => {
          const text = k.text?.trim().toLowerCase();
          if (!text || seen.has(text)) return false;
          seen.add(text);
          return true;
        })
        .map(k => ({
          text: k.text.trim().toLowerCase(),
          category: k.category || 'uncategorized',
          added_at: k.added_at || new Date().toISOString(),
        }));
    } else if (keywords && Array.isArray(keywords)) {
      // Old format: flat string array (backward compat from settings page)
      const cleaned = [...new Set(
        keywords.map((k: string) => k.trim().toLowerCase()).filter((k: string) => k.length > 0)
      )];
      toSave = cleaned.map(text => ({
        text,
        category: 'uncategorized',
        added_at: new Date().toISOString(),
      }));
    } else {
      return NextResponse.json({ error: 'keywords or keywordObjects must be provided' }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from('sabi_settings')
      .upsert(
        { key: 'rfq_keywords', value: { keywords: toSave }, updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      );

    if (error) throw error;

    return NextResponse.json({
      saved: true,
      count: toSave.length,
      keywords: toSave.map(k => k.text),
      keywordObjects: toSave,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

// DELETE: remove a single keyword by text
export async function DELETE(request: NextRequest) {
  try {
    const { text } = await request.json();
    if (!text) {
      return NextResponse.json({ error: 'text is required' }, { status: 400 });
    }

    const target = text.trim().toLowerCase();
    const { keywordObjects } = await loadKeywordObjectsFromDB();
    const filtered = keywordObjects.filter(k => k.text.toLowerCase() !== target);

    if (filtered.length === keywordObjects.length) {
      return NextResponse.json({ error: 'Keyword not found' }, { status: 404 });
    }

    const { error } = await supabaseAdmin
      .from('sabi_settings')
      .upsert(
        { key: 'rfq_keywords', value: { keywords: filtered }, updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      );

    if (error) throw error;

    return NextResponse.json({ deleted: true, remaining: filtered.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
