BEGIN;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS source_index integer NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS uq_job_output_index ON media_assets(job_id,source_index) WHERE kind='output' AND job_id IS NOT NULL;
COMMIT;
