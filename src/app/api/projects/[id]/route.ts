import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { requireAuth } from '@/lib/shared/api-auth';
import { logCorrection } from '@/lib/storage/corrections-logger';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const { id } = params;

    const [projectRes, attachRes, servicesRes, estRes, logRes] = await Promise.all([
      supabaseAdmin.from('sabi_projects').select('*').eq('id', id).single(),
      // Drop extracted_data (5-50KB per row) — only fetched when user expands AI section
      supabaseAdmin.from('sabi_attachments').select('id, project_id, filename, mime_type, size_bytes, attachment_id, message_id, file_type, discipline, storage_path, created_at').eq('project_id', id).order('created_at'),
      supabaseAdmin.from('sabi_services').select('*').eq('project_id', id).order('created_at'),
      supabaseAdmin.from('sabi_estimations').select('*').eq('project_id', id).order('created_at', { ascending: false }).limit(1),
      supabaseAdmin.from('sabi_activity_log').select('id, project_id, step, step_name, status, details, created_at').eq('project_id', id).order('created_at', { ascending: true }).limit(200),
    ]);

    if (projectRes.error) throw projectRes.error;

    let attachments = attachRes.data || [];
    const project = projectRes.data;

    return NextResponse.json({
      project: {
        ...project,
        attachments,
        services: servicesRes.data || [],
        estimation: estRes.data?.[0] || null,
        activity_log: logRes.data || [],
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to fetch project', details: message },
      { status: 500 }
    );
  }
}

// Whitelist of columns clients are allowed to PUT. Keeps a stray field
// from the UI (or a schema mismatch) from silently killing the whole
// update with a Supabase "column does not exist" error.
const ALLOWED_PROJECT_FIELDS = new Set([
  'building_type',
  'location',
  'floors',
  'parking_floors',
  'typical_floors',
  'area_per_floor_sqft',
  'total_area_sqft',
  'typical_height_m',
  'client_name',
  'project_name',
  'deadline',
  'priority',
  'status',
  'notes',
  'reputation_class',
]);

// Subset of allowed fields that originated from AI extraction. When a human
// changes one of these via PUT we log a sabi_corrections row so future
// extraction-prompt tuning has a clear signal of what the AI gets wrong.
// `priority`/`status`/`notes` are workflow state, not extraction output.
const AI_EXTRACTED_FIELDS = new Set([
  'building_type',
  'location',
  'floors',
  'parking_floors',
  'typical_floors',
  'area_per_floor_sqft',
  'total_area_sqft',
  'typical_height_m',
  'client_name',
  'project_name',
  'deadline',
]);

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const { id } = params;
    const body = await request.json();

    // Filter to allowed fields only. Log anything dropped so a UI typo
    // doesn't disappear silently.
    const updates: Record<string, unknown> = {};
    const rejected: string[] = [];
    for (const [key, val] of Object.entries(body || {})) {
      if (ALLOWED_PROJECT_FIELDS.has(key)) {
        updates[key] = val;
      } else {
        rejected.push(key);
      }
    }
    if (rejected.length > 0) {
      console.warn(`[PUT /api/projects/${id}] dropped unknown fields:`, rejected);
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No updatable fields provided', details: `Rejected: ${rejected.join(', ') || 'none'}` },
        { status: 400 }
      );
    }

    // Pre-fetch the prior row so we can capture per-field extraction
    // corrections after the update succeeds. Skipped when no AI-extracted
    // field is in the patch — pure status/priority/notes edits don't yield
    // training signal.
    const touchesExtractionFields = Object.keys(updates).some(k => AI_EXTRACTED_FIELDS.has(k));
    let priorRow: Record<string, unknown> | null = null;
    if (touchesExtractionFields) {
      const { data: prior } = await supabaseAdmin
        .from('sabi_projects')
        .select('*')
        .eq('id', id)
        .single();
      priorRow = prior as Record<string, unknown> | null;
    }

    const { data, error } = await supabaseAdmin
      .from('sabi_projects')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        { error: 'Project not found or update did not match any rows' },
        { status: 404 }
      );
    }

    // Capture extraction-level corrections — one row per actually-changed
    // AI-extracted field. Non-blocking; logCorrection swallows insert errors.
    if (priorRow && touchesExtractionFields) {
      const aiClassification = (priorRow.ai_classification ?? {}) as Record<string, unknown>;
      const provider = (aiClassification._provider as string | undefined)
        ?? ((priorRow.ai_extraction as Record<string, unknown> | null)?._provider as string | undefined)
        ?? null;
      for (const field of Object.keys(updates)) {
        if (!AI_EXTRACTED_FIELDS.has(field)) continue;
        const aiVal = priorRow[field];
        const humanVal = updates[field];
        if (sameValue(aiVal, humanVal)) continue;
        await logCorrection({
          projectId: id,
          fieldPath: `extraction.${field}`,
          aiValue: aiVal as unknown,
          humanValue: humanVal as unknown,
          aiProvider: provider,
          metadata: {
            building_type: (priorRow.building_type as string | null) ?? null,
            total_area_sqft: priorRow.total_area_sqft as number | null,
          },
          createdBy: auth.email ?? null,
        });
      }
    }

    return NextResponse.json({ project: data });
  } catch (error: any) {
    console.error('Project update error:', error);
    return NextResponse.json(
      { error: 'Failed to update project', details: error.message },
      { status: 500 }
    );
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  // Loose numeric comparison so '12' from a form input doesn't false-positive
  // against the numeric 12 already stored.
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
  return String(a).trim() === String(b).trim();
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const { id } = params;

    const { error } = await supabaseAdmin
      .from('sabi_projects')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Project delete error:', error);
    return NextResponse.json(
      { error: 'Failed to delete project', details: error.message },
      { status: 500 }
    );
  }
}
