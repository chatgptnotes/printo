-- ============================================================
-- sabi_corrections — captures every human-vs-AI value disagreement
-- so the heuristic layer can learn from past overrides.
--
-- Why a separate table: keeping this in sabi_projects.notes JSONB
-- makes querying "all rate overrides for office buildings" hard.
-- A first-class table lets future trainers filter by field_path,
-- service_type, building_type, etc.
-- ============================================================

CREATE TABLE IF NOT EXISTS sabi_corrections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID REFERENCES sabi_projects(id) ON DELETE CASCADE,
  field_path TEXT NOT NULL,           -- e.g. 'service.electrical.unit_rate_aed'
  ai_value JSONB,                     -- what the model said
  human_value JSONB NOT NULL,         -- the corrected value
  ai_provider TEXT,                   -- 'claude-sonnet-4-6', 'naive-bayes', 'heuristic', etc.
  procedure_version TEXT,             -- 'spec-v2-heuristic', 'extract-v1', etc.
  metadata JSONB DEFAULT '{}'::jsonb, -- service_type, building_type, floors — for cohort filtering
  created_by TEXT,                    -- user who made the correction
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_corrections_project ON sabi_corrections(project_id);
CREATE INDEX IF NOT EXISTS idx_corrections_field ON sabi_corrections(field_path);
CREATE INDEX IF NOT EXISTS idx_corrections_created ON sabi_corrections(created_at DESC);

ALTER TABLE sabi_corrections ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role full access" ON sabi_corrections;
END $$;

CREATE POLICY "Service role full access" ON sabi_corrections FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE sabi_corrections IS 'Human-vs-AI disagreements; future heuristic layers can train on this table to reduce AI calls.';
COMMENT ON COLUMN sabi_corrections.field_path IS 'Dotted path identifying what was corrected, e.g. service.electrical.unit_rate_aed';
COMMENT ON COLUMN sabi_corrections.metadata IS 'Cohort fields (service_type, building_type, floors) so filters can pull comparable corrections.';
