-- Draft PostgreSQL schema for future M2; NOT automatically applied in M0.
-- All amounts in RUB kopecks; USD amounts use NUMERIC.
-- Secure migrations, roles and event-handling rules are added before live payments.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS wallet_accounts (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  available_kopecks bigint NOT NULL DEFAULT 0 CHECK (available_kopecks >= 0),
  reserved_kopecks bigint NOT NULL DEFAULT 0 CHECK (reserved_kopecks >= 0),
  version bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS price_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  app_slug text NOT NULL,
  model_id text NOT NULL,
  input_digest text NOT NULL,
  amount_kopecks bigint NOT NULL CHECK (amount_kopecks > 0),
  provider_cost_usd numeric(14,6) NOT NULL CHECK (provider_cost_usd >= 0),
  fx_rub_per_usd numeric(14,6) NOT NULL CHECK (fx_rub_per_usd > 0),
  currency char(3) NOT NULL DEFAULT 'RUB' CHECK (currency = 'RUB'),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provider text NOT NULL DEFAULT 'yookassa',
  external_payment_id text,
  client_idempotency_key text NOT NULL,
  amount_kopecks bigint NOT NULL CHECK (amount_kopecks > 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','succeeded','canceled','refunded','unknown')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, external_payment_id),
  UNIQUE (user_id, client_idempotency_key)
);

CREATE TABLE IF NOT EXISTS generation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  quote_id uuid NOT NULL REFERENCES price_quotes(id) ON DELETE RESTRICT,
  app_slug text NOT NULL,
  model_id text NOT NULL,
  client_idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved','queued','submitting','unknown','processing','completed','failed')),
  reserved_kopecks bigint NOT NULL CHECK (reserved_kopecks > 0),
  provider text NOT NULL DEFAULT 'wavespeed',
  provider_prediction_id text,
  provider_cost_usd numeric(14,6),
  error_code text,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_idempotency_key),
  UNIQUE (provider, provider_prediction_id)
);

CREATE TABLE IF NOT EXISTS wallet_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES wallet_accounts(user_id) ON DELETE RESTRICT,
  event_key text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('topup','reserve','capture','release','refund','adjustment')),
  delta_available_kopecks bigint NOT NULL DEFAULT 0,
  delta_reserved_kopecks bigint NOT NULL DEFAULT 0,
  payment_id uuid REFERENCES payments(id) ON DELETE RESTRICT,
  job_id uuid REFERENCES generation_jobs(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (delta_available_kopecks <> 0 OR delta_reserved_kopecks <> 0),
  UNIQUE (user_id, event_key)
);

CREATE TABLE IF NOT EXISTS media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  job_id uuid REFERENCES generation_jobs(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('input','output')),
  object_key text NOT NULL UNIQUE,
  media_type text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS ix_jobs_queue ON generation_jobs (status, created_at)
  WHERE status IN ('reserved','queued','submitting','unknown','processing');
CREATE INDEX IF NOT EXISTS ix_jobs_owner ON generation_jobs(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS ix_ledger_owner ON wallet_ledger(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS ix_media_expiration ON media_assets(expires_at) WHERE deleted_at IS NULL;
COMMIT;
