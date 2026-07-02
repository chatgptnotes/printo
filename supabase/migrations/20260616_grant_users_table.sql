-- ============================================================
-- Fix: "permission denied for table ..." (42501) across the app
-- ------------------------------------------------------------
-- The service_role was never granted privileges on the public
-- schema tables. The API routes use the service_role key, which
-- bypasses RLS but still needs Postgres table GRANTs. This grants
-- on every existing table AND sets default privileges so future
-- tables are covered too. Safe to re-run.
-- ============================================================

GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;

-- Ensure the admin row exists — admin@sabi.ae / sabi2024
-- (password is bcrypt cost 10 of "sabi2024")
INSERT INTO public.users (email, password, full_name)
VALUES (
  'admin@sabi.ae',
  '$2b$10$nIO0ZxvUa50mgw1QxaYsO.1tiP.hs7h6v.fl4MTQNkO8t4ZqsTRVS',
  'SABI Admin'
)
ON CONFLICT (email) DO NOTHING;
