-- ============================================================
-- 16-APR DEMO GAP — STEP 2: Confidence Flagging
-- ============================================================
-- Row-level confidence summary on each estimation. Per-line-item
-- flags live inside the existing JSONB payload
-- (ai_extraction.line_items[].confidence_flag) — no extra column.
-- Safe to re-run.
-- ============================================================

ALTER TABLE sabi_estimations
  ADD COLUMN IF NOT EXISTS confidence_flag TEXT
  CHECK (confidence_flag IN ('verified','ai_estimated','assumed'))
  DEFAULT 'ai_estimated';

COMMENT ON COLUMN sabi_estimations.confidence_flag IS
  'Worst confidence across line items in this estimation.
   verified     = matched price library
   ai_estimated = quantity/rate derived from Claude
   assumed      = formula fallback (area x rate, default tonnage factor)';
