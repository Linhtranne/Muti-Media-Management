-- US-011: Secret Store and OAuth Sessions Hardening

-- 1. Create secret_references table for EncryptedDatabaseSecretStore
CREATE TABLE IF NOT EXISTS secret_references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  purpose TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', -- 'active', 'revoked'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ NULL
);

ALTER TABLE secret_references ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS secret_references_workspace_rls ON secret_references;
CREATE POLICY secret_references_workspace_rls ON secret_references
  USING (workspace_id = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));

-- 2. Create facebook_oauth_sessions table
CREATE TABLE IF NOT EXISTS facebook_oauth_sessions (
  id UUID PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  user_token_ref TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fb_oauth_sessions_expires ON facebook_oauth_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_fb_oauth_sessions_workspace_id ON facebook_oauth_sessions(workspace_id, id);

ALTER TABLE facebook_oauth_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS facebook_oauth_sessions_workspace_rls ON facebook_oauth_sessions;
CREATE POLICY facebook_oauth_sessions_workspace_rls ON facebook_oauth_sessions
  USING (workspace_id = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));

-- 3. Add CHECK constraints to existing token_references (Migration Hardening)
-- Avoid duplicate constraints by doing an add constraint with IF NOT EXISTS logic
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_token_ref_status') THEN
        ALTER TABLE token_references ADD CONSTRAINT chk_token_ref_status CHECK (status IN ('active', 'revoked'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_token_ref_token_status') THEN
        ALTER TABLE token_references ADD CONSTRAINT chk_token_ref_token_status CHECK (token_status IN ('valid', 'invalid', 'expired', 'unknown'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_token_ref_provider') THEN
        ALTER TABLE token_references ADD CONSTRAINT chk_token_ref_provider CHECK (provider IN ('facebook', 'env', 'dbsecret'));
    END IF;
END $$;

-- 4. Add CHECK constraints to existing channel_accounts
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_channel_accounts_permission_status') THEN
        ALTER TABLE channel_accounts ADD CONSTRAINT chk_channel_accounts_permission_status CHECK (permission_status IN ('valid', 'expired', 'missing_permissions', 'unknown'));
    END IF;
END $$;
