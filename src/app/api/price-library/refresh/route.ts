import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { requireAuth } from '@/lib/shared/api-auth';
import { refreshDubaiRates, type PriceRefreshInput } from '@/lib/ai/claude-api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// A 50-item web-search pass is slower than a normal extract; give it room.
export const maxDuration = 300;

// GET: past refresh runs (newest first, capped). The page groups by batch_id.
export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { data, error } = await supabaseAdmin
      .from('sabi_price_rate_history')
      .select('batch_id, item_id, item_name, old_rate, new_rate, source, changed_at')
      .order('changed_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    return NextResponse.json(data || []);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch history';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST: fetch proposed latest Dubai rates (AI + live web search). No DB writes —
// the page shows a review panel and the user applies approved rows via PUT.
export async function POST(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { data, error } = await supabaseAdmin
      .from('sabi_price_library')
      .select('id, discipline, category, item_name, unit, unit_rate_aed')
      .order('discipline')
      .order('category')
      .order('item_name');
    if (error) throw error;

    const items = (data || []) as Array<{
      id: string; discipline: string; category: string;
      item_name: string; unit: string; unit_rate_aed: number;
    }>;
    if (items.length === 0) return NextResponse.json([]);

    const input: PriceRefreshInput[] = items.map(i => ({
      id: i.id,
      discipline: i.discipline,
      category: i.category,
      item_name: i.item_name,
      unit: i.unit,
      current_rate_aed: Number(i.unit_rate_aed),
    }));

    const proposals = await refreshDubaiRates(input);
    const byId = new Map(proposals.map(p => [p.id, p]));

    // Join proposals back onto the items so the UI shows old → new with context.
    // Only return items the AI returned a usable (non-null) new rate for.
    const result = items
      .map(i => {
        const p = byId.get(i.id);
        if (!p || p.new_rate_aed == null) return null;
        return {
          id: i.id,
          item_name: i.item_name,
          unit: i.unit,
          old_rate: Number(i.unit_rate_aed),
          new_rate: p.new_rate_aed,
          source_name: p.source_name,
          source_url: p.source_url,
          confidence: p.confidence,
        };
      })
      .filter(Boolean);

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch latest rates';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PUT: apply the rates the user approved. One round-trip — updates each row's
// rate + source + checked-date.
export async function PUT(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { items } = (await request.json()) as {
      items: Array<{ id: string; item_name?: string; old_rate?: number; unit_rate_aed: number; rate_source?: string | null }>;
    };

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'No items provided' }, { status: 400 });
    }
    if (items.length > 500) {
      return NextResponse.json({ error: 'Maximum 500 items per apply' }, { status: 400 });
    }

    const now = new Date().toISOString();
    const batchId = randomUUID();
    let updated = 0;
    const errors: string[] = [];
    const historyRows: Array<{
      batch_id: string; item_id: string; item_name: string;
      old_rate: number | null; new_rate: number; source: string | null; changed_at: string;
    }> = [];

    for (const item of items) {
      if (!item.id) { errors.push('missing id'); continue; }
      const rate = Number(item.unit_rate_aed);
      if (isNaN(rate) || rate < 0) { errors.push(`invalid rate for ${item.id}`); continue; }

      const source = item.rate_source?.trim() || null;
      const { error } = await supabaseAdmin
        .from('sabi_price_library')
        .update({
          unit_rate_aed: rate,
          rate_source: source,
          rate_checked_at: now,
          updated_at: now,
        })
        .eq('id', item.id);
      if (error) { errors.push(`${item.id}: ${error.message}`); continue; }
      updated++;
      historyRows.push({
        batch_id: batchId,
        item_id: item.id,
        item_name: item.item_name || '(unknown item)',
        old_rate: item.old_rate == null || isNaN(Number(item.old_rate)) ? null : Number(item.old_rate),
        new_rate: rate,
        source,
        changed_at: now,
      });
    }

    // One batched insert for the whole run (avoids per-row write storm).
    if (historyRows.length > 0) {
      await supabaseAdmin.from('sabi_price_rate_history').insert(historyRows);
    }

    return NextResponse.json({ updated, skipped: errors.length, errors: errors.slice(0, 20) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to apply rates';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
