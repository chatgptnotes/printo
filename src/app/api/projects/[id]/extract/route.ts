import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { extractProjectInfo, analyzeSpecifications, classifyDrawingDiscipline, classifyReputation, type AttachmentFile, type SpecAnalysisResult } from '@/lib/ai/claude-api';
import { logActivity, updateProjectStatus } from '@/lib/storage/activity-logger';
import { getAttachmentBuffer, loadAttachmentBuffer } from '@/lib/storage/attachment-storage';
import { requireAuth } from '@/lib/shared/api-auth';
// @ts-ignore - import the actual parser, not the test wrapper
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { runOcrOnImageBuffer } from '@/lib/pdf/ocr-image';
import { runOcrOnPdfBuffer } from '@/lib/pdf/ocr-pdf';
import AdmZip from 'adm-zip';
import ExcelJS from 'exceljs';
import { createExtractorFromData } from 'node-unrar-js';
import { extract7z } from '@/lib/storage/sevenzip';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Hard cap on attachment size to prevent OOM crashes. Env-configurable via
// MAX_ATTACHMENT_MB; default 500 MB (raised from 200 MB per 2026-04-16 demo
// pg 24 — BT confirmed the cap should be higher for large client ZIPs).
// Vercel functions have ~1 GB memory on hobby, ~3 GB on pro; keep a healthy
// margin so the function doesn't OOM while decompressing.
const MAX_ATTACHMENT_MB = Number(process.env.MAX_ATTACHMENT_MB) || 500;
const MAX_ATTACHMENT_BYTES = MAX_ATTACHMENT_MB * 1024 * 1024;
// Per-archive entry cap — protects against zip bombs.
const MAX_EXTRACTED_ENTRY_BYTES = Math.max(500, MAX_ATTACHMENT_MB) * 1024 * 1024;

function safeStoragePathSegment(value: string): string {
  return value
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .map(part => part.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'file')
    .join('/');
}

