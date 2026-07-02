import { NextRequest, NextResponse } from 'next/server';
import { sendApiAlert, withProjectContext, type AlertKind } from '@/lib/notifications/api-alert';

// Worker-authed alert relay.
//
// The VPS estimate-worker (worker/server.js) runs scans unattended and can't
// reach the openclaw WhatsApp CLI (that's linked on this app host, not the
// worker). When a scan fails or nears the 30-min ceiling, the worker POSTs
// here with the shared DRAWTOBOQ_WORKER_KEY; we fan out the WhatsApp alert via
// the existing sendApiAlert() plumbing (throttled 1/kind/hour) and log it to
// sabi_activity_log against the project.

export const dynamic = 'force-dynamic';

const ALLOWED_KINDS = new Set<AlertKind>(['scan_failed', 'scan_slow']);

export async function POST(req: NextRequest) {
  const workerKey = process.env.DRAWTOBOQ_WORKER_KEY;
  if (!workerKey) {
    return NextResponse.json({ error: 'worker alerts not configured' }, { status: 503 });
  }
  if (req.headers.get('x-worker-key') !== workerKey) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: { kind?: string; message?: string; projectId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const kind = (body.kind ?? 'scan_failed') as AlertKind;
  const message = (body.message ?? '').toString().slice(0, 500);
  if (!ALLOWED_KINDS.has(kind) || !message) {
    return NextResponse.json({ error: 'kind must be scan_failed|scan_slow and message is required' }, { status: 400 });
  }

  // Attribute the alert + activity-log row to the project when we know it.
  if (body.projectId) {
    await withProjectContext(body.projectId, () => sendApiAlert(kind, message));
  } else {
    await sendApiAlert(kind, message);
  }

  return NextResponse.json({ ok: true });
}
