-- Add new columns for execution state
ALTER TABLE publish_jobs 
ADD COLUMN IF NOT EXISTS publish_idempotency_key TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS external_post_id TEXT,
ADD COLUMN IF NOT EXISTS platform_response_summary JSONB,
ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS publish_attempt_count INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS airtable_sync_retry_needed BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS airtable_sync_error TEXT,
ADD COLUMN IF NOT EXISTS publish_started_at TIMESTAMPTZ;

-- Drop existing constraint (if it exists) and add the new one that includes all statuses
ALTER TABLE publish_jobs DROP CONSTRAINT IF EXISTS publish_jobs_status_chk;
ALTER TABLE publish_jobs ADD CONSTRAINT publish_jobs_status_chk CHECK (
  status IN ('queued', 'mcp_validating', 'validated', 'validation_failed', 'cancelled', 'needs_review', 'publishing', 'published', 'failed')
);

-- Outbox table for execution events
CREATE TABLE IF NOT EXISTS publish_execution_events (
  id UUID PRIMARY KEY,
  event_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  job_id UUID NOT NULL,
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE publish_execution_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS publish_execution_events_workspace_rls ON publish_execution_events;
CREATE POLICY publish_execution_events_workspace_rls ON publish_execution_events
  AS RESTRICTIVE
  FOR ALL
  USING (workspace_id = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));
