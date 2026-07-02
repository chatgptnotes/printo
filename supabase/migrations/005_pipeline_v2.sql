-- ============================================================
-- SABI: 33-step pipeline migration (transcript-aligned plan)
-- Adds new columns + tables required by the redesigned pipeline.
-- Run this in Supabase Dashboard > SQL Editor
-- Date: 2026-04-22
-- Plan: sabi-revised-pipeline-plan.md
-- ============================================================

-- ------------------------------------------------------------
-- sabi_projects — new columns
-- ------------------------------------------------------------

-- Step 8 — Critical-Drawings Check (thermal load + equipment schedule).
ALTER TABLE sabi_projects
  ADD COLUMN IF NOT EXISTS critical_drawings_status VARCHAR DEFAULT NULL;
COMMENT ON COLUMN sabi_projects.critical_drawings_status IS
  '33-step pipeline step 8: present | missing | fallback_used';

-- Step 9 — BOQ Quality Check (is the client BOQ usable, or take off from drawings?).
ALTER TABLE sabi_projects
  ADD COLUMN IF NOT EXISTS boq_quality VARCHAR DEFAULT NULL;
COMMENT ON COLUMN sabi_projects.boq_quality IS
  '33-step pipeline step 9: reliable | partial | unusable';

-- Step 10 — Detect Drawing Scale (px-per-metre + confidence + source).
ALTER TABLE sabi_projects
  ADD COLUMN IF NOT EXISTS scale_detection JSONB DEFAULT NULL;
COMMENT ON COLUMN sabi_projects.scale_detection IS
  '33-step pipeline step 10: { detected_px_per_m, confidence (0..1), source }';

-- Gate 13 (step 13) — 3-way Bid Decision result. Replaces the overloaded
-- priority=ignore convention previously used to mark a No-Bid project.
ALTER TABLE sabi_projects
  ADD COLUMN IF NOT EXISTS bid_decision VARCHAR DEFAULT NULL;
COMMENT ON COLUMN sabi_projects.bid_decision IS
  '33-step pipeline gate 13: no_bid | quick | detailed';
CREATE INDEX IF NOT EXISTS idx_projects_bid_decision ON sabi_projects(bid_decision);

-- ------------------------------------------------------------
-- sabi_no_bid_log — terminal exit audit (replaces stuffing
-- no_bid_reason inside ai_classification jsonb).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sabi_no_bid_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES sabi_projects(id) ON DELETE CASCADE,
  reason_code VARCHAR NOT NULL DEFAULT 'unspecified',
  reason_text TEXT NOT NULL,
  decided_by VARCHAR NOT NULL,
  decided_at TIMESTAMPTZ DEFAULT NOW(),
  source VARCHAR NOT NULL DEFAULT 'human'  -- 'human' | 'auto_escalation'
);
CREATE INDEX IF NOT EXISTS idx_no_bid_log_project ON sabi_no_bid_log(project_id);
CREATE INDEX IF NOT EXISTS idx_no_bid_log_reason_code ON sabi_no_bid_log(reason_code);
CREATE INDEX IF NOT EXISTS idx_no_bid_log_source ON sabi_no_bid_log(source);

-- ------------------------------------------------------------
-- sabi_services — confidence + source columns on per-service rows.
-- (Quantity-row level confidence lives inside ai_extraction jsonb today;
-- the new top-level columns surface it for queries / Excel rendering.)
-- ------------------------------------------------------------
ALTER TABLE sabi_services
  ADD COLUMN IF NOT EXISTS confidence VARCHAR DEFAULT NULL;
COMMENT ON COLUMN sabi_services.confidence IS
  '33-step pipeline step 22: high | medium | low (yellow-flag when low)';

ALTER TABLE sabi_services
  ADD COLUMN IF NOT EXISTS pricing_source VARCHAR DEFAULT NULL;
COMMENT ON COLUMN sabi_services.pricing_source IS
  '33-step pipeline step 26: library | ai_estimate | manual';

-- ------------------------------------------------------------
-- sabi_activity_log — extend the step CHECK constraint to cover
-- the new step range (0..33). The 20260414 migration widened this
-- already, but explicitly re-asserting here is harmless.
-- ------------------------------------------------------------
DO $$
BEGIN
  -- Drop existing CHECK constraint if present, then re-add with the new range.
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'sabi_activity_log_step_check'
      AND table_name = 'sabi_activity_log'
  ) THEN
    ALTER TABLE sabi_activity_log DROP CONSTRAINT sabi_activity_log_step_check;
  END IF;
  ALTER TABLE sabi_activity_log
    ADD CONSTRAINT sabi_activity_log_step_check CHECK (step >= 0 AND step <= 33);
END $$;
