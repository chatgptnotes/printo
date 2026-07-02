'use client';

import { useState } from 'react';
import { Check, Circle, Lock, AlertTriangle, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import type { PipelineStep } from '@/lib/shared/types';
import type { StepState, StepStatus } from '@/hooks/use-pipeline-stream';

interface StepTileProps {
  step: PipelineStep;
  status: StepStatus | undefined;
  /** Highlight this tile as the one the user should look at next */
  isFocus?: boolean;
  /** Fallback: treat as complete because project status has advanced past it */
  fallbackComplete?: boolean;
}

function pickState(
  status: StepStatus | undefined,
  step: PipelineStep,
  fallbackComplete: boolean
): StepState {
  if (status?.state === 'failed') return 'failed';
  if (status?.state === 'stale') return 'stale';
  if (status?.state === 'complete') return 'complete';
  if (status?.state === 'active') {
    return step.requiresConfirmation ? 'gated' : 'active';
  }
  if (fallbackComplete) return 'complete';
  return 'pending';
}

function formatDuration(ms: number | undefined): string | null {
  if (!ms || ms < 0) return null;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

export default function StepTile({
  step,
  status,
  isFocus = false,
  fallbackComplete = false,
}: StepTileProps) {
  const state = pickState(status, step, fallbackComplete);
  const duration = formatDuration(status?.durationMs);
  const displayLabel = step.displayName || step.name;
  const activeLabel = step.activeLabel || step.description;
  const subSteps = Array.isArray(status?.details?.sub_steps)
    ? (status!.details!.sub_steps as Array<{ step_num: number; name: string; status: string; finding: string }>)
    : null;
  const [expanded, setExpanded] = useState(false);

  // Per-state styling
  const styles: Record<StepState, { bg: string; text: string; icon: string; border: string }> = {
    pending: {
      bg: 'bg-gray-50',
      text: 'text-gray-400',
      icon: 'bg-gray-100 text-gray-300',
      border: 'border-gray-100',
    },
    active: {
      bg: 'bg-blue-50',
      text: 'text-blue-700',
      icon: 'bg-blue-500 text-white',
      border: 'border-blue-200',
    },
    complete: {
      bg: 'bg-green-50',
      text: 'text-green-700',
      icon: 'bg-green-500 text-white',
      border: 'border-green-100',
    },
    failed: {
      bg: 'bg-red-50',
      text: 'text-red-700',
      icon: 'bg-red-500 text-white',
      border: 'border-red-200',
    },
    gated: {
      bg: 'bg-amber-50',
      text: 'text-amber-800',
      icon: 'bg-amber-400 text-white',
      border: 'border-amber-300',
    },
    stale: {
      bg: 'bg-gray-50',
      text: 'text-gray-500',
      icon: 'bg-gray-300 text-gray-500',
      border: 'border-gray-200',
    },
  };

  const s = styles[state];
  const focusRing = isFocus ? 'ring-2 ring-offset-1 ring-blue-400' : '';
  const gateRing = state === 'gated' ? 'ring-2 ring-offset-1 ring-amber-400 animate-pulse' : '';

  return (
    <div
      data-step={step.step}
      data-state={state}
      className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border transition-all duration-300 ${s.bg} ${s.border} ${focusRing} ${gateRing}`}
    >
      <div
        className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${s.icon} transition-colors duration-300`}
      >
        {state === 'complete' && <Check className="h-4 w-4" />}
        {state === 'active' && <Loader2 className="h-4 w-4 animate-spin" />}
        {state === 'failed' && <AlertTriangle className="h-4 w-4" />}
        {state === 'gated' && <Lock className="h-4 w-4" />}
        {state === 'stale' && <Check className="h-4 w-4 opacity-40" />}
        {state === 'pending' && (
          step.requiresConfirmation
            ? <Lock className="h-3.5 w-3.5" />
            : <Circle className="h-2.5 w-2.5 fill-current" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] font-mono ${s.text} opacity-50`}>
            {String(step.step).padStart(2, '0')}
          </span>
          <span className={`text-sm font-medium ${s.text}`}>
            {displayLabel}
          </span>
          {step.requiresConfirmation && (
            <span className="text-[10px] uppercase tracking-wide font-semibold text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded">
              gate
            </span>
          )}
          {duration && state === 'complete' && (
            <span className="text-[10px] text-gray-500 ml-auto font-mono">
              {duration}
            </span>
          )}
        </div>
        {state === 'active' && (
          <p className="text-xs text-blue-600 mt-0.5 truncate">
            {activeLabel}
          </p>
        )}
        {state === 'gated' && (
          <p className="text-xs text-amber-700 mt-0.5 font-medium">
            Awaiting George's approval
          </p>
        )}
        {state === 'failed' && status?.errorMessage && (
          <p className="text-xs text-red-600 mt-0.5 truncate" title={status.errorMessage}>
            {status.errorMessage}
          </p>
        )}
        {state === 'stale' && (
          <p className="text-xs text-gray-500 mt-0.5 italic">
            Superseded by upstream gate failure
          </p>
        )}
        {subSteps && subSteps.length > 0 && (
          <div className="mt-1.5">
            <button
              onClick={(e) => { e.stopPropagation(); setExpanded(v => !v); }}
              className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-700"
            >
              {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              {subSteps.length} sub-steps
            </button>
            {expanded && (
              <ul className="mt-1 space-y-0.5 pl-2 border-l border-gray-200">
                {subSteps.map((ss) => (
                  <li key={ss.step_num} className="flex items-start gap-1.5 text-[10px] text-gray-600">
                    <span className={`mt-0.5 h-1.5 w-1.5 rounded-full flex-shrink-0 ${
                      ss.status === 'done' ? 'bg-green-400' : ss.status === 'skipped' ? 'bg-gray-300' : 'bg-red-400'
                    }`} />
                    <span className="font-mono opacity-60">{String(ss.step_num).padStart(2, '0')}</span>
                    <span className="font-medium">{ss.name}</span>
                    {ss.finding && <span className="opacity-70 truncate" title={ss.finding}>— {ss.finding}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
