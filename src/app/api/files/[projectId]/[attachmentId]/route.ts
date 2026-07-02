import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { requireAuth } from '@/lib/shared/api-auth';

export const dynamic = 'force-dynamic';

// GET: Return file/attachment data for viewing
export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string; attachmentId: string } }
) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { projectId, attachmentId } = params;

  const { data: att, error: attError } = await supabaseAdmin
    .from('sabi_attachments')
    .select('*')
    .eq('id', attachmentId)
    .eq('project_id', projectId)
    .single();

  if (attError || !att) {
    return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
  }

  const { data: proj } = await supabaseAdmin
    .from('sabi_projects')
    .select('project_name, email_subject')
    .eq('id', projectId)
    .single();

  const ext = att.extracted_data as Record<string, unknown> | null;

  return NextResponse.json({
    id: att.id,
    project_id: att.project_id,
    project_name: proj?.project_name || proj?.email_subject || 'Unknown Project',
    filename: att.filename,
    mime_type: att.mime_type,
    size_bytes: att.size_bytes,
    file_type: att.file_type,
    discipline: att.discipline,
    text: ext?.text || null,
    pages: ext?.pages || null,
    identified_as: ext?.identified_as || null,
    contents: ext?.contents || null,
    preview_svg: null,
    attachment_id: att.attachment_id || null,
    message_id: att.message_id || null,
    storage_path: att.storage_path || null,
  });
}
