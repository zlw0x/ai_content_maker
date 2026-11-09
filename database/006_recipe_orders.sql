BEGIN;

CREATE TABLE recipe_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  asset_id uuid NOT NULL REFERENCES media_assets(id),
  recipe_key text NOT NULL,
  recipe_version integer NOT NULL CHECK (recipe_version > 0),
  layout jsonb NOT NULL,
  price_kopecks integer NOT NULL CHECK (price_kopecks >= 0),
  access text NOT NULL CHECK (access IN ('trial', 'premium')),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((access = 'trial') = (price_kopecks = 0)),
  UNIQUE (id, user_id)
);
CREATE INDEX recipe_quotes_owner_recent ON recipe_quotes (user_id, created_at);

CREATE TABLE recipe_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  quote_id uuid NOT NULL UNIQUE,
  idempotency_key uuid NOT NULL,
  price_kopecks integer NOT NULL CHECK (price_kopecks >= 0),
  status text NOT NULL CHECK (status IN ('awaiting_payment', 'queued', 'preparing', 'submitting', 'processing', 'completed', 'failed', 'unknown')),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 minutes',
  provider_mode text NOT NULL CHECK (provider_mode IN ('mock', 'live')),
  provider_prediction_id text UNIQUE,
  provider_cost_usd numeric(14, 6) CHECK (provider_cost_usd >= 0),
  attempt_id uuid,
  submitted_at timestamptz,
  last_polled_at timestamptz,
  prepared_asset_id uuid REFERENCES media_assets(id),
  layout jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key),
  UNIQUE (id, user_id),
  FOREIGN KEY (quote_id, user_id) REFERENCES recipe_quotes(id, user_id)
);
CREATE INDEX recipe_orders_worker_queue ON recipe_orders (provider_mode, status, created_at)
  WHERE status IN ('queued', 'preparing', 'submitting', 'processing');
CREATE INDEX recipe_orders_owner_recent ON recipe_orders (user_id, created_at DESC);

CREATE TABLE recipe_outputs (
  order_id uuid NOT NULL,
  user_id uuid NOT NULL,
  asset_id uuid NOT NULL UNIQUE REFERENCES media_assets(id),
  revision integer NOT NULL CHECK (revision > 0),
  slot integer NOT NULL CHECK (slot >= 0),
  filename text NOT NULL,
  PRIMARY KEY (order_id, revision, slot),
  FOREIGN KEY (order_id, user_id) REFERENCES recipe_orders(id, user_id)
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

CREATE TABLE recipe_trial_days (
  day date PRIMARY KEY,
  reserved_usd numeric(14, 6) NOT NULL DEFAULT 0 CHECK (reserved_usd >= 0),
  used_usd numeric(14, 6) NOT NULL DEFAULT 0 CHECK (used_usd >= 0)
);

CREATE TABLE recipe_trial_grants (
  user_id uuid PRIMARY KEY,
  order_id uuid NOT NULL UNIQUE,
  budget_day date NOT NULL REFERENCES recipe_trial_days(day),
  ip_digest char(64) NOT NULL,
  state text NOT NULL CHECK (state IN ('reserved', 'used')),
  ceiling_usd numeric(14, 6) NOT NULL CHECK (ceiling_usd > 0),
  FOREIGN KEY (order_id, user_id) REFERENCES recipe_orders(id, user_id)
);
CREATE INDEX recipe_trial_ip_daily ON recipe_trial_grants (budget_day, ip_digest);

COMMIT;
