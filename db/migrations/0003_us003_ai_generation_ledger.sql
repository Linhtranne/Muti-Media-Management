DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ai_generation_status') THEN
    CREATE TYPE ai_generation_status AS ENUM (
      'queued',
      'processing',
      'completed',
      'needs_manual_review',
      'retryable_failed',
      'failed'
    );
  END IF;
END $$;

-- 1. ai_generation_runs
CREATE TABLE IF NOT EXISTS ai_generation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  workflow_run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE RESTRICT,
  airtable_record_id TEXT NOT NULL,
  approved_version INTEGER NOT NULL,
  platform TEXT NOT NULL DEFAULT 'facebook',
  idempotency_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  input_snapshot JSONB NOT NULL,
  notion_context_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  output_snapshot JSONB NULL,
  status ai_generation_status NOT NULL DEFAULT 'queued',
  error_code VARCHAR(50) NULL,
  error_message TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ NULL,
  CONSTRAINT ai_generation_runs_approved_version_positive_chk CHECK (approved_version > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_generation_runs_idempotency 
  ON ai_generation_runs (idempotency_key);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_generation_runs_wf_platform_prompt 
  ON ai_generation_runs (workspace_id, workflow_run_id, platform, prompt_version);

CREATE INDEX IF NOT EXISTS idx_ai_generation_runs_workspace_status 
  ON ai_generation_runs (workspace_id, status);

-- 2. content_variants
CREATE TABLE IF NOT EXISTS content_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  ai_generation_run_id UUID NOT NULL REFERENCES ai_generation_runs(id) ON DELETE RESTRICT,
  workflow_run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE RESTRICT,
  airtable_record_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  body TEXT NOT NULL,
  hashtags JSONB NOT NULL DEFAULT '[]'::jsonb,
  cta_url TEXT NULL,
  approval_status TEXT NOT NULL DEFAULT 'needs_review',
  policy_status TEXT NOT NULL DEFAULT 'pending_policy',
  sync_retry_needed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT content_variants_platform_chk CHECK (platform = 'facebook')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_content_variants_active_draft 
  ON content_variants (workspace_id, workflow_run_id, platform);

CREATE INDEX IF NOT EXISTS idx_content_variants_sync_retry
  ON content_variants (workspace_id, id)
  WHERE sync_retry_needed = true;

CREATE INDEX IF NOT EXISTS idx_content_variants_workspace_status 
  ON content_variants (workspace_id, approval_status, policy_status);

-- 3. policy_handoff_events
CREATE TABLE IF NOT EXISTS policy_handoff_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL DEFAULT 'policy.evaluate.requested',
  event_version INTEGER NOT NULL DEFAULT 1,
  workspace_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  workflow_run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE RESTRICT,
  ai_generation_run_id UUID NOT NULL REFERENCES ai_generation_runs(id) ON DELETE RESTRICT,
  content_variant_id UUID NOT NULL REFERENCES content_variants(id) ON DELETE RESTRICT,
  airtable_record_id TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'facebook',
  prompt_version TEXT NOT NULL,
  approved_version INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'queued', -- 'queued', 'published', 'failed'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_policy_handoff_events_workspace_status 
  ON policy_handoff_events (workspace_id, status);

-- 4. Enable Row Level Security
ALTER TABLE ai_generation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_handoff_events ENABLE ROW LEVEL SECURITY;

-- 5. Create RLS Policies
DROP POLICY IF EXISTS ai_generation_runs_workspace_rls ON ai_generation_runs;
CREATE POLICY ai_generation_runs_workspace_rls ON ai_generation_runs
  USING (workspace_id = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));

DROP POLICY IF EXISTS content_variants_workspace_rls ON content_variants;
CREATE POLICY content_variants_workspace_rls ON content_variants
  USING (workspace_id = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));

DROP POLICY IF EXISTS policy_handoff_events_workspace_rls ON policy_handoff_events;
CREATE POLICY policy_handoff_events_workspace_rls ON policy_handoff_events
  USING (workspace_id = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));
