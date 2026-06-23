import { backendFetch, passThrough } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const resp = await backendFetch(`/export/${encodeURIComponent(params.id)}/excel`);
  return passThrough(resp);
}
