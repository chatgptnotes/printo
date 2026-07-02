import { NextRequest, NextResponse } from 'next/server';
import { backfillEmails, repairMissingAttachments } from '@/lib/email/gmail-sync';
import { requireAuth } from '@/lib/shared/api-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// POST: Backfill historical emails from Gmail → sabi_emails
// Call repeatedly with returned pageToken until null
export async function POST(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json().catch(() => ({}));

    // Repair mode: fix emails that have attachments but no attachment rows
    if (body.repair) {
      const result = await repairMissingAttachments();
      return NextResponse.json(result);
    }

    const pageToken = body.pageToken || null;
    const batchSize = Math.min(body.batchSize || 25, 50);

    const result = await backfillEmails(pageToken, batchSize);

    return NextResponse.json({
      processed: result.processed,
      nextPageToken: result.nextPageToken,
      done: !result.nextPageToken,
      ...(result.errors.length > 0 && { errors: result.errors }),
    });
  } catch (error: any) {
    console.error('Backfill error:', error);
    return NextResponse.json(
      { error: 'Backfill failed', details: error.message },
      { status: 500 }
    );
  }
}
