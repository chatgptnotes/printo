/**
 * GET /api/admin/cohort-drift-status
 *
 * Returns the latest cohort-drift run findings (written by
 * /api/cron/cohort-drift). Cheap read — bid detail page fetches it on mount
 * and renders a badge next to any service whose (service_type, building_type)
 * cohort drifted recently.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { requireAuth } from '@/lib/shared/api-auth';

export const dynamic = 'force-dynamic';

interface DriftEntry {
  cohort: string; // 'service::building'
  recent_median: number;
  baseline_median: number;
  shift_pct: number;
  recent_n: number;
  baseline_n: number;
}

export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { data } = await supabaseAdmin
    .from('sabi_settings')
    .select('value')
    .eq('key', 'cohort_drift_latest')
    .maybeSingle();

  const value = (data?.value as { checked_at?: string; drifted?: DriftEntry[]; cohorts_checked?: number } | null) ?? null;
  return NextResponse.json({
    checked_at: value?.checked_at ?? null,
    cohorts_checked: value?.cohorts_checked ?? 0,
    drifted: value?.drifted ?? [],
  });
}
