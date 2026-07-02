'use client';

import React from 'react';
import {
  Tag, Building2, Wrench, Calculator, Ruler, FileSpreadsheet,
  Send, CheckCircle, ThumbsUp, ShieldAlert, Trophy, XCircle, Zap,
} from 'lucide-react';
import { ProjectDetail } from '@/lib/shared/types';
import { PIPELINE_STEPS, GATE_QUESTIONS } from '@/lib/shared/constants';
import { formatAED } from '@/lib/shared/utils';

const ACTION_ESTIMATES: Record<string, { label: string; seconds: number }> = {
  classify: { label: 'Classifying email with AI...', seconds: 3 },
  extract: { label: 'Extracting attachments & analyzing drawings...', seconds: 60 },
  services: { label: 'Identifying MEP services...', seconds: 3 },
  'estimate-fast': { label: 'Calculating area-based pricing...', seconds: 5 },
  'estimate-detailed': { label: 'Analyzing drawings & calculating prices...', seconds: 180 },
  yardstick: { label: 'Running yardstick comparison...', seconds: 3 },
  boq: { label: 'Generating Excel BOQ...', seconds: 10 },
  approve: { label: 'Approving quotation...', seconds: 2 },
  'send-quote': { label: 'Sending quotation email...', seconds: 10 },
  reject: { label: 'Processing rejection...', seconds: 2 },
  // Gate decisions — so the dock's Approve/Reject buttons also trigger
  // the processing banner (not just the in-button spinner).
  // Gate 9 approve auto-runs estimation (~2 min) and gate 20 triggers
  // yardstick + BOQ (~15s); other gates are fast. A generic 30s estimate
  // keeps the progress bar meaningful without per-gate branching.
  'gate-approve': { label: 'Processing gate decision — advancing pipeline...', seconds: 30 },
  'gate-reject': { label: 'Recording rejection...', seconds: 2 },
};

interface NextAction {
  type: 'gate' | 'approve' | 'send' | 'won_lost' | 'next_step' | 'processing';
  label: string;
  action: string;
  icon: React.ElementType;
  variant: 'amber' | 'green' | 'blue' | 'gray';
  gate?: number;
  gateName?: string;
  gateQuestion?: string;
}

export function getNextAction(
  project: ProjectDetail,
  actionLoading: string | null,
): NextAction | null {
  // 1. Processing in progress
  if (actionLoading && ACTION_ESTIMATES[actionLoading]) {
    return {
      type: 'processing',
      label: ACTION_ESTIMATES[actionLoading].label,
      action: actionLoading,
      icon: Zap,
      variant: 'blue',
    };
  }

  // 2. At a gate
  let gate: number | null = null;
  if (project.notes) {
    try { gate = JSON.parse(project.notes).approval_gate || null; } catch { /* */ }
  }
  if (gate) {
    const stepDef = PIPELINE_STEPS.find(s => s.step === gate);
    const gateQ = GATE_QUESTIONS[gate];
    return {
      type: 'gate',
      label: `Step ${gate}: ${stepDef?.name || 'Approval Required'}`,
      action: 'gate-approve',
      icon: ShieldAlert,
      variant: 'amber',
      gate,
      gateName: stepDef?.name,
      gateQuestion: gateQ?.question,
    };
  }

  // 3. Quotation ready, not approved
  if (project.status === 'quotation_ready' && !project.estimation?.george_approved) {
    return {
      type: 'approve',
      label: 'Approve Quotation',
      action: 'approve',
      icon: CheckCircle,
      variant: 'green',
    };
  }

  // 4. Approved, ready to send
  if (project.estimation?.george_approved && !['sent', 'won', 'lost', 'archived'].includes(project.status)) {
    return {
      type: 'send',
      label: 'Send to Client',
      action: 'send-quote',
      icon: Send,
      variant: 'blue',
    };
  }

  // 5. Sent - won/lost
  if (project.status === 'sent') {
    return {
      type: 'won_lost',
      label: 'Mark Result',
      action: 'won_lost',
      icon: Trophy,
      variant: 'gray',
    };
  }

  // 6. Next pipeline step
  const steps = [
    { status: ['new'], label: 'Classify Email', action: 'classify', icon: Tag },
    { status: ['new', 'classified', 'extracting'], label: 'Extract Project Info', action: 'extract', icon: Building2 },
    { status: ['extracted'], label: 'Identify Services', action: 'services', icon: Wrench },
    { status: ['services_identified', 'estimating', 'fast_pricing'], label: 'Run Estimation', action: 'estimate-detailed', icon: Calculator },
    { status: ['estimated', 'fast_pricing', 'yardstick_checked'], label: 'Run Yardstick Check', action: 'yardstick', icon: Ruler },
    { status: ['yardstick_checked', 'quotation_ready'], label: 'Generate BOQ', action: 'boq', icon: FileSpreadsheet },
  ];
  const available = steps.filter(s => s.status.includes(project.status));
  if (available.length > 0) {
    const next = available[0];
    return {
      type: 'next_step',
      label: next.label,
      action: next.action,
      icon: next.icon,
      variant: 'blue',
    };
  }

  // Terminal states - no action needed
  return null;
}

