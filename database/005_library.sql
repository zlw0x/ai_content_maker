BEGIN;
ALTER TABLE price_quotes ADD COLUMN IF NOT EXISTS user_input_json jsonb;
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS hidden_at timestamptz;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS purged_at timestamptz;
CREATE INDEX IF NOT EXISTS ix_jobs_gallery ON generation_jobs(user_id,created_at DESC)
  WHERE hidden_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_media_pending_purge ON media_assets(expires_at)
  WHERE purged_at IS NULL;
COMMIT;
