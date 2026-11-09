BEGIN;

CREATE TABLE IF NOT EXISTS recipe_payments (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL UNIQUE REFERENCES recipe_orders(id) ON DELETE RESTRICT,
  amount_kopecks integer NOT NULL CHECK (amount_kopecks > 0),
  mode text NOT NULL CHECK (mode IN ('mock', 'yookassa-test')),
  status text NOT NULL CHECK (status IN ('unknown', 'pending', 'succeeded', 'canceled')),
  external_id text UNIQUE,
  confirmation_url text,
  refund_id uuid UNIQUE,
  refund_external_id text UNIQUE,
  refund_status text CHECK (refund_status IN ('unknown', 'pending', 'succeeded', 'canceled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((refund_id IS NULL) = (refund_status IS NULL)),
  CHECK (refund_id IS NULL OR status = 'succeeded')
);

CREATE TABLE IF NOT EXISTS recipe_payment_events (
  payment_id uuid NOT NULL REFERENCES recipe_payments(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('payment', 'refund')),
  status text NOT NULL CHECK (status IN ('unknown', 'pending', 'succeeded', 'canceled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (payment_id, kind, status)
);

COMMIT;
