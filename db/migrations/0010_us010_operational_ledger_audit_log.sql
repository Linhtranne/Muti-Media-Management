-- Add new columns if they do not exist
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS correlation_id TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS causation_id TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS severity TEXT NOT NULL DEFAULT 'info';

-- Safely rename action to event_type or backfill if both exist
DO $$
DECLARE
  has_action BOOLEAN;
  has_event_type BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'action') INTO has_action;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'event_type') INTO has_event_type;

  IF has_action AND NOT has_event_type THEN
    ALTER TABLE audit_logs RENAME COLUMN action TO event_type;
  ELSIF has_action AND has_event_type THEN
    UPDATE audit_logs SET event_type = action WHERE event_type IS NULL;
  END IF;
END $$;

-- Create Indexes
CREATE INDEX IF NOT EXISTS idx_audit_logs_workspace_created_at ON audit_logs (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_timeline ON audit_logs (workspace_id, entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type ON audit_logs (workspace_id, event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_correlation ON audit_logs (workspace_id, correlation_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs (workspace_id, actor_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_audit_logs_idempotency ON audit_logs (workspace_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Row Level Security
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_logs_workspace_rls ON audit_logs;
CREATE POLICY audit_logs_workspace_rls ON audit_logs
  AS RESTRICTIVE FOR ALL
  USING (workspace_id = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));

-- Views for Query/Reporting Foundation
CREATE OR REPLACE VIEW audit_entity_timeline AS
SELECT * FROM audit_logs
ORDER BY workspace_id, entity_type, entity_id, created_at DESC;

CREATE OR REPLACE VIEW audit_correlation_timeline AS
SELECT * FROM audit_logs
ORDER BY workspace_id, correlation_id, created_at ASC;

CREATE OR REPLACE VIEW audit_publish_job_timeline AS
SELECT * FROM audit_logs
WHERE entity_type = 'publish_job' OR event_type LIKE 'PUBLISH_%'
ORDER BY workspace_id, entity_id, created_at ASC;

CREATE OR REPLACE VIEW audit_slack_command_timeline AS
SELECT * FROM audit_logs
WHERE entity_type = 'slack_command' OR event_type LIKE 'SLACK_COMMAND_%'
ORDER BY workspace_id, entity_id, created_at ASC;

CREATE OR REPLACE VIEW audit_ai_run_timeline AS
SELECT * FROM audit_logs
WHERE entity_type = 'workflow_run' OR event_type LIKE 'AI_RUN_%'
ORDER BY workspace_id, entity_id, created_at ASC;

-- Append-Only Trigger
CREATE OR REPLACE FUNCTION prevent_audit_logs_update_delete()
RETURNS TRIGGER AS $$
BEGIN
  -- Restrict UPDATE and DELETE for all app usage unless bypassing intentionally
  RAISE EXCEPTION 'audit_logs is append-only. UPDATE and DELETE are not allowed.';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_append_only_audit_logs_update ON audit_logs;
CREATE TRIGGER enforce_append_only_audit_logs_update
BEFORE UPDATE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION prevent_audit_logs_update_delete();

DROP TRIGGER IF EXISTS enforce_append_only_audit_logs_delete ON audit_logs;
CREATE TRIGGER enforce_append_only_audit_logs_delete
BEFORE DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION prevent_audit_logs_update_delete();
