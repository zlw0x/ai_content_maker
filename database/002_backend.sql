-- M1/M2 extension. Apply after 001_init.sql with npm run db:migrate.
BEGIN;
CREATE TABLE IF NOT EXISTS user_credentials (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_scrypt text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_sha256 char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_sessions_owner ON sessions(user_id,expires_at);
CREATE TABLE IF NOT EXISTS auth_attempts (
  key_digest char(64) PRIMARY KEY,
  fail_count int NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE price_quotes ADD COLUMN IF NOT EXISTS input_json jsonb;
ALTER TABLE price_quotes ADD COLUMN IF NOT EXISTS input_asset_id uuid REFERENCES media_assets(id) ON DELETE RESTRICT;
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS last_polled_at timestamptz;
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS submitted_at timestamptz;
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS finished_at timestamptz;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS confirmation_url text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'sbp';
CREATE INDEX IF NOT EXISTS ix_pending_payments ON payments(status,created_at) WHERE status IN ('pending','unknown');
CREATE TABLE IF NOT EXISTS webhook_events (
  provider text NOT NULL,
  event_id text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(provider,event_id)
);
-- Preserve financial event history. Correct balances with compensating entries.
CREATE OR REPLACE FUNCTION deny_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'wallet_ledger is append-only';
END; $$;
DROP TRIGGER IF EXISTS wallet_ledger_immutable ON wallet_ledger;
CREATE TRIGGER wallet_ledger_immutable BEFORE UPDATE OR DELETE ON wallet_ledger
  FOR EACH ROW EXECUTE FUNCTION deny_ledger_mutation();
COMMIT;
