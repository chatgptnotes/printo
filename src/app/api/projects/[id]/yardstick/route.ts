import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/shared/api-auth';
import { runYardstickCheck } from '@/lib/pipeline/yardstick-orchestrator';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const result = await runYardstickCheck(params.id);

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.httpStatus }
    );
  }

  return NextResponse.json({ yardstick: result.comparison });
}
