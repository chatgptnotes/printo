import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST() {
  return NextResponse.json(
    { error: 'Demo inbox scanning has been removed. Upload drawings directly.' },
    { status: 410 },
  );
}
