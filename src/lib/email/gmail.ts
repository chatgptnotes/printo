// Gmail REST API Client
// Replaces gog CLI with direct API calls — works on Vercel serverless

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

// --- Token Management ---

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

export async function getAccessToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.accessToken;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN?.trim();

  if (!clientId || !clientSecret || !refreshToken) {
    throw new GmailApiError('Missing Google OAuth credentials (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN)', 500);
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const reason = err.error_description || err.error || res.statusText;

    // Detect "invalid_grant" — means the refresh token is permanently dead
    // (expired in OAuth Testing mode, revoked, password changed, etc.)
    // Provide actionable guidance instead of a cryptic error.
    if (err.error === 'invalid_grant' || /expired|revoked/i.test(reason)) {
      throw new GmailApiError(
        `Gmail authentication expired. The GOOGLE_REFRESH_TOKEN env var needs to be regenerated. ` +
        `Visit https://developers.google.com/oauthplayground to mint a new token, then update it in Vercel ` +
        `Settings → Environment Variables and redeploy. (Underlying error: ${reason})`,
        401,
      );
    }

    throw new GmailApiError(`Token refresh failed: ${reason}`, res.status);
  }

  const data = await res.json();
  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };
  return cachedToken.accessToken;
}

// --- API Helpers ---

export class GmailApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'GmailApiError';
    this.status = status;
  }
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503]);
const MAX_RETRIES = 2;

async function gmailFetch(path: string, options?: RequestInit): Promise<any> {
  let lastError: GmailApiError | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const token = await getAccessToken();
    const res = await fetch(`${GMAIL_API}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...options?.headers,
      },
    });

    if (res.status === 401) {
      // Token expired mid-request — refresh and retry once
      const newToken = await getAccessToken(true);
      const retry = await fetch(`${GMAIL_API}${path}`, {
        ...options,
        headers: {
          Authorization: `Bearer ${newToken}`,
          ...options?.headers,
        },
      });
      if (!retry.ok) {
        const err = await retry.json().catch(() => ({}));
        throw new GmailApiError(err.error?.message || retry.statusText, retry.status);
      }
      return retry.json();
    }

    if (res.ok) {
      return res.json();
    }

    const err = await res.json().catch(() => ({}));
    lastError = new GmailApiError(err.error?.message || res.statusText, res.status);

    // Retry on transient errors with exponential backoff
    if (RETRYABLE_STATUSES.has(res.status) && attempt < MAX_RETRIES) {
      const delay = 1000 * Math.pow(2, attempt); // 1s, 2s
      console.warn(`Gmail API ${res.status} on ${path} — retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
      await new Promise(resolve => setTimeout(resolve, delay));
      continue;
    }

    throw lastError;
  }

  throw lastError!;
}

// --- Base64 URL-safe helpers ---

export function decodeBase64Url(data: string): Buffer {
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64');
}

