-- ============================================================
-- Price Library — refreshed-rate provenance
-- ============================================================
-- Records where a price came from and when it was last checked, so the
-- "Refresh Dubai Rates" flow (AI + live web search) can cite a source per
-- item without clobbering the user-editable `notes` column.
--   rate_source     — human-readable source (e.g. "elcometdubai.com")
--   rate_checked_at — timestamp of the last successful refresh applied
-- Both NULL for hand-entered / Excel-uploaded rows. Safe to re-run.
-- ============================================================

ALTER TABLE sabi_price_library
  ADD COLUMN IF NOT EXISTS rate_source TEXT;

ALTER TABLE sabi_price_library
  ADD COLUMN IF NOT EXISTS rate_checked_at TIMESTAMPTZ;

COMMENT ON COLUMN sabi_price_library.rate_source IS
  'Source cited for the current rate when set via the AI Refresh Dubai Rates flow
   (e.g. supplier site / market reference). NULL = manually entered or Excel-imported.';

COMMENT ON COLUMN sabi_price_library.rate_checked_at IS
  'When the current rate was last refreshed + applied from the AI web-search flow.';
