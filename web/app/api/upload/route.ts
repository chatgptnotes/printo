import { NextRequest, NextResponse } from "next/server";
import { API_URL } from "@/lib/api";
import { getSessionToken } from "@/lib/auth";

// The pipeline now runs in a background job on the backend and returns a
// drawing_id immediately, so this proxy only forwards a quick JSON response —
// the client polls /api/drawings/[id]/events for progress + the result.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const token = getSessionToken();
  if (!token) {
    return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ detail: "Invalid upload" }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${API_URL}/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ detail: "Backend unreachable" }, { status: 502 });
  }

  const data = await upstream.json().catch(() => ({ detail: "Upload failed" }));
  return NextResponse.json(data, { status: upstream.status || 502 });
}
