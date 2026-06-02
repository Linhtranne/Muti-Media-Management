-- US-011: Admin Facebook Page Config Migration

-- 1. Add new tracking columns to channel_accounts
ALTER TABLE channel_accounts ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ NULL;
ALTER TABLE channel_accounts ADD COLUMN IF NOT EXISTS permission_status TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE channel_accounts ADD COLUMN IF NOT EXISTS permission_error_code TEXT NULL;

-- 2. Make airtable_channel_account_record_id nullable for API-first connections
ALTER TABLE channel_accounts ALTER COLUMN airtable_channel_account_record_id DROP NOT NULL;

-- 3. Add unique constraint for (workspace_id, platform, external_account_id) for Multi-Page support
ALTER TABLE channel_accounts DROP CONSTRAINT IF EXISTS uq_channel_accounts_external_id;
ALTER TABLE channel_accounts ADD CONSTRAINT uq_channel_accounts_external_id UNIQUE (workspace_id, platform, external_account_id);

-- 4. Create token_references table (provider-agnostic)
CREATE TABLE IF NOT EXISTS token_references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_account_id UUID NOT NULL REFERENCES channel_accounts(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  secret_ref TEXT NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  expires_at TIMESTAMPTZ NULL,
  status TEXT NOT NULL DEFAULT 'active', -- 'active', 'revoked'
  token_status TEXT NOT NULL DEFAULT 'valid', -- 'valid', 'invalid', 'expired'
  last_checked_at TIMESTAMPTZ NULL,
  revoked_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Ensure only one active token per channel_account
CREATE UNIQUE INDEX IF NOT EXISTS uq_token_refs_active 
  ON token_references (channel_account_id) 
  WHERE status = 'active';

-- 6. Apply RLS
ALTER TABLE token_references ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS token_references_workspace_rls ON token_references;
CREATE POLICY token_references_workspace_rls ON token_references
  USING (workspace_id = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));

-- 7. Backfill existing tokens from channel_accounts
INSERT INTO token_references (
  channel_account_id,
  workspace_id,
  provider,
  secret_ref,
  scopes,
  status,
  token_status
)
SELECT 
  id,
  workspace_id,
  platform,
  secret_ref,
  '{}'::TEXT[],
  'active',
  token_status
FROM channel_accounts
WHERE secret_ref IS NOT NULL
ON CONFLICT (channel_account_id) WHERE status = 'active' DO NOTHING;
