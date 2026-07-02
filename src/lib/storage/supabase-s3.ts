import { S3Client } from '@aws-sdk/client-s3';

export const STORAGE_BUCKET = 'sabi-attachments';

// Free tier caps single objects at 50 MB. Override with BUCKET_MAX_BYTES on Pro.
export const BUCKET_MAX_BYTES = Number(process.env.BUCKET_MAX_BYTES) || 50 * 1024 * 1024;

// Files >= this size are uploaded via S3 multipart (chunked, retry-per-part).
export const MULTIPART_THRESHOLD_BYTES = 5 * 1024 * 1024;
export const MULTIPART_PART_SIZE_BYTES = 5 * 1024 * 1024;

let _s3: S3Client | null = null;

export function getS3(): S3Client {
  if (_s3) return _s3;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const region = process.env.SUPABASE_S3_REGION;
  const accessKeyId = process.env.SUPABASE_S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.SUPABASE_S3_SECRET_ACCESS_KEY;
  if (!supabaseUrl || !region || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'Supabase S3 not configured: set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_S3_REGION, SUPABASE_S3_ACCESS_KEY_ID, SUPABASE_S3_SECRET_ACCESS_KEY'
    );
  }
  _s3 = new S3Client({
    forcePathStyle: true,
    region,
    endpoint: `${supabaseUrl}/storage/v1/s3`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return _s3;
}
