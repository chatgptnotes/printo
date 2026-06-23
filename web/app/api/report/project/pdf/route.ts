import { backendFetch, passThrough } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  const resp = await backendFetch("/report/project/pdf");
  return passThrough(resp);
}
