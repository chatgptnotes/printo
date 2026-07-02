import { NextRequest, NextResponse } from 'next/server';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { requireAuth } from '@/lib/shared/api-auth';
import { resolveAttachmentBinary, resolveStoragePath } from '@/lib/drawing/file-resolver';
import { getS3, STORAGE_BUCKET } from '@/lib/storage/supabase-s3';

export const dynamic = 'force-dynamic';

const SIGNED_URL_TTL = 300; // 5 min

const CONTENT_TYPES: Record<string, string> = {
  // Documents
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  rtf: 'application/rtf',
  // Images
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  bmp: 'image/bmp',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  heic: 'image/heic',
  // Text
  txt: 'text/plain',
  csv: 'text/csv',
  log: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  htm: 'text/html',
  eml: 'message/rfc822',
  // Audio
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  // Video
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
  avi: 'video/x-msvideo',
  // Archives + CAD
  zip: 'application/zip',
  dwg: 'application/acad',
  dxf: 'application/dxf',
};

const INLINE_TYPES = new Set([
  'pdf',
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp',
  'txt', 'csv', 'log', 'md', 'json', 'xml', 'html', 'htm', 'eml',
  'mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac',
  'mp4', 'webm', 'mov', 'm4v',
]);

// GET / HEAD: Universal binary download for a project attachment.
// Fast path: if storage_path is known, redirect to a presigned S3 GET URL so
// the browser pulls bytes directly from Supabase (no Vercel egress).
// Slow path (Gmail-API-only files): fall back to streaming through Vercel.
export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string; attachmentId: string } }
) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const direct = await resolveStoragePath(params.projectId, params.attachmentId);
  if (direct) {
    const ext = direct.filename.split('.').pop()?.toLowerCase() || '';
    const contentType = CONTENT_TYPES[ext] || direct.mime_type || 'application/octet-stream';
    const disposition = INLINE_TYPES.has(ext)
      ? `inline; filename="${encodeURIComponent(direct.filename)}"`
      : `attachment; filename="${encodeURIComponent(direct.filename)}"`;

    const url = await getSignedUrl(
      getS3(),
      new GetObjectCommand({
        Bucket: STORAGE_BUCKET,
        Key: direct.storagePath,
        ResponseContentType: contentType,
        ResponseContentDisposition: disposition,
      }),
      { expiresIn: SIGNED_URL_TTL }
    );
    return NextResponse.redirect(url, {
      status: 302,
      headers: { 'Cache-Control': 'private, max-age=60' },
    });
  }

  // Fall back to streaming (Gmail API live fetch with no cached storage path)
  const result = await resolveAttachmentBinary(params.projectId, params.attachmentId);
  if ('error' in result) {
    return NextResponse.json(result.error, { status: result.status });
  }

  const { buffer, filename } = result;
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const contentType = CONTENT_TYPES[ext] || result.mime_type || 'application/octet-stream';
  const disposition = INLINE_TYPES.has(ext)
    ? `inline; filename="${encodeURIComponent(filename)}"`
    : `attachment; filename="${encodeURIComponent(filename)}"`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': disposition,
      'Content-Length': buffer.length.toString(),
      'Cache-Control': 'private, max-age=300',
    },
  });
}

// HEAD: cheap probe used by the viewer to detect missing binaries
export async function HEAD(
  request: NextRequest,
  { params }: { params: { projectId: string; attachmentId: string } }
) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const result = await resolveAttachmentBinary(params.projectId, params.attachmentId);
  if ('error' in result) {
    return new NextResponse(null, { status: result.status });
  }
  return new NextResponse(null, { status: 200 });
}
