// Nexaproc AI Gateway client.
//
// Replaces direct @anthropic-ai/sdk calls with HTTP requests to a self-hosted
// gateway (chatgptnotes/AI-aas) that proxies to the local Claude CLI on a VPS.
// Single egress point for cost / abuse / rate control across tenants.
//
// Two endpoints:
//   POST /api/invoke         — text-only, JSON request
//   POST /api/invoke-vision  — multipart, files attached
//
// Retries on transient gateway statuses (408/429/500/502/503/504) with
// exponential backoff. Four attempts total covers the 3-replica
// `least_conn` pool fail-over.
//
// Errors carry .status / .taskID / .body so api-alert.ts can route the same
// way it routes Anthropic SDK errors today.

import { Buffer } from 'node:buffer';

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 1;   // no retry loop — a failed scan surfaces immediately
const BASE_BACKOFF_MS = 250;
// Single-attempt fetch timeout (30 min). Gateway CLAUDE_TIMEOUT_MS = 1800s and
// nginx proxy_read_timeout = 1810s; the fetch gives the slowest scan room
// without inheriting Node's undici defaults. No retries: on failure we report
// the error directly instead of looping.
const FETCH_TIMEOUT_MS = 1_800_000;

export interface InvokeResponse {
  ok: boolean;
  taskID: string;
  durationMs: number;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  parsed?: unknown;
  tokensIn: number;
  tokensOut: number;
  cacheCreate?: number;
  cacheRead?: number;
}

export class GatewayError extends Error {
  status: number;
  taskID: string;
  body: string;
  constructor(message: string, opts: { status: number; taskID: string; body: string }) {
    super(message);
    this.name = 'GatewayError';
    this.status = opts.status;
    this.taskID = opts.taskID;
    this.body = opts.body;
  }
}

export interface VisionFile {
  name: string;
  mime: string;
  bytes: Buffer | Uint8Array;
}

interface InvokeOptions {
  useJson?: boolean;
  timeoutMs?: number;
}

function gatewayConfig(): { baseURL: string; apiKey: string } {
  const raw = process.env.NEXAPROC_GATEWAY_URL;
  const apiKey = process.env.DRAWTOBOQ_AIAS_KEY;
  if (!raw || !apiKey) {
    throw new Error(
      'Nexaproc gateway not configured — set NEXAPROC_GATEWAY_URL and DRAWTOBOQ_AIAS_KEY (USE_AI_GATEWAY=true requires both).',
    );
  }
  // Strip trailing slash so `${baseURL}/api/invoke` produces a clean URL no
  // matter how the operator wrote the env var (with or without trailing /).
  const baseURL = raw.replace(/\/+$/, '');
  return { baseURL, apiKey };
}

async function withRetry(taskID: string, fn: () => Promise<Response>): Promise<InvokeResponse> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fn();
      if (res.ok) {
        const json = (await res.json()) as InvokeResponse;
        return json;
      }
      const body = await res.text().catch(() => '');
      if (!RETRYABLE_STATUS.has(res.status)) {
        throw new GatewayError(`gateway ${res.status} for ${taskID}: ${body.slice(0, 200)}`, {
          status: res.status,
          taskID,
          body,
        });
      }
      lastErr = new GatewayError(`gateway ${res.status} (retryable) for ${taskID}`, {
        status: res.status,
        taskID,
        body,
      });
    } catch (e) {
      // Non-retryable GatewayError — bail immediately.
      if (e instanceof GatewayError && !RETRYABLE_STATUS.has(e.status)) {
        throw e;
      }
      lastErr = e;
    }
    if (attempt < MAX_ATTEMPTS - 1) {
      await new Promise(r => setTimeout(r, BASE_BACKOFF_MS * 2 ** attempt));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`gateway exhausted retries for ${taskID}`);
}

export async function invokeText(
  taskID: string,
  payload: unknown,
  opts: InvokeOptions = {},
): Promise<InvokeResponse> {
  const { baseURL, apiKey } = gatewayConfig();
  return withRetry(taskID, () => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    return fetch(`${baseURL}/api/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Nexaproc-Key': apiKey,
      },
      body: JSON.stringify({
        taskID,
        payload,
        useJson: opts.useJson ?? true,
        ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
      }),
      signal: ac.signal,
    }).finally(() => clearTimeout(timer));
  });
}

export async function invokeVision(
  taskID: string,
  payload: unknown,
  files: VisionFile[],
  opts: InvokeOptions = {},
): Promise<InvokeResponse> {
  const { baseURL, apiKey } = gatewayConfig();
  return withRetry(taskID, () => {
    const form = new FormData();
    form.append('taskID', taskID);
    form.append('payload', JSON.stringify(payload));
    form.append('useJson', String(opts.useJson ?? true));
    if (opts.timeoutMs) form.append('timeoutMs', String(opts.timeoutMs));
    for (const f of files) {
      // Copy bytes into a fresh ArrayBuffer-backed Uint8Array. Buffer's
      // SharedArrayBuffer-typed `.buffer` fails BlobPart's ArrayBuffer
      // structural check under strict lib.dom typings; copy is O(n) but
      // these payloads max out at 25 MB per gateway constraints.
      const copy = new Uint8Array(f.bytes.byteLength);
      copy.set(f.bytes instanceof Buffer
        ? new Uint8Array(f.bytes.buffer, f.bytes.byteOffset, f.bytes.byteLength)
        : f.bytes);
      form.append('files', new Blob([copy], { type: f.mime }), f.name);
    }
    // Do NOT set Content-Type — fetch sets the multipart boundary automatically.
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    return fetch(`${baseURL}/api/invoke-vision`, {
      method: 'POST',
      headers: { 'X-Nexaproc-Key': apiKey },
      body: form,
      signal: ac.signal,
    }).finally(() => clearTimeout(timer));
  });
}

export function gatewayEnabled(): boolean {
  return process.env.USE_AI_GATEWAY === 'true';
}
