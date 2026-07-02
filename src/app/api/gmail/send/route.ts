import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST() {
  return NextResponse.json(
    { error: 'Email sending has been removed. Export BOQ files from the project.' },
    { status: 410 },
  );
}
