import { backendFetch, passThrough } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const resp = await backendFetch(`/drawings/${encodeURIComponent(params.id)}/reopen`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  return passThrough(resp);
}
