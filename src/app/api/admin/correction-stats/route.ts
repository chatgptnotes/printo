/**
 * GET /api/admin/correction-stats
 *
 * Per-cohort rejection rate over `sabi_corrections`. Counterpart to
 * /api/admin/rate-adjustments — that one mines rates (numeric corrections),
 * this one mines rejections (binary signals from gate rejects + no-bids).
 *
 * Use cases:
 *   • Show "AI cable schedules for office hospitals are rejected 6/8 times,
 *     review carefully" hint on the bid detail page
 *   • Identify cohorts where the AI is unreliable so the team can decide
 *     whether to gate them more aggressively, retrain prompts, or downgrade
 *     to quick estimates by default
 *
 * Query params:
 *   field_path     — optional. Filter to one field, e.g. 'quantities.cable_schedule',
 *                    'pricing.final_quote_aed', 'bid_recommendation'
 *   service_type   — optional cohort filter
 *   building_type  — optional cohort filter
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/shared/api-auth';
import { getAllRejectionStats } from '@/lib/pipeline/correction-stats';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const sp = request.nextUrl.searchParams;
  const fieldPath = sp.get('field_path');
  const serviceType = sp.get('service_type');
  const buildingType = sp.get('building_type');

  let stats = await getAllRejectionStats(fieldPath ?? undefined);
  if (serviceType) stats = stats.filter(s => s.serviceType === serviceType);
  if (buildingType) stats = stats.filter(s => s.buildingType === buildingType);

  // Sort high-rejection cohorts first — that's what the team needs to see
  stats.sort((a, b) => b.rejectionRate - a.rejectionRate);

  return NextResponse.json({
    cohorts: stats,
    total: stats.length,
  });
}
