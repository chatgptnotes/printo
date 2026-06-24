import { NextRequest } from "next/server";
import { backendFetch, passThrough } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Forward the `only=all|failed|pending` filter if present.
  const search = req.nextUrl.search || "";
  const resp = await backendFetch(`/erp/push-all${search}`, { method: "POST" });
  return passThrough(resp);
}
