import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { requireAuth } from '@/lib/shared/api-auth';

export const dynamic = 'force-dynamic';

type ItemRow = {
  folder_id: string;
  kind: 'drawing' | 'email_attachment' | 'email' | 'boq';
  label: string;
  mime_type?: string | null;
  size_bytes?: number | null;
  storage_path?: string | null;
  gmail_message_id?: string | null;
  gmail_attachment_id?: string | null;
  ref_project_id?: string | null;
  ref_email_id?: string | null;
  source_table?: string | null;
  source_id?: string | null;
};

// POST: add items to a folder. Body is a source descriptor:
//   { source: 'bid',   projectId }
//   { source: 'email', threadId?, messageId?, attachmentIds?: string[], includeBody?: boolean }
// Insert is idempotent via the (folder_id, kind, source_id) unique index.
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const folderId = params.id;
    const body = await request.json();
    const source = body?.source;

    let rows: ItemRow[] = [];
    if (source === 'bid') {
      rows = await buildBidRows(folderId, body.projectId);
    } else if (source === 'email') {
      rows = await buildEmailRows(folderId, {
        threadId: body.threadId,
        messageId: body.messageId,
        attachmentIds: Array.isArray(body.attachmentIds) ? body.attachmentIds : null,
        includeBody: body.includeBody !== false,
      });
    } else {
      return NextResponse.json({ error: `Unknown source '${source}'` }, { status: 400 });
    }

    if (rows.length === 0) {
      return NextResponse.json({ added: 0, items: [] });
    }

    // ignoreDuplicates so re-adding the same source row is a no-op, not an error.
    const { data, error } = await supabaseAdmin
      .from('sabi_folder_items')
      .upsert(rows, { onConflict: 'folder_id,kind,source_id', ignoreDuplicates: true })
      .select();

    if (error) throw error;

    await supabaseAdmin
      .from('sabi_project_folders')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', folderId);

    return NextResponse.json({ added: data?.length || 0, items: data || [] }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Failed to add items', details: message }, { status: 500 });
  }
}

// Pull a bid's files (sabi_attachments), its source email, and its BOQ.
async function buildBidRows(folderId: string, projectId: string): Promise<ItemRow[]> {
  if (!projectId) throw new Error('projectId is required for source=bid');
  const rows: ItemRow[] = [];

  const { data: project } = await supabaseAdmin
    .from('sabi_projects')
    .select('id, email_id, email_thread_id, email_subject, status')
    .eq('id', projectId)
    .single();

  // Catalogued files. Gmail-sourced rows (have message+attachment ids) are
  // labelled as email attachments; the rest are uploaded drawings.
  const { data: attachments } = await supabaseAdmin
    .from('sabi_attachments')
    .select('id, filename, mime_type, size_bytes, attachment_id, message_id, storage_path')
    .eq('project_id', projectId)
    .order('created_at');

  for (const a of attachments || []) {
    const att = a as Record<string, unknown>;
    const fromEmail = !!att.attachment_id && !!att.message_id;
    rows.push({
      folder_id: folderId,
      kind: fromEmail ? 'email_attachment' : 'drawing',
      label: (att.filename as string) || 'file',
      mime_type: (att.mime_type as string) || null,
      size_bytes: (att.size_bytes as number) || null,
      storage_path: (att.storage_path as string) || null,
      gmail_message_id: (att.message_id as string) || null,
      gmail_attachment_id: (att.attachment_id as string) || null,
      ref_project_id: projectId,
      source_table: 'sabi_attachments',
      source_id: att.id as string,
    });
  }

  // Source email (mail body) — by FK if present, else by thread.
  if (project) {
    let emailRow: Record<string, unknown> | null = null;
    if (project.email_id) {
      const { data } = await supabaseAdmin
        .from('sabi_emails')
        .select('id, gmail_message_id, subject')
        .eq('id', project.email_id)
        .maybeSingle();
      emailRow = data;
    } else if (project.email_thread_id) {
      const { data } = await supabaseAdmin
        .from('sabi_emails')
        .select('id, gmail_message_id, subject')
        .eq('thread_id', project.email_thread_id)
        .order('date', { ascending: true })
        .limit(1)
        .maybeSingle();
      emailRow = data;
    }
    if (emailRow) {
      rows.push({
        folder_id: folderId,
        kind: 'email',
        label: (emailRow.subject as string) || project.email_subject || 'Email',
        mime_type: 'text/html',
        ref_project_id: projectId,
        ref_email_id: emailRow.id as string,
        gmail_message_id: (emailRow.gmail_message_id as string) || null,
        source_table: 'sabi_emails',
        source_id: emailRow.id as string,
      });
    }
  }

  // Generated BOQ — stored at boq/{projectId}/power-boq.pdf.
  const { data: est } = await supabaseAdmin
    .from('sabi_estimations')
    .select('id, generated_boq_url')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const boqPath = (est?.generated_boq_url as string) ||
    (project?.status === 'boq_ready' ? `boq/${projectId}/power-boq.pdf` : null);
  if (boqPath) {
    rows.push({
      folder_id: folderId,
      kind: 'boq',
      label: 'Power BOQ.pdf',
      mime_type: 'application/pdf',
      storage_path: boqPath,
      ref_project_id: projectId,
      source_table: 'sabi_estimations',
      source_id: (est?.id as string) || projectId,
    });
  }

  return rows;
}

