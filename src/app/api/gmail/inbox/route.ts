import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { randomUUID } from 'crypto';
import { requireAuth } from '@/lib/shared/api-auth';

// POST: Add a test email to sabi_emails for testing the pipeline
export async function POST(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json();
    const { from, subject, emailBody, attachments = [] } = body;

    if (!from || !subject || !emailBody) {
      return NextResponse.json({ error: 'from, subject, and emailBody are required' }, { status: 400 });
    }

    const fakeMessageId = `test-${randomUUID()}`;
    const fakeThreadId = `test-thread-${randomUUID()}`;
    const now = new Date().toISOString();
    const snippet = emailBody.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 200);

    // Insert test email into sabi_emails
    const { data: email, error: emailError } = await supabaseAdmin
      .from('sabi_emails')
      .insert({
        gmail_message_id: fakeMessageId,
        thread_id: fakeThreadId,
        from_address: from,
        to_address: 'estimation@realsoft.example',
        subject,
        date: now,
        snippet,
        body_html: emailBody,
        body_text: emailBody.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
        labels: ['INBOX', 'UNREAD'],
        has_attachments: attachments.length > 0,
        synced_at: now,
      })
      .select()
      .single();

    if (emailError) throw emailError;

    // Insert fake attachment metadata (filenames only — no real files)
    if (attachments.length > 0 && email) {
      const attRows = attachments.map((att: { filename: string; mimeType: string; size: number }) => ({
        email_id: email.id,
        gmail_attachment_id: `test-att-${randomUUID()}`,
        gmail_message_id: fakeMessageId,
        filename: att.filename,
        mime_type: att.mimeType || 'application/octet-stream',
        size_bytes: att.size || 0,
      }));

      await supabaseAdmin.from('sabi_email_attachments').insert(attRows);
    }

    return NextResponse.json({ success: true, emailId: email?.id, threadId: fakeThreadId });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to add test email';
    console.error('Add test email error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET: Fetch inbox emails from Supabase (synced cache)
// Website NEVER calls Gmail directly — all reads from sabi_emails
export async function GET(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const { searchParams } = new URL(request.url);
    const max = parseInt(searchParams.get('max') || '50', 10);

    const { data: emails, error } = await supabaseAdmin
      .from('sabi_emails')
      .select('gmail_message_id, thread_id, from_address, subject, date, snippet, labels, has_attachments')
      .order('date', { ascending: false })
      .limit(max * 3);

    if (error) throw new Error(`Supabase query failed: ${error.message}`);

    if (!emails || emails.length === 0) {
      return NextResponse.json({ emails: [], hint: 'No emails synced yet. Click Sync or Scan Inbox to pull emails from Gmail.' });
    }

    // Group by thread_id to produce thread summaries
    const threadMap = new Map<string, {
      threadId: string;
      from: string;
      subject: string;
      date: string;
      snippet: string;
      messageCount: number;
      labels: string[];
    }>();

    for (const email of emails) {
      const existing = threadMap.get(email.thread_id);
      if (!existing) {
        threadMap.set(email.thread_id, {
          threadId: email.thread_id,
          from: email.from_address || 'Unknown',
          subject: email.subject || '(no subject)',
          date: email.date || '',
          snippet: email.snippet || '',
          messageCount: 1,
          labels: email.labels || [],
        });
      } else {
        existing.messageCount++;
        if (email.date && (!existing.date || email.date > existing.date)) {
          existing.date = email.date;
          existing.snippet = email.snippet || existing.snippet;
          existing.labels = email.labels || existing.labels;
        }
      }
    }

    const threads = Array.from(threadMap.values())
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .slice(0, max);

    return NextResponse.json({ emails: threads });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to load inbox';
    return NextResponse.json({ error: message, emails: [] }, { status: 500 });
  }
}
