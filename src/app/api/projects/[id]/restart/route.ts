import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { logActivity } from '@/lib/storage/activity-logger';
import { requireAuth } from '@/lib/shared/api-auth';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const { id } = params;

    // Verify project exists
    const { data: project, error: fetchErr } = await supabaseAdmin
      .from('sabi_projects')
      .select('id')
      .eq('id', id)
      .single();

    if (fetchErr || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Delete all child data in parallel
    await Promise.all([
      supabaseAdmin.from('sabi_activity_log').delete().eq('project_id', id),
      supabaseAdmin.from('sabi_services').delete().eq('project_id', id),
      supabaseAdmin.from('sabi_estimations').delete().eq('project_id', id),
      // Delete zip-extracted attachments (will be re-created during extraction)
      supabaseAdmin.from('sabi_attachments').delete().eq('project_id', id).is('attachment_id', null),
      // Reset original email attachments (keep rows, clear processed data)
      supabaseAdmin.from('sabi_attachments').update({ discipline: null, extracted_data: null }).eq('project_id', id),
    ]);

    // Reset project fields (keep email source data and priority)
    await supabaseAdmin
      .from('sabi_projects')
      .update({
        status: 'new',
        notes: null,
        approval_gate: null,
        reputation_class: null,
        ai_extraction: null,
        floors: null,
        parking_floors: null,
        typical_floors: null,
        area_per_floor_sqft: null,
        total_area_sqft: null,
        typical_height_m: null,
        client_name: null,
        project_name: null,
        location: null,
        building_type: null,
        deadline: null,
        final_quote_aed: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    // Log the restart as the first activity entry
    await logActivity(id, 1, 'Pipeline Restart', 'completed', {
      reason: 'User-initiated restart',
      restarted_at: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, status: 'new' });
  } catch (error: any) {
    console.error('Restart pipeline error:', error);
    return NextResponse.json(
      { error: error.message || 'Restart failed' },
      { status: 500 }
    );
  }
}
