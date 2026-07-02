/**
 * /admin/health — single-pane traffic-light health dashboard.
 *
 * Renders four signals from /api/admin/health as cards with green/yellow/red/
 * gray accent. Each card shows the signal's headline label + last-check
 * timestamp + drilldown link to the full JSON for that signal.
 *
 * Operator workflow: open this page, glance at the four lights. If anything
 * is yellow/red, click into the relevant admin endpoint to investigate.
 */
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type Status = 'green' | 'yellow' | 'red' | 'gray';

interface Signal {
  status: Status;
  label: string;
  last_at: string | null;
  hours_since_last: number | null;
  details: Record<string, unknown>;
}

interface HealthResponse {
  checked_at: string;
  signals: {
    nb_self_eval: Signal;
    cohort_drift: Signal;
    nb_auto_promote: Signal;
    ai_spend_trend: Signal;
  };
}

export default function HealthPage() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/health')
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)))
      .then((d: HealthResponse) => { if (!cancelled) setData(d); })
      .catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-6 max-w-5xl">
      <header>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">System health</h1>
            <p className="text-sm text-gray-500 mt-1">
              Traffic-light view of the cost-reduction telemetry signals across Phases 1–11.
            </p>
          </div>
          {data?.checked_at && (
            <p className="text-xs text-gray-400 tabular-nums">Checked {data.checked_at.slice(0, 19).replace('T', ' ')} UTC</p>
          )}
        </div>
      </header>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Failed to load /api/admin/health: {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {data?.signals && (
          <>
            <SignalCard
              title="NB classifier"
              signal={data.signals.nb_self_eval}
              drilldown={{ href: '/api/admin/nb-trend', label: 'nb-trend' }}
              hint="Self-eval cron freshness × latest holdout F1"
            />
            <SignalCard
              title="Cohort drift"
              signal={data.signals.cohort_drift}
              drilldown={{ href: '/api/admin/cohort-drift-status', label: 'drift-status' }}
              hint="Last drift cron run + how many cohorts shifted >15 % in 7d"
            />
            <SignalCard
              title="NB auto-promote"
              signal={data.signals.nb_auto_promote}
              drilldown={{ href: '/api/admin/nb-tune', label: 'nb-tune' }}
              hint="Live NB_HIGH_MARGIN value + when it was last updated"
            />
            <SignalCard
              title="AI spend trend"
              signal={data.signals.ai_spend_trend}
              drilldown={{ href: '/api/admin/cost-trend?days=30', label: 'cost-trend' }}
              hint="7d-vs-prior-7d slope on Claude token spend"
            />
          </>
        )}
      </div>

      <div className="text-xs text-gray-500">
        See <Link href="/admin" className="text-blue-600 hover:underline">/admin</Link> for the full telemetry index.
      </div>
    </div>
  );
}

function SignalCard({ title, signal, drilldown, hint }: { title: string; signal: Signal; drilldown: { href: string; label: string }; hint: string }) {
  const accent = ACCENT_BY_STATUS[signal.status];
  return (
    <div className={`rounded-2xl border p-4 ${accent.border} ${accent.bg}`}>
      <div className="flex items-start gap-3">
        <span className={`mt-1 h-3 w-3 rounded-full flex-shrink-0 ${accent.dot}`} aria-hidden />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold text-gray-900 text-sm">{title}</h3>
            <span className={`text-[10px] font-bold uppercase tracking-wider ${accent.text}`}>{signal.status}</span>
          </div>
          <p className="text-sm text-gray-700 mt-1">{signal.label}</p>
          <p className="text-[11px] text-gray-500 mt-2">{hint}</p>
          <div className="mt-3 flex items-center justify-between text-[11px]">
            <span className="text-gray-400 tabular-nums">
              {signal.last_at ? `Last: ${signal.last_at.slice(0, 16).replace('T', ' ')}` : 'Never'}
              {signal.hours_since_last != null && (
                <> · {signal.hours_since_last.toFixed(1)} h ago</>
              )}
            </span>
            <Link
              href={drilldown.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-800 hover:underline font-mono"
            >
              {drilldown.label}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

const ACCENT_BY_STATUS: Record<Status, { border: string; bg: string; dot: string; text: string }> = {
  green: { border: 'border-green-200', bg: 'bg-green-50', dot: 'bg-green-500', text: 'text-green-700' },
  yellow: { border: 'border-amber-200', bg: 'bg-amber-50', dot: 'bg-amber-500', text: 'text-amber-700' },
  red: { border: 'border-red-200', bg: 'bg-red-50', dot: 'bg-red-500', text: 'text-red-700' },
  gray: { border: 'border-gray-200', bg: 'bg-gray-50', dot: 'bg-gray-400', text: 'text-gray-600' },
};
