DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workflow_run_status') THEN
    ALTER TYPE workflow_run_status ADD VALUE IF NOT EXISTS 'mcp_validation_completed';
  END IF;
END $$;

ALTER TABLE publish_jobs 
  ADD COLUMN IF NOT EXISTS mcp_validation_idempotency_key TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS mcp_validation_result JSONB,
  ADD COLUMN IF NOT EXISTS validated_at TIMESTAMPTZ;

ALTER TABLE publish_jobs DROP CONSTRAINT IF EXISTS publish_jobs_status_chk;
ALTER TABLE publish_jobs ADD CONSTRAINT publish_jobs_status_chk 
  CHECK (status IN ('queued', 'mcp_validating', 'validated', 'validation_failed', 'publishing', 'published', 'failed', 'cancelled', 'needs_review'));

CREATE TABLE IF NOT EXISTS mcp_validation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL DEFAULT 'publish.facebook.validated',
  event_version INTEGER NOT NULL DEFAULT 1,
  workspace_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  workflow_run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE RESTRICT,
  job_id UUID NOT NULL REFERENCES publish_jobs(id) ON DELETE RESTRICT,
  variant_id UUID NOT NULL REFERENCES content_variants(id) ON DELETE RESTRICT,
  channel_account_id TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ NULL,
  validated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT mcp_validation_events_type_chk CHECK (event_type = 'publish.facebook.validated'),
  CONSTRAINT mcp_validation_events_status_chk CHECK (status IN ('pending', 'published', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_mcp_validation_events_pending
  ON mcp_validation_events (workspace_id, status, created_at)
  WHERE status = 'pending';

ALTER TABLE mcp_validation_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mcp_validation_events_workspace_rls ON mcp_validation_events;
CREATE POLICY mcp_validation_events_workspace_rls ON mcp_validation_events
  USING (workspace_id = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));
