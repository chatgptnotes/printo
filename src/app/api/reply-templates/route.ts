import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    { error: 'Email reply templates have been removed.' },
    { status: 410 },
  );
}
