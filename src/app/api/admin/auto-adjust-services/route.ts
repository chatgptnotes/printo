/**
 * POST /api/admin/auto-adjust-services
 *
 * Retroactive cohort-multiplier application. Walks `sabi_services` rows that
 * have a `unit_rate_aed` but no `ai_extraction.auto_adjusted` audit (i.e.
 * weren't covered by quick-estimate's Phase 4 wiring or yardstick-fill's
 * Phase 5 wiring at write time), and applies `applyAutoAdjustment()` to each
 * one whose cohort signal is strong enough.
 *
 * Use case: cohort data accumulates over time as humans correct rates. A
 * project priced 2 weeks ago may have used a "no signal" baseline rate;
 * by the time it's reviewed today there are enough corrections to apply
 * a multiplier silently. This endpoint lets the team backfill that benefit
 * without re-running the full estimate flow.
 *
 * Body (all optional — POST with `{}` runs across everything):
 *   {
 *     project_id?:    string,        // single-project mode
 *     service_type?:  string,        // filter by service
 *     building_type?: string,        // filter by cohort
 *     dry_run?:       boolean,       // default true — preview without writing
 *   }
 *
 * Response: per-row outcomes including rate before/after and reason.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { requireAuth } from '@/lib/shared/api-auth';
import { applyAutoAdjustment } from '@/lib/pipeline/rate-adjuster';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface Body {
  project_id?: string;
  service_type?: string;
  building_type?: string;
  dry_run?: boolean;
}

interface ServiceRow {
  id: string;
  project_id: string;
  service_type: string;
  unit_rate_aed: number | null;
  quantity: number | null;
  ai_extraction: Record<string, unknown> | null;
  sabi_projects: { building_type: string | null } | { building_type: string | null }[] | null;
}

interface Outcome {
  service_id: string;
  project_id: string;
  service_type: string;
  building_type: string | null;
  base_rate_aed: number;
  final_rate_aed: number;
  multiplier: number;
  applied: boolean;
  reason: string;
  samples: number;
  written: boolean;
}

export async function POST(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const body = (await request.json().catch(() => ({}))) as Body;
  const dryRun = body.dry_run !== false; // default true — explicit opt-in for writes

  // Pull candidate services. Use !inner so we always get the project row alongside.
  let q = supabaseAdmin
    .from('sabi_services')
    .select('id, project_id, service_type, unit_rate_aed, quantity, ai_extraction, sabi_projects!inner(building_type)')
    .eq('is_required', true)
    .not('unit_rate_aed', 'is', null)
    .gt('unit_rate_aed', 0)
    .limit(1000);
  if (body.project_id) q = q.eq('project_id', body.project_id);
  if (body.service_type) q = q.eq('service_type', body.service_type);
  if (body.building_type) q = q.eq('sabi_projects.building_type', body.building_type);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as unknown as ServiceRow[];
  const outcomes: Outcome[] = [];
  let written = 0;
  let skippedAlreadyAdjusted = 0;

  for (const row of rows) {
    // Skip rows that already carry an auto_adjusted audit — they're either
    // up-to-date or were intentionally reverted by a human; don't re-stomp.
    if ((row.ai_extraction as Record<string, unknown> | null)?.auto_adjusted) {
      skippedAlreadyAdjusted++;
      continue;
    }
    const proj = row.sabi_projects;
    const buildingType = (Array.isArray(proj) ? proj[0]?.building_type : proj?.building_type) ?? null;
    const baseRate = Number(row.unit_rate_aed);
    if (!Number.isFinite(baseRate) || baseRate <= 0) continue;

    const adj = await applyAutoAdjustment({
      serviceType: row.service_type,
      buildingType,
      baseRateAed: baseRate,
    });

    const outcome: Outcome = {
      service_id: row.id,
      project_id: row.project_id,
      service_type: row.service_type,
      building_type: buildingType,
      base_rate_aed: adj.baseRateAed,
      final_rate_aed: adj.finalRateAed,
      multiplier: adj.multiplier,
      applied: adj.applied,
      reason: adj.reason,
      samples: adj.samples,
      written: false,
    };

    if (adj.applied && !dryRun) {
      const qty = row.quantity ?? 0;
      const newTotal = Math.round(adj.finalRateAed * qty);
      const newExt = {
        ...(row.ai_extraction ?? {}),
        auto_adjusted: {
          base_rate_aed: adj.baseRateAed,
          final_rate_aed: adj.finalRateAed,
          multiplier: adj.multiplier,
          samples: adj.samples,
          cv: adj.cv,
          applied_at: new Date().toISOString(),
          applied_by: 'bulk-admin',
        },
      };
      const { error: updErr } = await supabaseAdmin
        .from('sabi_services')
        .update({
          unit_rate_aed: adj.finalRateAed,
          total_aed: newTotal > 0 ? newTotal : undefined,
          ai_extraction: newExt,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id);
      if (!updErr) {
        outcome.written = true;
        written++;
      } else {
        console.warn(`[bulk-adjust] update failed for ${row.id}:`, updErr.message);
      }
    }

    outcomes.push(outcome);
  }

  return NextResponse.json({
    dry_run: dryRun,
    scanned: rows.length,
    skipped_already_adjusted: skippedAlreadyAdjusted,
    eligible: outcomes.filter(o => o.applied).length,
    written,
    outcomes: outcomes.slice(0, 200), // cap response size
  });
}
