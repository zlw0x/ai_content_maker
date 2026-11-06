BEGIN;
-- At most one order per server-quoted price. Protect against unexpected codepaths and races.
CREATE UNIQUE INDEX IF NOT EXISTS uq_generation_jobs_quote ON generation_jobs (quote_id);
CREATE INDEX IF NOT EXISTS ix_jobs_poll ON generation_jobs (last_polled_at) WHERE status='processing';
COMMIT;
