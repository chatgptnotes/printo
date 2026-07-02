'use client';

import { useState, useRef, useCallback } from 'react';
import { RefreshCw, Mail } from 'lucide-react';

interface SyncResult {
  rfqs: number;
  processed: number;
  ignored: number;
  failed: number;
  newProjects: Array<{ id: string; name: string }>;
}

interface SyncTimerProps {
  onSyncComplete: (result: SyncResult) => void;
}

/**
 * Manual-only inbox sync button. No auto-polling, no countdown.
 * Emails are only fetched when the user explicitly clicks "Check Inbox".
 * This eliminates all background egress from email polling.
 */
export default function SyncTimer({ onSyncComplete }: SyncTimerProps) {
  const [syncing, setSyncing] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const syncInFlight = useRef(false);

  const performSync = useCallback(async () => {
    if (syncInFlight.current) return;
    syncInFlight.current = true;
    setSyncing(true);
    setLastResult(null);
    try {
      await fetch('/api/demo/scan-inbox', { method: 'POST' });
      const res = await fetch('/api/cron/poll-inbox', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      const newProjects = (data.new_projects || []).map((p: { id: string; project_name?: string; email_subject?: string }) => ({
        id: p.id,
        name: p.project_name || p.email_subject || 'Untitled',
      }));

      const result = {
        rfqs: data.rfqs || 0,
        processed: data.processed || 0,
        ignored: data.ignored || 0,
        failed: data.failed || 0,
        newProjects,
      };
      onSyncComplete(result);

      // Show brief result summary
      if (result.rfqs > 0) {
        setLastResult(`${result.rfqs} new RFQ${result.rfqs > 1 ? 's' : ''}`);
      } else {
        setLastResult('No new emails');
      }
      setTimeout(() => setLastResult(null), 4000);
    } catch {
      setLastResult('Sync failed');
      setTimeout(() => setLastResult(null), 4000);
    } finally {
      syncInFlight.current = false;
      setSyncing(false);
    }
  }, [onSyncComplete]);

  return (
    <div className="flex items-center gap-2">
      {lastResult && (
        <span className={`text-xs px-2 py-1 rounded ${
          lastResult.includes('new RFQ') ? 'text-green-600 bg-green-50' : 'text-gray-500 bg-gray-50'
        }`}>
          {lastResult}
        </span>
      )}
      <button
        onClick={performSync}
        disabled={syncing}
        title="Check inbox for new emails"
        className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
      >
        {syncing ? (
          <>
            <RefreshCw className="h-4 w-4 animate-spin" />
            Checking...
          </>
        ) : (
          <>
            <Mail className="h-4 w-4" />
            Check Inbox
          </>
        )}
      </button>
    </div>
  );
}
