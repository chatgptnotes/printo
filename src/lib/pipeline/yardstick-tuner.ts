/**
 * Yardstick auto-tuner.
 *
 * After George approves an estimation, fold the project's actual AED/sqft
 * into `sabi_yardstick_rates` so future estimates are sanity-checked against
 * REAL recent quotes, not the seed data from migration 004.
 *
 * Strategy: for the project's (building_type, service_type) pairs, look up
 * the last 20 approved estimations, compute p10 and p90, upsert the
 * yardstick row. Single-project approve = 1 fresh sample folded in;
 * cohorts with <5 approved samples are left untouched (the seeds are
 * better than tiny-N statistics).
 *
 * No AI involvement. Pure SQL aggregation. Fire-and-forget from the approve
 * route — failure to tune does not affect approval success.
 */
import { supabaseAdmin } from '@/lib/storage/supabase';

const MIN_COHORT_SIZE = 5;
const COHORT_LIMIT = 20;

export interface TuneOutcome {
  building_type: string;
  service_type: string;
  samples: number;
  min_aed_per_sqft: number | null;
  max_aed_per_sqft: number | null;
  status: 'updated' | 'skipped_too_few' | 'skipped_no_area' | 'error';
}

export async function tuneYardstickFromApproval(projectId: string): Promise<TuneOutcome[]> {
  try {
    // 1. Pull this project's services + project meta in one go
    const { data: project } = await supabaseAdmin
      .from('sabi_projects')
      .select('id, building_type, total_area_sqft')
      .eq('id', projectId)
      .single();

    if (!project || !project.building_type || !project.total_area_sqft) {
      return [{ building_type: project?.building_type ?? '?', service_type: '?', samples: 0, min_aed_per_sqft: null, max_aed_per_sqft: null, status: 'skipped_no_area' }];
    }

    const { data: services } = await supabaseAdmin
      .from('sabi_services')
      .select('service_type')
      .eq('project_id', projectId)
      .eq('is_required', true);

    const serviceTypes = [...new Set((services ?? []).map(s => s.service_type as string))];
    const outcomes: TuneOutcome[] = [];

    for (const serviceType of serviceTypes) {
      outcomes.push(await tuneOneCohort(project.building_type, serviceType));
    }
    return outcomes;
  } catch (err) {
    console.warn('[yardstick-tuner] failed:', (err as Error).message);
    return [];
  }
}

async function tuneOneCohort(buildingType: string, serviceType: string): Promise<TuneOutcome> {
  // Cohort = last N approved projects of this building_type that have a
  // service row of the matching service_type. We compute AED/sqft as
  // service.total_aed / project.total_area_sqft.
  const { data: cohort } = await supabaseAdmin
    .from('sabi_services')
    .select('total_aed, project_id, sabi_projects!inner(total_area_sqft, building_type)')
    .eq('service_type', serviceType)
    .eq('is_required', true)
    .eq('sabi_projects.building_type', buildingType)
    .not('total_aed', 'is', null)
    .gt('total_aed', 0)
    .order('updated_at', { ascending: false })
    .limit(COHORT_LIMIT);

  // Also filter on george_approved via a second pass (PostgREST won't let us
  // join through 3 tables in one shot without a view).
  const projectIds = [...new Set((cohort ?? []).map(r => r.project_id as string))];
  let approvedSet = new Set<string>();
  if (projectIds.length > 0) {
    const { data: ests } = await supabaseAdmin
      .from('sabi_estimations')
      .select('project_id')
      .in('project_id', projectIds)
      .eq('george_approved', true);
    approvedSet = new Set((ests ?? []).map(e => e.project_id as string));
  }

  const samples: number[] = [];
  for (const row of cohort ?? []) {
    if (!approvedSet.has(row.project_id as string)) continue;
    const joined = row.sabi_projects as unknown as { total_area_sqft: number } | { total_area_sqft: number }[] | null;
    const sqft = Array.isArray(joined) ? joined[0]?.total_area_sqft : joined?.total_area_sqft;
    if (!sqft || sqft <= 0) continue;
    const perSqft = Number(row.total_aed) / sqft;
    if (Number.isFinite(perSqft) && perSqft > 0 && perSqft < 1000) samples.push(perSqft);
  }

  if (samples.length < MIN_COHORT_SIZE) {
    return { building_type: buildingType, service_type: serviceType, samples: samples.length, min_aed_per_sqft: null, max_aed_per_sqft: null, status: 'skipped_too_few' };
  }

  samples.sort((a, b) => a - b);
  const p10 = samples[Math.floor(samples.length * 0.1)];
  const p90 = samples[Math.floor(samples.length * 0.9)];
  const minRate = round2(p10);
  const maxRate = round2(p90);

  // Upsert via natural key (building_type, service_type). The schema doesn't
  // declare it UNIQUE so we delete-then-insert — single-row write, atomic
  // enough for this use case.
  await supabaseAdmin
    .from('sabi_yardstick_rates')
    .delete()
    .eq('building_type', buildingType)
    .eq('service_type', serviceType);

  const { error } = await supabaseAdmin.from('sabi_yardstick_rates').insert({
    building_type: buildingType,
    service_type: serviceType,
    min_aed_per_sqft: minRate,
    max_aed_per_sqft: maxRate,
    notes: `Auto-tuned from ${samples.length} approved samples (p10=${minRate}, p90=${maxRate}) on ${new Date().toISOString().slice(0, 10)}`,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    console.warn(`[yardstick-tuner] insert ${buildingType}/${serviceType} failed:`, error.message);
    return { building_type: buildingType, service_type: serviceType, samples: samples.length, min_aed_per_sqft: minRate, max_aed_per_sqft: maxRate, status: 'error' };
  }

  return { building_type: buildingType, service_type: serviceType, samples: samples.length, min_aed_per_sqft: minRate, max_aed_per_sqft: maxRate, status: 'updated' };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
