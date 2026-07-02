import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { requireAuth } from '@/lib/shared/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const { data, error } = await supabaseAdmin
      .from('sabi_yardstick_rates')
      .select('*')
      .order('building_type')
      .order('service_type');

    if (error) throw error;

    return NextResponse.json({ rates: data || [] });
  } catch (error: any) {
    console.error('Yardstick fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch yardstick rates', details: error.message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json();

    const { data, error } = await supabaseAdmin
      .from('sabi_yardstick_rates')
      .insert({
        building_type: body.building_type,
        service_type: body.service_type,
        min_aed_per_sqft: body.min_aed_per_sqft,
        max_aed_per_sqft: body.max_aed_per_sqft,
        notes: body.notes || null,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ rate: data }, { status: 201 });
  } catch (error: any) {
    console.error('Yardstick create error:', error);
    return NextResponse.json(
      { error: 'Failed to create rate', details: error.message },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('sabi_yardstick_rates')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ rate: data });
  } catch (error: any) {
    console.error('Yardstick update error:', error);
    return NextResponse.json(
      { error: 'Failed to update rate', details: error.message },
      { status: 500 }
    );
  }
}
