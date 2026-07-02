-- ============================================================
-- Plan-page cable rate overrides
-- ============================================================
-- Persists the three gauge-bucket rates (AED/m) a user edits on the
-- Plan → Data screen (Heavy / Sub-Main / Final). Stored on the project's
-- electrical service row and read back by the industry-BOQ export so the
-- generated Excel's cable rows are priced from the screen's numbers.
-- Shape: { "heavy": 180, "submain": 70, "final": 22 }. NULL = use defaults.
-- Safe to re-run.
-- ============================================================

ALTER TABLE sabi_services
  ADD COLUMN IF NOT EXISTS rate_overrides JSONB;

COMMENT ON COLUMN sabi_services.rate_overrides IS
  'User-edited cable rate map (AED per metre) from the Plan page.
   Keys: heavy (>=50 mm2), submain (16-50 mm2), final (<16 mm2).
   Consumed by GET /api/projects/[id]/boq/industry to price Bill 5 cables.';
