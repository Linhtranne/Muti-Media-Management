CREATE TABLE IF NOT EXISTS channel_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  airtable_channel_account_record_id TEXT NOT NULL,
  external_account_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', -- 'active', 'inactive'
  token_status TEXT NOT NULL DEFAULT 'unknown', -- 'valid', 'expired', 'missing', 'unknown'
  secret_ref TEXT NOT NULL, -- Secret vault locator, e.g., 'vault://fb_token_rec123'
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT channel_accounts_airtable_record_uq UNIQUE (workspace_id, airtable_channel_account_record_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_channel_accounts_lookup_idx
  ON channel_accounts (workspace_id, airtable_channel_account_record_id);

ALTER TABLE channel_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS channel_accounts_workspace_rls ON channel_accounts;
CREATE POLICY channel_accounts_workspace_rls ON channel_accounts
  USING (workspace_id = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));
