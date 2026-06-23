import { NextRequest } from "next/server";
import { backendFetch, passThrough } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const resolved = req.nextUrl.searchParams.get("resolved") || "false";
  const resp = await backendFetch(`/exceptions?resolved=${encodeURIComponent(resolved)}`);
  return passThrough(resp);
}
