-- Migration: 0013_us012_campaign_reporting.sql

-- 1. Add campaign_id to content_variants, publish_jobs and interactions
ALTER TABLE content_variants ADD COLUMN IF NOT EXISTS campaign_id TEXT;

ALTER TABLE publish_jobs 
  ADD COLUMN IF NOT EXISTS campaign_id TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE interactions 
  ADD COLUMN IF NOT EXISTS campaign_id TEXT;

-- 2. Index for reporting queries
CREATE INDEX IF NOT EXISTS idx_publish_jobs_campaign ON publish_jobs(workspace_id, campaign_id);
CREATE INDEX IF NOT EXISTS idx_interactions_campaign ON interactions(workspace_id, campaign_id);
-- Optional index for channel filtering over time
CREATE INDEX IF NOT EXISTS idx_publish_jobs_channel_date ON publish_jobs(workspace_id, channel_account_id, created_at);

-- 3. Create Trigger to automatically update updated_at on publish_jobs
CREATE OR REPLACE FUNCTION trigger_set_publish_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_publish_jobs_updated_at ON publish_jobs;
CREATE TRIGGER set_publish_jobs_updated_at
BEFORE UPDATE ON publish_jobs
FOR EACH ROW
EXECUTE FUNCTION trigger_set_publish_jobs_updated_at();
