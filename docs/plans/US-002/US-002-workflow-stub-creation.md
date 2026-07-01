# AI-SDLC Retrofit Header for US-002

status: approved

## Goal

Maintain US-002 behavior for Airtable Approved Webhook Workflow Trigger according to the approved backlog, function flow, and implementation evidence.

## Tasks

- AC-001: Preserve the documented trigger, processing, and output workflow.
- AC-002: Preserve tenant isolation, idempotency, and durable Ledger/audit evidence where applicable.
- AC-003: Preserve zero-token and reference-only security boundaries.
- AC-004: Keep the story compatible with build, lint, tests, and AI-SDLC artifact validation.

## Done When

- AC-001: Story workflow matches the accepted implementation report and function flow register.
- AC-002: Ledger, idempotency, queue, and role/security constraints are documented or tested where applicable.
- AC-003: No raw tokens or oversized/raw provider payloads cross forbidden boundaries.
- AC-004: `npm run ai-sdlc:check -- US-002` passes after retrofit artifacts are present.

# US-002 Workflow Stub Creation

## 1. Docs Read

This technical design document is fully aligned with the architectural constraints and operational rules defined in the following 17 project documents, analyzed in chronological order:

1. **P0** | [06_Architecture_Composability.md](file:///d:/Muti-Media%20Management/docs/architecture/06_Architecture_Composability.md) — Confirmed Airtable acts strictly as a Control Plane; middleware owns webhook/reload/idempotency; RabbitMQ is the async queue; Postgres is the durable Ledger.
2. **P0** | [11_Coding_Convention.md](file:///d:/Muti-Media%20Management/docs/architecture/11_Coding_Convention.md) — Enforced TS conventions, references-only queue messages, Zero Token Logging in files/audit/Slack, and the strict requirement that workers acknowledge messages *only* after durable database transactions commit.
3. **P1** | [04_Product_Backlog.md](file:///d:/Muti-Media%20Management/docs/requirements/04_Product_Backlog.md) — Audited US-002 User Story, AC1-AC4 for Approved webhook ledger logs, deduplication, and error status handling.
4. **P1** | [05_Function_Flow_Logic_Register.md](file:///d:/Muti-Media%20Management/docs/requirements/05_Function_Flow_Logic_Register.md) — Incorporated the complete `FL-001` revalidation logic, states, and error handling matrix.
5. **P2** | [07_Risk_Assumption_Decision_Log.md](file:///d:/Muti-Media%20Management/docs/project-mgmt/07_Risk_Assumption_Decision_Log.md) — Integrated decision `D-003` (durable SQL ledger) and risk mitigation for token leakage.
6. **P2** | [03_SRS_MediaOps_Composability.md](file:///d:/Muti-Media%20Management/docs/requirements/03_SRS_MediaOps_Composability.md) — Adhered to NFR for strict data boundary isolation and fail-closed security.
7. **P2** | [13_Sprint_1_Backlog.md](file:///d:/Muti-Media%20Management/docs/requirements/13_Sprint_1_Backlog.md) — Maintained scope alignment within the boundaries of Sprint 1.
8. **P0** | [US-001-final-implementation-notes.md](file:///d:/Muti-Media%20Management/docs/plans/US-001/US-001-final-implementation-notes.md) — Verified the physical Airtable schemas and custom field configurations.
9. **P0** | [US-001-middleware-handoff-contract.md](file:///d:/Muti-Media%20Management/docs/plans/US-001/US-001-middleware-handoff-contract.md) — Adopted the references-only messaging contract and zero-trust pull-and-verify model.
10. **P0** | [PLAN-us-002-airtable-approved-webhook.md](file:///d:/Muti-Media%20Management/docs/plans/US-002/PLAN-us-002-airtable-approved-webhook.md) — Aligned with the high-level task breakdown, scheduling boundaries, and dependencies for T-009.
11. **P0** | [US-002-scope-lock.md](file:///d:/Muti-Media%20Management/docs/plans/US-002/US-002-scope-lock.md) — Confirmed out-of-scope boundaries (e.g., no active AI generation or platform publishing under US-002).
12. **P0** | [US-002-ledger-schema-and-idempotency.md](file:///d:/Muti-Media%20Management/docs/plans/US-002/US-002-ledger-schema-and-idempotency.md) — Extended Postgres ledger definitions, transaction lifecycle, and index layouts.
13. **P0** | [US-002-shared-event-and-ledger-contracts.md](file:///d:/Muti-Media%20Management/docs/plans/US-002/US-002-shared-event-and-ledger-contracts.md) — Adopted the shared TypeScript contracts and taxonomy structures.
14. **P0** | [US-002-webhook-receiver-api-design.md](file:///d:/Muti-Media%20Management/docs/plans/US-002/US-002-webhook-receiver-api-design.md) — Synced with webhook receiver data flow.
15. **P0** | [US-002-rabbitmq-topology-approved-post.md](file:///d:/Muti-Media%20Management/docs/plans/US-002/US-002-rabbitmq-topology-approved-post.md) — Verified the routing exchange, staged retries, and dead-letter queues.
16. **P0** | [US-002-approved-post-worker-reload-reverify.md](file:///d:/Muti-Media%20Management/docs/plans/US-002/US-002-approved-post-worker-reload-reverify.md) — Mapped T-007 revalidation rules, transaction boundaries, and state classification logic.
17. **P0** | [US-002-channel-account-resolution-boundary.md](file:///d:/Muti-Media%20Management/docs/plans/US-002/US-002-channel-account-resolution-boundary.md) — Evaluated T-008 channel account resolver boundaries and safe metadata models.

**Spawner Specialist Skills Applied:**
- `~/.spawner/skills/backend/event-architect/` (Event-driven boundary design, idempotency patterns, event payloads)
- `~/.spawner/skills/data/postgres-wizard/` (Covering indexes, composite constraints, concurrency handling, serializable safety)
- `.agent/agents/backend-specialist.md` (Strict TS typing, structured interface architecture)
- `.agent/agents/database-architect.md` (Referential integrity, transaction atomicity, lock minimization)

---

## 2. Objective

The primary objective of the **Workflow Stub Creation (T-009)** is to establish a secure, transactionally sound downstream handoff contract for Epic E02 (AI Orchestration / US-003).

Specifically, once the worker (T-007) successfully reloads and reverifies a fresh `Approved` post, and the channel account resolver (T-008) yields validated, token-free display account metadata, the system creates a durable operational record in the Postgres ledger:
1. Inserts a row in the `workflow_runs` table with a fixed status of `pending_ai_generation`.
2. Persists resolved target channel stubs using a safe, token-free `channel_account_refs` JSONB field in `workflow_runs`.
3. Ensures strict database-level unique constraints and advisory row-locking to guarantee that each `workspace_id + airtable_record_id + approved_version` creates exactly one workflow stub.
4. Executes the ledger update inside Transaction B, committing the database changes *before* sending an Acknowledgment (ACK) to the RabbitMQ broker.

---

## 3. Scope

### In Scope
- Designing the strict, token-free TypeScript interface and database schema for `workflow_runs`.
- Formulating the Postgres additive DDL migration script to add `channel_account_refs` to `workflow_runs`.
- Mapping the exact sequence of SQL queries and lock scopes inside Transaction B.
- Designing the duplicate validation logic to detect transport-level vs. business-level duplicates, ensuring safe redelivery handling.
- Designing the append-only operational audit trail for workflow stub transitions.
- Defining the dual-layer environment-aware rollback security boundary to protect production data while permitting test stub cleanups.
- Creating comprehensive mock test scenarios covering happy paths, redeliveries, version bumps, and network/transaction failures.

### Out of Scope (strictly deferred to US-003 / US-005)
- Calling the real AI Composer Agent (US-003) or Meta OpenAI wrappers.
- Calling the Facebook MCP Server (`validate_post`, `publish_post`, etc.) or Meta Graph API.
- Generating or enqueuing real platform publish jobs (`publish_jobs`).
- Generating Slack alerts, chat logs, or parsing Slack slash commands.
- Reading or resolving secure cryptographic credentials or platform OAuth tokens (handled downstream in T-008/US-011).

---

## 4. Preconditions

The creation of a `workflow_runs` stub is conditionally gated. A stub is created **only** if the following criteria are met:
1. **Queue Ingestion Invariant:** Ingress signal message has been consumed from `airtable.webhook.approved` and has successfully passed the T-007 revalidation flow.
2. **Reload Status Validation:** Reloaded state from Airtable API yields `status == "Approved"`.
3. **Formula Validation:** Reloaded record evaluates to `is_valid_for_approval = 1` (calculated server-side/Airtable formula indicating a master copy exists, schedule is valid, and stubs are attached).
4. **Approval Timestamp Reference Check:** Reloaded `approved_at` timestamp matches the queue-ingress `approval_ref` timestamp.
5. **Channel Account Revalidation:** The target Facebook channel successfully resolves to an active, connected stub account (`status == "Connected"` in Airtable stubs).
6. **Server-Side Resolver Check:** The resolved account stubs map to an active Postgres database row in `channel_accounts` (`status = 'active'`, `token_status = 'valid'`), returning a `SafeChannelAccountMetadata` structure via T-008.
7. **approved_version Increment:** Postgres successfully increments the sequence version for the specific post record in the `approval_versions` table.
8. **idempotency_key Generation:** A production idempotency key is generated using the schema: `airtable.post.approved:{workspace_id}:{record_ref}:{approved_version}`.
9. **Ledger Uniqueness Assert:** No existing duplicate row is recorded in `workflow_runs` matching the production `idempotency_key` or unique composite key `(workspace_id, airtable_record_id, approved_version)`.

---

## 5. Workflow Run Contract

### 5.1 Additive Schema Migration DDL

To capture the resolved safe metadata without introducing database schema drift or forcing downstream queries to re-resolve Airtable stubs (which could have been edited/drifted in the Control Plane since approval), we extend the `workflow_runs` schema with a `channel_account_refs` JSONB column:

```sql
-- Additive migration: Rollback-safe and nullable-compatible
ALTER TABLE workflow_runs
ADD COLUMN channel_account_refs JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Comment for data governance clarity
COMMENT ON COLUMN workflow_runs.channel_account_refs IS 
'Stores safe, token-free display account metadata snapshots from T-008 to prevent Airtable configuration drift.';
```

### 5.2 TypeScript Contract

```ts
export type WorkflowRunStatus = "pending_ai_generation";

export interface SafeChannelAccountRef {
  platform: "Facebook";
  channel_account_id: string;                  // Postgres UUID referencing channel_accounts.id
  airtable_channel_account_record_id: string;  // Physical Airtable Record ID (e.g., 'recAcc123')
  external_account_id?: string;                // Meta Page ID (e.g., '1029384756')
  token_status?: "valid" | "expired" | "missing" | "unknown"; // Safe status reference
}

export interface WorkflowRun {
  id: string;                                    // Postgres UUID (Primary Key)
  workspace_id: string;                          // Workspace isolation key
  airtable_record_id: string;                    // Source Airtable record ID
  approved_version: number;                      // Allocated server-side version counter
  idempotency_key: string;                       // production idempotency key
  status: WorkflowRunStatus;                     // Fixed value: 'pending_ai_generation'
  created_from_webhook_event_id: string;         // UUID referencing webhook_events.id
  channel_account_refs: SafeChannelAccountRef[]; // Token-free safe metadata stubs
  created_at: string;                            // ISO 8601 UTC timestamp
}
```

### 5.3 Banned Fields Guard

To prevent severe credential leakage, the application layer schema validator (e.g., Zod) and Postgres ledger constraints **must reject** any payload containing:
- `access_token` or `refresh_token`
- `secret_ref` or opaque vault URLs (`vault://...`)
- `app_secret` or client keys
- `decrypted_credential`
- `raw_oauth_payload`
- `master_copy`, `cta_url`, or `asset_links` (these belong in temporary reload contexts, not permanent workflow stubs)

#### Zod Guard Validator Example:
```ts
import { z } from 'zod';

const ForbiddenKeysSchema = z.object({
  access_token: z.never().optional(),
  refresh_token: z.never().optional(),
  secret_ref: z.never().optional(),
  app_secret: z.never().optional(),
  master_copy: z.never().optional(),
  cta_url: z.never().optional(),
  asset_links: z.never().optional(),
});
```

---

## 6. Idempotency Rules

Production business idempotency is governed by:
- **Logical Composite Key:** `workspace_id + airtable_record_id + approved_version`
- **Canonical Key String:** `airtable.post.approved:{workspace_id}:{airtable_record_id}:{approved_version}`

### Strict Rules:
1. **Zero Airtable Leakage:** The versioning sequence (`approved_version`) and the canonical `idempotency_key` string exist **only** server-side in the Postgres operational ledger. They are never written back or synchronized to the Airtable Control Plane.
2. **Version Isolation:** The version sequence is managed atomically per `(workspace_id, airtable_record_id)`. Bumping versions ensures SMM administrators can re-approve edited posts safely without corrupting prior published jobs.
3. **No Vacant Sequence Positions:** If an incoming webhook signal is ignored or fails validation before Transaction B begins (e.g., `state_changed_ignored`, `approval_version_mismatch_ignored`), **no version is allocated** and the counter is not incremented. This completely eliminates empty gaps in the approval history.

---

## 7. Transaction Flow

To prevent out-of-order race conditions, dirty reads, and phantom duplicates, processing is isolated using **Transaction B** (after successful reload and T-008 resolution).

```
1. Begin SQL Transaction
   │
   ▼
2. Obtain advisory transaction lock on workspace_id & record_ref
   │
   ▼
3. Confirm webhook_events status is 'processing' & exists
   │
   ▼
4. Increment counter in approval_versions and fetch approved_version
   │
   ▼
5. Insert row into workflow_runs (including safe channel_account_refs)
   │
   ├─► [On unique_constraint conflict] ──► Rollback/Duplicate Reuse Path
   │
   ▼
6. Update webhook_events status = 'workflow_stub_created' and save version
   │
   ▼
7. Update queue_events status = 'acked'
   │
   ▼
8. Append audit_logs (action = 'workflow_stub_created')
   │
   ▼
9. Commit SQL Transaction
   │
   ▼
10. Send basic.ack to RabbitMQ broker
```

### Detailed SQL Operations in Transaction B:

```sql
-- 1. Begin Transaction
BEGIN;

-- 2. Obtain Advisory Lock to isolate counter updates per record
SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2)); -- workspace_id, airtable_record_id

-- 3. Confirm webhook event exists and lock row to block concurrent processing
SELECT status 
FROM webhook_events 
WHERE event_id = $3 AND status = 'processing' 
FOR UPDATE;

-- 4. Increment and return the new approved_version atomically
INSERT INTO approval_versions (workspace_id, airtable_record_id, current_version, updated_at)
VALUES ($1, $2, 1, NOW())
ON CONFLICT (workspace_id, airtable_record_id)
DO UPDATE SET current_version = approval_versions.current_version + 1, updated_at = NOW()
RETURNING current_version; -- yields allocated_version (e.g., 3)

-- 5. Insert downstream workflow_runs stub with safe metadata
INSERT INTO workflow_runs (
  id,
  workspace_id,
  airtable_record_id,
  approved_version,
  idempotency_key,
  status,
  created_from_webhook_event_id,
  channel_account_refs,
  created_at
) VALUES (
  gen_random_uuid(),
  $1, -- workspace_id
  $2, -- airtable_record_id
  $4, -- approved_version (value returned from step 4)
  $5, -- idempotency_key ('airtable.post.approved:...')
  'pending_ai_generation',
  $6, -- webhook_event_id (UUID)
  $7, -- channel_account_refs (JSONB array snapshot, token-free)
  NOW()
);

-- 6. Update webhook_events ledger status
UPDATE webhook_events
SET status = 'workflow_stub_created',
    approved_version = $4,
    idempotency_key = $5,
    processed_at = NOW()
WHERE event_id = $3;

-- 7. Update queue_events status to acked
UPDATE queue_events
SET status = 'acked',
    updated_at = NOW()
WHERE message_id = $8;

-- 8. Append to append-only audit trail
INSERT INTO audit_logs (
  id,
  workspace_id,
  actor_type,
  actor_id,
  action,
  entity_type,
  entity_id,
  metadata,
  created_at
) VALUES (
  gen_random_uuid(),
  $1,
  'system',
  'queue_worker',
  'workflow_stub_created',
  'workflow_run',
  $9, -- UUID of newly created workflow_run
  jsonb_build_object(
    'approved_version', $4,
    'idempotency_key', $5,
    'webhook_event_id', $6
  ),
  NOW()
);

-- 9. Commit Transaction
COMMIT;

-- 10. (Application Layer) Send RabbitMQ basic.ack ONLY after successful COMMIT
```

---

## 8. Duplicate Handling

Duplicate events occur through network failures, broker crashes, or out-of-order deliveries. We classify duplicate branches into three distinct scenarios:

### SC-A: Ingress Transport Redelivery (Fast-Pass path)
- **Condition:** Inbound message is marked `redelivered = true` or database audit logs match an already-finalized `event_id` in `webhook_events`.
- **Handling:** The worker detects the finalized status immediately. It skips the expensive Airtable API reload call entirely, appends `worker_redelivery_acked` to the audit log, commits the ledger status as unchanged, and immediately sends an **ACK**. This prevents side-effects and API rate-limit consumption.

### SC-B: Real-time Concurrency Conflict (Unique Constraint Collision)
- **Condition:** Two workers concurrently process separate webhooks for the exact same `(workspace_id, airtable_record_id, approved_version)` or production `idempotency_key`, resulting in a SQL Unique Constraint violation on `workflow_runs_idempotency_key_uq`.
- **Handling:** Postgres aborts the transaction. The application layer catches the unique constraint violation, aborts the insert, and performs a clean recovery:
  1. Retrieve the existing `workflow_run` details.
  2. Start a fresh Transaction to mark the current `webhook_event.status = 'duplicate_ignored'`.
  3. Update `queue_events.status = 'acked'`.
  4. Append `workflow_stub_duplicate_reused` to the audit log.
  5. Commit and send an **ACK**.

### SC-C: Concurrent Valid Approvals (Business Bumps - NOT duplicates)
- **Condition:** Manager approves Post $\rightarrow$ edits post copy $\rightarrow$ approves again, firing separate webhooks with distinct `approved_at` timestamps.
- **Handling:** Since the `approved_at` timestamps do not match, the worker processes them as separate, valid operational events. The advisory lock ensures they are processed sequentially, bumping the version counter to `1` then `2`. The database persists two distinct stubs in `workflow_runs`, each linked to its respective version. Both are valid downstream signals and are **NOT** ignored.

---

## 9. Audit Logging

To comply with high-level system tracking and data governance policies, all workflow stub events write to the append-only `audit_logs` table.

### Banned Logging Content:
No audit logs may contain:
- Raw copy (`master_copy`), CTA URLs, image paths.
- Access tokens, secrets, or decrypted payloads.

### Standard Audit Taxonomy Enums:

| Action | Entity Type | Metadata Shape | Triggering Event |
|:---|:---|:---|:---|
| `workflow_stub_created` | `workflow_run` | `{"approved_version": 1, "idempotency_key": "..."}` | Successful stub insertion in Transaction B. |
| `workflow_stub_duplicate_reused` | `workflow_run` | `{"idempotency_key": "...", "reused_workflow_id": "..."}` | Unique constraint collision recovered and existing stub referenced. |
| `workflow_stub_creation_failed` | `webhook_event` | `{"error_code": "...", "reason": "..."}` | Database insert failure or structural validation failure. |
| `worker_acked` | `queue_event` | `{"message_id": "...", "queue_name": "..."}` | Transaction B committed and ACK issued to RabbitMQ. |
| `worker_redelivery_acked` | `queue_event` | `{"message_id": "...", "event_id": "..."}` | Fast-pass detection of redelivered finalized message. |

---

## 10. Security and Privacy Rules

1. **Zero Token Transmission:** Under no circumstances may sensitive platform tokens or secrets be stored in `workflow_runs.channel_account_refs`. Only safe display stubs from T-008 are permitted.
2. **References-Only Queue Principle:** RabbitMQ message payloads must carry only immutable ID strings and timestamp references, completely isolating secret decryption downstream.
3. **Application Validation Guard:** Before writing `channel_account_refs` to Postgres, the application layer must parse the array through a strict sanitization schema, rejecting the save if unexpected keys are detected.
4. **Log Sanitization Invariant:** Database connection strings, server ports, and system folder structures must be stripped from all exception error logs before saving to `webhook_events.error_message`.
5. **Row-Level Security (RLS) Compliance:** Every SELECT/INSERT/UPDATE query affecting `workflow_runs` must explicitly define `workspace_id = $1` to comply with future cross-tenant boundary isolation.

---

## 11. Rollback / Compensation

### 11.1 Non-Production Physical Rollback Guard

In non-production environments (Local Development, Testing, Staging), physical cleanup of stubs is allowed *only* under strict, dual-layer security conditions:

```ts
// Application Layer Security Guard
export async function deleteTestWorkflowStubs(workspaceId: string): Promise<boolean> {
  const isProduction = process.env.NODE_ENV === 'production';
  const isTestWorkspace = workspaceId.startsWith('test_');

  if (isProduction || !isTestWorkspace) {
    throw new Error('CRITICAL SECURITY VIOLATION: Physical DELETE blocked on this environment or workspace!');
  }

  // Proceed with physical deletion in local/CI environments
  return await db.deleteFromWorkflowRuns(workspaceId);
}
```

### 11.2 Database-Level Defense Trigger (Postgres)

To prevent misconfigured environmental variables (`NODE_ENV`) from executing accidental deletions in production, a database trigger enforces physical immutability:

```sql
CREATE OR REPLACE FUNCTION restrict_production_workflow_deletes()
RETURNS TRIGGER AS $$
BEGIN
  -- Double validation check: Block if workspace doesn't have the test prefix
  IF NOT OLD.workspace_id LIKE 'test_%' THEN
    RAISE EXCEPTION 'CRITICAL: Physical DELETE on table workflow_runs is strictly prohibited on production workspaces!';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER db_workflow_runs_delete_guard
BEFORE DELETE ON workflow_runs
FOR EACH ROW
EXECUTE FUNCTION restrict_production_workflow_deletes();
```

### 11.3 Production Compensating Transaction

In production, physical `DELETE` operations are completely locked. If a workflow run must be rolled back or cancelled due to operational failure:
1. **Ledger Cancellation:** Update `webhook_events.status = 'failed'`.
2. **Audit Compensating Trail:** Insert a new compensating record in `audit_logs` explaining the failure:
   - `action = 'workflow_stub_cancelled'`
   - `metadata = {"reason": "SMM manual cancellation", "original_idempotency_key": "..."}`
3. Downstream AI Composer or publish jobs check the parent event status and compensating audit trail before execution, failing closed if `webhook_events.status = 'failed'` or a `workflow_stub_cancelled` audit entry exists for the workflow.

---

## 12. Test Scenarios

### SC-T09-01: Happy Path Workflow Stub Creation
- **Preconditions:** Worker successfully reloads record; resolver T-008 returns active, valid Page account metadata.
- **SQL Execution:** Bumps version from 0 to 1, inserts `workflow_runs` stub including validated `channel_account_refs` JSONB, updates `webhook_events.status = 'workflow_stub_created'`.
- **Expected Outcome:** Commit succeeds, ACK sent, audit trail records `workflow_stub_created`.

### SC-T09-02: Transport Duplicate Ingress (Fast-Pass)
- **Preconditions:** Inbound event has `event_id` matching an already finalized event with status `'workflow_stub_created'` in the ledger.
- **SQL Execution:** Worker bypasses Airtable API reload. Appends `worker_redelivery_acked` audit log.
- **Expected Outcome:** Immediate ACK sent without duplicating version counter or inserting stubs.

### SC-T09-03: Concurrency Unique Conflict Recovery
- **Preconditions:** Two threads process the same version bump concurrently, triggering unique constraint violation on `workflow_runs_idempotency_key_uq`.
- **SQL Execution:** Second transaction fails. Caught by code, maps error, executes second transaction to mark status `'duplicate_ignored'` and updates queue to `'acked'`.
- **Expected Outcome:** Recovery completes, ACK sent, duplicate workflow is **not** created.

### SC-T09-04: Environment Rollback Guard Block (Production)
- **Preconditions:** Environmental variables spoofed or bug triggers `delete` on `workflow_runs` for workspace `'workspace_prod_01'`.
- **Expected Outcome:** DB Trigger intercepts and throws `'CRITICAL: Physical DELETE... prohibited'`. Transaction is aborted, data is preserved.

### SC-T09-05: Environment Rollback Guard Success (Test Environment)
- **Preconditions:** `NODE_ENV = 'test'` and target workspace is `'test_workspace_01'`.
- **SQL Execution:** Application layer guard allows call; DB trigger verifies `test_` prefix.
- **Expected Outcome:** Physical delete succeeds, clearing local CI database stubs.

---

## 13. Verification Checklist

The implementation of US-002 / T-009 is complete and correct only if it achieves 100% checkmarks:

- [ ] Additive schema migration script adding `channel_account_refs` to `workflow_runs` table is defined.
- [ ] Safe metadata TS contract defined for `WorkflowRun` and `SafeChannelAccountRef`.
- [ ] Zero token rule strictly enforced: database columns, TypeScript interfaces, and audit logs are stripped of credentials.
- [ ] Zod schema validator defined rejecting forbidden credential keys at the application level.
- [ ] Invariant "Write Ledger status, commit transaction, then ACK Broker" is strictly preserved.
- [ ] Logical composite key `(workspace_id, airtable_record_id, approved_version)` and canonical `idempotency_key` string exist only server-side.
- [ ] Counter counter bumps sequentially inside Transaction B using transaction advisory locking; no sequence gaps for ignored states.
- [ ] Fast-Pass deduplication correctly bypasses Airtable reloading on redeliveries of finalized events.
- [ ] Concurrency collisions caught, marked as `duplicate_ignored`, and recovered gracefully without error cascades.
- [ ] Concurrent valid approvals with distinct `approved_at` timestamps correctly generate consecutive version stubs.
- [ ] Dual-layer environmental block (Application Guard + DB Trigger) prevents physical deletions on production workspaces.
- [ ] Production rollback uses append-only compensating audit entries instead of physical deletes.
- [ ] Sanity log sanitization rules strip out folder hierarchies and connection ports.

---

## 14. Open Questions / Risks

1. **JSONB Query Performance:**
   - *Risk:* Over time, querying `workflow_runs` based on fields inside the `channel_account_refs` JSONB array could degrade performance.
   - *Mitigation:* The primary access pattern for AI Composer (US-003) is direct B-tree lookup by `id` or composite `(workspace_id, airtable_record_id, approved_version)`. If index query on JSONB elements is needed later, we can add a Postgres GIN index.
2. **Schema Synchronization with US-003:**
   - *Risk:* Downstream AI Composer developers might expect additional columns in the `workflow_runs` stub.
   - *Mitigation:* The `workflow_runs` status column and `channel_account_refs` JSONB form the minimal, stable handoff boundary. Any downstream-specific fields must be added as nullable columns in future migrations.
3. **Transaction Timeout Tuning:**
   - *Risk:* High lock contention on the counter table due to advisory locking could trigger transaction timeouts during peak webhook spikes.
   - *Mitigation:* Keep Transaction B extremely short by pre-calculating all values (Airtable fetches, T-008 resolutions) outside the SQL write lock window.
