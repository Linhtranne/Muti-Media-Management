DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workflow_run_status') THEN
    ALTER TYPE workflow_run_status ADD VALUE IF NOT EXISTS 'policy_evaluation_completed';
    ALTER TYPE workflow_run_status ADD VALUE IF NOT EXISTS 'policy_evaluation_blocked';
    ALTER TYPE workflow_run_status ADD VALUE IF NOT EXISTS 'policy_evaluation_failed';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS publish_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  variant_id UUID NOT NULL REFERENCES content_variants(id) ON DELETE RESTRICT,
  channel_account_id TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT publish_jobs_status_chk CHECK (status IN ('queued', 'publishing', 'published', 'failed', 'cancelled', 'needs_review'))
);

CREATE INDEX IF NOT EXISTS idx_publish_jobs_workspace_status
  ON publish_jobs (workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_publish_jobs_post
  ON publish_jobs (workspace_id, post_id);

CREATE TABLE IF NOT EXISTS publish_rule_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  variant_id UUID NOT NULL REFERENCES content_variants(id) ON DELETE RESTRICT,
  workflow_run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE RESTRICT,
  ai_generation_run_id UUID NOT NULL REFERENCES ai_generation_runs(id) ON DELETE RESTRICT,
  allowed BOOLEAN NOT NULL,
  blockers JSONB NOT NULL DEFAULT '[]'::jsonb,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  checks JSONB NOT NULL DEFAULT '[]'::jsonb,
  policy_version TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  airtable_sync_retry_needed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_policy_result_per_variant UNIQUE (workspace_id, variant_id, policy_version)
);

CREATE INDEX IF NOT EXISTS idx_publish_rule_results_variant
  ON publish_rule_results (workspace_id, variant_id);

CREATE INDEX IF NOT EXISTS idx_publish_rule_results_post
  ON publish_rule_results (workspace_id, post_id);

CREATE TABLE IF NOT EXISTS publish_handoff_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL DEFAULT 'publish.facebook.requested',
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
  CONSTRAINT publish_handoff_events_type_chk CHECK (event_type = 'publish.facebook.requested'),
  CONSTRAINT publish_handoff_events_status_chk CHECK (status IN ('pending', 'published', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_publish_handoff_events_pending
  ON publish_handoff_events (workspace_id, status, created_at)
  WHERE status = 'pending';

ALTER TABLE publish_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE publish_rule_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE publish_handoff_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS publish_jobs_workspace_rls ON publish_jobs;
CREATE POLICY publish_jobs_workspace_rls ON publish_jobs
  USING (workspace_id = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));

DROP POLICY IF EXISTS publish_rule_results_workspace_rls ON publish_rule_results;
CREATE POLICY publish_rule_results_workspace_rls ON publish_rule_results
  USING (workspace_id = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));

DROP POLICY IF EXISTS publish_handoff_events_workspace_rls ON publish_handoff_events;
CREATE POLICY publish_handoff_events_workspace_rls ON publish_handoff_events
  USING (workspace_id = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));

