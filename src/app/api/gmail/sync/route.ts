import { NextRequest, NextResponse } from 'next/server';
import { syncNewEmails } from '@/lib/email/gmail-sync';
import { requireAuth } from '@/lib/shared/api-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST: Manually trigger email sync (Gmail → sabi_emails)
export async function POST(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const result = await syncNewEmails();
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Email sync error:', error);
    return NextResponse.json(
      { error: 'Sync failed', details: error.message },
      { status: 500 }
    );
  }
}
