/**
 * Browser-side uploader. Talks to /api/uploads/presign + /complete + /abort,
 * then PUTs file bytes directly to Supabase Storage (S3 protocol). No file
 * bytes ever pass through Vercel — bypasses the 4.5 MB body cap.
 *
 * Single PUT for files < 5 MB, multipart (5 MB chunks, parallel) for larger.
 */

export type UploadKind = 'attachment' | 'reply' | 'boq';

export interface UploadResult {
  storagePath: string;
  attachmentId?: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export interface UploadOptions {
  kind: UploadKind;
  projectId?: string;
  onProgress?: (pct: number) => void;
  signal?: AbortSignal;
  partConcurrency?: number;
}

interface PresignSingleResponse {
  mode: 'single';
  key: string;
  url: string;
  partSizeBytes: number;
}

interface PresignMultipartResponse {
  mode: 'multipart';
  key: string;
  uploadId: string;
  partSizeBytes: number;
  parts: Array<{ partNumber: number; url: string }>;
}

type PresignResponse = PresignSingleResponse | PresignMultipartResponse;

async function presign(file: File, opts: UploadOptions): Promise<PresignResponse> {
  const res = await fetch('/api/uploads/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: opts.signal,
    body: JSON.stringify({
      filename: file.name,
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      projectId: opts.projectId,
      kind: opts.kind,
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Presign failed (${res.status})`);
  }
  return res.json();
}

async function putSingle(
  url: string,
  file: File,
  contentType: string,
  signal: AbortSignal | undefined
): Promise<void> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: file,
    signal,
  });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
}

async function putPart(url: string, blob: Blob, signal: AbortSignal | undefined): Promise<string> {
  const res = await fetch(url, { method: 'PUT', body: blob, signal });
  if (!res.ok) throw new Error(`Part upload failed (${res.status})`);
  const etag = res.headers.get('ETag') || res.headers.get('etag');
  if (!etag) throw new Error('Missing ETag on part response');
  return etag.replace(/"/g, '');
}

async function abort(key: string, uploadId: string): Promise<void> {
  try {
    await fetch('/api/uploads/abort', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, uploadId }),
    });
  } catch { /* best-effort cleanup */ }
}

export async function uploadFile(file: File, opts: UploadOptions): Promise<UploadResult> {
  const contentType = file.type || 'application/octet-stream';
  const presigned = await presign(file, opts);

  let partsResult: Array<{ ETag: string; PartNumber: number }> | undefined;
  let uploadIdToComplete: string | undefined;

  if (presigned.mode === 'single') {
    await putSingle(presigned.url, file, contentType, opts.signal);
    opts.onProgress?.(100);
  } else {
    const { uploadId, parts, partSizeBytes, key } = presigned;
    uploadIdToComplete = uploadId;
    const concurrency = Math.max(1, opts.partConcurrency ?? 3);
    const completed: Array<{ ETag: string; PartNumber: number }> = [];
    let nextIndex = 0;
    let bytesUploaded = 0;

    const worker = async () => {
      while (true) {
        const myIndex = nextIndex++;
        if (myIndex >= parts.length) return;
        const partInfo = parts[myIndex];
        const start = (partInfo.partNumber - 1) * partSizeBytes;
        const end = Math.min(start + partSizeBytes, file.size);
        const blob = file.slice(start, end);
        try {
          const etag = await putPart(partInfo.url, blob, opts.signal);
          completed.push({ ETag: etag, PartNumber: partInfo.partNumber });
          bytesUploaded += end - start;
          opts.onProgress?.(Math.round((bytesUploaded / file.size) * 100));
        } catch (err) {
          await abort(key, uploadId);
          throw err;
        }
      }
    };

    await Promise.all(Array.from({ length: concurrency }, worker));
    partsResult = completed;
  }

  const completeRes = await fetch('/api/uploads/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: opts.signal,
    body: JSON.stringify({
      key: presigned.key,
      uploadId: uploadIdToComplete,
      parts: partsResult,
      filename: file.name,
      mimeType: contentType,
      sizeBytes: file.size,
      projectId: opts.projectId,
      kind: opts.kind,
    }),
  });
  if (!completeRes.ok) {
    const data = await completeRes.json().catch(() => ({}));
    if (uploadIdToComplete) await abort(presigned.key, uploadIdToComplete);
    throw new Error(data.error || `Complete failed (${completeRes.status})`);
  }
  const completeData = await completeRes.json();

  return {
    storagePath: completeData.storagePath || presigned.key,
    attachmentId: completeData.attachmentId,
    filename: file.name,
    mimeType: contentType,
    sizeBytes: file.size,
  };
}
