-- ============================================================
-- Reconcile the Supabase Realtime publication for all client
-- subscriptions. Adds sabi_emails (inbox page) and defensively
-- re-adds sabi_activity_log + sabi_projects in case the earlier
-- 20260415_realtime_activity_and_projects.sql migration was not
-- applied to a given environment.
-- ============================================================
--
-- Symptom before fix: the browser DevTools console fills with
-- repeated WebSocket/CHANNEL_ERROR entries every few seconds
-- because one or more of the three subscribed tables isn't in
-- the supabase_realtime publication. The bid detail page (via
-- lib/use-pipeline-stream.ts), bid list page (app/bids/page.tsx)
-- and inbox page (app/inbox/page.tsx) all thrash reconnecting.
--
-- Fix: idempotently ensure every table the client subscribes to
-- is in the publication. ALTER PUBLICATION ADD TABLE throws if
-- the table is already a member, so each add is wrapped in a
-- DO block that catches duplicate_object and continues — this
-- lets the migration be re-run safely against any environment.

-- sabi_emails — powers inbox auto-refresh when Gmail sync inserts new rows
ALTER TABLE sabi_emails REPLICA IDENTITY FULL;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE sabi_emails;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- sabi_activity_log — powers the live StepTimeline on the bid detail page
ALTER TABLE sabi_activity_log REPLICA IDENTITY FULL;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE sabi_activity_log;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- sabi_projects — powers the live bid list (new RFQs pop in automatically)
ALTER TABLE sabi_projects REPLICA IDENTITY FULL;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE sabi_projects;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
