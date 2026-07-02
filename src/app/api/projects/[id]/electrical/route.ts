import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { requireAuth } from '@/lib/shared/api-auth';
import type { ElectricalProcedureResult } from '@/lib/ai/ai-provider';

export const dynamic = 'force-dynamic';

// General save for the Data-tab inline editor: accepts the FULL edited electrical
// procedure result and writes it to ai_extraction.raw_electrical_procedure — the path
// every BOQ/plan consumer actually reads — while re-mirroring the standard top-level
// arrays so the stored shape matches what the scan first wrote. Untouched top-level keys
// (e.g. scan_validation) are preserved via the spread.
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const { id: projectId } = params;
    const body = await request.json();
    const e = (body as { electrical?: ElectricalProcedureResult }).electrical;

    if (!e || typeof e !== 'object' || Array.isArray(e)) {
      return NextResponse.json({ error: 'electrical (object) is required' }, { status: 400 });
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
    const updatedExtraction = {
      ...existing, // keeps scan_validation + any other top-level keys
      raw_electrical_procedure: e, // the edited full object — what BOQ/plan actually read
      // re-mirror the standard top-level arrays for consistency with the scan-time shape:
      cable_schedule: e.cable_schedule,
      smdb_inventory: e.smdb_inventory,
      db_inventory: e.db_inventory,
      mdb_info: e.mdb_info,
      incoming_supply: e.incoming_supply,
      lv_panels: e.lv_panels,
      mechanical_equipment: e.mechanical_equipment,
      power_outlets: e.power_outlets,
      lighting_fixtures: e.lighting_fixtures || [],
      containment: e.containment,
      earthing: e.earthing,
      metering: e.metering,
      load_summary: e.load_summary,
    };

    const { error: updateErr } = await supabaseAdmin
      .from('sabi_services')
      .update({ ai_extraction: updatedExtraction, updated_at: new Date().toISOString() })
      .eq('id', svc.id);

    if (updateErr) throw updateErr;

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Electrical data save failed', details: message }, { status: 500 });
  }
}