function encodeBase64Url(data: string | Buffer): string {
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// --- MIME Body Extraction ---

/**
 * Read the charset from a Gmail message part's headers.
 *   "Content-Type": "text/html; charset=windows-1256" → "windows-1256"
 */
function getPartCharset(part: any): string | null {
  if (!part?.headers) return null;
  const ct = part.headers.find((h: any) => h.name?.toLowerCase() === 'content-type');
  if (!ct?.value) return null;
  const m = ct.value.match(/charset\s*=\s*"?([^";\s]+)"?/i);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Decode a buffer using the given charset. Falls back to UTF-8 → latin1.
 * Supports common email encodings via TextDecoder (windows-1256 Arabic, etc.).
 */
function decodeWithCharset(buf: Buffer, charset?: string | null): string {
  const cs = (charset || 'utf-8').toLowerCase();
  try {
    if (cs === 'utf-8' || cs === 'utf8' || cs === 'us-ascii' || cs === 'ascii') {
      return buf.toString('utf-8');
    }
    if (cs === 'iso-8859-1' || cs === 'latin1' || cs === 'latin-1') {
      return buf.toString('latin1');
    }
    if (cs === 'utf-16' || cs === 'utf16le' || cs === 'utf-16le') {
      return buf.toString('utf16le');
    }
    if (typeof TextDecoder !== 'undefined') {
      try {
        return new TextDecoder(cs as string).decode(buf);
      } catch {
        // Unknown encoding label — fall through
      }
    }
    return buf.toString('utf-8');
  } catch {
    return buf.toString('latin1');
  }
}

export function extractBody(payload: any): { body: string; contentType: 'html' | 'text' } {
  // Simple message with body directly on payload
  if (payload.body?.data) {
    const charset = getPartCharset(payload);
    const decoded = decodeWithCharset(decodeBase64Url(payload.body.data), charset);
    const isHtml = payload.mimeType === 'text/html';
    return { body: decoded, contentType: isHtml ? 'html' : 'text' };
  }

  if (!payload.parts) {
    return { body: '(no body)', contentType: 'text' };
  }

  // Multipart: prefer text/html over text/plain
  let htmlBody = '';
  let textBody = '';

  for (const part of payload.parts) {
    if (part.mimeType === 'text/html' && part.body?.data) {
      htmlBody = decodeWithCharset(decodeBase64Url(part.body.data), getPartCharset(part));
    } else if (part.mimeType === 'text/plain' && part.body?.data) {
      textBody = decodeWithCharset(decodeBase64Url(part.body.data), getPartCharset(part));
    } else if (part.mimeType?.startsWith('multipart/') && part.parts) {
      const nested = extractBody(part);
      if (nested.contentType === 'html' && nested.body !== '(no body)') {
        htmlBody = htmlBody || nested.body;
      } else if (nested.body !== '(no body)') {
        textBody = textBody || nested.body;
      }
    }
  }

  if (htmlBody) return { body: htmlBody, contentType: 'html' };
  if (textBody) return { body: textBody, contentType: 'text' };
  return { body: '(no body)', contentType: 'text' };
}

export function extractAttachments(payload: any): GmailAttachment[] {
  const attachments: GmailAttachment[] = [];

  function walk(part: any) {
    if (part.body?.attachmentId && part.filename) {
      attachments.push({
        filename: part.filename,
        size: part.body.size || 0,
        sizeHuman: formatSize(part.body.size || 0),
        mimeType: part.mimeType || 'application/octet-stream',
        attachmentId: part.body.attachmentId,
      });
    }
    if (part.parts) {
      for (const child of part.parts) walk(child);
    }
  }

  walk(payload);
  return attachments;
}

export function getHeader(headers: any[], name: string): string {
  const header = headers?.find((h: any) => h.name.toLowerCase() === name.toLowerCase());
  return header?.value || '';
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// --- Types ---

export interface GmailThread {
  id: string;
  from: string;
  to: string;
  cc: string;
  subject: string;
  date: string;
  snippet: string;
  messageCount: number;
  labels: string[];
}

export interface GmailMessage {
  from: string;
  subject: string;
  body: string;
  date: string;
  contentType: 'html' | 'text';
  messageId: string;
  headers: { from: string; subject: string; date: string };
  message: { id: string };
  attachments: GmailAttachment[];
}

export interface GmailAttachment {
  filename: string;
  size: number;
  sizeHuman: string;
  mimeType: string;
  attachmentId: string;
}

// --- Exported Functions ---

/**
 * Search Gmail messages and return thread summaries.
 * Replacement for: gog gmail search "${query}" --max ${max} --json
 */
export async function searchMessages(query: string, maxResults: number = 20): Promise<GmailThread[]> {
  // Step 1: List messages matching the query
  const listData = await gmailFetch(
    `/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`,
  );

  const messages = listData.messages || [];
  if (messages.length === 0) return [];

  // Step 2: Fetch metadata in batches of 5 to avoid Gmail rate limits
  const fetched: any[] = [];
  const METADATA_BATCH = 5;
  for (let i = 0; i < messages.length; i += METADATA_BATCH) {
    const batch = messages.slice(i, i + METADATA_BATCH);
    const results = await Promise.all(
      batch.map((m: any) =>
        gmailFetch(`/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date`),
      ),
    );
    fetched.push(...results);
  }

  // Step 3: Group by threadId
  const threadMap = new Map<string, { messages: any[]; snippet: string; labels: string[] }>();

  for (const msg of fetched) {
    const threadId = msg.threadId;
    if (!threadMap.has(threadId)) {
      threadMap.set(threadId, {
        messages: [],
        snippet: msg.snippet || '',
        labels: msg.labelIds || [],
      });
    }
    threadMap.get(threadId)!.messages.push(msg);
  }

  // Step 4: Build thread summaries (use first message's headers)
  const threads: GmailThread[] = [];

  for (const [threadId, data] of threadMap) {
    const first = data.messages[0];
    const headers = first.payload?.headers || [];
    threads.push({
      id: threadId,
      from: getHeader(headers, 'From'),
      to: getHeader(headers, 'To'),
      cc: getHeader(headers, 'Cc'),
      subject: getHeader(headers, 'Subject') || '(no subject)',
      date: getHeader(headers, 'Date'),
      snippet: data.snippet,
      messageCount: data.messages.length,
      labels: data.labels,
    });
  }

  return threads;
}

/**
 * Get full email content by thread ID.
 * Replacement for: gog gmail get "${threadId}" --json
 */
export async function getMessage(threadId: string): Promise<GmailMessage> {
  const threadData = await gmailFetch(`/threads/${threadId}?format=full`);

  const messages = threadData.messages || [];
  // Use the last (most recent) message in the thread
  const msg = messages[messages.length - 1] || messages[0];

  if (!msg) {
    throw new GmailApiError('No messages found in thread', 404);
  }

  const headers = msg.payload?.headers || [];
  const from = getHeader(headers, 'From');
  const subject = getHeader(headers, 'Subject') || '(no subject)';
  const date = getHeader(headers, 'Date');

  const { body, contentType } = extractBody(msg.payload);
  const attachments = extractAttachments(msg.payload);

  return {
    from,
    subject,
    body,
    date,
    contentType,
    messageId: msg.id,
    headers: { from, subject, date },
    message: { id: msg.id },
    attachments,
  };
}

/**
 * Download an attachment by messageId and attachmentId.
 * Replacement for: gog gmail attachment "${messageId}" "${attachmentId}" --out ...
 * Returns a Buffer — no temp files needed.
 */
export async function getAttachment(messageId: string, attachmentId: string): Promise<Buffer> {
  const data = await gmailFetch(`/messages/${messageId}/attachments/${attachmentId}`);
  return decodeBase64Url(data.data);
}

/**
 * Send a new email.
 */
export async function sendEmail(options: {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  attachmentUrl?: string;
  attachmentBuffer?: Buffer;
  attachmentFilename?: string;
  attachmentMimeType?: string;
  attachments?: Array<{ buffer: Buffer; filename: string; mimeType: string }>;
}): Promise<{ messageId: string; threadId: string }> {
  const raw = await buildRawEmail(options);
  const result = await gmailFetch('/messages/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
  return { messageId: result.id, threadId: result.threadId };
}

/**
 * Reply to an existing thread.
 */
export async function replyToThread(options: {
  threadId: string;
  to: string;
  subject: string;
  body: string;
  cc?: string;
  attachmentUrl?: string;
  attachmentBuffer?: Buffer;
  attachmentFilename?: string;
  attachmentMimeType?: string;
  attachments?: Array<{ buffer: Buffer; filename: string; mimeType: string }>;
}): Promise<{ messageId: string; threadId: string }> {
  // Get original message for In-Reply-To header
  const threadData = await gmailFetch(`/threads/${options.threadId}?format=metadata&metadataHeaders=Message-ID`);
  const lastMsg = threadData.messages?.[threadData.messages.length - 1];
  const originalMessageId = lastMsg
    ? getHeader(lastMsg.payload?.headers || [], 'Message-ID')
    : '';

  const raw = await buildRawEmail({
    ...options,
    inReplyTo: originalMessageId,
    references: originalMessageId,
  });

  const result = await gmailFetch('/messages/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw, threadId: options.threadId }),
  });

  return { messageId: result.id, threadId: result.threadId };
}

/**
 * Get a single message by its message ID (not thread ID).
 * Returns raw payload for sync engine to parse.
 */
export async function getMessageById(messageId: string): Promise<{
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  historyId: string;
  payload: any;
  internalDate: string;
}> {
  return gmailFetch(`/messages/${messageId}?format=full`);
}

/**
 * List message IDs added since a given historyId (incremental sync).
 * Returns added message IDs and the new historyId.
 */
export async function listHistory(startHistoryId: string): Promise<{
  messageIds: string[];
  newHistoryId: string | null;
}> {
  try {
    const data = await gmailFetch(
      `/history?startHistoryId=${startHistoryId}&historyTypes=messageAdded&labelId=INBOX`
    );
    const messageIds = new Set<string>();
    for (const record of data.history || []) {
      for (const added of record.messagesAdded || []) {
        if (added.message?.id) messageIds.add(added.message.id);
      }
    }
    return {
      messageIds: Array.from(messageIds),
      newHistoryId: data.historyId || null,
    };
  } catch (error: any) {
    // historyId expired (404) — caller should fall back to full scan
    if (error.status === 404) {
      return { messageIds: [], newHistoryId: null };
    }
    throw error;
  }
}

/**
 * List message IDs with pagination support (for backfill).
 * Returns message IDs and nextPageToken for continuation.
 */
export async function listMessageIds(
  query: string,
  maxResults: number = 25,
  pageToken?: string
): Promise<{ messageIds: string[]; nextPageToken: string | null }> {
  let path = `/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`;
  if (pageToken) path += `&pageToken=${pageToken}`;

  const data = await gmailFetch(path);
  const messageIds = (data.messages || []).map((m: any) => m.id);
  return {
    messageIds,
    nextPageToken: data.nextPageToken || null,
  };
}

// --- Email Construction ---

async function buildRawEmail(options: {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  inReplyTo?: string;
  references?: string;
  attachmentUrl?: string;
  attachmentBuffer?: Buffer;
  attachmentFilename?: string;
  attachmentMimeType?: string;
  attachments?: Array<{ buffer: Buffer; filename: string; mimeType: string }>;
}): Promise<string> {
  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const headers: string[] = [
    `To: ${options.to}`,
    `Subject: ${options.subject}`,
    'MIME-Version: 1.0',
  ];

  if (options.cc) headers.push(`Cc: ${options.cc}`);
  if (options.inReplyTo) headers.push(`In-Reply-To: ${options.inReplyTo}`);
  if (options.references) headers.push(`References: ${options.references}`);

  // Normalize all attachment inputs (legacy single-attachment props + new array)
  // into a single resolved list before building the multipart MIME body.
  const resolved: Array<{ buffer: Buffer; filename: string; mimeType: string }> = [];

  if (options.attachments && options.attachments.length > 0) {
    resolved.push(...options.attachments);
  }

  if (options.attachmentBuffer) {
    resolved.push({
      buffer: options.attachmentBuffer,
      filename: options.attachmentFilename || 'attachment.xlsx',
      mimeType: options.attachmentMimeType || 'application/octet-stream',
    });
  } else if (options.attachmentUrl) {
    // Only attempt fetch if the URL is a real HTTP(S) URL — otherwise we silently skip
    if (/^https?:\/\//i.test(options.attachmentUrl)) {
      try {
        const attachRes = await fetch(options.attachmentUrl);
        if (attachRes.ok) {
          let filename = options.attachmentFilename || 'attachment';
          if (!options.attachmentFilename) {
            const urlPath = new URL(options.attachmentUrl).pathname;
            filename = urlPath.split('/').pop() || filename;
          }
          resolved.push({
            buffer: Buffer.from(await attachRes.arrayBuffer()),
            filename,
            mimeType: options.attachmentMimeType || 'application/octet-stream',
          });
        }
      } catch (err: any) {
        console.error('Failed to fetch attachment URL:', err.message);
      }
    } else {
      console.error(
        `replyToThread: attachmentUrl "${options.attachmentUrl}" is not a fetchable HTTP URL. ` +
        `Pass attachmentBuffer + attachmentFilename instead, or provide a signed URL.`
      );
    }
  }

  // If we have any attachments, build a multipart/mixed message with one
  // text/html body part followed by one part per attachment.
  if (resolved.length > 0) {
    headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);

    const parts: string[] = [
      `--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n${options.body}`,
    ];

    for (const att of resolved) {
      // Wrap base64 at 76 chars per line per RFC 2045 to avoid mailer rejection
      const base64Body = att.buffer.toString('base64').match(/.{1,76}/g)?.join('\r\n') || '';
      parts.push(
        `--${boundary}\r\nContent-Type: ${att.mimeType}; name="${att.filename}"\r\n` +
        `Content-Disposition: attachment; filename="${att.filename}"\r\n` +
        `Content-Transfer-Encoding: base64\r\n\r\n${base64Body}`
      );
    }

    parts.push(`--${boundary}--`);

    const raw = `${headers.join('\r\n')}\r\n\r\n${parts.join('\r\n')}`;
    return encodeBase64Url(raw);
  }

  // Simple HTML email (no attachment)
  headers.push('Content-Type: text/html; charset=UTF-8');
  const raw = `${headers.join('\r\n')}\r\n\r\n${options.body}`;
  return encodeBase64Url(raw);
}
