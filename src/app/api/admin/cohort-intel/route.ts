/**
 * GET /api/admin/cohort-intel
 *
 * Single-call view that joins:
 *   • rate-adjuster cohort multipliers (numeric corrections from rate edits)
 *   • correction-stats rejection rates (binary corrections from gate rejects)
 *
 * Per (service_type, building_type) the response gives "for office HVAC:
 * 14 corrections suggest 1.18× rate (CV n/a), and 22% gate-14 rejection rate
 * across 18 reviews". Lets a single dashboard page paint a complete cohort
 * health picture without making N round trips.
 *
 * Query params:
 *   service_type   — optional cohort filter
 *   building_type  — optional cohort filter
 *
 * Response is pre-sorted by a "needs attention" composite score: cohorts
 * with high rejection rate AND non-1.0 multiplier float to the top.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { requireAuth } from '@/lib/shared/api-auth';
import { getAllCohortMultipliers } from '@/lib/pipeline/rate-adjuster';
import { getAllRejectionStats } from '@/lib/pipeline/correction-stats';

export const dynamic = 'force-dynamic';

interface CohortIntel {
  service_type: string;
  building_type: string;
  rate: { multiplier: number; samples: number; lastUpdated: string } | null;
  rejection: {
    fieldPath: string;
    samples: number;
    rejections: number;
    rejectionRate: number;
    topReasons: Array<{ reason: string; count: number }>;
  } | null;
  /**
   * Extraction-level error signal — count of `extraction.*` corrections in
   * the last 90 days that share this building_type. No service axis (extraction
   * is project-level, not service-level), so the same number is mirrored across
   * every service row sharing the building_type.
   */
  extraction_errors: { count: number; top_fields: Array<{ field: string; count: number }> } | null;
  attention_score: number; // higher = more important to investigate
}

export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const sp = request.nextUrl.searchParams;
  const filterService = sp.get('service_type');
  const filterBuilding = sp.get('building_type');

  const since90dIso = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const [rateCohorts, rejectionStats, extractionRes] = await Promise.all([
    getAllCohortMultipliers(),
    getAllRejectionStats(),
    supabaseAdmin
      .from('sabi_corrections')
      .select('field_path, metadata')
      .like('field_path', 'extraction.%')
      .gte('created_at', since90dIso)
      .limit(5000),
  ]);

  // Aggregate extraction errors by building_type (no service axis).
  const extractionByBuilding = new Map<string, { count: number; fields: Map<string, number> }>();
  for (const row of (extractionRes.data ?? []) as Array<{ field_path: string | null; metadata: Record<string, unknown> | null }>) {
    const m = (row.field_path ?? '').match(/^extraction\.([a-z_]+)$/);
    if (!m) continue;
    const buildingType = (row.metadata?.building_type as string | null) ?? 'unknown';
    const bucket = extractionByBuilding.get(buildingType) ?? { count: 0, fields: new Map() };
    bucket.count += 1;
    bucket.fields.set(m[1], (bucket.fields.get(m[1]) ?? 0) + 1);
    extractionByBuilding.set(buildingType, bucket);
  }

  // Build a service×building grid from the union of cohorts seen in either
  // signal. Most cohorts will appear in only one of the two sources.
  const grid = new Map<string, CohortIntel>();
  const k = (s: string, b: string) => `${s}::${b}`;

  for (const c of rateCohorts) {
    grid.set(k(c.serviceType, c.buildingType), {
      service_type: c.serviceType,
      building_type: c.buildingType,
      rate: { multiplier: c.multiplier, samples: c.samples, lastUpdated: c.lastUpdated },
      rejection: null,
      extraction_errors: null,
      attention_score: 0,
    });
  }

  // Rejection stats can have null serviceType (e.g. bid_recommendation has no
  // service). Roll those up under '*' so they still appear in the grid.
  for (const r of rejectionStats) {
    const svc = r.serviceType ?? '*';
    const key = k(svc, r.buildingType);
    const existing = grid.get(key);
    if (existing) {
      existing.rejection = {
        fieldPath: r.fieldPath,
        samples: r.samples,
        rejections: r.rejections,
        rejectionRate: r.rejectionRate,
        topReasons: r.topReasons,
      };
    } else {
      grid.set(key, {
        service_type: svc,
        building_type: r.buildingType,
        rate: null,
        rejection: {
          fieldPath: r.fieldPath,
          samples: r.samples,
          rejections: r.rejections,
          rejectionRate: r.rejectionRate,
          topReasons: r.topReasons,
        },
        extraction_errors: null,
        attention_score: 0,
      });
    }
  }

  // Mirror per-building extraction error counts onto every cohort row
  // sharing that building_type. UI dedupes if it wants a per-building view.
  for (const cohort of grid.values()) {
    const ext = extractionByBuilding.get(cohort.building_type);
    if (!ext) continue;
    cohort.extraction_errors = {
      count: ext.count,
      top_fields: [...ext.fields.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([field, count]) => ({ field, count })),
    };
  }

  let cohorts = [...grid.values()];
  if (filterService) cohorts = cohorts.filter(c => c.service_type === filterService);
  if (filterBuilding) cohorts = cohorts.filter(c => c.building_type === filterBuilding);

  // Composite attention score (Phase 8):
  //   rejection_rate × log(rejection_samples)
  // + |multiplier - 1|  × log(rate_samples)
  // + 0.3 × log(1 + extraction_errors)
  // Rewards unreliable AI, consistent rate skew, AND high extraction-error
  // volume. log keeps a small noisy cohort from dominating a large one.
  // The 0.3 weight on extraction errors is empirical — extraction is a
  // weaker signal per-event than rate corrections (operators sometimes fix
  // extraction in passing without it being a real "AI got it wrong" event).
  for (const c of cohorts) {
    let score = 0;
    if (c.rejection) score += c.rejection.rejectionRate * Math.log(1 + c.rejection.samples);
    if (c.rate) score += Math.abs(c.rate.multiplier - 1) * Math.log(1 + c.rate.samples);
    if (c.extraction_errors) score += 0.3 * Math.log(1 + c.extraction_errors.count);
    c.attention_score = Math.round(score * 1000) / 1000;
  }
  cohorts.sort((a, b) => b.attention_score - a.attention_score);

  return NextResponse.json({
    cohorts,
    total: cohorts.length,
    sources: {
      rate_cohorts: rateCohorts.length,
      rejection_cohorts: rejectionStats.length,
      extraction_corrections: (extractionRes.data ?? []).length,
    },
  });
}
