-- Migration: US-014 - Event Bus Messages (Idempotency Guard)
-- Additive table for RabbitMQ event deduplication.
-- RLS by workspace_id. Append-only semantics (status updated, never deleted).
--
-- This table is optional — the IdempotencyGuard helper fails open gracefully
-- if this table does not exist. Apply when ready to enable idempotency tracking.

BEGIN;

-- ─── Table ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_bus_messages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      TEXT NOT NULL,
  event_id          TEXT NOT NULL,
  idempotency_key   TEXT NOT NULL,
  event_type        TEXT NOT NULL,
  queue_name        TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'processing'
                      CHECK (status IN ('processing', 'succeeded', 'failed')),
  attempts          INTEGER NOT NULL DEFAULT 1,
  last_error        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Unique constraint — idempotency_key must be unique per workspace
  CONSTRAINT event_bus_messages_idempotency_key_unique
    UNIQUE (workspace_id, idempotency_key)
);

-- ─── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_event_bus_messages_workspace
  ON event_bus_messages (workspace_id);

CREATE INDEX IF NOT EXISTS idx_event_bus_messages_event_id
  ON event_bus_messages (event_id);

CREATE INDEX IF NOT EXISTS idx_event_bus_messages_queue_status
  ON event_bus_messages (queue_name, status);

CREATE INDEX IF NOT EXISTS idx_event_bus_messages_created_at
  ON event_bus_messages (created_at);

-- ─── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE event_bus_messages ENABLE ROW LEVEL SECURITY;

-- Workers run as service role and must set app.current_workspace_id
CREATE POLICY event_bus_messages_workspace_isolation
  ON event_bus_messages
  USING (workspace_id = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));

-- ─── Comments ─────────────────────────────────────────────────────────────────
COMMENT ON TABLE event_bus_messages IS
  'US-014: RabbitMQ event bus idempotency guard. Tracks processing state per event.';
COMMENT ON COLUMN event_bus_messages.idempotency_key IS
  'Globally unique key for deduplication. Format: <event_type>:<workspace_id>:<entity_id>:<version>.';
COMMENT ON COLUMN event_bus_messages.status IS
  'processing = in flight; succeeded = committed to Ledger; failed = moved to DLQ.';

COMMIT;
