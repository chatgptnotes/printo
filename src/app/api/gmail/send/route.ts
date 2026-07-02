import { NextRequest, NextResponse } from 'next/server';
import { sendEmail, replyToThread } from '@/lib/email/gmail';
import { logActivity } from '@/lib/storage/activity-logger';
import { requireAuth } from '@/lib/shared/api-auth';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { generateBOQPDF } from '@/lib/pdf/boq-pdf-generator';
import type { Project, Service, Estimation, Attachment } from '@/lib/shared/types';

export const dynamic = 'force-dynamic';

// POST: Send an email
export async function POST(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json();
    const { to, subject, body: emailBody, cc, attachmentUrl, attachBoqPdf, extraAttachments, threadId, projectId, templateUsed } = body;

    if (!to || !subject || !emailBody) {
      return NextResponse.json(
        { error: 'Missing required fields: to, subject, body' },
        { status: 400 }
      );
    }

    // Resolve attachmentUrl: if it's a Supabase storage path (e.g. "boq/abc/file.xlsx"),
    // download it into a Buffer. If it's already an http(s):// URL, pass through unchanged.
    let attachmentBuffer: Buffer | undefined;
    let attachmentFilename: string | undefined;
    let attachmentMimeType: string | undefined;
    let resolvedAttachmentUrl: string | undefined;

    if (attachmentUrl) {
      if (/^https?:\/\//i.test(attachmentUrl)) {
        // Real HTTP URL — let replyToThread/sendEmail fetch it directly
        resolvedAttachmentUrl = attachmentUrl;
      } else {
        // Treat as Supabase storage path
        try {
          const { data: file, error: dlErr } = await supabaseAdmin.storage
            .from('sabi-attachments')
            .download(attachmentUrl);
          if (dlErr || !file) {
            throw new Error(dlErr?.message || 'File not found in storage');
          }
          attachmentBuffer = Buffer.from(await file.arrayBuffer());
          const fname = attachmentUrl.split('/').pop() || 'attachment';
          attachmentFilename = fname;
          // Guess mime type from extension
          if (fname.endsWith('.xlsx')) {
            attachmentMimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
          } else if (fname.endsWith('.pdf')) {
            attachmentMimeType = 'application/pdf';
          } else if (fname.endsWith('.docx')) {
            attachmentMimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
          } else {
            attachmentMimeType = 'application/octet-stream';
          }
        } catch (err: any) {
          console.error('Failed to download attachment from storage:', err.message);
          return NextResponse.json(
            { error: 'Failed to fetch attachment', details: err.message },
            { status: 500 }
          );
        }
      }
    }

    // User-uploaded attachments arrive as Supabase Storage paths (browser
    // PUT'd them directly via the presigned-URL flow). Download each one
    // server-side so we can attach the bytes to the outgoing multipart email.
    const userAttachments: Array<{ buffer: Buffer; filename: string; mimeType: string }> = [];
    if (Array.isArray(extraAttachments) && extraAttachments.length > 0) {
      for (const a of extraAttachments) {
        if (!a || !a.filename || typeof a.storagePath !== 'string') continue;
        const { data: file, error: dlErr } = await supabaseAdmin.storage
          .from('sabi-attachments')
          .download(a.storagePath);
        if (dlErr || !file) {
          console.error(`Failed to download reply attachment ${a.storagePath}:`, dlErr?.message);
          continue;
        }
        userAttachments.push({
          buffer: Buffer.from(await file.arrayBuffer()),
          filename: String(a.filename),
          mimeType: String(a.mimeType || 'application/octet-stream'),
        });
      }
    }

    // PDF BOQ — generated on the fly from project data when the modal asks for it.
    // Non-fatal: pdfkit throws ENOENT for .afm fonts on Vercel's serverless layout
    // (see app/api/projects/[id]/boq/pdf/route.ts for the standalone fallback), and
    // we'd rather ship the email with the Excel + user files than fail the entire
    // send because the polished PDF couldn't be rendered. Failures are logged.
    if (attachBoqPdf && projectId) {
      try {
        const [pRes, eRes, sRes, aRes] = await Promise.all([
          supabaseAdmin.from('sabi_projects').select('*').eq('id', projectId).single(),
          supabaseAdmin.from('sabi_estimations').select('*').eq('project_id', projectId).limit(1).single(),
          supabaseAdmin.from('sabi_services').select('*').eq('project_id', projectId).eq('is_required', true),
          supabaseAdmin.from('sabi_attachments').select('*').eq('project_id', projectId),
        ]);

        if (pRes.error || !pRes.data) {
          throw new Error(pRes.error?.message || 'Project not found');
        }
        if (eRes.error || !eRes.data) {
          throw new Error('Estimation not found — generate the BOQ first');
        }

        const pdfBuffer = await generateBOQPDF(
          pRes.data as Project,
          (sRes.data || []) as Service[],
          eRes.data as Estimation,
          (aRes.data || []) as Attachment[],
        );

        // Filename: mirror the XLSX naming convention if we have one, else fall back
        const xlsxName = (eRes.data as Estimation).generated_boq_url?.split('/').pop();
        const pdfFilename = xlsxName
          ? xlsxName.replace(/\.xlsx?$/i, '.pdf')
          : `ERP Realsoft_Quotation_${(pRes.data as Project).id.slice(0, 8)}.pdf`;

        userAttachments.push({
          buffer: pdfBuffer,
          filename: pdfFilename,
          mimeType: 'application/pdf',
        });
      } catch (err: any) {
        console.error('[gmail/send] PDF BOQ generation failed, sending without PDF:', err.message);
      }
    }

    let result;

    const sendOptions = {
      to,
      subject,
      body: emailBody,
      cc,
      attachmentUrl: resolvedAttachmentUrl,
      attachmentBuffer,
      attachmentFilename,
      attachmentMimeType,
      attachments: userAttachments.length > 0 ? userAttachments : undefined,
    };

    if (threadId) {
      result = await replyToThread({ threadId, ...sendOptions });
    } else {
      result = await sendEmail(sendOptions);
    }

    // Log reply activity if tied to a project
    if (projectId) {
      try {
        await logActivity(projectId, 0, 'Email Reply Sent', 'completed', {
          sent_to: to,
          subject,
          template: templateUsed || 'custom',
          thread_id: threadId,
        });
      } catch {
        // Best-effort logging
      }
    }

    return NextResponse.json({
      sent: true,
      messageId: result.messageId,
      threadId: result.threadId,
    });
  } catch (error: any) {
    console.error('Send email error:', error);
    return NextResponse.json(
      { error: 'Failed to send email', details: error.message },
      { status: error.status || 500 }
    );
  }
}
