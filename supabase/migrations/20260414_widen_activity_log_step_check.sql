-- ============================================================
-- Widen sabi_activity_log.step CHECK constraint to allow 1..23
-- ============================================================
-- Background: the live DB has a constraint named
-- `sabi_activity_log_step_check` that restricts step to 1..9, left
-- over from an earlier collapsed pipeline. The current 23-step
-- workflow (CLAUDE.md) logs steps 1..23, so the constraint rejects
-- every estimation step (10..16) and every phase-4 step (18..23).
--
-- Symptom: "new row for relation sabi_activity_log violates check
-- constraint sabi_activity_log_step_check" in the dev server log
-- every time a project reaches HVAC estimation.
--
-- Fix: drop the old constraint and replace it with 1..23.

ALTER TABLE sabi_activity_log
  DROP CONSTRAINT IF EXISTS sabi_activity_log_step_check;

ALTER TABLE sabi_activity_log
  ADD CONSTRAINT sabi_activity_log_step_check
  CHECK (step >= 1 AND step <= 23);
