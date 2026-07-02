'use client';

import { useEffect, useState } from 'react';
import { X, Mail, Paperclip, Loader2, ChevronLeft } from 'lucide-react';
import { formatDateTime, truncate } from '@/lib/shared/utils';
import { useToast } from '@/contexts/toast-context';

interface EmailItem {
  threadId: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
  messageCount: number;
}

interface EmailDetail {
  from: string;
  subject: string;
  date: string;
  messageId: string;
  attachments: { filename: string; mimeType: string; size: number; attachmentId: string }[];
}

/**
 * "Add from Mail" picker. Lists synced inbox threads (same source the Inbox
 * page uses), opens a thread to reveal its attachments + body, and files the
 * chosen pieces into the folder via the source='email' descriptor.
 */
export default function InboxPickerModal({
  folderId,
  isOpen,
  onClose,
  onAdded,
}: {
  folderId: string;
  isOpen: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const { toast } = useToast();
  const [emails, setEmails] = useState<EmailItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<EmailDetail | null>(null);
  const [detailThreadId, setDetailThreadId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [includeBody, setIncludeBody] = useState(true);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setDetail(null);
    setDetailThreadId(null);
    setSelected(new Set());
    setIncludeBody(true);
    (async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/gmail/inbox?q=in:inbox+newer_than:7d&max=50');
        const data = await res.json();
        setEmails(data.emails || []);
      } catch {
        setEmails([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [isOpen]);

  const openThread = async (threadId: string) => {
    setDetailThreadId(threadId);
    setDetailLoading(true);
    setDetail(null);
    setSelected(new Set());
    setIncludeBody(true);
    try {
      const res = await fetch(`/api/gmail/read?threadId=${threadId}`);
      const data = await res.json();
      setDetail(data);
      // Pre-select all attachments by default.
      setSelected(new Set((data.attachments || []).map((a: { attachmentId: string }) => a.attachmentId)));
    } catch {
      toast('Failed to open email', 'error');
    } finally {
      setDetailLoading(false);
    }
  };

  const toggleAtt = (attachmentId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(attachmentId)) next.delete(attachmentId);
      else next.add(attachmentId);
      return next;
    });
  };

  const addSelected = async () => {
    if (!detail || !detailThreadId) return;
    if (!includeBody && selected.size === 0) {
      toast('Select an attachment or include the mail body', 'info');
      return;
    }
    setAdding(true);
    try {
      const res = await fetch(`/api/folders/${folderId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'email',
          threadId: detailThreadId,
          messageId: detail.messageId,
          attachmentIds: Array.from(selected),
          includeBody,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.details || data.error || 'Failed');
      const n = data.added ?? 0;
      toast(n > 0 ? `Added ${n} item${n > 1 ? 's' : ''}` : 'Already in folder', n > 0 ? 'success' : 'info');
      onAdded();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to add', 'error');
    } finally {
      setAdding(false);
    }
  };

  if (!isOpen) return null;

  const formatSize = (b: number) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)}MB` : b >= 1e3 ? `${(b / 1e3).toFixed(0)}KB` : `${b}B`);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Mail className="h-5 w-5 text-blue-600" /> Add from Mail
          </h2>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {!detail && !detailLoading ? (
            loading ? (
              <div className="flex items-center justify-center h-40 text-gray-400">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : emails.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">No emails in the synced inbox.</div>
            ) : (
              <div className="divide-y divide-gray-100">
                {emails.map((em) => (
                  <button
                    key={em.threadId}
                    onClick={() => openThread(em.threadId)}
                    className="w-full text-left px-5 py-3 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-gray-900 truncate">{em.from}</span>
                      <span className="text-xs text-gray-400 whitespace-nowrap">{formatDateTime(em.date)}</span>
                    </div>
                    <p className="text-sm text-gray-700 truncate mt-0.5">{em.subject}</p>
                    <p className="text-xs text-gray-400 truncate mt-0.5">{truncate(em.snippet, 100)}</p>
                  </button>
                ))}
              </div>
            )
          ) : detailLoading ? (
            <div className="flex items-center justify-center h-40 text-gray-400">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : detail ? (
            <div className="p-5">
              <button
                onClick={() => { setDetail(null); setDetailThreadId(null); }}
                className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3"
              >
                <ChevronLeft className="h-4 w-4" /> Back to list
              </button>
              <h3 className="font-semibold text-gray-900">{detail.subject || '(No subject)'}</h3>
              <p className="text-xs text-gray-500 mt-0.5">{detail.from} · {formatDateTime(detail.date)}</p>

              <label className="flex items-center gap-2 mt-4 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" checked={includeBody} onChange={(e) => setIncludeBody(e.target.checked)} className="rounded" />
                Include mail body (email)
              </label>

              <div className="mt-4">
                <p className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1">
                  <Paperclip className="h-3.5 w-3.5" />
                  {detail.attachments.length} attachment{detail.attachments.length !== 1 ? 's' : ''}
                </p>
                {detail.attachments.length === 0 ? (
                  <p className="text-xs text-gray-400">No attachments on this email.</p>
                ) : (
                  <div className="space-y-1.5">
                    {detail.attachments.map((att) => (
                      <label key={att.attachmentId} className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                        <input type="checkbox" checked={selected.has(att.attachmentId)} onChange={() => toggleAtt(att.attachmentId)} className="rounded" />
                        <span className="text-sm text-gray-700 truncate flex-1">{att.filename}</span>
                        {att.size > 0 && <span className="text-xs text-gray-400">{formatSize(att.size)}</span>}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        {detail && (
          <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button
              onClick={addSelected}
              disabled={adding}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Add to folder
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
