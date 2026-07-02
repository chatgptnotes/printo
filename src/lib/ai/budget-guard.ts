/**
 * Daily AI cost cap + global kill switch.
 *
 * Reads token-usage rows that `logTokenUsage` (api-alert.ts) already writes
 * to `sabi_activity_log` with step_name='Claude Token Usage' and
 * details.est_cost_usd. Sums today's usage; refuses new AI calls when over budget.
 *
 * Env vars:
 *   AI_DISABLED         — 'true' to globally short-circuit all AI calls
 *   MAX_DAILY_AI_USD    — number, defaults to 10. Set to 0 to disable cap.
 *   MAX_PROJECT_AI_USD  — number, defaults to 3. Per-project hard cap.
 *
 * Cached for 60 seconds in-process to avoid hammering Supabase on every
 * AI call. Cap-exceeded errors are throwable so callers fall back to the
 * library path automatically.
 */

import { supabaseAdmin } from '@/lib/storage/supabase';
import { currentProjectId } from '@/lib/notifications/api-alert';

export class AiBudgetExceededError extends Error {
  constructor(public scope: 'global' | 'project' | 'killswitch', public spentUsd: number, public capUsd: number) {
    super(
      scope === 'killswitch'
        ? 'AI globally disabled (AI_DISABLED=true). Library path only.'
        : `${scope} AI budget exceeded: spent $${spentUsd.toFixed(2)} of $${capUsd.toFixed(2)} cap. Falling back to library path.`,
    );
    this.name = 'AiBudgetExceededError';
  }
}

interface CachedSpend {
  globalUsd: number;
  perProjectUsd: Map<string, number>;
  fetchedAt: number;
}

let cache: CachedSpend | null = null;
const CACHE_TTL_MS = 60_000;

function startOfTodayIso(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

async function refreshSpend(): Promise<CachedSpend> {
  // Single query covers both global and per-project sums. step=0 + step_name
  // 'Claude Token Usage' is the convention from api-alert.ts logTokenUsage.
  const { data, error } = await supabaseAdmin
    .from('sabi_activity_log')
    .select('project_id, details')
    .eq('step', 0)
    .eq('step_name', 'Claude Token Usage')
    .gte('created_at', startOfTodayIso());

  const fresh: CachedSpend = {
    globalUsd: 0,
    perProjectUsd: new Map(),
    fetchedAt: Date.now(),
  };

  if (error) {
    console.warn('[budget-guard] refresh failed, allowing AI calls:', error.message);
    return fresh;
  }

  for (const row of data || []) {
    const cost = Number((row.details as { est_cost_usd?: number } | null)?.est_cost_usd ?? 0);
    if (!cost) continue;
    fresh.globalUsd += cost;
    if (row.project_id) {
      fresh.perProjectUsd.set(row.project_id, (fresh.perProjectUsd.get(row.project_id) ?? 0) + cost);
    }
  }

  cache = fresh;
  return fresh;
}

async function getSpend(): Promise<CachedSpend> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache;
  return refreshSpend();
}

/**
 * Throws AiBudgetExceededError if today's spend has exceeded the configured
 * caps OR if AI_DISABLED is set. Call from inside `callClaude`.
 */
export async function assertAiBudget(): Promise<void> {
  if (process.env.AI_DISABLED === 'true') {
    throw new AiBudgetExceededError('killswitch', 0, 0);
  }

  const globalCap = Number(process.env.MAX_DAILY_AI_USD ?? '10');
  const projectCap = Number(process.env.MAX_PROJECT_AI_USD ?? '3');

  if (globalCap === 0 && projectCap === 0) return; // both disabled

  const spend = await getSpend();

  if (globalCap > 0 && spend.globalUsd >= globalCap) {
    throw new AiBudgetExceededError('global', spend.globalUsd, globalCap);
  }

  if (projectCap > 0) {
    const projectId = currentProjectId();
    if (projectId) {
      const used = spend.perProjectUsd.get(projectId) ?? 0;
      if (used >= projectCap) {
        throw new AiBudgetExceededError('project', used, projectCap);
      }
    }
  }
}

/**
 * Non-throwing variant for the UI / dashboard.
 */
export async function getAiBudgetStatus(): Promise<{
  enabled: boolean;
  globalUsd: number;
  globalCapUsd: number;
  projectUsd: number | null;
  projectCapUsd: number;
}> {
  const enabled = process.env.AI_DISABLED !== 'true';
  const globalCap = Number(process.env.MAX_DAILY_AI_USD ?? '10');
  const projectCap = Number(process.env.MAX_PROJECT_AI_USD ?? '3');
  const spend = await getSpend();
  const projectId = currentProjectId();
  return {
    enabled,
    globalUsd: spend.globalUsd,
    globalCapUsd: globalCap,
    projectUsd: projectId ? (spend.perProjectUsd.get(projectId) ?? 0) : null,
    projectCapUsd: projectCap,
  };
}

/**
 * Manually invalidate the cache after a known big spend (e.g. a successful
 * `analyzeElectricalProcedure` returns) so the next budget check sees the
 * new total without waiting for the 60 s TTL.
 */
export function invalidateBudgetCache(): void {
  cache = null;
}
