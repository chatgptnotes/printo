import { backendFetch, passThrough } from "@/lib/api";

// Poll endpoint for a background extraction job: new step-log lines + the
// terminal `done` payload. Each poll is a quick request (no 300s pressure).
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const since = new URL(req.url).searchParams.get("since") ?? "0";
  const resp = await backendFetch(
    `/drawings/${encodeURIComponent(params.id)}/events?since=${encodeURIComponent(since)}`,
  );
  return passThrough(resp);
}
