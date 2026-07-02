/**
 * GET /api/admin/extraction-accuracy
 *
 * Mines sabi_corrections rows where field_path starts with 'extraction.' (the
 * Phase 7 capture point) and reports per-field correction frequency. The
 * operator uses this to prioritise extraction-prompt tuning — fields that
 * humans correct most often are the ones the prompt's few-shot examples
 * should cover next.
 *
 * Why frequency, not "accuracy %": we'd need a count of correct extractions
 * to compute a real rate, but we don't log "no-correction" events. We
 * approximate by counting corrections against total projects in the same
 * cohort (when ≥10 projects exist) so high-volume fields don't dominate.
 *
 * Response shape:
 *   {
 *     fields: [
 *       {
 *         field: 'building_type',
 *         corrections: 23,
 *         projects_in_cohort: 87,
 *         correction_rate: 0.264,
 *         top_changes: [{ from: 'office', to: 'hospital', count: 5 }, ...],
 *         by_building_type: [{ building_type: 'hospital', count: 8 }, ...]
 *       },
 *       ...
 *     ],
 *     since: ISO date
 *   }
 *
 * Query params:
 *   days   — rolling window (default 90, max 365)
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { requireAuth } from '@/lib/shared/api-auth';

export const dynamic = 'force-dynamic';

interface CorrectionRow {
  field_path: string | null;
  ai_value: unknown;
  human_value: unknown;
  metadata: Record<string, unknown> | null;
}

interface FieldStats {
  field: string;
  corrections: number;
  by_building_type: Map<string, number>;
  changes: Map<string, number>; // "from→to" → count
}

export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const sp = request.nextUrl.searchParams;
  const days = Math.min(Math.max(parseInt(sp.get('days') ?? '90', 10) || 90, 7), 365);
  const sinceIso = new Date(Date.now() - days * 86_400_000).toISOString();

  const [{ data: corrections, error: corrErr }, { count: totalProjects }] = await Promise.all([
    supabaseAdmin
      .from('sabi_corrections')
      .select('field_path, ai_value, human_value, metadata')
      .like('field_path', 'extraction.%')
      .gte('created_at', sinceIso)
      .limit(5000),
    supabaseAdmin
      .from('sabi_projects')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', sinceIso),
  ]);

  if (corrErr) return NextResponse.json({ error: corrErr.message }, { status: 500 });

  const byField = new Map<string, FieldStats>();
  for (const row of (corrections ?? []) as CorrectionRow[]) {
    const path = row.field_path ?? '';
    const m = path.match(/^extraction\.([a-z_]+)$/);
    if (!m) continue;
    const field = m[1];

    let stats = byField.get(field);
    if (!stats) {
      stats = { field, corrections: 0, by_building_type: new Map(), changes: new Map() };
      byField.set(field, stats);
    }
    stats.corrections += 1;

    const buildingType = (row.metadata?.building_type as string | null) ?? 'unknown';
    stats.by_building_type.set(buildingType, (stats.by_building_type.get(buildingType) ?? 0) + 1);

    const changeKey = `${truncate(row.ai_value)}→${truncate(row.human_value)}`;
    stats.changes.set(changeKey, (stats.changes.get(changeKey) ?? 0) + 1);
  }

  const fields = [...byField.values()].map(s => ({
    field: s.field,
    corrections: s.corrections,
    projects_in_cohort: totalProjects ?? 0,
    correction_rate: totalProjects && totalProjects > 0 ? round4(s.corrections / totalProjects) : 0,
    top_changes: [...s.changes.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([k, count]) => {
        const [from, to] = k.split('→');
        return { from, to, count };
      }),
    by_building_type: [...s.by_building_type.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([building_type, count]) => ({ building_type, count })),
  }));
  fields.sort((a, b) => b.corrections - a.corrections);

  return NextResponse.json({
    since: sinceIso,
    days,
    total_projects_in_window: totalProjects ?? 0,
    fields,
  });
}

function truncate(v: unknown, max = 30): string {
  if (v == null) return 'null';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
