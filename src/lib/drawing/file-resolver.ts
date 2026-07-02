/**
 * Universal binary resolver for sabi_attachments rows.
 *
 * Tries 5 sources in order:
 *   1. sabi_attachments.storage_path
 *   2. sabi_email_attachments matched by Gmail IDs from sabi_attachments
 *   3. sabi_email_attachments by filename via project.email_id
 *   4. sabi_email_attachments by filename via project.email_thread_id
 *   5. Gmail API live download
 *
 * On success via sources 3/4/5, patches sabi_attachments with the discovered
 * storage_path / Gmail IDs so subsequent loads are fast.
 *
 * Used by every route that needs the actual bytes of an attachment:
 * /api/files/.../download, /excel, /docx, /dxf
 */

import { supabaseAdmin } from '@/lib/storage/supabase';

const STORAGE_BUCKET = 'sabi-attachments';

export interface ResolvedAttachment {
  buffer: Buffer;
  filename: string;
  mime_type: string | null;
}

export interface ResolveError {
  error: string;
  filename: string;
  tried: string[];
  project_email_id: string | null;
  project_email_thread_id: string | null;
  hint: string;
}

export type ResolveResult = ResolvedAttachment | { error: ResolveError; status: number };

export async function resolveAttachmentBinary(
  projectId: string,
  attachmentId: string
): Promise<ResolveResult> {
  const { data: att, error } = await supabaseAdmin
    .from('sabi_attachments')
    .select('storage_path, attachment_id, message_id, filename, mime_type')
    .eq('id', attachmentId)
    .eq('project_id', projectId)
    .single();

  if (error || !att) {
    return {
      error: {
        error: 'Attachment not found',
        filename: 'unknown',
        tried: [],
        project_email_id: null,
        project_email_thread_id: null,
        hint: 'No row in sabi_attachments for this id + project',
      },
      status: 404,
    };
  }

  const filename: string = att.filename || 'attachment';
  let buffer: Buffer | null = null;
  const tried: string[] = [];

  let resolvedFromEmailAtt: {
    storage_path: string | null;
    gmail_message_id: string | null;
    gmail_attachment_id: string | null;
  } | null = null;

  // 1. sabi_attachments.storage_path
  if (att.storage_path) {
    tried.push(`sabi_attachments.storage_path=${att.storage_path}`);
    try {
      const { data } = await supabaseAdmin.storage.from(STORAGE_BUCKET).download(att.storage_path);
      if (data) buffer = Buffer.from(await data.arrayBuffer());
    } catch { /* fall through */ }
  }

  // 2. sabi_email_attachments by Gmail IDs from sabi_attachments
  if (!buffer && att.attachment_id && att.message_id) {
    const { data: emailAtt } = await supabaseAdmin
      .from('sabi_email_attachments')
      .select('storage_path, gmail_message_id, gmail_attachment_id')
      .eq('gmail_message_id', att.message_id)
      .eq('gmail_attachment_id', att.attachment_id)
      .maybeSingle();

    if (emailAtt) {
      resolvedFromEmailAtt = emailAtt;
      if (emailAtt.storage_path) {
        tried.push(`sabi_email_attachments.storage_path=${emailAtt.storage_path}`);
        try {
          const { data } = await supabaseAdmin.storage.from(STORAGE_BUCKET).download(emailAtt.storage_path);
          if (data) buffer = Buffer.from(await data.arrayBuffer());
        } catch { /* fall through */ }
      }
    }
  }

  // 3 + 4. Filename match via project's email thread
  let projectEmailRefs: { email_id: string | null; email_thread_id: string | null } | null = null;
  if (!buffer) {
    const { data: project } = await supabaseAdmin
      .from('sabi_projects')
      .select('email_id, email_thread_id')
      .eq('id', projectId)
      .maybeSingle();
    projectEmailRefs = project ?? null;

    if (project?.email_id) {
      tried.push(`thread_match.email_id=${project.email_id}&filename=${filename}`);
      const { data: match } = await supabaseAdmin
        .from('sabi_email_attachments')
        .select('storage_path, gmail_message_id, gmail_attachment_id')
        .eq('email_id', project.email_id)
        .eq('filename', filename)
        .maybeSingle();
      if (match) resolvedFromEmailAtt = match;
    }

    if (!resolvedFromEmailAtt && project?.email_thread_id) {
      const { data: threadEmails } = await supabaseAdmin
        .from('sabi_emails')
        .select('id')
        .eq('thread_id', project.email_thread_id);
      const emailIds = (threadEmails || []).map((e: { id: string }) => e.id);
      if (emailIds.length > 0) {
        tried.push(`thread_match.thread=${project.email_thread_id}&filename=${filename}`);
        const { data: match } = await supabaseAdmin
          .from('sabi_email_attachments')
          .select('storage_path, gmail_message_id, gmail_attachment_id')
          .in('email_id', emailIds)
          .eq('filename', filename)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (match) resolvedFromEmailAtt = match;
      }
    }

    if (resolvedFromEmailAtt?.storage_path) {
      try {
        const { data } = await supabaseAdmin.storage.from(STORAGE_BUCKET).download(resolvedFromEmailAtt.storage_path);
        if (data) buffer = Buffer.from(await data.arrayBuffer());
      } catch { /* fall through */ }
    }
  }

  // 5. Gmail API live download
  if (!buffer) {
    const msgId = att.message_id || resolvedFromEmailAtt?.gmail_message_id || null;
    const gattId = att.attachment_id || resolvedFromEmailAtt?.gmail_attachment_id || null;
    if (msgId && gattId) {
      tried.push(`gmail_api(${msgId})`);
      try {
        const { getAttachment } = await import('@/lib/email/gmail');
        buffer = await getAttachment(msgId, gattId);
      } catch { /* fall through */ }
    }
  }

  // 6. Self-heal: patch sabi_attachments so next read is fast
  if (buffer && resolvedFromEmailAtt && (!att.storage_path || !att.attachment_id || !att.message_id)) {
    const patch: Record<string, string> = {};
    if (!att.storage_path && resolvedFromEmailAtt.storage_path) patch.storage_path = resolvedFromEmailAtt.storage_path;
    if (!att.attachment_id && resolvedFromEmailAtt.gmail_attachment_id) patch.attachment_id = resolvedFromEmailAtt.gmail_attachment_id;
    if (!att.message_id && resolvedFromEmailAtt.gmail_message_id) patch.message_id = resolvedFromEmailAtt.gmail_message_id;
    if (Object.keys(patch).length > 0) {
      await supabaseAdmin
        .from('sabi_attachments')
        .update(patch)
        .eq('id', attachmentId)
        .then(() => undefined, () => undefined);
    }
  }

  if (!buffer) {
    return {
      error: {
        error: 'File binary not found',
        filename,
        tried,
        project_email_id: projectEmailRefs?.email_id ?? null,
        project_email_thread_id: projectEmailRefs?.email_thread_id ?? null,
        hint: 'No matching binary in sabi_attachments, sabi_email_attachments (by Gmail IDs or by filename), or Gmail API. Run the extract step on this project to download attachments from Gmail.',
      },
      status: 404,
    };
  }

  return { buffer, filename, mime_type: att.mime_type };
}

