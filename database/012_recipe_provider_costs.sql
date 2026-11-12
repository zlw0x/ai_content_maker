BEGIN;

ALTER TABLE recipe_orders
  ADD COLUMN provider_actual_usd numeric(14, 6) CHECK (provider_actual_usd >= 0),
  ADD COLUMN provider_reconciled_at timestamptz,
  ADD CHECK ((provider_actual_usd IS NULL) = (provider_reconciled_at IS NULL)),
  ADD CHECK (provider_actual_usd IS NULL OR (provider_mode = 'live' AND provider_prediction_id IS NOT NULL));

COMMIT;
