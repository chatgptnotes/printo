/**
 * /admin — single dashboard page hub for the cost-reduction telemetry
 * endpoints built across Phases 3–10. Each card links to the underlying
 * JSON endpoint AND shows a live preview value (lifetime savings,
 * cohort count, drift count, F1, etc.) so the operator gets a one-glance
 * health summary without opening multiple tabs.
 *
 * Pure client-side fetches — every endpoint already has its own auth gate
 * via requireAuth, so the page just needs the user's session cookie.
 */
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

interface CostTrend {
  lifetime?: { total_savings_usd?: number; savings_by_kind?: Record<string, { count: number; usd: number }> };
  slopes?: { spend_7d?: number | null; spend_30d?: number | null };
}
interface CostStats { ai_spend_usd?: { total?: number }; ai_calls?: { total?: number }; cache_hits?: { count?: number }; }
interface NbTrend { last_ran_at?: string | null; latest?: { recommended_margin?: number; f1?: number; skip_rate?: number } | null; total_runs?: number; }
interface CohortIntel { total?: number; sources?: { rate_cohorts?: number; rejection_cohorts?: number; extraction_corrections?: number }; }
interface CohortDriftStatus { drifted?: Array<unknown>; checked_at?: string | null; }
interface ExtractionAccuracy { fields?: Array<{ field: string; corrections: number }>; total_projects_in_window?: number; }
interface RateAdjustments { total?: number; }
interface ExtractionHints { enabled?: boolean; fields_warned?: number; }

