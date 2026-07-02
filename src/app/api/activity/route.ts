import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { requireAuth } from '@/lib/shared/api-auth';

export const dynamic = 'force-dynamic';

// GET: Fetch recent activity across all projects
export async function GET(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '10', 10);

    const { data, error } = await supabaseAdmin
      .from('sabi_activity_log')
      .select('id, project_id, step, step_name, status, details, created_at')
      .in('status', ['completed', 'failed'])
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    // Enrich with project names
    const projectIds = [...new Set((data || []).map(a => a.project_id))];
    const { data: projects } = await supabaseAdmin
      .from('sabi_projects')
      .select('id, project_name, email_subject')
      .in('id', projectIds);

    const projectMap = new Map((projects || []).map(p => [p.id, p.project_name || p.email_subject]));

    const activities = (data || []).map(a => ({
      ...a,
      project_name: projectMap.get(a.project_id) || 'Unknown Project',
    }));

    return NextResponse.json({ activities });
  } catch (error: any) {
    return NextResponse.json({ error: error.message, activities: [] }, { status: 500 });
  }
}
