import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { logActivity, updateProjectStatus } from '@/lib/storage/activity-logger';
import { logCorrection } from '@/lib/storage/corrections-logger';
import { requireAuth } from '@/lib/shared/api-auth';

export const dynamic = 'force-dynamic';

// PUT: Update a single service's rate (manual override from UI)
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json();
    const { service_id, unit_rate_aed, total_aed } = body;

    if (!service_id) {
      return NextResponse.json({ error: 'service_id required' }, { status: 400 });
    }
    if (unit_rate_aed == null || isNaN(Number(unit_rate_aed)) || Number(unit_rate_aed) <= 0) {
      return NextResponse.json({ error: 'Valid unit_rate_aed required (> 0)' }, { status: 400 });
    }

    // Verify service belongs to this project
    const { data: svc, error: svcErr } = await supabaseAdmin
      .from('sabi_services')
      .select('id, project_id, service_type, unit_rate_aed, ai_extraction')
      .eq('id', service_id)
      .eq('project_id', params.id)
      .single();

    if (svcErr || !svc) {
      return NextResponse.json({ error: 'Service not found' }, { status: 404 });
    }

    // Update rate and mark as manual override
    const aiExtraction = (svc.ai_extraction || {}) as Record<string, unknown>;
    const priorRate = svc.unit_rate_aed;
    const priorRateSource = aiExtraction.rate_source as string | undefined;
    aiExtraction.rate_source = 'library'; // manual override treated as library-grade
    aiExtraction.manual_override = true;
    aiExtraction.override_at = new Date().toISOString();

    const { error: updateErr } = await supabaseAdmin
      .from('sabi_services')
      .update({
        unit_rate_aed: Number(unit_rate_aed),
        ...(total_aed != null && { total_aed: Number(total_aed) }),
        ai_extraction: aiExtraction,
        updated_at: new Date().toISOString(),
      })
      .eq('id', service_id);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    // Capture human-vs-AI rate disagreement so future heuristics can learn
    // from real override patterns. Only log when the rate actually changed.
    if (priorRate != null && Number(priorRate) !== Number(unit_rate_aed)) {
      await logCorrection({
        projectId: params.id,
        fieldPath: `service.${svc.service_type}.unit_rate_aed`,
        aiValue: priorRate,
        humanValue: Number(unit_rate_aed),
        aiProvider: priorRateSource ?? null,
        metadata: { service_type: svc.service_type, service_id },
        createdBy: auth.email ?? null,
      });
    }

    // Recalculate estimation total
    const { data: allServices } = await supabaseAdmin
      .from('sabi_services')
      .select('total_aed')
      .eq('project_id', params.id)
      .eq('is_required', true);

    const newTotal = (allServices || []).reduce((sum, s) => sum + (s.total_aed || 0), 0);

    // Update estimation record if exists
    const { data: est } = await supabaseAdmin
      .from('sabi_estimations')
      .select('id, margin_percent')
      .eq('project_id', params.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (est) {
      const margin = est.margin_percent || 15;
      const finalQuote = Math.round(newTotal * (1 + margin / 100));
      const { data: proj } = await supabaseAdmin.from('sabi_projects').select('total_area_sqft').eq('id', params.id).single();
      const costPerSqft = proj?.total_area_sqft ? newTotal / proj.total_area_sqft : 0;

      await supabaseAdmin
        .from('sabi_estimations')
        .update({
          total_aed: newTotal,
          final_quote_aed: finalQuote,
          cost_per_sqft_aed: Math.round(costPerSqft * 100) / 100,
          updated_at: new Date().toISOString(),
        })
        .eq('id', est.id);

      // Also update project's final_quote_aed
      await supabaseAdmin
        .from('sabi_projects')
        .update({ final_quote_aed: finalQuote, updated_at: new Date().toISOString() })
        .eq('id', params.id);
    }

    return NextResponse.json({ success: true, new_total: newTotal });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const { id } = params;

    // Check project exists
    const { data: project, error } = await supabaseAdmin
      .from('sabi_projects')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Check services exist — if none, create defaults for MEP projects
    let { data: services } = await supabaseAdmin
      .from('sabi_services')
      .select('*')
      .eq('project_id', id)
      .eq('is_required', true);

    if (!services || services.length === 0) {
      // Auto-create default core MEP services
      const defaultServices = ['hvac', 'electrical', 'plumbing', 'fire_fighting'];
      const inserts = defaultServices.map(svc => ({
        project_id: id,
        service_type: svc,
        is_required: true,
      }));
      await supabaseAdmin.from('sabi_services').insert(inserts);

      const { data: newServices } = await supabaseAdmin
        .from('sabi_services')
        .select('*')
        .eq('project_id', id)
        .eq('is_required', true);
      services = newServices || [];
    }

    await logActivity(id, 8, 'Identify Services', 'completed', {
      service_count: services.length,
      services: services.map(s => s.service_type),
    });

    // Update status — services are now part of extraction, no separate gate
    await supabaseAdmin
      .from('sabi_projects')
      .update({
        status: 'services_identified',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    return NextResponse.json({
      services: services.map(s => s.service_type),
      count: services.length,
    });
  } catch (error: any) {
    console.error('Services identification error:', error);
    await logActivity(params.id, 8, 'Identify Services', 'failed', { error: error.message });
    return NextResponse.json(
      { error: 'Failed to confirm services', details: error.message },
      { status: 500 }
    );
  }
}
