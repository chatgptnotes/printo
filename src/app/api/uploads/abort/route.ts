import { NextRequest, NextResponse } from 'next/server';
import { AbortMultipartUploadCommand } from '@aws-sdk/client-s3';
import { requireAuth } from '@/lib/shared/api-auth';
import { getS3, STORAGE_BUCKET } from '@/lib/storage/supabase-s3';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  let body: { key?: string; uploadId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { key, uploadId } = body;
  if (!key || !uploadId) {
    return NextResponse.json({ error: 'key and uploadId required' }, { status: 400 });
  }

  try {
    await getS3().send(
      new AbortMultipartUploadCommand({
        Bucket: STORAGE_BUCKET,
        Key: key,
        UploadId: uploadId,
      })
    );
  } catch (err: any) {
    // Already aborted / never existed — nothing to clean up.
    return NextResponse.json({ aborted: false, reason: err.message });
  }

  return NextResponse.json({ aborted: true });
}
