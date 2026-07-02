/**
 * POST /api/projects/lineage/batch
 *
 * Returns lineage maps for many projects in a single request. Used by the
 * Bid List page to show source chips on every row without firing 200
 * separate /lineage requests.
 *
 * Body: { project_ids: string[] }   (max 500 per call)
 *
 * Response: {
 *   [project_id]: LineagePayload    (same shape as GET /api/projects/[id]/lineage)
 * }
 *
 * Performance: one parallel fan-out per table (projects, services, attachments,
 * activity_log) filtered by `IN (...)`. ~150ms for 200 projects.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { requireAuth } from '@/lib/shared/api-auth';
import {
  deriveProjectLineage,
  deriveServiceLineage,
  deriveSpecLineage,
  deriveAttachmentLineage,
  deriveBoqLineage,
} from '@/lib/pipeline/lineage';
import type { Project, Service, Attachment, ActivityLog } from '@/lib/shared/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MAX_BATCH = 500;

export async function POST(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  let body: { project_ids?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const ids = (body.project_ids || []).filter(
    (id): id is string => typeof id === 'string' && id.length > 0
  );

  if (ids.length === 0) {
    return NextResponse.json({});
  }
  if (ids.length > MAX_BATCH) {
    return NextResponse.json(
      { error: `Too many project_ids — max ${MAX_BATCH}` },
      { status: 400 }
    );
  }

  // Fan out four parallel queries filtered by IN (...)
  const [projectsRes, servicesRes, attachmentsRes, logsRes] = await Promise.all([
    supabaseAdmin.from('sabi_projects').select('*').in('id', ids),
    supabaseAdmin.from('sabi_services').select('*').in('project_id', ids),
    supabaseAdmin.from('sabi_attachments').select('*').in('project_id', ids),
    supabaseAdmin
      .from('sabi_activity_log')
      .select('*')
      .in('project_id', ids)
      .order('created_at', { ascending: true }),
  ]);

  if (projectsRes.error) {
    return NextResponse.json(
      { error: 'Failed to load projects', details: projectsRes.error.message },
      { status: 500 }
    );
  }

  const projects = (projectsRes.data || []) as Project[];
  const allServices = (servicesRes.data || []) as Service[];
  const allAttachments = (attachmentsRes.data || []) as Attachment[];
  const allLogs = (logsRes.data || []) as ActivityLog[];

  // Group children by project_id
  const servicesByProject = new Map<string, Service[]>();
  for (const s of allServices) {
    const arr = servicesByProject.get(s.project_id) || [];
    arr.push(s);
    servicesByProject.set(s.project_id, arr);
  }

  const attachmentsByProject = new Map<string, Attachment[]>();
  for (const a of allAttachments) {
    const arr = attachmentsByProject.get(a.project_id) || [];
    arr.push(a);
    attachmentsByProject.set(a.project_id, arr);
  }

  const logsByProject = new Map<string, ActivityLog[]>();
  for (const l of allLogs) {
    const arr = logsByProject.get(l.project_id) || [];
    arr.push(l);
    logsByProject.set(l.project_id, arr);
  }

  // Build lineage payload per project
  const result: Record<string, unknown> = {};

  for (const project of projects) {
    const services = servicesByProject.get(project.id) || [];
    const attachments = attachmentsByProject.get(project.id) || [];
    const activityLog = logsByProject.get(project.id) || [];

    result[project.id] = {
      project_id: project.id,
      project: deriveProjectLineage({ project, services, attachments, activityLog }),
      services: services.map((s) => ({
        id: s.id,
        service_type: s.service_type,
        lineage: deriveServiceLineage(s, attachments),
      })),
      spec: deriveSpecLineage(project),
      attachments: attachments.map((a) => ({
        id: a.id,
        filename: a.filename,
        lineage: deriveAttachmentLineage(a),
      })),
      boq: deriveBoqLineage(project, services),
    };
  }

  return NextResponse.json(result);
}
