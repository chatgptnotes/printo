import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { logActivity } from '@/lib/storage/activity-logger';
import { requireAuth } from '@/lib/shared/api-auth';
import { tuneYardstickFromApproval } from '@/lib/pipeline/yardstick-tuner';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const { id } = params;

    // Fetch estimation
    const { data: estimation, error } = await supabaseAdmin
      .from('sabi_estimations')
      .select('*')
      .eq('project_id', id)
      .limit(1)
      .single();

    if (error || !estimation) {
      return NextResponse.json(
        { error: 'No estimation found for this project' },
        { status: 404 }
      );
    }

    // Update approval
    const now = new Date().toISOString();
    await supabaseAdmin
      .from('sabi_estimations')
      .update({
        george_approved: true,
        approved_at: now,
        updated_at: now,
      })
      .eq('id', estimation.id);

    await logActivity(id, 14, 'Confirm Total', 'completed', {
      approved: true,
      approved_by: 'George Varkey M',
      approved_at: now,
    });

    // Fold this approval's actual AED/sqft into sabi_yardstick_rates so the
    // next estimate sanity-checks against real recent quotes. Fire-and-forget
    // — yardstick tuning failures must not roll back the approval.
    waitUntil(
      tuneYardstickFromApproval(id)
        .then(outcomes => {
          const updated = outcomes.filter(o => o.status === 'updated').length;
          if (updated > 0) console.log(`[approve] yardstick-tuner updated ${updated} cohort(s) for project ${id}`);
        })
        .catch(err => console.warn(`[approve] yardstick-tuner failed for ${id}:`, err?.message ?? err)),
    );

    // Send WhatsApp notification
    const { data: project } = await supabaseAdmin
      .from('sabi_projects')
      .select('project_name')
      .eq('id', id)
      .single();

    try {
      await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001'}/api/whatsapp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `BOQ for "${project?.project_name || 'Unknown Project'}" approved by George. Ready to send to client.`,
        }),
      });
    } catch {
      // WhatsApp notification is best-effort
    }

    return NextResponse.json({ approved: true, approved_at: now });
  } catch (error: any) {
    console.error('Approval error:', error);
    return NextResponse.json(
      { error: 'Approval failed', details: error.message },
      { status: 500 }
    );
  }
}
