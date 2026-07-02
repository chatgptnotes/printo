import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    { error: 'Email reading has been removed. Upload drawings directly.' },
    { status: 410 },
  );
}
