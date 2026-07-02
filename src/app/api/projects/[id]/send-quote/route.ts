import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/shared/api-auth';
import { sendQuotation } from '@/lib/email/send-quotation';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const result = await sendQuotation(params.id);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  // Best-effort WhatsApp notification (won't block the response)
  try {
    const { data: project } = await import('@/lib/storage/supabase').then((m) =>
      m.supabaseAdmin.from('sabi_projects').select('project_name, email_subject').eq('id', params.id).single()
    );
    const { data: estimation } = await import('@/lib/storage/supabase').then((m) =>
      m.supabaseAdmin.from('sabi_estimations').select('final_quote_aed').eq('project_id', params.id).limit(1).single()
    );
    const projectName = project?.project_name || project?.email_subject || 'project';
    const amount = estimation?.final_quote_aed
      ? `AED ${Number(estimation.final_quote_aed).toLocaleString()}`
      : '';
    const origin = request.nextUrl.origin;
    await fetch(`${origin}/api/whatsapp/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: request.headers.get('cookie') || '',
      },
      body: JSON.stringify({
        message: `Quotation for "${projectName}" sent to ${result.sent_to}.${amount ? ' Final quote: ' + amount + '.' : ''}`,
      }),
    });
  } catch {
    // Best-effort
  }

  return NextResponse.json({
    sent: true,
    sent_at: result.sent_at,
    sent_to: result.sent_to,
  });
}
