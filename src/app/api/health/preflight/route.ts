/**
 * GET /api/health/preflight
 *
 * One-shot pre-flight check. Reports which API keys / integrations are wired
 * so the operator can confirm Auto-Run-to-BOQ will work before clicking it.
 *
 * Response shape:
 *   {
 *     ok: boolean,                    // true only when all 3 core keys are set
 *     checks: { ... },                // per-key boolean status
 *     advisories: string[],           // human-readable next steps for missing keys
 *   }
 *
 * Does NOT make a live API call to Anthropic (would waste tokens).
 * Pass ?live=1 in a future enhancement to ping the providers.
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const useGateway = process.env.USE_AI_GATEWAY === 'true';
  const checks = {
    anthropic_key: !!process.env.ANTHROPIC_API_KEY,
    gateway: !!process.env.NEXAPROC_GATEWAY_URL && !!process.env.DRAWTOBOQ_AIAS_KEY,
    supabase: !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    whatsapp_target: !!process.env.WHATSAPP_NOTIFY_NUMBER,
    internal_api_secret: !!process.env.INTERNAL_API_SECRET,
    use_ai_gateway: useGateway,
  };

  // Under USE_AI_GATEWAY, the gateway env vars replace ANTHROPIC_API_KEY for
  // the rollup. Direct SDK path still requires ANTHROPIC_API_KEY.
  const claudeReady = useGateway ? checks.gateway : checks.anthropic_key;
  const ok = claudeReady && checks.supabase;

  const advisories = [
    useGateway && !checks.gateway && 'Set NEXAPROC_GATEWAY_URL + DRAWTOBOQ_AIAS_KEY — USE_AI_GATEWAY=true requires both',
    !useGateway && !checks.anthropic_key && 'Set ANTHROPIC_API_KEY — /estimate and /extract fail without it (Claude Sonnet 4.6 powers all AI calls)',
    !checks.supabase      && 'Set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY — DB and BOQ PDF storage',
    !checks.whatsapp_target && 'Set WHATSAPP_NOTIFY_NUMBER to receive Claude API disruption alerts (401 / 429 / 529 / 5xx / gateway timeout)',
    !checks.internal_api_secret && 'Recommended in production: set INTERNAL_API_SECRET so /bid-decision can call /estimate even after the user JWT expires',
  ].filter(Boolean) as string[];

  return NextResponse.json({
    ok,
    checks,
    advisories,
    cost_summary: {
      per_auto_run_usd: '0.31 to 1.05',
      monthly_at_10_per_day_usd: '~225',
      sources: [
        'Claude Sonnet 4.6: $3 in / $15 out per Mtok',
        'Claude Haiku 4.5: $1 in / $5 out per Mtok',
      ],
    },
  });
}
