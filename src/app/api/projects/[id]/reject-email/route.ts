import { NextRequest, NextResponse } from 'next/server';
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
    const body = await request.json();
    const {
      reason,
      client_email,
      client_name,
      project_name,
      gate,
    } = body as {
      reason: string;
      client_email: string;
      client_name: string;
      project_name: string;
      gate: number;
    };

    if (!reason || !client_email) {
      return NextResponse.json(
        { error: 'Reason and client email are required' },
        { status: 400 }
      );
    }

    // Compose rejection email body
    const emailBody = [
      `Dear ${client_name || 'Sir/Madam'},`,
      '',
      `Thank you for your enquiry regarding ${project_name || 'the project'}.`,
      '',
      `After careful review, we regret to inform you that we are unable to proceed with this quotation at this time.`,
      '',
      `Reason: ${reason}`,
      '',
      `Should you wish to discuss further or resubmit with modifications, please do not hesitate to contact us.`,
      '',
      'Best regards,',
      'ERP Realsoft Estimation Team',
      'estimation@realsoft.example',
      '+971 4 XXX XXXX',
    ].join('\n');

    const emailSubject = `RE: ${project_name || 'Your Enquiry'} — Quotation Update`;

    // Use Gmail API to send
    // Import dynamically to avoid issues when Gmail is not configured
    try {
      const { replyToThread } = await import('@/lib/email/gmail');

      // Fetch project to get thread ID
      const { supabaseAdmin } = await import('@/lib/storage/supabase');
      const { data: project } = await supabaseAdmin
        .from('sabi_projects')
        .select('email_thread_id, email_message_id')
        .eq('id', id)
        .single();

      if (project?.email_thread_id) {
        await replyToThread({
          threadId: project.email_thread_id,
          to: client_email,
          subject: emailSubject,
          body: emailBody,
        });
      }
    } catch {
      // Gmail not available — log but don't fail
    }

    // Log the activity
    await logActivity(id, gate || 0, 'Rejection Email Sent', 'completed', {
      type: 'rejection_email',
      to: client_email,
      subject: emailSubject,
      reason,
      sent_at: new Date().toISOString(),
    }).catch(() => {
      // Best-effort logging
    });

    return NextResponse.json({
      success: true,
      message: `Rejection email sent to ${client_email}`,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to send rejection email', details: message },
      { status: 500 }
    );
  }
}
