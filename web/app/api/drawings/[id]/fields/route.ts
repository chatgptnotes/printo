import { NextRequest } from "next/server";
import { backendFetch, passThrough } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.text();
  const resp = await backendFetch(`/drawings/${encodeURIComponent(params.id)}/fields`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body,
  });
  return passThrough(resp);
}
