-- ============================================================
-- SABI: MAIN + SUB pipeline architecture
-- Adds the discriminator column that lets one activity_log table hold
-- both MAIN-pipeline rows (15-step email-to-quotation) and SUB-pipeline
-- rows (currently the 14-step electrical cable-schedule procedure).
--
-- Plan: ~/.claude/plans/jaunty-bouncing-kay.md  (PR1)
-- Date: 2026-04-26
-- ============================================================

-- ------------------------------------------------------------
-- 1. New column on sabi_activity_log
-- ------------------------------------------------------------
-- NULL = MAIN-pipeline row.
-- Non-null = sub-pipeline name (today only 'electrical' exists).
ALTER TABLE sabi_activity_log
  ADD COLUMN IF NOT EXISTS sub_pipeline TEXT NULL;

COMMENT ON COLUMN sabi_activity_log.sub_pipeline IS
  'Sub-pipeline discriminator. NULL = MAIN pipeline row. Non-null names the sub-pipeline (e.g. ''electrical''). Introduced 2026-04-26 alongside MAIN_PIPELINE_STEPS.';

-- Lightweight index for "show me everything in pipeline X for project Y" reads
-- from the bid detail page.
CREATE INDEX IF NOT EXISTS idx_activity_log_pipeline
  ON sabi_activity_log(project_id, sub_pipeline, step);

-- ------------------------------------------------------------
-- 2. One-time backfill
-- ------------------------------------------------------------
-- Every activity row that exists today belongs to the electrical procedure
-- (steps 1..14 of the legacy single-pipeline definition). Backfill so the
-- new readers can distinguish historical rows.
--
-- Idempotent: only updates rows where sub_pipeline IS NULL AND step is in
-- the electrical range, so re-running the migration is a no-op.
UPDATE sabi_activity_log
   SET sub_pipeline = 'electrical'
 WHERE sub_pipeline IS NULL
   AND step BETWEEN 1 AND 14;
