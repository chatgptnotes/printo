-- ============================================================
-- Price Library — refresh history log
-- ============================================================
-- Records each rate applied from the "Refresh Dubai Rates" flow so the
-- Price Library "Sources & History" panel can show past runs (old -> new
-- per item, grouped by run). One batch_id per apply run. item_name is a
-- snapshot so history survives a later rename/delete of the price item.
-- Read capped + newest-first via the changed_at index. Safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS sabi_price_rate_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id    UUID NOT NULL,
  item_id     UUID,
  item_name   TEXT NOT NULL,
  old_rate    NUMERIC(12,2),
  new_rate    NUMERIC(12,2) NOT NULL,
  source      TEXT,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_rate_history_changed
  ON sabi_price_rate_history (changed_at DESC);
