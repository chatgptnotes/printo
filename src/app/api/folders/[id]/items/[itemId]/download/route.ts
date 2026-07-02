import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { requireAuth } from '@/lib/shared/api-auth';

export const dynamic = 'force-dynamic';

const STORAGE_BUCKET = 'sabi-attachments';

const CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain', csv: 'text/csv', html: 'text/html', json: 'application/json', zip: 'application/zip',
};
const INLINE_EXTS = ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'txt', 'csv', 'html'];

// GET: stream a folder item. Resolution order:
//   kind='email'      -> render stored mail body as HTML
//   has storage_path  -> download from the sabi-attachments bucket
//   else gmail ids    -> live Gmail attachment fetch fallback
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; itemId: string } }
) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { data: item, error } = await supabaseAdmin
    .from('sabi_folder_items')
    .select('kind, label, mime_type, storage_path, gmail_message_id, gmail_attachment_id, ref_email_id')
    .eq('id', params.itemId)
    .eq('folder_id', params.id)
    .single();

  if (error || !item) {
    return NextResponse.json({ error: 'Item not found' }, { status: 404 });
  }

  // Mail body — render the stored HTML/text from sabi_emails.
  if (item.kind === 'email' && item.ref_email_id) {
    const { data: email } = await supabaseAdmin
      .from('sabi_emails')
      .select('subject, from_address, date, body_html, body_text')
      .eq('id', item.ref_email_id)
      .single();
    if (!email) return NextResponse.json({ error: 'Email not found' }, { status: 404 });
    const html = email.body_html || `<pre style="white-space:pre-wrap;font-family:sans-serif">${escapeHtml(email.body_text || '(no body)')}</pre>`;
    const page = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(email.subject || 'Email')}</title></head>
<body style="max-width:800px;margin:24px auto;padding:0 16px;font-family:sans-serif">
<div style="border-bottom:1px solid #e5e7eb;padding-bottom:12px;margin-bottom:16px">
<h2 style="margin:0 0 4px">${escapeHtml(email.subject || '(No subject)')}</h2>
<div style="color:#6b7280;font-size:14px">${escapeHtml(email.from_address || '')} · ${escapeHtml(email.date || '')}</div>
</div>${html}</body></html>`;
    return new NextResponse(page, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  const filename = item.label || 'file';
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const contentType = item.mime_type || CONTENT_TYPES[ext] || 'application/octet-stream';
  const disposition = INLINE_EXTS.includes(ext)
    ? `inline; filename="${encodeURIComponent(filename)}"`
    : `attachment; filename="${encodeURIComponent(filename)}"`;

  // 1. Stored file (drawings, email attachments already synced, BOQ).
  if (item.storage_path) {
    const buf = await downloadFromStorage(item.storage_path);
    if (buf) {
      return new NextResponse(new Uint8Array(buf), {
        headers: { 'Content-Type': contentType, 'Content-Disposition': disposition, 'Content-Length': buf.length.toString() },
      });
    }
  }

  // 2. Gmail attachment that was never copied to storage — fetch live.
  if (item.gmail_message_id && item.gmail_attachment_id) {
    try {
      const { getAttachment } = await import('@/lib/email/gmail');
      const buffer = await getAttachment(item.gmail_message_id, item.gmail_attachment_id);
      return new NextResponse(new Uint8Array(buffer), {
        headers: { 'Content-Type': contentType, 'Content-Disposition': disposition, 'Content-Length': buffer.length.toString() },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown';
      return NextResponse.json({ error: 'File not in storage and Gmail download failed.', details: message }, { status: 404 });
    }
  }

  return NextResponse.json({ error: 'No downloadable source for this item.' }, { status: 404 });
}

async function downloadFromStorage(storagePath: string): Promise<Buffer | null> {
  try {
    const { data, error } = await supabaseAdmin.storage.from(STORAGE_BUCKET).download(storagePath);
    if (error || !data) return null;
    return Buffer.from(await data.arrayBuffer());
  } catch {
    return null;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}
