'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/auth-context';
import { StatusBadge, PriorityBadge } from '@/components/ui/status-badge';
import StatCard from '@/components/ui/stat-card';
import ProgressOverviewCard from '@/components/pipeline/progress-overview-card';
import ErpAiBoqModal from '@/components/boq/erp-ai-boq-modal';
import { timeAgo, truncate } from '@/lib/shared/utils';
import { Project } from '@/lib/shared/types';
import {
  FileText,
  Upload,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  Clock,
  ArrowRight,
  RefreshCw,
  Activity,
  XCircle,
  Sparkles,
} from 'lucide-react';

interface DashboardStats {
  total: number;
  new: number;
  in_progress: number;
  estimated: number;
  sent: number;
  won: number;
  closed: number;
  other: number;
  pipeline_value: number;
}

const IN_PROGRESS_STATUSES = ['classified', 'extracting', 'extracted', 'services_identified', 'estimating'];
const ESTIMATED_STATUSES = ['estimated', 'yardstick_checked', 'quotation_ready'];
const CLOSED_STATUSES = ['ignored', 'lost', 'declined'];
const KNOWN_STATUSES = new Set([
  'new', ...IN_PROGRESS_STATUSES, ...ESTIMATED_STATUSES, 'sent', 'won', ...CLOSED_STATUSES,
]);

const INITIAL_COLORS = [
  'bg-blue-100 text-blue-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700',
  'bg-purple-100 text-purple-700',
  'bg-rose-100 text-rose-700',
  'bg-cyan-100 text-cyan-700',
];

function getInitialColor(name: string): string {
  return INITIAL_COLORS[(name.charCodeAt(0) || 0) % INITIAL_COLORS.length];
}

function computeDailyCounts(projects: Project[], filterFn?: (p: Project) => boolean): number[] {
  const counts: number[] = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const dayStart = new Date(now);
    dayStart.setDate(now.getDate() - i);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayStart.getDate() + 1);
    const filtered = filterFn ? projects.filter(filterFn) : projects;
    counts.push(
      filtered.filter(p => {
        const d = new Date(p.created_at);
        return d >= dayStart && d < dayEnd;
      }).length
    );
  }
  return counts;
}

