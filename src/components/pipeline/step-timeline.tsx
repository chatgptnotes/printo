'use client';

/**
 * Animated MAIN pipeline timeline.
 *
 * Renders the 15-step email→quote workflow (4 phases · 5 gates) as defined in
 * MAIN_PIPELINE_STEPS. The 14-step electrical sub-pipeline (cable-schedule
 * procedure that runs inside MAIN step 11 on the Detailed path) is visible
 * through the activity log; an inline expansion of step 11 will land in a
 * follow-up PR.
 *
 * Subscribes to sabi_activity_log via Supabase Realtime and renders a live
 * view of each step as the AI works through the pipeline. Gates pause the
 * flow; auto-steps complete silently and fly past.
 *
 * Usage:
 *   <StepTimeline projectId={id} currentStatus={project.status} />
 */

import { useEffect, useMemo, useRef } from 'react';
import {
  MAIN_PIPELINE_STEPS,
  MAIN_PIPELINE_PHASES,
  getCurrentStep,
} from '@/lib/shared/constants';
import type { PipelinePhase } from '@/lib/shared/types';
import { usePipelineStream } from '@/hooks/use-pipeline-stream';
import StepTile from '@/components/ui/step-tile';

interface StepTimelineProps {
  projectId: string;
  /** Current project status (from sabi_projects.status) */
  currentStatus?: string;
  /** Server-fetched activity log rows — used as seed to avoid RLS-blocked client reads */
  activityLog?: Array<{ id: string; project_id: string; step: number; step_name: string; status: string; details: Record<string, unknown> | null; created_at: string }>;
}

export default function StepTimeline({ projectId, currentStatus, activityLog }: StepTimelineProps) {
  const { stepsByNumber, connected, error } = usePipelineStream(projectId, activityLog as any);

  // Fallback: steps the project status has already advanced past, in MAIN-
  // pipeline coordinates. getCurrentStep resolves a status to {pipeline, step}
  // — for electrical-sub statuses (e.g. pricing_pending) this returns step 14
  // of the sub-pipeline, which we map onto MAIN step 11 ("Run Pricing") since
  // the sub-pipeline lives inside that MAIN step.
  const fallbackCompleteThrough = useMemo(() => {
    if (!currentStatus) return 0;
    const resolved = getCurrentStep(currentStatus);
    return resolved.pipeline === 'main' ? resolved.step : 11;
  }, [currentStatus]);

  // The "focus" step is the active or gated step, whichever is latest.
  const focusStep = useMemo(() => {
    const entries = Object.values(stepsByNumber);
    const active = entries.filter((s) => s.state === 'active' || s.state === 'gated');
    if (active.length > 0) {
      return Math.max(...active.map((s) => s.step));
    }
    const completed = entries.filter((s) => s.state === 'complete');
    if (completed.length > 0) {
      return Math.max(...completed.map((s) => s.step));
    }
    return fallbackCompleteThrough || 1;
  }, [stepsByNumber, fallbackCompleteThrough]);

  // Auto-scroll the focus step into view when it changes.
  const focusRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusRef.current) {
      focusRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [focusStep]);

  // Progress stats
  const total = MAIN_PIPELINE_STEPS.length;
  const completedCount = Object.values(stepsByNumber).filter(
    (s) => s.state === 'complete'
  ).length;
  const effectiveCompleted = Math.max(completedCount, fallbackCompleteThrough);
  const pct = Math.round((effectiveCompleted / total) * 100);

  // Group steps by phase. MAIN_PIPELINE_PHASES are: info_sufficiency,
  // bid_decision, quantities, final_quote.
  const stepsByPhase = useMemo(() => {
    const groups: Record<PipelinePhase, typeof MAIN_PIPELINE_STEPS> = {
      pre_pipeline: [],
      info_sufficiency: [],
      bid_decision: [],
      quantities: [],
      final_quote: [],
      electrical: [],
    };
    for (const s of MAIN_PIPELINE_STEPS) {
      groups[s.phase].push(s);
    }
    return groups;
  }, []);

  return (
    <div className="w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-900">Live Pipeline</h3>
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              connected ? 'bg-green-500 animate-pulse' : 'bg-gray-300'
            }`}
            title={connected ? 'Streaming live' : 'Offline / snapshot only'}
          />
        </div>
        <span className="text-xs font-medium text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full">
          Step {focusStep} of {total}
        </span>
      </div>

      {error && (
        <p className="text-xs text-red-600 mb-2">Stream error: {error}</p>
      )}

      {/* Progress bar */}
      <div className="w-full bg-gray-100 rounded-full h-2 mb-4 overflow-hidden">
        <div
          className="bg-gradient-to-r from-blue-500 to-indigo-500 h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Phase groups */}
      <div className="space-y-4">
        {MAIN_PIPELINE_PHASES.map((phase) => {
          const steps = stepsByPhase[phase.id];
          if (!steps || steps.length === 0) return null;

          const phaseCompleted = steps.filter((s) => {
            const st = stepsByNumber[s.step];
            return st?.state === 'complete' || s.step <= fallbackCompleteThrough;
          }).length;

          return (
            <div key={phase.id}>
              <div className="flex items-center justify-between mb-2 px-1">
                <h4 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                  {phase.label}
                </h4>
                <span className="text-[10px] text-gray-400 font-mono">
                  {phaseCompleted}/{steps.length}
                </span>
              </div>
              <div className="space-y-1.5">
                {steps.map((step) => {
                  const isFocus = step.step === focusStep;
                  const tile = (
                    <StepTile
                      step={step}
                      status={stepsByNumber[step.step]}
                      isFocus={isFocus}
                      fallbackComplete={step.step < fallbackCompleteThrough}
                    />
                  );
                  return isFocus ? (
                    <div key={step.step} ref={focusRef}>
                      {tile}
                    </div>
                  ) : (
                    <div key={step.step}>{tile}</div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
