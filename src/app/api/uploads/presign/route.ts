import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import {
  PutObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { requireAuth } from '@/lib/shared/api-auth';
import {
  getS3,
  STORAGE_BUCKET,
  BUCKET_MAX_BYTES,
  MULTIPART_THRESHOLD_BYTES,
  MULTIPART_PART_SIZE_BYTES,
} from '@/lib/storage/supabase-s3';

export const dynamic = 'force-dynamic';

type UploadKind = 'attachment' | 'reply' | 'boq';

interface PresignBody {
  filename: string;
  mimeType?: string;
  sizeBytes: number;
  projectId?: string;
  kind: UploadKind;
}

const PRESIGN_TTL_SECONDS = 60 * 30; // 30 min — matches multipart upload window

function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
}

function buildKey(kind: UploadKind, projectId: string | undefined, filename: string): string {
  const safe = safeFilename(filename);
  const uuid = randomUUID();
  switch (kind) {
    case 'reply':
      return `replies/${projectId || 'unscoped'}/${uuid}-${safe}`;
    case 'boq':
      return `boq/${projectId || 'unscoped'}/${uuid}-${safe}`;
    case 'attachment':
    default:
      if (!projectId) throw new Error('projectId required for attachment uploads');
      return `projects/${projectId}/uploads/${uuid}-${safe}`;
  }
}

export async function POST(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  let body: PresignBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { filename, mimeType, sizeBytes, projectId, kind } = body;
  if (!filename || typeof sizeBytes !== 'number' || !kind) {
    return NextResponse.json(
      { error: 'filename, sizeBytes, and kind are required' },
      { status: 400 }
    );
  }
  if (sizeBytes <= 0) {
    return NextResponse.json({ error: 'sizeBytes must be positive' }, { status: 400 });
  }
  if (sizeBytes > BUCKET_MAX_BYTES) {
    return NextResponse.json(
      {
        error: `File exceeds ${(BUCKET_MAX_BYTES / 1024 / 1024).toFixed(0)} MB per-object limit. Upgrade Supabase plan to raise this cap.`,
        code: 'OVER_BUCKET_LIMIT',
        bucketMaxBytes: BUCKET_MAX_BYTES,
      },
      { status: 413 }
    );
  }

  let key: string;
  try {
    key = buildKey(kind, projectId, filename);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }

  const s3 = getS3();
  const contentType = mimeType || 'application/octet-stream';

  // Single PUT for small files
  if (sizeBytes < MULTIPART_THRESHOLD_BYTES) {
    const url = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: STORAGE_BUCKET, Key: key, ContentType: contentType }),
      { expiresIn: PRESIGN_TTL_SECONDS }
    );
    return NextResponse.json({
      mode: 'single',
      key,
      url,
      partSizeBytes: sizeBytes,
    });
  }

  // Multipart for files >= 5MB
  const create = await s3.send(
    new CreateMultipartUploadCommand({
      Bucket: STORAGE_BUCKET,
      Key: key,
      ContentType: contentType,
    })
  );
  const uploadId = create.UploadId;
  if (!uploadId) {
    return NextResponse.json({ error: 'Failed to start multipart upload' }, { status: 500 });
  }

  const partCount = Math.ceil(sizeBytes / MULTIPART_PART_SIZE_BYTES);
  const parts: Array<{ partNumber: number; url: string }> = [];
  for (let i = 1; i <= partCount; i++) {
    const url = await getSignedUrl(
      s3,
      new UploadPartCommand({
        Bucket: STORAGE_BUCKET,
        Key: key,
        UploadId: uploadId,
        PartNumber: i,
      }),
      { expiresIn: PRESIGN_TTL_SECONDS }
    );
    parts.push({ partNumber: i, url });
  }

  return NextResponse.json({
    mode: 'multipart',
    key,
    uploadId,
    partSizeBytes: MULTIPART_PART_SIZE_BYTES,
    parts,
  });
}
