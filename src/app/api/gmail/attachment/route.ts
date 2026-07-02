import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { requireAuth } from '@/lib/shared/api-auth';

export const dynamic = 'force-dynamic';

const STORAGE_BUCKET = 'sabi-attachments';

// GET: Download attachment from Supabase Storage
// Website NEVER calls Gmail API directly — all files served from storage
export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(request.url);
  const messageId = searchParams.get('messageId');
  const attachmentId = searchParams.get('attachmentId');
  const filename = searchParams.get('filename') || 'attachment';

  if (!messageId || !attachmentId) {
    return NextResponse.json({ error: 'messageId and attachmentId are required' }, { status: 400 });
  }

  const ext = filename.split('.').pop()?.toLowerCase();
  const contentTypes: Record<string, string> = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    bmp: 'image/bmp',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    txt: 'text/plain',
    csv: 'text/csv',
    html: 'text/html',
    json: 'application/json',
    zip: 'application/zip',
  };

  const contentType = contentTypes[ext || ''] || 'application/octet-stream';
  const isInline = ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'txt', 'csv', 'html'].includes(ext || '');
  const disposition = isInline
    ? `inline; filename="${encodeURIComponent(filename)}"`
    : `attachment; filename="${encodeURIComponent(filename)}"`;

  // 1. Try sabi_email_attachments (synced emails)
  const { data: emailAtt } = await supabaseAdmin
    .from('sabi_email_attachments')
    .select('storage_path')
    .eq('gmail_attachment_id', attachmentId)
    .eq('gmail_message_id', messageId)
    .maybeSingle();

  if (emailAtt?.storage_path) {
    const result = await downloadFromStorage(emailAtt.storage_path);
    if (result) {
      return new NextResponse(new Uint8Array(result), {
        headers: { 'Content-Type': contentType, 'Content-Disposition': disposition, 'Content-Length': result.length.toString() },
      });
    }
  }

  // 2. Try sabi_attachments (project-level, may have been uploaded during extract)
  const { data: projectAtt } = await supabaseAdmin
    .from('sabi_attachments')
    .select('storage_path')
    .eq('attachment_id', attachmentId)
    .eq('message_id', messageId)
    .not('storage_path', 'is', null)
    .maybeSingle();

  if (projectAtt?.storage_path) {
    const result = await downloadFromStorage(projectAtt.storage_path);
    if (result) {
      return new NextResponse(new Uint8Array(result), {
        headers: { 'Content-Type': contentType, 'Content-Disposition': disposition, 'Content-Length': result.length.toString() },
      });
    }
  }

  // 3. Fallback: download directly from Gmail API (sync only stores metadata)
  try {
    const { getAttachment } = await import('@/lib/email/gmail');
    const buffer = await getAttachment(messageId, attachmentId);

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': disposition,
        'Content-Length': buffer.length.toString(),
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Attachment not found in storage and Gmail download failed.', details: err.message },
      { status: 404 }
    );
  }
}

async function downloadFromStorage(storagePath: string): Promise<Buffer | null> {
  try {
    const { data, error } = await supabaseAdmin.storage
      .from(STORAGE_BUCKET)
      .download(storagePath);
    if (error || !data) return null;
    return Buffer.from(await data.arrayBuffer());
  } catch {
    return null;
  }
}
