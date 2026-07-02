import { supabaseAdmin } from '@/lib/storage/supabase';
import { ActivityStatus, ProjectStatus } from '@/lib/shared/types';

export async function logActivity(
  projectId: string,
  step: number,
  stepName: string,
  status: ActivityStatus,
  details?: Record<string, unknown>,
  subPipeline?: string | null,
): Promise<void> {
  const { error } = await supabaseAdmin.from('sabi_activity_log').insert({
    project_id: projectId,
    step,
    step_name: stepName,
    status,
    details: details || null,
    sub_pipeline: subPipeline ?? null,
  });

  if (error) {
    console.error(`Activity log error (step ${step}):`, error);
  }
}

export async function updateProjectStatus(
  projectId: string,
  status: ProjectStatus
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('sabi_projects')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', projectId);

  if (error) {
    console.error(`Project status update error:`, error);
    throw error;
  }
}
