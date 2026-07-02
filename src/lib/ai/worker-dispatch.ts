// Fire-and-forget dispatch to the drawtoboq-estimate-worker on the VPS.
//
// The worker (see /worker/server.js) does the long Claude call + post-
// processing on the VPS so the Vercel lambda can return 202 within seconds
// instead of being killed at the Pro 300s function cap. The frontend's
// existing pollUntilStatus picks up the resulting status flip.

import { Buffer } from 'node:buffer';
import type { AttachmentFile } from '@/lib/ai/claude-api';

const DISPATCH_TIMEOUT_MS = 8_000; // We expect the worker to ACK within seconds.

export interface DispatchInput {
  projectId: string;
  cacheKey: string;
  buildingInfo: {
    floors?: number | null;
    area_sqft?: number | null;
    building_type?: string | null;
  };
  inputSummary: Record<string, unknown>;
  promptHints?: string;
  extractedText: string;
  estimatedCostUsd: number;
  files: AttachmentFile[];
  correlationId?: string;
}

export function workerDispatchEnabled(): boolean {
  return !!(process.env.DRAWTOBOQ_WORKER_URL && process.env.DRAWTOBOQ_WORKER_KEY);
}

/**
 * Build the multipart form and POST to the worker. The lambda must NOT await
 * the worker's full processing — only the initial 202 ACK. The promise this
 * function returns resolves once the ACK comes back (or rejects on transport
 * error / non-2xx). Caller is responsible for setting status='estimating'
 * after this resolves and returning to the client.
 */
export async function dispatchEstimateToWorker(input: DispatchInput): Promise<void> {
  // Env values pasted via BOM-encoded tooling (PowerShell Out-File, Notepad)
  // can carry a leading U+FEFF byte-order mark and/or stray whitespace. A BOM
  // in an HTTP header value throws "Cannot convert argument to a ByteString"
  // before the request is even sent, so strip it defensively — workerKey is
  // used directly as the X-Worker-Key header below.
  const clean = (v?: string) =>
    (v && v.charCodeAt(0) === 0xfeff ? v.slice(1) : v)?.trim();
  const baseURL = clean(process.env.DRAWTOBOQ_WORKER_URL);
  const workerKey = clean(process.env.DRAWTOBOQ_WORKER_KEY);
  if (!baseURL || !workerKey) {
    throw new Error(
      'Worker dispatch called but DRAWTOBOQ_WORKER_URL or DRAWTOBOQ_WORKER_KEY is not configured.',
    );
  }

  const url = `${baseURL.replace(/\/+$/, '')}/run`;
  const form = new FormData();
  form.append('project_id', input.projectId);
  form.append('cache_key', input.cacheKey);
  form.append('building_info', JSON.stringify(input.buildingInfo));
  form.append('input_summary', JSON.stringify(input.inputSummary));
  form.append('prompt_hints', input.promptHints ?? '');
  form.append('extracted_text', input.extractedText);
  form.append('estimated_cost_usd', String(input.estimatedCostUsd));
  if (input.correlationId) form.append('correlation_id', input.correlationId);

  for (const f of input.files) {
    // Copy bytes to a fresh ArrayBuffer-backed Uint8Array so undici's BlobPart
    // structural check doesn't reject Buffer's SharedArrayBuffer-typed .buffer.
    const copy = new Uint8Array(f.buffer.byteLength);
    copy.set(
      f.buffer instanceof Buffer
        ? new Uint8Array(f.buffer.buffer, f.buffer.byteOffset, f.buffer.byteLength)
        : f.buffer,
    );
    form.append('files', new Blob([copy], { type: f.mimeType }), f.filename);
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), DISPATCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'X-Worker-Key': workerKey },
      body: form,
      signal: ac.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`worker dispatch ${res.status}: ${body.slice(0, 200)}`);
  }

  // Drain body so the connection is freed promptly. Worker returns 202
  // with a small JSON ack — discard it.
  await res.text().catch(() => '');
}
