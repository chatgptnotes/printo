-- ============================================================
-- SABI ERP Realsoft — FRESH SETUP v2 (consolidated, corrected)
-- Run ONCE in the NEW Supabase project's SQL Editor.
-- Idempotent: safe to re-run. Creates only the 14 tables the app uses.
--
-- Supersedes: fresh_setup.sql + remaining_setup.sql + complete_schema.sql
-- Fixes vs old fresh_setup.sql:
--   * bucket name is sabi-attachments (was wrongly 'attachments')
--   * drops dead sabi_users table (login uses public.users / col `password`)
--   * adds sabi_no_bid_log, sabi_corrections, sabi_drawing_analysis_cache (+fn)
--   * adds all later columns (bid_decision, boq_quality, scale_detection,
--     critical_drawings_status, document_inventory, confidence, pricing_source,
--     data_source, confidence_flag, sub_pipeline) and step CHECK 0..33
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- 1. TABLES (in dependency order)
-- ============================================================

-- 1a. Emails — raw Gmail messages (referenced by projects + email_attachments)
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

-- 1b. Projects — main bid list (all columns merged from every migration)
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
  priority VARCHAR NOT NULL DEFAULT 'new',
  status VARCHAR NOT NULL DEFAULT 'new',
  floors INTEGER,
  parking_floors INTEGER,
  typical_floors INTEGER,
  area_per_floor_sqft DECIMAL(12,2),
  total_area_sqft DECIMAL(12,2),
  typical_height_m DECIMAL(6,2),
  building_type VARCHAR,
  deadline TIMESTAMPTZ,
  reputation_class VARCHAR DEFAULT NULL,
  notes TEXT,
  ai_classification JSONB,
  ai_extraction JSONB,
  final_quote_aed DECIMAL(14,2),
  approval_gate INTEGER DEFAULT NULL,
  document_inventory JSONB DEFAULT '{}'::jsonb,
  critical_drawings_status VARCHAR DEFAULT NULL,
  boq_quality VARCHAR DEFAULT NULL,
  scale_detection JSONB DEFAULT NULL,
  bid_decision VARCHAR DEFAULT NULL,
  email_id UUID REFERENCES sabi_emails(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1c. Attachments — cataloged email attachments
CREATE TABLE IF NOT EXISTS sabi_attachments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES sabi_projects(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  attachment_id TEXT,
  message_id TEXT,
  file_type VARCHAR,
  discipline VARCHAR DEFAULT NULL,
  extracted_data JSONB,
  storage_path TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1d. Services — MEP services per project
CREATE TABLE IF NOT EXISTS sabi_services (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES sabi_projects(id) ON DELETE CASCADE,
  service_type VARCHAR NOT NULL,
  is_required BOOLEAN DEFAULT TRUE,
  system_type TEXT,
  total_kw DECIMAL(10,2),
  fahu_kw DECIMAL(10,2),
  ac_unit_kw DECIMAL(10,2),
  tonnage DECIMAL(10,2),
  unit_rate_aed DECIMAL(10,2),
  quantity INTEGER DEFAULT 1,
  total_aed DECIMAL(14,2),
  notes TEXT,
  ai_extraction JSONB,
  confidence VARCHAR DEFAULT NULL,
  pricing_source VARCHAR DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1e. Estimations — calculation results + approval
CREATE TABLE IF NOT EXISTS sabi_estimations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES sabi_projects(id) ON DELETE CASCADE,
  total_aed DECIMAL(14,2),
  cost_per_sqft_aed DECIMAL(10,2),
  yardstick_min_aed DECIMAL(14,2),
  yardstick_max_aed DECIMAL(14,2),
  yardstick_status VARCHAR,
  margin_percent DECIMAL(5,2) DEFAULT 15,
  final_quote_aed DECIMAL(14,2),
  george_approved BOOLEAN DEFAULT FALSE,
  approved_at TIMESTAMPTZ,
  generated_boq_url TEXT,
  sent_at TIMESTAMPTZ,
  data_source VARCHAR DEFAULT 'primary_drawing',
  confidence_flag TEXT
    CHECK (confidence_flag IN ('verified','ai_estimated','assumed'))
    DEFAULT 'ai_estimated',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1f. Activity Log — audit trail per pipeline step (MAIN + electrical sub)
CREATE TABLE IF NOT EXISTS sabi_activity_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES sabi_projects(id) ON DELETE CASCADE,
  step INTEGER NOT NULL CHECK (step >= 0 AND step <= 33),
  step_name TEXT NOT NULL,
  status VARCHAR NOT NULL DEFAULT 'started',
  details JSONB,
  sub_pipeline TEXT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1g. Yardstick Rates — market benchmark AED/sqft
CREATE TABLE IF NOT EXISTS sabi_yardstick_rates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  building_type VARCHAR NOT NULL,
  service_type VARCHAR NOT NULL,
  min_aed_per_sqft DECIMAL(10,2) NOT NULL,
  max_aed_per_sqft DECIMAL(10,2) NOT NULL,
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1h. Email Attachments — metadata for synced emails
CREATE TABLE IF NOT EXISTS sabi_email_attachments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email_id UUID NOT NULL REFERENCES sabi_emails(id) ON DELETE CASCADE,
  gmail_attachment_id TEXT NOT NULL,
  gmail_message_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  storage_path TEXT,
  sync_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1i. Price Library — component-level pricing for BOQ
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

-- 1j. Settings — global config (key/value JSONB)
CREATE TABLE IF NOT EXISTS sabi_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  key VARCHAR UNIQUE NOT NULL,
  value JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1k. No-Bid Log — terminal-exit audit
CREATE TABLE IF NOT EXISTS sabi_no_bid_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES sabi_projects(id) ON DELETE CASCADE,
  reason_code VARCHAR NOT NULL DEFAULT 'unspecified',
  reason_text TEXT NOT NULL,
  decided_by VARCHAR NOT NULL,
  decided_at TIMESTAMPTZ DEFAULT NOW(),
  source VARCHAR NOT NULL DEFAULT 'human'
);

-- 1l. Corrections — human-vs-AI overrides for heuristic training
CREATE TABLE IF NOT EXISTS sabi_corrections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID REFERENCES sabi_projects(id) ON DELETE CASCADE,
  field_path TEXT NOT NULL,
  ai_value JSONB,
  human_value JSONB NOT NULL,
  ai_provider TEXT,
  procedure_version TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1m. Drawing Analysis Cache — content-hash cache for electrical analysis
CREATE TABLE IF NOT EXISTS sabi_drawing_analysis_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key TEXT UNIQUE NOT NULL,
  model TEXT NOT NULL,
  procedure_version TEXT NOT NULL,
  input_summary JSONB,
  result JSONB NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 0,
  est_savings_usd NUMERIC(10,4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 1n. Users — login (the auth routes hit public.users, col `password`)
CREATE TABLE IF NOT EXISTS public.users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email VARCHAR UNIQUE NOT NULL,
  password TEXT NOT NULL,
  full_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 2. FUNCTION — atomic cache hit counter
-- ============================================================
CREATE OR REPLACE FUNCTION bump_drawing_cache_hit(p_cache_key TEXT)
RETURNS void LANGUAGE sql AS $$
  UPDATE sabi_drawing_analysis_cache
     SET hit_count = hit_count + 1, last_used_at = NOW()
   WHERE cache_key = p_cache_key;
$$;

-- ============================================================
-- 3. INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_projects_status        ON sabi_projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_priority      ON sabi_projects(priority);
CREATE INDEX IF NOT EXISTS idx_projects_reputation    ON sabi_projects(reputation_class);
CREATE INDEX IF NOT EXISTS idx_projects_created       ON sabi_projects(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_bid_decision  ON sabi_projects(bid_decision);

CREATE INDEX IF NOT EXISTS idx_attachments_project    ON sabi_attachments(project_id);
CREATE INDEX IF NOT EXISTS idx_attachments_discipline ON sabi_attachments(discipline);
CREATE INDEX IF NOT EXISTS idx_attachments_file_type  ON sabi_attachments(file_type);

CREATE INDEX IF NOT EXISTS idx_services_project       ON sabi_services(project_id);
CREATE INDEX IF NOT EXISTS idx_services_type          ON sabi_services(service_type);

CREATE INDEX IF NOT EXISTS idx_estimations_project    ON sabi_estimations(project_id);

CREATE INDEX IF NOT EXISTS idx_activity_project       ON sabi_activity_log(project_id);
CREATE INDEX IF NOT EXISTS idx_activity_step          ON sabi_activity_log(project_id, step);
CREATE INDEX IF NOT EXISTS idx_activity_log_pipeline  ON sabi_activity_log(project_id, sub_pipeline, step);

CREATE INDEX IF NOT EXISTS idx_yardstick_type         ON sabi_yardstick_rates(building_type, service_type);

CREATE INDEX IF NOT EXISTS idx_price_library_discipline ON sabi_price_library(discipline);
CREATE INDEX IF NOT EXISTS idx_price_library_category   ON sabi_price_library(discipline, category);

CREATE INDEX IF NOT EXISTS idx_emails_thread          ON sabi_emails(thread_id);
CREATE INDEX IF NOT EXISTS idx_emails_date            ON sabi_emails(date DESC);
CREATE INDEX IF NOT EXISTS idx_emails_labels          ON sabi_emails USING GIN(labels);
CREATE INDEX IF NOT EXISTS idx_email_att_email        ON sabi_email_attachments(email_id);

CREATE INDEX IF NOT EXISTS idx_no_bid_log_project     ON sabi_no_bid_log(project_id);
CREATE INDEX IF NOT EXISTS idx_no_bid_log_reason_code ON sabi_no_bid_log(reason_code);
CREATE INDEX IF NOT EXISTS idx_no_bid_log_source      ON sabi_no_bid_log(source);

CREATE INDEX IF NOT EXISTS idx_corrections_project    ON sabi_corrections(project_id);
CREATE INDEX IF NOT EXISTS idx_corrections_field      ON sabi_corrections(field_path);
CREATE INDEX IF NOT EXISTS idx_corrections_created    ON sabi_corrections(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_drawing_cache_key      ON sabi_drawing_analysis_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_drawing_cache_last_used ON sabi_drawing_analysis_cache(last_used_at DESC);

-- ============================================================
-- 4. ROW LEVEL SECURITY (service-role pass-through; app enforces auth)
-- ============================================================
ALTER TABLE sabi_projects              ENABLE ROW LEVEL SECURITY;
ALTER TABLE sabi_attachments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE sabi_services              ENABLE ROW LEVEL SECURITY;
ALTER TABLE sabi_estimations           ENABLE ROW LEVEL SECURITY;
ALTER TABLE sabi_activity_log          ENABLE ROW LEVEL SECURITY;
ALTER TABLE sabi_yardstick_rates       ENABLE ROW LEVEL SECURITY;
ALTER TABLE sabi_price_library         ENABLE ROW LEVEL SECURITY;
ALTER TABLE sabi_settings              ENABLE ROW LEVEL SECURITY;
ALTER TABLE sabi_emails                ENABLE ROW LEVEL SECURITY;
ALTER TABLE sabi_email_attachments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE sabi_no_bid_log            ENABLE ROW LEVEL SECURITY;
ALTER TABLE sabi_corrections           ENABLE ROW LEVEL SECURITY;
ALTER TABLE sabi_drawing_analysis_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users               ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'sabi_projects','sabi_attachments','sabi_services','sabi_estimations',
    'sabi_activity_log','sabi_yardstick_rates','sabi_price_library','sabi_settings',
    'sabi_emails','sabi_email_attachments','sabi_no_bid_log','sabi_corrections',
    'sabi_drawing_analysis_cache','users'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Service role full access" ON %I', t);
    EXECUTE format('CREATE POLICY "Service role full access" ON %I FOR ALL USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- ============================================================
-- 5. REALTIME (inbox + step timeline live refresh)
-- ============================================================
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['sabi_emails','sabi_activity_log','sabi_projects'] LOOP
    EXECUTE format('ALTER TABLE %I REPLICA IDENTITY FULL', t);
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', t);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END $$;

-- ============================================================
-- 6. STORAGE BUCKET — sabi-attachments (private, 50MB)
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('sabi-attachments', 'sabi-attachments', false, 52428800, NULL)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Service role storage access" ON storage.objects;
CREATE POLICY "Service role storage access"
  ON storage.objects FOR ALL
  USING (bucket_id = 'sabi-attachments')
  WITH CHECK (bucket_id = 'sabi-attachments');

-- ============================================================
-- 7. SEED — Settings
-- ============================================================
INSERT INTO sabi_settings (key, value) VALUES
  ('rfq_keywords', '{"keywords": ["please quote","best price","RFQ","request for quotation","tender","invitation to bid","competitive quotation","submit your price","quotation required"]}'),
  ('default_margin', '{"percent": 15}'),
  ('pipeline_config', '{"total_steps": 23, "gate_steps": [5, 9, 17, 20, 23]}'),
  ('gmail_sync_state', '{"last_history_id": null, "last_sync_at": null, "backfill_complete": false}')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 8. SEED — Yardstick Rates (Dubai MEP benchmarks)
-- ============================================================
INSERT INTO sabi_yardstick_rates (building_type, service_type, min_aed_per_sqft, max_aed_per_sqft, notes) VALUES
  ('office','hvac',35,55,'Chiller/VRF system, Dubai office standard'),
  ('residential','hvac',25,40,'VRF/Split, mid-rise residential'),
  ('villa','hvac',30,45,'VRF/Split per villa'),
  ('hotel','hvac',45,70,'Chiller, 4-pipe FCU'),
  ('warehouse','hvac',12,22,'Package units, minimal ductwork'),
  ('hospital','hvac',55,85,'Chiller, 100% fresh air OT, HEPA'),
  ('retail','hvac',30,50,'VRF/Package, high ceiling'),
  ('office','electrical',25,40,'Standard power + lighting'),
  ('residential','electrical',18,30,'Per apartment standard'),
  ('villa','electrical',22,35,'Per villa, basic smart home'),
  ('hotel','electrical',35,55,'Card system, dimming, UPS'),
  ('warehouse','electrical',10,18,'Basic power + high-bay LED'),
  ('hospital','electrical',40,65,'Essential power, UPS, IPS, isolated earth'),
  ('retail','electrical',22,38,'Feature lighting, high load'),
  ('office','plumbing',15,25,'Standard fixture count'),
  ('residential','plumbing',18,28,'Per apartment, booster pumps'),
  ('villa','plumbing',20,32,'Per villa, external works'),
  ('hotel','plumbing',22,35,'High fixture density, TMV'),
  ('warehouse','plumbing',5,12,'Minimal fixtures'),
  ('hospital','plumbing',25,40,'Medical gas, RO water, TMV'),
  ('retail','plumbing',12,22,'F&B areas higher'),
  ('office','fire_fighting',12,20,'Sprinkler + hose reels'),
  ('residential','fire_fighting',10,18,'Sprinkler + hose reels'),
  ('villa','fire_fighting',8,15,'Basic extinguishers + detection'),
  ('hotel','fire_fighting',15,25,'Full sprinkler + hydrants'),
  ('warehouse','fire_fighting',12,20,'ESFR sprinklers, high ceiling'),
  ('hospital','fire_fighting',15,25,'Full sprinkler + defend-in-place'),
  ('retail','fire_fighting',12,22,'Sprinkler + external hydrants'),
  ('office','fire_alarm',5,10,'Addressable, voice evacuation'),
  ('residential','fire_alarm',4,8,'Addressable per floor'),
  ('hotel','fire_alarm',6,12,'Full PA, stairwell pressurization'),
  ('hospital','fire_alarm',8,15,'Defend-in-place, full PA, nurse call interface'),
  ('warehouse','fire_alarm',3,6,'Beam detectors, manual call'),
  ('retail','fire_alarm',5,10,'Addressable, public address')
ON CONFLICT DO NOTHING;

-- ============================================================
-- 9. SEED — Price Library (Dubai MEP benchmark rates)
-- ============================================================
INSERT INTO sabi_price_library (discipline, category, item_name, unit, unit_rate_aed, description) VALUES
  ('hvac','Equipment','VRF Outdoor Condensing Unit','nos',18500,'VRF/DX outdoor unit'),
  ('hvac','Equipment','Air-Cooled Scroll Chiller','nos',250000,'Chiller plant'),
  ('hvac','Equipment','Ducted Indoor Unit','nos',3200,'Ceiling concealed indoor unit'),
  ('hvac','Equipment','Decorative Indoor Unit','nos',2800,'Cassette/Wall mount indoor unit'),
  ('hvac','Equipment','Fan Coil Unit (4-Pipe)','nos',3800,'Ceiling mounted FCU'),
  ('hvac','Equipment','FAHU','nos',55000,'Fresh Air Handling Unit with filters'),
  ('hvac','Equipment','AHU','nos',45000,'Central Air Handling Unit'),
  ('hvac','Equipment','Exhaust Fan','nos',850,'Toilet/Kitchen exhaust'),
  ('hvac','Equipment','Car Park Jet Fan','nos',4500,'Ventilation jet fan'),
  ('hvac','Ductwork','GI Ductwork (Supply + Return)','sqft',45,'Galvanized iron ductwork'),
  ('hvac','Ductwork','Pre-insulated Duct','sqft',65,'Fresh air pre-insulated duct'),
  ('hvac','Ductwork','Flexible Duct Connection','nos',85,'Flexible duct to diffuser'),
  ('hvac','Ductwork','Duct Insulation (25mm)','sqft',25,'Closed-cell insulation'),
  ('hvac','Accessories','Ceiling Diffuser','nos',180,'Square/Round diffuser'),
  ('hvac','Accessories','Linear Slot Diffuser','nos',450,'Linear diffuser'),
  ('hvac','Accessories','Return Air Grille','nos',120,'Return grille'),
  ('hvac','Accessories','Fire Damper','nos',650,'Intumescent fire damper'),
  ('hvac','Accessories','Volume Control Damper','nos',350,'VCD'),
  ('hvac','Piping','Copper Refrigerant Pipe','Rmt',120,'Liquid+Gas pair'),
  ('hvac','Piping','Chilled Water Pipe (MS)','Rmt',180,'Insulated MS pipe'),
  ('hvac','Piping','Condensate Drain Pipe','Rmt',45,'uPVC condensate'),
  ('hvac','Controls','Thermostat / Zone Controller','nos',280,'Digital thermostat'),
  ('hvac','Testing','TAB (Testing & Balancing)','Job',35000,'Full system TAB'),
  ('hvac','Testing','Commissioning & Handover','Job',25000,'System commissioning'),
  ('electrical','Distribution','Main Distribution Board (MDB)','nos',45000,'Main DB with breakers'),
  ('electrical','Distribution','Sub-Main DB (SMDB)','nos',18000,'Sub-main DB'),
  ('electrical','Distribution','Distribution Board (DB)','nos',3500,'Final circuit DB'),
  ('electrical','Cables','XLPE Power Cable','Rmt',85,'Main power cable'),
  ('electrical','Cables','PVC Control Cable','Rmt',25,'Control/signal cable'),
  ('electrical','Cables','Cable Tray (GI)','Rmt',120,'Perforated cable tray'),
  ('electrical','Lighting','LED Panel Light 600x600','nos',280,'40W recessed panel'),
  ('electrical','Lighting','LED Downlight','nos',120,'12W recessed downlight'),
  ('electrical','Wiring','Switch & Socket Point','nos',180,'Wiring + accessory'),
  ('plumbing','Fixtures','WC (Wall Hung)','nos',1200,'European wall hung WC'),
  ('plumbing','Fixtures','Wash Basin','nos',800,'Counter-top basin with mixer'),
  ('plumbing','Fixtures','Kitchen Sink','nos',950,'SS sink with mixer'),
  ('plumbing','Piping','PPR Pipe','Rmt',35,'Hot/cold water PPR'),
  ('plumbing','Piping','GI Pipe','Rmt',85,'Galvanized riser'),
  ('plumbing','Equipment','Booster Pump Set','nos',18000,'Duplex booster pump'),
  ('plumbing','Equipment','Water Heater (100L)','nos',2500,'Electric storage heater'),
  ('fire_fighting','Equipment','Fire Pump (Main)','nos',65000,'Diesel/Electric main pump'),
  ('fire_fighting','Equipment','Jockey Pump','nos',12000,'Pressure maintenance pump'),
  ('fire_fighting','Sprinklers','Sprinkler Head (Pendant)','nos',85,'K5.6 pendant sprinkler'),
  ('fire_fighting','Equipment','Hose Reel','nos',1800,'Swinging type with hose'),
  ('fire_fighting','Piping','Black Steel Pipe','Rmt',95,'Sch40 fire pipe'),
  ('fire_alarm','Panels','Fire Alarm Panel (Addressable)','nos',25000,'Addressable FACP'),
  ('fire_alarm','Detectors','Smoke Detector (Optical)','nos',180,'Addressable smoke detector'),
  ('fire_alarm','Detectors','Heat Detector','nos',150,'Fixed temp heat detector'),
  ('fire_alarm','Devices','Manual Call Point','nos',120,'Break glass MCP'),
  ('fire_alarm','Devices','Sounder / Bell','nos',200,'Electronic sounder with strobe')
ON CONFLICT DO NOTHING;

-- ============================================================
-- 10. SEED — Admin login (admin@sabi.ae / sabi2024, bcrypt cost 10)
--     Change the password after first login.
-- ============================================================
INSERT INTO public.users (email, password, full_name)
VALUES (
  'admin@sabi.ae',
  '$2b$10$nIO0ZxvUa50mgw1QxaYsO.1tiP.hs7h6v.fl4MTQNkO8t4ZqsTRVS',
  'SABI Admin'
)
ON CONFLICT (email) DO NOTHING;

-- ============================================================
-- DONE — 14 tables, 1 function, 1 bucket, indexes, RLS, realtime, seeds.
--
-- NEXT STEPS:
--   1. Settings > API: copy Project URL + anon key + service_role key
--   2. Update .env.local (and Vercel env):
--        NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
--        SUPABASE_SERVICE_ROLE_KEY
--   3. Log in as admin@sabi.ae / sabi2024 and change the password.
-- ============================================================
