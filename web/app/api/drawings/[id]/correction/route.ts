import { NextRequest } from "next/server";
import { backendFetch, passThrough } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.text();
  const resp = await backendFetch(`/drawings/${encodeURIComponent(params.id)}/correction`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body,
  });
  return passThrough(resp);
}
