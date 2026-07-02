'use client';

/**
 * Dynamic Sidebar Workflow container.
 *
 * Replaces the linear 33-step stack with a two-pane layout:
 *   - Center  → technical output of the currently-selected step
 *   - Right   → sticky control sidebar (active control, clickable flowchart,
 *               and a special Final Review & Send card at gate 33)
 *
 * The sidebar auto-follows the active/gated step by default, but any step in
 * the flowchart can be clicked to override. Passing `selectedStep={null}`
 * (the default) restores auto-follow.
 *
 * Data comes from the same usePipelineStream hook that powers StepTimeline,
 * so realtime log writes update both views identically. Gate decisions are
 * delegated to `onApproveGate` / `onRejectGate` callbacks — this component
 * does not hit the API directly. That keeps it testable and leaves API
 * plumbing (success toasts, refetch, redirects) with the parent bid page.
 */

import { useMemo, useState } from 'react';
import {
  Check,
  Lock,
  AlertTriangle,
  Loader2,
  Circle,
  Send,
  Ban,
  Clock,
} from 'lucide-react';
import {
  PIPELINE_STEPS,
  PIPELINE_PHASES,
  GATE_QUESTIONS,
  STATUS_TO_STEP,
} from '@/lib/shared/constants';
import type { PipelinePhase, PipelineStep } from '@/lib/shared/types';
import {
  usePipelineStream,
  type StepState,
  type StepStatus,
} from '@/hooks/use-pipeline-stream';

// ─── Public props ────────────────────────────────────────────────────────────

