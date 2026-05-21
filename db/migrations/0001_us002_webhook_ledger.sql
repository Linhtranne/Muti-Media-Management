CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'webhook_event_status') THEN
    CREATE TYPE webhook_event_status AS ENUM (
      'received',
      'queued',
      'processing',
      'workflow_stub_created',
      'duplicate_ignored',
      'unrelated_ignored',
      'already_advanced_ignored',
      'state_changed_ignored',
      'unknown_status_ignored',
      'invalid_after_reload_ignored',
      'approval_version_mismatch_ignored',
      'channel_account_missing',
      'channel_account_inactive',
      'channel_account_unresolved',
      'retryable_failed',
      'failed'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'queue_event_status') THEN
    CREATE TYPE queue_event_status AS ENUM (
      'queued',
      'published',
      'consumed',
      'acked',
      'nacked',
      'dlq',
      'failed'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workflow_run_status') THEN
    CREATE TYPE workflow_run_status AS ENUM (
      'pending_ai_generation',
      'ai_generation_processing',
      'ai_generation_completed',
      'ai_generation_failed'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_version INTEGER NOT NULL DEFAULT 1,
  workspace_id TEXT NOT NULL,
  airtable_record_id TEXT NOT NULL,
  airtable_table_name TEXT NOT NULL,
  approval_ref TEXT,
  approved_version INTEGER,
  idempotency_key TEXT,
  correlation_id TEXT NOT NULL,
  causation_id TEXT NOT NULL,
  status webhook_event_status NOT NULL DEFAULT 'received',
  error_code VARCHAR(80),
  error_message TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT webhook_events_posts_only_chk CHECK (airtable_table_name = 'Posts')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_webhook_events_workflow_idempotency
  ON webhook_events (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_webhook_events_workspace_status
  ON webhook_events (workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_webhook_events_airtable_record
  ON webhook_events (workspace_id, airtable_record_id);

CREATE INDEX IF NOT EXISTS idx_webhook_events_received_at
  ON webhook_events (received_at);

CREATE TABLE IF NOT EXISTS queue_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_event_id UUID NOT NULL REFERENCES webhook_events(id) ON DELETE RESTRICT,
  workspace_id TEXT NOT NULL,
  queue_name TEXT NOT NULL,
  routing_key TEXT NOT NULL,
  message_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status queue_event_status NOT NULL DEFAULT 'queued',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_queue_events_message_id
  ON queue_events (message_id);

CREATE INDEX IF NOT EXISTS idx_queue_events_workspace_status
  ON queue_events (workspace_id, status);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  airtable_record_id TEXT NOT NULL,
  approved_version INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  status workflow_run_status NOT NULL DEFAULT 'pending_ai_generation',
  channel_account_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_from_webhook_event_id UUID NOT NULL REFERENCES webhook_events(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT workflow_runs_approved_version_positive_chk CHECK (approved_version > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_runs_idempotency
  ON workflow_runs (idempotency_key);

CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_runs_record_version
  ON workflow_runs (workspace_id, airtable_record_id, approved_version);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_workspace_status
  ON workflow_runs (workspace_id, status);

CREATE TABLE IF NOT EXISTS approval_versions (
  workspace_id TEXT NOT NULL,
  airtable_record_id TEXT NOT NULL,
  current_version INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, airtable_record_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  actor_type TEXT NOT NULL DEFAULT 'system',
  actor_id TEXT NOT NULL DEFAULT 'system',
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_workspace_entity
  ON audit_logs (workspace_id, entity_type, entity_id, created_at DESC);

ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE queue_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS webhook_events_workspace_rls ON webhook_events;
CREATE POLICY webhook_events_workspace_rls ON webhook_events
  USING (workspace_id = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));

DROP POLICY IF EXISTS queue_events_workspace_rls ON queue_events;
CREATE POLICY queue_events_workspace_rls ON queue_events
  USING (workspace_id = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));

DROP POLICY IF EXISTS workflow_runs_workspace_rls ON workflow_runs;
CREATE POLICY workflow_runs_workspace_rls ON workflow_runs
  USING (workspace_id = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));

DROP POLICY IF EXISTS approval_versions_workspace_rls ON approval_versions;
CREATE POLICY approval_versions_workspace_rls ON approval_versions
  USING (workspace_id = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));

DROP POLICY IF EXISTS audit_logs_workspace_rls ON audit_logs;
CREATE POLICY audit_logs_workspace_rls ON audit_logs
  USING (workspace_id = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));

