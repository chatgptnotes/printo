import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { requireAuth } from '@/lib/shared/api-auth';

export const dynamic = 'force-dynamic';

// GET: list all price library items (with optional filters)
export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(request.url);
  const discipline = searchParams.get('discipline');
  const category = searchParams.get('category');

  try {
    let query = supabaseAdmin
      .from('sabi_price_library')
      .select('*')
      .order('discipline')
      .order('category')
      .order('item_name');

    if (discipline) query = query.eq('discipline', discipline);
    if (category) query = query.eq('category', category);

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json(data || []);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch items';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST: add a new price library item
export async function POST(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json();

    const { data, error } = await supabaseAdmin
      .from('sabi_price_library')
      .insert({
        discipline: body.discipline,
        category: body.category,
        item_name: body.item_name,
        description: body.description || null,
        unit: body.unit,
        unit_rate_aed: body.unit_rate_aed,
        brand: body.brand || null,
        notes: body.notes || null,
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to add item';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

// PUT: update a price library item
export async function PUT(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('sabi_price_library')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to update item';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

// DELETE: remove a price library item
export async function DELETE(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const { error } = await supabaseAdmin.from('sabi_price_library').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to delete';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
