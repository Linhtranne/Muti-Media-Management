-- US-006 publish execution lifecycle statuses.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workflow_run_status') THEN
    ALTER TYPE workflow_run_status ADD VALUE IF NOT EXISTS 'mcp_publish_completed';
    ALTER TYPE workflow_run_status ADD VALUE IF NOT EXISTS 'mcp_publish_failed';
  END IF;
END $$;