// Pull an email's body and its attachments from the synced inbox tables.
async function buildEmailRows(
  folderId: string,
  opts: { threadId?: string; messageId?: string; attachmentIds: string[] | null; includeBody: boolean }
): Promise<ItemRow[]> {
  const { threadId, messageId, attachmentIds, includeBody } = opts;
  if (!threadId && !messageId) throw new Error('threadId or messageId is required for source=email');

  let emailQuery = supabaseAdmin
    .from('sabi_emails')
    .select('id, gmail_message_id, thread_id, subject')
    .order('date', { ascending: true });
  emailQuery = threadId ? emailQuery.eq('thread_id', threadId) : emailQuery.eq('gmail_message_id', messageId);

  const { data: emails } = await emailQuery;
  if (!emails || emails.length === 0) return [];

  const rows: ItemRow[] = [];

  // Body item: the named message if given, else the latest in the thread.
  if (includeBody) {
    const target = messageId
      ? emails.find((e: Record<string, unknown>) => e.gmail_message_id === messageId) || emails[emails.length - 1]
      : emails[emails.length - 1];
    rows.push({
      folder_id: folderId,
      kind: 'email',
      label: (target.subject as string) || 'Email',
      mime_type: 'text/html',
      ref_email_id: target.id as string,
      gmail_message_id: (target.gmail_message_id as string) || null,
      source_table: 'sabi_emails',
      source_id: target.id as string,
    });
  }

  // Attachments across the thread's emails (optionally filtered to a selection).
  const emailIds = emails.map((e: Record<string, unknown>) => e.id as string);
  const { data: atts } = await supabaseAdmin
    .from('sabi_email_attachments')
    .select('id, gmail_attachment_id, gmail_message_id, filename, mime_type, size_bytes, storage_path')
    .in('email_id', emailIds);

  for (const a of atts || []) {
    const att = a as Record<string, unknown>;
    if (attachmentIds && !attachmentIds.includes(att.gmail_attachment_id as string)) continue;
    rows.push({
      folder_id: folderId,
      kind: 'email_attachment',
      label: (att.filename as string) || 'attachment',
      mime_type: (att.mime_type as string) || null,
      size_bytes: (att.size_bytes as number) || null,
      storage_path: (att.storage_path as string) || null,
      gmail_message_id: (att.gmail_message_id as string) || null,
      gmail_attachment_id: (att.gmail_attachment_id as string) || null,
      source_table: 'sabi_email_attachments',
      source_id: att.id as string,
    });
  }

  return rows;
}
