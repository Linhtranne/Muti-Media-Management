-- Migration: US-009 Slack Reply and Escalate Facebook Comment
-- Purpose: Support role, comment_action_events, and interactions fallback

BEGIN;

-- 1. Extend workspace_members.role to include 'support'
ALTER TABLE workspace_members DROP CONSTRAINT IF EXISTS workspace_members_role_chk;
ALTER TABLE workspace_members ADD CONSTRAINT workspace_members_role_chk 
    CHECK (role IN ('admin', 'manager', 'viewer', 'creator', 'support'));

-- 2. Create interactions table (fallback if US-007 is missing)
CREATE TABLE IF NOT EXISTS interactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT 'facebook',
    external_id TEXT NOT NULL,
    external_post_id TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    permalink TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT interactions_status_chk CHECK (status IN ('new', 'acknowledged', 'resolved', 'escalated')),
    CONSTRAINT uq_interactions_workspace_platform_external UNIQUE (workspace_id, platform, external_id)
);

-- Enable RLS for interactions
ALTER TABLE interactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS interactions_workspace_rls ON interactions;
CREATE POLICY interactions_workspace_rls ON interactions
    AS RESTRICTIVE FOR ALL
    USING (workspace_id = current_setting('app.current_workspace_id', true))
    WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));

-- 3. Create comment_action_events
CREATE TABLE IF NOT EXISTS comment_action_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id TEXT NOT NULL,
    interaction_id UUID NOT NULL,
    slack_user_id TEXT NOT NULL,
    slack_team_id TEXT NOT NULL,
    command TEXT NOT NULL,
    action TEXT NOT NULL,
    message TEXT,
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'received',
    role TEXT,
    external_reply_id TEXT,
    idempotency_key TEXT NOT NULL,
    correlation_id TEXT NOT NULL,
    error_code TEXT,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT comment_action_events_action_chk CHECK (action IN ('reply', 'escalate')),
    CONSTRAINT comment_action_events_status_chk CHECK (
        status IN ('received', 'queued', 'processing', 'succeeded', 'rejected', 'failed')
    ),
    CONSTRAINT uq_comment_action_events_idempotency UNIQUE (workspace_id, idempotency_key)
);

-- Indexes for comment_action_events
CREATE INDEX IF NOT EXISTS idx_comment_action_events_workspace_status
    ON comment_action_events (workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_comment_action_events_interaction
    ON comment_action_events (interaction_id);

CREATE INDEX IF NOT EXISTS idx_comment_action_events_user
    ON comment_action_events (workspace_id, slack_user_id);

-- Enable RLS for comment_action_events
ALTER TABLE comment_action_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS comment_action_events_workspace_rls ON comment_action_events;
CREATE POLICY comment_action_events_workspace_rls ON comment_action_events
    AS RESTRICTIVE FOR ALL
    USING (workspace_id = current_setting('app.current_workspace_id', true))
    WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));

COMMIT;
