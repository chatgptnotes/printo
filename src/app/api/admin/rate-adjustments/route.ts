/**
 * GET /api/admin/rate-adjustments
 *
 * Returns the corrections-informed cohort multipliers — what past human
 * overrides imply about how AI/library rates should be adjusted for new
 * estimates. The UI on the services-edit screen can display
 * "12 prior office HVAC corrections suggest 1.18× — apply?"
 *
 * Query params:
 *   service_type      — optional. Filter to one service.
 *   building_type     — optional. Filter to one building type.
 *   base_rate_aed     — optional. If provided, returns suggestedRateAed for
 *                       (service_type, building_type) — single-row form.
 *
 * No body — pure read.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/shared/api-auth';
import {
  getAllCohortMultipliers,
  suggestRateAdjustment,
} from '@/lib/pipeline/rate-adjuster';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const sp = request.nextUrl.searchParams;
  const serviceType = sp.get('service_type');
  const buildingType = sp.get('building_type');
  const baseRateRaw = sp.get('base_rate_aed');

  // Single-row form: ask for a specific cohort + a base rate, get a suggestion
  if (serviceType && baseRateRaw) {
    const baseRate = Number(baseRateRaw);
    if (!Number.isFinite(baseRate) || baseRate <= 0) {
      return NextResponse.json({ error: 'base_rate_aed must be a positive number' }, { status: 400 });
    }
    const suggestion = await suggestRateAdjustment({
      serviceType,
      buildingType: buildingType ?? null,
      baseRateAed: baseRate,
    });
    return NextResponse.json(suggestion);
  }

  // List form: every learned cohort, optionally filtered
  let multipliers = await getAllCohortMultipliers();
  if (serviceType) multipliers = multipliers.filter(m => m.serviceType === serviceType);
  if (buildingType) multipliers = multipliers.filter(m => m.buildingType === buildingType);

  return NextResponse.json({
    cohorts: multipliers,
    total: multipliers.length,
  });
}