function classifyFileType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const typeMap: Record<string, string> = {
    dwg: 'drawing_autocad', dxf: 'drawing_autocad', dgn: 'drawing_autocad',
    rvt: 'drawing_revit', rfa: 'drawing_revit', ifc: 'drawing_bim',
    pdf: 'drawing_pdf', doc: 'specification', docx: 'specification',
    xls: 'schedule_excel', xlsx: 'schedule_excel', xlsm: 'schedule_excel', csv: 'schedule_excel',
    zip: 'archive_zip', rar: 'archive_zip', '7z': 'archive_zip',
    jpg: 'image', jpeg: 'image', png: 'image', svg: 'image', bmp: 'image', tiff: 'image',
    ppt: 'presentation', pptx: 'presentation', json: 'other', txt: 'specification',
  };
  return typeMap[ext] || 'other';
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const { id } = params;

    const { data: project, error } = await supabaseAdmin
      .from('sabi_projects')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Guard: warn if project was classified as "ignore" (Not RFQ)
    if (project.priority === 'ignore') {
      return NextResponse.json(
        { error: 'Project classified as "Ignore" (Not RFQ). Change priority before processing.', code: 'IGNORE_PRIORITY' },
        { status: 400 }
      );
    }

    await logActivity(id, 4, 'Unload Attachments', 'started');
    await updateProjectStatus(id, 'extracting');

    // Get attachments and extract text from PDFs
    let { data: attachments } = await supabaseAdmin
      .from('sabi_attachments')
      .select('*')
      .eq('project_id', id);

    // If no attachments in sabi_attachments, try to backfill from sabi_email_attachments
    if ((!attachments || attachments.length === 0) && project.email_id) {
      const { data: emailAtts } = await supabaseAdmin
        .from('sabi_email_attachments')
        .select('*')
        .eq('email_id', project.email_id);

      if (emailAtts && emailAtts.length > 0) {
        const rows = emailAtts.map((att: any) => ({
          project_id: id,
          filename: att.filename || 'unknown',
          mime_type: att.mime_type || null,
          size_bytes: att.size_bytes || null,
          attachment_id: att.gmail_attachment_id || null,
          message_id: att.gmail_message_id,
          file_type: classifyFileType(att.filename || ''),
          storage_path: att.storage_path || null,
        }));
        await supabaseAdmin.from('sabi_attachments').insert(rows);

        // Re-fetch
        const { data: refetched } = await supabaseAdmin
          .from('sabi_attachments')
          .select('*')
          .eq('project_id', id);
        attachments = refetched;

        // Backfill is informational — not its own step row. Console only to
        // avoid duplicate step-4 entries in the activity log.
        console.log(`[extract] Backfilled ${emailAtts.length} attachments from sabi_email_attachments`);
      }
    }

    // Step 4 ends here — the rest is step 5 (Extract Attachment Archive).
    const zipAttachments = (attachments || []).filter(a =>
      (a.filename || '').toLowerCase().match(/\.(zip|rar|7z)$/)
    );
    const hasAttachments = (attachments || []).length > 0;
    await logActivity(id, 4, 'Unload Attachments', 'completed', {
      total_attachments: (attachments || []).length,
      zip_files: zipAttachments.length,
    });

    // Step 5 — Extract Attachment Archive (only the archive-extraction loop;
    // separate step from "Unload" so the activity log shows distinct rows).
    if (zipAttachments.length > 0) {
      await logActivity(id, 5, 'Extract Attachment Archive', 'started', { zip_count: zipAttachments.length });

      // Per-zip results — collected here, logged once after the loop instead
      // of one activity row per archive (was producing 5+ duplicate step-4 rows).
      const zipResults: Array<{ file: string; status: 'extracted' | 'failed' | 'too_large' | 'unsupported'; details?: unknown }> = [];

      for (const zipAtt of zipAttachments) {
        if (!(zipAtt.attachment_id && zipAtt.message_id) && !zipAtt.storage_path) {
          zipResults.push({
            file: zipAtt.filename,
            status: 'failed',
            details: 'Archive has no storage_path and no Gmail attachment ids',
          });
          continue;
        }

        // Enforce size limit BEFORE downloading
        if (zipAtt.size_bytes && zipAtt.size_bytes > MAX_ATTACHMENT_BYTES) {
          zipResults.push({ file: zipAtt.filename, status: 'too_large',
            details: `${(zipAtt.size_bytes / 1024 / 1024).toFixed(1)}MB > ${MAX_ATTACHMENT_BYTES / 1024 / 1024}MB limit` });
          continue;
        }

        const ext = (zipAtt.filename || '').toLowerCase().split('.').pop();

        try {
          const archiveBuffer = await loadAttachmentBuffer(zipAtt);

          // Extracted entries: { fileName, fullPath, buffer, size }
          let entries: Array<{ fileName: string; fullPath: string; buffer: Buffer; size: number }> = [];

          if (ext === 'zip') {
            const zip = new AdmZip(archiveBuffer);
            entries = zip.getEntries()
              .filter(e => !e.isDirectory && !e.entryName.startsWith('__MACOSX'))
              .map(e => ({
                fileName: e.entryName.split('/').pop() || e.entryName,
                fullPath: e.entryName,
                buffer: e.getData(),
                size: e.header.size,
              }));
          } else if (ext === 'rar') {
            // node-unrar-js requires an ArrayBuffer
            const arrayBuf = archiveBuffer.buffer.slice(
              archiveBuffer.byteOffset,
              archiveBuffer.byteOffset + archiveBuffer.byteLength
            ) as ArrayBuffer;
            const extractor = await createExtractorFromData({ data: arrayBuf });
            const list = extractor.getFileList();
            const fileHeaders = [...list.fileHeaders];
            const wantedNames = fileHeaders
              .filter(h => !h.flags.directory)
              .map(h => h.name);
            const extracted = extractor.extract({ files: wantedNames });
            const files = [...extracted.files];
            entries = files
              .filter(f => f.fileHeader && !f.fileHeader.flags.directory && f.extraction)
              .map(f => {
                const data = f.extraction as Uint8Array;
                return {
                  fileName: f.fileHeader.name.split('/').pop() || f.fileHeader.name,
                  fullPath: f.fileHeader.name,
                  buffer: Buffer.from(data),
                  size: data.length,
                };
              });
          } else if (ext === '7z') {
            entries = await extract7z(archiveBuffer);
          } else {
            continue;
          }

          // Filter zip-bomb entries
          entries = entries.filter(e => {
            if (e.size > MAX_EXTRACTED_ENTRY_BYTES) {
              console.warn(`Skipping oversized entry ${e.fileName} (${(e.size / 1024 / 1024).toFixed(1)}MB)`);
              return false;
            }
            return true;
          });

          for (const entry of entries) {
            const fileType = classifyExtractedFileType(entry.fullPath);
            const fullPath = entry.fullPath.replace(/\\/g, '/').replace(/^\/+/, '');

            // Skip if already extracted (prevent duplicates on re-run)
            const { data: existing } = await supabaseAdmin
              .from('sabi_attachments')
              .select('id')
              .eq('project_id', id)
              .eq('extracted_data->>source_archive_id', zipAtt.id)
              .eq('extracted_data->>full_path', fullPath)
              .limit(1);
            if (existing && existing.length > 0) continue;

            // Upload extracted file to Supabase Storage
            let storagePath: string | null = null;
            try {
              storagePath = `projects/${id}/zip-extracted/${zipAtt.id}-${safeStoragePathSegment(zipAtt.filename)}/${safeStoragePathSegment(fullPath || entry.fileName)}`;
              await supabaseAdmin.storage.from('sabi-attachments').upload(storagePath, entry.buffer, {
                contentType: 'application/octet-stream',
                upsert: true,
              });
            } catch { storagePath = null; }

            await supabaseAdmin.from('sabi_attachments').insert({
              project_id: id,
              filename: entry.fileName,
              mime_type: null,
              size_bytes: entry.size,
              attachment_id: null,
              message_id: zipAtt.message_id,
              file_type: fileType,
              extracted_data: { source_archive_id: zipAtt.id, source_archive: zipAtt.filename, full_path: fullPath, format: ext },
              storage_path: storagePath,
            });
          }

          await supabaseAdmin.from('sabi_attachments').update({
            extracted_data: {
              ...(zipAtt.extracted_data || {}),
              contents: entries.map(e => e.fullPath.replace(/\\/g, '/').replace(/^\/+/, '')),
              files_extracted: entries.length,
              format: ext,
            },
          }).eq('id', zipAtt.id);

          zipResults.push({ file: zipAtt.filename, status: 'extracted',
            details: { format: ext, files_extracted: entries.length, file_list: entries.map(e => e.fileName) } });
        } catch (err: any) {
          console.error(`Archive extraction failed for ${zipAtt.filename}:`, err.message);
          zipResults.push({ file: zipAtt.filename, status: 'failed', details: { format: ext, error: err.message } });
        }
      }

      // Single step-5 summary row — replaces the 5+ per-zip rows that used
      // to be written inside the loop.
      const anyExtracted = zipResults.some(r => r.status === 'extracted');
      await logActivity(id, 5, 'Extract Attachment Archive', anyExtracted ? 'completed' : 'failed', {
        archive_count: zipAttachments.length,
        results: zipResults,
      });

      // Re-fetch attachments to include newly extracted files
      const { data: refreshed } = await supabaseAdmin
        .from('sabi_attachments')
        .select('*')
        .eq('project_id', id);
      attachments = refreshed;
    } else if (!hasAttachments) {
      // No attachments — step 5 is N/A. Only step 4 'skipped' is meaningful.
      await logActivity(id, 4, 'Unload Attachments', 'skipped', { reason: 'No attachments found — info added to estimation department' });
    } else {
      // Attachments exist but no archives — step 5 is skipped.
      await logActivity(id, 5, 'Extract Attachment Archive', 'skipped', { reason: 'No archives — files loaded directly' });
    }

    const attachmentNames = (attachments || []).map(a => a.filename);

    // Step 6 — List Available Documents (everything in the inventory).
    const drawings = (attachments || []).filter(a =>
      a.file_type === 'drawing_pdf' || a.file_type === 'drawing_autocad'
    );
    await logActivity(id, 6, 'List Available Documents', 'completed', {
      total_documents: (attachments || []).length,
      total_drawings: drawings.length,
    });

    // Auto-classify drawings by discipline (HVAC, electrical, plumbing, etc.)
    const disciplineResults: Array<{ filename: string; discipline: string | null; confidence: number }> = [];
    for (const att of (attachments || [])) {
      if (att.file_type !== 'drawing_pdf' && att.file_type !== 'drawing_autocad' && att.file_type !== 'image') continue;

      const extractedText = (att.extracted_data as Record<string, string>)?.text || '';
      const result = classifyDrawingDiscipline(att.filename, extractedText);

      if (result.discipline) {
        await supabaseAdmin.from('sabi_attachments').update({
          discipline: result.discipline,
        }).eq('id', att.id);
        disciplineResults.push({ filename: att.filename, discipline: result.discipline, confidence: result.confidence });
      }
    }
    // Step 7 — List Drawings (with discipline tags).
    await logActivity(id, 7, 'List Drawings', 'completed', {
      total_drawings: drawings.length,
      classified: disciplineResults.length,
      drawings: drawings.map(d => ({ name: d.filename, type: d.file_type })),
      disciplines: disciplineResults,
    });

    // Upload attachments to Supabase Storage (organized by discipline)
    for (const att of (attachments || [])) {
      if (!att.attachment_id || !att.message_id) continue;
      if (att.storage_path) continue; // already uploaded

      // Skip oversized attachments to avoid OOM crashes
      if (att.size_bytes && att.size_bytes > MAX_ATTACHMENT_BYTES) {
        console.warn(`Skipping oversized attachment ${att.filename} (${(att.size_bytes / 1024 / 1024).toFixed(1)}MB)`);
        continue;
      }

      try {
        const buffer = await getAttachmentBuffer(att.message_id, att.attachment_id);
        const discipline = disciplineResults.find(d => d.filename === att.filename)?.discipline || 'general';
        const storagePath = `projects/${id}/${discipline}/${att.filename}`;

        await supabaseAdmin.storage.from('sabi-attachments').upload(storagePath, buffer, {
          contentType: att.mime_type || 'application/octet-stream',
          upsert: true,
        });

        await supabaseAdmin.from('sabi_attachments').update({
          storage_path: storagePath,
        }).eq('id', att.id);
      } catch (err: any) {
        // Storage upload is non-critical — continue even if it fails
        console.error(`Storage upload failed for ${att.filename}:`, err.message);
      }
    }

    // Scan attachments: extract text from PDFs + collect files for Claude vision
    let pdfText = '';
    const attachmentFiles: AttachmentFile[] = [];

    for (const att of (attachments || [])) {
      // Load from Gmail (attachment_id + message_id) OR a direct storage path
      // (seeded / uploaded files only have the latter).
      if (!(att.attachment_id && att.message_id) && !att.storage_path) continue;
      const filename = (att.filename || '').toLowerCase();

      // Skip oversized attachments to avoid OOM crashes
      if (att.size_bytes && att.size_bytes > MAX_ATTACHMENT_BYTES) {
        continue;
      }

      try {
        const buffer = await loadAttachmentBuffer(att);

        if (filename.endsWith('.pdf')) {
          // Extract text from PDF — full document (up to 50K chars stored, 20K sent to AI)
          let parsedText = '';
          let parsedPages = 0;
          try {
            const parsed = await pdfParse(buffer);
            parsedText = parsed.text ?? '';
            parsedPages = parsed.numpages || 0;
            if (parsedText) {
              pdfText += `\n--- PDF: ${att.filename} (${parsedPages || '?'} pages) ---\n${parsedText.substring(0, 20000)}\n`;
            }
            await supabaseAdmin.from('sabi_attachments').update({
              extracted_data: { text: parsedText.substring(0, 50000), pages: parsedPages },
            }).eq('id', att.id);
          } catch { /* text extraction failed, visual analysis will handle it */ }

          // Scanned-PDF fallback: if pdf-parse produced essentially nothing,
          // the PDF has no embedded text layer. Run tesseract.js OCR over the
          // first few pages so AI vision doesn't need to read the print.
          if (parsedText.trim().length < 200) {
            try {
              const ocr = await runOcrOnPdfBuffer(buffer);
              if (ocr) {
                pdfText += `\n--- OCR-PDF: ${att.filename} (${ocr.pages_ocred} pages, ${ocr.durationMs}ms) ---\n${ocr.text.substring(0, 20000)}\n`;
                await supabaseAdmin.from('sabi_attachments').update({
                  extracted_data: { text: ocr.text.substring(0, 50000), pages: parsedPages, ocr_source: 'tesseract-pdf', ocr_pages: ocr.pages_ocred },
                }).eq('id', att.id);
              }
            } catch { /* OCR failed — AI vision still gets the buffer below */ }
          }

          // Also send PDF to Claude for visual analysis (drawings, schedules, tables)
          attachmentFiles.push({
            filename: att.filename,
            mimeType: 'application/pdf',
            buffer,
          });
        } else if (filename.endsWith('.png') || filename.endsWith('.jpg') || filename.endsWith('.jpeg')) {
          // OCR first — harvest text labels from drawings/scans before AI vision so
          // Sonnet doesn't waste tokens reading printed text it could be told.
          try {
            const ocr = await runOcrOnImageBuffer(buffer);
            if (ocr) {
              pdfText += `\n--- OCR: ${att.filename} (${ocr.confidence.toFixed(2)} conf, ${ocr.durationMs}ms) ---\n${ocr.text.substring(0, 8000)}\n`;
              await supabaseAdmin.from('sabi_attachments').update({
                extracted_data: { text: ocr.text.substring(0, 50000), ocr_confidence: ocr.confidence, ocr_source: 'tesseract' },
              }).eq('id', att.id);
            }
          } catch { /* OCR failed — visual AI handles it */ }

          // Always send images to AI for visual analysis (geometry, layouts, symbols)
          const mimeType = filename.endsWith('.png') ? 'image/png' : 'image/jpeg';
          attachmentFiles.push({ filename: att.filename, mimeType, buffer });
        } else if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) {
          // Parse Excel files — check if BOQ with quantities exists
          try {
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.load(buffer as any);
            const sheets: Array<{ name: string; rows: number; hasQuantities: boolean; headers: string[]; sample: string[][] }> = [];

            workbook.eachSheet((sheet) => {
              const headers: string[] = [];
              const sampleRows: string[][] = [];
              let hasQty = false;

              sheet.eachRow((row, rowNum) => {
                const values = row.values as any[];
                const cells = values.slice(1).map(v => String(v || '').trim());

                if (rowNum === 1) {
                  headers.push(...cells);
                  // Check if any header looks like quantity
                  hasQty = cells.some(c => /^(qty|quantity|qnty|no\.|nos|units|count)$/i.test(c));
                } else if (rowNum <= 5 && cells.some(c => c.length > 0)) {
                  sampleRows.push(cells.slice(0, 8)); // first 8 columns, first 4 data rows
                }
              });

              sheets.push({
                name: sheet.name,
                rows: sheet.rowCount,
                hasQuantities: hasQty,
                headers: headers.slice(0, 10),
                sample: sampleRows,
              });
            });

            const hasBoqQuantities = sheets.some(s => s.hasQuantities);

            await supabaseAdmin.from('sabi_attachments').update({
              extracted_data: {
                type: 'excel_boq',
                has_quantities: hasBoqQuantities,
                sheets: sheets,
              },
            }).eq('id', att.id);

            pdfText += `\n--- Excel: ${att.filename} ---\nSheets: ${sheets.map(s => `${s.name} (${s.rows} rows, quantities: ${s.hasQuantities})`).join(', ')}\nHeaders: ${sheets[0]?.headers.join(' | ') || 'none'}\n`;
          } catch { /* Excel parse failed */ }
        }
      } catch (err: any) {
        console.error(`Attachment processing failed for ${att.filename}:`, err.message);
      }
    }

    // Combine email body + PDF text for extraction
    const fullContent = (project.email_snippet || '') + (pdfText ? `\n\nAttachment Content:\n${pdfText}` : '');

    const result = await extractProjectInfo(
      project.email_subject || '',
      fullContent,
      attachmentNames,
      attachmentFiles
    );
    const projectInfoProvider = 'claude-sonnet-4-6';

    // Analyze specifications for brand/make requirements
    const specFiles = attachmentFiles.filter(f =>
      f.filename.toLowerCase().includes('spec') ||
      f.filename.toLowerCase().includes('specification') ||
      f.mimeType === 'application/pdf'
    );
    const specText = pdfText; // all extracted PDF text

    let specAnalysis: SpecAnalysisResult | null = null;
    const specProvider = 'claude-sonnet-4-6';
    if (specFiles.length > 0 || specText.length > 100) {
      try {
        specAnalysis = await analyzeSpecifications(specFiles, specText);
        // Spec results are folded into the single step-8 'completed' row below
        // (was previously a duplicate step-8 row — caused activity log clutter).
        if (specAnalysis && specAnalysis.requirements.length > 0) {
          console.log(`[extract] spec analysis: brands=${specAnalysis.approved_makes.length}, reqs=${specAnalysis.requirements.length}, conf=${specAnalysis.confidence}`);
        }
      } catch { /* spec analysis is non-critical */ }
    }

    // Classify reputation based on extracted data
    const reputation = await classifyReputation(
      result.client_name, result.project_name, result.location,
      result.total_area_sqft, result.building_type
    );

    // Update project with extracted data
    const { error: updateError } = await supabaseAdmin
      .from('sabi_projects')
      .update({
        client_name: result.client_name || project.client_name,
        project_name: result.project_name || project.project_name,
        location: result.location || project.location,
        floors: result.floors || project.floors,
        parking_floors: result.parking_floors || project.parking_floors,
        typical_floors: result.typical_floors || project.typical_floors,
        area_per_floor_sqft: result.area_per_floor_sqft || project.area_per_floor_sqft,
        total_area_sqft: result.total_area_sqft || project.total_area_sqft,
        typical_height_m: result.typical_height_m || project.typical_height_m,
        building_type: result.building_type || project.building_type,
        deadline: result.deadline || project.deadline,
        reputation_class: reputation.reputation_class,
        ai_extraction: {
          ...result as unknown as Record<string, unknown>,
          _provider: projectInfoProvider,
          ...(specAnalysis && {
            spec_analysis: { ...specAnalysis, _provider: specProvider },
          }),
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (updateError) {
      throw new Error(`Failed to update project: ${updateError.message}`);
    }

    // Auto-create services mentioned (default to core MEP if none detected)
    let services = result.services_mentioned;
    if (services.length === 0) {
      // For any RFQ/MEP project, default to core services
      services = ['hvac', 'electrical', 'plumbing', 'fire_fighting'] as any;
    }

    const serviceInserts = services.map((serviceType: any) => ({
      project_id: id,
      service_type: serviceType,
      is_required: true,
    }));

    // Insert services if they don't already exist
    for (const svc of serviceInserts) {
      const { data: existing } = await supabaseAdmin
        .from('sabi_services')
        .select('id')
        .eq('project_id', svc.project_id)
        .eq('service_type', svc.service_type)
        .maybeSingle();
      if (!existing) {
        await supabaseAdmin.from('sabi_services').insert(svc);
      }
    }

    // Step 8 — Extract Building + Reputation (single 'completed' row matching
    // MAIN_PIPELINE_STEPS; spec analysis details folded into the same row).
    await logActivity(id, 8, 'Extract Building + Reputation', 'completed', {
      fields_extracted: Object.keys(result).filter(k => result[k as keyof typeof result] !== null).length,
      building_type: result.building_type,
      total_area_sqft: result.total_area_sqft,
      floors: result.floors,
      services_found: result.services_mentioned.length,
      reputation_class: reputation.reputation_class,
      client_name: result.client_name,
      project_name: result.project_name,
      location: result.location,
      ...(specAnalysis && {
        spec_brands: specAnalysis.approved_makes.length,
        spec_requirements: specAnalysis.requirements.length,
        spec_confidence: specAnalysis.confidence,
      }),
    });

    // 33-step pipeline: pipeline pauses at Gate 1 / step 11 (Documents
    // Sufficient?). The extract route has already run steps 4-10 (unzip,
    // list drawings, identify services, extract project info, critical-
    // drawings + BOQ quality + scale checks). Gate 11 is the UX pause for
    // George to decide whether documents are sufficient or to request more
    // from the client.
    // MAIN pipeline: extraction completes Phase 1 steps 1-8 (info sufficiency).
    // Project pauses at MAIN Gate 1 (step 9) — Documents Sufficient — for
    // George to approve/reject before bid-decision opens.
    await supabaseAdmin
      .from('sabi_projects')
      .update({
        status: 'docs_sufficient_pending',
        notes: JSON.stringify({ approval_gate: 9 }),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    await logActivity(id, 9, 'Documents Sufficient', 'started', {
      message: 'Awaiting sufficiency decision: review drawing inventory, critical-drawings check, BOQ quality, and detected scale; proceed or request missing documents.',
    });

    return NextResponse.json({ extraction: result });
  } catch (error: any) {
    console.error('Extraction error:', error);
    // Reset status so project doesn't get stuck at 'extracting'
    await updateProjectStatus(params.id, 'classified');
    await logActivity(params.id, 4, 'Unload Attachments', 'failed', { error: error.message });
    return NextResponse.json(
      { error: 'Extraction failed', details: error.message },
      { status: 500 }
    );
  }
}

function classifyExtractedFileType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const typeMap: Record<string, string> = {
    dwg: 'drawing_autocad', dxf: 'drawing_autocad',
    pdf: 'drawing_pdf',
    xls: 'schedule_excel', xlsx: 'schedule_excel', csv: 'schedule_excel',
    doc: 'specification', docx: 'specification',
    zip: 'archive_zip', rar: 'archive_zip', '7z': 'archive_zip',
    jpg: 'image', jpeg: 'image', png: 'image', bmp: 'image', tiff: 'image',
  };
  return typeMap[ext] || 'other';
}
