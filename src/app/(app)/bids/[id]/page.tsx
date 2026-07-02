'use client';

import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import FieldSource from '@/components/ui/field-source';
import ReplyModal from '@/components/pipeline/reply-modal';
import FilePreviewModal from '@/components/pipeline/file-preview-modal';
import CommandBar from '@/components/pipeline/command-bar';
import NextActionBanner from '@/components/pipeline/next-action-banner';
import EmailBodyFrame from '@/components/pipeline/email-body-frame';
import { useToast } from '@/contexts/toast-context';
import { StatusBadge, PriorityBadge } from '@/components/ui/status-badge';
import { formatAED, formatNumber, formatDate, formatDateTime, statusToStep } from '@/lib/shared/utils';
import { SERVICE_LABELS, REPUTATION_META } from '@/lib/shared/constants';
import { ProjectDetail } from '@/lib/shared/types';
import { supabaseClient } from '@/lib/storage/supabase';
import { uploadFile } from '@/lib/storage/multipart-uploader';
import type { ElectricalProcedureResult } from '@/lib/ai/ai-provider';
import { enrichElectricalResult } from '@/lib/electrical/derive-cable-paths';
import PlanDiagram from '@/app/(app)/plan/components/PlanDiagram';
import {
  ArrowLeft,
  Building2,
  MapPin,
  Layers,
  Ruler,
  Paperclip,
  Wrench,
  Calculator,
  FileSpreadsheet,
  Send,
  CheckCircle,
  Tag,
  XCircle,
  Download,
  Zap,
  Pencil,
  Save,
  Mail,
  Eye,
  ShieldAlert,
  ThumbsDown,
  Archive,
  FolderOpen,
  FileText,
  ImageIcon,
  ChevronDown,
  ChevronRight,
  ArrowRight,
  File,
  Brain,
  Sparkles,
  Info,
  Check,
  RotateCcw,
  ClipboardList,
  Reply,
  RefreshCw,
  Maximize2,
  X,
  ZoomIn,
  ZoomOut,
  Box,
  Upload,
} from 'lucide-react';
import {
  PIPELINE_STEPS,
  GATE_QUESTIONS,
  MAIN_PIPELINE_STEPS,
  MAIN_PIPELINE_PHASES,
  MAIN_GATE_STEPS,
  MAIN_GATE_QUESTIONS,
  ELECTRICAL_SUB_PIPELINE,
  getCurrentStep,
} from '@/lib/shared/constants';

