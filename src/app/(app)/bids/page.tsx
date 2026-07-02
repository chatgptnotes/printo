'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { StatusBadge, PriorityBadge } from '@/components/ui/status-badge';
import { formatDate, formatAED, truncate, statusToStep, stripHtml } from '@/lib/shared/utils';
import { Project } from '@/lib/shared/types';
import { BUILDING_ICONS, BUILDING_TYPE_LABELS, REPUTATION_META } from '@/lib/shared/constants';
import BidRowExpanded from './components/bid-row-expanded';
import SyncTimer from './components/sync-timer';
import {
  Search, Filter, RefreshCw, X, ChevronUp, ChevronDown, ChevronRight, AlertTriangle,
  Building2, MapPin, Calendar, TrendingUp, FileText, Send, CheckCircle, Clock, Download, FlaskConical, Plus,
} from 'lucide-react';
import FieldSource from '@/components/ui/field-source';
import { useBatchLineage } from '@/hooks/use-lineage';
import { useToast } from '@/contexts/toast-context';

type SortField = 'project' | 'priority' | 'status' | 'area' | 'quote' | 'date' | 'deadline' | 'progress' | 'received';
type SortDir = 'asc' | 'desc';

const PRIORITY_ORDER: Record<string, number> = { priority_top: 0, priority_gen: 1, new: 2, ignore: 3 };

const STATUS_GROUPS = {
  active: [
    'new', 'classified', 'extracting', 'extracted', 'services_identified', 'estimating',
    // Gate-pending statuses (5-gate pipeline) — pipeline is paused but active
    'project_info_pending', 'scope_pending', 'pricing_pending', 'total_pending',
  ],
  ready: ['estimated', 'yardstick_checked', 'quotation_ready', 'send_pending'],
  complete: ['sent', 'won'],
  closed: ['lost', 'declined'],
};