/**
 * Lightweight variant of resolveAttachmentBinary: returns just the
 * storage_path if any of sources 1-4 has one, without downloading bytes.
 * Used by the /download route to short-circuit into a 302 redirect to a
 * signed S3 GET URL — saves Vercel egress on every file view.
 *
 * Returns null when only the Gmail API fallback is available; caller must
 * then fall back to the streaming resolver.
 */
export async function resolveStoragePath(
  projectId: string,
  attachmentId: string
): Promise<{ storagePath: string; filename: string; mime_type: string | null } | null> {
  const { data: att } = await supabaseAdmin
    .from('sabi_attachments')
    .select('storage_path, attachment_id, message_id, filename, mime_type')
    .eq('id', attachmentId)
    .eq('project_id', projectId)
    .single();

  if (!att) return null;
  const filename: string = att.filename || 'attachment';

  if (att.storage_path) {
    return { storagePath: att.storage_path, filename, mime_type: att.mime_type };
  }

  if (att.attachment_id && att.message_id) {
    const { data: emailAtt } = await supabaseAdmin
      .from('sabi_email_attachments')
      .select('storage_path')
      .eq('gmail_message_id', att.message_id)
      .eq('gmail_attachment_id', att.attachment_id)
      .maybeSingle();
    if (emailAtt?.storage_path) {
      return { storagePath: emailAtt.storage_path, filename, mime_type: att.mime_type };
    }
  }

  const { data: project } = await supabaseAdmin
    .from('sabi_projects')
    .select('email_id, email_thread_id')
    .eq('id', projectId)
    .maybeSingle();

  if (project?.email_id) {
    const { data: match } = await supabaseAdmin
      .from('sabi_email_attachments')
      .select('storage_path')
      .eq('email_id', project.email_id)
      .eq('filename', filename)
      .maybeSingle();
    if (match?.storage_path) {
      return { storagePath: match.storage_path, filename, mime_type: att.mime_type };
    }
  }

  if (project?.email_thread_id) {
    const { data: threadEmails } = await supabaseAdmin
      .from('sabi_emails')
      .select('id')
      .eq('thread_id', project.email_thread_id);
    const emailIds = (threadEmails || []).map((e: { id: string }) => e.id);
    if (emailIds.length > 0) {
      const { data: match } = await supabaseAdmin
        .from('sabi_email_attachments')
        .select('storage_path')
        .in('email_id', emailIds)
        .eq('filename', filename)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (match?.storage_path) {
        return { storagePath: match.storage_path, filename, mime_type: att.mime_type };
      }
    }
  }

  return null;
}
