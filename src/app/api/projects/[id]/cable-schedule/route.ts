import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { requireAuth } from '@/lib/shared/api-auth';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const { id: projectId } = params;
    const body = await request.json();
    const { cable_schedule } = body as { cable_schedule: unknown[] };

    if (!Array.isArray(cable_schedule)) {
      return NextResponse.json({ error: 'cable_schedule must be an array' }, { status: 400 });
    }

    const { data: svc, error: svcErr } = await supabaseAdmin
      .from('sabi_services')
      .select('id, ai_extraction')
      .eq('project_id', projectId)
      .eq('service_type', 'electrical')
      .maybeSingle();

    if (svcErr) throw svcErr;
    if (!svc) {
      return NextResponse.json({ error: 'No electrical service record found' }, { status: 404 });
    }

    const existing = (svc.ai_extraction as Record<string, unknown>) || {};
    const rawProc = (existing.raw_electrical_procedure as Record<string, unknown>) || {};

    const updatedExtraction = {
      ...existing,
      cable_schedule,
      raw_electrical_procedure: {
        ...rawProc,
        cable_schedule,
      },
    };

    const { error: updateErr } = await supabaseAdmin
      .from('sabi_services')
      .update({ ai_extraction: updatedExtraction, updated_at: new Date().toISOString() })
      .eq('id', svc.id);

    if (updateErr) throw updateErr;

    return NextResponse.json({ ok: true, count: cable_schedule.length });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Cable schedule save failed', details: message }, { status: 500 });
  }
}
