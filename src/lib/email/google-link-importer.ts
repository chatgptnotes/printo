import { randomUUID } from 'crypto';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { classifyFileType } from '@/lib/shared/utils';

const STORAGE_BUCKET = 'sabi-attachments';
const MAX_IMPORT_BYTES = Number(process.env.GOOGLE_LINK_MAX_MB || process.env.MAX_ATTACHMENT_MB || 500) * 1024 * 1024;

type GoogleLinkKind = 'drive_file' | 'drive_folder' | 'google_doc' | 'google_sheet' | 'google_slide' | 'google_drawing';

interface GoogleLink {
  url: string;
  id: string;
  kind: GoogleLinkKind;
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
}

interface DownloadedFile {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}

export interface GoogleLinkImportResult {
  linksFound: number;
  filesImported: number;
  skipped: Array<{ url: string; reason: string }>;
  failures: Array<{ url: string; error: string }>;
  imported: Array<{ filename: string; sourceUrl: string; driveFileId: string; storagePath: string }>;
}

function decodeEmailText(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function cleanUrl(raw: string): string {
  return raw
    .replace(/^["'<(\[]+/, '')
    .replace(/[>"')\],.]+$/, '')
    .trim();
}

export function extractGoogleLinksFromText(text: string): GoogleLink[] {
  const normalized = decodeEmailText(text || '');
  const matches = normalized.match(/https?:\/\/(?:drive|docs)\.google\.com\/[^\s"'<>]+/gi) || [];
  const byKey = new Map<string, GoogleLink>();

  for (const raw of matches) {
    const url = cleanUrl(raw);
    const parsed = parseGoogleLink(url);
    if (parsed) byKey.set(`${parsed.kind}:${parsed.id}`, parsed);
  }

  return [...byKey.values()];
}

function parseGoogleLink(url: string): GoogleLink | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }

  const host = u.hostname.toLowerCase();
  const path = u.pathname;

  if (host === 'drive.google.com') {
    const folderMatch = path.match(/\/drive\/folders\/([^/?#]+)/);
    if (folderMatch) return { url, id: folderMatch[1], kind: 'drive_folder' };

    const fileMatch = path.match(/\/file\/d\/([^/?#]+)/);
    if (fileMatch) return { url, id: fileMatch[1], kind: 'drive_file' };

    const openId = u.searchParams.get('id');
    if (openId) return { url, id: openId, kind: 'drive_file' };
  }

  if (host === 'docs.google.com') {
    const docMatch = path.match(/\/document\/d\/([^/?#]+)/);
    if (docMatch) return { url, id: docMatch[1], kind: 'google_doc' };
    const sheetMatch = path.match(/\/spreadsheets\/d\/([^/?#]+)/);
    if (sheetMatch) return { url, id: sheetMatch[1], kind: 'google_sheet' };
    const slideMatch = path.match(/\/presentation\/d\/([^/?#]+)/);
    if (slideMatch) return { url, id: slideMatch[1], kind: 'google_slide' };
    const drawingMatch = path.match(/\/drawings\/d\/([^/?#]+)/);
    if (drawingMatch) return { url, id: drawingMatch[1], kind: 'google_drawing' };
  }

  return null;
}

function safeFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim();
  return (cleaned || 'google-drive-file').slice(0, 180);
}

function extensionForMime(mimeType: string): string {
  const map: Record<string, string> = {
    'application/pdf': 'pdf',
    'application/zip': 'zip',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'text/plain': 'txt',
    'text/csv': 'csv',
  };
  return map[mimeType] || 'bin';
}

function ensureExtension(filename: string, mimeType: string): string {
  if (/\.[a-z0-9]{2,8}$/i.test(filename)) return filename;
  return `${filename}.${extensionForMime(mimeType)}`;
}

function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const utfMatch = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch) return safeFilename(decodeURIComponent(utfMatch[1]));
  const match = header.match(/filename="?([^";]+)"?/i);
  return match ? safeFilename(match[1]) : null;
}

async function fetchBuffer(url: string): Promise<{ buffer: Buffer; mimeType: string; filename: string | null }> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`download failed (${res.status})`);

  const contentLength = Number(res.headers.get('content-length') || 0);
  if (contentLength > MAX_IMPORT_BYTES) {
    throw new Error(`file exceeds ${(MAX_IMPORT_BYTES / 1024 / 1024).toFixed(0)} MB import limit`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > MAX_IMPORT_BYTES) {
    throw new Error(`file exceeds ${(MAX_IMPORT_BYTES / 1024 / 1024).toFixed(0)} MB import limit`);
  }

  const mimeType = (res.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim();
  const filename = filenameFromDisposition(res.headers.get('content-disposition'));
  return { buffer, mimeType, filename };
}

async function listPublicFolderFiles(folderId: string): Promise<DriveFile[]> {
  const apiKey = process.env.GOOGLE_DRIVE_API_KEY?.trim();
  if (!apiKey) throw new Error('GOOGLE_DRIVE_API_KEY is required for Drive folder links');

  const files: DriveFile[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 5; page++) {
    const url = new URL('https://www.googleapis.com/drive/v3/files');
    url.searchParams.set('key', apiKey);
    url.searchParams.set('q', `'${folderId}' in parents and trashed=false`);
    url.searchParams.set('fields', 'nextPageToken,files(id,name,mimeType,size)');
    url.searchParams.set('pageSize', '100');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url);
    if (!res.ok) throw new Error(`folder listing failed (${res.status})`);
    const data = await res.json();
    files.push(...((data.files || []) as DriveFile[]));
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return files;
}

function exportMimeForGoogleType(kind: GoogleLinkKind): string {
  if (kind === 'google_sheet') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  return 'application/pdf';
}

function exportUrlForGoogleLink(link: GoogleLink, mimeType: string): string {
  if (link.kind === 'google_doc') return `https://docs.google.com/document/d/${link.id}/export?format=pdf`;
  if (link.kind === 'google_sheet') return `https://docs.google.com/spreadsheets/d/${link.id}/export?format=xlsx`;
  if (link.kind === 'google_slide') return `https://docs.google.com/presentation/d/${link.id}/export/pdf`;
  if (link.kind === 'google_drawing') return `https://docs.google.com/drawings/d/${link.id}/export/pdf`;

  const apiKey = process.env.GOOGLE_DRIVE_API_KEY?.trim();
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${link.id}/export`);
  url.searchParams.set('mimeType', mimeType);
  if (apiKey) url.searchParams.set('key', apiKey);
  return url.toString();
}

async function downloadDriveFile(file: DriveFile, sourceUrl: string): Promise<DownloadedFile | null> {
  if (file.mimeType === 'application/vnd.google-apps.folder') return null;

  const apiKey = process.env.GOOGLE_DRIVE_API_KEY?.trim();
  const isGoogleApp = file.mimeType.startsWith('application/vnd.google-apps.');
  const exportMime = file.mimeType === 'application/vnd.google-apps.spreadsheet'
    ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    : isGoogleApp
      ? 'application/pdf'
      : file.mimeType;

  let url: string;
  if (isGoogleApp) {
    const exportUrl = new URL(`https://www.googleapis.com/drive/v3/files/${file.id}/export`);
    exportUrl.searchParams.set('mimeType', exportMime);
    if (apiKey) exportUrl.searchParams.set('key', apiKey);
    url = exportUrl.toString();
  } else {
    const mediaUrl = new URL(`https://www.googleapis.com/drive/v3/files/${file.id}`);
    mediaUrl.searchParams.set('alt', 'media');
    if (apiKey) mediaUrl.searchParams.set('key', apiKey);
    url = mediaUrl.toString();
  }

  const downloaded = await fetchBuffer(url);
  if (downloaded.mimeType === 'text/html') {
    throw new Error('Google returned an HTML page instead of file bytes; link may be private or require confirmation');
  }
  const filename = ensureExtension(safeFilename(file.name || downloaded.filename || 'google-drive-file'), exportMime);
  return { buffer: downloaded.buffer, filename, mimeType: exportMime || downloaded.mimeType };
}

async function downloadGoogleLink(link: GoogleLink): Promise<DownloadedFile> {
  if (link.kind === 'drive_file') {
    const directUrl = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(link.id)}`;
    const downloaded = await fetchBuffer(directUrl);
    if (downloaded.mimeType === 'text/html') {
      throw new Error('Google returned an HTML page instead of file bytes; link may be private or require confirmation');
    }
    const filename = ensureExtension(safeFilename(downloaded.filename || `drive-${link.id}`), downloaded.mimeType);
    return { buffer: downloaded.buffer, filename, mimeType: downloaded.mimeType };
  }

  const mimeType = exportMimeForGoogleType(link.kind);
  const downloaded = await fetchBuffer(exportUrlForGoogleLink(link, mimeType));
  if (downloaded.mimeType === 'text/html') {
    throw new Error('Google returned an HTML page instead of file bytes; link may be private');
  }
  const filename = ensureExtension(safeFilename(downloaded.filename || `${link.kind}-${link.id}`), mimeType);
  return { buffer: downloaded.buffer, filename, mimeType };
}

async function alreadyImported(projectId: string, driveFileId: string, sourceUrl: string): Promise<boolean> {
  const { data: byId } = await supabaseAdmin
    .from('sabi_attachments')
    .select('id')
    .eq('project_id', projectId)
    .eq('extracted_data->>drive_file_id', driveFileId)
    .limit(1);
  if (byId && byId.length > 0) return true;

  const { data: byUrl } = await supabaseAdmin
    .from('sabi_attachments')
    .select('id')
    .eq('project_id', projectId)
    .eq('extracted_data->>source_url', sourceUrl)
    .limit(1);
  return !!(byUrl && byUrl.length > 0);
}

async function storeImportedFile(input: {
  projectId: string;
  gmailMessageId: string | null;
  sourceUrl: string;
  driveFileId: string;
  file: DownloadedFile;
}): Promise<{ filename: string; storagePath: string }> {
  const filename = safeFilename(input.file.filename);
  const storagePath = `projects/${input.projectId}/google-links/${input.driveFileId}-${randomUUID()}-${filename}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, input.file.buffer, {
      contentType: input.file.mimeType || 'application/octet-stream',
      upsert: false,
    });
  if (uploadError) throw new Error(`storage upload failed: ${uploadError.message}`);

  const { error: insertError } = await supabaseAdmin.from('sabi_attachments').insert({
    project_id: input.projectId,
    filename,
    mime_type: input.file.mimeType || null,
    size_bytes: input.file.buffer.length,
    attachment_id: null,
    message_id: input.gmailMessageId,
    file_type: classifyFileType(filename),
    storage_path: storagePath,
    extracted_data: {
      source: 'google_link',
      source_url: input.sourceUrl,
      drive_file_id: input.driveFileId,
    },
  });
  if (insertError) throw new Error(`attachment insert failed: ${insertError.message}`);

  return { filename, storagePath };
}

export async function importGoogleLinksForProject(input: {
  projectId: string;
  gmailMessageId?: string | null;
  body: string;
}): Promise<GoogleLinkImportResult> {
  const links = extractGoogleLinksFromText(input.body);
  const result: GoogleLinkImportResult = {
    linksFound: links.length,
    filesImported: 0,
    skipped: [],
    failures: [],
    imported: [],
  };

  for (const link of links) {
    try {
      if (link.kind === 'drive_folder') {
        const files = await listPublicFolderFiles(link.id);
        for (const file of files) {
          try {
            if (await alreadyImported(input.projectId, file.id, link.url)) {
              result.skipped.push({ url: link.url, reason: `already imported ${file.name}` });
              continue;
            }
            const downloaded = await downloadDriveFile(file, link.url);
            if (!downloaded) {
              result.skipped.push({ url: link.url, reason: `skipped folder ${file.name}` });
              continue;
            }
            const stored = await storeImportedFile({
              projectId: input.projectId,
              gmailMessageId: input.gmailMessageId || null,
              sourceUrl: link.url,
              driveFileId: file.id,
              file: downloaded,
            });
            result.filesImported++;
            result.imported.push({ filename: stored.filename, sourceUrl: link.url, driveFileId: file.id, storagePath: stored.storagePath });
          } catch (err: any) {
            result.failures.push({ url: link.url, error: `${file.name}: ${err.message || err}` });
          }
        }
        continue;
      }

      if (await alreadyImported(input.projectId, link.id, link.url)) {
        result.skipped.push({ url: link.url, reason: 'already imported' });
        continue;
      }

      const downloaded = await downloadGoogleLink(link);
      const stored = await storeImportedFile({
        projectId: input.projectId,
        gmailMessageId: input.gmailMessageId || null,
        sourceUrl: link.url,
        driveFileId: link.id,
        file: downloaded,
      });
      result.filesImported++;
      result.imported.push({ filename: stored.filename, sourceUrl: link.url, driveFileId: link.id, storagePath: stored.storagePath });
    } catch (err: any) {
      result.failures.push({ url: link.url, error: err.message || String(err) });
    }
  }

  return result;
}