export default function ProjectDetailPage() {
  const params = useParams();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionStartTime, setActionStartTime] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  // Pipeline follows step-by-step flow — no batch processing
  const [rejectReason, setRejectReason] = useState('');
  const [editing, setEditing] = useState(false);
  const [editFields, setEditFields] = useState<Record<string, any>>({});
  const [showFullEmail, setShowFullEmail] = useState(false);
  const [fullEmail, setFullEmail] = useState<any>(null);
  const [emailLoading, setEmailLoading] = useState(false);
  const gateCardRef = useRef<HTMLDivElement>(null);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyTemplate, setReplyTemplate] = useState<string | undefined>(undefined);
  const [lastFailedAction, setLastFailedAction] = useState<{ action: string; error: string } | null>(null);
  const [showMerge, setShowMerge] = useState(false);
  const [mergeTargetId, setMergeTargetId] = useState('');

  const [autoRunning, setAutoRunning] = useState(false);
  const [autoRunStep, setAutoRunStep] = useState('');

  // Phase 9: cohort drift findings keyed by 'service_type::building_type'.
  // Populated on mount from /api/admin/cohort-drift-status — the latest
  // run of the cohort-drift cron. Used to render a small badge next to a
  // service row when this project's cohort just drifted, so the operator
  // sees "AI's recent corrections for office HVAC are 17% above baseline,
  // double-check the rate" before sending the quote.
  const [cohortDrift, setCohortDrift] = useState<Map<string, { shift_pct: number; recent_n: number; checked_at: string }>>(new Map());
  // Phase 10: extraction-hints preview — lets operator see what corrections
  // the AI prompt was warned about on this and future extractions.
  const [extractionHints, setExtractionHints] = useState<{ enabled: boolean; fields_warned: number; snippet: string } | null>(null);
  const [showHintsModal, setShowHintsModal] = useState(false);
  // Phase 11: per-project savings attribution — sum of heuristic-saving + cache-hit
  // events for THIS project so the operator sees direct accountability.
  const [projectSavings, setProjectSavings] = useState<{ total_savings_usd: number; events: number; by_kind: Record<string, { count: number; usd: number }> } | null>(null);

  // Demo flag: when set on the deploy, hide HVAC / Plumbing / generic-MEP
  // discipline sections so the bid detail page shows only the Electrical
  // 14-step Cable Schedule Derivation. Backend processing is unaffected.
  const electricalOnly = process.env.NEXT_PUBLIC_ELECTRICAL_ONLY === '1';

  // Collapsible section state — persisted in localStorage
  // Project-related sections open by default; deep-dive/technical sections collapsed
  const SECTION_STORAGE_KEY = 'bid-sections-v5';
  const DEFAULT_OPEN = new Set(['project-info', 'ai-class', 'documents', 'ai-extracted', 'mep-services', 'boq-summary', 'hvac-formula', 'boq-preview', 'plan-diagram']);
  const [sectionState, setSectionState] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return {};
    try { return JSON.parse(localStorage.getItem(SECTION_STORAGE_KEY) || '{}'); } catch { return {}; }
  });
  const toggleSection = (id: string) => {
    setSectionState(prev => {
      const currentOpen = id in prev ? prev[id] : DEFAULT_OPEN.has(id);
      const next = { ...prev, [id]: !currentOpen };
      localStorage.setItem(SECTION_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };
  const isSectionOpen = (id: string) => id in sectionState ? sectionState[id] : DEFAULT_OPEN.has(id);
  const ALL_SECTION_IDS = ['project-info','spec-reqs','ai-class','email','documents','ai-extracted','mep-services','boq-summary','hvac-formula','component-boq','multi-hvac','floor-breakdown','equip-schedule','plan-diagram','boq-preview','pipeline-progress','workflow-flowchart'];

  useEffect(() => {
    if (params.id) fetchProject();
  }, [params.id]);

  // Real-time progress: the VPS worker writes sabi_activity_log rows as a scan
  // moves (received → AI scan complete → done / failed). Subscribe to those
  // INSERTs over Supabase Realtime and refresh the project the moment one
  // lands, so the bid page updates live instead of waiting on the poll. This
  // is push-based (no extra polling), so it doesn't reintroduce egress cost.
  useEffect(() => {
    if (!params.id) return;
    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (cancelled || refreshTimer) return;
      // Coalesce bursts (several rows can land together) into one refetch.
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        fetchProject();
      }, 400);
    };

    let channel: ReturnType<typeof supabaseClient.channel> | null = null;
    try {
      channel = supabaseClient
        .channel(`bid-activity:${params.id}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'sabi_activity_log',
            filter: `project_id=eq.${params.id}`,
          },
          scheduleRefresh,
        )
        .subscribe();
    } catch {
      // Realtime unavailable — the auto-run poll remains the fallback.
    }

    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      if (channel) {
        const ch = channel;
        channel = null;
        try {
          const result = supabaseClient.removeChannel(ch);
          if (result && typeof (result as Promise<unknown>).catch === 'function') {
            (result as Promise<unknown>).catch(() => { /* noop */ });
          }
        } catch { /* noop */ }
      }
    };
  }, [params.id]);

  // Phase 9: load cohort-drift findings once per page mount. Cheap GET.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/cohort-drift-status')
      .then(r => r.ok ? r.json() : null)
      .then((d: { drifted?: Array<{ cohort: string; shift_pct: number; recent_n: number }>; checked_at?: string } | null) => {
        if (cancelled || !d?.drifted) return;
        const map = new Map<string, { shift_pct: number; recent_n: number; checked_at: string }>();
        for (const e of d.drifted) {
          map.set(e.cohort, { shift_pct: e.shift_pct, recent_n: e.recent_n, checked_at: d.checked_at ?? '' });
        }
        setCohortDrift(map);
      })
      .catch(() => { /* silent — drift badge is optional UX */ });
    fetch('/api/admin/extraction-hints-preview')
      .then(r => r.ok ? r.json() : null)
      .then((d: { enabled?: boolean; fields_warned?: number; snippet?: string } | null) => {
        if (cancelled || !d) return;
        setExtractionHints({ enabled: !!d.enabled, fields_warned: d.fields_warned ?? 0, snippet: d.snippet ?? '' });
      })
      .catch(() => { /* silent */ });
    if (params.id) {
      fetch(`/api/projects/${params.id}/savings`)
        .then(r => r.ok ? r.json() : null)
        .then((d: { total_savings_usd?: number; events?: number; by_kind?: Record<string, { count: number; usd: number }> } | null) => {
          if (cancelled || !d) return;
          if (typeof d.total_savings_usd === 'number') {
            setProjectSavings({ total_savings_usd: d.total_savings_usd, events: d.events ?? 0, by_kind: d.by_kind ?? {} });
          }
        })
        .catch(() => { /* silent */ });
    }
    return () => { cancelled = true; };
  }, [params.id]);


  // Elapsed timer — ticks every second while an action is running
  useEffect(() => {
    if (!actionLoading || !actionStartTime) { setElapsedSeconds(0); return; }
    const interval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - actionStartTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [actionLoading, actionStartTime]);

  const fetchProject = async () => {
    try {
      const res = await fetch(`/api/projects/${params.id}`);
      if (!res.ok) throw new Error(`Failed to fetch project (${res.status})`);
      const data = await res.json();
      setProject(data.project || data);
    } catch (err) {
      console.error('fetchProject error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Per-action success messages — shown via toast after the API call succeeds.
  const SUCCESS_MESSAGES: Record<string, string> = {
    classify: 'Email classified successfully',
    extract: 'Project info extracted',
    services: 'MEP services identified',
    'estimate-fast': 'Fast estimation complete',
    'estimate-detailed': 'Detailed estimation complete',
    yardstick: 'Yardstick comparison complete',
    boq: 'BOQ generated successfully',
    approve: 'Quotation approved',
    reject: 'Rejection recorded',
  };

  const runAction = async (action: string): Promise<{ ok: boolean; data?: Record<string, unknown> }> => {
    setActionLoading(action);
    setActionStartTime(Date.now());
    setLastFailedAction(null);
    try {
      // Map special action names to API endpoint + body
      let apiAction = action;
      let body: Record<string, unknown> | undefined;
      if (action === 'estimate-fast') { apiAction = 'estimate'; body = { mode: 'fast' }; }
      if (action === 'estimate-detailed') { apiAction = 'estimate'; body = { mode: 'detailed' }; }
      if (action === 'estimate') { apiAction = 'estimate'; body = {}; }

      const res = await fetch(`/api/projects/${params.id}/${apiAction}`, {
        method: 'POST',
        ...(body && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        throw new Error(String(data.details || data.error || 'Action failed'));
      }
      // Partial-success: endpoint returned 200 but flagged a sub-step failure
      // (e.g. /power-boq generated the PDF but the Excel upload failed).
      // Surface it so the user understands why the Excel button didn't appear.
      if (data?.xlsx_error) {
        toast(`PDF generated, but Excel failed: ${data.xlsx_error}`, 'error');
      }
      await fetchProject();

      const successMsg = SUCCESS_MESSAGES[action];
      if (successMsg) {
        toast(successMsg, 'success');
      }
      return { ok: true, data };
    } catch (err: any) {
      toast(`Action failed: ${err.message || err}`, 'error');
      setLastFailedAction({ action, error: err.message || String(err) });
      return { ok: false };
    } finally {
      setActionLoading(null);
      setActionStartTime(null);
    }
  };

  // Poll project status with exponential backoff (5s → 30s cap) until one
  // of the target statuses is reached. The hot 3-second flat interval was
  // driving ~100 wasted polls per 5-min estimate phase; backoff cuts that
  // by ~75%. The chain still completes promptly — most transitions happen
  // at known boundaries the user can't perceive a 30s lag on.
  // `failOn` lets a caller surface known roll-back statuses immediately
  // instead of waiting for the full timeout — e.g. /estimate rolling back
  // to 'extracted' when all drawings are non-electrical.
  const pollUntilStatus = async (
    targets: string[],
    timeoutMs = 600_000,
    failOn: string[] = []
  ): Promise<ProjectDetail> => {
    const deadline = Date.now() + timeoutMs;
    let delayMs = 5000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, delayMs));
      delayMs = Math.min(30000, Math.round(delayMs * 1.5));
      const res = await fetch(`/api/projects/${params.id}`);
      if (!res.ok) throw new Error('Poll failed');
      const data = await res.json();
      const proj: ProjectDetail = data.project || data;
      setProject(proj);
      if (targets.includes(proj.status)) return proj;
      if (['declined', 'archived'].includes(proj.status)) throw new Error(`Pipeline ended: ${proj.status}`);
      if (failOn.includes(proj.status)) throw new Error(`Pipeline rolled back to '${proj.status}' — check activity log for the reason`);
    }
    throw new Error('Timed out waiting for pipeline step');
  };

  const handleAutoRunToBOQ = async () => {
    if (!project || autoRunning) return;
    setAutoRunning(true);
    setAutoRunStep('Starting…');
    try {
      let cur = project;

      // ── Step 1-8: Extract if not yet done ───────────────────────────────
      const needsExtract = ['new', 'classified', 'email_read', 'enquiry_registered',
        'folder_opened', 'attachment_unloaded', 'extracting', 'extracted',
        'documents_listed', 'drawings_listed', 'building_extracted'].includes(cur.status);
      if (needsExtract) {
        setAutoRunStep('Steps 1–8 · Extracting documents & building info…');
        const res = await fetch(`/api/projects/${params.id}/extract`, { method: 'POST' });
        if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Extract failed'); }
        // Fail fast: extract rolls back to 'classified' on AI/server error,
        // and step 04 PAUSE writes 'awaiting_attachment' when no files exist.
        cur = await pollUntilStatus(
          ['docs_sufficient_pending', 'scope_pending'],
          600_000,
          ['classified', 'awaiting_attachment']
        );
      }

      // ── Gate 1: Documents Sufficient ───────────────────────────────────
      if (['docs_sufficient_pending', 'scope_pending'].includes(cur.status)) {
        setAutoRunStep('Gate 1 · Approving documents sufficient…');
        const res = await fetch(`/api/projects/${params.id}/gate`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'approve', auto_chain: true }),
        });
        if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Gate 1 failed'); }
        cur = await pollUntilStatus(['bid_decision_pending']);
      }

      // ── Gate 2: Bid Decision → Detailed ────────────────────────────────
      if (cur.status === 'bid_decision_pending') {
        setAutoRunStep('Gate 2 · Selecting Detailed bid path…');
        const res = await fetch(`/api/projects/${params.id}/bid-decision`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision: 'detailed', auto_chain: true }),
        });
        if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Bid decision failed'); }
      }

      // ── Step 11: Wait for electrical sub-pipeline ──────────────────────
      if (['estimating', 'bid_decision_pending'].includes(cur.status)) {
        setAutoRunStep('Step 11 · Running 14-step electrical sub-pipeline on the VPS worker — can take 15–25 min…');
        // Fail fast: /estimate rolls back to 'extracted' when all drawings
        // are non-electrical (HVAC/plumbing/etc.) or the AI returns 0 cable
        // schedule rows. Without failOn the chain would wait the full window.
        // 30-min ceiling: a large drawing scan on the VPS worker runs 15–25 min,
        // so the poll must outlast it (matches gateway CLAUDE_TIMEOUT_MS=1800s).
        cur = await pollUntilStatus(['pricing_pending'], 1_800_000, ['extracted']);
      }

      // ── Gate 12: Approve cable schedule → auto-generates Power BOQ PDF ─
      if (cur.status === 'pricing_pending') {
        setAutoRunStep('Gate 12 · Approving cable schedule → generating Power BOQ PDF…');
        const res = await fetch(`/api/projects/${params.id}/gate`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'approve', auto_chain: true }),
        });
        if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Gate 12 failed'); }
        setAutoRunStep('Generating 12-section Power BOQ PDF…');
        // Fail fast: a Gate 12 reject rolls back to 'revise_quantities'.
        cur = await pollUntilStatus(['boq_ready'], 180_000, ['revise_quantities']);
      }

      // ── Already past this point ────────────────────────────────────────
      if (cur.status === 'boq_generating') {
        setAutoRunStep('Generating 12-section Power BOQ PDF…');
        cur = await pollUntilStatus(['boq_ready'], 180_000, ['revise_quantities']);
      }

      // ── Step 13: Yardstick check (compares BOQ total vs market benchmark) ─
      // CLAUDE.md: "All estimations compared against yardstick values".
      // Gate 5 operator sees the verdict on the consent card before sending.
      if (cur.status === 'boq_ready') {
        setAutoRunStep('Step 13 · Yardstick check (vs market rates)…');
        try {
          const res = await fetch(`/api/projects/${params.id}/yardstick`, { method: 'POST' });
          if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Yardstick failed'); }
          cur = await pollUntilStatus(['yardstick_checked'], 30_000);
        } catch (yErr) {
          // Yardstick is an advisory market-comparison, not a hard gate. A
          // failure here must not abort a finished BOQ run — leave cur at
          // 'boq_ready' and fall through to Gate 4 (which accepts boq_ready).
          console.warn('[auto-run] yardstick skipped:', yErr instanceof Error ? yErr.message : yErr);
        }
      }

      // ── Gate 14: Auto-approve Confirm Total → consent_pending ─────────
      // INSTANT BOQ lane: only Gate 5 (Send) remains for human review.
      // Accept 'boq_ready' too, in case the advisory yardstick step above was
      // skipped — the gate route already allows Gate 14 from boq_ready.
      if (cur.status === 'yardstick_checked' || cur.status === 'boq_ready') {
        setAutoRunStep('Gate 4 · Confirming total…');
        const res = await fetch(`/api/projects/${params.id}/gate`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'approve', auto_chain: true }),
        });
        if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Gate 4 failed'); }
        cur = await pollUntilStatus(['consent_pending', 'send_pending'], 60_000);
      }

      // ── Done — stop at Gate 5 (Send to Client) for human ──────────────
      setAutoRunStep('Quote ready — awaiting Send to Client (Gate 5)');
      setSectionState(prev => ({ ...prev, 'boq-preview': true }));
      setTimeout(() => {
        document.getElementById('boq-preview')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 350);
      toast('Power BOQ ready · click Send to Client to deliver', 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast(`Auto-run failed: ${msg}`, 'error');
      setAutoRunStep('');
    } finally {
      setAutoRunning(false);
      await fetchProject();
    }
  };

  // Pipeline follows step-by-step flow with decision gates per CLAUDE.md workflow

  const startEditing = () => {
    if (!project) return;
    setEditFields({
      building_type: project.building_type || '',
      location: project.location || '',
      floors: project.floors || '',
      parking_floors: project.parking_floors || '',
      total_area_sqft: project.total_area_sqft || '',
      typical_height_m: project.typical_height_m || '',
      client_name: project.client_name || '',
      project_name: project.project_name || '',
      deadline: project.deadline || '',
    });
    setEditing(true);
  };

  const saveEditing = async () => {
    try {
      const updates: Record<string, any> = {};
      for (const [key, val] of Object.entries(editFields)) {
        if (val === '') {
          updates[key] = null;
        } else if (['floors', 'parking_floors', 'total_area_sqft', 'typical_height_m'].includes(key)) {
          updates[key] = Number(val) || null;
        } else {
          updates[key] = val;
        }
      }
      const res = await fetch(`/api/projects/${params.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error('Save failed');
      setEditing(false);
      await fetchProject();
    } catch (err: any) {
      toast(`Save failed: ${err.message}`, 'error');
    }
  };

  const loadFullEmail = async () => {
    if (!project?.email_thread_id) return;
    setEmailLoading(true);
    try {
      const res = await fetch(`/api/gmail/read?threadId=${project.email_thread_id}`);
      if (!res.ok) throw new Error('Failed to load email');
      const data = await res.json();
      setFullEmail(data);
      setShowFullEmail(true);
    } catch {
      toast('Failed to load full email', 'error');
    } finally {
      setEmailLoading(false);
    }
  };

  // Strip HTML tags for clean display
  const stripHtml = (html: string) => {
    return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        {/* Header skeleton */}
        <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 rounded-2xl p-6">
          <div className="flex items-start gap-4">
            <div className="w-5 h-5 bg-slate-700 rounded" />
            <div className="flex-1 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-slate-700 rounded-xl" />
                <div className="flex-1 space-y-2">
                  <div className="h-5 bg-slate-700 rounded w-2/3" />
                  <div className="h-3 bg-slate-700/50 rounded w-1/2" />
                </div>
                <div className="flex gap-2">
                  <div className="h-6 w-20 bg-slate-700 rounded-full" />
                  <div className="h-6 w-16 bg-slate-700 rounded-full" />
                </div>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-5 gap-3 mt-5 pt-5 border-t border-white/10">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="rounded-xl bg-white/5 px-3 py-2.5 space-y-2">
                <div className="h-2.5 bg-slate-700/50 rounded w-12" />
                <div className="h-4 bg-slate-700 rounded w-16" />
              </div>
            ))}
          </div>
        </div>
        {/* Content skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3 space-y-6">
            <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
              <div className="h-5 bg-gray-200 rounded w-40" />
              <div className="grid grid-cols-3 gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="space-y-2">
                    <div className="h-3 bg-gray-100 rounded w-20" />
                    <div className="h-4 bg-gray-200 rounded w-24" />
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
              <div className="h-5 bg-gray-200 rounded w-36" />
              <div className="h-4 bg-gray-100 rounded w-full" />
              <div className="h-4 bg-gray-100 rounded w-3/4" />
              <div className="h-20 bg-gray-50 rounded-lg" />
            </div>
          </div>
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-3">
              <div className="h-5 bg-gray-200 rounded w-32" />
              <div className="h-2 bg-gray-200 rounded-full w-full" />
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-2 pt-2">
                  <div className="h-3 bg-gray-100 rounded w-28" />
                  {Array.from({ length: 3 }).map((_, j) => (
                    <div key={j} className="flex items-center gap-2 pl-4">
                      <div className="w-4 h-4 bg-gray-100 rounded-full" />
                      <div className="h-3 bg-gray-100 rounded w-40" />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Project not found.</p>
        <Link href="/bids" className="text-blue-600 text-sm mt-2 inline-block">Back to Bid List</Link>
      </div>
    );
  }

  // Calculate service cost percentages for breakdown
  const totalServiceCost = project.services.reduce((sum, s) => sum + (s.total_aed || 0), 0);

  // Power BOQ Summary of Bills — written into project.notes.boq_summary at
  // BOQ generation time (gate 14 + /api/projects/[id]/power-boq). Mirrors the
  // numbers Excel computes for the Summary sheet so the bid page can render
  // Bill 1–13 totals + Contingency + VAT + Grand Total without opening the XLSX.
  type BoqSummaryBill = { no: number; title: string; total_aed: number; lines: number };
  type BoqSummary = {
    bills: BoqSummaryBill[];
    bills_subtotal_aed: number;
    provisional_sums_aed: number;
    day_works_aed: number;
    contingency_pct: number;
    contingency_aed: number;
    discount_aed: number;
    subtotal_excl_vat_aed: number;
    vat_pct: number;
    vat_aed: number;
    grand_total_aed: number;
    currency?: string;
    generated_at?: string;
  };
  let boqSummary: BoqSummary | null = null;
  if (project.notes) {
    try {
      const parsed = JSON.parse(project.notes);
      if (parsed && typeof parsed === 'object' && parsed.boq_summary && Array.isArray(parsed.boq_summary.bills)) {
        boqSummary = parsed.boq_summary as BoqSummary;
      }
    } catch { /* notes not JSON */ }
  }

  // Detailed-electrical-only gate: when the cable schedule has been extracted
  // but no service has per-line pricing, the Excel BOQ orchestrator will fail
  // (it requires sabi_services rows with total_aed > 0). Hide the Excel
  // "Generate BOQ" button in that case and steer the operator to the PDF.
  const hasElectricalProcedure = project.services.some(
    s => (s.ai_extraction as Record<string, unknown> | null)?.raw_electrical_procedure,
  );
  const hasAnyServiceTotal = project.services.some(s => (s.total_aed ?? 0) > 0);
  const detailedElectricalOnly = hasElectricalProcedure && !hasAnyServiceTotal;

  return (
    <div className="space-y-6 pb-28 sm:pb-20">
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 rounded-2xl p-4 sm:p-6 shadow-xl">
        <div className="flex items-start gap-3 sm:gap-4">
          <Link href="/bids" className="mt-1.5 text-slate-400 hover:text-white transition-colors flex-shrink-0">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex-1 min-w-0">
            <div className="flex items-start gap-3 flex-wrap">
              <div className="w-10 h-10 rounded-xl bg-white/10 backdrop-blur flex items-center justify-center text-xl flex-shrink-0">
                {({'office':'🏢','residential':'🏠','villa':'🏡','hotel':'🏨','retail':'🏪','warehouse':'🏭','hospital':'🏥','restaurant':'🍽️'} as Record<string,string>)[project.building_type || ''] || '📋'}
              </div>
              <div className="flex-1 min-w-0 w-full sm:w-auto">
                <h1 className="text-lg sm:text-xl font-bold text-white truncate">
                  {project.project_name || project.email_subject}
                </h1>
                <div className="flex items-center gap-2 sm:gap-3 mt-1 text-xs sm:text-sm text-slate-400 flex-wrap">
                  <span className="truncate max-w-full">{project.client_name || project.email_from}</span>
                  {project.location && <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{project.location}</span>}
                  <span>{formatDate(project.email_date || project.created_at)}</span>
                  {project.deadline && <span className="flex items-center gap-1 text-amber-400"><Tag className="h-3.5 w-3.5" />Due: {formatDate(project.deadline)}</span>}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <PriorityBadge priority={project.priority} />
                {project.priority === 'ignore' && (
                  <button
                    onClick={async () => {
                      try {
                        const res = await fetch(`/api/projects/${project.id}`, {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ priority: 'priority_gen', status: 'classified' }),
                        });
                        if (!res.ok) throw new Error('Failed to update');
                        toast('Priority changed — you can now process this project', 'success');
                        await fetchProject();
                      } catch { toast('Failed to change priority', 'error'); }
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    <RefreshCw className="h-3 w-3" /> Mark as RFQ
                  </button>
                )}
                <StatusBadge status={project.status} />
                {extractionHints?.enabled && (
                  <button
                    type="button"
                    onClick={() => setShowHintsModal(true)}
                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium bg-emerald-500/10 text-emerald-300 rounded-lg border border-emerald-400/20 hover:bg-emerald-500/20"
                    title="Click to see what extraction errors the AI prompt was warned about"
                  >
                    <Brain className="h-3 w-3" />
                    AI warned: {extractionHints.fields_warned} field{extractionHints.fields_warned !== 1 ? 's' : ''}
                  </button>
                )}
                {projectSavings && projectSavings.total_savings_usd > 0 && (
                  <span
                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium bg-green-500/10 text-green-300 rounded-lg border border-green-400/20 tabular-nums"
                    title={`Saved on this project across ${projectSavings.events} heuristic event(s): ${Object.entries(projectSavings.by_kind).map(([k, v]) => `${k} ($${v.usd.toFixed(3)} × ${v.count})`).join(', ')}`}
                  >
                    Saved ${projectSavings.total_savings_usd.toFixed(2)}
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium bg-white/10 text-white rounded-lg border border-white/15">
                  <Brain className="h-3 w-3 text-blue-300" />
                  <span className="text-slate-300">AI:</span>
                  <span>Claude Opus 4.8</span>
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Quick stats strip — single unified row with dividers */}
        <div className="flex items-stretch divide-x divide-white/10 mt-4 pt-4 border-t border-white/10 -mx-2">
          {([
            { label: 'Area', value: project.total_area_sqft ? `${formatNumber(project.total_area_sqft)} sqft` : '-', icon: Ruler, accent: false, field: 'total_area_sqft' as const, scope: 'project' as const },
            { label: 'Floors', value: `${project.floors || '-'}${project.parking_floors ? ` (+${project.parking_floors}P)` : ''}`, icon: Layers, accent: false, field: 'floors' as const, scope: 'project' as const },
            { label: 'Services', value: `${project.services.length} MEP`, icon: Wrench, accent: false, field: undefined, scope: 'project' as const },
            { label: 'Estimation', value: project.estimation?.final_quote_aed ? formatAED(project.estimation.final_quote_aed) : 'Pending', icon: Calculator, accent: true, field: 'final_quote_aed' as const, scope: 'boq' as const },
            { label: 'Pipeline', value: `${statusToStep(project.status)}/23`, icon: Zap, accent: false, field: 'status' as const, scope: 'project' as const },
          ]).map((stat) => {
            const StatIcon = stat.icon;
            return (
              <div key={stat.label} className="flex-1 px-3 py-1 flex flex-col gap-0.5">
                <div className="flex items-center gap-1">
                  <StatIcon className={`h-3 w-3 ${stat.accent ? 'text-blue-400' : 'text-slate-400'}`} />
                  <p className={`text-[9px] uppercase tracking-wider ${stat.accent ? 'text-blue-400' : 'text-slate-400'}`}>{stat.label}</p>
                </div>
                {stat.field ? (
                  <FieldSource
                    projectId={project.id}
                    {...(stat.scope === 'boq' ? { boqField: stat.field } : { field: stat.field })}
                  >
                    <p className={`text-[13px] font-bold leading-tight ${stat.accent ? 'text-blue-200' : 'text-white'}`}>{stat.value}</p>
                  </FieldSource>
                ) : (
                  <p className={`text-[13px] font-bold leading-tight ${stat.accent ? 'text-blue-200' : 'text-white'}`}>{stat.value}</p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Auto-Run to BOQ button ─────────────────────────────────────────────
          Shows on early-stage projects. One click runs the full pipeline and
          scrolls to the generated Power BOQ PDF.                              */}
      {(() => {
        const preBoqStatuses = [
          'new','classified','email_read','enquiry_registered','folder_opened',
          'attachment_unloaded','extracting','extracted','documents_listed',
          'drawings_listed','building_extracted','docs_sufficient_pending',
          'scope_pending','awaiting_documents','bid_decision_pending',
          'estimating','pricing_pending','boq_generating',
        ];
        const isBoqReady = project.status === 'boq_ready';
        const showBtn = preBoqStatuses.includes(project.status) || isBoqReady;
        if (!showBtn) return null;

        if (isBoqReady && !autoRunning) {
          return (
            <div className="flex flex-col gap-2">
              <button
                onClick={() => {
                  setSectionState(prev => ({ ...prev, 'boq-preview': true }));
                  setTimeout(() => document.getElementById('boq-preview')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
                }}
                className="w-full flex items-center justify-center gap-2.5 px-5 py-3 rounded-2xl font-bold text-sm text-white bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 shadow-lg shadow-emerald-200 transition-all"
              >
                <FileSpreadsheet className="h-4 w-4" />
                View Power BOQ PDF
              </button>
              <Link
                href={`/plan?project=${params.id}`}
                className="w-full flex items-center justify-center gap-2.5 px-5 py-3 rounded-2xl font-bold text-sm text-white bg-gradient-to-r from-sabi-500 to-sabi-600 hover:from-sabi-600 hover:to-sabi-700 shadow-lg shadow-blue-200 transition-all"
              >
                <Box className="h-4 w-4" />
                View Plan &amp; Wiring
              </Link>
            </div>
          );
        }

        return (
          <div className="rounded-2xl overflow-hidden border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 shadow-sm">
            <div className="flex items-center justify-between gap-4 px-5 py-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-sm">
                  <Zap className="h-4.5 w-4.5 text-white h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900">Instant BOQ — Auto-Run to Gate 5</p>
                  {autoRunning ? (
                    <p className="text-xs text-amber-700 truncate mt-0.5">{autoRunStep}</p>
                  ) : (
                    <p className="text-xs text-gray-500 mt-0.5">Extract · auto-approves Gates 1, 2, 3, 4 · stops at Gate 5 (human Send to Client)</p>
                  )}
                </div>
              </div>
              <button
                onClick={handleAutoRunToBOQ}
                disabled={autoRunning}
                className="flex-shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 shadow-md shadow-amber-200 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {autoRunning ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                    Running…
                  </>
                ) : (
                  <>
                    <Zap className="h-4 w-4" />
                    Run to BOQ
                  </>
                )}
              </button>
            </div>
            {autoRunning && (
              <div className="h-1 bg-amber-100">
                <div className="h-full bg-gradient-to-r from-amber-400 to-orange-500 animate-pulse" style={{ width: '100%' }} />
              </div>
            )}
          </div>
        );
      })()}

      {/* Next Action Banner — always visible below header */}
      <NextActionBanner
        project={project}
        actionLoading={actionLoading}
        elapsedSeconds={elapsedSeconds}
        onRunAction={runAction}
        onGateApprove={async () => {
          try {
            const res = await fetch(`/api/projects/${project.id}/gate`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'approve' }),
            });
            if (!res.ok) {
              const data = await res.json().catch(() => ({}));
              toast(`Approve failed: ${data.error || 'Unknown error'}`, 'error');
              return;
            }
            fetchProject();
          } catch (err) {
            toast(`Approve failed: ${err instanceof Error ? err.message : 'Network error'}`, 'error');
          }
        }}
        onGateReject={async (reason: string) => {
          try {
            const res = await fetch(`/api/projects/${project.id}/gate`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'reject', reason }),
            });
            if (!res.ok) {
              const data = await res.json().catch(() => ({}));
              toast(`Reject failed: ${data.error || 'Unknown error'}`, 'error');
              return;
            }
            toast('Gate rejected — project returned for revision', 'success');
            fetchProject();
          } catch (err) {
            toast(`Reject failed: ${err instanceof Error ? err.message : 'Network error'}`, 'error');
          }
        }}
        onScrollToGate={() => gateCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
      />

      {/* HVAC Formula — compact inline */}
      {!electricalOnly && (() => {
        const hvacSvc = project.services.find(s => s.service_type === 'hvac');
        if (!hvacSvc) return null;
        const ext = hvacSvc.ai_extraction as Record<string, unknown> | null;
        const tonnage = (ext?.tonnage_tr || hvacSvc.tonnage || 0) as number;
        const totalPrice = (ext?.total_hvac_price || hvacSvc.total_aed || 0) as number;
        const systemType = (ext?.system_type || hvacSvc.system_type || '') as string;
        if (!tonnage && !totalPrice) return null;
        return (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 text-[11px] font-semibold text-slate-300">
              <Calculator className="h-3 w-3 text-blue-400" />
              {systemType.toUpperCase() || 'HVAC'}
            </span>
            <span className="text-[11px] text-gray-400 tabular-nums">{tonnage.toFixed?.(1) ?? tonnage} TR</span>
            <span className="text-gray-300">→</span>
            <span className="inline-flex items-center px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-[11px] font-bold tabular-nums shadow-sm">
              {formatAED(totalPrice)}
            </span>
          </div>
        );
      })()}

      {/* Revert Decision Card — shown when project was rejected at a gate.
          v6 rejection statuses: declined (Gate 2 No-Bid · terminal),
          awaiting_documents (Gate 1 PAUSE), revise_quantities (Gate 3 loop),
          revise_pricing (Gate 4 loop), quote_held (Gate 5 PAUSE). */}
      {['declined', 'awaiting_documents', 'revise_quantities', 'revise_pricing', 'quote_held'].includes(project.status) && (() => {
        let revertData: { rejected_gate?: number; rejection_reason?: string; rejected_at?: string } = {};
        if (project.notes) {
          try { revertData = JSON.parse(project.notes); } catch { /* not JSON */ }
        }
        if (!revertData.rejected_gate) return null;
        const stepDef = PIPELINE_STEPS.find((s) => s.step === revertData.rejected_gate);
        return (
          <RevertDecisionCard
            projectId={project.id}
            gate={revertData.rejected_gate}
            stepName={stepDef?.name || `Step ${revertData.rejected_gate}`}
            reason={revertData.rejection_reason}
            rejectedAt={revertData.rejected_at}
            onRevert={fetchProject}
          />
        );
      })()}

      {/* Estimation Summary — Full width, high visibility for George */}
      {project.estimation && (
        <div className="estimation-glow relative rounded-2xl p-6 bg-white shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
                <Calculator className="h-4 w-4 text-white" />
              </div>
              <h2 className="text-sm font-semibold text-gray-900">Estimation Summary</h2>
            </div>
            <div className="flex items-center gap-2">
              {project.estimation.sent_at && (
                <div className="flex items-center gap-1.5 bg-blue-50 text-blue-700 text-xs px-3 py-1.5 rounded-lg ring-1 ring-blue-200">
                  <Send className="h-3 w-3" />
                  Sent {formatDate(project.estimation.sent_at)}
                </div>
              )}
              {project.estimation.george_approved && (
                <div className="flex items-center gap-1.5 bg-green-50 text-green-700 text-xs px-3 py-1.5 rounded-lg ring-1 ring-green-200">
                  <CheckCircle className="h-3.5 w-3.5" />
                  <span className="font-medium">Approved</span>
                  <span className="text-green-600 text-[10px]">{formatDateTime(project.estimation.approved_at)}</span>
                </div>
              )}
              {/* Generate BOQ — produces the Dubai industry 13-bill Excel and
                  downloads it on success. PDF lives behind a separate
                  "Download BOQ (PDF)" button so the user picks which artefact
                  they need rather than getting both popups. */}
              <button
                onClick={async () => {
                  if (detailedElectricalOnly) {
                    const result = await runAction('power-boq');
                    // Only open the Excel download if the XLSX actually
                    // generated. Without this guard we'd open /boq which
                    // returns "No BOQ generated yet" when xlsx_generated:false
                    // — confusing the user into thinking the whole BOQ failed.
                    if (result.ok && result.data?.xlsx_generated === true) {
                      window.open(`/api/projects/${params.id}/boq`, '_blank');
                    }
                  } else {
                    runAction('boq');
                  }
                }}
                disabled={actionLoading === 'boq' || actionLoading === 'power-boq'}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold text-white bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 shadow-md shadow-emerald-200 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                title={detailedElectricalOnly ? 'Detailed-electrical project — generates the Dubai industry-standard 13-bill XLSX (PDF is a separate download)' : 'Runs the Excel BOQ orchestrator'}
              >
                {(actionLoading === 'boq' || actionLoading === 'power-boq') ? (
                  <>
                    <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-white border-t-transparent" />
                    Generating...
                  </>
                ) : (
                  <>
                    <FileSpreadsheet className="h-3.5 w-3.5" />
                    {detailedElectricalOnly ? 'Generate BOQ (Excel)' : (project.estimation?.generated_boq_url ? 'Regenerate BOQ' : 'Generate BOQ')}
                  </>
                )}
              </button>
            </div>
          </div>
          {/* === SECTION A: Math chain — Base → Margin → Final Quote === */}
          <div className="grid grid-cols-1 md:grid-cols-7 gap-3 items-center mb-5">
            {/* Base cost */}
            <div className="md:col-span-2 bg-gray-50 rounded-xl p-4">
              <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Base Cost</p>
              <FieldSource projectId={project.id} boqField="subtotal" block>
                <p className="text-xl font-bold text-gray-900 tabular-nums">{formatAED(project.estimation.total_aed)}</p>
              </FieldSource>
              <p className="text-[10px] text-gray-500 mt-0.5 tabular-nums">{formatAED(project.estimation.cost_per_sqft_aed)}/sqft</p>
            </div>
            {/* × margin */}
            <div className="hidden md:flex flex-col items-center text-gray-300">
              <span className="text-2xl font-light leading-none">×</span>
              <span className="text-[10px] mt-0.5 font-medium text-gray-500">{(1 + project.estimation.margin_percent / 100).toFixed(2)}</span>
              <span className="text-[9px] text-gray-400">+{project.estimation.margin_percent}% margin</span>
            </div>
            {/* = */}
            <div className="hidden md:flex flex-col items-center text-gray-300">
              <span className="text-2xl font-light leading-none">=</span>
            </div>
            {/* Final quote */}
            <div className="md:col-span-3 relative rounded-xl p-5 overflow-hidden bg-gradient-to-br from-blue-600 to-indigo-700 shadow-xl shadow-blue-200/60 final-quote-shimmer">
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-shimmer-sweep" />
              <p className="relative text-[10px] font-semibold text-blue-200 uppercase tracking-wider mb-1">Final Quote</p>
              <FieldSource projectId={project.id} boqField="final_quote_aed" block>
                <p className="relative text-3xl font-bold text-white tabular-nums leading-tight">{formatAED(project.estimation.final_quote_aed)}</p>
              </FieldSource>
              <p className="relative text-[10px] text-blue-200 mt-1">
                {project.total_area_sqft ? `${formatAED((project.estimation.final_quote_aed || 0) / project.total_area_sqft)}/sqft total` : ''}
              </p>
            </div>
          </div>

          {/* === SECTION B: Yardstick gauge — single horizontal scale === */}
          {project.estimation.yardstick_min_aed != null && project.estimation.yardstick_max_aed != null && (() => {
            const min = project.estimation.yardstick_min_aed;
            const max = project.estimation.yardstick_max_aed;
            const yourTotal = project.estimation.final_quote_aed || 0;
            // Extend the visual scale to ±20% past min/max so the marker isn't pinned to the edge
            const padding = (max - min) * 0.2;
            const scaleMin = Math.min(yourTotal, min - padding);
            const scaleMax = Math.max(yourTotal, max + padding);
            const scaleRange = scaleMax - scaleMin || 1;
            const yourPct = ((yourTotal - scaleMin) / scaleRange) * 100;
            const minPct = ((min - scaleMin) / scaleRange) * 100;
            const maxPct = ((max - scaleMin) / scaleRange) * 100;
            const status = project.estimation.yardstick_status;
            const statusColor = status === 'within_range' ? 'bg-green-500' : status === 'below_market' ? 'bg-amber-500' : status === 'above_market' ? 'bg-red-500' : 'bg-gray-500';
            const statusText = status === 'within_range' ? 'IN MARKET RANGE' : status === 'below_market' ? 'BELOW MARKET' : status === 'above_market' ? 'ABOVE MARKET' : 'YARDSTICK PENDING';
            const statusBadge = status === 'within_range' ? 'bg-green-100 text-green-700 ring-green-300' : status === 'below_market' ? 'bg-amber-100 text-amber-700 ring-amber-300' : status === 'above_market' ? 'bg-red-100 text-red-700 ring-red-300' : 'bg-gray-100 text-gray-600 ring-gray-200';
            return (
              <div className="bg-gradient-to-r from-slate-50 to-gray-50 rounded-xl p-5 ring-1 ring-gray-100">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Market Yardstick</p>
                    <FieldSource projectId={project.id} field="building_type" />
                  </div>
                  <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full ring-1 ${statusBadge}`}>
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${statusColor}`} />
                    {statusText}
                  </span>
                </div>

                {/* Gauge */}
                <div className="relative h-12">
                  {/* Track */}
                  <div className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-2 rounded-full bg-gradient-to-r from-amber-200 via-green-200 to-red-200" />
                  {/* Market range overlay (green zone) */}
                  <div
                    className="absolute top-1/2 -translate-y-1/2 h-2 rounded-full bg-green-400/60 ring-1 ring-green-500/40"
                    style={{ left: `${minPct}%`, width: `${maxPct - minPct}%` }}
                  />
                  {/* Min tick */}
                  <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex flex-col items-center" style={{ left: `${minPct}%` }}>
                    <div className="w-0.5 h-4 bg-gray-400" />
                    <p className="text-[9px] text-gray-500 mt-0.5 tabular-nums whitespace-nowrap">Min<br/>{formatAED(min)}</p>
                  </div>
                  {/* Max tick */}
                  <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex flex-col items-center" style={{ left: `${maxPct}%` }}>
                    <div className="w-0.5 h-4 bg-gray-400" />
                    <p className="text-[9px] text-gray-500 mt-0.5 tabular-nums whitespace-nowrap">Max<br/>{formatAED(max)}</p>
                  </div>
                  {/* Your quote marker */}
                  <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex flex-col items-center" style={{ left: `${yourPct}%` }}>
                    <div className={`w-4 h-4 rounded-full ring-4 ring-white shadow-lg ${statusColor}`} />
                    <p className={`text-[10px] font-bold mt-0.5 tabular-nums whitespace-nowrap ${status === 'within_range' ? 'text-green-700' : status === 'below_market' ? 'text-amber-700' : 'text-red-700'}`}>
                      You<br/>{formatAED(yourTotal)}
                    </p>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* === SECTION C: Per-service grid (cards instead of bars) === */}
          {(() => {
            const yardstickLog = project.activity_log.find(l => l.step === 21 && l.status === 'completed' && (l.details as any)?.per_service);
            const perService = (yardstickLog?.details as any)?.per_service as Array<{ service_type: string; estimated_per_sqft: number; market_min: number; market_max: number; status: string }> | undefined;
            if (!perService || perService.length === 0) return null;
            return (
              <div className="mt-5">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Per-Service Comparison (AED/sqft)</p>
                  <p className="text-[9px] text-gray-400">{perService.length} services scored against market range</p>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">
                  {perService.map(s => {
                    const svcLabel = (SERVICE_LABELS as Record<string, string>)[s.service_type] || s.service_type;
                    const statusBg = s.status === 'within_range' ? 'bg-green-50 ring-green-200' : s.status === 'below_market' ? 'bg-amber-50 ring-amber-200' : 'bg-red-50 ring-red-200';
                    const statusText = s.status === 'within_range' ? 'text-green-700' : s.status === 'below_market' ? 'text-amber-700' : 'text-red-700';
                    const statusDot = s.status === 'within_range' ? 'bg-green-500' : s.status === 'below_market' ? 'bg-amber-500' : 'bg-red-500';
                    const statusLabel = s.status === 'within_range' ? 'In range' : s.status === 'below_market' ? 'Below' : 'Above';
                    // Gauge math
                    const padding = (s.market_max - s.market_min) * 0.2;
                    const sMin = Math.min(s.estimated_per_sqft, s.market_min - padding);
                    const sMax = Math.max(s.estimated_per_sqft, s.market_max + padding);
                    const sRange = sMax - sMin || 1;
                    const yourPct = Math.max(0, Math.min(100, ((s.estimated_per_sqft - sMin) / sRange) * 100));
                    const minPct = Math.max(0, Math.min(100, ((s.market_min - sMin) / sRange) * 100));
                    const maxPct = Math.max(0, Math.min(100, ((s.market_max - sMin) / sRange) * 100));
                    return (
                      <div key={s.service_type} className={`rounded-xl p-3 ring-1 ${statusBg}`}>
                        <div className="flex items-start justify-between mb-2">
                          <p className="text-xs font-semibold text-gray-700 truncate" title={svcLabel}>{svcLabel}</p>
                          <span className={`inline-flex items-center gap-1 text-[9px] font-bold uppercase ${statusText}`}>
                            <span className={`inline-block w-1.5 h-1.5 rounded-full ${statusDot}`} />
                            {statusLabel}
                          </span>
                        </div>
                        <p className={`text-base font-bold tabular-nums ${statusText}`}>
                          {s.estimated_per_sqft.toFixed(1)}
                          <span className="text-[10px] font-normal text-gray-400 ml-1">AED/sqft</span>
                        </p>
                        {/* Mini gauge */}
                        <div className="relative h-1.5 mt-2 rounded-full bg-white/60 ring-1 ring-gray-200">
                          <div className="absolute h-full rounded-full bg-green-300/70" style={{ left: `${minPct}%`, width: `${maxPct - minPct}%` }} />
                          <div className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full ring-2 ring-white ${statusDot}`} style={{ left: `${yourPct}%` }} />
                        </div>
                        <p className="text-[9px] text-gray-500 mt-1.5 tabular-nums">
                          Market: {s.market_min.toFixed(1)} — {s.market_max.toFixed(1)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* BOQ Preview — shows generated BOQ data inline */}
      {project.estimation?.generated_boq_url && (
        <CollapsibleSection
          id="boq-preview"
          icon={FileSpreadsheet}
          iconBg="bg-gradient-to-br from-indigo-500 to-purple-600"
          iconColor="text-white"
          title="Bill of Quantities (BOQ)"
          isOpen={isSectionOpen('boq-preview')}
          onToggle={() => toggleSection('boq-preview')}
          summary={`Final Quote: ${formatAED(project.estimation.final_quote_aed)}`}
          headerRight={
            <div className="flex items-center gap-2">
              <a href={`/api/projects/${params.id}/boq`} onClick={e => e.stopPropagation()}
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl font-semibold text-xs hover:from-indigo-700 hover:to-purple-700 transition-all shadow-md shadow-indigo-200">
                <Download className="h-3.5 w-3.5" /> Excel
              </a>
              <a href={`/api/projects/${params.id}/boq/pdf`} onClick={e => e.stopPropagation()}
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-rose-600 to-red-600 text-white rounded-xl font-semibold text-xs hover:from-rose-700 hover:to-red-700 transition-all shadow-md shadow-rose-200">
                <Download className="h-3.5 w-3.5" /> PDF
              </a>
            </div>
          }
          noPadding
        >

          {/* BOQ Summary Table */}
          <div className="p-5">
            {project.services.filter(s => s.is_required && s.total_aed).length === 0 ? (
              <div className="text-center py-8">
                <FileSpreadsheet className="h-10 w-10 text-gray-300 mx-auto mb-3" />
                <p className="text-sm text-gray-500">BOQ generated but no service pricing data available.</p>
                <p className="text-xs text-gray-400 mt-1">Try running estimation again with "Rescan from Step 1".</p>
              </div>
            ) : null}
            <table className={`w-full text-sm ${project.services.filter(s => s.is_required && s.total_aed).length === 0 ? 'hidden' : ''}`}>
              <thead>
                <tr className="border-b-2 border-gray-200">
                  <th className="text-left py-2 px-3 font-semibold text-gray-700 text-xs uppercase tracking-wider">#</th>
                  <th className="text-left py-2 px-3 font-semibold text-gray-700 text-xs uppercase tracking-wider">Service</th>
                  <th className="text-left py-2 px-3 font-semibold text-gray-700 text-xs uppercase tracking-wider">System</th>
                  <th className="text-right py-2 px-3 font-semibold text-gray-700 text-xs uppercase tracking-wider">Amount (AED)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {project.services.filter(s => s.is_required && s.total_aed).map((svc, i) => (
                  <tr key={svc.id} className="hover:bg-gray-50">
                    <td className="py-3 px-3 text-gray-500 tabular-nums">{i + 1}</td>
                    <td className="py-3 px-3 font-medium text-gray-900">{SERVICE_LABELS[svc.service_type] || svc.service_type}</td>
                    <td className="py-3 px-3 text-gray-600">{svc.system_type || '—'}</td>
                    <td className="py-3 px-3 text-right font-bold tabular-nums text-gray-900">{formatAED(svc.total_aed)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-300 bg-gray-50">
                  <td colSpan={3} className="py-3 px-3 font-bold text-gray-700">Subtotal</td>
                  <td className="py-3 px-3 text-right">
                    <FieldSource projectId={project.id} boqField="subtotal" block>
                      <span className="font-bold tabular-nums text-gray-900">{formatAED(project.estimation.total_aed)}</span>
                    </FieldSource>
                  </td>
                </tr>
                <tr className="bg-gray-50">
                  <td colSpan={3} className="py-2 px-3 text-gray-500">Margin ({project.estimation.margin_percent}%)</td>
                  <td className="py-2 px-3 text-right">
                    <FieldSource projectId={project.id} boqField="margin_percent" block>
                      <span className="tabular-nums text-gray-600">
                        {formatAED((project.estimation.final_quote_aed || 0) - (project.estimation.total_aed || 0))}
                      </span>
                    </FieldSource>
                  </td>
                </tr>
                <tr className="bg-gradient-to-r from-blue-50 to-indigo-50 border-t-2 border-blue-200">
                  <td colSpan={3} className="py-3 px-3 font-bold text-blue-800 text-base">Final Quote</td>
                  <td className="py-3 px-3 text-right">
                    <FieldSource projectId={project.id} boqField="final_quote_aed" block>
                      <span className="font-bold tabular-nums text-blue-800 text-base">{formatAED(project.estimation.final_quote_aed)}</span>
                    </FieldSource>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Per-service line items (expandable) */}
          {project.services.filter(s => s.is_required && s.ai_extraction).map(svc => {
            const ext = svc.ai_extraction as Record<string, any>;
            const lineItems = ext?.line_items as Array<{ description: string; quantity: number; unit: string; unit_rate_aed: number; total_aed: number; category: string; confidence?: number; source_text?: string }> | undefined;
            if (!lineItems || lineItems.length === 0) return null;
            const scale = ext?.duct_routes?.scale as { method?: string; confidence?: number; reference_text?: string | null; sanity_check?: { passed: boolean; ratio: number; inferred_total_length_m: number; expected_max_length_m: number } } | undefined;
            return (
              <details key={svc.id} className="border-t border-gray-100">
                <summary className="px-5 py-3 cursor-pointer hover:bg-gray-50 flex items-center gap-2 text-sm font-medium text-gray-700">
                  <ChevronRight className="h-4 w-4 text-gray-400 transition-transform details-open:rotate-90" />
                  {SERVICE_LABELS[svc.service_type] || svc.service_type} — {lineItems.length} line items
                </summary>
                <div className="px-5 pb-4">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-200 text-gray-500">
                        <th className="text-left py-1.5 px-2">#</th>
                        <th className="text-left py-1.5 px-2">Description</th>
                        <th className="text-right py-1.5 px-2">Qty</th>
                        <th className="text-center py-1.5 px-2">Unit</th>
                        <th className="text-right py-1.5 px-2">Rate</th>
                        <th className="text-right py-1.5 px-2">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {lineItems.map((item, j) => {
                        return (
                          <tr key={j} className="hover:bg-gray-50" title={item.source_text || undefined}>
                            <td className="py-1.5 px-2 text-gray-400 tabular-nums">{j + 1}</td>
                            <td className="py-1.5 px-2 text-gray-800">
                              {item.description}
                            </td>
                            <td className="py-1.5 px-2 text-right tabular-nums">{item.quantity}</td>
                            <td className="py-1.5 px-2 text-center text-gray-500">{item.unit}</td>
                            <td className="py-1.5 px-2 text-right tabular-nums">{item.unit_rate_aed?.toLocaleString()}</td>
                            <td className="py-1.5 px-2 text-right tabular-nums font-medium">{formatAED(item.total_aed)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </details>
            );
          })}
        </CollapsibleSection>
      )}

      {/* Plan & Wiring Diagram — inline 2D elevation built from the electrical scan */}
      {(() => {
        const elecSvc = project.services?.find(s => s.service_type === 'electrical');
        if (!elecSvc) return null;
        const elec = (elecSvc.ai_extraction as ElectricalProcedureResult | null) || null;
        const runCount = Array.isArray(elec?.cable_schedule) ? elec!.cable_schedule.length : 0;
        // Enrich on read so the diagram reflects the SAME per-floor take-off the
        // BOQ uses — including typical-floor feeders multiplied across identical
        // floors. Unwrap raw_electrical_procedure (where the feeder arrays live)
        // and feed the enriched bare result to buildPlanModel.
        const rawProc = (elec as { raw_electrical_procedure?: ElectricalProcedureResult } | null)?.raw_electrical_procedure ?? elec;
        const diagramElec = rawProc
          ? enrichElectricalResult(rawProc as Parameters<typeof enrichElectricalResult>[0])
          : null;
        // Post-scan validation report (flag, don't block) — attached to
        // ai_extraction by the estimate route / worker. Split into "missing"
        // (not in drawing) vs "estimated" (guessed, verify) so the operator
        // knows exactly what to check. Labels are already terse.
        const scanVal = (elecSvc.ai_extraction as { scan_validation?: {
          passed: boolean;
          retried?: boolean;
          violations: Array<{ severity: 'error' | 'warning'; kind?: 'missing' | 'estimated' | 'other'; message: string }>;
        } } | null)?.scan_validation;
        const vios = scanVal?.violations ?? [];
        const scanMissing = vios.filter(v => v.kind === 'missing');
        const scanEstimated = vios.filter(v => v.kind === 'estimated');
        const scanOther = vios.filter(v => v.kind !== 'missing' && v.kind !== 'estimated');
        return (
          <CollapsibleSection
            id="plan-diagram"
            icon={Box}
            iconBg="bg-gradient-to-br from-sabi-500 to-sabi-600"
            iconColor="text-white"
            title="Plan & Wiring Diagram"
            isOpen={isSectionOpen('plan-diagram')}
            onToggle={() => toggleSection('plan-diagram')}
            summary={runCount > 0 ? `${runCount} cable runs` : 'available after scan'}
            headerRight={
              <div className="flex items-center gap-2">
                {runCount > 0 && (
                  <a
                    href={`/api/projects/${params.id}/boq/industry`}
                    onClick={e => e.stopPropagation()}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-emerald-600 to-green-600 text-white rounded-lg font-semibold text-xs hover:from-emerald-700 hover:to-green-700 transition-all"
                    title="Download the Dubai industry-standard 13-Bill priced BOQ (George's format)"
                  >
                    <FileSpreadsheet className="h-3.5 w-3.5" /> Export Excel (BOQ)
                  </a>
                )}
                <Link
                  href={`/plan?project=${params.id}`}
                  onClick={e => e.stopPropagation()}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-sabi-500 text-white rounded-lg font-semibold text-xs hover:bg-sabi-600 transition-all"
                >
                  <Box className="h-3.5 w-3.5" /> Full view
                </Link>
              </div>
            }
            noPadding
          >
            {scanVal && vios.length > 0 && (
              <div className="mx-4 mt-3 space-y-2">
                {scanMissing.length > 0 && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800">
                    <div className="font-semibold">✗ Missing — not in drawing{scanVal.retried ? ' (after re-scan)' : ''}</div>
                    <ul className="mt-1 ml-5 list-disc space-y-0.5">
                      {scanMissing.map((v, i) => <li key={i}>{v.message}</li>)}
                    </ul>
                  </div>
                )}
                {scanEstimated.length > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                    <div className="font-semibold">⚠ Estimated — verify (not read from drawing)</div>
                    <ul className="mt-1 ml-5 list-disc space-y-0.5">
                      {scanEstimated.map((v, i) => <li key={i}>{v.message}</li>)}
                    </ul>
                  </div>
                )}
                {scanOther.length > 0 && scanMissing.length === 0 && scanEstimated.length === 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-700">
                    <ul className="ml-5 list-disc space-y-0.5">
                      {scanOther.map((v, i) => <li key={i}>{v.message}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}
            <PlanDiagram
              elec={diagramElec}
              projectId={Array.isArray(params.id) ? params.id[0] : params.id}
              project={{
                floors: project.floors,
                total_area_sqft: project.total_area_sqft,
                building_name: project.project_name || project.client_name,
              }}
            />
          </CollapsibleSection>
        );
      })()}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Details — data review, no action buttons */}
        <div className="lg:col-span-8 space-y-6">
          {/* Project Info Card — Editable */}
          <CollapsibleSection
            id="project-info"
            icon={Building2}
            iconBg="bg-blue-50"
            iconColor="text-blue-600"
            title="Project Information"
            isOpen={isSectionOpen('project-info') || editing}
            onToggle={() => toggleSection('project-info')}
            summary={[project.building_type, project.location, project.floors ? `${project.floors} floors` : null, project.total_area_sqft ? `${formatNumber(project.total_area_sqft)} sqft` : null].filter(Boolean).join(' · ') || 'Not extracted'}
            headerRight={editing ? (
              <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                <button onClick={() => setEditing(false)} className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded border">Cancel</button>
                <button onClick={saveEditing} className="text-xs text-white bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded flex items-center gap-1">
                  <Save className="h-3 w-3" /> Save
                </button>
              </div>
            ) : (
              <button onClick={(e) => { e.stopPropagation(); startEditing(); }} className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1">
                <Pencil className="h-3 w-3" /> Edit
              </button>
            )}
          >
            {editing ? (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <EditField label="Project Name" value={editFields.project_name} onChange={v => setEditFields(f => ({...f, project_name: v}))} />
                <EditField label="Client Name" value={editFields.client_name} onChange={v => setEditFields(f => ({...f, client_name: v}))} />
                <EditField label="Building Type" value={editFields.building_type} onChange={v => setEditFields(f => ({...f, building_type: v}))}
                  options={['office', 'retail', 'residential', 'warehouse', 'villa', 'hotel', 'hospital', 'restaurant']} />
                <EditField label="Location" value={editFields.location} onChange={v => setEditFields(f => ({...f, location: v}))} />
                <EditField label="Total Floors" value={editFields.floors} onChange={v => setEditFields(f => ({...f, floors: v}))} type="number" />
                <EditField label="Parking Floors" value={editFields.parking_floors} onChange={v => setEditFields(f => ({...f, parking_floors: v}))} type="number" />
                <EditField label="Total Area (sqft)" value={editFields.total_area_sqft} onChange={v => setEditFields(f => ({...f, total_area_sqft: v}))} type="number" />
                <EditField label="Height (m)" value={editFields.typical_height_m} onChange={v => setEditFields(f => ({...f, typical_height_m: v}))} type="number" />
                <EditField label="Deadline" value={editFields.deadline} onChange={v => setEditFields(f => ({...f, deadline: v}))} type="date" />
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <InfoItem icon={Building2} label="Building Type" value={project.building_type || 'Not extracted'} lineageProjectId={project.id} lineageField="building_type" />
                <InfoItem icon={MapPin} label="Location" value={project.location || 'Not extracted'} lineageProjectId={project.id} lineageField="location" />
                <InfoItem icon={Layers} label="Total Floors" value={project.floors ? String(project.floors) : 'Not extracted'} lineageProjectId={project.id} lineageField="floors" />
                <InfoItem icon={Layers} label="Parking Floors" value={project.parking_floors ? String(project.parking_floors) : '-'} lineageProjectId={project.id} lineageField="parking_floors" />
                <InfoItem icon={Layers} label="Typical Floors" value={project.typical_floors ? String(project.typical_floors) : '-'} lineageProjectId={project.id} lineageField="typical_floors" />
                <InfoItem icon={Ruler} label="Total Area" value={project.total_area_sqft ? `${formatNumber(project.total_area_sqft)} sqft` : 'Not extracted'} lineageProjectId={project.id} lineageField="total_area_sqft" />
                <InfoItem icon={Ruler} label="Area/Floor" value={project.area_per_floor_sqft ? `${formatNumber(project.area_per_floor_sqft)} sqft` : '-'} lineageProjectId={project.id} lineageField="area_per_floor_sqft" />
                <InfoItem icon={Ruler} label="Typical Height" value={project.typical_height_m ? `${project.typical_height_m}m` : '-'} lineageProjectId={project.id} lineageField="typical_height_m" />
                {project.deadline && <InfoItem icon={Tag} label="Deadline" value={formatDate(project.deadline)} />}
                {(project.ai_extraction as any)?.consultant && (
                  <InfoItem icon={Building2} label="Consultant" value={(project.ai_extraction as any).consultant} />
                )}
                {(project as any).reputation_class && (() => {
                  const rep = REPUTATION_META[(project as any).reputation_class] || REPUTATION_META.unknown;
                  return (
                    <div className="flex items-center gap-2">
                      <Tag className="h-4 w-4 text-gray-400" />
                      <div>
                        <p className="text-[10px] text-gray-500">Reputation</p>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${rep.bgColor} ${rep.color}`}>
                          {rep.label}
                        </span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </CollapsibleSection>

          {/* Specification Analysis — brands, makes, standards */}
          {project.ai_extraction && (project.ai_extraction as any).spec_analysis && (() => {
            const spec = (project.ai_extraction as any).spec_analysis;
            const reqs = (spec.requirements || []) as Array<{ service: string; category: string; item: string; specified_brand: string | null; standard: string | null; remarks: string | null }>;
            const brands = (spec.approved_makes || []) as string[];
            const standards = (spec.standards_referenced || []) as string[];
            if (reqs.length === 0 && brands.length === 0) return null;
            return (
              <CollapsibleSection
                id="spec-reqs"
                icon={FileText}
                iconBg="bg-purple-50"
                iconColor="text-purple-600"
                title="Specification Requirements"
                badge={<>
                  <span className="text-[10px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-semibold">{reqs.length} items</span>
                  <FieldSource projectId={project.id} specField="requirements" />
                </>}
                isOpen={isSectionOpen('spec-reqs')}
                onToggle={() => toggleSection('spec-reqs')}
                summary={`${reqs.length} requirements · ${brands.length} approved makes`}
              >

                {brands.length > 0 && (
                  <div className="mb-3">
                    <p className="text-[10px] font-medium text-gray-500 mb-1">Approved Makes:</p>
                    <div className="flex flex-wrap gap-1">
                      {brands.map((b: string, i: number) => (
                        <span key={i} className="text-[10px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">{b}</span>
                      ))}
                    </div>
                  </div>
                )}

                {standards.length > 0 && (
                  <div className="mb-3">
                    <p className="text-[10px] font-medium text-gray-500 mb-1">Standards Referenced:</p>
                    <div className="flex flex-wrap gap-1">
                      {standards.map((s: string, i: number) => (
                        <span key={i} className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{s}</span>
                      ))}
                    </div>
                  </div>
                )}

                {reqs.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-[10px] text-gray-400 uppercase border-b">
                          <th className="text-left py-1 pr-3">Service</th>
                          <th className="text-left py-1 pr-3">Item</th>
                          <th className="text-left py-1 pr-3">Brand</th>
                          <th className="text-left py-1 pr-3">Standard</th>
                          <th className="text-left py-1">Remarks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reqs.slice(0, 15).map((r, i: number) => (
                          <tr key={i} className="border-b border-gray-50">
                            <td className="py-1.5 pr-3 text-gray-500">{r.service}</td>
                            <td className="py-1.5 pr-3 font-medium text-gray-700">{r.item}</td>
                            <td className="py-1.5 pr-3">
                              {r.specified_brand ? (
                                <span className="text-blue-700 font-medium">{r.specified_brand}</span>
                              ) : (
                                <span className="text-gray-300">—</span>
                              )}
                            </td>
                            <td className="py-1.5 pr-3 text-gray-500">{r.standard || '—'}</td>
                            <td className="py-1.5 text-gray-400">{r.remarks || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {reqs.length > 15 && (
                      <p className="text-[10px] text-gray-400 mt-1">...and {reqs.length - 15} more items</p>
                    )}
                  </div>
                )}
              </CollapsibleSection>
            );
          })()}

          {/* AI Classification — confidence reasoning, keywords, priority */}
          {project.ai_classification && (() => {
            const cls = project.ai_classification as Record<string, unknown>;
            const isRfq = cls.isRfq as boolean;
            const reasoning = cls.reasoning as string || '';
            const keywords = (cls.keywordsFound as string[]) || [];
            const aiPriority = cls.priority as string || '';

            const priorityLabels: Record<string, { label: string; cls: string }> = {
              priority_top: { label: 'Top Priority', cls: 'bg-purple-100 text-purple-700' },
              priority_gen: { label: 'General Priority', cls: 'bg-blue-100 text-blue-700' },
              new: { label: 'New / Unclear', cls: 'bg-amber-100 text-amber-700' },
              ignore: { label: 'Ignore', cls: 'bg-gray-100 text-gray-500' },
            };
            const priorityBadge = priorityLabels[aiPriority];

            return (
              <CollapsibleSection
                id="ai-class"
                icon={Brain}
                iconBg="bg-gradient-to-br from-indigo-500 to-purple-600"
                iconColor="text-white"
                title="AI Classification"
                badge={<Sparkles className="h-3.5 w-3.5 text-indigo-400" />}
                isOpen={isSectionOpen('ai-class')}
                onToggle={() => toggleSection('ai-class')}
                summary={`${isRfq ? 'RFQ Detected' : 'Not RFQ'}${priorityBadge ? ` · ${priorityBadge.label}` : ''}`}
              >
                {/* RFQ status + priority + confidence */}
                <div className="flex items-center gap-2 mb-4 flex-wrap">
                  <span className={`px-3 py-1.5 rounded-xl text-xs font-bold ${
                    isRfq ? 'bg-green-100 text-green-700 ring-1 ring-green-200' : 'bg-red-100 text-red-700 ring-1 ring-red-200'
                  }`}>
                    {isRfq ? 'RFQ Detected' : 'Not RFQ'}
                  </span>
                  {priorityBadge && (
                    <span className={`px-3 py-1.5 rounded-xl text-xs font-semibold ring-1 ring-current/10 ${priorityBadge.cls}`}>
                      {priorityBadge.label}
                    </span>
                  )}
                </div>


                {/* AI Reasoning */}
                {reasoning && (
                  <div className="bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-100 rounded-xl p-4 mb-4">
                    <div className="flex items-center gap-1.5 mb-2">
                      <Brain className="h-3.5 w-3.5 text-indigo-600" />
                      <p className="text-xs font-semibold text-indigo-700">AI Reasoning</p>
                    </div>
                    <p className="text-sm text-gray-700 leading-relaxed">{reasoning}</p>
                  </div>
                )}

                {/* Keywords found */}
                {keywords.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 mb-2">
                      <Tag className="h-3.5 w-3.5 text-gray-400" />
                      <p className="text-xs font-medium text-gray-500">Keywords Found ({keywords.length})</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {keywords.map((kw) => (
                        <span
                          key={kw}
                          className="text-[11px] px-2.5 py-1 bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-lg font-medium"
                        >
                          {kw}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </CollapsibleSection>
            );
          })()}

          {/* Email Content — Clean rendering */}
          {project.email_snippet && (
            <CollapsibleSection
              id="email"
              icon={Mail}
              iconBg="bg-sky-50"
              iconColor="text-sky-600"
              title="Email Content"
              isOpen={isSectionOpen('email')}
              onToggle={() => toggleSection('email')}
              summary={`From: ${project.email_from || 'Unknown'}`}
              headerRight={
                <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                  <FieldSource projectId={project.id} field="email_snippet" />
                  {/* Summary / Full Mail toggle */}
                  <div className="flex items-center bg-gray-100 rounded-lg p-0.5 mr-1">
                    <button
                      onClick={() => setShowFullEmail(false)}
                      className={`text-xs flex items-center gap-1 px-2.5 py-1 rounded-md transition-colors ${
                        !showFullEmail
                          ? 'bg-white text-blue-700 shadow-sm font-semibold'
                          : 'text-gray-600 hover:text-gray-800'
                      }`}
                    >
                      <FileText className="h-3 w-3" />
                      Summary
                    </button>
                    {project.email_thread_id && (
                      <button
                        onClick={() => {
                          if (fullEmail) {
                            setShowFullEmail(true);
                          } else {
                            loadFullEmail();
                          }
                        }}
                        disabled={emailLoading}
                        className={`text-xs flex items-center gap-1 px-2.5 py-1 rounded-md transition-colors disabled:opacity-50 ${
                          showFullEmail
                            ? 'bg-white text-blue-700 shadow-sm font-semibold'
                            : 'text-gray-600 hover:text-gray-800'
                        }`}
                      >
                        {emailLoading ? (
                          <div className="animate-spin rounded-full h-3 w-3 border border-current border-t-transparent" />
                        ) : (
                          <Eye className="h-3 w-3" />
                        )}
                        Full Mail
                      </button>
                    )}
                  </div>
                  <button
                    onClick={() => { setReplyTemplate(undefined); setReplyOpen(true); }}
                    className="text-xs text-green-600 hover:text-green-800 flex items-center gap-1 px-2.5 py-1.5 rounded-lg hover:bg-green-50 transition-colors"
                  >
                    <Reply className="h-3 w-3" />
                    Reply
                  </button>
                </div>
              }
            >
              {showFullEmail && fullEmail ? (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs text-gray-500">
                      {fullEmail.messageCount > 1 ? `${fullEmail.messageCount} messages in thread` : '1 message'}
                    </span>
                  </div>
                  {(fullEmail.thread || [fullEmail]).map((msg: any, i: number) => (
                    <div key={msg.messageId || i} className={`${i > 0 ? 'mt-3 pt-3 border-t border-gray-100' : ''}`}>
                      <div className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 mb-2">
                        <div className="text-xs text-gray-500">
                          <span className="font-medium text-gray-700">{msg.from}</span>
                          {msg.to && <span className="text-gray-400"> → {msg.to}</span>}
                        </div>
                        <span className="text-[10px] text-gray-400">{formatDateTime(msg.date)}</span>
                      </div>
                      {msg.body ? (
                        <EmailBodyFrame html={msg.body} />
                      ) : (
                        <p className="text-sm text-gray-500 italic">No body</p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-gray-50/50 rounded-lg px-4 py-3 border-l-3 border-l-sky-300">
                  <p className="text-sm text-gray-600 leading-relaxed">
                    {stripHtml(project.email_snippet)}
                  </p>
                </div>
              )}
            </CollapsibleSection>
          )}

          {/* Documents — Full email → zip → unzip → categorized flow */}
          <CollapsibleSection
            id="documents"
            icon={Paperclip}
            iconBg="bg-amber-50"
            iconColor="text-amber-600"
            title={`Documents (${project.attachments.length} files)`}
            isOpen={isSectionOpen('documents')}
            onToggle={() => toggleSection('documents')}
            summary={`${project.attachments.length} files`}
            noPadding
          >
            <DocumentsSection
              attachments={project.attachments}
              projectId={project.id as string}
              onUploaded={fetchProject}
            />
          </CollapsibleSection>

          {/* Extracted Data from PDFs — show what AI found */}
          {project.ai_extraction && (() => {
            const extractedFields = Object.entries(project.ai_extraction as Record<string, unknown>)
              .filter(([k, v]) => v !== null && v !== undefined && typeof v !== 'object' && k !== 'spec_analysis');
            return (
            <CollapsibleSection
              id="ai-extracted"
              icon={Brain}
              iconBg="bg-purple-50"
              iconColor="text-purple-600"
              title="AI Extracted Data"
              badge={<>
                <span className="text-[10px] bg-purple-100 text-purple-600 px-2 py-0.5 rounded-full font-medium">From PDF Analysis</span>
                <FieldSource projectId={project.id} field="floors" />
              </>}
              isOpen={isSectionOpen('ai-extracted')}
              onToggle={() => toggleSection('ai-extracted')}
              summary={`${extractedFields.length} fields extracted`}
            >
              <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-3">
                {extractedFields.map(([key, value]) => (
                  <div key={key}>
                    <dt className="text-[10px] text-gray-400 uppercase tracking-wider mb-0.5">
                      {key.replace(/_/g, ' ')}
                    </dt>
                    <dd className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-gray-800 capitalize truncate">{String(value)}</span>
                      <FieldSource projectId={project.id} field={key} />
                    </dd>
                  </div>
                ))}
              </dl>

              {/* Spec analysis if available */}
              {(project.ai_extraction as any)?.spec_analysis?.materials?.length > 0 && (
                <div className="mt-4 p-4 bg-amber-50 rounded-xl border border-amber-100">
                  <p className="text-xs font-semibold text-amber-700 mb-2">Specification Requirements</p>
                  <div className="flex flex-wrap gap-1.5">
                    {((project.ai_extraction as any).spec_analysis.materials as string[]).slice(0, 15).map((m: string, i: number) => (
                      <span key={i} className="text-[10px] bg-white text-amber-700 px-2 py-1 rounded border border-amber-200">{m}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Extracted images/drawings previews from attachments */}
              {project.attachments.filter(a => a.file_type === 'image' || (a.extracted_data as any)?.text).length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-semibold text-gray-600 mb-2">Analyzed Documents</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {project.attachments
                      .filter(a => (a.extracted_data as any)?.text || a.file_type === 'image')
                      .slice(0, 6)
                      .map(att => (
                        <div key={att.id} className="bg-gray-50 rounded-lg p-3 border border-gray-100 flex items-start gap-2">
                          <FileText className="h-4 w-4 text-gray-400 flex-shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-gray-700 truncate">{att.filename}</p>
                            {att.discipline && (
                              <span className="text-[9px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded font-medium">{att.discipline}</span>
                            )}
                            {(att.extracted_data as any)?.text && (
                              <p className="text-[10px] text-gray-400 mt-1 line-clamp-2">
                                {((att.extracted_data as any).text as string).substring(0, 150)}...
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </CollapsibleSection>
            );
          })()}

          {/* Services — Enhanced table */}
          {project.services.length > 0 && (
            <CollapsibleSection
              id="mep-services"
              icon={Wrench}
              iconBg="bg-orange-50"
              iconColor="text-orange-600"
              title={`MEP Services (${project.services.length})`}
              isOpen={isSectionOpen('mep-services')}
              onToggle={() => toggleSection('mep-services')}
              summary={`${project.services.length} services${totalServiceCost > 0 ? ` · ${formatAED(totalServiceCost)}` : ''}`}
              headerRight={totalServiceCost === 0 ? (
                <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
                  Not estimated yet
                </span>
              ) : undefined}
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-2.5 px-3 font-medium text-gray-600">Service</th>
                      <th className="text-left py-2.5 px-3 font-medium text-gray-600">System</th>
                      <th className="text-right py-2.5 px-3 font-medium text-gray-600">Tonnage</th>
                      <th className="text-right py-2.5 px-3 font-medium text-gray-600">Rate</th>
                      <th className="text-right py-2.5 px-3 font-medium text-gray-600">Qty/Area</th>
                      <th className="text-right py-2.5 px-3 font-medium text-gray-600">Total (AED)</th>
                      <th className="text-right py-2.5 px-3 font-medium text-gray-600 w-24">Share</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {project.services.map((svc) => {
                      const pct = totalServiceCost > 0 && svc.total_aed ? Math.round((svc.total_aed / totalServiceCost) * 100) : 0;
                      const barColor: Record<string, string> = {
                        hvac: 'bg-blue-500', electrical: 'bg-amber-500', plumbing: 'bg-cyan-500',
                        fire_fighting: 'bg-red-500', fire_alarm: 'bg-orange-500', bms: 'bg-purple-500',
                        lpg: 'bg-emerald-500', drainage: 'bg-teal-500',
                      };
                      // rate_source may be stored in notes or as a dedicated field
                      const rateSource = (svc as any).rate_source as string | undefined;
                      // Auto-adjusted by Phase 4/5 cohort multiplier — preserve audit trail
                      const autoAdjusted = (svc.ai_extraction as Record<string, unknown> | null)?.auto_adjusted as
                        | { base_rate_aed: number; final_rate_aed: number; multiplier: number; samples: number; cv: number | null; applied_at: string }
                        | undefined;
                      // Phase 9: cohort drift indicator. Lookup is 'service_type::building_type'.
                      const driftEntry = project.building_type
                        ? cohortDrift.get(`${svc.service_type}::${project.building_type}`)
                        : undefined;
                      const revertToBase = async () => {
                        if (!autoAdjusted) return;
                        const newTotal = Math.round(autoAdjusted.base_rate_aed * (svc.quantity ?? 0));
                        try {
                          const res = await fetch(`/api/projects/${project.id}/services`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              service_id: svc.id,
                              unit_rate_aed: autoAdjusted.base_rate_aed,
                              total_aed: newTotal,
                            }),
                          });
                          if (!res.ok) throw new Error('Revert failed');
                          toast(`Reverted ${SERVICE_LABELS[svc.service_type] || svc.service_type} to AED ${autoAdjusted.base_rate_aed}/unit`, 'success');
                          await fetchProject();
                        } catch (err: any) {
                          toast(`Revert failed: ${err.message}`, 'error');
                        }
                      };
                      return (
                        <tr key={svc.id} className="hover:bg-gray-50 group">
                          <td className="py-3 px-3">
                            <p className="text-gray-900 font-medium">{SERVICE_LABELS[svc.service_type] || svc.service_type}</p>
                            {autoAdjusted && (
                              <div className="mt-1 flex items-center gap-1.5 text-[10px]">
                                <span
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-medium"
                                  title={`Auto-adjusted from AED ${autoAdjusted.base_rate_aed} → ${autoAdjusted.final_rate_aed} based on ${autoAdjusted.samples} prior corrections (CV ${autoAdjusted.cv?.toFixed(3) ?? 'n/a'})`}
                                >
                                  auto-adj ×{autoAdjusted.multiplier.toFixed(2)} · n={autoAdjusted.samples}
                                </span>
                                <button
                                  onClick={revertToBase}
                                  className="text-blue-600 hover:text-blue-800 hover:underline"
                                  title={`Restore base rate AED ${autoAdjusted.base_rate_aed}`}
                                >
                                  revert
                                </button>
                              </div>
                            )}
                            {driftEntry && (
                              <div className="mt-1">
                                <span
                                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${driftEntry.shift_pct > 0 ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'}`}
                                  title={`Cohort multiplier shifted ${(driftEntry.shift_pct * 100).toFixed(1)}% in last 7d (n=${driftEntry.recent_n}). Review rate before sending. Last checked ${driftEntry.checked_at?.slice(0, 10) || ''}.`}
                                >
                                  cohort drift {driftEntry.shift_pct > 0 ? '↑' : '↓'}{Math.abs(driftEntry.shift_pct * 100).toFixed(0)}%
                                </span>
                              </div>
                            )}
                            {svc.notes && (
                              <p className="text-[10px] text-gray-400 mt-0.5 hidden group-hover:block leading-tight">{svc.notes}</p>
                            )}
                          </td>
                          <td className="py-3 px-3 text-gray-600">
                            {svc.system_type ? (
                              <FieldSource projectId={project.id} serviceId={svc.id} field="system_type" block>
                                <span>{svc.system_type}</span>
                              </FieldSource>
                            ) : '-'}
                          </td>
                          <td className="py-3 px-3 text-right text-gray-600 tabular-nums">
                            {svc.tonnage ? (
                              <FieldSource projectId={project.id} serviceId={svc.id} field="tonnage" block>
                                <span>{formatNumber(svc.tonnage)}</span>
                              </FieldSource>
                            ) : '-'}
                          </td>
                          <td className="py-3 px-3 text-right">
                            {svc.unit_rate_aed ? (
                              <FieldSource projectId={project.id} serviceId={svc.id} field="unit_rate_aed" block>
                                <span className="text-gray-600 tabular-nums">{formatAED(svc.unit_rate_aed)}</span>
                              </FieldSource>
                            ) : '-'}
                          </td>
                          <td className="py-3 px-3 text-right text-gray-600 tabular-nums">{svc.quantity ? formatNumber(svc.quantity) : '-'}</td>
                          <td className="py-3 px-3 text-right">
                            <FieldSource projectId={project.id} serviceId={svc.id} field="total_aed" block>
                              <span className="font-semibold tabular-nums">{formatAED(svc.total_aed)}</span>
                            </FieldSource>
                          </td>
                          <td className="py-3 px-3 text-right">
                            {pct > 0 && (
                              <div className="flex items-center justify-end gap-1.5">
                                <div className="w-12 bg-gray-100 rounded-full h-2">
                                  <div className={`${barColor[svc.service_type] || 'bg-gray-500'} h-2 rounded-full`} style={{ width: `${pct}%` }} />
                                </div>
                                <span className="text-xs text-gray-500 w-8 text-right">{pct}%</span>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {totalServiceCost > 0 && (
                    <tfoot>
                      <tr className="border-t-2 border-gray-300 bg-gray-50">
                        <td colSpan={5} className="py-3 px-3 font-semibold text-gray-700">Total</td>
                        <td className="py-3 px-3 text-right font-bold text-gray-900 tabular-nums">{formatAED(totalServiceCost)}</td>
                        <td className="py-3 px-3 text-right text-xs font-medium text-gray-500">100%</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
              <p className="mt-2 text-[10px] text-gray-400 flex items-center gap-1.5">
                <Info className="h-3 w-3 flex-shrink-0" />
                ERP Realsoft internal MEP benchmarks, Dubai/UAE Q1 2025. Hover rows for details.
              </p>
            </CollapsibleSection>
          )}

          {/* Power BOQ — Summary of Bills (rendered when BOQ has been generated) */}
          {boqSummary && (() => {
            const bills = boqSummary.bills;
            const grand = boqSummary.grand_total_aed;
            const sub = boqSummary.bills_subtotal_aed;
            return (
              <CollapsibleSection
                id="boq-summary"
                icon={FileSpreadsheet}
                iconBg="bg-blue-50"
                iconColor="text-blue-600"
                title="Power BOQ — Summary of Bills"
                isOpen={isSectionOpen('boq-summary')}
                onToggle={() => toggleSection('boq-summary')}
                summary={`${formatAED(grand)} incl. VAT · ${bills.filter(b => b.total_aed > 0).length}/13 bills priced`}
                headerRight={
                  <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                    Grand Total {formatAED(grand)}
                  </span>
                }
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-2.5 px-3 font-medium text-gray-600 w-10">#</th>
                        <th className="text-left py-2.5 px-3 font-medium text-gray-600">Bill</th>
                        <th className="text-right py-2.5 px-3 font-medium text-gray-600 w-20">Lines</th>
                        <th className="text-right py-2.5 px-3 font-medium text-gray-600 w-36">Total (AED)</th>
                        <th className="text-right py-2.5 px-3 font-medium text-gray-600 w-32">Share</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {bills.map((b) => {
                        const pct = sub > 0 ? Math.round((b.total_aed / sub) * 1000) / 10 : 0;
                        const unpriced = b.total_aed === 0;
                        return (
                          <tr key={b.no} className={unpriced ? 'text-gray-400' : 'hover:bg-gray-50'}>
                            <td className="py-2.5 px-3 tabular-nums">{b.no}</td>
                            <td className="py-2.5 px-3">
                              <p className={`${unpriced ? 'text-gray-400' : 'text-gray-900'} font-medium`}>{b.title}</p>
                              {unpriced && <p className="text-[10px] text-amber-600 mt-0.5">Not priced — review rates before submission</p>}
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums">{b.lines || '—'}</td>
                            <td className="py-2.5 px-3 text-right tabular-nums font-semibold">
                              {b.total_aed > 0 ? formatAED(b.total_aed) : '—'}
                            </td>
                            <td className="py-2.5 px-3">
                              {b.total_aed > 0 ? (
                                <div className="flex items-center gap-2 justify-end">
                                  <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                    <div className="h-full bg-blue-500" style={{ width: `${Math.min(100, pct)}%` }} />
                                  </div>
                                  <span className="text-[11px] text-gray-500 tabular-nums w-10 text-right">{pct.toFixed(1)}%</span>
                                </div>
                              ) : <span className="text-[11px] text-gray-300">—</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="border-t-2 border-gray-300">
                      <tr className="bg-gray-50">
                        <td colSpan={3} className="py-2 px-3 text-right text-gray-700 font-medium">Sub-total of Bills 1–13</td>
                        <td className="py-2 px-3 text-right tabular-nums font-semibold text-gray-900">{formatAED(sub)}</td>
                        <td />
                      </tr>
                      {boqSummary.provisional_sums_aed > 0 && (
                        <tr className="bg-gray-50">
                          <td colSpan={3} className="py-2 px-3 text-right text-gray-600">Provisional Sums</td>
                          <td className="py-2 px-3 text-right tabular-nums">{formatAED(boqSummary.provisional_sums_aed)}</td>
                          <td />
                        </tr>
                      )}
                      {boqSummary.day_works_aed > 0 && (
                        <tr className="bg-gray-50">
                          <td colSpan={3} className="py-2 px-3 text-right text-gray-600">Day Works</td>
                          <td className="py-2 px-3 text-right tabular-nums">{formatAED(boqSummary.day_works_aed)}</td>
                          <td />
                        </tr>
                      )}
                      <tr className="bg-gray-50">
                        <td colSpan={3} className="py-2 px-3 text-right text-gray-600">Contingency {(boqSummary.contingency_pct * 100).toFixed(0)}%</td>
                        <td className="py-2 px-3 text-right tabular-nums">{formatAED(boqSummary.contingency_aed)}</td>
                        <td />
                      </tr>
                      {boqSummary.discount_aed !== 0 && (
                        <tr className="bg-gray-50">
                          <td colSpan={3} className="py-2 px-3 text-right text-gray-600">Discount</td>
                          <td className="py-2 px-3 text-right tabular-nums">{formatAED(boqSummary.discount_aed)}</td>
                          <td />
                        </tr>
                      )}
                      <tr className="bg-gray-100 border-t border-gray-300">
                        <td colSpan={3} className="py-2.5 px-3 text-right font-semibold text-gray-800">Total Tender Price (excl. VAT)</td>
                        <td className="py-2.5 px-3 text-right tabular-nums font-bold text-gray-900">{formatAED(boqSummary.subtotal_excl_vat_aed)}</td>
                        <td />
                      </tr>
                      <tr className="bg-gray-100">
                        <td colSpan={3} className="py-2 px-3 text-right text-gray-600">VAT {(boqSummary.vat_pct * 100).toFixed(0)}%</td>
                        <td className="py-2 px-3 text-right tabular-nums">{formatAED(boqSummary.vat_aed)}</td>
                        <td />
                      </tr>
                      <tr className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
                        <td colSpan={3} className="py-3 px-3 text-right font-bold text-base">GRAND TOTAL (incl. VAT)</td>
                        <td className="py-3 px-3 text-right tabular-nums font-bold text-base">{formatAED(grand)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <p className="mt-3 text-[10px] text-gray-400 flex items-center gap-1.5">
                  <Info className="h-3 w-3 flex-shrink-0" />
                  Computed from the same line items as the downloadable Power BOQ XLSX. Edit Provisional Sums / Day Works / Discount in the Summary sheet of the workbook.
                </p>
              </CollapsibleSection>
            );
          })()}

          {/* HVAC Formula Derivation Card */}
          {!electricalOnly && (() => {
            const hvacSvc = project.services.find(s => s.service_type === 'hvac' && s.total_aed);
            if (!hvacSvc) return null;
            const ext = hvacSvc.ai_extraction as Record<string, unknown> | null;
            const steps = (ext?.steps || []) as Array<{ step: number; name: string; calculation?: string; output?: string; input?: string; status: string }>;
            const totalKw = (ext?.total_kw || hvacSvc.total_kw || 0) as number;
            const fahuKw = (ext?.fahu_kw || hvacSvc.fahu_kw || 0) as number;
            const acKw = (ext?.ac_kw || hvacSvc.ac_unit_kw || 0) as number;
            const tonnage = (ext?.tonnage_tr || hvacSvc.tonnage || 0) as number;
            const rate = (ext?.rate_aed_per_tr || hvacSvc.unit_rate_aed || 0) as number;
            const acPrice = (ext?.ac_price || 0) as number;
            const fahuPrice = (ext?.fahu_price || 0) as number;
            const totalPrice = (ext?.total_hvac_price || hvacSvc.total_aed || 0) as number;
            const systemType = (ext?.system_type || hvacSvc.system_type || 'unknown') as string;
            const formula = (ext?.formula_used || '') as string;
            const formulaExpression = (ext?.formula_expression || '') as string;
            const systemFormulaMap: Record<string, string> = {
              vrf: 'Formula 1 (VRF)',
              split: 'Formula 2 (DX Split)',
              chiller: 'Formula 3 (Chiller)',
              district_cooling: 'Formula 4 (District Cooling)',
              package: 'Formula (Package)',
            };
            const formulaLabel = formula || systemFormulaMap[systemType] || `Formula (${systemType.toUpperCase()})`;
            const formulaMath = formulaExpression || `${(tonnage ?? 0).toFixed?.(1) ?? tonnage} TR × ${formatAED(rate)}/TR = ${formatAED(acPrice || tonnage * rate)}${fahuPrice > 0 ? ` + FAHU ${formatAED(fahuPrice)}` : ''}`;
            const decCount = (ext?.decorative_count || 0) as number;
            const ducCount = (ext?.ducted_count || 0) as number;
            const predominantly = (ext?.predominantly || '') as string;
            const fahuCount = (ext?.fahu_count || 0) as number;
            const fahuCfm = (ext?.fahu_flow_cfm || 0) as number;

            return (
              <CollapsibleSection
                id="hvac-formula"
                icon={Calculator}
                iconBg="bg-gradient-to-br from-blue-500 to-indigo-600"
                iconColor="text-white"
                title="HVAC Formula Derivation"
                badge={(() => {
                  const hvacSvc = project.services.find(s => s.service_type === 'hvac');
                  return hvacSvc ? <FieldSource projectId={project.id} serviceId={hvacSvc.id} field="total_kw" /> : null;
                })()}
                isOpen={isSectionOpen('hvac-formula')}
                onToggle={() => toggleSection('hvac-formula')}
                summary={`${tonnage.toFixed?.(1) ?? tonnage} TR · ${formatAED(totalPrice)} · ${systemType.toUpperCase()}`}
                gradientBg="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl border border-blue-200 shadow-sm overflow-hidden"
              >
                {/* Formula Chain */}
                <div className="flex flex-wrap items-center gap-2 mb-4">
                  {([
                    { label: 'Total KW', value: `${totalKw} kW`, color: 'bg-blue-100 text-blue-800 border-blue-200', field: 'total_kw' as const },
                    { label: 'FAHU KW', value: `−${fahuKw} kW`, color: 'bg-orange-100 text-orange-800 border-orange-200', field: 'fahu_kw' as const },
                    { label: 'AC Load', value: `${acKw} kW`, color: 'bg-blue-100 text-blue-800 border-blue-200', field: 'ac_unit_kw' as const },
                    { label: '÷ 3.517', value: `${tonnage.toFixed(1)} TR`, color: 'bg-purple-100 text-purple-800 border-purple-200', field: 'tonnage' as const },
                    { label: `× ${formatAED(rate)}/TR`, value: formatAED(acPrice), color: 'bg-green-100 text-green-800 border-green-200', field: 'total_aed' as const },
                  ]).map((item, i) => (
                    <div key={i} className="flex items-center gap-2">
                      {i > 0 && <ArrowRight className="h-3 w-3 text-gray-400" />}
                      <div className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium ${item.color}`}>
                        <div className="text-[9px] font-normal opacity-70">{item.label}</div>
                        <div className="font-bold">{item.value}</div>
                        <div className="mt-0.5">
                          <FieldSource projectId={project.id} serviceId={hvacSvc.id} field={item.field} maxLength={26} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* FAHU add-on */}
                {fahuPrice > 0 && (
                  <div className="flex items-center gap-2 mb-4 pl-2">
                    <span className="text-xs text-gray-500">+ FAHU:</span>
                    <span className="text-xs font-medium text-orange-700 bg-orange-50 px-2 py-1 rounded-lg border border-orange-200">
                      {fahuCount} unit × {fahuCfm.toLocaleString()} CFM × 8.5 AED/CFM = {formatAED(fahuPrice)}
                    </span>
                  </div>
                )}

                {/* Formula used (BT flowchart — one of the 4 pricing formulas) */}
                <div className="mb-4 p-3 bg-gradient-to-r from-indigo-50 to-blue-50 rounded-xl border border-indigo-200">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="px-2 py-0.5 rounded-md bg-indigo-600 text-white text-[10px] font-bold uppercase tracking-wider">Formula Used</div>
                    <span className="text-sm font-bold text-indigo-900">{formulaLabel}</span>
                  </div>
                  <div className="text-xs text-gray-700 font-mono pl-1">{formulaMath}</div>
                </div>

                {/* Total */}
                <div className="flex items-center justify-between p-3 bg-white rounded-xl border border-blue-200 mb-4">
                  <span className="text-sm font-semibold text-gray-700">Total HVAC Estimate</span>
                  <span className="text-lg font-bold text-blue-700 tabular-nums">{formatAED(totalPrice)}</span>
                </div>

                {/* Indoor Unit Classification */}
                {(decCount > 0 || ducCount > 0) && (
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <div className="bg-white rounded-lg border border-gray-200 p-2 text-center">
                      <div className="text-[10px] text-gray-500">Decorative</div>
                      <div className="text-sm font-bold text-gray-900">{decCount}</div>
                    </div>
                    <div className="bg-white rounded-lg border border-gray-200 p-2 text-center">
                      <div className="text-[10px] text-gray-500">Ducted</div>
                      <div className="text-sm font-bold text-gray-900">{ducCount}</div>
                    </div>
                    <div className="bg-white rounded-lg border border-gray-200 p-2 text-center">
                      <div className="text-[10px] text-gray-500">Type</div>
                      <div className="text-xs font-bold text-gray-900 capitalize">{predominantly || 'mixed'}</div>
                    </div>
                  </div>
                )}

                {/* Step-by-step log — visible by default so the HVAC flow
                    (Open Thermal Load → Total KW → FAHU → AC KW → Tonnage →
                    Formula Pricing) is always on screen during the demo. */}
                {steps.length > 0 && (
                  <div className="mt-4 text-xs">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="px-2 py-0.5 rounded-md bg-blue-600 text-white text-[10px] font-bold uppercase tracking-wider">
                        HVAC Procedure
                      </div>
                      <span className="text-[11px] text-gray-500">
                        {steps.length} estimation steps · from thermal load drawing to final price
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {steps.map((s, i) => (
                        <div key={i} className="flex items-start gap-2 bg-white rounded-lg p-2.5 border border-gray-100 hover:border-blue-200 transition-colors">
                          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center flex-shrink-0 shadow-sm">
                            <Check className="h-3.5 w-3.5 text-white" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-gray-900">
                              <span className="text-blue-600 mr-1">Step {s.step}.</span>
                              {s.name}
                            </p>
                            {s.input && <p className="text-gray-500 mt-0.5 text-[11px]"><span className="font-medium">Input:</span> {s.input}</p>}
                            {s.calculation && <p className="text-gray-600 mt-0.5 whitespace-pre-wrap font-mono text-[11px]">{s.calculation}</p>}
                            {s.output && <p className="text-green-700 font-bold mt-0.5 text-[11px]">→ {s.output}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CollapsibleSection>
            );
          })()}

          {/* Electrical 14-Step Cable Schedule Derivation (George Varkey procedure) */}
          {(() => {
            const elecSvc = project.services.find(s => {
              if (s.service_type !== 'electrical') return false;
              const ext = s.ai_extraction as Record<string, unknown> | null;
              return Boolean(ext?.raw_electrical_procedure);
            });
            if (!elecSvc) return null;
            const ext = elecSvc.ai_extraction as Record<string, unknown> | null;
            const rawStored = ext?.raw_electrical_procedure as ElectricalProcedureResult | undefined;
            if (!rawStored) return null;
            // Enrich on read so old bids — extracted before this enrichment
            // landed — display itemized Steps 9-10 / 11-12 / 13 derived from
            // the stored cable_schedule, without needing a re-extraction.
            const raw = enrichElectricalResult(rawStored);
            const pricingPending = !elecSvc.total_aed;

            const drawingsByType = raw.drawings_found.reduce<Record<string, typeof raw.drawings_found>>((acc, d) => {
              (acc[d.type] ||= []).push(d);
              return acc;
            }, {});
            const totalLengthM = raw.cable_schedule.reduce((s, c) => s + (c.length_m || 0), 0);
            const summary = `${raw.smdb_inventory.length} SMDBs · ${raw.db_inventory.length} DBs · ${Math.round(totalLengthM)}m cable${pricingPending ? ' · pricing pending' : ''}`;

            return (
              <CollapsibleSection
                id="electrical-procedure"
                icon={Zap}
                iconBg="bg-gradient-to-br from-amber-500 to-orange-600"
                iconColor="text-white"
                title="Electrical Cable Schedule Derivation"
                badge={pricingPending ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                    extraction only · pricing pending
                  </span>
                ) : (
                  <FieldSource projectId={project.id} serviceId={elecSvc.id} field="total_aed" />
                )}
                isOpen={isSectionOpen('electrical-procedure')}
                onToggle={() => toggleSection('electrical-procedure')}
                summary={summary}
                gradientBg="bg-gradient-to-br from-amber-50 to-orange-50 rounded-2xl border border-amber-200 shadow-sm overflow-hidden"
              >
                {/* Step 1-2: Drawings Found */}
                <div className="mb-4 bg-white rounded-xl border border-amber-100 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="px-1.5 py-0.5 rounded bg-amber-600 text-white text-[9px] font-bold">STEP 1-2</span>
                    <span className="text-xs font-semibold text-gray-800">Drawings Found</span>
                    <span className="text-[10px] text-gray-500">({raw.drawings_found.length} total)</span>
                  </div>
                  {raw.drawings_found.length === 0 ? (
                    <p className="text-[11px] text-gray-400 italic">No electrical drawings identified.</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {Object.entries(drawingsByType).map(([type, list]) => (
                        <div key={type} className="text-[11px]">
                          <div className="text-[9px] uppercase tracking-wide text-gray-500 font-semibold">{type.replace('_', ' ')}</div>
                          <ul className="text-gray-700 space-y-0.5 mt-0.5">
                            {list.map((d, i) => (
                              <li key={i} className="truncate">
                                • {d.filename}
                                {d.floor && <span className="text-gray-400"> — {d.floor}</span>}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Step 3 + 4: Floors / Scale — side by side */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                  <div className="bg-white rounded-xl border border-amber-100 p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="px-1.5 py-0.5 rounded bg-amber-600 text-white text-[9px] font-bold">STEP 3</span>
                      <span className="text-xs font-semibold text-gray-800">Floors & Height</span>
                    </div>
                    <div className="text-sm text-gray-900 font-bold">
                      {raw.floors_identified ?? '?'} floors
                      {raw.typical_floor_height_m && (
                        <span className="text-gray-600 font-normal"> · {raw.typical_floor_height_m}m typical</span>
                      )}
                    </div>
                    {raw.floor_labels?.length > 0 && (
                      <div className="text-[10px] text-gray-500 mt-1 truncate">{raw.floor_labels.join(', ')}</div>
                    )}
                  </div>

                  <div className="bg-white rounded-xl border border-amber-100 p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="px-1.5 py-0.5 rounded bg-amber-600 text-white text-[9px] font-bold">STEP 4</span>
                      <span className="text-xs font-semibold text-gray-800">Drawing Scale</span>
                    </div>
                    {raw.scale_detected ? (
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-green-100 text-green-800 text-[11px] font-bold border border-green-200">
                          {raw.drawing_scale || 'detected'}
                        </span>
                        <span className="text-[10px] text-gray-500">detected from drawing</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-yellow-100 text-yellow-800 text-[11px] font-bold border border-yellow-200">
                          scale unclear
                        </span>
                        <span className="text-[10px] text-gray-500">needs human confirmation</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Step 5: MDB / LV Room */}
                <div className="mb-4 bg-white rounded-xl border border-amber-100 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="px-1.5 py-0.5 rounded bg-amber-600 text-white text-[9px] font-bold">STEP 5</span>
                    <span className="text-xs font-semibold text-gray-800">MDB (Main Distribution Board / LV Room)</span>
                  </div>
                  {raw.mdb_info.tag || raw.mdb_info.rating_a || raw.mdb_info.floor || raw.mdb_info.location ? (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div>
                        <div className="text-[9px] text-gray-500 uppercase">Tag</div>
                        <div className="text-sm font-bold text-gray-900">{raw.mdb_info.tag || '—'}</div>
                      </div>
                      <div>
                        <div className="text-[9px] text-gray-500 uppercase">Rating</div>
                        <div className="text-sm font-bold text-gray-900">{raw.mdb_info.rating_a ? `${raw.mdb_info.rating_a} A` : '—'}</div>
                      </div>
                      <div>
                        <div className="text-[9px] text-gray-500 uppercase">Floor</div>
                        <div className="text-sm font-bold text-gray-900">{raw.mdb_info.floor || '—'}</div>
                      </div>
                      <div>
                        <div className="text-[9px] text-gray-500 uppercase">Location</div>
                        <div className="text-sm font-bold text-gray-900 truncate">{raw.mdb_info.location || '—'}</div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[11px] text-gray-400 italic">MDB not identified.</p>
                  )}
                </div>

                {/* Step 6: Schematic Availability */}
                {(() => {
                  const schematicSheets = raw.drawings_found.filter(d => d.type === 'schematic');
                  const hasSchematic = raw.schematic_available || schematicSheets.length > 0;
                  const fileLabel = raw.schematic_filename
                    || (schematicSheets.length > 0
                      ? schematicSheets.map(s => s.filename).join(' / ')
                      : null);
                  return (
                    <div className="mb-4 bg-white rounded-xl border border-amber-100 p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="px-1.5 py-0.5 rounded bg-amber-600 text-white text-[9px] font-bold">STEP 6</span>
                        <span className="text-xs font-semibold text-gray-800">Schematic Drawing</span>
                      </div>
                      {hasSchematic ? (
                        <div className="flex items-center gap-2">
                          <Check className="h-3.5 w-3.5 text-green-600" />
                          <span className="text-[11px] text-gray-700">Available</span>
                          {fileLabel && (
                            <span className="text-[11px] text-gray-500 truncate">— {fileLabel}</span>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <XCircle className="h-3.5 w-3.5 text-red-500" />
                          <span className="text-[11px] text-red-700">Not found — cable sizes cannot be confirmed</span>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Step 7-8: SMDB Inventory */}
                {raw.smdb_inventory.length > 0 && (
                  <div className="mb-4 bg-white rounded-xl border border-amber-100 p-3 overflow-x-auto">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="px-1.5 py-0.5 rounded bg-amber-600 text-white text-[9px] font-bold">STEP 7-8</span>
                      <span className="text-xs font-semibold text-gray-800">SMDB Inventory</span>
                      <span className="text-[10px] text-gray-500">({raw.smdb_inventory.length} boards)</span>
                    </div>
                    <table className="w-full text-[11px]">
                      <thead className="bg-gray-50">
                        <tr className="text-left text-gray-600">
                          <th className="py-1.5 px-2 font-semibold">SMDB ID</th>
                          <th className="py-1.5 px-2 font-semibold">Floor</th>
                          <th className="py-1.5 px-2 font-semibold text-right">Rating (A)</th>
                          <th className="py-1.5 px-2 font-semibold">Cable from MDB</th>
                        </tr>
                      </thead>
                      <tbody>
                        {raw.smdb_inventory.map((s, i) => (
                          <tr key={i} className="border-t border-gray-100">
                            <td className="py-1.5 px-2 font-mono font-semibold">{s.id}</td>
                            <td className="py-1.5 px-2">{s.floor}</td>
                            <td className="py-1.5 px-2 text-right tabular-nums">{s.rating_a ?? '—'}</td>
                            <td className="py-1.5 px-2 text-gray-700">{s.cable_size_from_mdb ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Step 9-10: LV → SMDB Cable Manifest */}
                {raw.lv_to_smdb_cables.length > 0 && (
                  <div className="mb-4 bg-white rounded-xl border border-amber-100 p-3 overflow-x-auto">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="px-1.5 py-0.5 rounded bg-amber-600 text-white text-[9px] font-bold">STEP 9-10</span>
                      <span className="text-xs font-semibold text-gray-800">LV → SMDB Cable Lengths</span>
                    </div>
                    <table className="w-full text-[11px]">
                      <thead className="bg-gray-50">
                        <tr className="text-left text-gray-600">
                          <th className="py-1.5 px-2 font-semibold">From</th>
                          <th className="py-1.5 px-2 font-semibold">To</th>
                          <th className="py-1.5 px-2 font-semibold text-right">Size (mm²)</th>
                          <th className="py-1.5 px-2 font-semibold text-right">Length (m)</th>
                          <th className="py-1.5 px-2 font-semibold">Route</th>
                        </tr>
                      </thead>
                      <tbody>
                        {raw.lv_to_smdb_cables.map((c, i) => (
                          <tr key={i} className="border-t border-gray-100">
                            <td className="py-1.5 px-2 font-mono">{c.from}</td>
                            <td className="py-1.5 px-2 font-mono">{c.to}</td>
                            <td className="py-1.5 px-2 text-right tabular-nums">{c.size_mm2 ?? '—'}</td>
                            <td className="py-1.5 px-2 text-right tabular-nums">{c.length_m ?? '—'}</td>
                            <td className="py-1.5 px-2 text-gray-600 truncate">{c.route_via ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Step 11-12: DB Inventory */}
                {raw.db_inventory.length > 0 && (
                  <div className="mb-4 bg-white rounded-xl border border-amber-100 p-3 overflow-x-auto">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="px-1.5 py-0.5 rounded bg-amber-600 text-white text-[9px] font-bold">STEP 11-12</span>
                      <span className="text-xs font-semibold text-gray-800">DB Inventory (per SMDB)</span>
                      <span className="text-[10px] text-gray-500">({raw.db_inventory.length} boards)</span>
                    </div>
                    <table className="w-full text-[11px]">
                      <thead className="bg-gray-50">
                        <tr className="text-left text-gray-600">
                          <th className="py-1.5 px-2 font-semibold">Parent SMDB</th>
                          <th className="py-1.5 px-2 font-semibold">DB ID</th>
                          <th className="py-1.5 px-2 font-semibold">Floor</th>
                          <th className="py-1.5 px-2 font-semibold text-right">Rating (A)</th>
                          <th className="py-1.5 px-2 font-semibold">Cable Size</th>
                        </tr>
                      </thead>
                      <tbody>
                        {raw.db_inventory.map((d, i) => (
                          <tr key={i} className="border-t border-gray-100">
                            <td className="py-1.5 px-2 font-mono text-gray-600">{d.smdb_id}</td>
                            <td className="py-1.5 px-2 font-mono font-semibold">{d.db_id}</td>
                            <td className="py-1.5 px-2">{d.floor}</td>
                            <td className="py-1.5 px-2 text-right tabular-nums">{d.rating_a ?? '—'}</td>
                            <td className="py-1.5 px-2 text-gray-700">{d.cable_size ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Step 13: SMDB → DB Cables */}
                {raw.smdb_to_db_cables.length > 0 && (
                  <div className="mb-4 bg-white rounded-xl border border-amber-100 p-3 overflow-x-auto">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="px-1.5 py-0.5 rounded bg-amber-600 text-white text-[9px] font-bold">STEP 13</span>
                      <span className="text-xs font-semibold text-gray-800">SMDB → DB Cable Lengths</span>
                    </div>
                    <table className="w-full text-[11px]">
                      <thead className="bg-gray-50">
                        <tr className="text-left text-gray-600">
                          <th className="py-1.5 px-2 font-semibold">From</th>
                          <th className="py-1.5 px-2 font-semibold">To</th>
                          <th className="py-1.5 px-2 font-semibold text-right">Size (mm²)</th>
                          <th className="py-1.5 px-2 font-semibold text-right">Length (m)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {raw.smdb_to_db_cables.map((c, i) => (
                          <tr key={i} className="border-t border-gray-100">
                            <td className="py-1.5 px-2 font-mono">{c.from}</td>
                            <td className="py-1.5 px-2 font-mono">{c.to}</td>
                            <td className="py-1.5 px-2 text-right tabular-nums">{c.size_mm2 ?? '—'}</td>
                            <td className="py-1.5 px-2 text-right tabular-nums">{c.length_m ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Step 14: Final Cable Schedule */}
                {raw.cable_schedule.length > 0 && (
                  <div className="mb-4 bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl border-2 border-amber-300 p-3 overflow-x-auto">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="px-1.5 py-0.5 rounded bg-orange-700 text-white text-[9px] font-bold">STEP 14</span>
                      <span className="text-xs font-bold text-gray-900">Final Cable Schedule</span>
                      <span className="text-[10px] text-gray-600">({raw.cable_schedule.length} runs · {Math.round(totalLengthM)}m total)</span>
                    </div>
                    <table className="w-full text-[11px]">
                      <thead className="bg-white/60">
                        <tr className="text-left text-gray-700">
                          <th className="py-1.5 px-2 font-semibold">From</th>
                          <th className="py-1.5 px-2 font-semibold">To</th>
                          <th className="py-1.5 px-2 font-semibold text-right">Size (mm²)</th>
                          <th className="py-1.5 px-2 font-semibold text-right">Length (m)</th>
                          <th className="py-1.5 px-2 font-semibold">Type</th>
                          <th className="py-1.5 px-2 font-semibold">Circuit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {raw.cable_schedule.map((c, i) => (
                          <tr key={i} className="border-t border-amber-200/50">
                            <td className="py-1.5 px-2 font-mono">{c.from}</td>
                            <td className="py-1.5 px-2 font-mono">{c.to}</td>
                            <td className="py-1.5 px-2 text-right tabular-nums font-semibold">{c.size_mm2}</td>
                            <td className="py-1.5 px-2 text-right tabular-nums font-semibold">{c.length_m}</td>
                            <td className="py-1.5 px-2 text-gray-700">{c.type}</td>
                            <td className="py-1.5 px-2 text-gray-600 truncate">{c.circuit_description ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Step-by-step log — the 14 procedure steps as audit trail */}
                {raw.step_log?.length > 0 && (
                  <div className="mt-4 text-xs">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="px-2 py-0.5 rounded-md bg-amber-600 text-white text-[10px] font-bold uppercase tracking-wider">
                        Electrical Procedure
                      </div>
                      <span className="text-[11px] text-gray-500">
                        {raw.step_log.length} estimation steps · from LV panel to final cable schedule
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {raw.step_log.map((s, i) => {
                        const statusIconBg =
                          s.status === 'done'
                            ? 'from-green-400 to-emerald-500'
                            : s.status === 'not_found'
                            ? 'from-red-400 to-rose-500'
                            : 'from-gray-300 to-gray-400';
                        return (
                          <div key={i} className="flex items-start gap-2 bg-white rounded-lg p-2.5 border border-gray-100 hover:border-amber-200 transition-colors">
                            <div className={`w-6 h-6 rounded-full bg-gradient-to-br ${statusIconBg} flex items-center justify-center flex-shrink-0 shadow-sm`}>
                              <Check className="h-3.5 w-3.5 text-white" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-gray-900">
                                <span className="text-amber-700 mr-1">Step {s.step_num}.</span>
                                {s.name}
                              </p>
                              {s.finding && (
                                <p className="text-gray-600 mt-0.5 text-[11px]">{s.finding}</p>
                              )}
                            </div>
                            <span className="text-[9px] uppercase tracking-wide font-semibold text-gray-400">{s.status.replace('_', ' ')}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </CollapsibleSection>
            );
          })()}

          {/* Water Supply Components — plumbing breakdown */}
          {!electricalOnly && (() => {
            const plumbingSvc = project.services.find(s => s.service_type === 'plumbing');
            const ws = (plumbingSvc?.ai_extraction as any)?.water_supply;
            if (!ws) return null;
            const fixtures = ws.fixtures as Record<string, number | null> | undefined;
            const pipes = (ws.pipes || []) as Array<{ size_mm: number; material: string | null; length_meters: number | null; purpose: string }>;
            const components = [
              ws.underground_tank?.exists && { label: 'Underground Tank', value: `${ws.underground_tank.capacity_liters?.toLocaleString() || '?'} L`, sub: ws.underground_tank.material },
              ws.roof_tank?.exists && { label: 'Roof Tank', value: `${ws.roof_tank.capacity_liters?.toLocaleString() || '?'} L`, sub: ws.roof_tank.material },
              ws.transfer_pump?.exists && { label: 'Transfer Pump', value: `${ws.transfer_pump.kw || '?'} kW`, sub: `×${ws.transfer_pump.count}` },
              ws.booster_pump?.exists && { label: 'Booster Pump', value: `${ws.booster_pump.kw || '?'} kW`, sub: `×${ws.booster_pump.count}` },
              ws.hot_water_heater?.exists && { label: 'Water Heater', value: `${ws.hot_water_heater.capacity_liters?.toLocaleString() || '?'} L`, sub: `${ws.hot_water_heater.type || ''} ×${ws.hot_water_heater.count}` },
              ws.water_meters?.count && { label: 'Water Meters', value: `×${ws.water_meters.count}`, sub: ws.water_meters.size_mm ? `${ws.water_meters.size_mm}mm` : null },
            ].filter(Boolean) as Array<{ label: string; value: string; sub: string | null }>;
            const fixtureEntries = fixtures ? Object.entries(fixtures).filter(([, v]) => v && v > 0) : [];

            return (
              <CollapsibleSection
                id="water-supply"
                icon={Wrench}
                iconBg="bg-cyan-50"
                iconColor="text-cyan-600"
                title="Water Supply Components"
                badge={<span className="text-[10px] bg-cyan-100 text-cyan-700 px-2 py-0.5 rounded-full font-semibold">{components.length + fixtureEntries.length} items</span>}
                isOpen={isSectionOpen('water-supply')}
                onToggle={() => toggleSection('water-supply')}
                summary={`${components.length} systems · ${fixtureEntries.length} fixture types`}
              >
                {/* Equipment grid */}
                {components.length > 0 && (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-4">
                    {components.map((c, i) => (
                      <div key={i} className="bg-cyan-50/50 rounded-lg p-3 border border-cyan-100">
                        <p className="text-[10px] text-gray-500 mb-0.5">{c.label}</p>
                        <p className="text-sm font-bold text-gray-900">{c.value}</p>
                        {c.sub && <p className="text-[10px] text-gray-400">{c.sub}</p>}
                      </div>
                    ))}
                  </div>
                )}

                {/* Fixtures table */}
                {fixtureEntries.length > 0 && (
                  <div className="mb-4">
                    <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Fixtures</p>
                    <div className="flex flex-wrap gap-2">
                      {fixtureEntries.map(([name, qty]) => (
                        <div key={name} className="flex items-center gap-1.5 bg-gray-50 rounded-lg px-3 py-1.5 border border-gray-100">
                          <span className="text-xs text-gray-600 capitalize">{name.replace(/_/g, ' ')}</span>
                          <span className="text-xs font-bold text-gray-900 tabular-nums">×{qty}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Pipes table */}
                {pipes.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Piping</p>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-200 text-gray-500">
                          <th className="text-left py-1.5 pr-3">Purpose</th>
                          <th className="text-right py-1.5 pr-3">Size</th>
                          <th className="text-left py-1.5 pr-3">Material</th>
                          <th className="text-right py-1.5">Length</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pipes.map((p, i) => (
                          <tr key={i} className="border-b border-gray-50">
                            <td className="py-1.5 pr-3 capitalize text-gray-700">{p.purpose.replace(/_/g, ' ')}</td>
                            <td className="py-1.5 pr-3 text-right tabular-nums">{p.size_mm}mm</td>
                            <td className="py-1.5 pr-3 text-gray-500">{p.material || '—'}</td>
                            <td className="py-1.5 text-right tabular-nums">{p.length_meters ? `${p.length_meters}m` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

              </CollapsibleSection>
            );
          })()}

          {/* MEP Components by Discipline — fire, BMS, etc. (electrical handled by Cable Schedule section above) */}
          {!electricalOnly && project.services.filter(s => s.service_type !== 'hvac' && s.service_type !== 'plumbing' && (s.ai_extraction as any)?.components).map(svc => {
            const components = ((svc.ai_extraction as any).components || []) as Array<{ category: string; item: string; quantity: number; unit: string; specification: string | null; floor?: string }>;
            if (components.length === 0) return null;
            const grouped: Record<string, typeof components> = {};
            for (const c of components) {
              if (!grouped[c.category]) grouped[c.category] = [];
              grouped[c.category].push(c);
            }
            const svcLabel = SERVICE_LABELS[svc.service_type] || svc.service_type;
            return (
              <CollapsibleSection
                key={svc.id}
                id={`mep-${svc.service_type}`}
                icon={ClipboardList}
                iconBg="bg-amber-50"
                iconColor="text-amber-600"
                title={`${svcLabel} — Components`}
                badge={<span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-semibold">{components.length} items</span>}
                isOpen={isSectionOpen(`mep-${svc.service_type}`)}
                onToggle={() => toggleSection(`mep-${svc.service_type}`)}
                summary={`${components.length} components · ${Object.keys(grouped).length} categories`}
                noPadding
              >
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left py-2 px-3 font-medium text-gray-500">Item</th>
                      <th className="text-right py-2 px-3 font-medium text-gray-500 w-16">Qty</th>
                      <th className="text-center py-2 px-3 font-medium text-gray-500 w-14">Unit</th>
                      <th className="text-left py-2 px-3 font-medium text-gray-500 w-32">Spec</th>
                      <th className="text-left py-2 px-3 font-medium text-gray-500 w-20">Floor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(grouped).map(([cat, items]) => (
                      <React.Fragment key={cat}>
                        <tr className="bg-amber-50/50 border-t border-gray-100">
                          <td colSpan={5} className="py-1.5 px-3 font-bold text-[10px] text-amber-700 uppercase tracking-wide">{cat}</td>
                        </tr>
                        {items.map((item, idx) => (
                          <tr key={idx} className="border-t border-gray-50 hover:bg-gray-50">
                            <td className="py-1.5 px-3 text-gray-800">{item.item}</td>
                            <td className="py-1.5 px-3 text-right tabular-nums font-medium">{item.quantity}</td>
                            <td className="py-1.5 px-3 text-center text-gray-500">{item.unit}</td>
                            <td className="py-1.5 px-3 text-gray-500 truncate max-w-[200px]">{item.specification || '—'}</td>
                            <td className="py-1.5 px-3 text-gray-400">{item.floor || '—'}</td>
                          </tr>
                        ))}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </CollapsibleSection>
            );
          })}

          {/* Component-Level BOQ Table */}
          {!electricalOnly && (() => {
            const hvacSvc = project.services.find(s => s.service_type === 'hvac');
            const ext = hvacSvc?.ai_extraction as Record<string, unknown> | null;
            const lineItems = (ext?.line_items || []) as Array<{
              key: string; description: string; quantity: number; unit: string;
              unit_rate_aed: number; total_aed: number; category: string;
            }>;
            if (lineItems.length === 0) return null;

            // Group by category
            const grouped: Record<string, typeof lineItems> = {};
            for (const item of lineItems) {
              if (!grouped[item.category]) grouped[item.category] = [];
              grouped[item.category].push(item);
            }
            const categories = Object.keys(grouped).sort();
            const grandTotal = lineItems.reduce((s, i) => s + i.total_aed, 0);

            return (
              <CollapsibleSection
                id="component-boq"
                icon={FileSpreadsheet}
                iconBg="bg-gradient-to-br from-indigo-500 to-purple-600"
                iconColor="text-white"
                title="Component-Level BOQ"
                badge={<>
                  <span className="text-[10px] text-gray-500">{lineItems.length} items · {categories.length} categories</span>
                  {hvacSvc && <FieldSource projectId={project.id} serviceId={hvacSvc.id} field="unit_rate_aed" />}
                </>}
                isOpen={isSectionOpen('component-boq')}
                onToggle={() => toggleSection('component-boq')}
                summary={`${lineItems.length} items · ${formatAED(grandTotal)}`}
                noPadding
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="text-left py-2 px-3 font-medium text-gray-500 w-8">#</th>
                        <th className="text-left py-2 px-3 font-medium text-gray-500">Description</th>
                        <th className="text-right py-2 px-3 font-medium text-gray-500 w-20">Qty</th>
                        <th className="text-center py-2 px-3 font-medium text-gray-500 w-16">Unit</th>
                        <th className="text-right py-2 px-3 font-medium text-gray-500 w-28">Rate (AED)</th>
                        <th className="text-right py-2 px-3 font-medium text-gray-500 w-32">Amount (AED)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {categories.map((cat) => {
                        const catItems = grouped[cat];
                        const catTotal = catItems.reduce((s, i) => s + i.total_aed, 0);
                        const catColors: Record<string, string> = {
                          'A': 'bg-blue-50 text-blue-800 border-blue-200',
                          'B': 'bg-indigo-50 text-indigo-800 border-indigo-200',
                          'C': 'bg-cyan-50 text-cyan-800 border-cyan-200',
                          'D': 'bg-orange-50 text-orange-800 border-orange-200',
                          'E': 'bg-amber-50 text-amber-800 border-amber-200',
                          'F': 'bg-purple-50 text-purple-800 border-purple-200',
                          'G': 'bg-teal-50 text-teal-800 border-teal-200',
                          'H': 'bg-red-50 text-red-800 border-red-200',
                          'I': 'bg-emerald-50 text-emerald-800 border-emerald-200',
                          'J': 'bg-yellow-50 text-yellow-800 border-yellow-200',
                          'K': 'bg-gray-100 text-gray-800 border-gray-200',
                          'L': 'bg-slate-50 text-slate-800 border-slate-200',
                          'M': 'bg-green-50 text-green-800 border-green-200',
                        };
                        const color = catColors[cat.charAt(0)] || 'bg-gray-50 text-gray-800 border-gray-200';
                        return (
                          <React.Fragment key={cat}>
                            <tr className={`border-t ${color}`}>
                              <td colSpan={5} className="py-2 px-3 font-bold text-xs uppercase tracking-wide">{cat}</td>
                              <td className="py-2 px-3 text-right font-bold text-xs tabular-nums">{formatAED(catTotal)}</td>
                            </tr>
                            {catItems.map((item, idx) => (
                              <tr key={item.key} className="border-t border-gray-100 hover:bg-gray-50">
                                <td className="py-2 px-3 text-gray-400 text-xs">{idx + 1}</td>
                                <td className="py-2 px-3 text-gray-800">{item.description}</td>
                                <td className="py-2 px-3 text-right tabular-nums font-medium">{item.quantity.toLocaleString()}</td>
                                <td className="py-2 px-3 text-center text-gray-500 text-xs">{item.unit}</td>
                                <td className="py-2 px-3 text-right">
                                  {hvacSvc ? (
                                    <FieldSource projectId={project.id} serviceId={hvacSvc.id} field="unit_rate_aed" block>
                                      <span className="tabular-nums text-gray-600">{item.unit_rate_aed.toLocaleString()}</span>
                                    </FieldSource>
                                  ) : (
                                    <span className="tabular-nums text-gray-600">{item.unit_rate_aed.toLocaleString()}</span>
                                  )}
                                </td>
                                <td className="py-2 px-3 text-right">
                                  {hvacSvc ? (
                                    <FieldSource projectId={project.id} serviceId={hvacSvc.id} field="total_aed" block>
                                      <span className="tabular-nums font-medium">{formatAED(item.total_aed)}</span>
                                    </FieldSource>
                                  ) : (
                                    <span className="tabular-nums font-medium">{formatAED(item.total_aed)}</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-gray-300 bg-gradient-to-r from-indigo-50 to-purple-50">
                        <td colSpan={5} className="py-3 px-3 font-bold text-gray-900">GRAND TOTAL — HVAC</td>
                        <td className="py-3 px-3 text-right font-bold text-lg text-indigo-700 tabular-nums">{formatAED(grandTotal)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <div className="p-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
                  <p className="text-[10px] text-gray-400">
                    Rates: ERP Realsoft internal MEP benchmarks, Dubai/UAE Q1 2025. Quantities derived from thermal load calculation + MEP industry ratios (±15-20%).
                  </p>
                </div>
              </CollapsibleSection>
            );
          })()}

          {/* ---- BT Change 1: Multi-System HVAC Breakdown ---- */}
          {!electricalOnly && (() => {
            const hvacSvc = project.services.find(s => s.service_type === 'hvac');
            const ext = hvacSvc?.ai_extraction as Record<string, unknown> | null;
            const subSystems = (ext?.sub_systems || []) as Array<{
              id: string; label: string; system_code: string; system_type: string;
              zones: string[]; total_kw: number; fahu_kw: number; ac_unit_kw: number;
              tonnage: number; unit_rate_aed: number; ac_price: number; fahu_price: number;
              total_aed: number; indoor_units: { ducted: number; decorative: number };
              fahu_count: number; fahu_cfm: number;
              line_items: Array<{ key: string; description: string; quantity: number; unit: string; unit_rate_aed: number; total_aed: number; category: string }>;
            }>;
            if (subSystems.length === 0) return null;

            const grandTotal = subSystems.reduce((s, ss) => s + ss.total_aed, 0);

            return (
              <CollapsibleSection
                id="multi-hvac"
                icon={Layers}
                iconBg="bg-gradient-to-br from-blue-500 to-cyan-600"
                iconColor="text-white"
                title="Multi-System HVAC Breakdown"
                badge={<>
                  <span className="text-[10px] text-gray-500">{subSystems.length} sub-systems</span>
                  {hvacSvc && <FieldSource projectId={project.id} serviceId={hvacSvc.id} field="system_type" />}
                </>}
                isOpen={isSectionOpen('multi-hvac')}
                onToggle={() => toggleSection('multi-hvac')}
                summary={`${subSystems.length} sub-systems · ${formatAED(grandTotal)}`}
                noPadding
              >
                <div className="divide-y divide-gray-100">
                  {subSystems.map((ss, idx) => {
                    const ssLineTotal = ss.line_items.reduce((s, i) => s + i.total_aed, 0);
                    // Group line items by category
                    const grouped: Record<string, typeof ss.line_items> = {};
                    for (const item of ss.line_items) {
                      if (!grouped[item.category]) grouped[item.category] = [];
                      grouped[item.category].push(item);
                    }
                    const categories = Object.keys(grouped).sort();

                    const sysColors: Record<string, string> = {
                      vrf: 'from-indigo-500 to-blue-600',
                      split: 'from-sky-500 to-blue-600',
                      chiller: 'from-cyan-500 to-teal-600',
                      package: 'from-amber-500 to-orange-600',
                      district_cooling: 'from-purple-500 to-indigo-600',
                    };

                    return (
                      <details key={ss.id} className="group" open={idx === 0}>
                        <summary className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50 transition-colors">
                          <div className="flex items-center gap-3">
                            <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${sysColors[ss.system_code] || 'from-gray-400 to-gray-600'} flex items-center justify-center shadow-sm`}>
                              <span className="text-white font-bold text-xs">{idx + 1}</span>
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-gray-900">{ss.label}</p>
                              <p className="text-[10px] text-gray-500">
                                {ss.tonnage} TR @ {ss.unit_rate_aed.toLocaleString()} AED/TR
                                {ss.indoor_units.ducted > 0 && ` | ${ss.indoor_units.ducted} ducted`}
                                {ss.indoor_units.decorative > 0 && ` | ${ss.indoor_units.decorative} decorative`}
                                {ss.fahu_count > 0 && ` | ${ss.fahu_count} FAHU`}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-bold text-gray-800 tabular-nums">{formatAED(ss.total_aed)}</span>
                            {hvacSvc && <FieldSource projectId={project.id} serviceId={hvacSvc.id} field="total_aed" />}
                            <ChevronDown className="h-4 w-4 text-gray-400 group-open:rotate-180 transition-transform" />
                          </div>
                        </summary>
                        <div className="px-4 pb-4">
                          {/* Formula chain for this sub-system */}
                          <div className="flex flex-wrap items-center gap-1.5 mb-3 p-3 bg-gray-50 rounded-xl">
                            {([
                              { label: 'KW', value: `${ss.ac_unit_kw} kW`, bg: 'bg-blue-100 text-blue-800', field: 'ac_unit_kw' as const },
                              { label: '÷ 3.517', value: `${ss.tonnage} TR`, bg: 'bg-purple-100 text-purple-800', field: 'tonnage' as const },
                              { label: `× ${ss.unit_rate_aed.toLocaleString()}`, value: formatAED(ss.ac_price), bg: 'bg-green-100 text-green-800', field: 'unit_rate_aed' as const },
                            ]).map((item, i) => (
                              <React.Fragment key={i}>
                                {i > 0 && <span className="text-gray-400 text-xs">→</span>}
                                <span className={`text-[10px] px-2 py-1 rounded-md font-medium ${item.bg} inline-flex items-center gap-1`}>
                                  <span>{item.label}: {item.value}</span>
                                  {hvacSvc && <FieldSource projectId={project.id} serviceId={hvacSvc.id} field={item.field} maxLength={20} />}
                                </span>
                              </React.Fragment>
                            ))}
                            {ss.fahu_price > 0 && (
                              <>
                                <span className="text-gray-400 text-xs">+</span>
                                <span className="text-[10px] px-2 py-1 rounded-md font-medium bg-orange-100 text-orange-800 inline-flex items-center gap-1">
                                  <span>FAHU: {formatAED(ss.fahu_price)}</span>
                                  {hvacSvc && <FieldSource projectId={project.id} serviceId={hvacSvc.id} field="fahu_kw" maxLength={20} />}
                                </span>
                              </>
                            )}
                          </div>
                          {/* Zones */}
                          <div className="flex flex-wrap gap-1 mb-3">
                            {ss.zones.map((z, zi) => (
                              <span key={zi} className="text-[10px] px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full">{z}</span>
                            ))}
                          </div>
                          {/* Component line items table */}
                          {ss.line_items.length > 0 && (
                            <details className="mt-2">
                              <summary className="text-xs text-indigo-600 cursor-pointer hover:text-indigo-800 font-medium">
                                View {ss.line_items.length} component items ({categories.length} categories)
                              </summary>
                              <table className="w-full text-xs mt-2">
                                <thead>
                                  <tr className="bg-gray-50 border-b border-gray-200">
                                    <th className="text-left py-1.5 px-2 font-medium text-gray-500">Description</th>
                                    <th className="text-right py-1.5 px-2 font-medium text-gray-500 w-16">Qty</th>
                                    <th className="text-center py-1.5 px-2 font-medium text-gray-500 w-12">Unit</th>
                                    <th className="text-right py-1.5 px-2 font-medium text-gray-500 w-20">Rate</th>
                                    <th className="text-right py-1.5 px-2 font-medium text-gray-500 w-24">Amount</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {categories.map(cat => (
                                    <React.Fragment key={cat}>
                                      <tr className="bg-gray-50">
                                        <td colSpan={4} className="py-1 px-2 font-bold text-[10px] text-gray-600 uppercase">{cat}</td>
                                        <td className="py-1 px-2 text-right font-bold text-[10px] text-gray-600 tabular-nums">
                                          {formatAED(grouped[cat].reduce((s, i) => s + i.total_aed, 0))}
                                        </td>
                                      </tr>
                                      {grouped[cat].map(item => (
                                        <tr key={item.key} className="border-t border-gray-50 hover:bg-gray-50">
                                          <td className="py-1 px-2 text-gray-700">{item.description}</td>
                                          <td className="py-1 px-2 text-right tabular-nums">{item.quantity.toLocaleString()}</td>
                                          <td className="py-1 px-2 text-center text-gray-500">{item.unit}</td>
                                          <td className="py-1 px-2 text-right tabular-nums text-gray-500">{item.unit_rate_aed.toLocaleString()}</td>
                                          <td className="py-1 px-2 text-right tabular-nums font-medium">{formatAED(item.total_aed)}</td>
                                        </tr>
                                      ))}
                                    </React.Fragment>
                                  ))}
                                </tbody>
                                <tfoot>
                                  <tr className="border-t-2 border-gray-300">
                                    <td colSpan={4} className="py-2 px-2 font-bold text-gray-800">Sub-System Total</td>
                                    <td className="py-2 px-2 text-right font-bold tabular-nums">{formatAED(ssLineTotal)}</td>
                                  </tr>
                                </tfoot>
                              </table>
                            </details>
                          )}
                        </div>
                      </details>
                    );
                  })}
                </div>
                <div className="p-3 bg-gradient-to-r from-blue-50 to-cyan-50 border-t border-gray-100 flex items-center justify-between">
                  <p className="text-[10px] text-gray-500">Combined multi-system HVAC estimate</p>
                  <p className="text-sm font-bold text-blue-800 tabular-nums">Grand Total: {formatAED(grandTotal)}</p>
                </div>
              </CollapsibleSection>
            );
          })()}

          {/* ---- BT Change 2: Floor-by-Floor Breakdown ---- */}
          {!electricalOnly && (() => {
            const hvacSvc = project.services.find(s => s.service_type === 'hvac');
            const ext = hvacSvc?.ai_extraction as Record<string, unknown> | null;
            const floors = (ext?.floor_breakdown || []) as Array<{
              floor_label: string; floor_code: string; zone_count: number;
              ducted_count: number; decorative_count: number; total_kw: number;
              system_refs: string[];
            }>;
            if (floors.length === 0) return null;

            const totalKw = floors.reduce((s, f) => s + f.total_kw, 0);
            const totalZones = floors.reduce((s, f) => s + f.zone_count, 0);

            const floorColors: Record<string, string> = {
              B: 'bg-slate-100 text-slate-700',
              G: 'bg-green-50 text-green-700',
              M: 'bg-amber-50 text-amber-700',
              P: 'bg-purple-50 text-purple-700',
              R: 'bg-orange-50 text-orange-700',
              T: 'bg-blue-50 text-blue-700',
            };

            return (
              <CollapsibleSection
                id="floor-breakdown"
                icon={Building2}
                iconBg="bg-gradient-to-br from-teal-500 to-emerald-600"
                iconColor="text-white"
                title="Floor-by-Floor Breakdown"
                badge={(() => {
                  const hvacSvc = project.services.find(s => s.service_type === 'hvac');
                  return hvacSvc ? <FieldSource projectId={project.id} serviceId={hvacSvc.id} field="total_kw" /> : null;
                })()}
                isOpen={isSectionOpen('floor-breakdown')}
                onToggle={() => toggleSection('floor-breakdown')}
                summary={`${floors.length} floors · ${totalZones} zones · ${Math.round(totalKw)} kW`}
                noPadding
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="text-left py-2 px-3 font-medium text-gray-500">Floor</th>
                        <th className="text-center py-2 px-3 font-medium text-gray-500 w-16">Zones</th>
                        <th className="text-center py-2 px-3 font-medium text-gray-500 w-16">Ducted</th>
                        <th className="text-center py-2 px-3 font-medium text-gray-500 w-20">Decorative</th>
                        <th className="text-right py-2 px-3 font-medium text-gray-500 w-24">Load (kW)</th>
                        <th className="text-right py-2 px-3 font-medium text-gray-500 w-16">%</th>
                        <th className="text-left py-2 px-3 font-medium text-gray-500 w-28">System</th>
                      </tr>
                    </thead>
                    <tbody>
                      {floors.map((floor) => {
                        const pct = totalKw > 0 ? Math.round((floor.total_kw / totalKw) * 100) : 0;
                        const firstChar = floor.floor_code.charAt(0);
                        const rowColor = floorColors[firstChar] || 'bg-white text-gray-700';
                        return (
                          <tr key={floor.floor_code} className={`border-t border-gray-100 ${rowColor}`}>
                            <td className="py-2 px-3 font-medium">
                              <span className="inline-flex items-center gap-1.5">
                                <span className="w-6 h-5 rounded text-[10px] font-bold bg-white/60 flex items-center justify-center">{floor.floor_code}</span>
                                {floor.floor_label}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-center tabular-nums">{floor.zone_count}</td>
                            <td className="py-2 px-3 text-center tabular-nums">{floor.ducted_count || '—'}</td>
                            <td className="py-2 px-3 text-center tabular-nums">{floor.decorative_count || '—'}</td>
                            <td className="py-2 px-3 text-right tabular-nums font-medium">{floor.total_kw.toLocaleString()}</td>
                            <td className="py-2 px-3 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <div className="w-12 h-1.5 bg-white/40 rounded-full overflow-hidden">
                                  <div className="h-full bg-current rounded-full" style={{ width: `${Math.min(pct, 100)}%` }} />
                                </div>
                                <span className="text-[10px] tabular-nums">{pct}%</span>
                              </div>
                            </td>
                            <td className="py-2 px-3">
                              <div className="flex flex-wrap gap-0.5">
                                {floor.system_refs.map(ref => (
                                  <span key={ref} className="text-[9px] px-1.5 py-0.5 bg-white/50 rounded font-medium">{ref}</span>
                                ))}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-gray-300 bg-gray-50">
                        <td className="py-2 px-3 font-bold text-gray-900">Total</td>
                        <td className="py-2 px-3 text-center font-bold tabular-nums">{totalZones}</td>
                        <td className="py-2 px-3 text-center font-bold tabular-nums">{floors.reduce((s, f) => s + f.ducted_count, 0)}</td>
                        <td className="py-2 px-3 text-center font-bold tabular-nums">{floors.reduce((s, f) => s + f.decorative_count, 0)}</td>
                        <td className="py-2 px-3 text-right font-bold tabular-nums">{Math.round(totalKw).toLocaleString()}</td>
                        <td className="py-2 px-3 text-right font-bold text-[10px]">100%</td>
                        <td className="py-2 px-3"></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </CollapsibleSection>
            );
          })()}

          {/* ---- BT Change 3: Equipment Schedule ---- */}
          {!electricalOnly && (() => {
            const hvacSvc = project.services.find(s => s.service_type === 'hvac');
            const ext = hvacSvc?.ai_extraction as Record<string, unknown> | null;
            const items = (ext?.equipment_schedule_items || []) as Array<{
              tag: string; description: string; model: string | null;
              capacity_kw: number; capacity_tr: number | null;
              quantity: number; location: string | null;
              type: string;
            }>;
            if (items.length === 0) return null;

            const typeLabels: Record<string, { label: string; color: string }> = {
              outdoor: { label: 'Outdoor Units', color: 'bg-red-50 text-red-800 border-red-200' },
              indoor_ducted: { label: 'Indoor Units (Ducted)', color: 'bg-blue-50 text-blue-800 border-blue-200' },
              indoor_decorative: { label: 'Indoor Units (Decorative)', color: 'bg-indigo-50 text-indigo-800 border-indigo-200' },
              fahu: { label: 'Fresh Air Handling Units', color: 'bg-orange-50 text-orange-800 border-orange-200' },
              ahu: { label: 'Air Handling Units', color: 'bg-amber-50 text-amber-800 border-amber-200' },
              exhaust: { label: 'Exhaust Fans', color: 'bg-gray-50 text-gray-800 border-gray-200' },
              pump: { label: 'Pumps', color: 'bg-teal-50 text-teal-800 border-teal-200' },
              other: { label: 'Other Equipment', color: 'bg-slate-50 text-slate-800 border-slate-200' },
            };

            // Group by type
            const grouped: Record<string, typeof items> = {};
            for (const item of items) {
              const t = item.type || 'other';
              if (!grouped[t]) grouped[t] = [];
              grouped[t].push(item);
            }
            const typeOrder = ['outdoor', 'indoor_ducted', 'indoor_decorative', 'fahu', 'ahu', 'exhaust', 'pump', 'other'];
            const sortedTypes = typeOrder.filter(t => grouped[t]);

            const totalUnits = items.reduce((s, i) => s + i.quantity, 0);
            return (
              <CollapsibleSection
                id="equip-schedule"
                icon={ClipboardList}
                iconBg="bg-gradient-to-br from-rose-500 to-pink-600"
                iconColor="text-white"
                title="Equipment Schedule"
                badge={<>
                  <span className="text-[10px] text-gray-500">{items.length} items</span>
                  {(() => {
                    const hvacSvc = project.services.find(s => s.service_type === 'hvac');
                    return hvacSvc ? <FieldSource projectId={project.id} serviceId={hvacSvc.id} field="system_type" /> : null;
                  })()}
                </>}
                isOpen={isSectionOpen('equip-schedule')}
                onToggle={() => toggleSection('equip-schedule')}
                summary={`${items.length} items · ${totalUnits} total units`}
                noPadding
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="text-left py-2 px-3 font-medium text-gray-500 w-20">Tag</th>
                        <th className="text-left py-2 px-3 font-medium text-gray-500">Description</th>
                        <th className="text-left py-2 px-3 font-medium text-gray-500 w-32">Model</th>
                        <th className="text-right py-2 px-3 font-medium text-gray-500 w-16">kW</th>
                        <th className="text-right py-2 px-3 font-medium text-gray-500 w-14">TR</th>
                        <th className="text-center py-2 px-3 font-medium text-gray-500 w-12">Qty</th>
                        <th className="text-left py-2 px-3 font-medium text-gray-500 w-24">Location</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedTypes.map(type => {
                        const typeInfo = typeLabels[type] || typeLabels.other;
                        const typeItems = grouped[type];
                        return (
                          <React.Fragment key={type}>
                            <tr className={`border-t ${typeInfo.color}`}>
                              <td colSpan={6} className="py-1.5 px-3 font-bold text-[10px] uppercase tracking-wide">{typeInfo.label}</td>
                              <td className="py-1.5 px-3 text-right text-[10px] font-bold tabular-nums">{typeItems.reduce((s, i) => s + i.quantity, 0)} units</td>
                            </tr>
                            {typeItems.map(item => (
                              <tr key={item.tag} className="border-t border-gray-100 hover:bg-gray-50">
                                <td className="py-1.5 px-3 font-mono text-[10px] text-gray-500">{item.tag}</td>
                                <td className="py-1.5 px-3 text-gray-800">{item.description}</td>
                                <td className="py-1.5 px-3 text-gray-500 font-mono text-[10px]">{item.model || '—'}</td>
                                <td className="py-1.5 px-3 text-right tabular-nums">{item.capacity_kw}</td>
                                <td className="py-1.5 px-3 text-right tabular-nums text-gray-500">{item.capacity_tr ?? '—'}</td>
                                <td className="py-1.5 px-3 text-center font-bold tabular-nums">{item.quantity}</td>
                                <td className="py-1.5 px-3 text-gray-500 text-[10px]">{item.location || '—'}</td>
                              </tr>
                            ))}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="p-3 bg-gray-50 border-t border-gray-100">
                  <p className="text-[10px] text-gray-400">Equipment data extracted from thermal load calculation and equipment schedule drawings via AI analysis.</p>
                </div>
              </CollapsibleSection>
            );
          })()}

          {/* Estimation placeholder when no estimation yet */}
        </div>

        {/* Right: Action Panel — sticky, 4 blocks */}
        <div className="lg:col-span-4 space-y-4 lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto pr-1">

          {/* ── Block 1: Approval Gate ───────────────────────────── */}
          {(() => {
            let gate: number | null = null;
            if (project.notes) {
              try { gate = JSON.parse(project.notes).approval_gate || null; } catch { /* not JSON */ }
            }
            return gate ? (
              <ApprovalGateCard
                key={`gate-${gate}-${project.status}`}
                projectId={project.id}
                gate={gate}
                onDecision={fetchProject}
                project={project}
                cardRef={gateCardRef}
              />
            ) : null;
          })()}

          {/* ── Block 2: MAIN Pipeline (4 phases · 5 gates) with electrical sub ─── */}
          {(() => {
            const elecSvc = project.services.find(s => {
              if (s.service_type !== 'electrical') return false;
              const ext = s.ai_extraction as Record<string, unknown> | null;
              return Boolean(ext?.raw_electrical_procedure);
            });
            const ext = elecSvc?.ai_extraction as Record<string, unknown> | null;
            const rawStored = ext?.raw_electrical_procedure as ElectricalProcedureResult | undefined;
            const raw = rawStored ? enrichElectricalResult(rawStored) : undefined;
            const resolved = getCurrentStep(project.status);
            const mainStep = resolved.pipeline === 'main' ? resolved.step : 11;
            const subStep = resolved.pipeline === 'electrical' ? resolved.step : null;
            return (
              <SidebarSection
                id="workflow-flowchart"
                title="Pipeline"
                accentColor="bg-indigo-500"
                badge={<span className="text-[11px] font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">Step {mainStep}/15</span>}
                isOpen={isSectionOpen('workflow-flowchart')}
                onToggle={() => toggleSection('workflow-flowchart')}
              >
                <WorkflowFlowchart
                  mainStep={mainStep}
                  subStep={subStep}
                  projectStatus={project.status}
                  stepLog={raw?.step_log}
                />
              </SidebarSection>
            );
          })()}

          {/* ── Retry Banner (shown inline when action fails) ────── */}
          {/* Retry Banner — shows after failed action */}
          {lastFailedAction && !actionLoading && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-red-800">Action failed</p>
                  <p className="text-xs text-red-600 mt-0.5 truncate">{lastFailedAction.error}</p>
                </div>
                <div className="flex items-center gap-2 ml-3">
                  <button onClick={() => setLastFailedAction(null)}
                    className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg">
                    Dismiss
                  </button>
                  <button onClick={() => runAction(lastFailedAction.action)}
                    className="px-3 py-1.5 text-xs font-medium bg-red-600 text-white rounded-lg hover:bg-red-700">
                    Retry
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Block 3: Action Tools ────────────────────────────── */}
          <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center">
                <Wrench className="h-3.5 w-3.5 text-gray-600" />
              </div>
              <h3 className="text-sm font-semibold text-gray-900">Tools</h3>
            </div>
            <div className="space-y-2">
              {/* Smart Excel button — when an XLSX has already been uploaded
                  to storage (generated_boq_url set), behave as a download
                  link directly. Only run the full /power-boq regeneration
                  flow when no file exists yet. Avoids the regenerate path's
                  "No BOQ generated yet" failure mode when the existing file
                  is what the user actually wants. */}
              {project.estimation?.generated_boq_url ? (
                <a
                  href={`/api/projects/${params.id}/boq`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center justify-center gap-2 px-3 py-3 rounded-xl text-sm font-bold bg-gradient-to-r from-emerald-600 to-green-600 text-white hover:from-emerald-700 hover:to-green-700 shadow-md shadow-emerald-200 transition-all"
                  title="Download the previously generated Dubai industry-standard 13-bill XLSX">
                  <Download className="h-4 w-4" /> Download BOQ (Excel)
                </a>
              ) : (
                <button
                  onClick={async () => {
                    if (detailedElectricalOnly) {
                      const result = await runAction('power-boq');
                      if (result.ok && result.data?.xlsx_generated === true) {
                        window.open(`/api/projects/${params.id}/boq`, '_blank');
                      }
                    } else {
                      runAction('boq');
                    }
                  }}
                  disabled={actionLoading === 'boq' || actionLoading === 'power-boq'}
                  className="w-full flex items-center justify-center gap-2 px-3 py-3 rounded-xl text-sm font-bold bg-gradient-to-r from-emerald-600 to-green-600 text-white hover:from-emerald-700 hover:to-green-700 shadow-md shadow-emerald-200 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                  title={detailedElectricalOnly ? 'Generates the Dubai industry-standard 13-bill XLSX' : 'Runs the Excel BOQ orchestrator'}>
                  {(actionLoading === 'boq' || actionLoading === 'power-boq') ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                      Generating BOQ...
                    </>
                  ) : (
                    <>
                      <FileSpreadsheet className="h-4 w-4" />
                      Generate BOQ (Excel)
                    </>
                  )}
                </button>
              )}
              {/* Download PDF — always visible; route synthesizes from services if no estimation row */}
              <a href={`/api/projects/${params.id}/boq/pdf`}
                className="w-full flex items-center justify-center gap-2 px-3 py-3 rounded-xl text-sm font-bold bg-gradient-to-r from-rose-600 to-red-600 text-white hover:from-rose-700 hover:to-red-700 shadow-md shadow-rose-200 transition-all">
                <Download className="h-4 w-4" /> Download BOQ (PDF)
              </a>
              {/* Print project summary */}
              <button onClick={() => window.print()}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition-colors">
                <FileSpreadsheet className="h-3.5 w-3.5" /> Print / Export PDF
              </button>

              {/* Reopen — if accidentally marked won/lost */}
              {['won', 'lost'].includes(project.status) && (
                <button
                  onClick={async () => {
                    setActionLoading('reopen');
                    await fetch(`/api/projects/${params.id}`, {
                      method: 'PUT', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ status: 'sent' }),
                    });
                    await fetchProject();
                    setActionLoading(null);
                  }}
                  disabled={actionLoading === 'reopen'}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  <RotateCcw className="h-4 w-4" /> Reopen (Revert to Sent)
                </button>
              )}

              {/* Archive */}
              {project.status !== 'archived' && (
                <button
                  onClick={async () => {
                    if (!confirm('Archive this project? It will be hidden from the bid list.')) return;
                    setActionLoading('archive');
                    await fetch(`/api/projects/${params.id}`, {
                      method: 'PUT', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ status: 'archived' }),
                    });
                    await fetchProject();
                    setActionLoading(null);
                    toast('Project archived', 'success');
                  }}
                  disabled={actionLoading === 'archive'}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-medium text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  <Archive className="h-3.5 w-3.5" /> Archive Project
                </button>
              )}
              {/* Merge duplicate */}
              {!showMerge ? (
                <button onClick={() => setShowMerge(true)}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-medium text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors">
                  <Layers className="h-3.5 w-3.5" /> Merge Into...
                </button>
              ) : (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
                  <p className="text-xs font-medium text-amber-800">Merge this project into another:</p>
                  <input type="text" placeholder="Target project ID" value={mergeTargetId}
                    onChange={e => setMergeTargetId(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs border border-amber-200 rounded-lg" />
                  <div className="flex gap-2">
                    <button onClick={() => { setShowMerge(false); setMergeTargetId(''); }}
                      className="flex-1 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                    <button
                      onClick={async () => {
                        if (!mergeTargetId.trim()) return;
                        const res = await fetch('/api/projects/merge', {
                          method: 'POST', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ sourceId: params.id, targetId: mergeTargetId.trim() }),
                        });
                        const data = await res.json();
                        if (res.ok) {
                          toast(data.message || 'Merged successfully', 'success');
                          setShowMerge(false);
                          await fetchProject();
                        } else {
                          toast(data.error || 'Merge failed', 'error');
                        }
                      }}
                      disabled={!mergeTargetId.trim()}
                      className="flex-1 px-2 py-1.5 text-xs font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50">
                      Merge
                    </button>
                  </div>
                </div>
              )}
              {project.status === 'archived' && (
                <button
                  onClick={async () => {
                    setActionLoading('unarchive');
                    await fetch(`/api/projects/${params.id}`, {
                      method: 'PUT', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ status: 'new' }),
                    });
                    await fetchProject();
                    setActionLoading(null);
                    toast('Project unarchived', 'success');
                  }}
                  disabled={actionLoading === 'unarchive'}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
                >
                  <RotateCcw className="h-4 w-4" /> Unarchive Project
                </button>
              )}


              {/* Reply to Client — always available */}
              <button
                onClick={() => { setReplyTemplate(undefined); setReplyOpen(true); }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 hover:shadow-sm transition-all"
              >
                <Reply className="h-4 w-4" />
                Reply to Client
              </button>

              {/* Restart Pipeline — always available */}
              <div className="pt-3 mt-3 border-t border-gray-100">
                <button
                  onClick={async () => {
                    if (!confirm('Restart the full pipeline from step 1? This clears all data and re-runs extraction.')) return;
                    setActionLoading('rescan');
                    try {
                      // Step 1: Clean slate — delete old data, reset project
                      const r1 = await fetch(`/api/projects/${params.id}/restart`, { method: 'POST' });
                      if (!r1.ok) {
                        const d1 = await r1.json().catch(() => ({}));
                        throw new Error(d1.error || 'Restart failed');
                      }

                      // Immediately refresh UI to show clean state
                      await fetchProject();
                      toast('Pipeline reset. Re-extracting...', 'info');

                      // Step 2: Trigger extraction
                      const r2 = await fetch(`/api/projects/${params.id}/extract`, { method: 'POST' });
                      const d2 = await r2.json().catch(() => ({}));
                      if (!r2.ok) throw new Error(d2.error || 'Extraction failed');

                      toast('Pipeline restarted! Extraction complete.', 'success');
                      await fetchProject();
                    } catch (err: any) {
                      toast(`Restart failed: ${err.message || err}`, 'error');
                      await fetchProject();
                    } finally {
                      setActionLoading(null);
                    }
                  }}
                  disabled={!!actionLoading}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-medium bg-gray-50 text-gray-600 hover:text-gray-800 hover:bg-gray-100 border border-gray-200 transition-colors disabled:opacity-30"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  {actionLoading === 'rescan' ? 'Restarting... (~30s)' : 'Restart Pipeline from Step 1'}
                </button>
                <p className="text-[9px] text-gray-400 text-center mt-1">Resets everything, stops at each gate for your approval</p>
              </div>
            </div>
          </div>

          {/* ── Block 4: Activity Log ────────────────────────────── */}
          {project.activity_log.length > 0 && (() => {
            const logs = project.activity_log
              .filter(l => l.status === 'completed' || l.status === 'failed')
              .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
            return (
              <ActivityLogPanel logs={logs} />
            );
          })()}
        </div>
      </div>

      {/* Universal Command Bar — sticky bottom, always shows next action */}
      <CommandBar
        project={project}
        actionLoading={actionLoading}
        elapsedSeconds={elapsedSeconds}
        onRunAction={runAction}
        onGateApprove={async () => {
          try {
            const res = await fetch(`/api/projects/${project.id}/gate`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'approve' }),
            });
            if (!res.ok) {
              const data = await res.json().catch(() => ({}));
              toast(`Approve failed: ${data.error || 'Unknown error'}`, 'error');
              return;
            }
            await fetchProject();
          } catch (err) {
            toast(`Approve failed: ${err instanceof Error ? err.message : 'Network error'}`, 'error');
          }
        }}
        onScrollToGate={() => gateCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
        onWon={async () => {
          setActionLoading('won');
          await fetch(`/api/projects/${params.id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'won' }),
          });
          await fetchProject();
          setActionLoading(null);
        }}
        onLost={async () => {
          setActionLoading('lost');
          await fetch(`/api/projects/${params.id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'lost' }),
          });
          await fetchProject();
          setActionLoading(null);
        }}
      />

      {/* Reply Modal */}
      <ReplyModal
        isOpen={replyOpen}
        onClose={() => setReplyOpen(false)}
        onSent={() => { setReplyOpen(false); fetchProject(); }}
        project={project}
        defaultTemplate={replyTemplate}
      />

      {/* Phase 10: Extraction-hints preview modal */}
      {showHintsModal && extractionHints?.enabled && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60"
          onClick={() => setShowHintsModal(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-900">AI Extraction Prompt — Augmentation</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  These corrections from past projects were prepended to the Sonnet extraction prompt so it could self-correct on its known weak fields.
                </p>
              </div>
              <button onClick={() => setShowHintsModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-5 py-4 overflow-auto flex-1">
              <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono bg-gray-50 rounded-lg p-3 border border-gray-200">
                {extractionHints.snippet}
              </pre>
              <p className="text-[11px] text-gray-500 mt-3">
                Source: <code className="px-1 py-0.5 bg-gray-100 rounded text-[10px]">sabi_corrections</code> rows where field_path starts with <code className="px-1 py-0.5 bg-gray-100 rounded text-[10px]">extraction.</code>, last 90 days. Refreshed hourly. See <code className="px-1 py-0.5 bg-gray-100 rounded text-[10px]">/api/admin/extraction-accuracy</code> for the underlying data.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SidebarSection({
  id, title, badge, isOpen, onToggle, accentColor, children, collapsedContent,
}: {
  id?: string; title: string; badge?: React.ReactNode;
  isOpen: boolean; onToggle: () => void; accentColor?: string;
  children: React.ReactNode; collapsedContent?: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50/50 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2">
          {accentColor && <div className={`w-1 h-4 rounded-full ${accentColor}`} />}
          <span className="text-sm font-semibold text-gray-900">{title}</span>
        </div>
        <div className="flex items-center gap-2">
          {!isOpen && badge}
          <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${isOpen ? '' : '-rotate-90'}`} />
        </div>
      </button>
      {!isOpen && collapsedContent}
      {isOpen && <div className="px-4 pb-4 border-t border-gray-100">{children}</div>}
    </div>
  );
}

function CollapsibleSection({
  icon: Icon, iconBg, iconColor, title, summary, badge, isOpen, onToggle,
  headerRight, gradientBg, noPadding, children, id,
}: {
  id?: string;
  icon: React.ElementType; iconBg: string; iconColor: string; title: string;
  summary?: React.ReactNode; badge?: React.ReactNode;
  isOpen: boolean; onToggle: () => void;
  headerRight?: React.ReactNode; gradientBg?: string; noPadding?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={gradientBg || 'bg-white rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow overflow-hidden'}>
      {/* role=button (not <button>) so headerRight can hold links/buttons — a <button>
          nesting an <a>/<button> is invalid HTML: it swallows the inner click and throws
          a hydration error in dev. */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
        className={`w-full flex items-center justify-between ${noPadding ? 'px-5 py-4' : 'px-6 py-4'} hover:bg-gray-50/50 transition-colors cursor-pointer`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-8 h-8 rounded-lg ${iconBg} flex items-center justify-center flex-shrink-0`}>
            <Icon className={`h-4 w-4 ${iconColor}`} />
          </div>
          <h2 className="text-sm font-semibold text-gray-900 truncate">{title}</h2>
          {badge}
        </div>
        <div className="flex items-center gap-3 flex-shrink-0 ml-2">
          {!isOpen && summary && (
            <span className="text-xs text-gray-400 truncate max-w-[300px] hidden sm:block">{summary}</span>
          )}
          {headerRight}
          {isOpen ? (
            <ChevronDown className="h-4 w-4 text-gray-400" />
          ) : (
            <ChevronRight className="h-4 w-4 text-gray-400" />
          )}
        </div>
      </div>
      {isOpen && (
        <div className={noPadding ? '' : 'px-6 pb-6'}>
          {children}
        </div>
      )}
    </div>
  );
}

function InfoItem({ icon: Icon, label, value, lineageProjectId, lineageField }: { icon: React.ElementType; label: string; value: string; lineageProjectId?: string; lineageField?: string }) {
  const isPlaceholder = value === 'Not extracted' || value === '-';
  return (
    <div className={`rounded-xl p-3 transition-colors ${isPlaceholder ? 'bg-gray-50/50 border border-dashed border-gray-200' : 'bg-gray-50 hover:bg-gray-100/80'}`}>
      <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
        <Icon className={`h-3.5 w-3.5 ${isPlaceholder ? 'text-gray-300' : 'text-gray-400'}`} />
        {label}
      </div>
      {isPlaceholder ? (
        <div className="flex items-center gap-1.5">
          <div className="h-4 w-20 bg-gray-200/60 rounded animate-pulse" />
        </div>
      ) : lineageProjectId && lineageField ? (
        <FieldSource projectId={lineageProjectId} field={lineageField} block>
          <p className="text-sm font-semibold text-gray-900 capitalize">{value}</p>
        </FieldSource>
      ) : (
        <p className="text-sm font-semibold text-gray-900 capitalize">{value}</p>
      )}
    </div>
  );
}

function EditField({ label, value, onChange, type = 'text', options }: {
  label: string; value: any; onChange: (v: string) => void; type?: string; options?: string[];
}) {
  return (
    <div>
      <label className="text-xs text-gray-500 mb-0.5 block">{label}</label>
      {options ? (
        <select value={value} onChange={e => onChange(e.target.value)}
          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none">
          <option value="">Select...</option>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input type={type} value={value} onChange={e => onChange(e.target.value)}
          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none" />
      )}
    </div>
  );
}

function ApprovalGateCard({
  projectId,
  gate,
  onDecision,
  project,
  cardRef,
}: {
  projectId: string;
  gate: number;
  onDecision: () => void;
  project?: ProjectDetail | null;
  cardRef?: React.Ref<HTMLDivElement>;
}) {
  const [loading, setLoading] = useState(false);
  const [reason, setReason] = useState('');
  const [approveNote, setApproveNote] = useState('');
  const [approved, setApproved] = useState(false);
  const { toast } = useToast();
  const [showRejectConfirm, setShowRejectConfirm] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const isBidDecisionGate = gate === 10 || gate === 13;
  // Pipeline-aware lookup: when status puts us inside the electrical SUB
  // pipeline (cable-schedule review), use the SUB GATE_QUESTIONS at step 14;
  // otherwise read MAIN_GATE_QUESTIONS so gates 9/12/14/15 show their proper
  // text from CLAUDE.md instead of falling through to "Decision required".
  const resolvedPipeline = getCurrentStep(project?.status).pipeline;
  const stepDef =
    MAIN_PIPELINE_STEPS.find((s) => s.step === gate) ||
    PIPELINE_STEPS.find((s) => s.step === gate);
  const gateQ =
    resolvedPipeline === 'electrical' && gate === 14
      ? GATE_QUESTIONS[14]
      : MAIN_GATE_QUESTIONS[gate] || GATE_QUESTIONS[gate];
  const gateQuestionText =
    gateQ?.question || stepDef?.description || 'Decision required';
  const gateBinaryYes = gateQ && gateQ.kind === 'binary' ? gateQ.yesLabel : 'Approve';
  const gateBinaryNo = gateQ && gateQ.kind === 'binary' ? gateQ.noLabel : 'Reject';

  // Reset state when gate changes (e.g. gate 11 → 13 after approval)
  useEffect(() => {
    setApproved(false);
    setReason('');
    setApproveNote('');
    setShowRejectConfirm(false);
  }, [gate]);

  // Client email from project
  const clientEmail = project?.email_from || 'client@company.com';
  const clientName = project?.client_name || 'Client';
  const projectName = project?.project_name || project?.email_subject || 'Project';

  const handleDecision = async (action: 'approve' | 'reject') => {
    if (action === 'reject' && !reason.trim()) return;

    // For reject: show confirmation modal first
    if (action === 'reject' && !showRejectConfirm) {
      setShowRejectConfirm(true);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/gate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          reason: action === 'reject' ? reason : (approveNote || undefined),
          ...(isBidDecisionGate && action === 'approve' ? { pricing_mode: 'detailed' } : {}),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Decision failed');
      }
      const data = await res.json().catch(() => ({}));
      if (action === 'approve') {
        if (data.auto_trigger_error) {
          toast(
            gate === 33
              ? `Gate approved, but export step failed: ${data.auto_trigger_error}`
              : `Gate approved, but next pipeline step failed: ${data.auto_trigger_error}`,
            'error'
          );
        } else if (gate === 33) {
          toast('Quotation approved for export', 'success');
        }
        setApproved(true);
        onDecision();
      } else {
        onDecision();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      toast(`Decision failed: ${message}`, 'error');
    } finally {
      setLoading(false);
      setShowRejectConfirm(false);
    }
  };

  // Gate 2 (2-way bid decision) — No-Bid (terminal) or Detailed (full take-off).
  // INSTANT BOQ runs Detailed end-to-end with auto-approved gates from a
  // separate "Run to BOQ" trigger.
  const handleBidDecision = async (decision: 'no_bid' | 'detailed') => {
    if (decision === 'no_bid') {
      const trimmed = reason.trim();
      if (!trimmed) {
        toast('No-Bid requires a reason', 'error');
        return;
      }
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/bid-decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision,
          ...(decision === 'no_bid' ? { reason: reason.trim(), reason_code: 'manual' } : {}),
          decided_by: 'George Varkey M',
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Bid decision failed');
      }
      if (decision === 'no_bid') {
        toast('Project declined (No-Bid) — reason recorded', 'success');
        onDecision();
      } else {
        toast('Detailed proposal — running Phase 3 take-off', 'success');
        setApproved(true);
        onDecision();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      toast(`Bid decision failed: ${message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Success state after approval
  if (approved) {
    return (
      <div ref={cardRef} className="relative rounded-2xl overflow-hidden shadow-lg">
        <div className="absolute inset-0 bg-gradient-to-r from-green-400 via-emerald-400 to-green-400 rounded-2xl" />
        <div className="relative m-[2px] bg-gradient-to-br from-green-50 to-emerald-50 rounded-[14px] p-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center shadow-lg shadow-green-200">
              <CheckCircle className="h-6 w-6 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-green-800">Approved — Advancing Pipeline</h2>
              <p className="text-sm text-green-600">Step {gate} approved. Processing next steps...</p>
            </div>
            <div className="ml-auto animate-spin rounded-full h-5 w-5 border-2 border-green-300 border-t-green-600" />
          </div>
        </div>
      </div>
    );
  }

  // Gate-specific context data (33-step pipeline gates: 11, 13, 24, 29, 33)
  const contextData = (() => {
    if (!project) return null;
    if (gate === 11) {
      const drawings = project.attachments?.filter((a: any) =>
        a.file_type?.startsWith('drawing_')
      ).length || 0;
      const criticalStatus = (project as any).critical_drawings_status as string | null;
      const boqQuality = (project as any).boq_quality as string | null;
      const scaleDetection = (project as any).scale_detection as
        | {
            detected_px_per_m: number | null;
            confidence: number | null;
            source:
              | 'dimension_arrow'
              | 'scale_bar'
              | 'grid'
              | 'area_cross_check'
              | 'manual'
              | null;
          }
        | null;
      const SCALE_METHOD_LABEL: Record<string, string> = {
        dimension_arrow: 'dimension arrows',
        scale_bar: 'scale bar',
        grid: 'grid',
        area_cross_check: 'area est.',
        manual: 'manual entry',
      };
      const scaleMethodLabel = scaleDetection?.source
        ? SCALE_METHOD_LABEL[scaleDetection.source] ?? scaleDetection.source
        : null;
      return (
        <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
          {[
            { label: 'Drawings', value: drawings > 0 ? `${drawings}` : '-' },
            { label: 'Critical', value: criticalStatus ? criticalStatus.replace('_', ' ') : '-' },
            { label: 'Client BOQ', value: boqQuality || '-' },
          ].map(d => (
            <div key={d.label} className="bg-white/70 rounded-lg px-3 py-2 border border-amber-100">
              <p className="text-[10px] text-gray-500 uppercase">{d.label}</p>
              <p className="text-sm font-bold text-gray-800 capitalize">{d.value}</p>
            </div>
          ))}
          <div className="bg-white/70 rounded-lg px-3 py-2 border border-amber-100">
            <div className="flex items-center justify-between gap-1">
              <p className="text-[10px] text-gray-500 uppercase">Scale</p>
            </div>
            <p className="text-sm font-bold text-gray-800">
              {scaleDetection?.detected_px_per_m
                ? `${scaleDetection.detected_px_per_m.toFixed(1)} px/m`
                : '-'}
            </p>
            {scaleMethodLabel && (
              <p className="text-[10px] text-gray-500 mt-0.5 truncate">via {scaleMethodLabel}</p>
            )}
          </div>
        </div>
      );
    }
    if (isBidDecisionGate) {
      const reputationKey = (project.reputation_class || 'unknown') as keyof typeof REPUTATION_META;
      const rep = REPUTATION_META[reputationKey] || REPUTATION_META.unknown;
      return (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`px-2 py-1 rounded-md text-[10px] font-bold ${rep.color} ${rep.bgColor} border border-current/20`}>
              {rep.label}
            </span>
            {project.services.length > 0 ? project.services.map(s => (
              <span key={s.id} className="px-3 py-1.5 bg-white/70 rounded-lg border border-amber-100 text-xs font-medium text-gray-700">
                {SERVICE_LABELS[s.service_type] || s.service_type}
              </span>
            )) : <span className="text-xs text-gray-500">No services identified yet</span>}
          </div>
          <p className="text-[11px] text-gray-600 leading-relaxed">
            Choose <strong>Detailed Proposal</strong> to run full drawing-based extraction (Phase 3),
            <strong> Quick Estimate</strong> for rate × sqft (HVAC cross-checked at 4200 AED/TR; lands at Confirm Total),
            or <strong>No-Bid</strong> with a recorded reason.
          </p>
        </div>
      );
    }
    if (gate === 24) {
      const hvac = project.services.find(s => s.service_type === 'hvac');
      if (!hvac) return null;
      return (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {[
            { label: 'System', value: hvac.system_type || '-' },
            { label: 'Tonnage', value: hvac.tonnage ? `${hvac.tonnage} TR` : '-' },
            { label: 'Total', value: hvac.total_aed ? formatAED(hvac.total_aed) : '-' },
          ].map(d => (
            <div key={d.label} className="bg-white/70 rounded-lg px-3 py-2 border border-amber-100">
              <p className="text-[10px] text-gray-500 uppercase">{d.label}</p>
              <p className="text-sm font-bold text-gray-800">{d.value}</p>
            </div>
          ))}
        </div>
      );
    }
    if (gate === 29 && project.estimation) {
      return (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {[
            { label: 'Total Bid', value: formatAED(project.estimation.total_aed) },
            { label: 'With Margin', value: formatAED(project.estimation.final_quote_aed) },
            { label: 'Yardstick', value: project.estimation.yardstick_status?.replace('_', ' ') || 'pending' },
          ].map(d => (
            <div key={d.label} className="bg-white/70 rounded-lg px-3 py-2 border border-amber-100">
              <p className="text-[10px] text-gray-500 uppercase">{d.label}</p>
              <p className="text-sm font-bold text-gray-800 capitalize">{d.value}</p>
            </div>
          ))}
        </div>
      );
    }
    if (gate === 33) {
      return (
        <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
          {[
            { label: 'To', value: project.email_from || '-' },
            { label: 'Subject', value: `Re: ${project.email_subject || '-'}` },
            { label: 'Quote', value: project.estimation?.final_quote_aed ? formatAED(project.estimation.final_quote_aed) : '-' },
            { label: 'BOQ', value: project.estimation?.generated_boq_url ? 'Attached' : 'Not generated' },
          ].map(d => (
            <div key={d.label} className="bg-white/70 rounded-lg px-3 py-2 border border-amber-100">
              <p className="text-[10px] text-gray-500 uppercase">{d.label}</p>
              <p className="text-sm font-bold text-gray-800 truncate">{d.value}</p>
            </div>
          ))}
        </div>
      );
    }
    return null;
  })();

  return (
    <div ref={cardRef} className="relative rounded-xl overflow-hidden shadow-md hover:shadow-lg hover:shadow-amber-200/30 transition-all duration-300 cursor-default">
      {/* Holographic animated border */}
      <div className="absolute inset-0 rounded-xl animate-gradient-shift" style={{ background: 'linear-gradient(135deg, #f59e0b, #f97316, #fbbf24, #ffffff, #f59e0b, #ef4444, #f59e0b, #f97316)', backgroundSize: '400% 400%' }} />
      <div className="relative m-[2px] bg-gradient-to-br from-amber-50 via-white to-orange-50 rounded-[10px] px-4 py-3 overflow-hidden">
        {/* Shimmer overlay */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute inset-0 opacity-[0.08] animate-shimmer-sweep" style={{ background: 'linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.8) 45%, rgba(255,255,255,0.9) 50%, rgba(255,255,255,0.8) 55%, transparent 60%)' }} />
        </div>
        <div className="relative">
          {/* Header row */}
          <div className="flex items-center gap-3 mb-2">
            <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-sm animate-pulse">
              <ShieldAlert className="h-4 w-4 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-bold uppercase tracking-wider text-amber-600 bg-amber-200/60 px-1.5 py-0.5 rounded-full">Step {gate}/{MAIN_PIPELINE_STEPS.length}</span>
                <h2 className="text-sm font-bold text-gray-900 truncate">{stepDef?.name || `Step ${gate}`}</h2>
              </div>
              <p className="text-xs text-gray-600 truncate mt-0.5">{gateQuestionText}</p>
            </div>
          </div>

          {/* Contextual data for this gate */}
          {contextData}

          {/* Decision row — Gates 10 & 13 (Bid Decision) are 3-way; all others are binary. */}
          {isBidDecisionGate ? (
            <div className="space-y-2 mt-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleBidDecision('detailed')}
                  disabled={loading}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-xl font-bold text-sm hover:from-green-700 hover:to-emerald-700 hover:shadow-lg hover:shadow-green-300/50 transition-all duration-200 shadow-md shadow-green-200/50 disabled:opacity-50 active:scale-[0.98]"
                  title="Run full drawing-based extraction and estimation through Phase 3 (pauses at Gate 24)."
                >
                  {loading ? (
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                  ) : (
                    <CheckCircle className="h-4 w-4" />
                  )}
                  Detailed Proposal
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="No-Bid reason (required, logged to sabi_no_bid_log)..."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="flex-1 px-2.5 py-2 text-xs border border-red-200 rounded-lg bg-white/80 focus:ring-1 focus:ring-red-200 focus:outline-none placeholder:text-gray-400"
                />
                <button
                  onClick={() => handleBidDecision('no_bid')}
                  disabled={loading || !reason.trim()}
                  className="flex items-center gap-1.5 px-3 py-2 bg-white text-red-600 border border-red-200 rounded-lg font-medium text-xs hover:bg-red-50 hover:border-red-400 transition-all duration-200 disabled:opacity-30"
                >
                  <XCircle className="h-3.5 w-3.5" />
                  No-Bid
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={() => handleDecision('approve')}
                disabled={loading}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-xl font-bold text-sm hover:from-green-700 hover:to-emerald-700 hover:shadow-lg hover:shadow-green-300/50 transition-all duration-200 shadow-md shadow-green-200/50 disabled:opacity-50 active:scale-[0.98]"
              >
                {loading && !showRejectConfirm ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                ) : (
                  <CheckCircle className="h-4 w-4" />
                )}
                {gateBinaryYes}
              </button>
              <input
                type="text"
                placeholder="Reject reason..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-36 px-2.5 py-2 text-xs border border-red-200 rounded-lg bg-white/80 focus:ring-1 focus:ring-red-200 focus:outline-none placeholder:text-gray-400"
              />
              <button
                onClick={() => handleDecision('reject')}
                disabled={loading || !reason.trim()}
                className="flex items-center gap-1.5 px-3 py-2 bg-white text-red-600 border border-red-200 rounded-lg font-medium text-xs hover:bg-red-50 hover:border-red-400 transition-all duration-200 disabled:opacity-30"
              >
                <XCircle className="h-3.5 w-3.5" />
                {gateBinaryNo}
              </button>
            </div>
          )}

            {/* ---- Rejection Confirmation Modal ---- */}
            {showRejectConfirm && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full mx-4 overflow-hidden border border-red-100">
                  {/* Modal Header */}
                  <div className="p-5 bg-gradient-to-r from-red-50 to-orange-50 border-b border-red-100">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center shadow-md">
                        <Mail className="h-5 w-5 text-white" />
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-gray-900">Confirm Rejection</h3>
                        <p className="text-xs text-gray-500">This will reject the bid and optionally notify the company</p>
                      </div>
                    </div>
                  </div>

                  {/* Rejection Details */}
                  <div className="p-5 space-y-4">
                    <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                      <p className="text-xs font-medium text-red-600 uppercase tracking-wide mb-1">Rejection Reason</p>
                      <p className="text-sm text-gray-800 font-medium">{reason}</p>
                    </div>

                    {/* Email Preview */}
                    <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Email Preview (to {clientEmail})</p>
                      <div className="text-sm text-gray-700 space-y-2">
                        <p><strong>Subject:</strong> RE: {projectName} — Quotation Update</p>
                        <div className="border-t border-gray-200 pt-2 text-xs text-gray-600 leading-relaxed">
                          <p>Dear {clientName},</p>
                          <p className="mt-2">Thank you for your enquiry regarding <strong>{projectName}</strong>.</p>
                          <p className="mt-2">After careful review at Step {gate} ({stepDef?.name || ''}), we regret to inform you that we are unable to proceed with this quotation at this time.</p>
                          <p className="mt-1"><strong>Reason:</strong> {reason}</p>
                          <p className="mt-2">Should you wish to discuss further or resubmit with modifications, please do not hesitate to contact us.</p>
                          <p className="mt-2">Best regards,<br />ERP Realsoft Estimation Team<br />info@realsoft.example</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Modal Actions */}
                  <div className="p-5 bg-gray-50 border-t border-gray-200 flex items-center justify-between gap-3">
                    <button
                      onClick={() => setShowRejectConfirm(false)}
                      className="px-4 py-2.5 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors"
                    >
                      Cancel
                    </button>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleDecision('reject')}
                        disabled={loading}
                        className="flex items-center gap-2 px-4 py-2.5 bg-white text-red-600 border border-red-200 rounded-xl font-medium text-sm hover:bg-red-50 transition-colors disabled:opacity-50"
                      >
                        {loading && !sendingEmail ? (
                          <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-red-400 border-t-transparent" />
                        ) : (
                          <ThumbsDown className="h-3.5 w-3.5" />
                        )}
                        Reject Only
                      </button>
                    </div>
                  </div>

                </div>
              </div>
            )}
        </div>
      </div>
    </div>
  );
}

function RevertDecisionCard({
  projectId,
  gate,
  stepName,
  reason,
  rejectedAt,
  onRevert,
}: {
  projectId: string;
  gate: number;
  stepName: string;
  reason?: string;
  rejectedAt?: string;
  onRevert: () => void;
}) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const handleRevert = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/gate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'revert' }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Revert failed');
      }
      onRevert();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      toast(`Revert failed: ${message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative rounded-2xl overflow-hidden shadow-lg">
      <div className="absolute inset-0 bg-gradient-to-r from-red-400 via-rose-400 to-red-400 rounded-2xl" />
      <div className="relative m-[2px] bg-gradient-to-br from-red-50 to-rose-50 rounded-[14px] p-6">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 w-12 h-12 rounded-2xl bg-gradient-to-br from-red-400 to-rose-500 flex items-center justify-center shadow-lg shadow-red-200">
            <XCircle className="h-6 w-6 text-white" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-red-600 bg-red-200/60 px-2 py-0.5 rounded-full">Rejected</span>
            </div>
            <h2 className="text-lg font-bold text-gray-900">
              Rejected at Step {gate} — {stepName}
            </h2>
            {reason && (
              <p className="text-sm text-gray-600 mt-1">
                <span className="font-semibold text-gray-800">Reason:</span> {reason}
              </p>
            )}
            {rejectedAt && (
              <p className="text-xs text-gray-400 mt-1">
                Rejected on {new Date(rejectedAt).toLocaleString()}
              </p>
            )}
            <p className="text-xs text-red-600 mt-2">
              This project was declined. You can revert this decision to return to the approval gate and re-evaluate.
            </p>
            <div className="mt-4">
              <button
                onClick={handleRevert}
                disabled={loading}
                className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl font-semibold text-sm hover:from-blue-700 hover:to-indigo-700 transition-all shadow-md shadow-blue-200 disabled:opacity-50"
              >
                {loading ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                ) : (
                  <RotateCcw className="h-4 w-4" />
                )}
                Revert Decision
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function WorkflowFlowchart({
  mainStep,
  subStep,
  projectStatus,
  stepLog,
}: {
  mainStep: number;
  subStep: number | null;
  projectStatus?: string;
  stepLog?: Array<{ step_num: number; name: string; finding?: string; status: string }>;
}) {
  const [expanded, setExpanded] = useState(true);
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  type StepState = 'done' | 'active' | 'pending' | 'failed';

  // MAIN-pipeline state — uses mainStep cursor.
  const getMainState = (n: number): StepState => {
    if (n < mainStep) return 'done';
    if (n === mainStep) return 'active';
    return 'pending';
  };

  // ELECTRICAL-sub state — uses subStep cursor + the AI step_log if present.
  const getSubState = (n: number): StepState => {
    if (subStep == null && projectStatus !== 'boq_ready') return 'pending';
    if (projectStatus === 'boq_ready') return 'done';
    if (stepLog?.length) {
      const entry = stepLog.find(s => s.step_num === n);
      if (!entry) return n < (subStep ?? 0) ? 'done' : 'pending';
      if (entry.status === 'done') return 'done';
      if (entry.status === 'not_found') return 'failed';
      if (entry.status === 'in_progress') return 'active';
      return 'pending';
    }
    if (subStep == null) return 'pending';
    if (n < subStep) return 'done';
    if (n === subStep) return 'active';
    return 'pending';
  };

  const cardCls = (state: StepState) => ({
    done:    'border-green-300 bg-green-50 text-green-700',
    active:  'border-blue-300 bg-blue-50 text-blue-700',
    failed:  'border-red-300 bg-red-50 text-red-700',
    pending: 'border-gray-200 bg-white text-gray-400',
  }[state]);
  const numCls = (state: StepState) => ({
    done:    'bg-green-100 text-green-700',
    active:  'bg-blue-100 text-blue-700',
    failed:  'bg-red-100 text-red-700',
    pending: 'bg-gray-100 text-gray-500',
  }[state]);
  const connectorBg = (state: StepState) =>
    state === 'done' ? 'bg-green-400' : 'bg-gray-200';

  // Phase header colors mirror the workflow PDF's 4 phase containers.
  const phaseAccent: Record<string, { dot: string; chip: string; ring: string }> = {
    info_sufficiency: { dot: 'bg-blue-500',    chip: 'text-blue-700 bg-blue-50',    ring: 'ring-blue-100' },
    bid_decision:     { dot: 'bg-purple-500',  chip: 'text-purple-700 bg-purple-50',ring: 'ring-purple-100' },
    quantities:       { dot: 'bg-teal-500',    chip: 'text-teal-700 bg-teal-50',    ring: 'ring-teal-100' },
    final_quote:      { dot: 'bg-orange-500',  chip: 'text-orange-700 bg-orange-50',ring: 'ring-orange-100' },
    pre_pipeline:     { dot: 'bg-gray-400',    chip: 'text-gray-700 bg-gray-50',    ring: 'ring-gray-100' },
    electrical:       { dot: 'bg-slate-500',   chip: 'text-slate-700 bg-slate-100', ring: 'ring-slate-200' },
  };

  const isGate = (n: number) => (MAIN_GATE_STEPS as readonly number[]).includes(n);

  const gateLabel = (n: number) => {
    switch (n) {
      case 9:  return 'Gate 1\nDocs Sufficient';
      case 10: return 'Gate 2\nBid Decision';
      case 12: return 'Gate 3\nConfirm Quantities';
      case 14: return 'Gate 4\nConfirm Total';
      case 15: return 'Gate 5\nConsent → Send';
      default: return `Gate ${n}`;
    }
  };

  const gateState = (n: number): StepState => getMainState(n);

  const subPipelineActive = subStep != null || projectStatus === 'boq_ready';

  // ── Fullscreen + zoom state ──────────────────────────────────────────────
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const minZoom = 0.6;
  const maxZoom = 2.5;
  const zoomStep = 0.1;

  // Esc to close, Ctrl/Cmd +/- and 0 to zoom
  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setIsFullscreen(false); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) {
        e.preventDefault(); setZoom(z => Math.min(maxZoom, +(z + zoomStep).toFixed(2)));
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault(); setZoom(z => Math.max(minZoom, +(z - zoomStep).toFixed(2)));
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault(); setZoom(1);
      }
    };
    window.addEventListener('keydown', onKey);
    // Lock body scroll while fullscreen.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [isFullscreen]);

  // The rendered phase/step body — reused inline AND inside the fullscreen modal.
  // `large` swaps cards / fonts / gates to a more readable size.
  const renderBody = (large: boolean) => {
    const phaseW   = large ? 'max-w-[460px]' : 'max-w-[260px]';
    const stepPad  = large ? 'px-4 py-2.5'   : 'px-3 py-2';
    const stepText = large ? 'text-xs'        : 'text-[10px]';
    const numSize  = large ? 'w-6 h-6 text-[10px]' : 'w-5 h-5 text-[9px]';
    const gateBox  = large ? 'w-40 h-20'      : 'w-28 h-12';
    const gateText = large ? 'text-[12px]'    : 'text-[10px]';
    const gateWrap = large ? 'w-56 h-24'      : 'w-40 h-16';
    const phaseChip= large ? 'text-[12px] px-3 py-1' : 'text-[10px] px-2 py-0.5';

    return (
      <div className="flex flex-col items-center">
        {MAIN_PIPELINE_PHASES.map((phase) => {
          const phaseSteps = MAIN_PIPELINE_STEPS.filter(s => s.phase === phase.id);
          const accent = phaseAccent[phase.id] ?? phaseAccent.info_sufficiency;
          return (
            <div key={phase.id} className={`w-full ${phaseW} mt-3 first:mt-0`}>
              <div className={`flex items-center gap-2 mb-2 px-1`}>
                <span className={`w-1.5 h-1.5 rounded-full ${accent.dot}`} />
                <span className={`font-semibold uppercase tracking-wide rounded-full ${accent.chip} ${phaseChip}`}>
                  {phase.label}
                </span>
              </div>

              {phaseSteps.map((step, i) => {
                const state = getMainState(step.step);
                const stepIsGate = isGate(step.step);
                const isStep11 = step.step === 11;
                const showSubExpansion = isStep11 && subPipelineActive;
                const isExpandedStep = expandedStep === step.step;

                const connector = i > 0 ? (
                  <div className={`w-px h-3 ${connectorBg(getMainState(step.step - 1))}`} />
                ) : null;

                if (stepIsGate) {
                  const gs = gateState(step.step);
                  return (
                    <div key={step.step} className="flex flex-col items-center">
                      {connector}
                      <div className={`relative ${gateWrap} flex items-center justify-center`}>
                        <div className={`absolute ${gateBox} border-2 rotate-45 rounded-sm ${
                          gs === 'done'   ? 'border-green-500 bg-green-50' :
                          gs === 'active' ? 'border-amber-400 bg-amber-50' :
                                            'border-gray-300 bg-gray-50'
                        }`} />
                        <span className={`relative z-10 font-medium text-center leading-tight whitespace-pre-line px-2 ${gateText} ${
                          gs === 'done'   ? 'text-green-700' :
                          gs === 'active' ? 'text-amber-700' :
                                            'text-gray-400'
                        }`}>
                          {gateLabel(step.step)}
                        </span>
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={step.step} className="flex flex-col items-center w-full">
                    {connector}
                    <button
                      onClick={() => isStep11 ? setExpandedStep(isExpandedStep ? null : step.step) : undefined}
                      className={`w-full flex items-center gap-2 ${stepPad} rounded-lg border ${stepText} leading-tight shadow-sm transition-colors ${cardCls(state)} ${state === 'active' ? 'animate-pulse' : ''} ${isStep11 ? 'cursor-pointer hover:opacity-90' : 'cursor-default'}`}
                    >
                      <span className={`rounded-full font-bold flex items-center justify-center flex-shrink-0 ${numSize} ${numCls(state)}`}>
                        {step.step}
                      </span>
                      <span className="font-medium flex-1 text-left">{step.displayName ?? step.name}</span>
                      {isStep11 && (
                        <ChevronDown className={`h-3 w-3 transition-transform ${isExpandedStep ? 'rotate-180' : ''}`} />
                      )}
                    </button>

                    {showSubExpansion && (isExpandedStep || subStep != null) && (
                      <div className={`mt-1 w-full pl-3 pr-1 py-2 rounded-lg bg-slate-50 border border-slate-200 ring-2 ${phaseAccent.electrical.ring}`}>
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <span className={`w-1 h-1 rounded-full ${phaseAccent.electrical.dot}`} />
                          <span className={`font-semibold uppercase tracking-wide text-slate-600 ${large ? 'text-[11px]' : 'text-[9px]'}`}>
                            Electrical sub-pipeline · {subStep ?? 0}/14
                          </span>
                        </div>
                        {ELECTRICAL_SUB_PIPELINE.map((sub, si) => {
                          const sState = getSubState(sub.step);
                          const subEntry = stepLog?.find(s => s.step_num === sub.step);
                          const subExpKey = 100 + sub.step;
                          const subIsExpanded = expandedStep === subExpKey;
                          const isSubGate = sub.step === 14;
                          return (
                            <div key={sub.step} className="flex flex-col items-stretch">
                              {si > 0 && (
                                <div className={`mx-auto w-px h-2 ${connectorBg(getSubState(sub.step - 1))}`} />
                              )}
                              <button
                                onClick={() => subEntry?.finding ? setExpandedStep(subIsExpanded ? null : subExpKey) : undefined}
                                className={`w-full flex items-center gap-1.5 ${large ? 'px-3 py-1.5 text-[11px]' : 'px-2 py-1 text-[9px]'} rounded border leading-tight ${cardCls(sState)} ${sState === 'active' ? 'animate-pulse' : ''} ${isSubGate ? 'border-amber-300 bg-amber-50 text-amber-700 font-semibold' : ''} ${subEntry?.finding ? 'cursor-pointer hover:opacity-90' : 'cursor-default'}`}
                              >
                                <span className={`rounded-full font-bold flex items-center justify-center flex-shrink-0 ${large ? 'w-5 h-5 text-[10px]' : 'w-4 h-4 text-[8px]'} ${numCls(sState)} ${isSubGate ? 'bg-amber-200 text-amber-800' : ''}`}>
                                  {sub.step}
                                </span>
                                <span className="flex-1 text-left">{sub.displayName ?? sub.name}</span>
                                {subEntry?.finding && (
                                  <ChevronDown className={`h-2.5 w-2.5 transition-transform ${subIsExpanded ? 'rotate-180' : ''}`} />
                                )}
                              </button>
                              {subIsExpanded && subEntry?.finding && (
                                <div className={`mt-0.5 px-2 py-1.5 bg-blue-50 border border-blue-200 rounded text-blue-800 leading-relaxed ${large ? 'text-[11px]' : 'text-[9px]'}`}>
                                  {subEntry.finding}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <>
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-2 flex-1 min-w-0"
          >
            <div className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0">
              <Zap className="h-3.5 w-3.5 text-indigo-600" />
            </div>
            <h3 className="text-sm font-semibold text-gray-900">RFQ → Quote Pipeline</h3>
            <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
              Step {mainStep}/15{subStep != null ? ` · sub ${subStep}/14` : ''}
            </span>
          </button>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={(e) => { e.stopPropagation(); setIsFullscreen(true); setZoom(1); }}
              className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700"
              title="Open fullscreen (Esc to close)"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-1 rounded hover:bg-gray-100 text-gray-400"
            >
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {expanded && (
          <div className="px-4 pb-5 border-t border-gray-100">
            <div className="mt-4">
              {renderBody(false)}
            </div>
          </div>
        )}
      </div>

      {/* ── Fullscreen modal ─────────────────────────────────────────────── */}
      {isFullscreen && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setIsFullscreen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[95vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 flex-shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center">
                  <Zap className="h-3.5 w-3.5 text-indigo-600" />
                </div>
                <h3 className="text-sm font-semibold text-gray-900">RFQ → Quote Pipeline</h3>
                <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                  Step {mainStep}/15{subStep != null ? ` · sub ${subStep}/14` : ''}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setZoom(z => Math.max(minZoom, +(z - zoomStep).toFixed(2)))}
                  className="p-1.5 rounded hover:bg-gray-100 text-gray-600 disabled:opacity-40"
                  disabled={zoom <= minZoom}
                  title="Zoom out (Ctrl/Cmd −)"
                >
                  <ZoomOut className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setZoom(1)}
                  className="px-2 py-0.5 rounded text-[11px] font-medium text-gray-600 hover:bg-gray-100 tabular-nums"
                  title="Reset zoom (Ctrl/Cmd 0)"
                >
                  {Math.round(zoom * 100)}%
                </button>
                <button
                  onClick={() => setZoom(z => Math.min(maxZoom, +(z + zoomStep).toFixed(2)))}
                  className="p-1.5 rounded hover:bg-gray-100 text-gray-600 disabled:opacity-40"
                  disabled={zoom >= maxZoom}
                  title="Zoom in (Ctrl/Cmd +)"
                >
                  <ZoomIn className="h-4 w-4" />
                </button>
                <span className="w-px h-5 bg-gray-200 mx-1" />
                <button
                  onClick={() => setIsFullscreen(false)}
                  className="p-1.5 rounded hover:bg-gray-100 text-gray-600"
                  title="Close (Esc)"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto bg-gray-50 p-6">
              <div
                style={{
                  transform: `scale(${zoom})`,
                  transformOrigin: 'top center',
                  width: `${100 / zoom}%`,
                  margin: '0 auto',
                }}
              >
                {renderBody(true)}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}


function ActivityLogPanel({ logs }: { logs: { id: string; step_name: string; status: string; created_at: string }[] }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? logs.slice(0, 20) : logs.slice(0, 5);
  const hasMore = logs.length > 5;

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between mb-3"
      >
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-gray-100 flex items-center justify-center">
            <FileText className="h-3 w-3 text-gray-500" />
          </div>
          <h3 className="text-xs font-semibold text-gray-900">Activity Log</h3>
          <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">{logs.length}</span>
        </div>
        {hasMore && (
          expanded
            ? <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
            : <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
        )}
      </button>
      <div className="relative">
        <div className="absolute left-[5px] top-1 bottom-1 w-px bg-gray-100" />
        <div className="space-y-2">
          {shown.map((log) => (
            <div key={log.id} className="flex items-center gap-2.5 relative">
              <div className={`w-[11px] h-[11px] rounded-full flex-shrink-0 ring-2 ring-white ${
                log.status === 'completed' ? 'bg-green-500' : 'bg-red-500'
              }`} />
              <p className="text-[11px] font-medium text-gray-600 flex-1 truncate">{log.step_name}</p>
              <p className="text-[10px] text-gray-400 tabular-nums flex-shrink-0">{formatDateTime(log.created_at)}</p>
            </div>
          ))}
        </div>
      </div>
      {hasMore && !expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="mt-2 text-[10px] text-blue-600 hover:text-blue-800 font-medium w-full text-center"
        >
          Show {logs.length - 5} more...
        </button>
      )}
    </div>
  );
}

// Discipline color mapping for MEP services
const DISCIPLINE_META: Record<string, { label: string; color: string; bgColor: string }> = {
  hvac:          { label: 'HVAC',           color: 'text-orange-700', bgColor: 'bg-orange-50' },
  electrical:    { label: 'Electrical',     color: 'text-yellow-700', bgColor: 'bg-yellow-50' },
  plumbing:      { label: 'Plumbing',       color: 'text-blue-700',   bgColor: 'bg-blue-50' },
  fire_fighting: { label: 'Fire Fighting',  color: 'text-red-700',    bgColor: 'bg-red-50' },
  fire_alarm:    { label: 'Fire Alarm',     color: 'text-pink-700',   bgColor: 'bg-pink-50' },
  bms:           { label: 'BMS',            color: 'text-indigo-700', bgColor: 'bg-indigo-50' },
  lpg:           { label: 'LPG',            color: 'text-emerald-700',bgColor: 'bg-emerald-50' },
  drainage:      { label: 'Drainage',       color: 'text-teal-700',   bgColor: 'bg-teal-50' },
};

// Type info for document display
const FILE_TYPE_META: Record<string, { label: string; color: string; bgColor: string; iconColor: string }> = {
  drawing_autocad: { label: 'AutoCAD Drawing', color: 'text-blue-700', bgColor: 'bg-blue-50', iconColor: 'text-blue-500' },
  drawing_pdf:     { label: 'PDF Drawing',     color: 'text-red-700',  bgColor: 'bg-red-50',  iconColor: 'text-red-500' },
  schedule_excel:  { label: 'Excel Schedule',  color: 'text-green-700',bgColor: 'bg-green-50',iconColor: 'text-green-500' },
  specification:   { label: 'Specification',   color: 'text-purple-700',bgColor: 'bg-purple-50',iconColor: 'text-purple-500' },
  archive_zip:     { label: 'ZIP Archive',     color: 'text-amber-700',bgColor: 'bg-amber-50',iconColor: 'text-amber-500' },
  image:           { label: 'Image',           color: 'text-cyan-700', bgColor: 'bg-cyan-50', iconColor: 'text-cyan-500' },
  other:           { label: 'Other',           color: 'text-gray-600', bgColor: 'bg-gray-50', iconColor: 'text-gray-400' },
};

function AttachmentIcon({ fileType, className }: { fileType: string | null; className?: string }) {
  const type = fileType || 'other';
  const meta = FILE_TYPE_META[type] || FILE_TYPE_META.other;
  const cls = `${meta.iconColor} ${className || 'h-4 w-4'}`;
  if (type === 'archive_zip') return <Archive className={cls} />;
  if (type === 'drawing_autocad') return <FileText className={cls} />;
  if (type === 'drawing_pdf') return <FileText className={cls} />;
  if (type === 'schedule_excel') return <FileSpreadsheet className={cls} />;
  if (type === 'image') return <ImageIcon className={cls} />;
  return <File className={cls} />;
}

// Detect special HVAC file identifiers from filename
function getFileIdentification(filename: string): { label: string; color: string } | null {
  const lower = filename.toLowerCase();
  if (lower.includes('thermal') && (lower.includes('load') || lower.includes('summary')))
    return { label: 'Thermal Load Summary', color: 'bg-green-100 text-green-700 ring-1 ring-green-300' };
  if (lower.includes('equipment') && lower.includes('schedule'))
    return { label: 'Equipment Schedule', color: 'bg-blue-100 text-blue-700 ring-1 ring-blue-300' };
  if (lower.includes('ac') && lower.includes('schedule'))
    return { label: 'AC Equipment Schedule', color: 'bg-blue-100 text-blue-700 ring-1 ring-blue-300' };
  return null;
}

// Build a hierarchical folder tree from flat paths
interface TreeNode { name: string; type: 'folder' | 'file'; fullPath: string; children: TreeNode[] }

function buildFolderTree(paths: string[]): TreeNode[] {
  const root: TreeNode[] = [];
  for (const path of paths) {
    const parts = path.split('/').filter(Boolean);
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isFile = i === parts.length - 1;
      const existing = current.find(n => n.name === name && n.type === (isFile ? 'file' : 'folder'));
      if (existing) {
        current = existing.children;
      } else {
        const node: TreeNode = {
          name,
          type: isFile ? 'file' : 'folder',
          fullPath: parts.slice(0, i + 1).join('/'),
          children: [],
        };
        current.push(node);
        current = node.children;
      }
    }
  }
  return root;
}

function FolderTreeNode({ node, depth = 0 }: { node: TreeNode; depth?: number }) {
  const [open, setOpen] = useState(depth < 2);

  if (node.type === 'file') {
    const lower = node.name.toLowerCase();
    let inferredType: string = 'other';
    if (lower.endsWith('.dwg') || lower.endsWith('.dxf')) inferredType = 'drawing_autocad';
    else if (lower.endsWith('.pdf')) inferredType = 'drawing_pdf';
    else if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) inferredType = 'schedule_excel';
    else if (lower.endsWith('.doc') || lower.endsWith('.docx')) inferredType = 'specification';
    else if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')) inferredType = 'image';
    const meta = FILE_TYPE_META[inferredType] || FILE_TYPE_META.other;
    const identification = getFileIdentification(node.name);

    return (
      <div className="flex items-center gap-2 py-1 hover:bg-gray-50 rounded" style={{ paddingLeft: `${depth * 16 + 12}px` }}>
        <AttachmentIcon fileType={inferredType} className="h-3.5 w-3.5 flex-shrink-0" />
        <span className="text-xs text-gray-700 truncate flex-1">{node.name}</span>
        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${meta.bgColor} ${meta.color} flex-shrink-0`}>
          {meta.label}
        </span>
        {identification && (
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${identification.color} flex-shrink-0`}>
            {identification.label}
          </span>
        )}
      </div>
    );
  }

  // Folder
  const fileCount = node.children.filter(c => c.type === 'file').length;
  const folderCount = node.children.filter(c => c.type === 'folder').length;
  // Check if this is a discipline folder
  const folderLower = node.name.toLowerCase();
  const isHvacFolder = folderLower.includes('hvac') || folderLower.includes('ac') || folderLower.includes('ventilation');
  const isElecFolder = folderLower.includes('elec');
  const isPlumbFolder = folderLower.includes('plumb') || folderLower.includes('water');
  const isFireFolder = folderLower.includes('fire');
  const folderAccent = isHvacFolder ? 'text-blue-600' : isElecFolder ? 'text-amber-600' : isPlumbFolder ? 'text-cyan-600' : isFireFolder ? 'text-red-600' : 'text-gray-600';

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 py-1.5 w-full hover:bg-gray-50 rounded transition-colors text-left"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {open
          ? <ChevronDown className="h-3 w-3 text-gray-400 flex-shrink-0" />
          : <ChevronRight className="h-3 w-3 text-gray-400 flex-shrink-0" />
        }
        <FolderOpen className={`h-4 w-4 flex-shrink-0 ${folderAccent}`} />
        <span className={`text-xs font-medium ${folderAccent}`}>{node.name}</span>
        <span className="text-[10px] text-gray-400 ml-auto pr-2">
          {fileCount > 0 && `${fileCount} file${fileCount > 1 ? 's' : ''}`}
          {folderCount > 0 && `${fileCount > 0 ? ', ' : ''}${folderCount} folder${folderCount > 1 ? 's' : ''}`}
        </span>
      </button>
      {open && (
        <div>
          {node.children
            .sort((a, b) => a.type === 'folder' && b.type === 'file' ? -1 : a.type === 'file' && b.type === 'folder' ? 1 : 0)
            .map((child) => (
              <FolderTreeNode key={child.fullPath} node={child} depth={depth + 1} />
            ))}
        </div>
      )}
    </div>
  );
}

function FolderTree({ paths }: { paths: string[] }) {
  const tree = buildFolderTree(paths);
  if (tree.length === 0) return null;
  return (
    <div className="py-1">
      {tree.map((node) => (
        <FolderTreeNode key={node.fullPath} node={node} />
      ))}
    </div>
  );
}

function DocumentsSection({
  attachments,
  projectId,
  onUploaded,
}: {
  attachments: import('@/lib/shared/types').Attachment[];
  projectId: string;
  onUploaded: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [expandedZips, setExpandedZips] = useState<Record<string, boolean>>({});
  const [filterDiscipline, setFilterDiscipline] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<{ id: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadingFile, setUploadingFile] = useState<string | null>(null);
  const [uploadPct, setUploadPct] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const acceptedFileTypes = '.zip,.rar,.7z,.pdf,.png,.jpg,.jpeg,.dwg,.dxf,.xlsx,.xls,.csv,.doc,.docx,.txt';

  const uploadProjectFile = async (file: File) => {
    try {
      await uploadFile(file, {
        kind: 'attachment',
        projectId,
        onProgress: setUploadPct,
      });
    } catch (err: any) {
      const message = String(err?.message || err || '');
      const canUseFormFallback = message.includes('Presign failed') || message.includes('Supabase S3 not configured');
      if (!canUseFormFallback) throw err;

      const formData = new FormData();
      formData.append('files', file);
      const res = await fetch(`/api/projects/${projectId}/upload`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.details || data.error || message || 'Upload failed');
      }
      setUploadPct(100);
    }
  };

  const handleUploadSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (files.length === 0 || uploading) return;

    setUploading(true);
    setUploadPct(0);
    try {
      for (const file of files) {
        setUploadingFile(file.name);
        await uploadProjectFile(file);
      }

      setUploadingFile(null);
      setUploadPct(0);

      const scanRes = await fetch(`/api/projects/${projectId}/extract`, { method: 'POST' });
      if (!scanRes.ok) {
        const data = await scanRes.json().catch(() => ({}));
        throw new Error(data.details || data.error || 'Scan failed after upload');
      }

      await onUploaded();
      toast(`Added and rescanned ${files.length} file${files.length === 1 ? '' : 's'}`, 'success');
    } catch (err: any) {
      toast(`Upload failed: ${err.message || err}`, 'error');
      await onUploaded();
    } finally {
      setUploading(false);
      setUploadingFile(null);
      setUploadPct(0);
    }
  };

  // Separate zip files from regular files
  const zipFiles = attachments.filter((a) => a.file_type === 'archive_zip');
  const regularFiles = attachments.filter((a) => a.file_type !== 'archive_zip');

  // Count by category
  const catCounts: Record<string, number> = {};
  attachments.forEach((a) => {
    const cat = a.file_type || 'other';
    catCounts[cat] = (catCounts[cat] || 0) + 1;
  });

  // Count by discipline
  const discCounts: Record<string, number> = {};
  attachments.forEach((a) => {
    if (a.discipline) {
      discCounts[a.discipline] = (discCounts[a.discipline] || 0) + 1;
    }
  });
  const hasDisciplines = Object.keys(discCounts).length > 0;

  // Apply discipline filter
  const filteredRegular = filterDiscipline
    ? regularFiles.filter(a => a.discipline === filterDiscipline)
    : regularFiles;

  const toggleZip = (id: string) =>
    setExpandedZips((prev) => ({ ...prev, [id]: !prev[id] }));

  // Flow stages derived from data
  const stages = [
    { label: 'Email Received', done: true },
    { label: 'Attachments Listed', done: attachments.length > 0 },
    { label: 'Zips Detected', done: zipFiles.length > 0 },
    { label: 'Contents Unzipped', done: zipFiles.some((z) => {
        const data = z.extracted_data as Record<string, unknown> | null;
        return !!(data?.contents);
      })
    },
    { label: 'Documents Categorized', done: attachments.some((a) => a.file_type !== null) },
  ];

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
        <div>
          <p className="text-sm font-semibold text-gray-800">Project files</p>
          <p className="text-xs text-gray-500">
            Add missing drawings, schedules, specs, or a ZIP package to improve this project's scan data.
          </p>
        </div>
        <div className="flex flex-col items-stretch sm:items-end gap-1">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={acceptedFileTypes}
            onChange={handleUploadSelected}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {uploading ? 'Uploading...' : attachments.length > 0 ? 'Add more files' : 'Upload files'}
          </button>
          {uploadingFile && (
            <p className="text-[10px] text-gray-500 max-w-[240px] truncate">
              {uploadingFile} {uploadPct > 0 ? `${uploadPct}%` : ''}
            </p>
          )}
        </div>
      </div>

      {attachments.length === 0 && !uploading && (
        <div className="border border-dashed border-gray-200 rounded-lg px-4 py-6 text-center mb-4">
          <FolderOpen className="h-6 w-6 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-600">No project files uploaded yet. Upload files manually to start the scan.</p>
        </div>
      )}

      {/* Flow indicator: Email → Attachments → Zip → Unzip → Categorized */}
      <div className="flex items-center gap-1 flex-wrap mb-4 p-3 bg-gray-50 rounded-lg">
        {stages.map((stage, i) => (
          <div key={stage.label} className="flex items-center gap-1">
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
              stage.done ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-400'
            }`}>
              {stage.label}
            </span>
            {i < stages.length - 1 && (
              <ArrowRight className="h-3 w-3 text-gray-300 flex-shrink-0" />
            )}
          </div>
        ))}
      </div>

      {/* Category badge summary */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {Object.entries(catCounts).map(([cat, count]) => {
          const meta = FILE_TYPE_META[cat] || FILE_TYPE_META.other;
          return (
            <span key={cat} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${meta.bgColor} ${meta.color}`}>
              {meta.label}: {count}
            </span>
          );
        })}
      </div>

      {/* Discipline filter badges */}
      {hasDisciplines && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          <button
            onClick={() => setFilterDiscipline(null)}
            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border transition-colors ${
              !filterDiscipline ? 'bg-gray-800 text-white border-gray-800' : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
            }`}
          >
            All
          </button>
          {Object.entries(discCounts).map(([disc, count]) => {
            const meta = DISCIPLINE_META[disc] || { label: disc, color: 'text-gray-600', bgColor: 'bg-gray-50' };
            const isActive = filterDiscipline === disc;
            return (
              <button
                key={disc}
                onClick={() => setFilterDiscipline(isActive ? null : disc)}
                className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border transition-colors ${
                  isActive ? 'bg-gray-800 text-white border-gray-800' : `${meta.bgColor} ${meta.color} border-current border-opacity-20 hover:opacity-80`
                }`}
              >
                {meta.label}: {count}
              </button>
            );
          })}
        </div>
      )}

      {/* ZIP files — expanded to show contents */}
      {zipFiles.length > 0 && (
        <div className="mb-3">
          <p className="text-xs font-medium text-amber-700 mb-2 flex items-center gap-1">
            <Archive className="h-3.5 w-3.5" />
            ZIP Archives ({zipFiles.length})
          </p>
          <div className="space-y-2">
            {zipFiles.map((zip) => {
              const isExpanded = expandedZips[zip.id] !== false; // expanded by default
              const data = zip.extracted_data as Record<string, unknown> | null;
              const contents = (data?.contents as string[]) || [];
              return (
                <div key={zip.id} className="border border-amber-200 rounded-lg overflow-hidden">
                  {/* ZIP header row */}
                  <button
                    onClick={() => toggleZip(zip.id)}
                    className="w-full flex items-center gap-3 p-2.5 bg-amber-50 hover:bg-amber-100 transition-colors text-left"
                  >
                    <Archive className="h-4 w-4 text-amber-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-amber-800 truncate">{zip.filename}</p>
                      <p className="text-[10px] text-amber-600">
                        ZIP Archive
                        {zip.size_bytes ? ` · ${(zip.size_bytes / 1024).toFixed(0)} KB` : ''}
                        {contents.length > 0 ? ` · ${contents.length} files inside` : ' · contents not yet extracted'}
                      </p>
                    </div>
                    {zip.attachment_id && zip.message_id && (
                      <a
                        href={`/api/gmail/attachment?messageId=${zip.message_id}&attachmentId=${zip.attachment_id}&filename=${encodeURIComponent(zip.filename)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 flex-shrink-0"
                      >
                        <Download className="h-3 w-3" />
                      </a>
                    )}
                    {isExpanded
                      ? <ChevronDown className="h-4 w-4 text-amber-400 flex-shrink-0" />
                      : <ChevronRight className="h-4 w-4 text-amber-400 flex-shrink-0" />
                    }
                  </button>

                  {/* ZIP contents — folder tree */}
                  {isExpanded && (
                    <div className="border-t border-amber-200 bg-white">
                      {contents.length > 0 ? (
                        <FolderTree paths={contents} />
                      ) : (
                        <div className="flex items-center gap-2 px-4 py-3 text-xs text-gray-400">
                          <FolderOpen className="h-4 w-4" />
                          <span>Run &quot;Unzip Attachments&quot; (Step 6) to list contents</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Regular files */}
      {filteredRegular.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1">
            <File className="h-3.5 w-3.5" />
            {filterDiscipline ? `${DISCIPLINE_META[filterDiscipline]?.label || filterDiscipline} Files` : 'Individual Files'} ({filteredRegular.length})
          </p>
          <div className="space-y-1.5">
            {filteredRegular.map((att) => {
              const meta = FILE_TYPE_META[att.file_type || 'other'] || FILE_TYPE_META.other;
              const hasExtractedText = att.extracted_data && (att.extracted_data as Record<string, string>).text;
              const identification = getFileIdentification(att.filename);
              const identifiedAs = att.extracted_data && (att.extracted_data as Record<string, string>).identified_as;
              // Phase 10: extraction provenance — which layer produced this file's text
              const extractedData = (att.extracted_data ?? {}) as Record<string, unknown>;
              const ocrSource = extractedData.ocr_source as string | undefined;
              const ocrPages = extractedData.ocr_pages as number | undefined;
              const provenanceMeta: { label: string; bg: string; color: string; title: string } | null =
                ocrSource === 'tesseract'
                  ? { label: 'OCR (image)', bg: 'bg-orange-100', color: 'text-orange-700', title: `Tesseract.js text extraction` }
                  : ocrSource === 'tesseract-pdf'
                  ? { label: `OCR (PDF·${ocrPages ?? '?'}p)`, bg: 'bg-orange-100', color: 'text-orange-700', title: `Tesseract.js + pdfjs raster on ${ocrPages ?? '?'} page(s) — pdf-parse returned <200 chars` }
                  : hasExtractedText
                  ? { label: 'pdf-parse', bg: 'bg-emerald-50', color: 'text-emerald-700', title: 'Text extracted via pdf-parse (embedded text layer)' }
                  : null;
              return (
                <div
                  key={att.id}
                  onClick={() => setPreviewFile({ id: att.id, name: att.filename })}
                  className="border border-gray-100 rounded-lg overflow-hidden cursor-pointer hover:border-blue-300 hover:shadow-sm transition-all"
                >
                  <div className={`flex items-center gap-3 p-2.5 ${meta.bgColor}`}>
                    <AttachmentIcon fileType={att.file_type} className="h-4 w-4 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-gray-700 truncate">{att.filename}</p>
                        {att.size_bytes && (
                          <span className="text-[9px] text-gray-400 flex-shrink-0 tabular-nums">
                            {att.size_bytes > 1048576 ? `${(att.size_bytes / 1048576).toFixed(1)} MB` : `${Math.round(att.size_bytes / 1024)} KB`}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${meta.bgColor} ${meta.color} border border-current border-opacity-20`}>
                          {meta.label}
                        </span>
                        {att.discipline && (() => {
                          const dm = DISCIPLINE_META[att.discipline] || { label: att.discipline, color: 'text-gray-600', bgColor: 'bg-gray-50' };
                          return (
                            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${dm.bgColor} ${dm.color}`}>
                              {dm.label}
                            </span>
                          );
                        })()}
                        {(identification || identifiedAs) && (
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${identification?.color || 'bg-green-100 text-green-700 ring-1 ring-green-300'}`}>
                            {identification?.label || identifiedAs}
                          </span>
                        )}
                        {provenanceMeta && (
                          <span
                            className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${provenanceMeta.bg} ${provenanceMeta.color}`}
                            title={provenanceMeta.title}
                          >
                            {provenanceMeta.label}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs flex items-center gap-1 px-2 py-1 rounded-lg text-blue-600 bg-blue-50 border border-blue-200 font-medium">
                        <Eye className="h-3 w-3" />
                        Preview
                      </span>
                      {att.attachment_id && att.message_id && (
                        <a
                          href={`/api/gmail/attachment?messageId=${att.message_id}&attachmentId=${att.attachment_id}&filename=${encodeURIComponent(att.filename)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs text-gray-500 hover:text-blue-600 flex items-center gap-1 px-1.5 py-1 rounded hover:bg-white"
                          title="Download"
                        >
                          <Download className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Inline file preview modal */}
      {previewFile && (
        <FilePreviewModal
          projectId={projectId}
          attachmentId={previewFile.id}
          filename={previewFile.name}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </div>
  );
}