export default function BidListPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [sortField, setSortField] = useState<SortField>('received');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [deadlineFilter, setDeadlineFilter] = useState<string>('all');
  const [boqFilter, setBoqFilter] = useState<string>('all');
  const { toast } = useToast();

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/projects');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setProjects(data.projects || []);
      setLastUpdated(new Date());
    } catch { /* Not connected */ } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // MANUAL-ONLY inbox sync. Per the saved user preference (memory:
  // feedback_manual_inbox_sync) — Gmail must NOT be polled on mount or tab
  // focus. Doing so was producing ~34,000 Supabase DB requests / 24 h
  // (roughly 1,400 cron-route invocations × ~25 queries each). New mail
  // arrives only via the explicit "Scan Inbox" / "Refresh" buttons.
  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);


  const handleRefresh = () => { setRefreshing(true); fetchProjects(); };

  const handleSyncComplete = useCallback((result: { rfqs: number; processed: number; newProjects: Array<{ id: string; name: string }> }) => {
    if (result.rfqs > 0 || result.processed > 0) {
      fetchProjects();
    }
    if (result.newProjects.length > 0) {
      const first = result.newProjects[0];
      const name = first.name || 'Untitled RFQ';
      const extra = result.newProjects.length > 1
        ? ` (+${result.newProjects.length - 1} more)`
        : '';
      toast(`New RFQ Detected: ${name}${extra}`, 'success',
        { label: 'View', href: `/bids/${first.id}` });
    }
  }, [fetchProjects, toast]);

  // Dev-mode test RFQ seeder — creates a synthetic project, runs steps 1-8
  // automatically, and navigates to the new project so the StepTimeline can
  // be watched live. Dev-only: the endpoint 404s in production.
  const [seeding, setSeeding] = useState(false);
  const seedTestRfq = async () => {
    if (seeding) return;
    setSeeding(true);
    try {
      const res = await fetch('/api/seed-test-rfq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template: 'electrical_demo' }),
      });
      const body = await res.json();
      if (!res.ok) {
        // Surface the real reason (body.details) — without it the alert just
        // echoes the generic "Seed failed" and hides the actual cause.
        alert(`Seed failed: ${body.details || body.error || res.status}`);
        return;
      }
      router.push(`/bids/${body.project_id}`);
    } catch (err) {
      alert(`Seed failed: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally {
      setSeeding(false);
    }
  };


  const clearFilters = () => { setSearchQuery(''); setStatusFilter('all'); setPriorityFilter('all'); setDeadlineFilter('all'); setBoqFilter('all'); };
  const hasFilters = searchQuery || statusFilter !== 'all' || priorityFilter !== 'all' || deadlineFilter !== 'all' || boqFilter !== 'all';

  const exportCSV = () => {
    const headers = ['Project', 'Client', 'Priority', 'Status', 'Quote (AED)', 'Area (sqft)', 'Location', 'Deadline', 'Received'];
    const rows = sorted.map(p => [
      p.project_name || p.email_subject,
      p.client_name || p.email_from,
      p.priority,
      p.status,
      p.final_quote_aed || '',
      p.total_area_sqft || '',
      p.location || '',
      p.deadline || '',
      p.email_date || p.created_at,
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `bid-list-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); }
    else { setSortField(field); setSortDir(field === 'date' ? 'desc' : 'asc'); }
  };

  // Filter
  const filtered = projects.filter((p) => {
    // Hide archived by default unless explicitly filtering for them
    if (statusFilter !== 'archived' && p.status === 'archived') return false;
    if (statusFilter !== 'all' && statusFilter !== 'archived' && p.status !== statusFilter) return false;
    if (priorityFilter === 'hide_ignored' && p.priority === 'ignore') return false;
    if (priorityFilter !== 'all' && priorityFilter !== 'hide_ignored' && p.priority !== priorityFilter) return false;
    // BOQ status: a project has an estimated BOQ once the scan/estimate has stored
    // it (status 'boq_ready'); 'boq_generating' is still in progress.
    if (boqFilter === 'ready' && p.status !== 'boq_ready') return false;
    if (boqFilter === 'generating' && p.status !== 'boq_generating') return false;
    if (boqFilter === 'none' && (p.status === 'boq_ready' || p.status === 'boq_generating')) return false;
    if (deadlineFilter !== 'all') {
      if (!p.deadline) return deadlineFilter === 'no_deadline';
      const days = (new Date(p.deadline).getTime() - Date.now()) / 864e5;
      if (deadlineFilter === 'overdue' && days >= 0) return false;
      if (deadlineFilter === 'this_week' && (days < 0 || days > 7)) return false;
      if (deadlineFilter === 'this_month' && (days < 0 || days > 30)) return false;
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (p.project_name?.toLowerCase().includes(q)) || (p.client_name?.toLowerCase().includes(q)) ||
        p.email_subject.toLowerCase().includes(q) || p.email_from.toLowerCase().includes(q) || (p.location?.toLowerCase().includes(q));
    }
    return true;
  });

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    switch (sortField) {
      case 'project': cmp = (a.project_name || a.email_subject).localeCompare(b.project_name || b.email_subject); break;
      case 'priority': cmp = (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9); break;
      case 'status': cmp = statusToStep(a.status) - statusToStep(b.status); break;
      case 'area': cmp = (a.total_area_sqft || 0) - (b.total_area_sqft || 0); break;
      case 'quote': cmp = (a.final_quote_aed || 0) - (b.final_quote_aed || 0); break;
      case 'date': cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime(); break;
      case 'received': cmp = new Date(a.email_date || a.created_at).getTime() - new Date(b.email_date || b.created_at).getTime(); break;
      case 'deadline': cmp = (a.deadline || '9999').localeCompare(b.deadline || '9999'); break;
      case 'progress': cmp = statusToStep(a.status) - statusToStep(b.status); break;
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  // Duplicate detection
  const nameCounts: Record<string, number> = {};
  projects.forEach(p => { const key = (p.project_name || p.email_subject).toLowerCase().trim(); nameCounts[key] = (nameCounts[key] || 0) + 1; });
  const isDuplicate = (p: Project) => { const key = (p.project_name || p.email_subject).toLowerCase().trim(); return nameCounts[key] > 1; };

  // Stats — reflect current filters so numbers match what user sees
  const stats = {
    total: filtered.length,
    active: filtered.filter(p => STATUS_GROUPS.active.includes(p.status)).length,
    ready: filtered.filter(p => STATUS_GROUPS.ready.includes(p.status)).length,
    sent: filtered.filter(p => p.status === 'sent').length,
    won: filtered.filter(p => p.status === 'won').length,
    totalValue: filtered.reduce((sum, p) => sum + (p.final_quote_aed || 0), 0),
  };

  const isDeadlineSoon = (d: string | null) => { if (!d) return false; const days = (new Date(d).getTime() - Date.now()) / 864e5; return days >= 0 && days <= 7; };
  const isDeadlinePast = (d: string | null) => d ? new Date(d).getTime() < Date.now() : false;
  const toggleExpand = (id: string) => setExpandedRowId(prev => prev === id ? null : id);

  // Data completeness: how many key fields have been extracted
  const getCompleteness = (p: Project): 'full' | 'partial' | 'none' => {
    const fields = [p.floors, p.building_type, p.total_area_sqft, p.location, p.typical_height_m];
    const filled = fields.filter(f => f != null && f !== '').length;
    if (filled >= 4) return 'full';
    if (filled >= 1) return 'partial';
    return 'none';
  };

  // Pre-fetch lineage for every visible bid so per-row chips share one batch
  // request instead of firing one /lineage call per row.
  useBatchLineage(sorted.map((p) => p.id));

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        {/* Header skeleton */}
        <div className="flex items-center justify-between">
          <div>
            <div className="h-7 w-32 bg-gray-200 rounded" />
            <div className="h-4 w-48 bg-gray-100 rounded mt-2" />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-9 w-28 bg-gray-200 rounded-lg" />
            <div className="h-9 w-24 bg-gray-200 rounded-lg" />
          </div>
        </div>

        {/* Stats skeleton */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-gray-50 rounded-xl p-3 border border-gray-100">
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 bg-gray-200 rounded" />
                <div className="h-3 w-16 bg-gray-200 rounded" />
              </div>
              <div className="h-6 w-12 bg-gray-200 rounded mt-2" />
            </div>
          ))}
        </div>

        {/* Filters skeleton */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="h-9 w-64 bg-gray-200 rounded-lg" />
          <div className="h-9 w-28 bg-gray-200 rounded-lg" />
          <div className="h-9 w-32 bg-gray-200 rounded-lg" />
          <div className="flex gap-1">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-8 w-16 bg-gray-200 rounded-lg" />
            ))}
          </div>
        </div>

        {/* Table skeleton */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {/* Table header */}
          <div className="bg-gray-50 border-b border-gray-200 px-4 py-3 flex gap-4">
            <div className="h-4 w-8" />
            <div className="h-4 w-40 bg-gray-200 rounded" />
            <div className="h-4 w-16 bg-gray-200 rounded" />
            <div className="h-4 w-16 bg-gray-200 rounded" />
            <div className="h-4 w-16 bg-gray-200 rounded" />
            <div className="h-4 w-20 bg-gray-200 rounded hidden md:block" />
            <div className="h-4 w-14 bg-gray-200 rounded hidden lg:block" />
            <div className="h-4 w-16 bg-gray-200 rounded hidden md:block" />
            <div className="h-4 w-16 bg-gray-200 rounded hidden lg:block" />
          </div>
          {/* Table rows */}
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-4 border-b border-gray-100">
              <div className="h-4 w-4 bg-gray-100 rounded" />
              <div className="flex-1 min-w-0">
                <div className="h-4 w-48 bg-gray-200 rounded" />
                <div className="h-3 w-32 bg-gray-100 rounded mt-1.5" />
                <div className="flex gap-1 mt-1.5">
                  <div className="h-4 w-14 bg-gray-100 rounded" />
                  <div className="h-4 w-10 bg-gray-100 rounded" />
                </div>
              </div>
              <div className="h-5 w-16 bg-gray-200 rounded-full" />
              <div className="flex items-center gap-1">
                <div className="w-16 h-2 bg-gray-200 rounded-full" />
                <div className="h-3 w-8 bg-gray-100 rounded" />
              </div>
              <div className="h-5 w-20 bg-gray-200 rounded-full" />
              <div className="h-4 w-20 bg-gray-200 rounded hidden md:block" />
              <div className="h-4 w-14 bg-gray-200 rounded hidden lg:block" />
              <div className="h-4 w-16 bg-gray-100 rounded hidden md:block" />
              <div className="h-4 w-16 bg-gray-100 rounded hidden lg:block" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Bid List</h1>
          <p className="text-sm text-gray-500 mt-1">
            {filtered.length === projects.length ? `${projects.length} projects` : `${filtered.length} of ${projects.length} projects`}
            {lastUpdated && <span className="ml-2 text-gray-400">&middot; {lastUpdated.toLocaleTimeString()}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SyncTimer onSyncComplete={handleSyncComplete} />
          {process.env.NODE_ENV !== 'production' && (
            <button onClick={seedTestRfq} disabled={seeding}
              title="Seed a synthetic test RFQ and run steps 1-8 automatically. Lands at gate 9."
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50">
              {seeding ? <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" /> : <FlaskConical className="h-4 w-4" />}
              {seeding ? 'Seeding...' : 'Seed Test RFQ'}
            </button>
          )}
          <button onClick={handleRefresh} disabled={refreshing}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <Link href="/projects/new"
            className="flex items-center gap-2 px-3 py-2 text-sm font-bold bg-gradient-to-r from-emerald-600 to-green-600 text-white rounded-lg hover:from-emerald-700 hover:to-green-700 shadow-md shadow-emerald-200 transition-all">
            <Plus className="h-4 w-4" /> New Project
          </Link>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <StatCard icon={FileText} label="Total Bids" value={stats.total} color="text-gray-600" bg="bg-gray-50" />
        <StatCard icon={Clock} label="In Progress" value={stats.active} color="text-blue-600" bg="bg-blue-50" />
        <StatCard icon={CheckCircle} label="Quote Ready" value={stats.ready} color="text-green-600" bg="bg-green-50" />
        <StatCard icon={Send} label="Sent" value={stats.sent} color="text-purple-600" bg="bg-purple-50" />
        <StatCard icon={TrendingUp} label="Won" value={stats.won} color="text-emerald-600" bg="bg-emerald-50" />
        <StatCard icon={Building2} label="Pipeline Value" value={formatAED(stats.totalValue)} color="text-amber-600" bg="bg-amber-50" isText />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input type="text" placeholder="Search projects, clients, locations..." value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
          <option value="all">All Status</option>
          <option value="new">New</option>
          <option value="classified">Classified</option>
          <option value="extracted">Extracted</option>
          <option value="services_identified">Services ID&apos;d</option>
          <option value="estimated">Estimated</option>
          <option value="yardstick_checked">Yardstick OK</option>
          <option value="quotation_ready">Quote Ready</option>
          <option value="sent">Sent</option>
          <option value="won">Won</option>
          <option value="lost">Lost</option>
          <option value="archived">Archived</option>
        </select>
        <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
          <option value="hide_ignored">Hide Ignored</option>
          <option value="all">All Priority</option>
          <option value="priority_top">Priority - Top</option>
          <option value="priority_gen">Priority - General</option>
          <option value="new">New</option>
          <option value="ignore">Ignored Only</option>
        </select>
        {/* BOQ status filter */}
        <select value={boqFilter} onChange={(e) => setBoqFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white" title="Filter by estimated BOQ status">
          <option value="all">All BOQ</option>
          <option value="ready">BOQ estimated</option>
          <option value="generating">BOQ generating</option>
          <option value="none">No BOQ yet</option>
        </select>
        {/* Deadline filter pills */}
        <div className="flex items-center gap-1">
          {[
            { key: 'all', label: 'All Dates' },
            { key: 'overdue', label: 'Overdue', color: 'text-red-600 bg-red-50 border-red-200' },
            { key: 'this_week', label: 'Due 7d', color: 'text-amber-600 bg-amber-50 border-amber-200' },
            { key: 'this_month', label: 'Due 30d', color: 'text-blue-600 bg-blue-50 border-blue-200' },
          ].map(df => (
            <button key={df.key} onClick={() => setDeadlineFilter(df.key)}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                deadlineFilter === df.key
                  ? (df.color || 'text-gray-800 bg-gray-200 border-gray-300')
                  : 'text-gray-500 bg-white border-gray-200 hover:bg-gray-50'
              }`}>
              {df.label}
            </button>
          ))}
        </div>
        {/* Export CSV */}
        <button onClick={exportCSV} title="Export filtered list as CSV"
          className="flex items-center gap-1 px-3 py-2 text-sm text-gray-500 hover:text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">
          <Download className="h-3.5 w-3.5" /> CSV
        </button>
        {hasFilters && (
          <button onClick={clearFilters}
            className="flex items-center gap-1 px-3 py-2 text-sm text-gray-500 hover:text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">
            <X className="h-3.5 w-3.5" /> Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {sorted.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            <Filter className="h-10 w-10 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No projects match your filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-2 py-3 w-8"></th>
                  <SortHeader field="project" label="Project" current={sortField} dir={sortDir} onSort={toggleSort} align="left" />
                  <SortHeader field="priority" label="Priority" current={sortField} dir={sortDir} onSort={toggleSort} align="center" />
                  <SortHeader field="progress" label="Progress" current={sortField} dir={sortDir} onSort={toggleSort} align="center" />
                  <SortHeader field="status" label="Status" current={sortField} dir={sortDir} onSort={toggleSort} align="center" />
                  <SortHeader field="quote" label="Quote (AED)" current={sortField} dir={sortDir} onSort={toggleSort} align="right" className="hidden md:table-cell" />
                  <SortHeader field="area" label="Area" current={sortField} dir={sortDir} onSort={toggleSort} align="right" className="hidden lg:table-cell" />
                  <SortHeader field="received" label="Received" current={sortField} dir={sortDir} onSort={toggleSort} align="center" className="hidden md:table-cell" />
                  <SortHeader field="deadline" label="Deadline" current={sortField} dir={sortDir} onSort={toggleSort} align="center" className="hidden lg:table-cell" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sorted.map((project) => {
                  const step = statusToStep(project.status);
                  const progress = Math.round((step / 14) * 100);
                  const dup = isDuplicate(project);
                  const buildingIcon = BUILDING_ICONS[project.building_type || ''] || '';
                  const isExpanded = expandedRowId === project.id;
                  const completeness = getCompleteness(project);
                  const snippetPreview = project.email_snippet ? truncate(stripHtml(project.email_snippet), 60) : null;

                  // Building spec tags
                  const specTags: { label: string; color: string }[] = [];
                  if (project.building_type) {
                    specTags.push({ label: BUILDING_TYPE_LABELS[project.building_type] || project.building_type, color: 'bg-blue-50 text-blue-600' });
                  }
                  if (project.floors != null) {
                    const floorLabel = project.parking_floors ? `${project.floors}F +${project.parking_floors}P` : `${project.floors}F`;
                    specTags.push({ label: floorLabel, color: 'bg-gray-100 text-gray-600' });
                  }
                  if (project.typical_height_m != null) {
                    specTags.push({ label: `${project.typical_height_m}m`, color: 'bg-gray-100 text-gray-600' });
                  }
                  if (project.reputation_class && project.reputation_class !== 'unknown') {
                    const rep = REPUTATION_META[project.reputation_class];
                    if (rep) {
                      specTags.push({ label: rep.shortLabel, color: `${rep.bgColor} ${rep.color}` });
                    }
                  }

                  return (
                    <React.Fragment key={project.id}>
                      <tr className={`hover:bg-gray-50 transition-colors cursor-pointer ${dup ? 'bg-amber-50/40' : ''} ${isExpanded ? 'bg-blue-50/30' : ''}`} onClick={() => router.push(`/bids/${project.id}`)}>
                        {/* Expand toggle */}
                        <td className="px-2 py-3 text-center">
                          <button onClick={(e) => { e.stopPropagation(); toggleExpand(project.id); }}
                            className="p-1 rounded hover:bg-gray-100 transition-colors"
                            title={isExpanded ? 'Collapse' : 'Show extracted data'}>
                            {isExpanded
                              ? <ChevronDown className="h-4 w-4 text-blue-500" />
                              : <ChevronRight className="h-4 w-4 text-gray-300" />}
                          </button>
                        </td>
                        {/* Project — rich cell with name, client, location, snippet, spec tags */}
                        <td className="px-4 py-3">
                          <Link href={`/bids/${project.id}`} className="block group">
                            <div className="flex items-start gap-2">
                              {buildingIcon && <span className="text-base mt-0.5 flex-shrink-0">{buildingIcon}</span>}
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <p className="font-medium text-gray-900 group-hover:text-blue-600 truncate max-w-[300px]">
                                    {project.project_name || truncate(project.email_subject, 45)}
                                  </p>
                                  {/* Data completeness dot */}
                                  <span className={`inline-block h-1.5 w-1.5 rounded-full flex-shrink-0 ${
                                    completeness === 'full' ? 'bg-green-500' :
                                    completeness === 'partial' ? 'bg-amber-400' :
                                    'bg-gray-300'
                                  }`} title={
                                    completeness === 'full' ? 'Data fully extracted' :
                                    completeness === 'partial' ? 'Partially extracted' :
                                    'Not yet extracted'
                                  } />
                                  {dup && <span title="Possible duplicate"><AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" /></span>}
                                </div>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className="text-xs text-gray-500 truncate max-w-[180px]">
                                    {project.client_name || project.email_from}
                                  </span>
                                  {project.location && (
                                    <span className="text-[10px] text-gray-400 flex items-center gap-0.5 flex-shrink-0">
                                      <MapPin className="h-2.5 w-2.5" />{project.location}
                                    </span>
                                  )}
                                </div>
                                {/* Email snippet preview */}
                                {snippetPreview && (
                                  <p className="text-[10px] text-gray-400 italic truncate max-w-[320px] mt-0.5">
                                    {snippetPreview}
                                  </p>
                                )}
                                {/* Building spec tags */}
                                {specTags.length > 0 && (
                                  <div className="flex items-center gap-1 mt-1 flex-wrap">
                                    {specTags.map((tag, i) => (
                                      <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${tag.color}`}>
                                        {tag.label}
                                      </span>
                                    ))}
                                    {project.building_type && (
                                      <FieldSource projectId={project.id} field="building_type" />
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </Link>
                        </td>
                        {/* Priority */}
                        <td className="px-4 py-3 text-center"><PriorityBadge priority={project.priority} /></td>
                        {/* Progress — 14-step scale */}
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-center gap-2">
                            <div className="w-16 bg-gray-200 rounded-full h-1.5">
                              <div
                                className={`h-1.5 rounded-full transition-all ${
                                  progress >= 90 ? 'bg-green-500' :
                                  progress >= 60 ? 'bg-emerald-500' :
                                  progress >= 30 ? 'bg-blue-500' :
                                  'bg-amber-500'
                                }`}
                                style={{ width: `${progress}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-gray-400 font-medium tabular-nums w-8">{step}/14</span>
                          </div>
                        </td>
                        {/* Status */}
                        <td className="px-4 py-3 text-center"><StatusBadge status={project.status} /></td>
                        {/* Quote */}
                        <td className="px-4 py-3 hidden md:table-cell text-right font-medium text-gray-700 tabular-nums">
                          {project.final_quote_aed ? (
                            <FieldSource projectId={project.id} boqField="final_quote_aed" block>
                              <span>{formatAED(project.final_quote_aed)}</span>
                            </FieldSource>
                          ) : <span className="text-gray-300">-</span>}
                        </td>
                        {/* Area */}
                        <td className="px-4 py-3 hidden lg:table-cell text-right text-gray-600 tabular-nums">
                          {project.total_area_sqft ? (
                            <FieldSource projectId={project.id} field="total_area_sqft" block>
                              <span>
                                {project.total_area_sqft.toLocaleString()}
                                <span className="text-[10px] text-gray-400 ml-0.5">sqft</span>
                              </span>
                            </FieldSource>
                          ) : <span className="text-gray-300">-</span>}
                        </td>
                        {/* Received — email date/time */}
                        <td className="px-4 py-3 hidden md:table-cell text-center">
                          {(project.email_date || project.created_at) ? (
                            <div className="text-xs text-gray-500">
                              <div>{formatDate(project.email_date || project.created_at)}</div>
                              <div className="text-[10px] text-gray-400">
                                {new Date(project.email_date || project.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                                <span className="ml-1">{timeAgo(project.email_date || project.created_at)}</span>
                              </div>
                            </div>
                          ) : <span className="text-gray-300 text-xs">-</span>}
                        </td>
                        {/* Deadline */}
                        <td className="px-4 py-3 hidden lg:table-cell text-center">
                          {project.deadline ? (
                            <FieldSource projectId={project.id} field="deadline" block>
                              <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${
                                isDeadlinePast(project.deadline) ? 'bg-red-50 text-red-600 font-medium' :
                                isDeadlineSoon(project.deadline) ? 'bg-amber-50 text-amber-600 font-medium' :
                                'text-gray-500'
                              }`}>
                                <Calendar className="h-3 w-3" />
                                {formatDate(project.deadline)}
                              </span>
                            </FieldSource>
                          ) : <span className="text-gray-300 text-xs">-</span>}
                        </td>
                      </tr>
                      {/* Expanded detail panel */}
                      {isExpanded && <BidRowExpanded project={project} colSpan={9} />}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function StatCard({ icon: Icon, label, value, color, bg, isText }: {
  icon: React.ElementType; label: string; value: string | number; color: string; bg: string; isText?: boolean;
}) {
  return (
    <div className={`${bg} rounded-xl p-3 border border-gray-100`}>
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${color}`} />
        <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">{label}</span>
      </div>
      <p className={`text-lg font-bold ${color} mt-1 ${isText ? 'text-sm' : ''}`}>{value}</p>
    </div>
  );
}

function SortHeader({
  field, label, current, dir, onSort, align = 'left', className = '',
}: {
  field: SortField; label: string; current: SortField; dir: SortDir;
  onSort: (f: SortField) => void; align?: 'left' | 'right' | 'center'; className?: string;
}) {
  const active = current === field;
  const alignClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  const flexJustify = align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start';
  return (
    <th className={`${alignClass} px-4 py-3 font-medium text-gray-600 cursor-pointer select-none hover:bg-gray-100 transition-colors ${className}`}
      onClick={() => onSort(field)}>
      <div className={`flex items-center gap-1 ${flexJustify}`}>
        {label}
        {active ? (dir === 'asc' ? <ChevronUp className="h-3.5 w-3.5 text-blue-600" /> : <ChevronDown className="h-3.5 w-3.5 text-blue-600" />)
          : <ChevronDown className="h-3.5 w-3.5 text-gray-300" />}
      </div>
    </th>
  );
}
