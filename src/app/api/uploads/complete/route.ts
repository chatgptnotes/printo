import { NextRequest, NextResponse } from 'next/server';
import { CompleteMultipartUploadCommand } from '@aws-sdk/client-s3';
import { requireAuth } from '@/lib/shared/api-auth';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { getS3, STORAGE_BUCKET } from '@/lib/storage/supabase-s3';

export const dynamic = 'force-dynamic';

interface CompleteBody {
  key: string;
  uploadId?: string;
  parts?: Array<{ ETag: string; PartNumber: number }>;
  filename: string;
  mimeType?: string;
  sizeBytes: number;
  projectId?: string;
  kind: 'attachment' | 'reply' | 'boq';
}

function classifyFileType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    dwg: 'drawing_autocad', dxf: 'drawing_autocad',
    pdf: 'drawing_pdf',
    doc: 'specification', docx: 'specification', txt: 'specification',
    xls: 'schedule_excel', xlsx: 'schedule_excel', csv: 'schedule_excel',
    zip: 'archive_zip', rar: 'archive_zip', '7z': 'archive_zip',
    jpg: 'image', jpeg: 'image', png: 'image', svg: 'image', bmp: 'image', tiff: 'image',
    ppt: 'presentation', pptx: 'presentation',
  };
  return map[ext] || 'other';
}

export async function POST(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  let body: CompleteBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { key, uploadId, parts, filename, mimeType, sizeBytes, projectId, kind } = body;
  if (!key || !filename || typeof sizeBytes !== 'number' || !kind) {
    return NextResponse.json(
      { error: 'key, filename, sizeBytes, and kind are required' },
      { status: 400 }
    );
  }

  // Finalize multipart upload first if applicable
  if (uploadId) {
    if (!parts || parts.length === 0) {
      return NextResponse.json({ error: 'parts required for multipart complete' }, { status: 400 });
    }
    const sortedParts = [...parts].sort((a, b) => a.PartNumber - b.PartNumber);
    const s3 = getS3();
    try {
      await s3.send(
        new CompleteMultipartUploadCommand({
          Bucket: STORAGE_BUCKET,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: { Parts: sortedParts },
        })
      );
    } catch (err: any) {
      return NextResponse.json(
        { error: 'Multipart complete failed', details: err.message },
        { status: 500 }
      );
    }
  }

  // Reply attachments are transient — no DB row. Just return the key.
  if (kind === 'reply' || kind === 'boq') {
    return NextResponse.json({ storagePath: key });
  }

  // Project attachment — insert sabi_attachments row.
  if (!projectId) {
    return NextResponse.json({ error: 'projectId required for attachment kind' }, { status: 400 });
  }
  const { data, error } = await supabaseAdmin
    .from('sabi_attachments')
    .insert({
      project_id: projectId,
      filename,
      mime_type: mimeType || null,
      size_bytes: sizeBytes,
      attachment_id: null,
      message_id: null,
      file_type: classifyFileType(filename),
      storage_path: key,
    })
    .select('id, filename, storage_path, file_type')
    .single();

  if (error) {
    return NextResponse.json(
      { error: 'Failed to record attachment', details: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    attachmentId: data.id,
    storagePath: data.storage_path,
    filename: data.filename,
    fileType: data.file_type,
  });
}
