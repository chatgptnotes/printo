-- ============================================================
-- SABI ERP Realsoft — REMAINING SETUP (minimal)
-- ============================================================
-- Only creates what's actually missing: the public.users table
-- used by the login/register/seed-admin/user API routes, and
-- the admin row. Safe to re-run.
-- ============================================================


-- 1. Create public.users (the login API hits THIS table, NOT sabi_users)
CREATE TABLE IF NOT EXISTS public.users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email VARCHAR UNIQUE NOT NULL,
  password TEXT NOT NULL,
  full_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON public.users;
CREATE POLICY "Service role full access" ON public.users
  FOR ALL USING (true) WITH CHECK (true);


-- 2. Seed admin — admin@sabi.ae / sabi2024
--    (password is bcrypt cost 10 of "sabi2024")
INSERT INTO public.users (email, password, full_name)
VALUES (
  'admin@sabi.ae',
  '$2b$10$nIO0ZxvUa50mgw1QxaYsO.1tiP.hs7h6v.fl4MTQNkO8t4ZqsTRVS',
  'SABI Admin'
)
ON CONFLICT (email) DO NOTHING;


-- 3. Verify — should return 1
SELECT COUNT(*) AS admin_rows FROM public.users WHERE email = 'admin@sabi.ae';