interface ActivityLogRow {
  id: string;
  project_id: string;
  step: number;
  step_name: string;
  status: 'started' | 'completed' | 'failed' | 'skipped';
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface WorkflowContainerProps {
  projectId: string;
  currentStatus?: string;
  activityLog?: ActivityLogRow[];

  /** Client block shown on the Gate-33 consent card. */
  clientName?: string | null;
  clientEmail?: string | null;

  /**
   * Net amount (pre-VAT, after margin) in AED. The Gate-33 card renders both
   * this and the VAT-inclusive grand total.
   */
  netAmountAed?: number | null;

  /**
   * Gate decisions. Parent is responsible for the API call + refetch. These
   * callbacks are only wired for gate steps (11, 13, 24, 29, 33).
   */
  onApproveGate?: (step: number) => void | Promise<void>;
  onRejectGate?: (step: number, reason?: string) => void | Promise<void>;

  /** Gate 33 only. Defaults to onApproveGate(33) / onRejectGate(33). */
  onSend?: () => void | Promise<void>;
  onHold?: () => void | Promise<void>;

  /**
   * Render slot for per-step technical detail. Given the active step and its
   * activity-log row, return a node. Falls back to a generic JSON dump when
   * omitted. Pulled out as a prop so the bid page can compose rich cards
   * (AC system-type, yardstick chart, PDF preview, etc.) without this
   * component knowing the shape of every step's details.
   */
  renderStepDetail?: (step: PipelineStep, status: StepStatus | undefined) => React.ReactNode;
}

// ─── Colour tokens (kept in sync with StepTile) ──────────────────────────────

const STATE_TOKENS: Record<StepState, { dot: string; text: string; bg: string; ring: string }> = {
  pending:  { dot: 'bg-gray-300',    text: 'text-gray-500',  bg: 'bg-gray-50',    ring: 'ring-gray-200' },
  active:   { dot: 'bg-blue-500',    text: 'text-blue-700',  bg: 'bg-blue-50',    ring: 'ring-blue-300' },
  complete: { dot: 'bg-green-500',   text: 'text-green-700', bg: 'bg-green-50',   ring: 'ring-green-300' },
  failed:   { dot: 'bg-red-500',     text: 'text-red-700',   bg: 'bg-red-50',     ring: 'ring-red-300' },
  gated:    { dot: 'bg-amber-400',   text: 'text-amber-800', bg: 'bg-amber-50',   ring: 'ring-amber-400' },
  stale:    { dot: 'bg-gray-300',    text: 'text-gray-400',  bg: 'bg-gray-50',    ring: 'ring-gray-200' },
};

function pickState(
  status: StepStatus | undefined,
  step: PipelineStep,
  fallbackComplete: boolean
): StepState {
  if (status?.state === 'failed') return 'failed';
  if (status?.state === 'stale') return 'stale';
  if (status?.state === 'complete') return 'complete';
  if (status?.state === 'active') return step.requiresConfirmation ? 'gated' : 'active';
  if (fallbackComplete) return 'complete';
  return 'pending';
}

// ─── Main container ──────────────────────────────────────────────────────────

export default function WorkflowContainer({
  projectId,
  currentStatus,
  activityLog,
  clientName,
  clientEmail,
  netAmountAed,
  onApproveGate,
  onRejectGate,
  onSend,
  onHold,
  renderStepDetail,
}: WorkflowContainerProps) {
  const { stepsByNumber, connected } = usePipelineStream(
    projectId,
    activityLog as ActivityLogRow[] | undefined,
  );

  const fallbackCompleteThrough = currentStatus ? STATUS_TO_STEP[currentStatus] || 0 : 0;

  // Auto-follow focus: latest gated > active > completed step.
  const focusStep = useMemo(() => {
    const entries = Object.values(stepsByNumber);
    const gated = entries.filter(s => s.state === 'gated');
    if (gated.length > 0) return Math.max(...gated.map(s => s.step));
    const active = entries.filter(s => s.state === 'active');
    if (active.length > 0) return Math.max(...active.map(s => s.step));
    const done = entries.filter(s => s.state === 'complete');
    if (done.length > 0) return Math.max(...done.map(s => s.step));
    return fallbackCompleteThrough || 1;
  }, [stepsByNumber, fallbackCompleteThrough]);

  const [selectedStep, setSelectedStep] = useState<number | null>(null);
  const currentStep = selectedStep ?? focusStep;
  const activeStep = PIPELINE_STEPS.find(s => s.step === currentStep);
  const activeStatus = stepsByNumber[currentStep];
  const activeState = activeStep
    ? pickState(activeStatus, activeStep, currentStep <= fallbackCompleteThrough)
    : 'pending';

  if (!activeStep) return null;

  const gate = GATE_QUESTIONS[activeStep.step];
  const isGate = activeStep.requiresConfirmation && activeState === 'gated';
  const handleApprove = onApproveGate;
  const handleReject = onRejectGate;
  const handleSend = onSend || (onApproveGate && (() => onApproveGate(33)));
  const handleHold = onHold || (onRejectGate && (() => onRejectGate(33)));

  return (
    <div className="flex flex-col lg:flex-row gap-6 items-start">
      {/* ── Center: details + primary action (left-side confirm) ─────────── */}
      <main className="flex-1 min-w-0 w-full space-y-4">
        <StepDetailPane
          step={activeStep}
          status={activeStatus}
          state={activeState}
          renderStepDetail={renderStepDetail}
          isPinned={selectedStep !== null}
          onResumeAutoFollow={() => setSelectedStep(null)}
        />

        {/* Primary action rail — sits directly under the data the user is
            approving. Keeps the decision next to the evidence. */}
        {isGate && gate && activeStep.step !== 33 && (
          <GateActionBar
            step={activeStep.step}
            gate={gate}
            onApprove={handleApprove}
            onReject={handleReject}
          />
        )}
        {activeStep.step === 33 && (
          <FinalConsentBar
            state={activeState}
            clientName={clientName}
            clientEmail={clientEmail}
            netAmountAed={netAmountAed ?? null}
            onSend={handleSend}
            onHold={handleHold}
          />
        )}
      </main>

      {/* ── Right: sticky sidebar (status + navigation only) ─────────────── */}
      <aside className="w-full lg:w-80 lg:flex-shrink-0 lg:sticky lg:top-4 space-y-4">
        <StepStatusCard
          step={activeStep}
          state={activeState}
          status={activeStatus}
        />

        <PipelineFlowchartCard
          stepsByNumber={stepsByNumber}
          fallbackCompleteThrough={fallbackCompleteThrough}
          currentStep={currentStep}
          connected={connected}
          onStepClick={step => setSelectedStep(step)}
        />
      </aside>
    </div>
  );
}

// ─── Center: step detail pane ────────────────────────────────────────────────

function StepDetailPane({
  step,
  status,
  state,
  renderStepDetail,
  isPinned,
  onResumeAutoFollow,
}: {
  step: PipelineStep;
  status: StepStatus | undefined;
  state: StepState;
  renderStepDetail?: WorkflowContainerProps['renderStepDetail'];
  isPinned: boolean;
  onResumeAutoFollow: () => void;
}) {
  const tokens = STATE_TOKENS[state];
  const badge =
    state === 'gated' ? 'Awaiting review' :
    state === 'active' ? 'In progress' :
    state === 'complete' ? 'Completed' :
    state === 'failed' ? 'Failed' :
    state === 'stale' ? 'Superseded' :
    'Not yet started';

  return (
    <section className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      <header className="px-6 py-4 border-b border-gray-100 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-mono text-gray-400 mb-1">
            STEP {String(step.step).padStart(2, '0')} OF {PIPELINE_STEPS.length}
          </p>
          <h1 className="text-xl font-semibold text-gray-900 truncate">{step.displayName || step.name}</h1>
          <p className="text-sm text-gray-500 mt-1">{step.description}</p>
        </div>
        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide px-2 py-1 rounded-full ${tokens.bg} ${tokens.text}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${tokens.dot}`} />
            {badge}
          </span>
          {isPinned && (
            <button
              onClick={onResumeAutoFollow}
              className="text-[11px] text-blue-600 hover:text-blue-700 underline"
            >
              Follow live step
            </button>
          )}
        </div>
      </header>

      <div className="px-6 py-5">
        {renderStepDetail ? (
          renderStepDetail(step, status)
        ) : (
          <DefaultStepDetail step={step} status={status} state={state} />
        )}
      </div>
    </section>
  );
}

function DefaultStepDetail({
  step,
  status,
  state,
}: {
  step: PipelineStep;
  status: StepStatus | undefined;
  state: StepState;
}) {
  if (state === 'active') {
    return (
      <div className="flex items-center gap-3 text-blue-700">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">{step.activeLabel || step.description}</span>
      </div>
    );
  }

  if (state === 'failed' && status?.errorMessage) {
    return (
      <div className="flex items-start gap-3 rounded-lg bg-red-50 border border-red-200 p-4">
        <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-red-900">Step failed</p>
          <p className="text-sm text-red-700 mt-1">{status.errorMessage}</p>
        </div>
      </div>
    );
  }

  if (state === 'pending') {
    return (
      <p className="text-sm text-gray-500 italic">
        This step has not run yet. Output will appear here when the pipeline reaches it.
      </p>
    );
  }

  // Completed / gated / stale — render the activity-log details as a definition list
  const details = (status?.details || {}) as Record<string, unknown>;
  const entries = Object.entries(details).filter(([, v]) => v !== null && v !== undefined);

  if (entries.length === 0) {
    return <p className="text-sm text-gray-500 italic">No technical output recorded for this step.</p>;
  }

  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
      {entries.map(([k, v]) => (
        <div key={k} className="border-b border-gray-100 pb-2">
          <dt className="text-[11px] uppercase tracking-wide font-semibold text-gray-400">
            {k.replace(/_/g, ' ')}
          </dt>
          <dd className="text-sm text-gray-900 mt-0.5 break-words">
            {typeof v === 'object' ? <pre className="text-xs bg-gray-50 rounded p-2 overflow-auto">{JSON.stringify(v, null, 2)}</pre> : String(v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// ─── Sidebar top: status-only summary (actions moved to left pane) ───────────

function StepStatusCard({
  step,
  state,
  status,
}: {
  step: PipelineStep;
  state: StepState;
  status: StepStatus | undefined;
}) {
  const tokens = STATE_TOKENS[state];
  const label =
    state === 'gated' ? 'Awaiting your decision' :
    state === 'active' ? 'Running now' :
    state === 'complete' ? 'Completed' :
    state === 'failed' ? 'Failed' :
    state === 'stale' ? 'Superseded' :
    'Not yet started';

  return (
    <div className={`bg-white rounded-2xl border ${state === 'gated' ? 'border-amber-300' : 'border-gray-200'} shadow-sm overflow-hidden`}>
      <header className={`px-4 py-3 ${tokens.bg} border-b border-black/5`}>
        <p className="text-[10px] font-mono font-semibold text-gray-500 uppercase tracking-wider">
          Status
        </p>
        <p className={`text-sm font-semibold ${tokens.text} mt-0.5`}>{label}</p>
      </header>

      <div className="p-4 space-y-2 text-sm">
        <p className="text-gray-900 font-medium">
          Step {step.step} of {PIPELINE_STEPS.length} · {step.displayName || step.name}
        </p>
        {state === 'active' && (
          <div className="flex items-center gap-2 text-blue-700">
            <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
            <span className="text-xs">{step.activeLabel || 'Running…'}</span>
          </div>
        )}
        {state === 'gated' && (
          <p className="text-xs text-amber-700">
            Primary action is in the details pane to the left.
          </p>
        )}
        {state === 'failed' && status?.errorMessage && (
          <p className="text-xs text-red-600 break-words">{status.errorMessage}</p>
        )}
        {state === 'stale' && (
          <p className="text-xs text-gray-500 italic">
            Superseded by a later gate failure.
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Left pane: gate action bar ──────────────────────────────────────────────
// Primary + secondary buttons live here, directly under the step detail card,
// so the reviewer can scan the evidence and act without looking away.

function GateActionBar({
  step,
  gate,
  onApprove,
  onReject,
}: {
  step: number;
  gate: NonNullable<typeof GATE_QUESTIONS[number]>;
  onApprove?: WorkflowContainerProps['onApproveGate'];
  onReject?: WorkflowContainerProps['onRejectGate'];
}) {
  return (
    <div className="bg-white rounded-2xl border-2 border-amber-300 shadow-sm overflow-hidden">
      <header className="px-6 py-3 bg-amber-50 border-b border-amber-200 flex items-center gap-2">
        <Lock className="h-4 w-4 text-amber-600 flex-shrink-0" />
        <p className="text-sm font-semibold text-amber-900">Awaiting your decision</p>
      </header>

      <div className="px-6 py-4 space-y-3">
        <p className="text-sm text-gray-700 leading-relaxed">{gate.question}</p>

        {gate.kind === 'binary' ? (
          <div className="flex flex-col sm:flex-row gap-2 pt-1">
            <button
              onClick={() => onApprove?.(step)}
              disabled={!onApprove}
              className="flex-1 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors flex items-center justify-center gap-2"
            >
              <Check className="h-4 w-4" /> {gate.yesLabel}
            </button>
            <button
              onClick={() => onReject?.(step)}
              disabled={!onReject}
              className="flex-1 sm:flex-none sm:px-6 px-4 py-2.5 bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg transition-colors"
            >
              {gate.noLabel}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ─── Left pane: final consent bar (step 33) ──────────────────────────────────
// Replaces the per-step GateActionBar when the pipeline reaches step 33. Puts
// the Send / Do Not Send / Reject decision next to the quote evidence.

function FinalConsentBar({
  state,
  clientName,
  clientEmail,
  netAmountAed,
  onSend,
  onHold,
}: {
  state: StepState;
  clientName?: string | null;
  clientEmail?: string | null;
  netAmountAed: number | null;
  onSend?: () => void | Promise<void>;
  onHold?: () => void | Promise<void>;
}) {
  const VAT_RATE = 0.05;
  const grandTotal = netAmountAed != null ? netAmountAed * (1 + VAT_RATE) : null;
  const fmt = (n: number) =>
    n.toLocaleString('en-AE', { style: 'currency', currency: 'AED', maximumFractionDigits: 0 });

  const isReady = state === 'gated';

  return (
    <div className="bg-white rounded-2xl border-2 border-emerald-300 shadow-md overflow-hidden">
      <header className="px-6 py-3 bg-gradient-to-r from-emerald-50 to-emerald-100 border-b border-emerald-200">
        <p className="text-[10px] font-mono font-semibold text-emerald-700 uppercase tracking-wider">
          Final review · Gate 5 of 5
        </p>
        <h3 className="text-base font-bold text-emerald-900 mt-0.5">Send quotation to client?</h3>
      </header>

      <div className="px-6 py-4 grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
        <div>
          <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-500">Client</p>
          <p className="text-sm font-semibold text-gray-900 mt-0.5">{clientName || '—'}</p>
          {clientEmail && <p className="text-xs text-gray-500 mt-0.5 truncate">{clientEmail}</p>}
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
          <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-500">Total quote (incl. VAT)</p>
          <p className="text-2xl font-bold text-gray-900 tabular-nums mt-0.5">
            {grandTotal != null ? fmt(grandTotal) : '—'}
          </p>
          {netAmountAed != null && (
            <p className="text-[11px] text-gray-500 mt-0.5 tabular-nums">
              Net {fmt(netAmountAed)} + 5% VAT
            </p>
          )}
        </div>
      </div>

      <div className="px-6 pb-4 flex flex-col sm:flex-row gap-2">
        <button
          onClick={() => onSend?.()}
          disabled={!isReady || !onSend}
          className="flex-1 px-4 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg shadow-sm transition-colors flex items-center justify-center gap-2"
        >
          <Send className="h-4 w-4" /> Send to Client
        </button>
        <button
          onClick={() => onHold?.()}
          disabled={!isReady || !onHold}
          className="sm:w-40 px-3 py-3 bg-white hover:bg-gray-50 border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed text-gray-700 text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5"
        >
          <Clock className="h-4 w-4" /> Do Not Send
        </button>
        <button
          onClick={() => onHold?.()}
          disabled={!isReady || !onHold}
          className="sm:w-32 px-3 py-3 bg-white hover:bg-red-50 border border-red-200 disabled:opacity-50 disabled:cursor-not-allowed text-red-700 text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5"
        >
          <Ban className="h-4 w-4" /> Reject
        </button>
      </div>

      {!isReady && (
        <p className="px-6 pb-4 text-[11px] text-gray-500 italic leading-relaxed">
          Consent actions unlock once the quotation is prepared and Gate 5 is reached.
        </p>
      )}
    </div>
  );
}

// ─── Sidebar middle: clickable phase-grouped flowchart ───────────────────────

function PipelineFlowchartCard({
  stepsByNumber,
  fallbackCompleteThrough,
  currentStep,
  connected,
  onStepClick,
}: {
  stepsByNumber: Record<number, StepStatus>;
  fallbackCompleteThrough: number;
  currentStep: number;
  connected: boolean;
  onStepClick: (step: number) => void;
}) {
  const total = PIPELINE_STEPS.length;
  const completedCount = PIPELINE_STEPS.filter(s =>
    pickState(stepsByNumber[s.step], s, s.step <= fallbackCompleteThrough) === 'complete'
  ).length;
  const pct = Math.round((completedCount / total) * 100);

  const stepsByPhase = useMemo(() => {
    const groups: Record<PipelinePhase, PipelineStep[]> = {
      pre_pipeline: [],
      info_sufficiency: [],
      bid_decision: [],
      quantities: [],
      final_quote: [],
      electrical: [],
    };
    for (const s of PIPELINE_STEPS) groups[s.phase].push(s);
    return groups;
  }, []);

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      <header className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-gray-900">Pipeline</p>
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`}
            title={connected ? 'Live' : 'Snapshot'}
          />
        </div>
        <span className="text-[11px] font-mono text-gray-500">
          {completedCount}/{total}
        </span>
      </header>

      {/* Progress bar */}
      <div className="px-4 pt-3">
        <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
          <div
            className="bg-gradient-to-r from-blue-500 to-indigo-500 h-full rounded-full transition-all duration-700"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Phase-grouped clickable step list */}
      <div className="p-3 space-y-3 max-h-[calc(100vh-22rem)] overflow-y-auto">
        {PIPELINE_PHASES.map(phase => {
          const steps = stepsByPhase[phase.id];
          if (!steps || steps.length === 0) return null;
          return (
            <div key={phase.id}>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide px-1 mb-1">
                {phase.label}
              </p>
              <ul className="space-y-0.5">
                {steps.map(step => {
                  const status = stepsByNumber[step.step];
                  const state = pickState(status, step, step.step <= fallbackCompleteThrough);
                  const t = STATE_TOKENS[state];
                  const isCurrent = step.step === currentStep;
                  return (
                    <li key={step.step}>
                      <button
                        onClick={() => onStepClick(step.step)}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors ${
                          isCurrent ? `${t.bg} ring-1 ${t.ring}` : 'hover:bg-gray-50'
                        }`}
                      >
                        <span className={`flex-shrink-0 w-5 h-5 rounded-full ${t.dot} text-white flex items-center justify-center`}>
                          {state === 'complete' && <Check className="h-3 w-3" />}
                          {state === 'failed' && <AlertTriangle className="h-3 w-3" />}
                          {state === 'active' && <Loader2 className="h-3 w-3 animate-spin" />}
                          {state === 'gated' && <Lock className="h-3 w-3" />}
                          {(state === 'pending' || state === 'stale') && <Circle className="h-2 w-2 fill-current" />}
                        </span>
                        <span className={`text-[11px] font-mono ${t.text} opacity-60 w-6 flex-shrink-0`}>
                          {String(step.step).padStart(2, '0')}
                        </span>
                        <span className={`text-xs truncate flex-1 ${isCurrent ? `font-semibold ${t.text}` : 'text-gray-700'}`}>
                          {step.displayName || step.name}
                        </span>
                        {step.requiresConfirmation && (
                          <span className="flex-shrink-0 text-[9px] uppercase tracking-wide font-bold text-amber-700 bg-amber-100 px-1 py-0.5 rounded">
                            gate
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
