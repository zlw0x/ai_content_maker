BEGIN;

ALTER TABLE recipe_orders ADD COLUMN poll_deadline_at timestamptz;
ALTER TABLE recipe_orders ADD COLUMN completed_at timestamptz;

CREATE TABLE recipe_trial_reconciliations (
  order_id uuid PRIMARY KEY REFERENCES recipe_orders(id),
  net_usd numeric(14, 6) NOT NULL CHECK (net_usd >= 0),
  reconciled_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
