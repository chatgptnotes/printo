import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { decideIntake } from '@/lib/email/intake-filter';
import { logActivity } from '@/lib/storage/activity-logger';
import { syncNewEmails, repairMissingAttachments } from '@/lib/email/gmail-sync';
import { stripQuotedReplies } from '@/lib/email/email-utils';
import { importGoogleLinksForProject } from '@/lib/email/google-link-importer';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Normalize subject: strip RE:/FW:/FWD:/[EXT]/[EXTERNAL] prefixes and extra whitespace
function normalizeSubject(subject: string): string {
  let s = subject;
  // Repeatedly strip leading prefixes until none remain (handles "RE: FW: Fwd: ...")
  for (let i = 0; i < 10; i++) {
    const before = s;
    s = s
      .replace(/^\s*\[(ext|external|spam|notice)\]\s*/i, '')
      .replace(/^\s*(re|fw|fwd|fyi|aw|wg|tr|sv)\s*:\s*/i, '');
    if (s === before) break;
  }
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

// Extract email address from "Name <email@domain>" format
function extractEmail(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return (match ? match[1] : from).toLowerCase().trim();
}

// POST: manual scan from UI (no auth needed — protected by app auth)
export async function POST() {
  return handlePollInbox();
}

// GET: Vercel cron (auth required)
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return handlePollInbox();
}

