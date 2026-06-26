import { backendFetch, passThrough } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(_: Request, { params }: { params: { id: string } }) {
  const resp = await backendFetch(`/drawings/${encodeURIComponent(params.id)}/regenerate`, {
    method: "POST",
  });
  return passThrough(resp);
}
