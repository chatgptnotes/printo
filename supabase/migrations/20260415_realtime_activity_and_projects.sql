-- Enable Supabase Realtime for the two tables the UI subscribes to:
--   * sabi_activity_log — powers the live StepTimeline on the bid detail page
--   * sabi_projects     — powers the live bid list (new RFQs pop in automatically)
--
-- Without these, the client-side supabase.channel().on('postgres_changes', …)
-- subscriptions silently receive no events, and the UI only updates on
-- manual refresh or the 60s polling fallback.

ALTER TABLE sabi_activity_log REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE sabi_activity_log;

ALTER TABLE sabi_projects REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE sabi_projects;
