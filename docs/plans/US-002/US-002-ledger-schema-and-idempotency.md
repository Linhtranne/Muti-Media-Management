# US-002 Ledger Schema and Idempotency Design

## 1. Docs Read

Read and applied in mandatory order:
1. `docs/architecture/06_Architecture_Composability.md`
2. `docs/architecture/11_Coding_Convention.md`
3. `docs/requirements/04_Product_Backlog.md`
4. `docs/requirements/05_Function_Flow_Logic_Register.md`
5. `docs/project-mgmt/07_Risk_Assumption_Decision_Log.md`
6. `docs/requirements/03_SRS_MediaOps_Composability.md`
7. `docs/requirements/13_Sprint_1_Backlog.md`
8. `docs/plans/US-001/US-001-final-implementation-notes.md`
9. `docs/plans/US-001/US-001-middleware-handoff-contract.md`
10. `docs/plans/US-002/PLAN-us-002-airtable-approved-webhook.md`
11. `docs/plans/US-002/US-002-scope-lock.md`

Specialist knowledge applied silently:
- `C:\Users\Hi\.spawner\skills\data\postgres-wizard\skill.yaml`
- `C:\Users\Hi\.spawner\skills\data\postgres-wizard\sharp-edges.yaml`
- `C:\Users\Hi\.spawner\skills\backend\event-architect\skill.yaml`
- `C:\Users\Hi\.spawner\skills\backend\event-architect\sharp-edges.yaml`
- `.agent/agents/database-architect.md`

Conflict priority enforced: Architecture > Coding Convention > Product Backlog > Function Flow Register > US-002 Scope Lock > Plan.

## 2. Design Objective

Define Operational Ledger v1 schema for US-002 Airtable Approved Webhook Workflow to:
- persist webhook/queue/workflow/audit lifecycle,
- enforce production idempotency (`record_id + approved_version`),
- support duplicate detection, retry and DLQ metadata,
- guarantee "Ledger update before ACK" transaction semantics,
- remain additive-migration friendly.

`approved_version` is strictly server-side in Postgres/Operational Ledger and is never added to Airtable.

## 3. Ledger Scope

In scope for this design:
- `webhook_events` lifecycle and idempotency authority
- `queue_events` publishing/consume attempt tracking
- `workflow_runs` stub creation tracking for US-003 handoff
- `audit_logs` append-only operational audit trail

Out of scope:
- real AI generation execution
- real Facebook MCP publish
- Slack integration
- storing any content/body/secret fields from Airtable

## 4. Tables

ID strategy:
- Internal PK uses UUID (`gen_random_uuid()`) to avoid sequential public ID exposure.
- Any API-safe external identifier (if needed later) must be separate and non-sequential.

### 4.1 webhook_events

Purpose: canonical record of each inbound webhook and processing outcome.

```sql
CREATE TABLE webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL,
  source TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_version INTEGER NOT NULL,
  workspace_id TEXT NOT NULL,
  airtable_record_id TEXT NOT NULL,
  airtable_table_name TEXT NOT NULL,
  approval_ref TIMESTAMPTZ NULL,
  approved_version INTEGER NULL,
  idempotency_key TEXT NULL,
  correlation_id TEXT NOT NULL,
  causation_id TEXT NULL,
  status webhook_event_status NOT NULL,
  error_code TEXT NULL,
  error_message TEXT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT webhook_events_event_id_uq UNIQUE (event_id)
);
```

`approved_version` and the production `idempotency_key` are nullable during initial ingestion because the webhook receiver has not yet reloaded and verified the Airtable record. They are assigned only after the worker confirms a fresh, currently valid `Approved` state.

### 4.2 queue_events

Purpose: message publication and processing attempt ledger for queue path.

```sql
CREATE TABLE queue_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_event_id UUID NOT NULL,
  queue_name TEXT NOT NULL,
  routing_key TEXT NOT NULL,
  message_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status queue_event_status NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ NULL,
  last_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT queue_events_webhook_fk
    FOREIGN KEY (webhook_event_id) REFERENCES webhook_events(id),
  CONSTRAINT queue_events_message_id_uq UNIQUE (queue_name, message_id),
  CONSTRAINT queue_events_idempotency_key_uq UNIQUE (idempotency_key)
);
```

