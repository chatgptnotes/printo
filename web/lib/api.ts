import { getSessionToken } from "./auth";

/** Base URL of the Python FastAPI backend. Server-side only. */
export const API_URL = process.env.PRINTO_API_URL || "http://127.0.0.1:8000";

/**
 * Server-side fetch to the backend with the session JWT attached as a Bearer
 * token (read from the HttpOnly cookie). Returns the raw Response so proxy
 * route handlers can pass through status/headers/body (HTML, PDF, XLSX, SSE).
 */
export async function backendFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getSessionToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
}

/** Convenience: backend GET returning parsed JSON, or null on any non-2xx. */
export async function backendJSON<T>(path: string): Promise<T | null> {
  try {
    const r = await backendFetch(path);
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

/** Pass a backend Response straight back to the browser, preserving the
 * content type, status, and (for downloads) the Content-Disposition header. */
export function passThrough(resp: Response): Response {
  const headers = new Headers();
  for (const h of ["content-type", "content-disposition", "cache-control"]) {
    const v = resp.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(resp.body, { status: resp.status, headers });
}
