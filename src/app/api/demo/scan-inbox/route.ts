import { NextRequest, NextResponse } from 'next/server';
import { scanDemoInbox } from '@/lib/shared/demo-projects';
import { requireAuth } from '@/lib/shared/api-auth';

export const dynamic = 'force-dynamic';

// POST: Scan demo inbox and create projects from unprocessed emails
export async function POST(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const result = scanDemoInbox();
  return NextResponse.json({
    success: true,
    created: result.created,
    projectIds: result.projectIds,
    message: result.created > 0
      ? `${result.created} new project(s) created from inbox emails`
      : 'No new emails to process — all emails already have projects',
  });
}
