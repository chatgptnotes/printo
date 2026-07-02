/**
 * Shared yardstick-check logic. Used by:
 *   - POST /api/projects/[id]/yardstick (manual trigger)
 *   - POST /api/projects/[id]/gate (auto-trigger after gate 20 approval,
 *     as the first half of the yardstick→BOQ chain)
 *
 * Returns a discriminated union — never throws unless something is truly broken.
 */

import { supabaseAdmin } from '@/lib/storage/supabase';
import { logActivity, updateProjectStatus } from '@/lib/storage/activity-logger';
import { compareYardstick } from '@/lib/pipeline/yardstick';
import { applyAutoAdjustment } from '@/lib/pipeline/rate-adjuster';

export type RunYardstickResult =
  | { ok: true; status: string; comparison: unknown }
  | { ok: false; httpStatus: number; error: string };

export async function runYardstickCheck(projectId: string): Promise<RunYardstickResult> {
  try {
    const [projectRes, servicesRes, estRes] = await Promise.all([
      supabaseAdmin.from('sabi_projects').select('*').eq('id', projectId).single(),
      supabaseAdmin.from('sabi_services').select('*').eq('project_id', projectId).eq('is_required', true),
      supabaseAdmin.from('sabi_estimations').select('*').eq('project_id', projectId).limit(1).single(),
    ]);

    if (projectRes.error || !projectRes.data) {
      return { ok: false, httpStatus: 404, error: 'Project not found' };
    }

    const project = projectRes.data;
    let services = servicesRes.data || [];
    const estimation = estRes.data;

    if (!estimation) {
      return { ok: false, httpStatus: 400, error: 'No estimation found. Run estimation first.' };
    }

    if (!project.building_type || !project.total_area_sqft) {
      return { ok: false, httpStatus: 400, error: 'Missing building_type or total_area_sqft' };
    }

    // Smart Skip: if any required service has AED 0, assign a placeholder
    // market rate so the yardstick check and BOQ generation can proceed.
    const PLACEHOLDER_RATES: Record<string, number> = {
      hvac: 350, electrical: 85, plumbing: 55, fire_fighting: 45,
      fire_alarm: 30, bms: 25, lpg: 15, drainage: 40,
    };
    const unpriced = (services as Array<{ id: string; service_type: string; total_aed: number | null; unit_rate_aed: number | null; quantity: number | null; tonnage: number | null }>)
      .filter(s => !s.total_aed || s.total_aed === 0 || !s.unit_rate_aed || s.unit_rate_aed === 0);
    // Distinct service types where placeholder rates were applied. Persisted
    // on sabi_estimations so the Gate 5 UI can warn the operator that the
    // yardstick verdict was based on substituted rates.
    const placeholderServices: string[] = Array.from(new Set(unpriced.map(s => s.service_type)));
    if (unpriced.length > 0) {
      const adjustedNotes: Array<{ service: string; multiplier: number; samples: number }> = [];
      for (const svc of unpriced) {
        const baseRate = PLACEHOLDER_RATES[svc.service_type] || 50;
        // Apply corrections-informed cohort multiplier when the cohort has
        // ≥10 prior corrections AND CV<0.2. Echoes baseRate when no signal.
        const adjustment = await applyAutoAdjustment({
          serviceType: svc.service_type,
          buildingType: project.building_type ?? null,
          baseRateAed: baseRate,
        });
        const rate = adjustment.applied ? adjustment.finalRateAed : baseRate;
        const qty = svc.tonnage || svc.quantity || (project.total_area_sqft || 1000);
        const total = Math.round(rate * qty);
        await supabaseAdmin
          .from('sabi_services')
          .update({ unit_rate_aed: rate, total_aed: total, updated_at: new Date().toISOString() })
          .eq('id', svc.id);
        if (adjustment.applied) {
          adjustedNotes.push({ service: svc.service_type, multiplier: adjustment.multiplier, samples: adjustment.samples });
        }
      }
      await logActivity(projectId, 13, 'Prepare Yardstick Ratios', 'started', {
        message: `Auto-filled placeholder rates for ${unpriced.length} service(s): ${unpriced.map(s => s.service_type).join(', ')}${adjustedNotes.length > 0 ? ` · auto-adjusted: ${adjustedNotes.map(a => `${a.service}×${a.multiplier.toFixed(2)} (${a.samples})`).join(', ')}` : ''}`,
        placeholder_services: unpriced.map(s => s.service_type),
        auto_adjusted: adjustedNotes,
      });
      // Re-fetch services with updated values
      const refreshed = await supabaseAdmin.from('sabi_services').select('*').eq('project_id', projectId).eq('is_required', true);
      services = refreshed.data || [];
    }

    await logActivity(projectId, 13, 'Prepare Yardstick Ratios', 'started');

    const serviceBreakdown = services.map((s: { service_type: string; total_aed: number | null }) => ({
      service_type: s.service_type,
      total_aed: s.total_aed || 0,
    }));

    const comparison = await compareYardstick(
      project.building_type,
      project.total_area_sqft,
      estimation.cost_per_sqft_aed || 0,
      serviceBreakdown
    );

    if (comparison) {
      await supabaseAdmin
        .from('sabi_estimations')
        .update({
          yardstick_min_aed: comparison.totalMinAed,
          yardstick_max_aed: comparison.totalMaxAed,
          yardstick_status: comparison.status,
          yardstick_placeholders: placeholderServices,
          updated_at: new Date().toISOString(),
        })
        .eq('id', estimation.id);
    }

    await updateProjectStatus(projectId, 'yardstick_checked');
    await logActivity(projectId, 13, 'Prepare Yardstick Ratios', 'completed', {
      status: comparison?.status || 'no_rates_found',
      cost_per_sqft: estimation.cost_per_sqft_aed,
      market_range: comparison
        ? `${comparison.marketMinPerSqft}-${comparison.marketMaxPerSqft} AED/sqft`
        : 'N/A',
      per_service: comparison?.details || [],
    });

    return {
      ok: true,
      status: comparison?.status || 'no_rates_found',
      comparison: comparison || { status: 'no_rates_found' },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[run-yardstick] error:', message);
    await logActivity(projectId, 13, 'Prepare Yardstick Ratios', 'failed', { error: message });
    return { ok: false, httpStatus: 500, error: message };
  }
}
