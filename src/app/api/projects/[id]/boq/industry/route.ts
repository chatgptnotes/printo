import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { requireAuth } from '@/lib/shared/api-auth';
// George's standard deliverable — the Dubai industry-standard 13-Bill priced
// electrical BOQ (Cover, Preamble, Bills 1–13, Summary). Generated on the fly
// from the project's electrical scan result; returns the .xlsx for download.
import { generateDubaiIndustryBoqXlsx } from '@/lib/excel/dubai-industry-boq-xlsx';
import { lookupRate } from '@/lib/excel/dubai-2026-rates';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const { id } = params;

    const { data: project, error: pErr } = await supabaseAdmin
      .from('sabi_projects').select('*').eq('id', id).single();
    if (pErr || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const { data: svc } = await supabaseAdmin
      .from('sabi_services')
      .select('ai_extraction, rate_overrides')
      .eq('project_id', id)
      .eq('service_type', 'electrical')
      .maybeSingle();

    const ext = svc?.ai_extraction as Record<string, unknown> | null;
    // Some stored rows nest the result under raw_electrical_procedure; most
    // hold it at the top level. Accept either.
    const electrical = (ext?.raw_electrical_procedure as Record<string, unknown>) || ext;

    if (!electrical || !Array.isArray((electrical as { cable_schedule?: unknown[] }).cable_schedule)
        || (electrical as { cable_schedule: unknown[] }).cable_schedule.length === 0) {
      return NextResponse.json(
        { error: 'No electrical cable schedule to export yet — run the estimate first.' },
        { status: 404 },
      );
    }

    // Priced BOQ: cable rows are priced from the user's edited plan-page rate
    // buckets (rate_overrides) when present; everything else falls through to the
    // static Dubai-2026 indicative library. Rows with no confident match stay
    // blank and are flagged amber for the estimator.
    const rateOverrides = (svc?.rate_overrides as { heavy?: number; submain?: number; final?: number } | null) || null;
    const buffer: Buffer = await generateDubaiIndustryBoqXlsx({
      project,
      electrical,
      options: { rateLookup: (row: { item: string; desc: string; unit: string; qty: unknown }) => lookupRate(row, rateOverrides) },
    });
    const body = new Uint8Array(buffer);

    const safe = (String(project.project_name || 'electrical')
      .replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'electrical')
      .slice(0, 40).replace(/-+$/g, '');

    return new NextResponse(body, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${safe}-industry-boq.xlsx"`,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Failed to generate industry BOQ', details: message }, { status: 500 });
  }
}