export default function AdminIndexPage() {
  const [costTrend, setCostTrend] = useState<CostTrend | null>(null);
  const [costStats, setCostStats] = useState<CostStats | null>(null);
  const [nbTrend, setNbTrend] = useState<NbTrend | null>(null);
  const [cohortIntel, setCohortIntel] = useState<CohortIntel | null>(null);
  const [drift, setDrift] = useState<CohortDriftStatus | null>(null);
  const [extractAcc, setExtractAcc] = useState<ExtractionAccuracy | null>(null);
  const [rateAdj, setRateAdj] = useState<RateAdjustments | null>(null);
  const [hints, setHints] = useState<ExtractionHints | null>(null);
  const [reclassifying, setReclassifying] = useState(false);
  const [reclassifyMsg, setReclassifyMsg] = useState<string | null>(null);

  const runReclassify = async () => {
    setReclassifying(true);
    setReclassifyMsg(null);
    try {
      const r = await fetch('/api/admin/reclassify-intake', { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.details || j.error || 'failed');
      setReclassifyMsg(`Scanned ${j.scanned} · changed ${j.changed} · newly ignored ${j.ignored_now}`);
    } catch (e: any) {
      setReclassifyMsg(`Error: ${e.message}`);
    } finally {
      setReclassifying(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const fetchSafe = async <T,>(url: string, set: (v: T) => void) => {
      try {
        const r = await fetch(url);
        if (!r.ok) return;
        const j = (await r.json()) as T;
        if (!cancelled) set(j);
      } catch { /* silent — card stays in loading state */ }
    };
    fetchSafe<CostTrend>('/api/admin/cost-trend?days=7', setCostTrend);
    fetchSafe<CostStats>('/api/admin/cost-stats?window=7d', setCostStats);
    fetchSafe<NbTrend>('/api/admin/nb-trend', setNbTrend);
    fetchSafe<CohortIntel>('/api/admin/cohort-intel', setCohortIntel);
    fetchSafe<CohortDriftStatus>('/api/admin/cohort-drift-status', setDrift);
    fetchSafe<ExtractionAccuracy>('/api/admin/extraction-accuracy?days=90', setExtractAcc);
    fetchSafe<RateAdjustments>('/api/admin/rate-adjustments', setRateAdj);
    fetchSafe<ExtractionHints>('/api/admin/extraction-hints-preview', setHints);
    return () => { cancelled = true; };
  }, []);

  const cards: Array<{
    title: string;
    href: string;
    description: string;
    preview: string;
    accent: 'green' | 'blue' | 'purple' | 'amber' | 'gray';
  }> = [
    {
      title: 'Cost trend',
      href: '/api/admin/cost-trend?days=30',
      description: 'Daily AI spend + cumulative savings sparkline. 7d / 30d slope on spend.',
      preview:
        costTrend?.lifetime?.total_savings_usd != null
          ? `Lifetime saved $${costTrend.lifetime.total_savings_usd.toFixed(2)} · spend slope 7d ${formatSlope(costTrend.slopes?.spend_7d)}`
          : '—',
      accent: 'green',
    },
    {
      title: 'Cost stats (7d)',
      href: '/api/admin/cost-stats?window=7d',
      description: 'Rolling 7-day AI spend, calls per model, cache hits, heuristic savings.',
      preview:
        costStats?.ai_spend_usd?.total != null
          ? `7d spend $${costStats.ai_spend_usd.total.toFixed(2)} · ${costStats.ai_calls?.total ?? 0} calls · ${costStats.cache_hits?.count ?? 0} cache hits`
          : '—',
      accent: 'green',
    },
    {
      title: 'NB classifier trend',
      href: '/api/admin/nb-trend',
      description: 'Self-eval F1 / margin / skip-rate over time.',
      preview:
        nbTrend?.latest
          ? `Last F1 ${nbTrend.latest.f1?.toFixed(3) ?? 'n/a'} · margin ${nbTrend.latest.recommended_margin ?? 'n/a'} · skip ${(nbTrend.latest.skip_rate ?? 0) * 100 | 0}% · ${nbTrend.total_runs ?? 0} runs`
          : '—',
      accent: 'blue',
    },
    {
      title: 'NB tune (sweep)',
      href: '/api/admin/nb-tune',
      description: 'Live margin sweep with precision/recall/F1 per threshold. ?apply=1 writes recommendation to sabi_settings.',
      preview: nbTrend?.latest?.recommended_margin != null ? `Recommended NB_HIGH_MARGIN=${nbTrend.latest.recommended_margin}` : '—',
      accent: 'blue',
    },
    {
      title: 'NB eval',
      href: '/api/admin/nb-eval',
      description: 'Confusion matrix + F1 on the chronological holdout split.',
      preview: '—',
      accent: 'blue',
    },
    {
      title: 'Cohort intel',
      href: '/api/admin/cohort-intel',
      description: 'Per-cohort rate multiplier × rejection rate × extraction errors. Sorted by attention score.',
      preview:
        cohortIntel?.total != null
          ? `${cohortIntel.total} cohorts · ${cohortIntel.sources?.rate_cohorts ?? 0} rate · ${cohortIntel.sources?.rejection_cohorts ?? 0} rejection · ${cohortIntel.sources?.extraction_corrections ?? 0} extraction`
          : '—',
      accent: 'purple',
    },
    {
      title: 'Rate adjustments',
      href: '/api/admin/rate-adjustments',
      description: 'Per-cohort recency-weighted rate multipliers from sabi_corrections.',
      preview: rateAdj?.total != null ? `${rateAdj.total} cohort multipliers learned` : '—',
      accent: 'purple',
    },
    {
      title: 'Correction stats',
      href: '/api/admin/correction-stats',
      description: 'Per-cohort rejection rate + top reasons across gate rejects, no-bids, etc.',
      preview: '—',
      accent: 'purple',
    },
    {
      title: 'Cohort drift',
      href: '/api/admin/cohort-drift-status',
      description: 'Last cohort-drift cron run findings — cohorts whose 7d multiplier shifted >15% from 30d baseline.',
      preview: drift?.drifted ? `${drift.drifted.length} drifted${drift.checked_at ? ' · ' + drift.checked_at.slice(0, 10) : ''}` : '—',
      accent: 'amber',
    },
    {
      title: 'Extraction accuracy',
      href: '/api/admin/extraction-accuracy?days=90',
      description: 'Per-field correction frequency for AI-extracted project info.',
      preview:
        extractAcc?.fields
          ? `Top: ${(extractAcc.fields[0]?.field ?? 'none')} (${extractAcc.fields[0]?.corrections ?? 0}× over ${extractAcc.total_projects_in_window ?? 0} projects)`
          : '—',
      accent: 'amber',
    },
    {
      title: 'Extraction hints preview',
      href: '/api/admin/extraction-hints-preview',
      description: 'The exact snippet injected into the Sonnet extraction prompt right now.',
      preview: hints?.enabled ? `Active · ${hints.fields_warned ?? 0} fields warned` : 'Inactive',
      accent: 'amber',
    },
    {
      title: 'Bulk auto-adjust services',
      href: '/api/admin/auto-adjust-services',
      description: 'POST scans every sabi_services row, applies cohort multipliers retroactively. Default dry_run=true.',
      preview: '—',
      accent: 'gray',
    },
  ];

  return (
    <div className="space-y-6 max-w-6xl">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">Admin telemetry</h1>
        <p className="text-sm text-gray-500 mt-1">
          Cost-reduction telemetry endpoints from Phases 3–10. Click any card to open the underlying JSON.
        </p>
      </header>

      <div className="rounded-2xl p-4 border bg-gray-50 border-gray-200 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h3 className="font-semibold text-gray-900 text-sm">Re-classify existing bids</h3>
          <p className="text-xs text-gray-500 mt-1 leading-snug">
            Re-runs the inbox intake filter (sender + Gmail-label + keyword gates) over bids still at
            status <code className="px-1 py-0.5 bg-gray-100 rounded">classified</code>, moving junk to “To Be Ignored”.
            Rows already moved forward are left untouched. Safe to re-run.
          </p>
          {reclassifyMsg && <div className="mt-2 text-xs font-medium text-gray-700">{reclassifyMsg}</div>}
        </div>
        <button
          onClick={runReclassify}
          disabled={reclassifying}
          className="shrink-0 px-3 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {reclassifying ? 'Re-classifying…' : 'Re-classify existing bids'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {cards.map(card => (
          <Link
            key={card.href}
            href={card.href}
            target="_blank"
            rel="noopener noreferrer"
            className={`rounded-2xl p-4 border transition-shadow hover:shadow-md ${ACCENT_CLASSES[card.accent]}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold text-gray-900 text-sm">{card.title}</h3>
                <p className="text-xs text-gray-500 mt-1 leading-snug">{card.description}</p>
              </div>
            </div>
            <div className="mt-3 text-xs font-medium text-gray-700 tabular-nums">{card.preview}</div>
            <div className="mt-2 text-[10px] text-gray-400 font-mono truncate">{card.href}</div>
          </Link>
        ))}
      </div>

      <div className="text-xs text-gray-500">
        Crons (require <code className="px-1 py-0.5 bg-gray-100 rounded">CRON_SECRET</code>): see <code className="px-1 py-0.5 bg-gray-100 rounded">deploy.md</code> for trigger options.
      </div>
    </div>
  );
}

const ACCENT_CLASSES: Record<'green' | 'blue' | 'purple' | 'amber' | 'gray', string> = {
  green: 'bg-green-50 border-green-200',
  blue: 'bg-blue-50 border-blue-200',
  purple: 'bg-purple-50 border-purple-200',
  amber: 'bg-amber-50 border-amber-200',
  gray: 'bg-gray-50 border-gray-200',
};

function formatSlope(s: number | null | undefined): string {
  if (s == null) return 'n/a';
  const sign = s >= 0 ? '+' : '';
  return `${sign}$${s.toFixed(3)}/d`;
}