async function handlePollInbox() {
  try {
    // ──── PHASE 1: Sync emails from Gmail → sabi_emails ────
    const syncResult = await syncNewEmails();

    // ──── PHASE 1b: Repair emails synced before metadata-only fix ────
    // Emails with has_attachments=true but no sabi_email_attachments rows
    const repairResult = await repairMissingAttachments();
    if (repairResult.repaired > 0) {
      console.log(`Repaired ${repairResult.repaired} emails with missing attachment metadata`);
    }

    // ──── PHASE 2: Classify unprocessed emails → sabi_projects ────
    // Single fetch for ALL project columns the cron needs — used for dedup
    // (thread_id / message_id sets) AND follow-up detection (sender+subject
    // match) inside the per-email loop. Previously the loop re-fetched this
    // per email, causing an N+1 that drove ~500 reqs/run.
    const { data: existingProjects } = await supabaseAdmin
      .from('sabi_projects')
      .select('id, email_thread_id, email_message_id, email_from, email_subject, status');
    const existingThreadIds = new Set((existingProjects || []).filter(p => p.email_thread_id).map(p => p.email_thread_id));
    const existingMessageIds = new Set((existingProjects || []).filter(p => p.email_message_id).map(p => p.email_message_id));
    const nonDeclinedProjects = (existingProjects || []).filter(p => p.status !== 'declined');

    // Stage 1: lightweight fetch for all recent emails (no body columns).
    // Body is only needed for unprocessed emails — fetched below in Stage 2.
    const { data: allRecentEmails } = await supabaseAdmin
      .from('sabi_emails')
      .select('id, gmail_message_id, thread_id, from_address, subject, date, snippet, has_attachments, labels')
      .order('date', { ascending: false })
      .limit(500);

    // Filter: skip emails that already created a project (by message_id, not thread_id)
    const unprocessedShell = (allRecentEmails || []).filter(e =>
      !existingMessageIds.has(e.gmail_message_id)
    ).slice(0, 100);

    // Stage 2: fetch body only for unprocessed emails (typically <20 per run).
    let bodyMap = new Map<string, { body_html: string | null; body_text: string | null }>();
    if (unprocessedShell.length > 0) {
      const { data: bodies } = await supabaseAdmin
        .from('sabi_emails')
        .select('id, body_html, body_text')
        .in('id', unprocessedShell.map(e => e.id));
      for (const b of bodies || []) bodyMap.set(b.id, b);
    }
    const unprocessed = unprocessedShell.map(e => ({ ...e, ...bodyMap.get(e.id) }));

    // Link attachments from thread follow-ups to existing projects
    const threadFollowUps = (allRecentEmails || []).filter(e =>
      existingThreadIds.has(e.thread_id) &&
      !existingMessageIds.has(e.gmail_message_id)
    );
    let followUpBodyMap = new Map<string, { body_html: string | null; body_text: string | null }>();
    if (threadFollowUps.length > 0) {
      const { data: followUpBodies } = await supabaseAdmin
        .from('sabi_emails')
        .select('id, body_html, body_text')
        .in('id', threadFollowUps.slice(0, 20).map(e => e.id));
      for (const b of followUpBodies || []) followUpBodyMap.set(b.id, b);
    }
    let linkedAttachments = 0;
    let linkedGoogleFiles = 0;
    for (const email of threadFollowUps.slice(0, 20)) {
      try {
        const proj = (existingProjects || []).find(p => p.email_thread_id === email.thread_id);
        if (!proj) continue;

        const { data: emailAtts } = email.has_attachments
          ? await supabaseAdmin
            .from('sabi_email_attachments')
            .select('*')
            .eq('email_id', email.id)
          : { data: [] as any[] };

        const { data: existingAtts } = await supabaseAdmin
          .from('sabi_attachments')
          .select('attachment_id')
          .eq('project_id', proj.id);
        const linkedIds = new Set((existingAtts || []).map((a: any) => a.attachment_id));
        const newAtts = (emailAtts || []).filter(a => !linkedIds.has(a.gmail_attachment_id));

        if (newAtts.length > 0) {
          const { error: insertErr } = await supabaseAdmin.from('sabi_attachments').insert(
            newAtts.map(att => ({
              project_id: proj.id,
              filename: att.filename || 'unknown',
              mime_type: att.mime_type || null,
              size_bytes: att.size_bytes || null,
              attachment_id: att.gmail_attachment_id || null,
              message_id: att.gmail_message_id,
              file_type: classifyFileType(att.filename || ''),
              storage_path: att.storage_path || null,
            }))
          );
          if (insertErr) {
            console.error(`Follow-up attachment insert failed for project ${proj.id}:`, JSON.stringify(insertErr));
            // Try inserting one at a time to bypass batch issues
            for (const att of newAtts) {
              const { error: singleErr } = await supabaseAdmin.from('sabi_attachments').insert({
                project_id: proj.id,
                filename: att.filename || 'unknown',
                mime_type: att.mime_type || null,
                size_bytes: att.size_bytes || null,
                attachment_id: att.gmail_attachment_id || null,
                message_id: att.gmail_message_id,
                file_type: classifyFileType(att.filename || ''),
                storage_path: att.storage_path || null,
              });
              if (!singleErr) linkedAttachments++;
            }
          } else {
            linkedAttachments += newAtts.length;
          }
        }

        const followUpBody = followUpBodyMap.get(email.id);
        const body = followUpBody?.body_html || followUpBody?.body_text || email.snippet || '';
        const linkResult = await importGoogleLinksForProject({
          projectId: proj.id,
          gmailMessageId: email.gmail_message_id,
          body,
        });
        linkedGoogleFiles += linkResult.filesImported;
        if (linkResult.linksFound > 0) {
          await logActivity(proj.id, 4, 'Import Google Links', linkResult.filesImported > 0 ? 'completed' : 'skipped', {
            gmail_message_id: email.gmail_message_id,
            links_found: linkResult.linksFound,
            files_imported: linkResult.filesImported,
            skipped: linkResult.skipped,
            failures: linkResult.failures,
          });
        }
      } catch (err: any) {
        console.error(`Follow-up attachment link failed for ${email.subject}:`, err.message);
      }
    }

    console.log(`Poll: ${(allRecentEmails || []).length} recent emails, ${unprocessed.length} unprocessed, ${threadFollowUps.length} thread follow-ups, ${linkedAttachments} attachments linked, ${linkedGoogleFiles} Google-link files linked`);

    if (!unprocessed || unprocessed.length === 0) {
      return NextResponse.json({
        processed: 0,
        synced: syncResult.synced,
        linked_attachments: linkedAttachments,
        linked_google_files: linkedGoogleFiles,
        message: 'Emails synced, no new projects to classify',
      });
    }

    let processed = 0;
    let rfqs = 0;
    let ignored = 0;
    const errors: { threadId: string; subject: string; error: string }[] = [];

    // Process in batches of 5
    const BATCH_SIZE = 5;
    for (let i = 0; i < unprocessed.length; i += BATCH_SIZE) {
      const batch = unprocessed.slice(i, i + BATCH_SIZE);

      const results = await Promise.allSettled(batch.map(async (email) => {
        const subject = email.subject || '';
        const body = email.body_html || email.body_text || email.snippet || '';
        const from = email.from_address || '';
        const date = email.date || '';

        // Follow-up detection by sender+subject was disabled per operator
        // request (2026-05-04): "even repeat/duplicate one should show".
        // Every email now creates its own project row, regardless of whether
        // the same sender previously sent the same subject. Only true dedup
        // (same gmail_message_id) is kept — that's a hard one-row-per-email
        // invariant, not a heuristic. Re-enable by restoring the
        // sender+subject loop below if duplicate-noise becomes a problem.
        const senderEmail = extractEmail(from);
        const normalizedSubject = normalizeSubject(subject);
        // Reference vars retained so the classification path below keeps working.
        void senderEmail; void normalizedSubject; void nonDeclinedProjects;

        // Classify email — sender + Gmail-label + keyword gates decide RFQ vs
        // junk; admitted mail gets a priority from the rules-only scorer.
        // Runs for every email, including subject-duplicates.
        let classification: any;
        let classifyProvider: string;
        try {
          classification = await decideIntake({ from, subject, body, labels: email.labels });
          classifyProvider = classification.classifier;
        } catch (classifyErr: any) {
          console.error(`Classification failed for "${subject}": ${classifyErr.message}`);
          classification = { isRfq: true, priority: 'new', confidence: 0, reasoning: `Classification failed: ${classifyErr.message}` };
          classifyProvider = 'error-fallback';
        }

        // Create project — with email_id FK
        // Strip HTML, quoted reply chains, and signatures before storing snippet
        const dehtmled = (body || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        const snippetText = stripQuotedReplies(dehtmled).replace(/\s+/g, ' ').trim().substring(0, 3000);

        const { data: project, error } = await supabaseAdmin
          .from('sabi_projects')
          .insert({
            email_id: email.id,
            email_thread_id: email.thread_id,
            email_message_id: email.gmail_message_id,
            email_from: from,
            email_subject: subject,
            email_date: date,
            email_snippet: snippetText,
            priority: classification.priority,
            status: 'classified',
            ai_classification: {
              ...(classification as unknown as Record<string, unknown>),
              _provider: classifyProvider,
            },
          })
          .select()
          .single();

        if (error) {
          console.error('Error creating project:', error);
          return null;
        }

        // Get attachments from sabi_email_attachments (already synced by Phase 1)
        const { data: emailAtts } = await supabaseAdmin
          .from('sabi_email_attachments')
          .select('*')
          .eq('email_id', email.id);

        // 33-step pipeline:
        //   step 0 = Auto-Filter (the classification decision itself)
        //   step 1 = Identify Email
        //   step 2 = Identify Enquiry
        //   step 3 = Add to Bid List
        //   step 4 = Unzip Attachments
        // For 'ignore' classifications, step 0 records the eject reason so the
        // audit trail shows the filter ran before the row landed in the UI.
        await Promise.all([
          logActivity(project.id, 0, 'Auto-Filter', 'completed', {
            decision: classification.priority === 'ignore' ? 'ejected' : 'admitted',
            classifier: classifyProvider,
            confidence: classification.confidence,
            reasoning: classification.reasoning,
            priority: classification.priority,
          }),
          logActivity(project.id, 1, 'Read Email', 'completed', { source: 'cron_poll', thread_id: email.thread_id }),
          logActivity(project.id, 2, 'Register New Enquiry', 'completed', { is_rfq: classification.isRfq, keywords_matched: true }),
          logActivity(project.id, 3, 'Open Tender Folder', 'completed', { priority: classification.priority, confidence: classification.confidence, provider: classifyProvider }),
          logActivity(project.id, 4, 'Unload Attachments', emailAtts && emailAtts.length > 0 ? 'completed' : 'skipped', { attachments_count: emailAtts?.length || 0 }),
          (emailAtts && emailAtts.length > 0)
            ? supabaseAdmin.from('sabi_attachments').insert(
                emailAtts.map((att) => ({
                  project_id: project.id,
                  filename: att.filename || 'unknown',
                  mime_type: att.mime_type || null,
                  size_bytes: att.size_bytes || null,
                  attachment_id: att.gmail_attachment_id || null,
                  message_id: att.gmail_message_id,
                  file_type: classifyFileType(att.filename || ''),
                  storage_path: att.storage_path || null,
                }))
              )
            : Promise.resolve(),
        ]);

        const googleLinkResult = await importGoogleLinksForProject({
          projectId: project.id,
          gmailMessageId: email.gmail_message_id,
          body,
        });
        if (googleLinkResult.linksFound > 0) {
          await logActivity(project.id, 4, 'Import Google Links', googleLinkResult.filesImported > 0 ? 'completed' : 'skipped', {
            links_found: googleLinkResult.linksFound,
            files_imported: googleLinkResult.filesImported,
            skipped: googleLinkResult.skipped,
            failures: googleLinkResult.failures,
          });
        }

        return project;
      }));

      // Count successful and log failures
      for (let j = 0; j < results.length; j++) {
        const r = results[j];
        if (r.status === 'fulfilled' && r.value) {
          processed++;
          if (r.value.followUp) {
            // follow-ups don't count as new
          } else if (r.value.priority === 'ignore') {
            ignored++;
          } else {
            rfqs++;
          }
        } else if (r.status === 'rejected') {
          const email = batch[j];
          const errMsg = r.reason?.message || String(r.reason);
          console.error(`Failed to classify email ${email.thread_id} (${email.subject}): ${errMsg}`);
          errors.push({ threadId: email.thread_id, subject: email.subject, error: errMsg });
        }
      }
    }

    if (errors.length > 0) {
      console.error(`Cron poll: ${errors.length} email(s) failed`, errors);
    }

    return NextResponse.json({
      processed,
      rfqs,
      ignored,
      synced: syncResult.synced,
      failed: errors.length,
      linked_attachments: linkedAttachments,
      linked_google_files: linkedGoogleFiles,
      total_emails: (allRecentEmails || []).length,
      total_unprocessed: unprocessed.length,
      ...(errors.length > 0 && { errors }),
    });
  } catch (error: any) {
    console.error('Cron poll error:', error);
    return NextResponse.json(
      { error: 'Cron poll failed', details: error.message },
      { status: 500 }
    );
  }
}

function classifyFileType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const typeMap: Record<string, string> = {
    // CAD drawings
    dwg: 'drawing_autocad', dxf: 'drawing_autocad', dgn: 'drawing_autocad',
    rvt: 'drawing_revit', rfa: 'drawing_revit', ifc: 'drawing_bim',
    // Documents
    pdf: 'drawing_pdf',
    doc: 'specification', docx: 'specification', rtf: 'specification', txt: 'specification',
    // Schedules & data
    xls: 'schedule_excel', xlsx: 'schedule_excel', xlsm: 'schedule_excel',
    csv: 'schedule_excel', ods: 'schedule_excel',
    // Archives
    zip: 'archive_zip', rar: 'archive_zip', '7z': 'archive_zip', gz: 'archive_zip', tar: 'archive_zip',
    // Images
    jpg: 'image', jpeg: 'image', png: 'image', bmp: 'image', tiff: 'image', tif: 'image',
    gif: 'image', svg: 'image', webp: 'image',
    // Presentations
    ppt: 'presentation', pptx: 'presentation',
    // Calendar
    ics: 'calendar',
    // Email
    eml: 'email', msg: 'email',
  };
  return typeMap[ext] || 'other';
}