interface CommandBarProps {
  project: ProjectDetail;
  actionLoading: string | null;
  elapsedSeconds: number;
  onRunAction: (action: string) => void | Promise<unknown>;
  onScrollToGate: () => void;
  onWon: () => void;
  onLost: () => void;
  onGateApprove?: () => void;
}

export default function CommandBar({
  project, actionLoading, elapsedSeconds,
  onRunAction, onScrollToGate, onWon, onLost,
}: CommandBarProps) {
  const next = getNextAction(project, actionLoading);
  if (!next) return null;

  const variantStyles = {
    amber: 'bg-gradient-to-r from-amber-500 to-orange-500 shadow-amber-300/50',
    green: 'bg-gradient-to-r from-green-600 to-emerald-600 shadow-green-300/50',
    blue: 'bg-gradient-to-r from-blue-600 to-indigo-600 shadow-blue-300/50',
    gray: 'bg-white border-t border-gray-200 shadow-gray-200/50',
  };

  // Processing state
  if (next.type === 'processing') {
    const est = ACTION_ESTIMATES[next.action];
    const isOverTime = est && elapsedSeconds > est.seconds;
    const barPct = est ? Math.min((elapsedSeconds / est.seconds) * 100, 95) : 50;
    return (
      <div className="fixed bottom-0 left-0 right-0 z-50 animate-in slide-in-from-bottom pb-safe">
        <div className={`${isOverTime ? 'bg-gradient-to-r from-indigo-700 to-blue-700 shadow-indigo-400/50' : variantStyles.blue} shadow-2xl`}>
          <div className="max-w-5xl mx-auto px-3 sm:px-4 py-2.5 sm:py-3 flex items-center gap-2 sm:gap-4 flex-wrap">
            <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-white font-medium text-sm">
                {isOverTime ? 'Still working — large drawing set takes 2–3 min, please wait...' : next.label}
              </p>
              {est && (
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex-1 bg-white/20 rounded-full h-1.5 max-w-xs overflow-hidden">
                    <div
                      className={`h-1.5 rounded-full transition-all duration-1000 ${isOverTime ? 'animate-pulse bg-white/70' : 'bg-white'}`}
                      style={{ width: `${isOverTime ? 95 : barPct}%` }}
                    />
                  </div>
                  <span className="text-xs font-mono text-white/80 flex-shrink-0">
                    {elapsedSeconds}s{!isOverTime && ` / ~${est.seconds}s`}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Gate approval is handled exclusively by the floating ApprovalGateDock
  // on the bid detail page. Returning null here prevents a duplicate
  // sticky-bottom gate bar from appearing alongside the dock.
  if (next.type === 'gate') {
    return null;
  }

  // Won/Lost
  if (next.type === 'won_lost') {
    return (
      <div className="fixed bottom-0 left-0 right-0 z-50 animate-in slide-in-from-bottom pb-safe">
        <div className={`${variantStyles.gray} shadow-2xl`}>
          <div className="max-w-5xl mx-auto px-3 sm:px-4 py-2.5 sm:py-3 flex items-center gap-2 sm:gap-4 flex-wrap">
            <div className="flex items-center gap-2 flex-shrink-0">
              <Trophy className="h-5 w-5 text-gray-600" />
              <span className="text-gray-700 font-semibold text-sm">Quotation sent — what was the result?</span>
            </div>
            <div className="flex-1" />
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={onWon}
                disabled={actionLoading === 'won'}
                className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-bold hover:bg-green-700 transition-colors shadow-md disabled:opacity-50"
              >
                <span className="flex items-center gap-1.5"><Trophy className="h-3.5 w-3.5" /> Won</span>
              </button>
              <button
                onClick={onLost}
                disabled={actionLoading === 'lost'}
                className="px-4 py-2 bg-red-50 text-red-700 border border-red-200 rounded-lg text-sm font-bold hover:bg-red-100 transition-colors disabled:opacity-50"
              >
                <span className="flex items-center gap-1.5"><XCircle className="h-3.5 w-3.5" /> Lost</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Standard CTA: approve, send, or next pipeline step
  const Icon = next.icon;
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 animate-in slide-in-from-bottom">
      <div className={`${variantStyles[next.variant]} shadow-2xl`}>
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-4">
          <div className="flex items-center gap-2 flex-shrink-0">
            <Zap className="h-5 w-5 text-white" />
            <span className="text-white/80 font-medium text-sm hidden sm:block">Next Action</span>
          </div>
          <div className="flex-1" />
          <button
            onClick={() => onRunAction(next.action)}
            disabled={!!actionLoading}
            className="px-5 py-2.5 bg-white text-gray-800 rounded-lg text-sm font-bold hover:bg-gray-50 transition-colors shadow-md disabled:opacity-50"
          >
            <span className="flex items-center gap-2">
              <Icon className="h-4 w-4" />
              {next.label}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
