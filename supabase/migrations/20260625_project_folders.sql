-- ============================================================
-- Project Master — folder-per-project organizing layer
-- ============================================================
-- Standalone, manually-created folders that gather everything about
-- a project in one place: uploaded drawings, email attachments, the
-- mail body, and the generated BOQ. Items are REFERENCES to existing
-- rows/files (no file duplication) — deleting a folder/item never
-- touches the underlying Storage object or source row.
-- Safe to run multiple times.
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
  label TEXT NOT NULL,                 -- display name (filename / subject / 'Power BOQ')
  mime_type TEXT,
  size_bytes BIGINT,
  storage_path TEXT,                   -- sabi-attachments bucket path when it's a stored file
  gmail_message_id TEXT,               -- for live Gmail fetch fallback
  gmail_attachment_id TEXT,
  ref_project_id UUID,                 -- source bid/project (nullable), for context + boq path
  ref_email_id UUID,                   -- source sabi_emails.id (for 'email' body items)
  source_table TEXT,                   -- provenance: sabi_attachments | sabi_email_attachments | sabi_emails | sabi_estimations
  source_id UUID,                      -- row id in source_table (dedupe key)
  added_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_folder_items_folder ON sabi_folder_items(folder_id);
-- Makes "add to folder" idempotent: the same source row can't land twice
-- in the same folder under the same kind.
CREATE UNIQUE INDEX IF NOT EXISTS idx_folder_items_dedupe
  ON sabi_folder_items(folder_id, kind, source_id);
