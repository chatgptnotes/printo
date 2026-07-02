/**
 * Throttled WhatsApp alert helper for AI API disruption.
 *
 * Wired into the Claude SDK wrapper (src/lib/ai/claude-api.ts) so that any
 * 401 / 429 / 529 / 5xx response from Anthropic fires a WhatsApp message to
 * WHATSAPP_NOTIFY_NUMBER via the existing OpenClaw CLI. Throttled to one
 * alert per error-kind per hour to prevent spam during sustained outages.
 *
 * Project context flows via AsyncLocalStorage so the alert + token-usage rows
 * can be attributed to the right project_id without threading a parameter
 * through every public function in claude-api.ts.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { exec } from 'child_process';
import { supabaseAdmin } from '@/lib/storage/supabase';

interface ProjectContext { projectId: string }

const projectContext = new AsyncLocalStorage<ProjectContext>();

export function withProjectContext<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  return projectContext.run({ projectId }, fn);
}

export function currentProjectId(): string | undefined {
  return projectContext.getStore()?.projectId;
}

export type AlertKind = 'claude_401' | 'claude_429' | 'claude_529' | 'claude_5xx' | 'gateway_timeout' | 'cost_drift' | 'cohort_drift' | 'scan_failed' | 'scan_slow';

const THROTTLE_MS = 60 * 60 * 1000; // 1 alert per kind per hour
const lastAlertAt = new Map<AlertKind, number>();

export async function sendApiAlert(kind: AlertKind, message: string): Promise<void> {
  const now = Date.now();
  const last = lastAlertAt.get(kind) ?? 0;
  if (now - last < THROTTLE_MS) return;
  lastAlertAt.set(kind, now);

  console.warn(`[api-alert] ${kind}: ${message}`);

  const projectId = currentProjectId();
  if (projectId) {
    try {
      await supabaseAdmin.from('sabi_activity_log').insert({
        project_id: projectId, step: 0, step_name: 'API Alert',
        status: 'failed', details: { kind, message },
      });
    } catch (e) {
      console.error('[api-alert] activity log insert failed:', e);
    }
  }

  const to = process.env.WHATSAPP_NOTIFY_NUMBER;
  if (!to) return;
  const cmd = `openclaw message send --channel whatsapp --target "${to}" --message "${message.replace(/"/g, '\\"')}"`;
  exec(cmd, (err) => { if (err) console.error('[api-alert] whatsapp send failed:', err.message); });
}

// Sonnet 4.6: $3/Mtok input · $15/Mtok output. Haiku 4.5: $1/Mtok in · $5/Mtok out.
// `extra` carries prompt_version SHA + any future per-call metadata so a future
// A/B test can correlate token usage with prompt-string changes (Phase 12).
export async function logTokenUsage(
  model: string,
  inputTokens: number,
  outputTokens: number,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const isHaiku = model.includes('haiku');
  const inRate = isHaiku ? 1 : 3;
  const outRate = isHaiku ? 5 : 15;
  const costUsd = (inputTokens * inRate + outputTokens * outRate) / 1_000_000;

  console.log(`[claude-cost] model=${model} in=${inputTokens} out=${outputTokens} usd=${costUsd.toFixed(4)}${extra.prompt_version ? ` v=${extra.prompt_version}` : ''}`);

  const projectId = currentProjectId();
  if (!projectId) return;
  try {
    await supabaseAdmin.from('sabi_activity_log').insert({
      project_id: projectId, step: 0, step_name: 'Claude Token Usage',
      status: 'completed',
      details: { model, input_tokens: inputTokens, output_tokens: outputTokens, est_cost_usd: costUsd, ...extra },
    });
  } catch (e) {
    console.error('[claude-cost] activity log insert failed:', e);
  }
}

/**
 * Log a heuristic-induced AI-call avoidance to sabi_activity_log so the
 * /api/admin/cost-stats telemetry can attribute savings to specific heuristics
 * (NB classifier, spec-analyzer, pre-pass, formula override, etc.).
 *
 * `estSavingsUsd` is the USD that would otherwise have gone to the AI call
 * we skipped — Sonnet vision ≈ $0.20–0.50 per drawing, Haiku classify
 * ≈ $0.001 per email.
 */
export async function logHeuristicSaving(kind: string, estSavingsUsd: number, details: Record<string, unknown> = {}): Promise<void> {
  const projectId = currentProjectId();
  if (!projectId) return;
  try {
    await supabaseAdmin.from('sabi_activity_log').insert({
      project_id: projectId, step: 0, step_name: 'Heuristic Saving',
      status: 'completed',
      details: { kind, est_savings_usd: estSavingsUsd, ...details },
    });
  } catch (e) {
    console.error('[heuristic-saving] activity log insert failed:', e);
  }
}

export function classifyAndAlertClaudeError(err: unknown): void {
  const e = err as { status?: number; response?: { status?: number }; message?: string; taskID?: string };
  const status = e?.status ?? e?.response?.status ?? 0;
  const msg = e?.message ?? 'unknown';
  // Gateway path tags errors with the taskID so the alert is actionable
  // (operator can grep AI-aas logs by taskID to triage).
  const tag = e?.taskID ? ` [${e.taskID}]` : '';
  if (status === 401) {
    void sendApiAlert('claude_401', `🔑 ERP Realsoft: Claude API key invalid or out of credits${tag}. Top up at console.anthropic.com/billing, then retry.`);
  } else if (status === 408 || status === 504) {
    // Gateway / CLI timeout — same operational severity as 529 (Claude
    // unavailable). Surfaces only after the gateway client exhausts its
    // 4-attempt retry, so this is a real outage signal not a transient blip.
    void sendApiAlert('gateway_timeout', `⏰ ERP Realsoft: AI gateway timed out (${status})${tag}. CLI hit the 120s cap or upstream slow. Retrying.`);
  } else if (status === 429) {
    void sendApiAlert('claude_429', `⏱ ERP Realsoft: Claude rate limit hit (429)${tag}. Pipeline paused — wait a few minutes and retry.`);
  } else if (status === 529) {
    void sendApiAlert('claude_529', `⚠️ ERP Realsoft: Claude overloaded (529)${tag}. Anthropic-side issue, retry in a few minutes.`);
  } else if (status >= 500) {
    void sendApiAlert('claude_5xx', `🚨 ERP Realsoft: Claude server error (${status})${tag}: ${msg}`);
  }
}
