-- ============================================================
-- 16-APR DEMO GAP — STEP 1: Document Sufficiency Gate
-- ============================================================
-- Adds per-project drawing inventory and a data-source marker on
-- estimations so Gate 9 can refuse to estimate HVAC without a
-- thermal load or equipment schedule drawing (or record explicit
-- fallback consent when proceeding on equipment schedule alone).
-- Safe to re-run.
-- ============================================================

ALTER TABLE sabi_projects
  ADD COLUMN IF NOT EXISTS document_inventory JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN sabi_projects.document_inventory IS
  'Per-project inventory of critical drawings. Keys (all boolean):
   has_thermal_load, has_equipment_schedule, has_electrical_single_line,
   has_plumbing_layout, has_firefighting_layout.';

ALTER TABLE sabi_estimations
  ADD COLUMN IF NOT EXISTS data_source VARCHAR DEFAULT 'primary_drawing';

COMMENT ON COLUMN sabi_estimations.data_source IS
  'How the estimation was derived. One of:
   primary_drawing | equipment_schedule_fallback | area_rate_fallback | manual_override.';
