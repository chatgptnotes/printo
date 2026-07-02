import { NextRequest, NextResponse } from 'next/server';
import { getDemoEmail } from '@/lib/shared/demo-emails';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { requireAuth } from '@/lib/shared/api-auth';

// GET: Fetch single email content by threadId
// Website reads ONLY from Supabase — no Gmail API fallback
export async function GET(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const { searchParams } = new URL(request.url);
    const threadId = searchParams.get('threadId');

    if (!threadId) {
      return NextResponse.json({ error: 'threadId is required' }, { status: 400 });
    }

    // Check demo emails first
    const demo = getDemoEmail(threadId);
    if (demo) {
      return NextResponse.json({
        from: demo.from,
        subject: demo.subject,
        body: demo.body,
        date: demo.date,
        contentType: demo.contentType,
        messageId: demo.messageId,
        attachments: demo.attachments,
        images: demo.images,
      });
    }

    // Read from Supabase — all messages in thread
    const { data: messages, error } = await supabaseAdmin
      .from('sabi_emails')
      .select('*, sabi_email_attachments(*)')
      .eq('thread_id', threadId)
      .order('date', { ascending: true });

    if (error) throw new Error(`Supabase query failed: ${error.message}`);

    if (!messages || messages.length === 0) {
      return NextResponse.json(
        { error: 'Email not found. It may not have been synced yet — try clicking Sync first.' },
        { status: 404 }
      );
    }

    // Return ALL messages in thread for conversation view
    const thread = messages.map((msg: any) => ({
      from: msg.from_address,
      to: msg.to_address,
      subject: msg.subject,
      body: msg.body_html || msg.body_text || '(no body)',
      date: msg.date,
      contentType: msg.body_html ? 'text/html' : 'text/plain',
      messageId: msg.gmail_message_id,
      attachments: (msg.sabi_email_attachments || []).map((att: any) => ({
        filename: att.filename,
        mimeType: att.mime_type || 'application/octet-stream',
        size: att.size_bytes || 0,
        attachmentId: att.gmail_attachment_id,
        syncError: att.sync_error || null,
      })),
    }));

    // Latest message for backwards compatibility
    const latest = thread[thread.length - 1];

    return NextResponse.json({
      ...latest,
      thread,
      messageCount: thread.length,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to read email';
    return NextResponse.json(
      { error: 'Failed to read email', details: message },
      { status: 500 }
    );
  }
}
