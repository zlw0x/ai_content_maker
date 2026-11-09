BEGIN;

CREATE TABLE recipe_funnel_events (
  visit_digest char(64) NOT NULL,
  provider_mode text NOT NULL CHECK (provider_mode IN ('mock','live')),
  stage text NOT NULL CHECK (stage IN ('example','start','free_export')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (visit_digest, stage)
);
CREATE INDEX recipe_funnel_by_time ON recipe_funnel_events (created_at);

ALTER TABLE recipe_quotes ADD COLUMN funnel_digest char(64);
CREATE INDEX recipe_quotes_funnel ON recipe_quotes (funnel_digest, created_at) WHERE funnel_digest IS NOT NULL;
CREATE INDEX recipe_quotes_funnel_retention ON recipe_quotes (created_at) WHERE funnel_digest IS NOT NULL;

COMMIT;
