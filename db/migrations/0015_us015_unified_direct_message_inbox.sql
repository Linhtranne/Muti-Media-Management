-- Migration: US-015 - Unified Direct Message Inbox
-- Additive tables for direct message conversations, messages, and reply jobs.
-- RLS workspace isolation enforced on all tables.

BEGIN;

-- 1. Conversations Table
CREATE TABLE IF NOT EXISTS conversations (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id              TEXT NOT NULL,
  platform                  TEXT NOT NULL CHECK (platform IN ('facebook', 'instagram', 'zalo')),
  channel_account_id        UUID NOT NULL REFERENCES channel_accounts(id) ON DELETE RESTRICT,
  external_thread_id        TEXT NOT NULL,
  customer_ref              JSONB NOT NULL DEFAULT '{}', -- { name, external_user_id }
  customer_display_name     TEXT,
  status                    TEXT NOT NULL DEFAULT 'new'
                              CHECK (status IN ('new', 'assigned', 'waiting', 'resolved', 'escalated')),
  assigned_to_member_id     UUID REFERENCES workspace_members(id) ON DELETE SET NULL,
  assigned_slack_user_id    TEXT,
  last_message_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sla_due_at                TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_conversations_workspace_platform_external
    UNIQUE (workspace_id, platform, external_thread_id)
);

-- 2. Conversation Messages Table
CREATE TABLE IF NOT EXISTS conversation_messages (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          TEXT NOT NULL,
  conversation_id       UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  external_message_id   TEXT NOT NULL,
  direction             TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  sender_type           TEXT NOT NULL CHECK (sender_type IN ('customer', 'agent', 'bot')),
  body                  TEXT, -- Plaintext Ledger storage (protected by RLS)
  body_redacted         TEXT, -- Redacted version for external tools/Slack
  attachments_ref       JSONB NOT NULL DEFAULT '[]', -- [{ type, url_ref, id }]
  created_at_platform   TIMESTAMPTZ NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_conversation_messages_external
    UNIQUE (workspace_id, conversation_id, external_message_id)
);

-- 3. Direct Message Reply Jobs Table
CREATE TABLE IF NOT EXISTS direct_message_reply_jobs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          TEXT NOT NULL,
  conversation_id       UUID NOT NULL REFERENCES conversations(id) ON DELETE RESTRICT,
  message_id            UUID REFERENCES conversation_messages(id) ON DELETE SET NULL,
  actor_id              UUID REFERENCES workspace_members(id) ON DELETE RESTRICT,
  reply_body            TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'received'
                          CHECK (status IN ('received', 'queued', 'processing', 'succeeded', 'failed', 'rejected')),
  idempotency_key       TEXT NOT NULL,
  platform_result_ref   JSONB NOT NULL DEFAULT '{}',
  error_code            TEXT,
  error_message         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_dm_reply_jobs_idempotency
    UNIQUE (workspace_id, idempotency_key)
);

-- Indexes for performance & SLA monitoring
CREATE INDEX IF NOT EXISTS idx_conversations_workspace_status ON conversations (workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_conversations_workspace_assigned ON conversations (workspace_id, assigned_to_member_id);
CREATE INDEX IF NOT EXISTS idx_conversations_last_message ON conversations (workspace_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_sla ON conversations (workspace_id, sla_due_at) WHERE status != 'resolved';
CREATE INDEX IF NOT EXISTS idx_conversation_messages_lookup ON conversation_messages (workspace_id, conversation_id, created_at_platform);
CREATE INDEX IF NOT EXISTS idx_dm_reply_jobs_status ON direct_message_reply_jobs (workspace_id, status);

-- Enable RLS and isolate by workspace_id
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE direct_message_reply_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY conversations_workspace_isolation ON conversations
  AS RESTRICTIVE FOR ALL
  USING (workspace_id = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));

CREATE POLICY conversation_messages_workspace_isolation ON conversation_messages
  AS RESTRICTIVE FOR ALL
  USING (workspace_id = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));

CREATE POLICY dm_reply_jobs_workspace_isolation ON direct_message_reply_jobs
  AS RESTRICTIVE FOR ALL
  USING (workspace_id = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));

-- Triggers to automatically update updated_at on conversations and reply jobs
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_conversations_updated_at ON conversations;
CREATE TRIGGER set_conversations_updated_at
BEFORE UPDATE ON conversations
FOR EACH ROW
EXECUTE FUNCTION trigger_set_updated_at();

DROP TRIGGER IF EXISTS set_dm_reply_jobs_updated_at ON direct_message_reply_jobs;
CREATE TRIGGER set_dm_reply_jobs_updated_at
BEFORE UPDATE ON direct_message_reply_jobs
FOR EACH ROW
EXECUTE FUNCTION trigger_set_updated_at();

-- Comments
COMMENT ON TABLE conversations IS 'US-015: Unified DM conversations across platforms.';
COMMENT ON TABLE conversation_messages IS 'US-015: Unified DM conversation messages.';
COMMENT ON TABLE direct_message_reply_jobs IS 'US-015: Outbound DM reply jobs dispatched from Slack.';

COMMIT;
