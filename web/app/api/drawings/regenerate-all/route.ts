import { backendFetch, passThrough } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST() {
  const resp = await backendFetch("/drawings/regenerate-all", { method: "POST" });
  return passThrough(resp);
}
