/**
 * GET /api/projects/[id]/lineage
 *
 * Returns the field-level lineage map for a project. Reads existing data
 * (sabi_projects + sabi_services + sabi_attachments + sabi_activity_log) and
 * derives the source of every meaningful field via lib/lineage.ts.
 *
 * Response shape:
 *   {
 *     project: Record<field, LineageEntry>,
 *     services: Array<{ id, service_type, lineage }>,
 *   }
 *
 * No DB writes. Cheap, deterministic, safe to call on every page render.
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

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = params;

  const [projectRes, servicesRes, attachmentsRes, logsRes] = await Promise.all([
    supabaseAdmin.from('sabi_projects').select('*').eq('id', id).single(),
    supabaseAdmin.from('sabi_services').select('*').eq('project_id', id),
    supabaseAdmin.from('sabi_attachments').select('*').eq('project_id', id),
    supabaseAdmin
      .from('sabi_activity_log')
      .select('*')
      .eq('project_id', id)
      .order('created_at', { ascending: true }),
  ]);

  if (projectRes.error || !projectRes.data) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  const project = projectRes.data as Project;
  const services = (servicesRes.data || []) as Service[];
  const attachments = (attachmentsRes.data || []) as Attachment[];
  const activityLog = (logsRes.data || []) as ActivityLog[];

  const projectLineage = deriveProjectLineage({ project, services, attachments, activityLog });

  const serviceLineages = services.map((s) => ({
    id: s.id,
    service_type: s.service_type,
    lineage: deriveServiceLineage(s, attachments),
  }));

  const attachmentLineages = attachments.map((a) => ({
    id: a.id,
    filename: a.filename,
    lineage: deriveAttachmentLineage(a),
  }));

  return NextResponse.json({
    project_id: id,
    project: projectLineage,
    services: serviceLineages,
    spec: deriveSpecLineage(project),
    attachments: attachmentLineages,
    boq: deriveBoqLineage(project, services),
  });
}
