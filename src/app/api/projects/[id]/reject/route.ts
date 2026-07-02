import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { logActivity, updateProjectStatus } from '@/lib/storage/activity-logger';
import { ProjectStatus } from '@/lib/shared/types';
import { requireAuth } from '@/lib/shared/api-auth';

export const dynamic = 'force-dynamic';

const REVERT_STATUS_MAP: Record<number, ProjectStatus> = {
  13: 'extracted',
  14: 'extracted',
  17: 'estimating',
  19: 'estimated',
};

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const { id } = params;
    const body = await request.json();
    const { reason, revert_to_step } = body;

    // Reset approval
    const { data: estimation } = await supabaseAdmin
      .from('sabi_estimations')
      .select('id')
      .eq('project_id', id)
      .limit(1)
      .single();

    if (estimation) {
      await supabaseAdmin
        .from('sabi_estimations')
        .update({
          george_approved: false,
          approved_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', estimation.id);
    }

    // Revert project status
    const revertStatus = REVERT_STATUS_MAP[revert_to_step] || 'estimated';
    await updateProjectStatus(id, revertStatus);

    await logActivity(id, 14, 'Confirm Total', 'failed', {
      rejected: true,
      reason: reason || 'No reason provided',
      reverted_to_step: revert_to_step,
      reverted_to_status: revertStatus,
    });

    return NextResponse.json({
      rejected: true,
      reverted_to: revertStatus,
    });
  } catch (error: any) {
    console.error('Rejection error:', error);
    return NextResponse.json(
      { error: 'Rejection failed', details: error.message },
      { status: 500 }
    );
  }
}
