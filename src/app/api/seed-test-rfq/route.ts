/**
 * POST /api/seed-test-rfq
 *
 * One-click test RFQ seeder for demos. Creates a synthetic project, uploads
 * the fixture attachments from /test-files/, and runs the pipeline through
 * steps 1-5 so the project lands at gate 6 (Document Sufficiency) with the
 * live StepTimeline animating every step.
 *
 * Body (optional): { template?: 'al_reem' }
 *
 * Returns: { project_id, status, gate, url }
 *
 * Guards:
 *   - requireAuth (same as all other routes)
 *   - NODE_ENV=production blocks unless ALLOW_SEED_TEST_RFQ=true is set
 *
 * Design notes:
 *   - Storage path is deterministic per template (`test-rfq/{template}/`) and
 *     uses upsert, so repeated seeds don't bloat the bucket.
 *   - Attachment DB rows are per-project (they point to the shared storage
 *     path) so each project still has its own sabi_attachments rows.
 *   - Test projects are tagged with `is_test: true` in the notes JSON so they
 *     can be filtered out of normal bid-list views.
 *   - The fallback_project metadata is patched onto the project if extraction
 *     returns empty — this keeps gate 6 meaningful even when the stub fixture
 *     PDFs don't yield real numbers.
 */

import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { logActivity } from '@/lib/storage/activity-logger';
import { requireAuth } from '@/lib/shared/api-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface FixtureAttachment {
  filename: string;
  mime_type: string;
  file_type: string;
  discipline: string | null;
}

interface Fixture {
  template_id: string;
  display_name: string;
  email_from: string;
  email_subject: string;
  email_snippet: string;
  fallback_project: {
    client_name: string;
    project_name: string;
    location: string;
    building_type: string;
    floors: number;
    parking_floors: number;
    typical_floors: number;
    area_per_floor_sqft: number;
    total_area_sqft: number;
    typical_height_m: number;
    priority: string;
  };
  fallback_services: Array<{
    service_type: string;
    is_required: boolean;
    system_type?: string;
    notes?: string;
  }>;
  attachments: FixtureAttachment[];
}

function loadFixture(templateId: string): Fixture {
  const safe = templateId.replace(/[^a-z0-9_]/gi, '');
  const path = join(process.cwd(), 'test-fixtures', `test-rfq-${safe}.json`);
  const raw = readFileSync(path, 'utf8');
  return JSON.parse(raw) as Fixture;
}

