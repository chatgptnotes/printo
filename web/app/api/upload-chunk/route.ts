import { NextRequest, NextResponse } from "next/server";
import { API_URL } from "@/lib/api";
import { getSessionToken } from "@/lib/auth";

export const dynamic = "force-dynamic";
// Match /api/upload (300s) so a slow cross-region chunk POST isn't cut off at the
// function timeout and surfaced to the client as an HTTP 504.
export const maxDuration = 300;

/**
 * Forwards one chunk of a large upload to the backend. Each chunk is kept well
 * under Vercel's 4.5 MB function-body cap, so large files upload entirely
 * through this same-origin BFF (no direct browser→VPS connection needed).
 */
export async function POST(req: NextRequest) {
  const token = getSessionToken();
  if (!token) {
    return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ detail: "Invalid chunk" }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${API_URL}/upload/chunk`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ detail: "Backend unreachable" }, { status: 502 });
  }

  const data = await upstream.json().catch(() => ({}));
  return NextResponse.json(data, { status: upstream.status });
}
