'use client';

/**
 * React hook that streams pipeline progress for a single project.
 *
 * Reads sabi_activity_log rows (via Supabase Realtime + initial fetch) and
 * returns a per-step state map suitable for the animated StepTimeline.
 *
 * Behavior:
 *   - On mount: snapshot fetch of all log rows for this project
 *   - Then: subscribe to INSERT events on sabi_activity_log for this project
 *   - Updates: one entry per step, keyed by step number
 *
 * The hook deliberately does NOT perform animations or delays — it is a pure
 * data source. StepTimeline is responsible for visual pacing.
 */

import { useEffect, useState } from 'react';
import { supabaseClient } from '@/lib/storage/supabase';
import { MAIN_GATE_STEPS } from '@/lib/shared/constants';

export type StepState = 'pending' | 'active' | 'complete' | 'failed' | 'gated' | 'stale';

export interface StepStatus {
  step: number;
  state: StepState;
  stepName?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  details?: Record<string, unknown> | null;
  errorMessage?: string;
}

interface ActivityLogRow {
  id: string;
  project_id: string;
  step: number;
  step_name: string;
  status: 'started' | 'completed' | 'failed' | 'skipped';
  details: Record<string, unknown> | null;
  created_at: string;
}

function foldRowsIntoSteps(rows: ActivityLogRow[]): Record<number, StepStatus> {
  // Rows arrive chronologically. For each step, the last status wins — but we
  // also track the first `started` timestamp so we can compute duration.
  const byStep: Record<number, StepStatus> = {};
  for (const row of rows) {
    const existing = byStep[row.step] || { step: row.step, state: 'pending' as StepState };
    existing.stepName = row.step_name;
    existing.details = row.details;

    if (row.status === 'started' && !existing.startedAt) {
      existing.startedAt = row.created_at;
      if (existing.state === 'pending') {
        existing.state = 'active';
      }
    } else if (row.status === 'completed') {
      existing.completedAt = row.created_at;
      existing.state = 'complete';
      if (existing.startedAt) {
        existing.durationMs =
          new Date(row.created_at).getTime() - new Date(existing.startedAt).getTime();
      }
    } else if (row.status === 'failed') {
      existing.state = 'failed';
      existing.errorMessage =
        (row.details?.error as string | undefined) ||
        (row.details?.message as string | undefined) ||
        'Step failed';
    }

    byStep[row.step] = existing;
  }

  // Post-pass: if an upstream gate is in `failed` state, any completed step
  // below it is no longer trustworthy. Mark it `stale` so the timeline can
  // dim it rather than paint it green. Without this, the user sees a red
  // gate followed by a run of green ticks — contradictory and misleading.
  const failedGates = MAIN_GATE_STEPS.filter(g => byStep[g]?.state === 'failed');
  if (failedGates.length > 0) {
    const earliestFailedGate = Math.min(...failedGates);
    for (const k of Object.keys(byStep)) {
      const step = Number(k);
      if (step > earliestFailedGate && byStep[step].state === 'complete') {
        byStep[step].state = 'stale';
      }
    }
  }

  return byStep;
}

export function usePipelineStream(
  projectId: string | null,
  seedRows?: ActivityLogRow[]
) {
  const [rows, setRows] = useState<ActivityLogRow[]>(seedRows || []);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // When the caller provides fresh server-fetched rows (e.g. after fetchProject),
  // merge them in so the timeline reflects the latest state without waiting for
  // Realtime or a full page reload.
  useEffect(() => {
    if (!seedRows || seedRows.length === 0) return;
    setRows((prev) => {
      const merged = [...seedRows];
      for (const r of prev) {
        if (!merged.some((m) => m.id === r.id)) merged.push(r);
      }
      return merged.sort((a, b) => a.created_at.localeCompare(b.created_at));
    });
  }, [seedRows]);

  useEffect(() => {
    if (!projectId) return;

    let cancelled = false;

    (async () => {
      const { data, error: fetchErr } = await supabaseClient
        .from('sabi_activity_log')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true });

      if (cancelled) return;

      if (fetchErr) {
        setError(fetchErr.message);
        return;
      }

      // Merge anon-client rows with any seed rows already in state
      setRows((prev) => {
        const fetched = (data as ActivityLogRow[]) || [];
        if (fetched.length === 0) return prev;
        const merged = [...fetched];
        for (const r of prev) {
          if (!merged.some((m) => m.id === r.id)) merged.push(r);
        }
        return merged.sort((a, b) => a.created_at.localeCompare(b.created_at));
      });
    })();

    // Realtime subscription. Cleanup happens exactly once, in the React effect
    // teardown, to avoid a known issue in @supabase/realtime-js@2.104 where
    // calling removeChannel() during the subscribe callback (on CHANNEL_ERROR
    // / TIMED_OUT / CLOSED) hits a circular getter (RealtimeChannel.rejoinTimer
    // → ChannelAdapter.rejoinTimer → channel.rejoinTimer) and throws
    // "RangeError: Maximum call stack size exceeded" as an unhandled promise
    // rejection. We only flip `connected` here; the SDK's own reconnection
    // logic will recover, and initial snapshot data keeps the UI usable if it
    // doesn't. The 60s poll in the bid detail page is the fallback for
    // environments without Realtime.
    let channel: ReturnType<typeof supabaseClient.channel> | null = null;
    try {
      channel = supabaseClient
        .channel(`pipeline:${projectId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'sabi_activity_log',
            filter: `project_id=eq.${projectId}`,
          },
          (payload) => {
            const row = payload.new as ActivityLogRow;
            setRows((prev) => {
              if (prev.some((r) => r.id === row.id)) return prev;
              return [...prev, row].sort((a, b) =>
                a.created_at.localeCompare(b.created_at)
              );
            });
          }
        )
        .subscribe((status) => {
          setConnected(status === 'SUBSCRIBED');
        });
    } catch {
      // Realtime not available in this environment — initial snapshot is enough.
    }

    return () => {
      cancelled = true;
      if (channel) {
        const ch = channel;
        channel = null;
        try {
          // removeChannel returns a Promise; swallow any async rejection so
          // the known SDK stack-overflow doesn't surface as Uncaught (in promise).
          const result = supabaseClient.removeChannel(ch);
          if (result && typeof (result as Promise<unknown>).catch === 'function') {
            (result as Promise<unknown>).catch(() => { /* noop */ });
          }
        } catch { /* noop */ }
      }
    };
  }, [projectId]);

  const stepsByNumber = foldRowsIntoSteps(rows);

  return { stepsByNumber, connected, error };
}
