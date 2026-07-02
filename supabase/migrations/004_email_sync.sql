-- ============================================================
-- Migration 004: Gmail → Supabase Email Sync
-- Adds sabi_emails + sabi_email_attachments for local email cache
-- ============================================================

-- 1. Raw email storage (one row per Gmail message)
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

CREATE INDEX IF NOT EXISTS idx_emails_thread ON sabi_emails(thread_id);
CREATE INDEX IF NOT EXISTS idx_emails_date ON sabi_emails(date DESC);
CREATE INDEX IF NOT EXISTS idx_emails_labels ON sabi_emails USING GIN(labels);

-- 2. Email attachment metadata (linked to sabi_emails, not sabi_projects)
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

CREATE INDEX IF NOT EXISTS idx_email_att_email ON sabi_email_attachments(email_id);

-- 3. Drop restrictive status check constraint (blocks gate statuses like quote_decision, consent_pending)
ALTER TABLE sabi_projects DROP CONSTRAINT IF EXISTS sabi_projects_status_check;

-- 4. Unique constraints for safe upserts
CREATE UNIQUE INDEX IF NOT EXISTS idx_services_project_type ON sabi_services(project_id, service_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_thread_id ON sabi_projects(email_thread_id) WHERE email_thread_id IS NOT NULL;

-- 4. Link projects to their source email
ALTER TABLE sabi_projects ADD COLUMN IF NOT EXISTS email_id UUID REFERENCES sabi_emails(id);

-- 4. Sync state tracking
INSERT INTO sabi_settings (key, value)
VALUES ('gmail_sync_state', '{"last_history_id": null, "last_sync_at": null, "backfill_complete": false}')
ON CONFLICT (key) DO NOTHING;

-- 5. RLS
ALTER TABLE sabi_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE sabi_email_attachments ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role full access" ON sabi_emails;
  DROP POLICY IF EXISTS "Service role full access" ON sabi_email_attachments;
END $$;

CREATE POLICY "Service role full access" ON sabi_emails FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON sabi_email_attachments FOR ALL USING (true) WITH CHECK (true);

-- 6. Enable Realtime on sabi_emails (inbox auto-updates when sync adds emails)
ALTER TABLE sabi_emails REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE sabi_emails;

-- 8. Seed Price Library with Dubai MEP benchmark rates
INSERT INTO sabi_price_library (discipline, category, item_name, unit, unit_rate_aed, description) VALUES
  -- HVAC Equipment
  ('hvac', 'Equipment', 'VRF Outdoor Condensing Unit', 'nos', 18500, 'VRF/DX outdoor unit'),
  ('hvac', 'Equipment', 'Air-Cooled Scroll Chiller', 'nos', 250000, 'Chiller plant'),
  ('hvac', 'Equipment', 'Ducted Indoor Unit', 'nos', 3200, 'Ceiling concealed indoor unit'),
  ('hvac', 'Equipment', 'Decorative Indoor Unit', 'nos', 2800, 'Cassette/Wall mount indoor unit'),
  ('hvac', 'Equipment', 'Fan Coil Unit (4-Pipe)', 'nos', 3800, 'Ceiling mounted FCU'),
  ('hvac', 'Equipment', 'Fresh Air Handling Unit (FAHU)', 'nos', 55000, 'FAHU with filters'),
  ('hvac', 'Equipment', 'Air Handling Unit (AHU)', 'nos', 45000, 'Central AHU'),
  ('hvac', 'Equipment', 'Exhaust Fan', 'nos', 850, 'Toilet/Kitchen exhaust'),
  ('hvac', 'Equipment', 'Car Park Jet Fan', 'nos', 4500, 'Ventilation jet fan'),
  -- HVAC Ductwork
  ('hvac', 'Ductwork', 'GI Ductwork (Supply + Return)', 'sqft', 45, 'Galvanized iron ductwork'),
  ('hvac', 'Ductwork', 'Pre-insulated Duct', 'sqft', 65, 'Fresh air pre-insulated duct'),
  ('hvac', 'Ductwork', 'Flexible Duct Connection', 'nos', 85, 'Flexible duct to diffuser'),
  ('hvac', 'Ductwork', 'Duct Insulation (25mm)', 'sqft', 25, 'Closed-cell insulation'),
  -- HVAC Accessories
  ('hvac', 'Accessories', 'Ceiling Diffuser', 'nos', 180, 'Square/Round diffuser'),
  ('hvac', 'Accessories', 'Linear Slot Diffuser', 'nos', 450, 'Linear diffuser'),
  ('hvac', 'Accessories', 'Return Air Grille', 'nos', 120, 'Return grille'),
  ('hvac', 'Accessories', 'Fire Damper', 'nos', 650, 'Intumescent fire damper'),
  ('hvac', 'Accessories', 'Volume Control Damper', 'nos', 350, 'VCD'),
  -- HVAC Piping
  ('hvac', 'Piping', 'Copper Refrigerant Pipe', 'Rmt', 120, 'Liquid+Gas pair'),
  ('hvac', 'Piping', 'Chilled Water Pipe (MS)', 'Rmt', 180, 'Insulated MS pipe'),
  ('hvac', 'Piping', 'Condensate Drain Pipe', 'Rmt', 45, 'uPVC condensate'),
  ('hvac', 'Controls', 'Thermostat / Zone Controller', 'nos', 280, 'Digital thermostat'),
  ('hvac', 'Testing', 'TAB (Testing & Balancing)', 'Job', 35000, 'Full system TAB'),
  ('hvac', 'Testing', 'Commissioning & Handover', 'Job', 25000, 'System commissioning'),
  -- Electrical
  ('electrical', 'Distribution', 'Main Distribution Board (MDB)', 'nos', 45000, 'Main DB with breakers'),
  ('electrical', 'Distribution', 'Sub-Main DB (SMDB)', 'nos', 18000, 'Sub-main DB'),
  ('electrical', 'Distribution', 'Distribution Board (DB)', 'nos', 3500, 'Final circuit DB'),
  ('electrical', 'Cables', 'XLPE Power Cable (per Rmt)', 'Rmt', 85, 'Main power cable'),
  ('electrical', 'Cables', 'PVC Control Cable (per Rmt)', 'Rmt', 25, 'Control/signal cable'),
  ('electrical', 'Cables', 'Cable Tray (per Rmt)', 'Rmt', 120, 'GI perforated tray'),
  ('electrical', 'Lighting', 'LED Panel Light 600x600', 'nos', 280, '40W recessed panel'),
  ('electrical', 'Lighting', 'LED Downlight', 'nos', 120, '12W recessed downlight'),
  ('electrical', 'Wiring', 'Switch & Socket Point', 'nos', 180, 'Wiring + accessory'),
  -- Plumbing
  ('plumbing', 'Fixtures', 'WC (Wall Hung)', 'nos', 1200, 'European wall hung WC'),
  ('plumbing', 'Fixtures', 'Wash Basin', 'nos', 800, 'Counter-top basin with mixer'),
  ('plumbing', 'Fixtures', 'Kitchen Sink', 'nos', 950, 'SS sink with mixer'),
  ('plumbing', 'Piping', 'PPR Pipe (per Rmt)', 'Rmt', 35, 'Hot/cold water PPR'),
  ('plumbing', 'Piping', 'GI Pipe (per Rmt)', 'Rmt', 85, 'Galvanized riser'),
  ('plumbing', 'Equipment', 'Booster Pump Set', 'nos', 18000, 'Duplex booster pump'),
  ('plumbing', 'Equipment', 'Water Heater (100L)', 'nos', 2500, 'Electric storage heater'),
  -- Fire Fighting
  ('fire_fighting', 'Equipment', 'Fire Pump (Main)', 'nos', 65000, 'Diesel/Electric main pump'),
  ('fire_fighting', 'Equipment', 'Jockey Pump', 'nos', 12000, 'Pressure maintenance pump'),
  ('fire_fighting', 'Sprinklers', 'Sprinkler Head (Pendant)', 'nos', 85, 'K5.6 pendant sprinkler'),
  ('fire_fighting', 'Equipment', 'Hose Reel', 'nos', 1800, 'Swinging type with hose'),
  ('fire_fighting', 'Piping', 'Black Steel Pipe (per Rmt)', 'Rmt', 95, 'Sch40 fire pipe'),
  -- Fire Alarm
  ('fire_alarm', 'Panels', 'Fire Alarm Panel (Addressable)', 'nos', 25000, 'Addressable FACP'),
  ('fire_alarm', 'Detectors', 'Smoke Detector (Optical)', 'nos', 180, 'Addressable smoke detector'),
  ('fire_alarm', 'Detectors', 'Heat Detector', 'nos', 150, 'Fixed temp heat detector'),
  ('fire_alarm', 'Devices', 'Manual Call Point', 'nos', 120, 'Break glass MCP'),
  ('fire_alarm', 'Devices', 'Sounder / Bell', 'nos', 200, 'Electronic sounder with strobe')
ON CONFLICT DO NOTHING;

-- 9. Comments
COMMENT ON TABLE sabi_emails IS 'Raw Gmail messages synced locally — inbox reads from here instead of Gmail API';
COMMENT ON TABLE sabi_email_attachments IS 'Attachment metadata for synced emails — files stored in Supabase Storage';
COMMENT ON COLUMN sabi_projects.email_id IS 'FK to sabi_emails — links project back to its source email';
