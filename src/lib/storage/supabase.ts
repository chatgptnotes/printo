import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Lazy-initialize clients to avoid build-time errors on Vercel
let _supabaseClient: SupabaseClient | null = null;
let _supabaseAdmin: SupabaseClient | null = null;

export const supabaseClient = new Proxy({} as SupabaseClient, {
  get(_, prop) {
    if (!_supabaseClient) {
      _supabaseClient = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          realtime: {
            // When the network drops mid-scan, the browser prints one native
            // "WebSocket ... failed" line per reconnect attempt — these cannot
            // be suppressed by app code. The default backoff retries every
            // 1-10s, flooding the console with hundreds of identical lines for
            // a single short outage. Slow it down and cap at 30s so one outage
            // produces a handful of lines, not a wall. Recovery still happens.
            reconnectAfterMs: (tries: number) =>
              Math.min(1000 * 2 ** tries, 30000),
          },
        }
      );
    }
    return (_supabaseClient as any)[prop];
  },
});

export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_, prop) {
    if (!_supabaseAdmin) {
      _supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
      );
    }
    return (_supabaseAdmin as any)[prop];
  },
});
