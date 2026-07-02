/**
 * Shared BOQ-generation logic. Used by:
 *   - POST /api/projects/[id]/boq (manual trigger)
 *   - POST /api/projects/[id]/gate (auto-trigger after gate 20 approval,
 *     as the second half of the yardstick→BOQ chain)
 *
 * Generates the Excel BOQ, uploads to Supabase Storage, persists the URL,
 * and transitions the project into send_pending (gate 23).
 */

import { supabaseAdmin } from '@/lib/storage/supabase';
import { logActivity } from '@/lib/storage/activity-logger';
import { generateBOQ } from '@/lib/pipeline/boq-generator';

export type RunBoqResult =
  | { ok: true; filename: string; storagePath: string; size: number }
  | { ok: false; httpStatus: number; error: string; details?: string };

export async function runBoqGeneration(projectId: string): Promise<RunBoqResult> {
  try {
    const [projectRes, servicesRes, estRes, attRes] = await Promise.all([
      supabaseAdmin.from('sabi_projects').select('*').eq('id', projectId).single(),
      supabaseAdmin.from('sabi_services').select('*').eq('project_id', projectId).eq('is_required', true),
      supabaseAdmin.from('sabi_estimations').select('*').eq('project_id', projectId).limit(1).single(),
      supabaseAdmin.from('sabi_attachments').select('*').eq('project_id', projectId),
    ]);

    if (projectRes.error || !projectRes.data) {
      return { ok: false, httpStatus: 404, error: 'Project not found' };
    }

    const project = projectRes.data;
    const services = servicesRes.data || [];
    let estimation = estRes.data;
    const attachments = attRes.data || [];

    // Reconcile estimation totals with current service values so the BOQ
    // never uses a stale final_quote_aed from an earlier estimation run.
    if (estimation) {
      const freshSubtotal = services
        .filter((s: { is_required: boolean; total_aed: number | null }) => s.is_required && s.total_aed)
        .reduce((sum: number, s: { total_aed: number | null }) => sum + (s.total_aed || 0), 0);

      if (freshSubtotal > 0 && Math.abs(freshSubtotal - (estimation.total_aed || 0)) > 1) {
        const margin = estimation.margin_percent || 15;
        estimation.total_aed = freshSubtotal;
        estimation.final_quote_aed = freshSubtotal * (1 + margin / 100);
        estimation.cost_per_sqft_aed = (project.total_area_sqft || 0) > 0
          ? freshSubtotal / project.total_area_sqft
          : estimation.cost_per_sqft_aed;

        // Persist the corrected totals so downstream steps (send-quote) also
        // see accurate numbers.
        await supabaseAdmin
          .from('sabi_estimations')
          .update({
            total_aed: estimation.total_aed,
            final_quote_aed: estimation.final_quote_aed,
            cost_per_sqft_aed: estimation.cost_per_sqft_aed,
            updated_at: new Date().toISOString(),
          })
          .eq('id', estimation.id);
      }
    }

    // Synthesize an estimation row from service totals if none exists yet.
    if (!estimation) {
      const requiredServices = services.filter((s: { is_required: boolean; total_aed: number | null }) => s.is_required && s.total_aed);
      if (requiredServices.length === 0) {
        // Detailed-electrical path doesn't populate total_aed (pricing flows
        // through Gate 12 → 12-section Power BOQ PDF instead). Direct the
        // user to the right artifact rather than telling them to "run
        // estimation" — the estimation already ran.
        const hasElectricalExtraction = services.some(
          (s: { ai_extraction?: Record<string, unknown> | null }) =>
            (s.ai_extraction as Record<string, unknown> | undefined)?.raw_electrical_procedure
        );
        const error = hasElectricalExtraction
          ? 'Detailed electrical extraction is complete but the Excel BOQ requires per-service pricing. Use "Download BOQ (PDF)" — it renders the 12-section Power BOQ from the cable schedule. (Or approve Gate 12 to persist the PDF and unlock Phase 4.)'
          : 'No services with pricing found. Run estimation first to populate service totals.';
        return {
          ok: false,
          httpStatus: 400,
          error,
        };
      }

      const subtotal = requiredServices.reduce(
        (sum: number, s: { total_aed: number | null }) => sum + (s.total_aed || 0),
        0
      );
      const marginPct = 15;
      const finalQuote = subtotal * (1 + marginPct / 100);
      const area = project.total_area_sqft || 1;

      estimation = {
        id: 'synthetic',
        project_id: projectId,
        total_aed: subtotal,
        cost_per_sqft_aed: subtotal / area,
        margin_percent: marginPct,
        final_quote_aed: finalQuote,
        george_approved: false,
        approved_at: null,
        yardstick_status: null,
        yardstick_min_aed: null,
        yardstick_max_aed: null,
        generated_boq_url: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as typeof estimation;
    }

    await logActivity(projectId, 22, 'Prepare Quotation', 'started');

    let buffer: Buffer;
    try {
      buffer = await generateBOQ(project, services, estimation, attachments);
    } catch (genErr: unknown) {
      const message = genErr instanceof Error ? genErr.message : 'BOQ generator crashed';
      const stack = genErr instanceof Error ? genErr.stack : undefined;
      console.error('BOQ generator threw:', message, stack);
      await logActivity(projectId, 22, 'Prepare Quotation', 'failed', {
        error: `BOQ generator crashed: ${message}`,
        stack: stack?.substring(0, 500),
      });
      return { ok: false, httpStatus: 500, error: 'BOQ generation failed', details: message };
    }

    const projectName = (project.project_name || 'project').replace(/[^a-zA-Z0-9]/g, '_');
    const date = new Date().toISOString().split('T')[0];
    const filename = `BOQ_${projectName}_${date}.xlsx`;
    const storagePath = `boq/${projectId}/${filename}`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from('sabi-attachments')
      .upload(storagePath, buffer, {
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        upsert: true,
      });

    if (uploadError) {
      console.error('Storage upload error:', uploadError);
      await logActivity(projectId, 22, 'Prepare Quotation', 'failed', {
        error: `Storage upload failed: ${uploadError.message}`,
        filename,
      });
      return {
        ok: false,
        httpStatus: 500,
        error: 'BOQ generated but upload to storage failed. Please retry.',
        details: uploadError.message,
      };
    }

    if (estimation.id === 'synthetic') {
      await supabaseAdmin.from('sabi_estimations').insert({
        project_id: projectId,
        total_aed: estimation.total_aed,
        cost_per_sqft_aed: estimation.cost_per_sqft_aed,
        margin_percent: estimation.margin_percent,
        final_quote_aed: estimation.final_quote_aed,
        generated_boq_url: storagePath,
        updated_at: new Date().toISOString(),
      });
    } else {
      await supabaseAdmin
        .from('sabi_estimations')
        .update({
          generated_boq_url: storagePath,
          updated_at: new Date().toISOString(),
        })
        .eq('id', estimation.id);
    }

    await logActivity(projectId, 31, 'Prepare Quotation', 'completed', {
      filename,
      storage_path: storagePath,
      size_bytes: buffer.length,
    });

    // Transition to Gate 33 (Consent Received?) — 33-step pipeline
    await supabaseAdmin
      .from('sabi_projects')
      .update({
        status: 'send_pending',
        notes: JSON.stringify({ approval_gate: 33 }),
        updated_at: new Date().toISOString(),
      })
      .eq('id', projectId);

    await logActivity(projectId, 33, 'Consent Received?', 'started', {
      message: 'Awaiting consent: Review the quotation and give consent to send to client.',
      boq_filename: filename,
    });

    return { ok: true, filename, storagePath, size: buffer.length };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('BOQ generation error:', message);
    await logActivity(projectId, 31, 'Prepare Quotation', 'failed', { error: message });
    return { ok: false, httpStatus: 500, error: 'BOQ generation failed', details: message };
  }
}
