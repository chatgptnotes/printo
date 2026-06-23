import { backendFetch, passThrough } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const resp = await backendFetch(`/drawings/${encodeURIComponent(params.id)}`);
  return passThrough(resp);
}
