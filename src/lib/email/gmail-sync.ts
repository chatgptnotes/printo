// Gmail → Supabase Sync Engine
// Syncs raw emails into sabi_emails table so the app reads from Supabase, not Gmail API.

import { supabaseAdmin } from '@/lib/storage/supabase';
import {
  getMessageById,
  listHistory,
  listMessageIds,
  extractBody,
  extractAttachments,
  getHeader,
  GmailAttachment,
} from '@/lib/email/gmail';
import type { GmailSyncState } from '@/lib/shared/types';

const BATCH_SIZE = 5; // Parallel message fetches per batch

// --- Sync State ---

export async function getSyncState(): Promise<GmailSyncState> {
  const { data } = await supabaseAdmin
    .from('sabi_settings')
    .select('value')
    .eq('key', 'gmail_sync_state')
    .single();

  return (data?.value as GmailSyncState) || {
    last_history_id: null,
    last_sync_at: null,
    backfill_complete: false,
  };
}

export async function setSyncState(state: Partial<GmailSyncState>): Promise<void> {
  const current = await getSyncState();
  const merged = { ...current, ...state };
  await supabaseAdmin
    .from('sabi_settings')
    .update({ value: merged, updated_at: new Date().toISOString() })
    .eq('key', 'gmail_sync_state');
}

// --- Core Sync ---

/**
 * Sync new emails from Gmail into sabi_emails.
 * Uses History API for incremental sync when possible, falls back to search.
 */
export async function syncNewEmails(): Promise<{
  synced: number;
  errors: string[];
  syncedThreadIds: string[];
}> {
  const state = await getSyncState();
  let messageIds: string[] = [];
  let newHistoryId: string | null = null;

  // Try incremental sync via History API
  if (state.last_history_id) {
    const history = await listHistory(state.last_history_id);
    if (history.newHistoryId) {
      // History API worked — collect new messages
      messageIds = history.messageIds;
      newHistoryId = history.newHistoryId;
    }
    // If newHistoryId is null, historyId expired — search scan below covers it
  }

  // Always supplement with a search scan — catches History API misses (race
  // conditions, API quirks) and handles the no-historyId first-sync case.
  // Uses a 7-day window so anything missed in a week of history gaps is recovered.
  const { messageIds: recentIds } = await listMessageIds('in:inbox newer_than:7d', 100);
  const seen = new Set(messageIds);
  for (const id of recentIds) {
    if (!seen.has(id)) messageIds.push(id);
  }

  if (messageIds.length === 0) {
    await setSyncState({ last_sync_at: new Date().toISOString() });
    return { synced: 0, errors: [], syncedThreadIds: [] };
  }

  // Filter out already-synced messages
  const { data: existing } = await supabaseAdmin
    .from('sabi_emails')
    .select('gmail_message_id')
    .in('gmail_message_id', messageIds);

  const existingIds = new Set((existing || []).map(e => e.gmail_message_id));
  const newIds = messageIds.filter(id => !existingIds.has(id));

  // Sync in batches
  let synced = 0;
  const errors: string[] = [];
  const syncedThreadIds: string[] = [];

  for (let i = 0; i < newIds.length; i += BATCH_SIZE) {
    const batch = newIds.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(id => syncSingleMessage(id))
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        synced++;
        if (result.value.threadId) syncedThreadIds.push(result.value.threadId);
      } else {
        errors.push(result.reason?.message || 'Unknown sync error');
      }
    }
  }

  // Update sync state
  const stateUpdate: Partial<GmailSyncState> = {
    last_sync_at: new Date().toISOString(),
  };
  if (newHistoryId) {
    stateUpdate.last_history_id = newHistoryId;
  }
  await setSyncState(stateUpdate);

  return { synced, errors, syncedThreadIds };
}

/**
 * Sync a single Gmail message into sabi_emails + upload attachments.
 */
export async function syncSingleMessage(messageId: string): Promise<{ emailId: string; threadId: string; gmailMessageId: string }> {
  const msg = await getMessageById(messageId);
  const headers = msg.payload?.headers || [];
  const { body: htmlBody, contentType } = extractBody(msg.payload);
  const attachments = extractAttachments(msg.payload);

  const from = getHeader(headers, 'From');
  const to = getHeader(headers, 'To');
  const cc = getHeader(headers, 'Cc');
  const subject = getHeader(headers, 'Subject') || '(no subject)';
  const date = msg.internalDate
    ? new Date(parseInt(msg.internalDate)).toISOString()
    : getHeader(headers, 'Date') || null;

  // Upsert into sabi_emails
  const { data: emailRow, error: insertError } = await supabaseAdmin
    .from('sabi_emails')
    .upsert({
      gmail_message_id: msg.id,
      thread_id: msg.threadId,
      from_address: from,
      to_address: to || null,
      cc_address: cc || null,
      subject,
      date,
      snippet: msg.snippet || null,
      body_html: contentType === 'html' ? htmlBody : null,
      body_text: contentType === 'text' ? htmlBody : (contentType === 'html' ? null : htmlBody),
      labels: msg.labelIds || [],
      has_attachments: attachments.length > 0,
      synced_at: new Date().toISOString(),
    }, { onConflict: 'gmail_message_id' })
    .select('id')
    .single();

  if (insertError) throw new Error(`Failed to upsert email ${msg.id}: ${insertError.message}`);

  const emailId = emailRow!.id;

  // Store historyId for future incremental syncs
  if (msg.historyId) {
    const state = await getSyncState();
    const currentHistoryId = state.last_history_id ? parseInt(state.last_history_id) : 0;
    const newHistoryId = parseInt(msg.historyId);
    if (newHistoryId > currentHistoryId) {
      await setSyncState({ last_history_id: msg.historyId });
    }
  }

  // Sync attachments (always attempt — syncAttachments skips existing ones)
  if (attachments.length > 0) {
    await syncAttachments(emailId, msg.id, msg.threadId, attachments);
  }

  return { emailId, threadId: msg.threadId, gmailMessageId: msg.id };
}

