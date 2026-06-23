import { backendFetch, passThrough } from "@/lib/api";

export const dynamic = "force-dynamic";

// HTML report for a single drawing — same-origin so the session cookie carries
// auth even when loaded inside an <iframe>.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const resp = await backendFetch(`/report/${encodeURIComponent(params.id)}`);
  return passThrough(resp);
}