### 4.3 workflow_runs

Purpose: one row per approved version workflow stub, no real AI execution in US-002.

```sql
CREATE TABLE workflow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  airtable_record_id TEXT NOT NULL,
  approved_version INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  status workflow_run_status NOT NULL DEFAULT 'pending_ai_generation',
  created_from_webhook_event_id UUID NOT NULL,
  channel_account_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT workflow_runs_unique_per_approval
    UNIQUE (workspace_id, airtable_record_id, approved_version),
  CONSTRAINT workflow_runs_idempotency_key_uq UNIQUE (idempotency_key),
  CONSTRAINT workflow_runs_webhook_fk
    FOREIGN KEY (created_from_webhook_event_id) REFERENCES webhook_events(id)
);
```

`channel_account_refs` stores only safe, token-free channel account metadata resolved by the worker boundary before stub creation. It must never contain platform tokens, vault references, raw copy, CTA URLs, or asset payloads.

### 4.4 audit_logs

Purpose: append-only operational/security audit.

```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Append-only enforcement:
- application role: INSERT only on `audit_logs`
- no UPDATE/DELETE permissions
- optional DB trigger can reject UPDATE/DELETE defensively

## 5. Idempotency Model

Production idempotency identity:
- logical composite: `workspace_id + airtable_record_id + approved_version`
- canonical key string: `airtable.post.approved:{workspace_id}:{airtable_record_id}:{approved_version}`

Rules:
1. Every external event must carry/store a dedupe reference. During initial ingestion this is the unique `event_id` plus `approval_ref`; the production workflow `idempotency_key` is assigned only after fresh valid reload.
2. During initial webhook ingestion, the receiver stores ingress-level dedupe data based on `event_id` and `approval_ref`, but it does not allocate `approved_version`.
3. `webhook_events` uniqueness on `(workspace_id, airtable_record_id, approved_version)` is the production guard after a worker performs fresh reload/reverify.
4. `event_id` uniqueness is transport-level guard, not business-level idempotency.
5. `approved_at`/`approval_ref` is only reconciliation hint; not production dedupe key.

## 6. approved_version Allocation

`approved_version` allocation is server-side only in Ledger (Postgres), never in Airtable.

Allocation flow (single transaction, serializable or row-lock safe):
1. Worker reloads the Airtable record by `record_id`.
2. Worker verifies current status is `Approved`.
3. Worker verifies `is_valid_for_approval = 1`.
4. Worker verifies reloaded `approved_at` matches the webhook `approval_ref`.
5. Only after those checks pass, lock version counter for `(workspace_id, airtable_record_id)` using dedicated counter table.
6. Increment counter by 1 and return new value.
7. Build production `idempotency_key` from the allocated version.
8. Update the existing `webhook_events` row with `approved_version` and production `idempotency_key`.

Ignored, stale, invalid, missing-account, inactive-account, unresolved-account, retryable, and failed branches do not allocate `approved_version` unless they had already passed the fresh valid-approval gate. This prevents stale or duplicate webhook delivery from consuming approval versions.

Recommended helper table:

```sql
CREATE TABLE approval_versions (
  workspace_id TEXT NOT NULL,
  airtable_record_id TEXT NOT NULL,
  current_version INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, airtable_record_id)
);
```

Atomic UPSERT pattern:
- first approval initializes `current_version = 1`
- subsequent approvals increment using `INSERT ... ON CONFLICT ... DO UPDATE SET current_version = approval_versions.current_version + 1 RETURNING current_version`

## 7. Status Enums

```sql
CREATE TYPE webhook_event_status AS ENUM (
  'received',
  'queued',
  'processing',
  'workflow_stub_created',
  'duplicate_ignored',
  'unrelated_ignored',
  'already_advanced_ignored',
  'state_changed_ignored',
  'unknown_status_ignored',
  'invalid_after_reload_ignored',
  'approval_version_mismatch_ignored',
  'channel_account_missing',
  'channel_account_inactive',
  'channel_account_unresolved',
  'retryable_failed',
  'failed'
);

CREATE TYPE queue_event_status AS ENUM (
  'publish_pending',
  'publish_succeeded',
  'publish_failed_retryable',
  'publish_failed_terminal',
  'consumed',
  'acked',
  'nacked_dlq'
);

