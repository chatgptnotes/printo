-- Track which services had AED 0 / null rates and were filled with
-- placeholder market rates by yardstick-orchestrator.ts. Surfaced as a
-- warning banner on the Gate 5 (Send to Client) card so the operator
-- knows the comparison was based on substituted rates and can verify
-- the total before dispatching the quote.

ALTER TABLE sabi_estimations
  ADD COLUMN IF NOT EXISTS yardstick_placeholders TEXT[] DEFAULT '{}';

COMMENT ON COLUMN sabi_estimations.yardstick_placeholders IS
  'Service types (e.g. {"electrical","hvac"}) where placeholder rates were used during yardstick comparison because real rates were missing. Empty/null = comparison was based entirely on real rates.';
