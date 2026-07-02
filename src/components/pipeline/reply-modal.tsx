'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Send, Loader2, Paperclip, FileText } from 'lucide-react';
import { resolveTemplate, DEFAULT_REPLY_TEMPLATES, ProjectData, SavedTemplate } from '@/lib/email/reply-templates';
import { ProjectDetail } from '@/lib/shared/types';
import { uploadFile } from '@/lib/storage/multipart-uploader';

interface ReplyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSent: () => void;
  project: ProjectDetail;
  defaultTemplate?: string;
}

export default function ReplyModal({ isOpen, onClose, onSent, project, defaultTemplate }: ReplyModalProps) {
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('info@realsoft.example');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [attachBoq, setAttachBoq] = useState(false);
  const [attachBoqPdf, setAttachBoqPdf] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTemplate, setActiveTemplate] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [templates, setTemplates] = useState<SavedTemplate[]>(DEFAULT_REPLY_TEMPLATES);

  // Supabase Free plan caps individual objects at 50 MB. Pre-validate so the
  // user gets a fast rejection instead of waiting for the presign endpoint
  // to respond with 413.
  const PER_FILE_MAX_BYTES = 50 * 1024 * 1024;
  const [uploadingFile, setUploadingFile] = useState<string | null>(null);
  const [uploadPct, setUploadPct] = useState(0);

  // Build template data from project
  const templateData: ProjectData = {
    project_name: project.project_name,
    email_subject: project.email_subject,
    email_from: project.email_from,
    client_name: project.client_name,
    location: project.location,
    total_area_sqft: project.total_area_sqft,
    floors: project.floors,
    typical_height_m: project.typical_height_m,
    building_type: project.building_type,
    deadline: project.deadline,
    services: project.services?.map(s => ({ service_type: s.service_type })),
    attachments: project.attachments?.map(a => ({ id: a.id })),
    estimation: project.estimation ? {
      final_quote_aed: project.estimation.final_quote_aed,
      generated_boq_url: project.estimation.generated_boq_url,
      sent_at: project.estimation.sent_at,
      cost_per_sqft_aed: project.estimation.cost_per_sqft_aed,
      margin_percent: project.estimation.margin_percent,
    } : null,
  };

  // Fetch templates from API on open
  useEffect(() => {
    if (isOpen) {
      fetch('/api/reply-templates')
        .then(r => r.json())
        .then(data => {
          if (data.templates?.length) setTemplates(data.templates);
        })
        .catch(() => { /* use defaults */ });
    }
  }, [isOpen]);

  // Apply default template on open
  useEffect(() => {
    if (isOpen && templates.length > 0) {
      const key = defaultTemplate || templates[0]?.key || 'acknowledge';
      applyTemplate(key);
      setSent(false);
      setError(null);
    }
  }, [isOpen, templates, defaultTemplate]);

  const applyTemplate = (key: string) => {
    const saved = templates.find(t => t.key === key);
    if (!saved) return;
    const resolved = resolveTemplate(saved, templateData);
    setActiveTemplate(key);
    setTo(project.email_from);
    setSubject(resolved.resolvedSubject);
    setBody(resolved.resolvedBody);
    setAttachBoq(!!saved.attachBoq && !!project.estimation?.generated_boq_url);
    // PDF mirrors the XLSX toggle by default — same template intent, two formats
    setAttachBoqPdf(!!saved.attachBoq && !!project.estimation?.generated_boq_url);
    setError(null);
  };

  const handleFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []);
    if (!picked.length) return;
    const oversized = picked.find(f => f.size > PER_FILE_MAX_BYTES);
    if (oversized) {
      setError(`"${oversized.name}" is ${(oversized.size / 1024 / 1024).toFixed(1)} MB — per-file limit is 50 MB on the Supabase Free plan.`);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setFiles([...files, ...picked]);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeFile = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  if (!isOpen) return null;

  const boqAvailable = !!project.estimation?.generated_boq_url;
  const clientLabel = project.client_name || project.email_from;

  const handleSend = async () => {
    if (!to || !subject || !body) {
      setError('To, Subject, and Body are required.');
      return;
    }

    setSending(true);
    setError(null);

    try {
      const htmlBody = `<div style="font-family: Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #333;">${body.replace(/\n/g, '<br/>')}</div>`;

      const extraAttachments: Array<{ filename: string; mimeType: string; storagePath: string }> = [];
      for (const f of files) {
        setUploadingFile(f.name);
        setUploadPct(0);
        const result = await uploadFile(f, {
          kind: 'reply',
          projectId: project.id,
          onProgress: setUploadPct,
        });
        extraAttachments.push({
          filename: result.filename,
          mimeType: result.mimeType,
          storagePath: result.storagePath,
        });
      }
      setUploadingFile(null);

      const res = await fetch('/api/gmail/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to,
          subject,
          body: htmlBody,
          cc: cc || undefined,
          threadId: project.email_thread_id || undefined,
          attachmentUrl: attachBoq ? project.estimation?.generated_boq_url : undefined,
          attachBoqPdf: attachBoqPdf || undefined,
          extraAttachments: extraAttachments.length ? extraAttachments : undefined,
          projectId: project.id,
          templateUsed: activeTemplate,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.details || data.error || 'Failed to send');
      }

      setSent(true);
      setTimeout(() => {
        onSent();
        onClose();
      }, 1500);
    } catch (err: any) {
      setError(err.message || 'Failed to send email');
    } finally {
      setSending(false);
      setUploadingFile(null);
      setUploadPct(0);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-2 sm:p-4">
      <div className="bg-white rounded-lg sm:rounded-xl shadow-xl w-full max-w-3xl max-h-[95vh] sm:max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Reply to {clientLabel}</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {project.project_name || project.email_subject}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {/* Success state */}
        {sent ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Send className="h-7 w-7 text-green-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900">Reply Sent</h3>
              <p className="text-sm text-gray-500 mt-1">Email sent to {to}</p>
            </div>
          </div>
        ) : (
          <>
            {/* Template selector */}
            <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/50">
              <label className="block text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-2">Template</label>
              <div className="flex flex-wrap gap-1.5">
                {templates.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => applyTemplate(t.key)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      activeTemplate === t.key
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    {t.emoji} {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Form */}
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
                  <input
                    type="email"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Cc</label>
                  <input
                    type="email"
                    value={cc}
                    onChange={(e) => setCc(e.target.value)}
                    placeholder="info@realsoft.example"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Subject</label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Message</label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={14}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none font-mono leading-relaxed"
                />
              </div>

              {/* Attach BOQ — Excel + PDF side by side */}
              {boqAvailable && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="block text-[10px] font-medium text-gray-400 uppercase tracking-wide">
                      Attach Quotation
                    </label>
                    {project.estimation?.final_quote_aed && (
                      <span className="text-xs text-gray-400">
                        AED {project.estimation.final_quote_aed.toLocaleString()}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <label className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
                      <input
                        type="checkbox"
                        checked={attachBoq}
                        onChange={(e) => setAttachBoq(e.target.checked)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <FileText className="h-3.5 w-3.5 text-emerald-600 flex-shrink-0" />
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm text-gray-700 leading-tight">BOQ — Excel</span>
                        <span className="text-[10px] text-gray-400 leading-tight">working spreadsheet</span>
                      </div>
                    </label>
                    <label className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
                      <input
                        type="checkbox"
                        checked={attachBoqPdf}
                        onChange={(e) => setAttachBoqPdf(e.target.checked)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <FileText className="h-3.5 w-3.5 text-rose-600 flex-shrink-0" />
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm text-gray-700 leading-tight">BOQ — PDF</span>
                        <span className="text-[10px] text-gray-400 leading-tight">polished client document</span>
                      </div>
                    </label>
                  </div>
                </div>
              )}

              {/* Custom file attachments */}
              <div className="space-y-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx,.txt,.zip"
                  onChange={handleFilesSelected}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 border border-dashed border-gray-300 rounded-lg hover:bg-gray-50 hover:border-gray-400 transition-colors w-full justify-center"
                >
                  <Paperclip className="h-3.5 w-3.5" />
                  Attach files (PDF, images, docs)
                </button>
                {files.length > 0 && (
                  <div className="space-y-1">
                    {files.map((f, i) => (
                      <div
                        key={`${f.name}-${i}`}
                        className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 rounded-lg text-sm"
                      >
                        <FileText className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                        <span className="truncate text-gray-700">{f.name}</span>
                        <span className="text-xs text-gray-400 ml-auto flex-shrink-0">
                          {(f.size / 1024).toFixed(0)} KB
                        </span>
                        <button
                          type="button"
                          onClick={() => removeFile(i)}
                          className="p-0.5 hover:bg-gray-200 rounded flex-shrink-0"
                        >
                          <X className="h-3 w-3 text-gray-500" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {error && (
                <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-5 py-4 border-t border-gray-200">
              <p className="text-[10px] text-gray-400">
                {project.email_thread_id ? 'Will be sent as a threaded reply' : 'No thread ID — will send as new email'}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Discard
                </button>
                <button
                  onClick={handleSend}
                  disabled={sending}
                  className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {sending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  {uploadingFile
                    ? `Uploading ${uploadingFile} ${uploadPct}%`
                    : 'Send Reply'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
