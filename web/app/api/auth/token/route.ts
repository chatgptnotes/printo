import { NextResponse } from "next/server";
import { getSessionToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Returns the session JWT (read from the HttpOnly cookie) to the browser so it
 * can call the backend directly for endpoints that bypass the Vercel BFF — i.e.
 * large file uploads + the long SSE pipeline, which exceed Vercel's 4.5 MB body
 * limit and function timeout. The token is short-lived and the backend verifies
 * its signature on every call.
 */
export async function GET() {
  const token = getSessionToken();
  if (!token) {
    return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
  }
  return NextResponse.json({ token });
}