CREATE TYPE workflow_run_status AS ENUM (
  'pending_ai_generation'
);
```

Enum evolution rule:
- additive only (`ALTER TYPE ... ADD VALUE`), no rename/remove in-place.

## 8. Indexes and Constraints

Required constraints:
- Unique `webhook_events.event_id`.
- Unique production idempotency (`workspace_id, airtable_record_id, approved_version`) and unique `idempotency_key` when these values are present.
- Unique workflow per `workspace_id + airtable_record_id + approved_version`.
- FK `queue_events.webhook_event_id -> webhook_events.id`.
- FK `workflow_runs.created_from_webhook_event_id -> webhook_events.id`.

Required indexes:

```sql
CREATE INDEX webhook_events_record_idx ON webhook_events (airtable_record_id);
CREATE INDEX webhook_events_status_idx ON webhook_events (status);
CREATE INDEX webhook_events_received_at_idx ON webhook_events (received_at DESC);
CREATE UNIQUE INDEX webhook_events_approval_version_uq
  ON webhook_events (workspace_id, airtable_record_id, approved_version)
  WHERE approved_version IS NOT NULL;
CREATE UNIQUE INDEX webhook_events_idempotency_key_uq
  ON webhook_events (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX queue_events_status_idx ON queue_events (status);
CREATE INDEX queue_events_last_attempt_idx ON queue_events (last_attempt_at DESC);

CREATE INDEX workflow_runs_status_idx ON workflow_runs (status);
CREATE INDEX audit_logs_created_at_idx ON audit_logs (created_at DESC);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id);
```

## 9. Transaction Boundaries

1) Webhook receiver nhận event mới
- Begin TX
- Insert `webhook_events(status='received')` with `event_id`, `approval_ref`, correlation metadata, and `approved_version = NULL`
- Insert `audit_logs(action='webhook_received')`
- Commit TX
- Then publish queue message

2) Duplicate event
- Begin TX
- Detect exact transport duplicate via unique `event_id`; detect business duplicate later after fresh reload and production `approved_version` allocation check
- Upsert/mark existing event as `duplicate_ignored` (if needed)
- Insert `audit_logs(action='duplicate_ignored')`
- Commit TX
- ACK immediately (no workflow creation)

3) Publish queue message thành công
- Begin TX
- Insert `queue_events(status='publish_succeeded', attempt_count=1, ...)`
- Update `webhook_events.status='queued', processed_at=NOW()`
- Insert `audit_logs(action='queue_publish_succeeded')`
- Commit TX

4) Queue publish fail sau khi Ledger đã ghi
- Begin TX
- Insert/Update `queue_events(status='publish_failed_retryable' or 'publish_failed_terminal', last_error, attempt_count+1)`
- Update `webhook_events.status='retryable_failed'` or `'failed'`
- Insert `audit_logs(action='queue_publish_failed')`
- Commit TX
- Retry scheduler or DLQ policy handles next step

5) Worker consume message
- Begin TX
- Update `webhook_events.status='processing'`
- Update `queue_events.status='consumed', last_attempt_at=NOW(), attempt_count+1`
- Insert `audit_logs(action='worker_consumed')`
- Commit TX
- Execute reload/reverify logic

6) Worker ACK sau khi Ledger update
- Begin TX
- If branch is valid Approved flow, allocate `approved_version`, set production `idempotency_key`, and enforce partial unique indexes
- Persist final classification status in `webhook_events`
- Create `workflow_runs` only if branch is valid Approved flow
- Update `queue_events.status='acked'`
- Insert `audit_logs(action='worker_acked')`
- Commit TX
- ACK broker only after commit succeeds

7) Worker retryable failure
- Begin TX
- Update `webhook_events.status='retryable_failed', error_code/error_message`
- Update `queue_events.status='publish_failed_retryable'` (or consume-retry equivalent), increment attempts
- Insert `audit_logs(action='worker_retryable_failed')`
- Commit TX
- NACK/requeue according to retry policy

8) Worker terminal failure / DLQ
- Begin TX
- Update `webhook_events.status='failed'` (or one of terminal ignored statuses)
- Update `queue_events.status='nacked_dlq'` when DLQ used
- Insert `audit_logs(action='worker_terminal_failed_or_dlq')`
- Commit TX
- ACK/NACK(broker, requeue=false) per DLQ policy

Invariant: no ACK is sent before transaction commit that records the final ledger state for that attempt.

## 10. Retry and DLQ Metadata

Retry/DLQ support fields:
- `queue_events.attempt_count`
- `queue_events.last_attempt_at`
- `queue_events.last_error`
- `queue_events.status` (retryable vs terminal vs dlq)
- `webhook_events.error_code`, `error_message`, `status`

Recommended metadata keys (JSONB, sanitized):
- `retry_policy`: `{max_attempts, backoff_ms, jitter_ms}`
- `dlq_routed`: boolean
- `dlq_reason`: bounded code string
- `broker_delivery_tag` (if needed, non-secret)

Do not store raw payload content, token, secret, or full Airtable snapshots.

`queue_events.idempotency_key` is the message-level dedupe key for queue publication/consumption. Before production `approved_version` is allocated, it may use an ingress-scoped key such as `airtable.webhook.ingress:{event_id}`. Workflow creation must use the production key `airtable.post.approved:{workspace_id}:{airtable_record_id}:{approved_version}`.

## 11. Audit Model

Audit model is append-only and event-oriented:
- one log row per important state transition
- actor defaults for automation: `actor_type='system'`, `actor_id='webhook_receiver' | 'queue_worker'`
- `entity_type` values: `webhook_event`, `queue_event`, `workflow_run`
- `entity_id` references UUID of target entity
- `metadata` contains sanitized diagnostics only

Append-only rules:
- never mutate prior audit rows
- compensating actions are new rows, not updates

## 12. Security and Privacy Rules

1. Ledger is source of truth for event lifecycle/idempotency/audit.
2. Never store raw token/secret in any column or metadata.
3. Never store `master_copy`, `asset_links`, `cta_url`, or full Airtable snapshots in ledger metadata.
4. Queue payload remains references-only.
5. `approved_version` exists only server-side in Postgres.
6. Correlation fields (`correlation_id`, `causation_id`) are safe IDs, not secrets.
7. `error_message` must be sanitized and bounded length.

## 13. Migration Strategy

Migration strategy is additive-first and rollback-safe.

Phase A (before production data):
- Create tables/types/indexes/constraints in one migration.
- Rollback by dropping newly created objects if needed.

Phase B (after data exists):
- Add columns nullable first.
- Backfill via controlled job.
- Add new constraints/indexes after backfill.
- Use concurrent index creation where possible.
- Avoid destructive changes (drop/rename type value/column) in-place.

Enum/status evolution:
- add new enum values only; never remove/rename existing values.

## 14. Verification Checklist

- [x] Includes 4 tables: `webhook_events`, `queue_events`, `workflow_runs`, `audit_logs`.
- [x] Unique constraint for `webhook_events.event_id`.
- [x] Unique production idempotency via `workspace_id + airtable_record_id + approved_version` and idempotency key.
- [x] Unique workflow per `workspace_id + airtable_record_id + approved_version`.
- [x] FK `queue_events.webhook_event_id -> webhook_events.id`.
- [x] FK `workflow_runs.created_from_webhook_event_id -> webhook_events.id`.
- [x] Index includes `airtable_record_id`, `status`, `received_at`.
- [x] Transaction rules define Ledger update before ACK.
- [x] Supports duplicate detection.
- [x] Supports retry/DLQ metadata.
- [x] Audit append-only rule defined.
- [x] No raw token/content fields in schema.
- [x] No `approved_version` added to Airtable.
- [x] Workflow status default is `pending_ai_generation` (stub only, no real AI call).

## 15. Open Questions / Risks

1. Confirm exact isolation level for `approved_version` allocator under high concurrency (`SERIALIZABLE` vs `READ COMMITTED + FOR UPDATE`).
2. Confirm retention/archival policy for high-volume `audit_logs` and `queue_events`.
3. Confirm maximum error/message lengths and structured `error_code` taxonomy registry.
4. Decide if `workspace_id` should be UUID or opaque string globally for cross-service consistency.
5. Confirm broker-specific metadata fields needed for DLQ reconciliation in operations dashboards.
