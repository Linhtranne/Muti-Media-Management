-- Migration: 0007_us007_facebook_comment_sync.sql

-- -----------------------------------------------------------------------
-- interactions: parent entity for any inbound user engagement
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS interactions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        TEXT NOT NULL,
  platform            TEXT NOT NULL,                  -- 'facebook'
  external_id         TEXT NOT NULL,                  -- platform's comment ID
  -- publish_job_id: FK to publish_jobs (the Ledger job that produced the post being commented on)
  publish_job_id      UUID REFERENCES publish_jobs(id) ON DELETE RESTRICT,
  -- airtable_record_id: denormalized for fast campaign/post reporting without joining publish_jobs
  airtable_record_id  TEXT,
  -- external_post_id: the Facebook post ID on the platform (e.g. '12345678_99999999')
  -- stored for direct Graph API permalink construction and future sync reconciliation
  external_post_id    TEXT NOT NULL,
  author_ref          JSONB NOT NULL DEFAULT '{}',    -- { name, external_user_id } only, no PII beyond display name
  interaction_type    TEXT NOT NULL DEFAULT 'comment',
  status              TEXT NOT NULL DEFAULT 'new',    -- 'new', 'acknowledged', 'resolved', 'escalated'
  risk_code           TEXT NOT NULL DEFAULT 'NORMAL', -- 'NORMAL', 'CRISIS'
  resolved_at         TIMESTAMPTZ,
  created_at_platform TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT interactions_platform_chk CHECK (platform IN ('facebook', 'instagram', 'zalo')),
  CONSTRAINT interactions_status_chk CHECK (status IN ('new', 'acknowledged', 'resolved', 'escalated')),
  CONSTRAINT interactions_risk_code_chk CHECK (risk_code IN ('NORMAL', 'CRISIS')),
  CONSTRAINT uq_interactions_workspace_platform_external
    UNIQUE (workspace_id, platform, external_id)
);

CREATE INDEX IF NOT EXISTS idx_interactions_workspace_status
  ON interactions (workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_interactions_workspace_risk
  ON interactions (workspace_id, risk_code) WHERE risk_code = 'CRISIS';
CREATE INDEX IF NOT EXISTS idx_interactions_publish_job
  ON interactions (publish_job_id);
CREATE INDEX IF NOT EXISTS idx_interactions_external_post
  ON interactions (workspace_id, platform, external_post_id);

-- -----------------------------------------------------------------------
-- comments: comment-specific data linked to interaction
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interaction_id  UUID NOT NULL REFERENCES interactions(id) ON DELETE CASCADE,
  workspace_id    TEXT NOT NULL,
  body            TEXT,                             -- full body (see OQ-007-2)
  body_preview    TEXT,                             -- first 80 chars, always populated
  permalink       TEXT,                             -- REQUIRED per AC4
  reply_count     INTEGER NOT NULL DEFAULT 0,
  like_count      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_comments_interaction
  ON comments (interaction_id);

-- -----------------------------------------------------------------------
-- comment_sync_events: outbox/tracking for sync dispatch
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comment_sync_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          UUID NOT NULL,
  event_type        TEXT NOT NULL,
  workspace_id      TEXT NOT NULL,
  job_id            UUID NOT NULL REFERENCES publish_jobs(id) ON DELETE RESTRICT,
  idempotency_key   TEXT UNIQUE NOT NULL,
  status            TEXT NOT NULL DEFAULT 'dispatched', -- 'dispatched', 'completed', 'failed'
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------
-- slack_comment_alerts: tracks which comments had Slack alerts sent
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS slack_comment_alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interaction_id  UUID NOT NULL REFERENCES interactions(id) ON DELETE RESTRICT,
  workspace_id    TEXT NOT NULL,
  channel_id      TEXT NOT NULL,
  channel_type    TEXT NOT NULL,   -- 'crisis', 'inbox'
  alert_type      TEXT NOT NULL,   -- 'comment_risk', 'comment_normal'
  message_ts      TEXT,            -- Slack message timestamp (for threading later)
  status          TEXT NOT NULL DEFAULT 'sent',   -- 'sent', 'pending_config', 'failed'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_slack_comment_alerts_interaction
    UNIQUE (interaction_id)         -- one alert per interaction (idempotency)
);

-- publish_jobs: add comment sync tracking column
ALTER TABLE publish_jobs
  ADD COLUMN IF NOT EXISTS last_comment_sync_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS comment_sync_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- -----------------------------------------------------------------------
-- RLS — all tables workspace-scoped, AS RESTRICTIVE
-- -----------------------------------------------------------------------
ALTER TABLE interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE comment_sync_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE slack_comment_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS interactions_workspace_rls ON interactions;
CREATE POLICY interactions_workspace_rls ON interactions
  AS RESTRICTIVE FOR ALL
  USING (workspace_id = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));

DROP POLICY IF EXISTS comments_workspace_rls ON comments;
CREATE POLICY comments_workspace_rls ON comments
  AS RESTRICTIVE FOR ALL
  USING (workspace_id = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));

DROP POLICY IF EXISTS comment_sync_events_workspace_rls ON comment_sync_events;
CREATE POLICY comment_sync_events_workspace_rls ON comment_sync_events
  AS RESTRICTIVE FOR ALL
  USING (workspace_id = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));

DROP POLICY IF EXISTS slack_comment_alerts_workspace_rls ON slack_comment_alerts;
CREATE POLICY slack_comment_alerts_workspace_rls ON slack_comment_alerts
  AS RESTRICTIVE FOR ALL
  USING (workspace_id = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));
