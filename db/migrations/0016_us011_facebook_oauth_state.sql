BEGIN;

CREATE TABLE IF NOT EXISTS facebook_oauth_states (
  state UUID PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_facebook_oauth_states_expiry
  ON facebook_oauth_states (workspace_id, expires_at);

ALTER TABLE facebook_oauth_states ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS facebook_oauth_states_workspace_rls ON facebook_oauth_states;
CREATE POLICY facebook_oauth_states_workspace_rls ON facebook_oauth_states
  AS RESTRICTIVE FOR ALL
  USING (workspace_id = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));

COMMIT;
