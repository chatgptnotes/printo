import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { classifyEmail } from '@/lib/ai/ai-provider';
import { logActivity, updateProjectStatus } from '@/lib/storage/activity-logger';
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

    const { data: project, error } = await supabaseAdmin
      .from('sabi_projects')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    await logActivity(id, 2, 'Register New Enquiry', 'started');

    const result = await classifyEmail(
      project.email_subject || '',
      project.email_snippet || '',
      project.email_from || ''
    );

    await supabaseAdmin
      .from('sabi_projects')
      .update({
        priority: result.priority,
        ai_classification: result as unknown as Record<string, unknown>,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    await updateProjectStatus(id, 'classified');
    await logActivity(id, 2, 'Register New Enquiry', 'completed', {
      isRfq: result.isRfq,
      confidence: result.confidence,
      priority: result.priority,
    });

    return NextResponse.json({ classification: result });
  } catch (error: any) {
    console.error('Classification error:', error);
    await logActivity(params.id, 2, 'Register New Enquiry', 'failed', { error: error.message });
    return NextResponse.json(
      { error: 'Classification failed', details: error.message },
      { status: 500 }
    );
  }
}
