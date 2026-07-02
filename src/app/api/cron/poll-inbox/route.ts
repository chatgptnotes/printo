import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    { error: 'Inbox polling has been removed. Upload drawings directly.' },
    { status: 410 },
  );
}
