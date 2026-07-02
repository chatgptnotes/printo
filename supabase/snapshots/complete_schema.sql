-- ============================================================
-- SABI ERP Realsoft — Complete Database Schema
-- Run in Supabase Dashboard > SQL Editor
-- Date: 2026-04-07
-- ============================================================
-- This file contains ALL SQL needed for production deployment.
-- Safe to run multiple times (uses IF NOT EXISTS throughout).
-- ============================================================


-- ============================================================
-- 1. CORE TABLES (6 base tables)
-- ============================================================

-- 1a. Projects — main bid list with status tracking
CREATE TABLE IF NOT EXISTS sabi_projects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email_thread_id TEXT,
  email_message_id TEXT,
  email_from TEXT NOT NULL,
  email_subject TEXT NOT NULL,
  email_date TIMESTAMPTZ,
  email_snippet TEXT,
  client_name TEXT,
  project_name TEXT,
  location TEXT,
  priority VARCHAR NOT NULL DEFAULT 'new',          -- priority_top, priority_gen, new, ignore
  status VARCHAR NOT NULL DEFAULT 'new',            -- new → classified → extracted → estimated → sent
  floors INTEGER,
  parking_floors INTEGER,
  typical_floors INTEGER,
  area_per_floor_sqft DECIMAL(12,2),
  total_area_sqft DECIMAL(12,2),
  typical_height_m DECIMAL(6,2),
  building_type VARCHAR,                            -- office, residential, villa, hotel, warehouse, hospital, retail
  deadline TIMESTAMPTZ,
  reputation_class VARCHAR DEFAULT NULL,            -- tier_a, tier_b, tier_c, unknown
  notes TEXT,
  ai_classification JSONB,
  ai_extraction JSONB,
  final_quote_aed DECIMAL(14,2),
  approval_gate INTEGER DEFAULT NULL,               -- pipeline step awaiting human approval
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1b. Attachments — email attachment catalog
CREATE TABLE IF NOT EXISTS sabi_attachments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES sabi_projects(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  attachment_id TEXT,                                -- Gmail attachment ID
  message_id TEXT,                                   -- Gmail message ID
  file_type VARCHAR,                                 -- drawing_autocad, drawing_pdf, schedule_excel, specification, archive_zip, image, other
  discipline VARCHAR DEFAULT NULL,                   -- hvac, electrical, plumbing, fire_fighting, fire_alarm, bms
  extracted_data JSONB,                              -- AI-extracted content, text, metadata
  storage_path TEXT,                                 -- Supabase Storage path
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1c. Services — MEP services per project
CREATE TABLE IF NOT EXISTS sabi_services (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES sabi_projects(id) ON DELETE CASCADE,
  service_type VARCHAR NOT NULL,                     -- hvac, electrical, plumbing, fire_fighting, fire_alarm, bms, lpg, drainage
  is_required BOOLEAN DEFAULT TRUE,
  system_type TEXT,                                  -- VRF System, Chiller System, DX Split Unit, Package Unit, District Cooling
  total_kw DECIMAL(10,2),
  fahu_kw DECIMAL(10,2),
  ac_unit_kw DECIMAL(10,2),
  tonnage DECIMAL(10,2),
  unit_rate_aed DECIMAL(10,2),
  quantity INTEGER DEFAULT 1,
  total_aed DECIMAL(14,2),
  notes TEXT,
  ai_extraction JSONB,                              -- formula steps, line items, sub-systems
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1d. Estimations — calculation results and approval status
CREATE TABLE IF NOT EXISTS sabi_estimations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES sabi_projects(id) ON DELETE CASCADE,
  total_aed DECIMAL(14,2),
  cost_per_sqft_aed DECIMAL(10,2),
  yardstick_min_aed DECIMAL(14,2),
  yardstick_max_aed DECIMAL(14,2),
  yardstick_status VARCHAR,                         -- within_range, below_market, above_market
  margin_percent DECIMAL(5,2) DEFAULT 15,
  final_quote_aed DECIMAL(14,2),
  george_approved BOOLEAN DEFAULT FALSE,
  approved_at TIMESTAMPTZ,
  generated_boq_url TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1e. Activity Log — audit trail per pipeline step
CREATE TABLE IF NOT EXISTS sabi_activity_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES sabi_projects(id) ON DELETE CASCADE,
  step INTEGER NOT NULL,
  step_name TEXT NOT NULL,
  status VARCHAR NOT NULL DEFAULT 'started',        -- started, completed, failed, skipped
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1f. Yardstick Rates — market benchmark rates (AED/sqft)
CREATE TABLE IF NOT EXISTS sabi_yardstick_rates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  building_type VARCHAR NOT NULL,
  service_type VARCHAR NOT NULL,
  min_aed_per_sqft DECIMAL(10,2) NOT NULL,
  max_aed_per_sqft DECIMAL(10,2) NOT NULL,
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================
-- 1g. Emails — raw Gmail messages synced locally
-- ============================================================

CREATE TABLE IF NOT EXISTS sabi_emails (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  gmail_message_id TEXT UNIQUE NOT NULL,
  thread_id TEXT NOT NULL,
  from_address TEXT NOT NULL,
  to_address TEXT,
  cc_address TEXT,
  subject TEXT NOT NULL DEFAULT '(no subject)',
  date TIMESTAMPTZ,
  snippet TEXT,
  body_html TEXT,
  body_text TEXT,
  labels TEXT[] DEFAULT '{}',
  has_attachments BOOLEAN DEFAULT FALSE,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1h. Email Attachments — attachment metadata for synced emails
CREATE TABLE IF NOT EXISTS sabi_email_attachments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email_id UUID NOT NULL REFERENCES sabi_emails(id) ON DELETE CASCADE,
  gmail_attachment_id TEXT NOT NULL,
  gmail_message_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  storage_path TEXT,                              -- Supabase Storage path
  sync_error TEXT,                                -- Error message if download/upload failed
  created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================
-- 2. NEW TABLES (added April 2026)
-- ============================================================

-- 2a. Price Library — component-level pricing for BOQ generation
CREATE TABLE IF NOT EXISTS sabi_price_library (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  discipline VARCHAR NOT NULL,                      -- hvac, electrical, plumbing, fire_fighting, fire_alarm
  category VARCHAR NOT NULL,                        -- Equipment, Indoor Units, Ductwork, Piping, etc.
  item_name VARCHAR NOT NULL,
  description TEXT,
  unit VARCHAR NOT NULL DEFAULT 'piece',            -- nos, sqft, Rmt, LS, m³, set, Job
  unit_rate_aed DECIMAL(12,2) NOT NULL DEFAULT 0,
  brand VARCHAR,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2b. Settings — global config (RFQ keywords, thresholds, etc.)
CREATE TABLE IF NOT EXISTS sabi_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  key VARCHAR UNIQUE NOT NULL,
  value JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2c. Users — authentication (for admin login)
CREATE TABLE IF NOT EXISTS sabi_users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email VARCHAR UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  role VARCHAR DEFAULT 'user',                      -- admin, user
  created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================
-- 3. COLUMNS ADDED TO EXISTING TABLES
-- ============================================================

ALTER TABLE sabi_projects ADD COLUMN IF NOT EXISTS approval_gate INTEGER DEFAULT NULL;
ALTER TABLE sabi_projects ADD COLUMN IF NOT EXISTS reputation_class VARCHAR DEFAULT NULL;
ALTER TABLE sabi_projects ADD COLUMN IF NOT EXISTS email_id UUID REFERENCES sabi_emails(id);
ALTER TABLE sabi_attachments ADD COLUMN IF NOT EXISTS discipline VARCHAR DEFAULT NULL;


-- ============================================================
-- 4. INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_projects_status ON sabi_projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_priority ON sabi_projects(priority);
CREATE INDEX IF NOT EXISTS idx_projects_reputation ON sabi_projects(reputation_class);
CREATE INDEX IF NOT EXISTS idx_projects_created ON sabi_projects(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_attachments_project ON sabi_attachments(project_id);
CREATE INDEX IF NOT EXISTS idx_attachments_discipline ON sabi_attachments(discipline);
CREATE INDEX IF NOT EXISTS idx_attachments_file_type ON sabi_attachments(file_type);

CREATE INDEX IF NOT EXISTS idx_services_project ON sabi_services(project_id);
CREATE INDEX IF NOT EXISTS idx_services_type ON sabi_services(service_type);

CREATE INDEX IF NOT EXISTS idx_estimations_project ON sabi_estimations(project_id);

CREATE INDEX IF NOT EXISTS idx_activity_project ON sabi_activity_log(project_id);
CREATE INDEX IF NOT EXISTS idx_activity_step ON sabi_activity_log(project_id, step);

CREATE INDEX IF NOT EXISTS idx_yardstick_type ON sabi_yardstick_rates(building_type, service_type);

CREATE INDEX IF NOT EXISTS idx_price_library_discipline ON sabi_price_library(discipline);
CREATE INDEX IF NOT EXISTS idx_price_library_category ON sabi_price_library(discipline, category);

CREATE INDEX IF NOT EXISTS idx_emails_thread ON sabi_emails(thread_id);
CREATE INDEX IF NOT EXISTS idx_emails_date ON sabi_emails(date DESC);
CREATE INDEX IF NOT EXISTS idx_emails_labels ON sabi_emails USING GIN(labels);
CREATE INDEX IF NOT EXISTS idx_email_att_email ON sabi_email_attachments(email_id);


-- ============================================================
-- 5. SEED DATA — Yardstick Rates (Dubai MEP market benchmarks)
-- ============================================================

INSERT INTO sabi_yardstick_rates (building_type, service_type, min_aed_per_sqft, max_aed_per_sqft, notes)
VALUES
  -- HVAC
  ('office',      'hvac', 35, 55, 'Chiller/VRF system, Dubai office standard'),
  ('residential', 'hvac', 25, 40, 'VRF/Split, mid-rise residential'),
  ('villa',       'hvac', 30, 45, 'VRF/Split per villa'),
  ('hotel',       'hvac', 45, 70, 'Chiller, 4-pipe FCU'),
  ('warehouse',   'hvac', 12, 22, 'Package units, minimal ductwork'),
  ('hospital',    'hvac', 55, 85, 'Chiller, 100% fresh air OT, HEPA'),
  ('retail',      'hvac', 30, 50, 'VRF/Package, high ceiling'),
  -- Electrical
  ('office',      'electrical', 25, 40, 'Standard power + lighting'),
  ('residential', 'electrical', 18, 30, 'Per apartment standard'),
  ('villa',       'electrical', 22, 35, 'Per villa, basic smart home'),
  ('hotel',       'electrical', 35, 55, 'Card system, dimming, UPS'),
  ('warehouse',   'electrical', 10, 18, 'Basic power + high-bay LED'),
  ('hospital',    'electrical', 40, 65, 'Essential power, UPS, IPS, isolated earth'),
  ('retail',      'electrical', 22, 38, 'Feature lighting, high load'),
  -- Plumbing
  ('office',      'plumbing', 15, 25, 'Standard fixture count'),
  ('residential', 'plumbing', 18, 28, 'Per apartment, booster pumps'),
  ('villa',       'plumbing', 20, 32, 'Per villa, external works'),
  ('hotel',       'plumbing', 22, 35, 'High fixture density, TMV'),
  ('warehouse',   'plumbing',  5, 12, 'Minimal fixtures'),
  ('hospital',    'plumbing', 25, 40, 'Medical gas, RO water, TMV'),
  ('retail',      'plumbing', 12, 22, 'F&B areas higher'),
  -- Fire Fighting
  ('office',      'fire_fighting', 12, 20, 'Sprinkler + hose reels'),
  ('residential', 'fire_fighting', 10, 18, 'Sprinkler + hose reels'),
  ('villa',       'fire_fighting',  8, 15, 'Basic extinguishers + detection'),
  ('hotel',       'fire_fighting', 15, 25, 'Full sprinkler + hydrants'),
  ('warehouse',   'fire_fighting', 12, 20, 'ESFR sprinklers, high ceiling'),
  ('hospital',    'fire_fighting', 15, 25, 'Full sprinkler + defend-in-place'),
  ('retail',      'fire_fighting', 12, 22, 'Sprinkler + external hydrants'),
  -- Fire Alarm
  ('office',      'fire_alarm',  5, 10, 'Addressable, voice evacuation'),
  ('residential', 'fire_alarm',  4,  8, 'Addressable per floor'),
  ('hotel',       'fire_alarm',  6, 12, 'Full PA, stairwell pressurization'),
  ('hospital',    'fire_alarm',  8, 15, 'Defend-in-place, full PA, nurse call interface'),
  ('warehouse',   'fire_alarm',  3,  6, 'Beam detectors, manual call'),
  ('retail',      'fire_alarm',  5, 10, 'Addressable, public address')
ON CONFLICT DO NOTHING;


-- ============================================================
-- 6. SEED DATA — Default Settings
-- ============================================================

INSERT INTO sabi_settings (key, value)
VALUES
  ('rfq_keywords', '{"keywords": ["please quote", "best price", "RFQ", "request for quotation", "tender", "invitation to bid", "competitive quotation", "submit your price", "quotation required"]}'),
  ('default_margin', '{"percent": 15}'),
  ('pipeline_config', '{"total_steps": 21, "gate_steps": [14, 15, 16, 20]}'),
  ('gmail_sync_state', '{"last_history_id": null, "last_sync_at": null, "backfill_complete": false}')
ON CONFLICT (key) DO NOTHING;


-- ============================================================
-- 6b. SEED DATA — Price Library (Dubai MEP benchmark rates)
-- ============================================================

INSERT INTO sabi_price_library (discipline, category, item_name, unit, unit_rate_aed, description) VALUES
  ('hvac', 'Equipment', 'VRF Outdoor Condensing Unit', 'nos', 18500, 'VRF/DX outdoor unit'),
  ('hvac', 'Equipment', 'Air-Cooled Scroll Chiller', 'nos', 250000, 'Chiller plant'),
  ('hvac', 'Equipment', 'Ducted Indoor Unit', 'nos', 3200, 'Ceiling concealed indoor unit'),
  ('hvac', 'Equipment', 'Decorative Indoor Unit', 'nos', 2800, 'Cassette/Wall mount indoor unit'),
  ('hvac', 'Equipment', 'Fan Coil Unit (4-Pipe)', 'nos', 3800, 'Ceiling mounted FCU'),
  ('hvac', 'Equipment', 'FAHU', 'nos', 55000, 'Fresh Air Handling Unit with filters'),
  ('hvac', 'Equipment', 'AHU', 'nos', 45000, 'Central Air Handling Unit'),
  ('hvac', 'Equipment', 'Exhaust Fan', 'nos', 850, 'Toilet/Kitchen exhaust'),
  ('hvac', 'Equipment', 'Car Park Jet Fan', 'nos', 4500, 'Ventilation jet fan'),
  ('hvac', 'Ductwork', 'GI Ductwork (Supply + Return)', 'sqft', 45, 'Galvanized iron ductwork'),
  ('hvac', 'Ductwork', 'Pre-insulated Duct', 'sqft', 65, 'Fresh air pre-insulated duct'),
  ('hvac', 'Ductwork', 'Flexible Duct Connection', 'nos', 85, 'Flexible duct to diffuser'),
  ('hvac', 'Ductwork', 'Duct Insulation (25mm)', 'sqft', 25, 'Closed-cell insulation'),
  ('hvac', 'Accessories', 'Ceiling Diffuser', 'nos', 180, 'Square/Round diffuser'),
  ('hvac', 'Accessories', 'Linear Slot Diffuser', 'nos', 450, 'Linear diffuser'),
  ('hvac', 'Accessories', 'Return Air Grille', 'nos', 120, 'Return grille'),
  ('hvac', 'Accessories', 'Fire Damper', 'nos', 650, 'Intumescent fire damper'),
  ('hvac', 'Accessories', 'Volume Control Damper', 'nos', 350, 'VCD'),
  ('hvac', 'Piping', 'Copper Refrigerant Pipe', 'Rmt', 120, 'Liquid+Gas pair'),
  ('hvac', 'Piping', 'Chilled Water Pipe (MS)', 'Rmt', 180, 'Insulated MS pipe'),
  ('hvac', 'Piping', 'Condensate Drain Pipe', 'Rmt', 45, 'uPVC condensate'),
  ('hvac', 'Controls', 'Thermostat / Zone Controller', 'nos', 280, 'Digital thermostat'),
  ('hvac', 'Testing', 'TAB (Testing & Balancing)', 'Job', 35000, 'Full system TAB'),
  ('hvac', 'Testing', 'Commissioning & Handover', 'Job', 25000, 'System commissioning'),
  ('electrical', 'Distribution', 'Main Distribution Board (MDB)', 'nos', 45000, 'Main DB with breakers'),
  ('electrical', 'Distribution', 'Sub-Main DB (SMDB)', 'nos', 18000, 'Sub-main DB'),
  ('electrical', 'Distribution', 'Distribution Board (DB)', 'nos', 3500, 'Final circuit DB'),
  ('electrical', 'Cables', 'XLPE Power Cable', 'Rmt', 85, 'Main power cable'),
  ('electrical', 'Cables', 'PVC Control Cable', 'Rmt', 25, 'Control/signal cable'),
  ('electrical', 'Cables', 'Cable Tray (GI)', 'Rmt', 120, 'Perforated cable tray'),
  ('electrical', 'Lighting', 'LED Panel Light 600x600', 'nos', 280, '40W recessed panel'),
  ('electrical', 'Lighting', 'LED Downlight', 'nos', 120, '12W recessed downlight'),
  ('electrical', 'Wiring', 'Switch & Socket Point', 'nos', 180, 'Wiring + accessory'),
  ('plumbing', 'Fixtures', 'WC (Wall Hung)', 'nos', 1200, 'European wall hung WC'),
  ('plumbing', 'Fixtures', 'Wash Basin', 'nos', 800, 'Counter-top basin with mixer'),
  ('plumbing', 'Fixtures', 'Kitchen Sink', 'nos', 950, 'SS sink with mixer'),
  ('plumbing', 'Piping', 'PPR Pipe', 'Rmt', 35, 'Hot/cold water PPR'),
  ('plumbing', 'Piping', 'GI Pipe', 'Rmt', 85, 'Galvanized riser'),
  ('plumbing', 'Equipment', 'Booster Pump Set', 'nos', 18000, 'Duplex booster pump'),
  ('plumbing', 'Equipment', 'Water Heater (100L)', 'nos', 2500, 'Electric storage heater'),
  ('fire_fighting', 'Equipment', 'Fire Pump (Main)', 'nos', 65000, 'Diesel/Electric main pump'),
  ('fire_fighting', 'Equipment', 'Jockey Pump', 'nos', 12000, 'Pressure maintenance pump'),
  ('fire_fighting', 'Sprinklers', 'Sprinkler Head (Pendant)', 'nos', 85, 'K5.6 pendant sprinkler'),
  ('fire_fighting', 'Equipment', 'Hose Reel', 'nos', 1800, 'Swinging type with hose'),
  ('fire_fighting', 'Piping', 'Black Steel Pipe', 'Rmt', 95, 'Sch40 fire pipe'),
  ('fire_alarm', 'Panels', 'Fire Alarm Panel (Addressable)', 'nos', 25000, 'Addressable FACP'),
  ('fire_alarm', 'Detectors', 'Smoke Detector (Optical)', 'nos', 180, 'Addressable smoke detector'),
  ('fire_alarm', 'Detectors', 'Heat Detector', 'nos', 150, 'Fixed temp heat detector'),
  ('fire_alarm', 'Devices', 'Manual Call Point', 'nos', 120, 'Break glass MCP'),
  ('fire_alarm', 'Devices', 'Sounder / Bell', 'nos', 200, 'Electronic sounder with strobe')
ON CONFLICT DO NOTHING;


-- ============================================================
-- 7. ROW LEVEL SECURITY (recommended for production)
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE sabi_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE sabi_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE sabi_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE sabi_estimations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sabi_activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE sabi_yardstick_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE sabi_price_library ENABLE ROW LEVEL SECURITY;
ALTER TABLE sabi_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE sabi_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE sabi_email_attachments ENABLE ROW LEVEL SECURITY;

-- Allow full access (drop first to make re-runs safe)
DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role full access" ON sabi_projects;
  DROP POLICY IF EXISTS "Service role full access" ON sabi_attachments;
  DROP POLICY IF EXISTS "Service role full access" ON sabi_services;
  DROP POLICY IF EXISTS "Service role full access" ON sabi_estimations;
  DROP POLICY IF EXISTS "Service role full access" ON sabi_activity_log;
  DROP POLICY IF EXISTS "Service role full access" ON sabi_yardstick_rates;
  DROP POLICY IF EXISTS "Service role full access" ON sabi_price_library;
  DROP POLICY IF EXISTS "Service role full access" ON sabi_settings;
  DROP POLICY IF EXISTS "Service role full access" ON sabi_emails;
  DROP POLICY IF EXISTS "Service role full access" ON sabi_email_attachments;
END $$;

CREATE POLICY "Service role full access" ON sabi_projects FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON sabi_attachments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON sabi_services FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON sabi_estimations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON sabi_activity_log FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON sabi_yardstick_rates FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON sabi_price_library FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON sabi_settings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON sabi_emails FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON sabi_email_attachments FOR ALL USING (true) WITH CHECK (true);


-- ============================================================
-- 8. COMMENTS
-- ============================================================

COMMENT ON TABLE sabi_projects IS 'Main bid list — one row per RFQ email received';
COMMENT ON TABLE sabi_attachments IS 'Cataloged email attachments (drawings, specs, BOQ templates)';
COMMENT ON TABLE sabi_services IS 'MEP services identified per project (HVAC, electrical, plumbing, etc.)';
COMMENT ON TABLE sabi_estimations IS 'Estimation results with yardstick comparison and approval status';
COMMENT ON TABLE sabi_activity_log IS 'Audit trail — every pipeline step logged with timestamp';
COMMENT ON TABLE sabi_yardstick_rates IS 'Market benchmark rates (AED/sqft) by building type and service';
COMMENT ON TABLE sabi_price_library IS 'Component-level pricing for detailed BOQ generation';
COMMENT ON TABLE sabi_settings IS 'Global configuration — RFQ keywords, margins, pipeline config';
COMMENT ON COLUMN sabi_projects.approval_gate IS 'Pipeline step number currently awaiting human approval. NULL when no gate is active.';
-- Enable Realtime for inbox live updates
ALTER TABLE sabi_emails REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE sabi_emails;

-- Enable Realtime for live pipeline step progress (StepTimeline component)
ALTER TABLE sabi_activity_log REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE sabi_activity_log;

-- Enable Realtime for bid list live updates (new projects classified by cron)
ALTER TABLE sabi_projects REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE sabi_projects;

COMMENT ON TABLE sabi_emails IS 'Raw Gmail messages synced locally — inbox reads from here instead of Gmail API';
COMMENT ON TABLE sabi_email_attachments IS 'Attachment metadata for synced emails — files stored in Supabase Storage';
COMMENT ON COLUMN sabi_projects.email_id IS 'FK to sabi_emails — links project back to its source email';


-- ============================================================
-- PROJECT MASTER — folder-per-project organizing layer
-- Standalone manual folders gathering everything about a project:
-- drawings, email attachments, mail body, generated BOQ. Items are
-- references to existing rows/files (no duplication).
-- ============================================================
CREATE TABLE IF NOT EXISTS sabi_project_folders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sabi_folder_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  folder_id UUID NOT NULL REFERENCES sabi_project_folders(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                  -- 'drawing' | 'email_attachment' | 'email' | 'boq'
  label TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  storage_path TEXT,
  gmail_message_id TEXT,
  gmail_attachment_id TEXT,
  ref_project_id UUID,
  ref_email_id UUID,
  source_table TEXT,
  source_id UUID,
  added_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_folder_items_folder ON sabi_folder_items(folder_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_folder_items_dedupe
  ON sabi_folder_items(folder_id, kind, source_id);


-- ============================================================
-- DONE. All tables, indexes, seed data, and RLS configured.
-- ============================================================
