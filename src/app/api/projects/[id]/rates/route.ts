import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { requireAuth } from '@/lib/shared/api-auth';

export const dynamic = 'force-dynamic';

// Persist the three plan-page cable rate buckets (AED/m) onto the project's
// electrical service row. Read back by GET /api/projects/[id]/boq/industry to
// price Bill 5 cables. Body: { heavy, submain, final } — only these keys are
// kept, each coerced to a non-negative finite number.
const BUCKET_KEYS = ['heavy', 'submain', 'final'] as const;

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const { id } = params;
    const body = await request.json().catch(() => ({}));

    const rateOverrides: Record<string, number> = {};
    for (const key of BUCKET_KEYS) {
      const n = Number((body as Record<string, unknown>)?.[key]);
      if (Number.isFinite(n) && n >= 0) rateOverrides[key] = n;
    }
    if (Object.keys(rateOverrides).length === 0) {
      return NextResponse.json(
        { error: 'No valid rate buckets provided (expected heavy / submain / final as non-negative numbers)' },
        { status: 400 },
      );
    }

    const { data, error } = await supabaseAdmin
      .from('sabi_services')
      .update({ rate_overrides: rateOverrides, updated_at: new Date().toISOString() })
      .eq('project_id', id)
      .eq('service_type', 'electrical')
      .select('id, rate_overrides')
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        { error: 'No electrical service row found for this project' },
        { status: 404 },
      );
    }

    return NextResponse.json({ rate_overrides: data.rate_overrides });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Failed to save rates', details: message }, { status: 500 });
  }
}
