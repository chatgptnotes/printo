import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { requireAuth } from '@/lib/shared/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const priority = searchParams.get('priority');

    // Select only columns the bid list needs — drops ai_classification (~5KB),
    // ai_extraction (~10KB), and notes (~2KB) per row to reduce egress.
    let query = supabaseAdmin
      .from('sabi_projects')
      .select(`id, email_thread_id, email_message_id, email_from, email_subject, email_date, email_snippet,
        client_name, project_name, location, priority, status, floors, parking_floors,
        total_area_sqft, typical_height_m, building_type, deadline, reputation_class,
        final_quote_aed, created_at, updated_at,
        sabi_estimations(final_quote_aed, total_aed, cost_per_sqft_aed, yardstick_status, george_approved)`)
      .order('email_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);
    if (priority) query = query.eq('priority', priority);

    const { data, error } = await query;

    if (error) throw error;

    const projects = (data || []).map((p: Record<string, unknown>) => {
      const est = Array.isArray(p.sabi_estimations) ? p.sabi_estimations[0] : p.sabi_estimations;
      return {
        ...p,
        final_quote_aed: (est as Record<string, unknown>)?.final_quote_aed || null,
        sabi_estimations: undefined,
      };
    });

    return NextResponse.json({ projects });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Failed to fetch projects', details: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json();

    const { data, error } = await supabaseAdmin
      .from('sabi_projects')
      .insert({
        email_thread_id: null,
        email_message_id: null,
        email_from: null,
        email_subject: body.project_name || 'Direct Upload Project',
        email_date: null,
        email_snippet: body.notes || null,
        client_name: body.client_name || null,
        project_name: body.project_name || null,
        location: body.location || null,
        priority: body.priority || 'new',
        status: body.status || 'pending',
        building_type: body.building_type || null,
        floors: body.floors ? Number(body.floors) : null,
        total_area_sqft: body.total_area_sqft ? Number(body.total_area_sqft) : null,
        notes: body.notes || null,
      })
      .select()
      .single();

    if (error) throw error;

    await supabaseAdmin.from('sabi_activity_log').insert({
      project_id: data.id,
      step: 1,
      step_name: 'Project Created',
      status: 'completed',
      details: { source: 'direct_upload' },
    });

    return NextResponse.json({ project: data }, { status: 201 });
  } catch (error: any) {
    console.error('Project create error:', error);
    return NextResponse.json(
      { error: 'Failed to create project', details: error.message },
      { status: 500 }
    );
  }
}