function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [stats, setStats] = useState<DashboardStats>({
    total: 0, new: 0, in_progress: 0, estimated: 0, sent: 0, won: 0, closed: 0, other: 0, pipeline_value: 0,
  });
  const [loading, setLoading] = useState(true);
  const [boqModalOpen, setBoqModalOpen] = useState(false);
  const [activities, setActivities] = useState<{ id: string; project_id: string; project_name: string; step_name: string; status: string; created_at: string }[]>([]);

  const refreshActivities = useCallback(() => {
    fetch('/api/activity?limit=8').then(r => r.json()).then(d => setActivities(d.activities || [])).catch(() => {});
  }, []);

  const fetchDashboard = useCallback(async () => {
    try {
      const res = await fetch('/api/projects');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      const allProjects: Project[] = data.projects || [];
      setProjects(allProjects);

      setStats({
        total: allProjects.length,
        new: allProjects.filter(p => p.status === 'new').length,
        in_progress: allProjects.filter(p => IN_PROGRESS_STATUSES.includes(p.status)).length,
        estimated: allProjects.filter(p => ESTIMATED_STATUSES.includes(p.status)).length,
        sent: allProjects.filter(p => p.status === 'sent').length,
        won: allProjects.filter(p => p.status === 'won').length,
        closed: allProjects.filter(p => CLOSED_STATUSES.includes(p.status)).length,
        other: allProjects.filter(p => !KNOWN_STATUSES.has(p.status)).length,
        pipeline_value: allProjects.reduce((sum, p) => sum + (p.total_area_sqft || 0), 0),
      });
    } catch {
      // API may not be connected yet
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
    refreshActivities();
  }, [fetchDashboard, refreshActivities]);

  const urgentProjects = projects
    .filter(p => p.priority === 'priority_top' && !['sent', 'won', 'lost', 'declined'].includes(p.status))
    .slice(0, 5);

  const recentProjects = [...projects]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 8);

  const totalSparkline = useMemo(() => computeDailyCounts(projects), [projects]);
  const inProgressSparkline = useMemo(
    () => computeDailyCounts(projects, p => IN_PROGRESS_STATUSES.includes(p.status)),
    [projects]
  );

  const statCards = [
    { label: 'Total Bids', value: stats.total, icon: FileText, iconBg: 'bg-blue-500', borderColor: 'border-l-blue-500', sparklineData: totalSparkline, sparklineColor: '#3b82f6' },
    { label: 'New Uploads', value: stats.new, icon: Upload, iconBg: 'bg-indigo-500', borderColor: 'border-l-indigo-500' },
    { label: 'In Progress', value: stats.in_progress, icon: Clock, iconBg: 'bg-amber-500', borderColor: 'border-l-amber-500', sparklineData: inProgressSparkline, sparklineColor: '#f59e0b' },
    { label: 'Estimated', value: stats.estimated, icon: TrendingUp, iconBg: 'bg-teal-500', borderColor: 'border-l-teal-500' },
    { label: 'Sent', value: stats.sent, icon: CheckCircle, iconBg: 'bg-green-500', borderColor: 'border-l-green-500' },
    { label: 'Won', value: stats.won, icon: CheckCircle, iconBg: 'bg-emerald-600', borderColor: 'border-l-emerald-600' },
    { label: 'Closed', value: stats.closed, icon: XCircle, iconBg: 'bg-gray-500', borderColor: 'border-l-gray-500' },
  ];

  const bucketSum = stats.new + stats.in_progress + stats.estimated + stats.sent + stats.won + stats.closed + stats.other;
  const reconciles = bucketSum === stats.total;

  const completedActivities = activities.filter(a => a.status === 'completed').length;
  const failedActivities = activities.filter(a => a.status !== 'completed').length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950">ERP Realsoft</h1>
          <p className="mt-1 text-sm text-slate-500">AI BOQ generation, estimator review, approval, and export.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setBoqModalOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-[#1b5fc4] px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-blue-900/20 hover:bg-[#1850a8]"
          >
            <Sparkles className="h-4 w-4" />
            Generate BOQ with AI
          </button>
        </div>
      </div>
      <ErpAiBoqModal
        open={boqModalOpen}
        projects={projects}
        onClose={() => setBoqModalOpen(false)}
        onRefresh={async () => {
          await fetchDashboard();
          refreshActivities();
        }}
      />

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-7 lg:gap-5">
        {statCards.map((card) => (
          <StatCard
            key={card.label}
            label={card.label}
            value={card.value}
            icon={card.icon}
            iconBg={card.iconBg}
            borderColor={card.borderColor}
            sparklineData={card.sparklineData}
            sparklineColor={card.sparklineColor}
            badge={
              card.label === 'Total Bids' ? (
                <span
                  title={reconciles ? 'All projects accounted for' : 'Some projects in transitional statuses'}
                  className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700"
                >
                  <CheckCircle className="h-3 w-3" /> OK
                </span>
              ) : undefined
            }
            actionSlot={
              card.label === 'New Uploads' ? (
                <button
                  onClick={(e) => { e.stopPropagation(); fetchDashboard(); }}
                  title="Refresh stats"
                  className="rounded-lg p-1 transition-colors hover:bg-sky-100"
                >
                  <RefreshCw className="h-3 w-3 text-indigo-500" />
                </button>
              ) : undefined
            }
          />
        ))}
      </div>

      {/* Progress Overview */}
      <ProgressOverviewCard
        total={stats.total}
        other={stats.other}
        completedActivities={completedActivities}
        failedActivities={failedActivities}
        inProgressCount={stats.in_progress}
      />

      {/* Urgent Projects */}
      {urgentProjects.length > 0 && (
        <div className="rounded-2xl border border-red-100 bg-red-50/80 p-5 shadow-sm shadow-red-950/5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-5 w-5 text-red-600" />
            <h2 className="text-sm font-semibold text-red-800">Priority-Top Bids</h2>
          </div>
          <div className="space-y-2">
            {urgentProjects.map((project) => {
              const clientName = project.client_name || project.email_from || '?';
              return (
                <Link
                  key={project.id}
                  href={`/bids/${project.id}`}
                  className="flex items-center gap-3 rounded-xl border border-red-100/70 bg-white p-3 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-red-50 hover:shadow-md"
                >
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold flex-shrink-0 ${getInitialColor(clientName)}`}>
                    {clientName[0].toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {project.project_name || project.email_subject}
                    </p>
                    <p className="text-xs text-gray-500">{clientName}</p>
                  </div>
                  <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                    <StatusBadge status={project.status} />
                    <span className="text-[10px] text-gray-400 whitespace-nowrap">{timeAgo(project.updated_at)}</span>
                    <ArrowRight className="h-4 w-4 text-gray-400" />
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* Recent Projects — 2/3 width */}
      <div className="rounded-2xl border border-slate-200/80 bg-white/90 shadow-sm shadow-slate-900/5 lg:col-span-2">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-800">Recent Bids</h2>
          <Link href="/bids" className="text-xs font-semibold text-sky-600 transition-colors hover:text-sky-800">
            View All
          </Link>
        </div>
        {recentProjects.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            <Upload className="h-10 w-10 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No bids yet. Upload drawings and specifications to start an AI BOQ.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {recentProjects.map((project) => (
              <Link
                key={project.id}
                href={`/bids/${project.id}`}
                className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-slate-50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-slate-900 truncate">
                      {project.project_name || truncate(project.email_subject, 60)}
                    </p>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {project.client_name || project.email_from} &middot; {timeAgo(project.created_at)}
                  </p>
                </div>
                <PriorityBadge priority={project.priority} />
                <StatusBadge status={project.status} />
                {project.total_area_sqft && (
                  <span className="text-xs text-gray-500 hidden md:block">
                    {project.total_area_sqft.toLocaleString()} sqft
                  </span>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Activity Feed — 1/3 width */}
      <div className="rounded-2xl border border-slate-200/80 bg-white/90 shadow-sm shadow-slate-900/5">
        <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
          <Activity className="h-4 w-4 text-slate-500" />
          <h2 className="text-sm font-semibold text-slate-800">Recent Activity</h2>
        </div>
        {activities.length === 0 ? (
          <div className="p-6 text-center text-gray-400">
            <p className="text-xs">No activity yet</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {activities.map((a) => (
              <Link key={a.id} href={`/bids/${a.project_id}`}
                className="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-slate-50">
                <div className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${a.status === 'completed' ? 'bg-green-500' : 'bg-red-500'}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-slate-800 font-semibold truncate">{a.step_name}</p>
                  <p className="text-[10px] text-gray-400 truncate">{a.project_name}</p>
                </div>
                <span className="text-[10px] text-gray-400 flex-shrink-0">{timeAgo(a.created_at)}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

export default function RootPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/landing');
    }
  }, [loading, user, router]);

  // While checking auth state or redirecting, show loading
  if (loading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0a1628]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400" />
      </div>
    );
  }

  // Authenticated users see the dashboard
  return <Dashboard />;
}
