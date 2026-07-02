'use client';

import { useEffect, useState } from 'react';
import { formatDateTime, truncate } from '@/lib/shared/utils';
import { useRouter } from 'next/navigation';
import { Mail, Paperclip, RefreshCw, AlertCircle, PenSquare, Plus, X, Download, Info, ScanLine, Loader2 } from 'lucide-react';
import ComposeModal from '@/components/pipeline/compose-modal';
import AddEmailModal from '@/components/pipeline/add-email-modal';
import AddToFolderMenu from '@/components/master/add-to-folder-menu';
import { supabaseClient } from '@/lib/storage/supabase';

interface EmailItem {
  threadId: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
  messageCount: number;
  labels: string[];
}

interface EmailDetail {
  from: string;
  subject: string;
  body: string;
  date: string;
  contentType: string;
  messageId: string;
  attachments: { filename: string; mimeType: string; size: number; attachmentId: string; syncError?: string | null }[];
  images?: string[];
}

export default function InboxPage() {
  const [emails, setEmails] = useState<EmailItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [addEmailOpen, setAddEmailOpen] = useState(false);
  const [selectedThread, setSelectedThread] = useState<string | null>(null);
  const [emailDetail, setEmailDetail] = useState<EmailDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [scanStartTime, setScanStartTime] = useState<number | null>(null);
  const [scanElapsed, setScanElapsed] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [newThreadIds, setNewThreadIds] = useState<Set<string>>(new Set());
  // Phase 10: cumulative AI savings since launch — motivational telemetry.
  // Populated on mount from /api/admin/cost-trend lifetime block. Falls
  // back silently when the endpoint is unreachable.
  const [savingsTotal, setSavingsTotal] = useState<number | null>(null);
  // Phase 11: cumulative-savings sparkline for the last 30 days. Each entry
  // is a daily running-total point — the curve climbs monotonically when
  // heuristics keep saving calls. Populated alongside savingsTotal.
  const [savingsSparkline, setSavingsSparkline] = useState<number[]>([]);
  // Phase 12: per-kind savings breakdown for the lifetime savings tooltip.
  // Lets the operator see "$2.40 from cache hits, $0.85 from spec heuristic, ..."
  // at a glance instead of just the total.
  const [savingsByKind, setSavingsByKind] = useState<Array<{ kind: string; usd: number; count: number }>>([]);
  const router = useRouter();

  useEffect(() => {
    // Manual-only sync: load existing rows from sabi_emails on mount, but
    // do NOT pull from Gmail. New mail is fetched only when the user clicks
    // "Scan Inbox" or "Refresh".
    fetchInbox();

    // Supabase Realtime — refresh the list when sabi_emails changes (e.g.
    // another tab/device ran a sync). This is reactive only; it does not
    // itself trigger a Gmail pull.
    let channel: ReturnType<typeof supabaseClient.channel> | null = null;
    try {
      channel = supabaseClient
        .channel('inbox-emails')
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'sabi_emails',
        }, () => {
          fetchInbox();
        })
        .subscribe((status: string) => {
          if (
            status === 'CHANNEL_ERROR' ||
            status === 'TIMED_OUT' ||
            status === 'CLOSED'
          ) {
            if (channel) {
              try { supabaseClient.removeChannel(channel); } catch { /* noop */ }
              channel = null;
            }
          }
        });
    } catch {
      // Supabase not configured — skip realtime
    }

    // Phase 10/11: lifetime savings number + 30-day cumulative sparkline series
    fetch('/api/admin/cost-trend?days=30')
      .then(r => r.ok ? r.json() : null)
      .then((d: { lifetime?: { total_savings_usd?: number; savings_by_kind?: Record<string, { count: number; usd: number }> }; series?: { cumulative_savings_usd?: Array<{ at: string; value: number }> } } | null) => {
        if (typeof d?.lifetime?.total_savings_usd === 'number') setSavingsTotal(d.lifetime.total_savings_usd);
        if (Array.isArray(d?.series?.cumulative_savings_usd)) {
          setSavingsSparkline(d!.series!.cumulative_savings_usd!.map(p => p.value));
        }
        if (d?.lifetime?.savings_by_kind) {
          const ranked = Object.entries(d.lifetime.savings_by_kind)
            .map(([kind, v]) => ({ kind, usd: v.usd, count: v.count }))
            .sort((a, b) => b.usd - a.usd);
          setSavingsByKind(ranked);
        }
      })
      .catch(() => { /* silent — banner is optional UX */ });

    return () => {
      if (channel) {
        try { supabaseClient.removeChannel(channel); } catch { /* noop */ }
      }
    };
  }, []);

  // Scan elapsed timer
  useEffect(() => {
    if (!scanning || !scanStartTime) { setScanElapsed(0); return; }
    const interval = setInterval(() => {
      setScanElapsed(Math.floor((Date.now() - scanStartTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [scanning, scanStartTime]);

  const syncGmail = async ({ silent = false }: { silent?: boolean } = {}) => {
    setSyncing(true);
    if (!silent) setScanResult(null);
    try {
      const res = await fetch('/api/gmail/sync', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (!silent) setScanResult(`Sync failed: ${data.details || data.error || res.statusText}`);
      } else {
        const synced = data.synced ?? 0;
        const errs = data.errors?.length || 0;
        const syncedThreadIds: string[] = data.syncedThreadIds || [];
        if (!silent) {
          setScanResult(
            synced > 0
              ? `Synced ${synced} new email${synced > 1 ? 's' : ''}${errs ? ` (${errs} errors)` : ''}`
              : 'No new emails in Gmail since last sync'
          );
        }
        if (syncedThreadIds.length > 0) {
          setNewThreadIds(new Set(syncedThreadIds));
          setTimeout(() => setNewThreadIds(new Set()), 12000);
          if (!isDemo) {
            fetch('/api/cron/poll-inbox', { method: 'POST' }).catch(() => {});
          }
        }
      }
    } catch (e: any) {
      if (!silent) setScanResult(`Sync error: ${e?.message || 'network failure'}`);
    } finally {
      setSyncing(false);
    }
  };

  const fetchInbox = async () => {
    setLoading(true);
    setError(null);
    const minDelay = new Promise(resolve => setTimeout(resolve, 600));
    try {
      const [res] = await Promise.all([
        fetch('/api/gmail/inbox?q=in:inbox+newer_than:7d&max=50'),
        minDelay,
      ]);
      if (!res.ok) throw new Error('Failed to fetch inbox');
      const data = await res.json();
      setEmails(data.emails || []);
      setIsDemo(data.demo === true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load inbox from database';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const openEmail = async (threadId: string) => {
    setSelectedThread(threadId);
    setDetailLoading(true);
    setEmailDetail(null);
    try {
      const res = await fetch(`/api/gmail/read?threadId=${threadId}`);
      if (!res.ok) throw new Error('Failed to read email');
      const data = await res.json();
      setEmailDetail(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to read email';
      setError(message);
    } finally {
      setDetailLoading(false);
    }
  };

  const closeEmail = () => {
    setSelectedThread(null);
    setEmailDetail(null);
  };

  /**
   * Tiny inline SVG sparkline. No dep, no chart library — just a polyline
   * normalised to 60×16. Renders the cumulative-savings curve next to the
   * lifetime $ figure so the operator sees the trajectory at a glance.
   */
  const renderSparkline = (values: number[]): JSX.Element | null => {
    if (values.length < 2) return null;
    const w = 60, h = 16;
    const max = Math.max(...values);
    const min = Math.min(...values);
    const range = max - min || 1;
    const step = w / (values.length - 1);
    const pts = values
      .map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / range) * h).toFixed(1)}`)
      .join(' ');
    return (
      <svg width={w} height={h} className="ml-1 inline-block align-middle">
        <polyline fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" points={pts} />
      </svg>
    );
  };

  const formatSize = (bytes: number): string => {
    if (bytes >= 1000000) return `${(bytes / 1000000).toFixed(1)}MB`;
    if (bytes >= 1000) return `${(bytes / 1000).toFixed(0)}KB`;
    return `${bytes}B`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inbox</h1>
          <p className="text-sm text-gray-500 mt-1">
            {emails.length} email{emails.length !== 1 ? 's' : ''} in monitored inbox
            {isDemo && (
              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                Demo Mode
              </span>
            )}
            {savingsTotal != null && savingsTotal > 0 && (
              <span
                className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 ring-1 ring-green-200 tabular-nums"
                title={
                  savingsByKind.length > 0
                    ? `Lifetime AI cost avoided. Top sources:\n${savingsByKind.slice(0, 6).map(k => `• ${k.kind}: $${k.usd.toFixed(2)} (${k.count}×)`).join('\n')}\n\n30d sparkline: cumulative savings curve.`
                    : 'Cumulative AI cost avoided by heuristic-first paths since launch.'
                }
              >
                Saved ${savingsTotal.toFixed(2)}
                {renderSparkline(savingsSparkline)}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={async () => {
              setScanning(true);
              setScanResult(null);
              setScanStartTime(Date.now());
              try {
                // Always scan demo/manual emails first
                const demoRes = await fetch('/api/demo/scan-inbox', { method: 'POST' });
                const demoData = await demoRes.json();
                let totalCreated = demoData.created || 0;
                let totalEmails = totalCreated;

                // Also scan real Gmail if connected
                let rfqs = 0;
                let ignored = 0;
                if (!isDemo) {
                  const realRes = await fetch('/api/cron/poll-inbox', { method: 'POST' });
                  const realData = await realRes.json();
                  totalCreated += realData.processed || 0;
                  totalEmails += realData.total_emails || 0;
                  rfqs = realData.rfqs || 0;
                  ignored = realData.ignored || 0;
                }

                let msg: string;
                if (totalCreated > 0) {
                  const parts = [];
                  if (rfqs > 0) parts.push(`${rfqs} RFQ${rfqs > 1 ? 's' : ''}`);
                  if (ignored > 0) parts.push(`${ignored} ignored`);
                  msg = parts.length > 0 ? parts.join(', ') : `${totalCreated} new project(s) created`;
                } else {
                  msg = 'No new emails to process — all emails already have projects';
                }
                setScanResult(msg);
                fetchInbox();
                if (totalCreated > 0) {
                  setTimeout(() => router.push('/bids'), 1500);
                }
              } catch {
                setScanResult('Scan failed');
              } finally {
                setScanning(false);
                setScanStartTime(null);
              }
            }}
            disabled={scanning}
            className="flex items-center gap-2 px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanLine className="h-4 w-4" />}
            {scanning ? `Scanning... ${scanElapsed}s` : 'Scan Inbox'}
          </button>
          <button
            onClick={() => setAddEmailOpen(true)}
            className="flex items-center gap-2 px-3 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add Email
          </button>
          <button
            onClick={() => setComposeOpen(true)}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm hover:bg-gray-50"
          >
            <PenSquare className="h-4 w-4" />
            Compose
          </button>
          <button
            onClick={async () => {
              await syncGmail();
              fetchInbox();
            }}
            disabled={loading || syncing}
            className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${(loading || syncing) ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {isDemo && !error && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-start gap-3">
          <Info className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-blue-700">
            Gmail is not connected — showing demo RFQ emails. Click <strong>Scan Inbox</strong> to process emails into projects, or <strong>Add Email</strong> to create test emails.
          </p>
        </div>
      )}

      {scanResult && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center gap-3">
          <ScanLine className="h-4 w-4 text-green-600 flex-shrink-0" />
          <p className="text-sm text-green-700 font-medium">{scanResult}</p>
        </div>
      )}

      {error && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-800">Gmail Connection Issue</p>
            <p className="text-xs text-amber-600 mt-1">{error}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Email List */}
        <div className={`bg-white rounded-xl border border-gray-200 ${selectedThread ? 'lg:col-span-2' : 'lg:col-span-5'}`}>
          {loading ? (
            <div className="divide-y divide-gray-100">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="px-4 py-3 animate-pulse">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="h-4 bg-gray-200 rounded w-48" />
                        <div className="h-3 bg-gray-100 rounded w-28 ml-auto" />
                      </div>
                      <div className="h-4 bg-gray-200 rounded w-3/4" />
                      <div className="h-3 bg-gray-100 rounded w-full" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : emails.length === 0 ? (
            <div className="p-8 text-center text-gray-400">
              <Mail className="h-10 w-10 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No emails found.</p>
              <button
                onClick={() => setAddEmailOpen(true)}
                className="mt-3 text-sm text-blue-600 hover:text-blue-800 font-medium"
              >
                Add a test email
              </button>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 max-h-[calc(100vh-280px)] overflow-y-auto">
              {emails.map((email) => {
                const isNew = newThreadIds.has(email.threadId);
                return (
                <div
                  key={email.threadId}
                  onClick={() => openEmail(email.threadId)}
                  className={`px-4 py-3 hover:bg-gray-50 transition-colors cursor-pointer ${
                    selectedThread === email.threadId ? 'bg-blue-50 border-l-2 border-l-blue-500' : ''
                  } ${isNew && selectedThread !== email.threadId ? 'bg-emerald-50/60 border-l-4 border-l-emerald-500 animate-pulse-slow' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {isNew && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-500 text-white text-[9px] font-bold uppercase tracking-wider flex-shrink-0">
                            <span className="w-1 h-1 rounded-full bg-white animate-ping" />
                            NEW
                          </span>
                        )}
                        <p className={`text-sm font-medium text-gray-900 truncate ${
                          email.labels.includes('UNREAD') ? 'font-bold' : ''
                        }`}>
                          {email.from}
                        </p>
                        <span className="text-xs text-gray-400 whitespace-nowrap">
                          {formatDateTime(email.date)}
                        </span>
                      </div>
                      <p className={`text-sm text-gray-700 truncate mt-0.5 ${
                        email.labels.includes('UNREAD') ? 'font-semibold' : ''
                      }`}>
                        {email.subject}
                      </p>
                      {!selectedThread && (
                        <p className="text-xs text-gray-400 truncate mt-0.5">
                          {truncate(email.snippet, 120)}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {email.labels.includes('STARRED') && (
                        <span className="text-yellow-500 text-xs">&#9733;</span>
                      )}
                      {email.labels.includes('IMPORTANT') && (
                        <span className="w-2 h-2 bg-amber-400 rounded-full" />
                      )}
                      {email.messageCount > 1 && (
                        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                          {email.messageCount}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Email Detail Panel */}
        {selectedThread && (
          <div className="lg:col-span-3 bg-white rounded-xl border border-gray-200 max-h-[calc(100vh-280px)] overflow-y-auto">
            {detailLoading ? (
              <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
              </div>
            ) : emailDetail ? (
              <div>
                {/* Email Header */}
                <div className="sticky top-0 bg-white border-b border-gray-200 px-5 py-4 z-10">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <h2 className="text-lg font-semibold text-gray-900">
                        {emailDetail.subject || '(No Subject)'}
                      </h2>
                      <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
                        <span className="font-medium text-gray-700">{emailDetail.from}</span>
                        <span>{formatDateTime(emailDetail.date)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <AddToFolderMenu
                        descriptor={{ source: 'email', threadId: selectedThread, messageId: emailDetail.messageId }}
                        compact
                      />
                      <button
                        onClick={closeEmail}
                        className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                      >
                        <X className="h-5 w-5" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Attachments */}
                {emailDetail.attachments && emailDetail.attachments.length > 0 && (
                  <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
                    <p className="text-xs font-medium text-gray-500 mb-2">
                      <Paperclip className="h-3.5 w-3.5 inline mr-1" />
                      {emailDetail.attachments.length} Attachment{emailDetail.attachments.length > 1 ? 's' : ''}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {emailDetail.attachments.map((att, i) => {
                        const ext = att.filename.split('.').pop()?.toLowerCase() || '';
                        const hasSyncError = !!att.syncError;
                        const colorMap: Record<string, string> = {
                          pdf: 'border-red-200 bg-red-50 text-red-700',
                          zip: 'border-amber-200 bg-amber-50 text-amber-700',
                          xlsx: 'border-green-200 bg-green-50 text-green-700',
                          xls: 'border-green-200 bg-green-50 text-green-700',
                          dwg: 'border-blue-200 bg-blue-50 text-blue-700',
                          docx: 'border-indigo-200 bg-indigo-50 text-indigo-700',
                        };
                        const color = hasSyncError
                          ? 'border-red-300 bg-red-100 text-red-800'
                          : (colorMap[ext] || 'border-gray-200 bg-white text-gray-700');

                        return (
                          <span
                            key={i}
                            title={hasSyncError ? `Sync failed: ${att.syncError}` : att.filename}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-xs ${color}`}
                          >
                            {hasSyncError ? (
                              <AlertCircle className="h-3 w-3 text-red-600" />
                            ) : (
                              <Download className="h-3 w-3" />
                            )}
                            <span className="truncate max-w-[180px]">{att.filename}</span>
                            {hasSyncError ? (
                              <span className="opacity-75 text-red-600">sync failed</span>
                            ) : att.size > 0 ? (
                              <span className="opacity-60">({formatSize(att.size)})</span>
                            ) : null}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Email Body */}
                <div className="px-5 py-4">
                  {emailDetail.contentType?.includes('html') ? (
                    <div
                      className="prose prose-sm max-w-none text-gray-700"
                      dangerouslySetInnerHTML={{ __html: emailDetail.body }}
                    />
                  ) : (
                    <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans">
                      {emailDetail.body}
                    </pre>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-8 text-center text-gray-400">
                <p className="text-sm">Failed to load email.</p>
              </div>
            )}
          </div>
        )}
      </div>

      <ComposeModal
        isOpen={composeOpen}
        onClose={() => setComposeOpen(false)}
        onSent={() => {
          setComposeOpen(false);
          fetchInbox();
        }}
      />

      <AddEmailModal
        isOpen={addEmailOpen}
        onClose={() => setAddEmailOpen(false)}
        onAdded={() => {
          setAddEmailOpen(false);
          fetchInbox();
        }}
      />
    </div>
  );
}
