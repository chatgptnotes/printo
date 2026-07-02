import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { requireAuth } from '@/lib/shared/api-auth';

export const dynamic = 'force-dynamic';

interface BulkItem {
  discipline: string;
  category: string;
  item_name: string;
  description?: string | null;
  unit: string;
  unit_rate_aed: number;
  brand?: string | null;
  notes?: string | null;
}

export async function POST(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const { items } = (await request.json()) as { items: BulkItem[] };

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'No items provided' }, { status: 400 });
    }

    if (items.length > 500) {
      return NextResponse.json({ error: 'Maximum 500 items per upload' }, { status: 400 });
    }

    const errors: string[] = [];
    const validItems: BulkItem[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const row = i + 1;

      if (!item.discipline?.trim()) { errors.push(`Row ${row}: missing discipline`); continue; }
      if (!item.category?.trim()) { errors.push(`Row ${row}: missing category`); continue; }
      if (!item.item_name?.trim()) { errors.push(`Row ${row}: missing item name`); continue; }
      if (!item.unit?.trim()) { errors.push(`Row ${row}: missing unit`); continue; }
      if (item.unit_rate_aed == null || isNaN(Number(item.unit_rate_aed)) || Number(item.unit_rate_aed) < 0) {
        errors.push(`Row ${row}: invalid rate "${item.unit_rate_aed}"`); continue;
      }

      validItems.push({
        discipline: item.discipline.trim().toLowerCase(),
        category: item.category.trim(),
        item_name: item.item_name.trim(),
        description: item.description?.trim() || null,
        unit: item.unit.trim(),
        unit_rate_aed: Number(item.unit_rate_aed),
        brand: item.brand?.trim() || null,
        notes: item.notes?.trim() || null,
      });
    }

    let inserted = 0;
    if (validItems.length > 0) {
      const { error, count } = await supabaseAdmin
        .from('sabi_price_library')
        .insert(validItems);

      if (error) {
        return NextResponse.json({ error: `Database error: ${error.message}`, inserted: 0, errors }, { status: 500 });
      }
      inserted = validItems.length;
    }

    return NextResponse.json({
      inserted,
      skipped: errors.length,
      total: items.length,
      errors: errors.slice(0, 20),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Bulk import failed' }, { status: 500 });
  }
}
