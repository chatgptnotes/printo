import { backendFetch, passThrough } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  const resp = await backendFetch(`/export/project/excel`);
  return passThrough(resp);
}
