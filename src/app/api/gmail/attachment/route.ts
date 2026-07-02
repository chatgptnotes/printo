import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    { error: 'Email attachment download has been removed. Use project uploads.' },
    { status: 410 },
  );
}
