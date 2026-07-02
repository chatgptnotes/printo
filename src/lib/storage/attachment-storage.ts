// Attachment Storage Helper
// Downloads user-uploaded attachment content from Supabase Storage.

import { supabaseAdmin } from '@/lib/storage/supabase';

const STORAGE_BUCKET = 'sabi-attachments';

export async function getAttachmentBuffer(
  messageId: string,
  attachmentId: string
): Promise<Buffer> {
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

  throw new Error(
    `Attachment not found in storage (messageId=${messageId}, attachmentId=${attachmentId})`
  );
}

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
    `Attachment "${att.filename ?? 'unknown'}" has no storage_path; upload the file again.`
  );
}

async function downloadFromStorage(storagePath: string): Promise<Buffer | null> {
  const { data, error } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .download(storagePath);

  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}
