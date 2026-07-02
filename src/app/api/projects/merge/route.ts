import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { logActivity } from '@/lib/storage/activity-logger';
import { requireAuth } from '@/lib/shared/api-auth';

export const dynamic = 'force-dynamic';

// POST: Merge source project into target project
export async function POST(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const { sourceId, targetId } = await request.json();

    if (!sourceId || !targetId || sourceId === targetId) {
      return NextResponse.json({ error: 'sourceId and targetId are required and must be different' }, { status: 400 });
    }

    // Verify both exist
    const [sourceRes, targetRes] = await Promise.all([
      supabaseAdmin.from('sabi_projects').select('id, project_name, email_subject').eq('id', sourceId).single(),
      supabaseAdmin.from('sabi_projects').select('id, project_name, email_subject').eq('id', targetId).single(),
    ]);

    if (!sourceRes.data || !targetRes.data) {
      return NextResponse.json({ error: 'One or both projects not found' }, { status: 404 });
    }

    // Move attachments from source to target
    await supabaseAdmin
      .from('sabi_attachments')
      .update({ project_id: targetId })
      .eq('project_id', sourceId);

    // Move activity logs from source to target
    await supabaseAdmin
      .from('sabi_activity_log')
      .update({ project_id: targetId })
      .eq('project_id', sourceId);

    // Move services from source to target (only if target has none)
    const { data: targetServices } = await supabaseAdmin
      .from('sabi_services')
      .select('id')
      .eq('project_id', targetId)
      .limit(1);

    if (!targetServices?.length) {
      await supabaseAdmin
        .from('sabi_services')
        .update({ project_id: targetId })
        .eq('project_id', sourceId);
    }

    // Mark source as archived with merge note
    await supabaseAdmin
      .from('sabi_projects')
      .update({
        status: 'archived',
        notes: JSON.stringify({ merged_into: targetId, merged_at: new Date().toISOString() }),
        updated_at: new Date().toISOString(),
      })
      .eq('id', sourceId);

    // Log the merge on target
    await logActivity(targetId, 0, 'Project Merged', 'completed', {
      merged_from: sourceId,
      source_name: sourceRes.data.project_name || sourceRes.data.email_subject,
    });

    return NextResponse.json({
      merged: true,
      sourceId,
      targetId,
      message: `Merged "${sourceRes.data.project_name || sourceRes.data.email_subject}" into "${targetRes.data.project_name || targetRes.data.email_subject}"`,
    });
  } catch (error: any) {
    console.error('Merge error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