export async function POST(request: NextRequest) {
  // Production guard
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.ALLOW_SEED_TEST_RFQ !== 'true'
  ) {
    return NextResponse.json(
      { error: 'Test RFQ seeder is disabled in production' },
      { status: 404 }
    );
  }

  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  let template = 'al_reem';
  try {
    const body = await request.json();
    if (body?.template) template = String(body.template);
  } catch {
    // empty body is fine
  }

  let fixture: Fixture;
  try {
    fixture = loadFixture(template);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to load fixture';
    return NextResponse.json(
      { error: `Unknown template "${template}"`, details: msg },
      { status: 400 }
    );
  }

  const startedAt = Date.now();
  let projectId: string | null = null;

  try {
    // ---- 1. Create the project row ----
    const uniqueSuffix = Math.random().toString(36).slice(2, 7);
    const notes = JSON.stringify({
      is_test: true,
      template,
      seeded_at: new Date().toISOString(),
    });

    const { data: created, error: createErr } = await supabaseAdmin
      .from('sabi_projects')
      .insert({
        email_from: fixture.email_from,
        email_subject: `${fixture.email_subject} [TEST ${uniqueSuffix}]`,
        email_snippet: fixture.email_snippet,
        email_date: new Date().toISOString(),
        status: 'new',
        priority: fixture.fallback_project.priority,
        notes,
      })
      .select('id')
      .single();

    if (createErr || !created) {
      throw new Error(
        `Failed to create project: ${createErr?.message || 'unknown'}`
      );
    }
    projectId = created.id;
    const pid: string = projectId as string;

    await logActivity(pid, 1, 'Read Email', 'completed', {
      to: 'estimation@realsoft.example',
      from: fixture.email_from,
      subject: fixture.email_subject,
      is_test: true,
    });

    // ---- 2. Upload fixture attachments & register them ----
    await logActivity(pid, 2, 'Register New Enquiry', 'started');
    const uploadedPaths: Array<{ filename: string; storage_path: string; size: number }> = [];

    for (const att of fixture.attachments) {
      const localPath = join(process.cwd(), 'test-files', att.filename);
      let buf: Buffer;
      try {
        buf = readFileSync(localPath);
      } catch {
        console.warn(`[seed-test-rfq] missing fixture: ${att.filename} — skipping`);
        continue;
      }

      // Shared storage path per template: repeated seeds don't bloat storage
      const storagePath = `test-rfq/${template}/${att.filename}`;
      const { error: uploadErr } = await supabaseAdmin.storage
        .from('sabi-attachments')
        .upload(storagePath, buf, {
          contentType: att.mime_type,
          upsert: true,
        });

      if (uploadErr) {
        console.warn(`[seed-test-rfq] upload failed for ${att.filename}: ${uploadErr.message}`);
        continue;
      }

      await supabaseAdmin.from('sabi_attachments').insert({
        project_id: projectId,
        filename: att.filename,
        mime_type: att.mime_type,
        size_bytes: buf.length,
        file_type: att.file_type,
        discipline: att.discipline,
        storage_path: storagePath,
      });

      uploadedPaths.push({ filename: att.filename, storage_path: storagePath, size: buf.length });
    }

    await logActivity(pid, 2, 'Register New Enquiry', 'completed', {
      keywords_found: ['RFQ', 'Please quote', 'best price', 'quotation'],
      is_rfq: true,
    });

    // ---- 3. Add to Bid List ----
    await logActivity(pid, 3, 'Open Tender Folder', 'completed', {
      attachment_count: uploadedPaths.length,
      total_size: uploadedPaths.reduce((sum, a) => sum + a.size, 0),
    });

    // ---- 4. Chain into classify route ----
    const appUrl = request.nextUrl.origin;
    const authToken = request.cookies.get('auth-token')?.value;
    const internalHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (authToken) internalHeaders['Cookie'] = `auth-token=${authToken}`;

    const classifyRes = await fetch(
      `${appUrl}/api/projects/${projectId}/classify`,
      { method: 'POST', headers: internalHeaders }
    );
    if (!classifyRes.ok) {
      const detail = await classifyRes.text().catch(() => '');
      throw new Error(`classify failed: ${classifyRes.status} ${detail.slice(0, 200)}`);
    }

    // Force priority to fallback (classify may have marked as 'ignore' because
    // the sender domain is .example — we don't want the demo to get filtered).
    await supabaseAdmin
      .from('sabi_projects')
      .update({ priority: fixture.fallback_project.priority })
      .eq('id', projectId);

    // ---- 5. Chain into extract route ----
    // extract handles steps 4 (Unzip), 5 (List Drawings & BOQ), 8 (Extract
    // Project Info), and auto-advances status to scope_pending + gate 6
    // (the 5-gate pipeline's first pause — Document Sufficiency).
    const extractRes = await fetch(
      `${appUrl}/api/projects/${projectId}/extract`,
      { method: 'POST', headers: internalHeaders }
    );
    if (!extractRes.ok) {
      const detail = await extractRes.text().catch(() => '');
      throw new Error(`extract failed: ${extractRes.status} ${detail.slice(0, 200)}`);
    }

    // ---- 6. Patch fallback project metadata if extraction came up empty ----
    // The fixture PDFs are tiny stubs — vision won't extract real floor
    // counts. Patch the project row with known-good values so gate 6 is
    // meaningful, but only touch fields that are still null.
    const { data: postExtract } = await supabaseAdmin
      .from('sabi_projects')
      .select('*')
      .eq('id', projectId)
      .single();

    if (postExtract) {
      const fb = fixture.fallback_project;
      const patch: Record<string, unknown> = {};
      if (!postExtract.client_name) patch.client_name = fb.client_name;
      if (!postExtract.project_name) patch.project_name = fb.project_name;
      if (!postExtract.location) patch.location = fb.location;
      if (!postExtract.building_type) patch.building_type = fb.building_type;
      if (!postExtract.floors) patch.floors = fb.floors;
      if (!postExtract.parking_floors) patch.parking_floors = fb.parking_floors;
      if (!postExtract.typical_floors) patch.typical_floors = fb.typical_floors;
      if (!postExtract.area_per_floor_sqft) patch.area_per_floor_sqft = fb.area_per_floor_sqft;
      if (!postExtract.total_area_sqft) patch.total_area_sqft = fb.total_area_sqft;
      if (!postExtract.typical_height_m) patch.typical_height_m = fb.typical_height_m;

      if (Object.keys(patch).length > 0) {
        await supabaseAdmin.from('sabi_projects').update(patch).eq('id', projectId);
      }
    }

    // Restore the is_test marker in notes — extract overwrites notes with
    // {approval_gate: 11}, so we re-merge after the chain completes. Keeps
    // the gate marker AND the test-project lineage hint.
    {
      const { data: post } = await supabaseAdmin
        .from('sabi_projects')
        .select('notes')
        .eq('id', projectId)
        .single();
      const currentNotes = (() => {
        try { return post?.notes ? JSON.parse(post.notes) : {}; } catch { return {}; }
      })();
      await supabaseAdmin
        .from('sabi_projects')
        .update({
          notes: JSON.stringify({
            ...currentNotes,
            is_test: true,
            template,
            seeded_at: new Date().toISOString(),
          }),
        })
        .eq('id', projectId);
    }

    // ---- 7. Ensure services are populated (fallback) ----
    const { data: existingServices } = await supabaseAdmin
      .from('sabi_services')
      .select('service_type')
      .eq('project_id', projectId);

    const existingSet = new Set((existingServices || []).map((s: { service_type: string }) => s.service_type));
    const servicesToSeed = fixture.fallback_services.filter(
      (s) => !existingSet.has(s.service_type)
    );

    if (servicesToSeed.length > 0) {
      await supabaseAdmin.from('sabi_services').insert(
        servicesToSeed.map((s) => ({
          project_id: projectId,
          service_type: s.service_type,
          is_required: s.is_required,
          system_type: s.system_type || null,
          notes: s.notes || null,
        }))
      );
    }

    // ---- 8. Return summary ----
    // Read final project state from DB so the response reflects reality (the
    // extract route pauses at gate 6 in the 5-gate model).
    const { data: finalProject } = await supabaseAdmin
      .from('sabi_projects')
      .select('status, notes')
      .eq('id', projectId)
      .single();

    let finalGate: number | null = null;
    try {
      const n = finalProject?.notes ? JSON.parse(finalProject.notes) : {};
      finalGate = n.approval_gate ?? null;
    } catch { /* notes not JSON */ }

    const durationMs = Date.now() - startedAt;
    return NextResponse.json({
      project_id: projectId,
      status: finalProject?.status || 'unknown',
      gate: finalGate,
      duration_ms: durationMs,
      attachments_uploaded: uploadedPaths.length,
      url: `${appUrl}/bids/${projectId}`,
      message: 'Test RFQ seeded. Open the URL to watch the StepTimeline and approve gates 6 → 10 → 16 → 20 → 23.',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[seed-test-rfq] failed:', message);

    // Rollback: delete the project if we got far enough to create one.
    // Cascades will clean up attachments + activity log.
    if (projectId) {
      await supabaseAdmin.from('sabi_projects').delete().eq('id', projectId);
    }

    return NextResponse.json(
      { error: 'Seed failed', details: message },
      { status: 500 }
    );
  }
}
