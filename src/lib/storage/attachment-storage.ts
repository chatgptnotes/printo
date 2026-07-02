// Attachment Storage Helper
// Downloads attachment content from Supabase Storage, falls back to Gmail API.
// Used by extract and estimate routes to get file buffers for AI analysis.

import { supabaseAdmin } from '@/lib/storage/supabase';
import { getAttachment } from '@/lib/email/gmail';

const STORAGE_BUCKET = 'sabi-attachments';

/**
 * Get attachment buffer — tries Supabase Storage first, falls back to Gmail API.
 * Sync only records metadata; actual files are downloaded on demand here.
 */
export async function getAttachmentBuffer(
  messageId: string,
  attachmentId: string
): Promise<Buffer> {
  // 1. Check project-level attachments (sabi_attachments)
  const { data: projectAtt } = await supabaseAdmin
    .from('sabi_attachments')
    .select('storage_path')
    .eq('attachment_id', attachmentId)
    .eq('message_id', messageId)
    .not('storage_path', 'is', null)
    .maybeSingle();

  if (projectAtt?.storage_path) {
    const buffer = await downloadFromStorage(projectAtt.storage_path);
    if (buffer) return buffer;
  }

  // 2. Check email-level attachments (sabi_email_attachments)
  const { data: emailAtt } = await supabaseAdmin
    .from('sabi_email_attachments')
    .select('storage_path')
    .eq('gmail_attachment_id', attachmentId)
    .eq('gmail_message_id', messageId)
    .not('storage_path', 'is', null)
    .maybeSingle();

  if (emailAtt?.storage_path) {
    const buffer = await downloadFromStorage(emailAtt.storage_path);
    if (buffer) return buffer;
  }

  // 3. Fallback: download directly from Gmail API (sync only stores metadata)
  try {
    return await getAttachment(messageId, attachmentId);
  } catch (err: any) {
    throw new Error(
      `Attachment not found in storage and Gmail download failed ` +
      `(messageId=${messageId}, attachmentId=${attachmentId}): ${err.message}`
    );
  }
}

/**
 * Load an attachment's bytes preferring its direct Supabase Storage path.
 * Seeded / uploaded files live in storage with a `storage_path` but no Gmail
 * `attachment_id`/`message_id`; Gmail-sourced files have the ids. This handles
 * both, so the estimate/extract pipelines work for either origin.
 */
export async function loadAttachmentBuffer(att: {
  filename?: string | null;
  message_id?: string | null;
  attachment_id?: string | null;
  storage_path?: string | null;
}): Promise<Buffer> {
  if (att.storage_path) {
    const buffer = await downloadFromStorage(att.storage_path);
    if (buffer) return buffer;
  }
  if (att.message_id && att.attachment_id) {
    return getAttachmentBuffer(att.message_id, att.attachment_id);
  }
  throw new Error(
    `Attachment "${att.filename ?? 'unknown'}" has no storage_path and no Gmail ids — cannot load.`
  );
}

async function downloadFromStorage(storagePath: string): Promise<Buffer | null> {
  const { data, error } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .download(storagePath);

  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}
