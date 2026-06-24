import { backendFetch, passThrough } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const resp = await backendFetch(`/erp/push/${encodeURIComponent(params.id)}`, {
    method: "POST",
  });
  return passThrough(resp);
}
