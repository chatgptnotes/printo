/**
 * Sends the quotation email to the client. Used by:
 *   - POST /api/projects/[id]/send-quote (manual trigger from UI)
 *   - POST /api/projects/[id]/gate (auto-trigger after gate 23 approval)
 *
 * Returns a discriminated union — never throws unless something is truly broken.
 * The caller decides how to surface the result.
 */

import { supabaseAdmin } from '@/lib/storage/supabase';
import { logActivity, updateProjectStatus } from '@/lib/storage/activity-logger';
import { replyToThread } from '@/lib/email/gmail';
import { generateBOQPDF } from '@/lib/pdf/boq-pdf-generator';
import { buildPersonalizedNote } from '@/lib/email/quotation-personalization';
import type { Project, Service, Estimation, Attachment } from '@/lib/shared/types';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export type SendQuotationResult =
  | { ok: true; sent_at: string; sent_to: string }
  | { ok: false; status: number; error: string };

export async function sendQuotation(projectId: string): Promise<SendQuotationResult> {
  try {
    // 1. Fetch project + estimation + services + attachments (services and
    // attachments are needed by the PDF generator so the client receives a
    // self-contained quotation document with per-service line-item breakdowns).
    const [projectRes, estRes, servicesRes, attachmentsRes] = await Promise.all([
      supabaseAdmin.from('sabi_projects').select('*').eq('id', projectId).single(),
      supabaseAdmin.from('sabi_estimations').select('*').eq('project_id', projectId).limit(1).single(),
      supabaseAdmin.from('sabi_services').select('*').eq('project_id', projectId),
      supabaseAdmin.from('sabi_attachments').select('*').eq('project_id', projectId),
    ]);

    if (projectRes.error || !projectRes.data) {
      return { ok: false, status: 404, error: 'Project not found' };
    }
    if (estRes.error || !estRes.data) {
      return { ok: false, status: 400, error: 'No estimation found for this project' };
    }

    const project = projectRes.data as Project;
    const estimation = estRes.data as Estimation;
    const services = (servicesRes.data || []) as Service[];
    const attachments = (attachmentsRes.data || []) as Attachment[];

    // 2. Pre-flight checks
    // Idempotency: if this project has already been sent, don't send again.
    // Gate auto-trigger + manual send-quote button can both land here; without
    // this guard, double-clicks produce duplicate client emails.
    if (project.status === 'sent' || estimation.sent_at) {
      return {
        ok: false,
        status: 409,
        error: 'Quotation has already been sent for this project',
      };
    }
    if (!estimation?.george_approved) {
      return { ok: false, status: 400, error: 'Quotation must be approved before sending' };
    }
    if (!estimation.generated_boq_url) {
      return { ok: false, status: 400, error: 'No BOQ generated. Generate BOQ first.' };
    }
    if (!project.email_thread_id) {
      await logActivity(projectId, 15, 'Consent Received & Send', 'failed', {
        error: 'No email thread ID — cannot reply to client',
      });
      return {
        ok: false,
        status: 400,
        error: 'No email thread linked to this project. Cannot send quotation.',
      };
    }
    if (!project.email_from) {
      return { ok: false, status: 400, error: 'No client email address on this project.' };
    }

    await logActivity(projectId, 15, 'Consent Received & Send', 'started');

    // 3. Download BOQ (XLSX) from storage
    let boqBuffer: Buffer;
    let boqFilename: string;
    try {
      const { data: boqFile, error: dlErr } = await supabaseAdmin.storage
        .from('sabi-attachments')
        .download(estimation.generated_boq_url);
      if (dlErr || !boqFile) {
        throw new Error(dlErr?.message || 'BOQ file not found in storage');
      }
      boqBuffer = Buffer.from(await boqFile.arrayBuffer());
      boqFilename = estimation.generated_boq_url.split('/').pop() || 'BOQ.xlsx';
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'BOQ download failed';
      console.error('[send-quotation] BOQ download failed:', message);
      await logActivity(projectId, 15, 'Consent Received & Send', 'failed', {
        error: `BOQ download failed: ${message}`,
      });
      return {
        ok: false,
        status: 500,
        error: `BOQ download failed: ${message}. Try regenerating the BOQ.`,
      };
    }

    // 3b. Generate the client-facing PDF quotation on the fly. George's rule
    // (demo 2026-04-16, pg 37–38): client receives PDF only. Excel stays
    // internal — released only on explicit post-order request. If PDF
    // generation fails, we FAIL THE SEND — we do NOT silently substitute the
    // Excel, which would contradict the client-facing contract.
    let pdfBuffer: Buffer;
    let pdfFilename: string;
    try {
      pdfBuffer = await generateBOQPDF(project, services, estimation, attachments);
      pdfFilename = boqFilename.replace(/\.xlsx?$/i, '.pdf');
      if (pdfFilename === boqFilename) {
        pdfFilename = `${boqFilename}.pdf`;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'PDF generation failed';
      console.error('[send-quotation] PDF generation failed — send blocked:', message);
      await logActivity(projectId, 15, 'Consent Received & Send', 'failed', {
        error: `PDF generation failed: ${message}`,
        note: 'Client-facing send requires a PDF. Excel is internal-only per George (demo 2026-04-16, pg 37–38).',
      });
      return {
        ok: false,
        status: 500,
        error: `Cannot send: PDF generation failed (${message}). Excel is internal-only and will not be emailed to the client. Fix the PDF generator or regenerate manually before retrying.`,
      };
    }

    // 4. Send the reply via Gmail API
    const quoteAmount = estimation.final_quote_aed
      ? `AED ${Number(estimation.final_quote_aed).toLocaleString()}`
      : 'as per attached quotation';

    // PDF only to the client. The Excel BOQ stays in company records and may
    // be released after order on explicit request (George's rule, pg 37–38).
    const emailAttachments: Array<{ buffer: Buffer; filename: string; mimeType: string }> = [
      {
        buffer: pdfBuffer,
        filename: pdfFilename,
        mimeType: 'application/pdf',
      },
    ];
    // boqBuffer is intentionally retained in memory but NOT attached — the
    // buffer is still downloaded for auditing that it exists, and we reference
    // it in the activity log below.

    // Build the personalized thank-you note (single source of truth shared with PDF cover letter)
    const note = buildPersonalizedNote(project, services, estimation);

    const attachmentSentence =
      'Our quotation is attached as a <strong>PDF</strong> for your review.';

    const yardstickHtml = note.yardstickLine
      ? `<p style="margin: 0 0 14px;">${escapeHtml(note.yardstickLine)}</p>`
      : '';

    const emailBody = `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #1a202c; line-height: 1.6; max-width: 640px;">
  <p style="margin: 0 0 14px;">${escapeHtml(note.greeting)}</p>

  <p style="margin: 0 0 14px;">${escapeHtml(note.opening)}</p>

  <p style="margin: 0 0 14px;">${escapeHtml(note.scopeLine)}</p>

  <p style="margin: 0 0 14px;">${escapeHtml(note.projectContextLine)}</p>

  ${yardstickHtml}

  <p style="margin: 0 0 14px;">${attachmentSentence}</p>

  <table cellpadding="0" cellspacing="0" border="0" style="background:#1E3A5F; border-radius:6px; margin: 4px 0 18px;">
    <tr>
      <td style="padding: 14px 22px; color:#FFFFFF; font-size:13px; font-family: Arial, Helvetica, sans-serif;">
        <div style="font-size:11px; letter-spacing:1px; color:#A8B8CC; text-transform:uppercase;">Quoted Amount</div>
        <div style="font-size:20px; font-weight:bold; margin-top:4px;">${quoteAmount}</div>
        <div style="font-size:11px; color:#A8B8CC; margin-top:4px;">Inclusive of 5% VAT</div>
      </td>
    </tr>
  </table>

  <p style="margin: 0 0 18px;">${escapeHtml(note.closing)}</p>

  <p style="margin: 0 0 4px;">Yours sincerely,</p>
  <p style="margin: 18px 0 2px; font-weight: bold; color: #1E3A5F;">${escapeHtml(note.signatureName)}</p>
  <p style="margin: 0; color: #5B6470; font-size: 12px;">${escapeHtml(note.signatureTitle)}</p>
  <p style="margin: 2px 0 0; color: #5B6470; font-size: 12px;">ERP Realsoft</p>
</div>`;

    try {
      await replyToThread({
        threadId: project.email_thread_id,
        to: project.email_from,
        subject: note.emailSubject,
        body: emailBody,
        attachments: emailAttachments,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Gmail send failed';
      console.error('[send-quotation] Gmail replyToThread failed:', message);
      await logActivity(projectId, 15, 'Consent Received & Send', 'failed', {
        error: `Gmail send failed: ${message}`,
      });
      return {
        ok: false,
        status: 500,
        error: `Gmail send failed: ${message}`,
      };
    }

    // 5. Mark estimation as sent + update project status
    const now = new Date().toISOString();
    await supabaseAdmin
      .from('sabi_estimations')
      .update({ sent_at: now, updated_at: now })
      .eq('id', estimation.id);

    await updateProjectStatus(projectId, 'sent');
    await logActivity(projectId, 15, 'Consent Received & Send', 'completed', {
      sent_to: project.email_from,
      sent_at: now,
      pdf_filename: pdfFilename,
      internal_boq_file: estimation.generated_boq_url, // Excel retained internally, not emailed
      bytes_pdf: pdfBuffer.length,
      bytes_excel_internal: boqBuffer.length,
    });

    return { ok: true, sent_at: now, sent_to: project.email_from };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[send-quotation] unhandled error:', message);
    await logActivity(projectId, 15, 'Consent Received & Send', 'failed', { error: message });
    return { ok: false, status: 500, error: message };
  }
}
