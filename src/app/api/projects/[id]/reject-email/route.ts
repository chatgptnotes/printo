import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST() {
  return NextResponse.json(
    { error: 'Rejection emails have been removed. Record the project decision without sending email.' },
    { status: 410 },
  );
}
