import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { requireAuth } from '@/lib/shared/api-auth';
import { classifyFileType } from '@/lib/shared/utils';
import { randomUUID } from 'crypto';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const { id: projectId } = params;

    const { data: project, error: projErr } = await supabaseAdmin
      .from('sabi_projects')
      .select('id')
      .eq('id', projectId)
      .single();

    if (projErr || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const formData = await request.formData();
    const files = formData.getAll('files') as File[];

    if (!files || files.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 });
    }

    const ALLOWED_EXTENSIONS = new Set([
      'zip', 'rar', '7z',
      'pdf', 'png', 'jpg', 'jpeg',
      'dwg', 'dxf',
      'xlsx', 'xls', 'csv',
      'doc', 'docx', 'txt',
    ]);
    const ALLOWED_TYPES = new Set([
      'application/pdf',
      'image/png',
      'image/jpeg',
      'application/zip',
      'application/x-zip-compressed',
      'application/x-7z-compressed',
      'application/vnd.rar',
      'application/x-rar-compressed',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
    ]);
    const uploaded: string[] = [];

    for (const file of files) {
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      if (!ALLOWED_EXTENSIONS.has(ext) && !ALLOWED_TYPES.has(file.type)) continue;

      const attachmentId = randomUUID();
      const storagePath = `${projectId}/${attachmentId}_${file.name}`;

      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const { error: uploadErr } = await supabaseAdmin.storage
        .from('sabi-attachments')
        .upload(storagePath, buffer, { contentType: file.type, upsert: false });

      if (uploadErr) {
        console.error('Upload error:', uploadErr.message);
        continue;
      }

      await supabaseAdmin.from('sabi_attachments').insert({
        project_id: projectId,
        message_id: 'manual',
        attachment_id: attachmentId,
        filename: file.name,
        mime_type: file.type,
        size_bytes: file.size,
        storage_path: storagePath,
        file_type: classifyFileType(file.name),
        discipline: null,
      });

      uploaded.push(file.name);
    }

    if (uploaded.length === 0) {
      return NextResponse.json({ error: 'No valid files uploaded' }, { status: 400 });
    }

    return NextResponse.json({ uploaded, count: uploaded.length });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Upload failed', details: message }, { status: 500 });
  }
}