/**
 * Re-sync attachments for emails that have has_attachments=true but no attachment rows.
 * Call this after backfill to fix emails that were synced without attachments.
 */
export async function repairMissingAttachments(): Promise<{ repaired: number; errors: string[] }> {
  // Find emails with attachments flag but no attachment rows
  const { data: orphans } = await supabaseAdmin
    .from('sabi_emails')
    .select('id, gmail_message_id, thread_id')
    .eq('has_attachments', true)
    .limit(50);

  if (!orphans || orphans.length === 0) return { repaired: 0, errors: [] };

  // Filter to those with no attachment rows
  const { data: existingAtts } = await supabaseAdmin
    .from('sabi_email_attachments')
    .select('email_id')
    .in('email_id', orphans.map(o => o.id));

  const hasAttsSet = new Set((existingAtts || []).map(a => a.email_id));
  const needsRepair = orphans.filter(o => !hasAttsSet.has(o.id));

  let repaired = 0;
  const errors: string[] = [];

  for (const email of needsRepair) {
    try {
      const msg = await getMessageById(email.gmail_message_id);
      const attachments = extractAttachments(msg.payload);
      if (attachments.length > 0) {
        await syncAttachments(email.id, email.gmail_message_id, email.thread_id, attachments);
        repaired++;
      }
    } catch (err: any) {
      errors.push(`${email.gmail_message_id}: ${err.message}`);
    }
  }

  return { repaired, errors };
}

/**
 * Record attachment metadata in sabi_email_attachments (no file download).
 * Actual file content is fetched on demand via getAttachmentBuffer().
 */
async function syncAttachments(
  emailId: string,
  gmailMessageId: string,
  _threadId: string,
  attachments: GmailAttachment[]
): Promise<void> {
  // Record metadata only — actual file download happens on demand via getAttachmentBuffer().
  // This keeps sync fast even for emails with many/large attachments, preventing
  // poll-inbox timeout before classification can run.
  for (const att of attachments) {
    // Check if already stored
    const { data: existing } = await supabaseAdmin
      .from('sabi_email_attachments')
      .select('id')
      .eq('email_id', emailId)
      .eq('gmail_attachment_id', att.attachmentId)
      .maybeSingle();

    if (existing) continue;

    await supabaseAdmin.from('sabi_email_attachments').insert({
      email_id: emailId,
      gmail_attachment_id: att.attachmentId,
      gmail_message_id: gmailMessageId,
      filename: att.filename,
      mime_type: att.mimeType,
      size_bytes: att.size,
      storage_path: null,
      sync_error: null,
    });
  }
}

// --- Backfill ---

/**
 * Backfill historical emails in pages. Call repeatedly with returned pageToken.
 */
export async function backfillEmails(
  pageToken?: string | null,
  batchSize: number = 25
): Promise<{ processed: number; nextPageToken: string | null; errors: string[] }> {
  const result = await listMessageIds('in:inbox', batchSize, pageToken || undefined);
  const errors: string[] = [];
  let processed = 0;

  // Filter out already-synced
  if (result.messageIds.length > 0) {
    const { data: existing } = await supabaseAdmin
      .from('sabi_emails')
      .select('gmail_message_id')
      .in('gmail_message_id', result.messageIds);

    const existingIds = new Set((existing || []).map(e => e.gmail_message_id));
    const newIds = result.messageIds.filter(id => !existingIds.has(id));

    // Sync in batches
    for (let i = 0; i < newIds.length; i += BATCH_SIZE) {
      const batch = newIds.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(id => syncSingleMessage(id))
      );

      for (const r of results) {
        if (r.status === 'fulfilled') {
          processed++;
        } else {
          errors.push(r.reason?.message || 'Unknown error');
        }
      }
    }
  }

  // Mark backfill complete when no more pages
  if (!result.nextPageToken) {
    await setSyncState({ backfill_complete: true, last_sync_at: new Date().toISOString() });
  }

  return { processed, nextPageToken: result.nextPageToken, errors };
}
