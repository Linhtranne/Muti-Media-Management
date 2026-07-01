-- Migration: US-008 Slack Approve/Reject Post Commands
-- Purpose: Creates `slack_command_events` and `workspace_members` tables.

-- 1. Create workspace_members table (role mapping)
CREATE TABLE IF NOT EXISTS workspace_members (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  TEXT NOT NULL,
  slack_user_id TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'viewer',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT workspace_members_role_chk CHECK (role IN ('admin', 'manager', 'viewer', 'creator')),
  CONSTRAINT uq_workspace_members_user UNIQUE (workspace_id, slack_user_id)
);

-- Enable RLS for workspace_members
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_members_workspace_rls ON workspace_members;
CREATE POLICY workspace_members_workspace_rls ON workspace_members
  AS RESTRICTIVE FOR ALL
  USING (workspace_id = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));


-- 2. Create slack_command_events table
CREATE TABLE IF NOT EXISTS slack_command_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      TEXT NOT NULL,
  slack_user_id     TEXT NOT NULL,
  slack_team_id     TEXT NOT NULL,
  command           TEXT NOT NULL,
  action            TEXT NOT NULL,
  args              TEXT NOT NULL,
  target_post_id    TEXT NOT NULL,
  reason            TEXT,
  verified          BOOLEAN NOT NULL DEFAULT false,
  role              TEXT,
  status            TEXT NOT NULL DEFAULT 'received',
  idempotency_key   TEXT NOT NULL UNIQUE,
  correlation_id    TEXT NOT NULL,
  error_code        VARCHAR(80),
  error_message     TEXT,
  airtable_sync_retry_needed BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT slack_command_events_action_chk CHECK (action IN ('approve', 'reject')),
  CONSTRAINT slack_command_events_status_chk CHECK (
    status IN ('received', 'queued', 'succeeded', 'rejected', 'failed', 'duplicate_ignored')
  )
);

-- Indexes for slack_command_events
CREATE INDEX IF NOT EXISTS idx_slack_command_events_workspace_status
  ON slack_command_events (workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_slack_command_events_user
  ON slack_command_events (workspace_id, slack_user_id);

-- Enable RLS for slack_command_events
ALTER TABLE slack_command_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS slack_command_events_workspace_rls ON slack_command_events;
CREATE POLICY slack_command_events_workspace_rls ON slack_command_events
  AS RESTRICTIVE FOR ALL
  USING (workspace_id = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));
