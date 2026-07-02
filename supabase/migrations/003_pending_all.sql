-- ============================================================
-- SABI: All Pending Migrations (consolidated)
-- Run this in Supabase Dashboard > SQL Editor
-- Date: 2026-04-06
-- ============================================================

-- 1. Approval gate (from 002, re-included as IF NOT EXISTS)
ALTER TABLE sabi_projects ADD COLUMN IF NOT EXISTS approval_gate INTEGER DEFAULT NULL;
COMMENT ON COLUMN sabi_projects.approval_gate IS 'Pipeline step number currently awaiting human approval. NULL when no gate is active.';

-- 2. Attachment discipline column
ALTER TABLE sabi_attachments ADD COLUMN IF NOT EXISTS discipline VARCHAR DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_attachments_discipline ON sabi_attachments(discipline);

-- 3. Project reputation class
ALTER TABLE sabi_projects ADD COLUMN IF NOT EXISTS reputation_class VARCHAR DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_projects_reputation ON sabi_projects(reputation_class);

-- 4. Price library table
CREATE TABLE IF NOT EXISTS sabi_price_library (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  discipline VARCHAR NOT NULL,
  category VARCHAR NOT NULL,
  item_name VARCHAR NOT NULL,
  description TEXT,
  unit VARCHAR NOT NULL DEFAULT 'piece',
  unit_rate_aed DECIMAL(12,2) NOT NULL DEFAULT 0,
  brand VARCHAR,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_price_library_discipline ON sabi_price_library(discipline);
CREATE INDEX IF NOT EXISTS idx_price_library_category ON sabi_price_library(discipline, category);

-- 5. Settings table (for RFQ keywords etc.)
CREATE TABLE IF NOT EXISTS sabi_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  key VARCHAR UNIQUE NOT NULL,
  value JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
