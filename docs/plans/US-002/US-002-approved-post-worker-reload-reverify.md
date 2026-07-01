# US-002 Approved Post Worker Reload and Reverify

## 1. Docs Read

This technical design document is fully aligned with the architectural constraints and operational rules defined in the following 16 project documents, analyzed in chronological order:

1. **P0** | [06_Architecture_Composability.md](file:///d:/Muti-Media%20Management/docs/architecture/06_Architecture_Composability.md) — Confirmed Airtable acts strictly as a Control Plane; middleware owns webhook/reload/idempotency; RabbitMQ is async queue; Postgres is durable Ledger.
2. **P0** | [11_Coding_Convention.md](file:///d:/Muti-Media%20Management/docs/architecture/11_Coding_Convention.md) — Extracted rules: TypeScript services; no raw tokens in logs/payloads; references-only queue messages; every external event has an idempotency key; workers ACK only after Ledger transaction commits.
3. **P1** | [04_Product_Backlog.md](file:///d:/Muti-Media%20Management/docs/requirements/04_Product_Backlog.md) — Aligned with AC1-AC4 for recording approved events, preventing duplicates, ignoring unrelated events with logs, and ensuring failed events store a clear status and error code.
4. **P1** | [05_Function_Flow_Logic_Register.md](file:///d:/Muti-Media%20Management/docs/requirements/05_Function_Flow_Logic_Register.md) — Implemented exact reload-reverify strategy, revalidation checks, and state classification logic defined in `FL-001`.
5. **P2** | [07_Risk_Assumption_Decision_Log.md](file:///d:/Muti-Media%20Management/docs/project-mgmt/07_Risk_Assumption_Decision_Log.md) — Incorporated database decision `D-003`, RabbitMQ path `D-006`, and two-phase webhook receiver path `D-007`.
6. **P2** | [03_SRS_MediaOps_Composability.md](file:///d:/Muti-Media%20Management/docs/requirements/03_SRS_MediaOps_Composability.md) — Adhered to NFR on performance, rate limits (Airtable 429), and fail-closed security.
7. **P2** | [13_Sprint_1_Backlog.md](file:///d:/Muti-Media%20Management/docs/requirements/13_Sprint_1_Backlog.md) — Locked worker reload flow within Sprint 1 boundaries.
8. **P0** | [US-001-final-implementation-notes.md](file:///d:/Muti-Media%20Management/docs/plans/US-001/US-001-final-implementation-notes.md) — Mapped Airtable physical fields and view definitions.
9. **P0** | [US-001-middleware-handoff-contract.md](file:///d:/Muti-Media%20Management/docs/plans/US-001/US-001-middleware-handoff-contract.md) — Inherited minimal event payload, references-only contract, reload flow, and error taxonomy.
10. **P0** | [PLAN-us-002-airtable-approved-webhook.md](file:///d:/Muti-Media%20Management/docs/plans/US-002/PLAN-us-002-airtable-approved-webhook.md) — Aligned with Task T-007 objectives, dependencies, and RACI metrics.
11. **P0** | [US-002-scope-lock.md](file:///d:/Muti-Media%20Management/docs/plans/US-002/US-002-scope-lock.md) — Confirmed out-of-scope boundaries (no AI execution, no Facebook Graph API publish, no Slack).
12. **P0** | [US-002-ledger-schema-and-idempotency.md](file:///d:/Muti-Media%20Management/docs/plans/US-002/US-002-ledger-schema-and-idempotency.md) — Extended the 4-table Postgres schema and transaction rules.
13. **P0** | [US-002-shared-event-and-ledger-contracts.md](file:///d:/Muti-Media%20Management/docs/plans/US-002/US-002-shared-event-and-ledger-contracts.md) — Maintained TypeScript interfaces for `AirtableApprovedWebhookIngressMessage` and status enums.
14. **P0** | [US-002-webhook-receiver-api-design.md](file:///d:/Muti-Media%20Management/docs/plans/US-002/US-002-webhook-receiver-api-design.md) — Aligned with the two-phase webhook receiver ingestion endpoint.
15. **P0** | [US-002-rabbitmq-topology-approved-post.md](file:///d:/Muti-Media%20Management/docs/plans/US-002/US-002-rabbitmq-topology-approved-post.md) — Integrated queue-level retry bindings, dead-letter routing, and consumer configurations.
16. **P0** | [US-002-webhook-ingestion-flow.md](file:///d:/Muti-Media%20Management/docs/plans/US-002/US-002-webhook-ingestion-flow.md) — Aligned the consumer interface with the queue publication sequence.

**Spawner Skills Applied:**
- `~/.spawner/skills/backend/queue-workers/` (Idempotent consumer, bounded retries, DLQ, graceful shutdown)
- `~/.spawner/skills/backend/event-architect/` (Immutable events, causation/correlation mapping, out-of-order handling)
- `~/.spawner/skills/data/postgres-wizard/` (Short transaction blocks, ON CONFLICT handling, advisory locking)

---

## 2. Worker Objective

The core objective of the `approved-post` worker is to safely process reference-only signals consumed from the `airtable.webhook.approved` queue. Operating under a **Zero-Trust Pull-and-Verify Model**, the worker:
1. Performs an idempotent fast-pass lookup to prevent repeating side effects on RabbitMQ message redeliveries.
2. Reloads the fresh record state directly from the Airtable API by `record_ref` (Airtable `record_id`).
3. Re-verifies state eligibility, approval timestamp hints, and channel account stubs before making any transition.
4. Generates an append-only sequence version (`approved_version`) and a production idempotency key *only* for fresh, valid approvals, eliminating version sequence gaps.
5. Projects the verified state into the Postgres Operational Ledger (`webhook_events`, `queue_events`, `workflow_runs`, and `audit_logs`).
6. Acknowledges (ACKs) or dead-letters (NACK with `requeue=false`) the broker message *only* after Postgres transactions commit.

---

## 3. Worker Scope

### In Scope
- Fast-pass idempotent evaluation based on `event_id` and ingress `idempotency_key`.
- Fetching fresh data from the Airtable API (`GET /v0/{base_id}/Posts/{record_id}`) under zero-trust payload rules.
- Re-verifying status transitions, formula checks (`is_valid_for_approval`), and timestamp matching.
- Validating presence of target channels and linked channel account display stubs in Airtable.
- Server-side version counter tracking and generation of production idempotency key `airtable.post.approved:{workspace_id}:{record_ref}:{approved_version}`.
- Writing to Postgres tables `webhook_events`, `queue_events`, `workflow_runs`, and `audit_logs` in durable transaction boundaries.
- Creating a downstream `workflow_runs` stub with status `pending_ai_generation` for US-003 handoff.
- Standard RabbitMQ ACK/NACK mechanics and retry routing.

### Out of Scope
- Real execution of the AI Composer Agent (US-003).
- Call boundaries to the Facebook MCP Server (`validate_post`, `publish_post`, etc.).
- Actual page OAuth/token lookups or secure platform credential retrieval (belongs to US-011 / T-008).
- Slack alerts, message generation, or slash command execution.
- Writing or persisting `approved_version` back into Airtable fields.
- Transferring raw `master_copy` text, asset links, or API secrets inside RabbitMQ payloads.

---

## 4. Input Message Contract

The worker consumes references-only messages from `airtable.webhook.approved` matching the schema below:

```json
{
  "event_id": "evt_01j7h8x2p4r5e8t1w9y8b3c4x5",
  "event_type": "airtable.post.approved.ingress",
  "event_version": 1,
  "source": "airtable.webhook_receiver",
  "workspace_id": "workspace_fb_ops_01",
  "record_ref": "rec9t7W2uP0YxL8e9",
  "approval_ref": "2026-05-20T07:45:00.000Z",
  "idempotency_key": "airtable.webhook.ingress:evt_01j7h8x2p4r5e8t1w9y8b3c4x5",
  "correlation_id": "corr_01j7h8x2p4r5e8t1w9y8b3c4x5",
  "causation_id": "evt_01j7h8x2p4r5e8t1w9y8b3c4x5"
}
```

### Constraints:
- `record_ref` is the Airtable Record ID.
- `approval_ref` is the incoming `approved_at` timestamp hint (ISO 8601 UTC).
- **NO** `approved_version` is present in the ingress message.
- **NO** raw post content or secrets are contained in the payload.

---

## 5. Processing Overview

```
 [ RabbitMQ Consumer ]
          │
          ▼
 1. Fast-Pass Check ─── (Ledger Status = Terminal?) ──► YES ──► 2. Redelivery ACK (No-Op)
          │ NO
          ▼
 3. Transaction A (Begin)
          │
          ├──► Update `webhook_events.status` = 'processing'
          └──► Update `queue_events.status` = 'consumed', attempts += 1
          │
 4. Transaction A (Commit)
          │
          ▼
 5. Reload Airtable ─── (Airtable 429/503?) ──► YES ──► 6. NACK Requeue / Retry TX
          │ NO
          ▼
 7. Status Reverification (Approved?) ──► NO ──► 8. Ignored ACK Transaction (No version allocation)
          │ YES
          ▼
 9. Approval Validity & Ref Check ─── (is_valid = 1 & ref match?) ──► NO ──► 8. Ignored ACK Transaction
          │ YES
          ▼
 10. Account Stub Check ─── (Missing / Inactive?) ──► YES ──► 8. Ignored ACK Transaction
          │
          └─── (Unresolved?) ──► YES ──► 11. Terminal DLQ Transaction (NACK requeue=false)
          │ NO
          ▼
 12. Transaction B (Begin)
          │
          ├──► Advisory Lock (workspace_id, record_ref)
          ├──► Increments counter in `approval_versions` -> get `approved_version`
          ├──► Build production `idempotency_key`
          ├──► Update `webhook_events` status = 'workflow_stub_created', version = approved_version
          ├──► Insert `workflow_runs` stub (status = 'pending_ai_generation')
          ├──► Update `queue_events.status` = 'acked'
          └──► Append `audit_logs` (action = 'worker_acked')
          │
 13. Transaction B (Commit)
          │
          ▼
 14. ACK Broker
```

---

## 6. Airtable Reload

To avoid race conditions and payload tampering, the worker retrieves the fresh record using the Airtable REST API:

```http
GET /v0/appMediaOpsBaseId/Posts/rec9t7W2uP0YxL8e9
Authorization: Bearer <Sanitized_Airtable_API_Key>
```

### Transient Failure & Timeout Catching:
- **Connect Timeout:** 10 seconds; **Response Timeout:** 20 seconds.
- **HTTP 429 (Too Many Requests):** Caught and classified as `retryable_failed`.
- **HTTP 503 / 502 (Service Unavailable):** Caught and classified as `retryable_failed`.
- **Network Timeouts / DNS Failures:** Caught and classified as `retryable_failed`.
- **HTTP 404 (Record Deleted):** Classified as `failed` (terminal operational failure, no retry).

---

## 7. Status Reverification

Upon successful reload, the worker evaluates the `status` field returned by Airtable and maps it to the Ledger:

| Reloaded Status | Ledger Status | Workflow Creation | Version Allocated | Queue Action |
|:---|:---|:---|:---|:---|
| **`Approved`** | *Proceed to Section 8* | Yes (if valid) | Yes (if valid) | N/A |
| **`Scheduled`** or **`Published`** | `already_advanced_ignored` | No | **No** | ACK |
| **`Draft`**, **`Review`**, or **`Failed`** | `state_changed_ignored` | No | **No** | ACK |
| **Empty / Unknown** | `unknown_status_ignored` | No | **No** | ACK (Fail-Closed) |

---

## 8. Approval Validity Reverification

If the reloaded status is `Approved`, the worker validates the business criteria:

1. **`is_valid_for_approval` Check:**
   - The reloaded record must have `is_valid_for_approval = 1` (calculated via formula in Airtable checking master copy presence, target channels, and schedule time).
   - If not equal to `1`, the worker classifies the event as `invalid_after_reload_ignored`, writes the validation issues to `webhook_events.error_message`, commits the Ledger update, and sends an **ACK** (no retry, no version allocated).
2. **`scheduled_at` Check:**
   - Even if the formula evaluated to `1`, the worker does a double check: `scheduled_at` (UTC ISO 8601) must be strictly in the future compared to the worker system time `NOW()`.
   - If in the past, it is treated as `invalid_after_reload_ignored` and **ACK'd** to prevent stale backlogs.
3. **`master_copy` Validation:**
   - The worker asserts that the `master_copy` field exists and is not empty. However, the raw text MUST NEVER be logged, written to queue metadata, or exposed to audit logs.

---

## 9. Approval Reference Check

To prevent out-of-order or stale approval signals from corrupting the sequence, the worker compares:
- Reloaded `approved_at` timestamp.
- Queue ingress `approval_ref` timestamp.

```ts
if (reloadedRecord.approved_at !== ingressMessage.approval_ref) {
  // Stale event or subsequent approval has already modified the record
  status = 'approval_version_mismatch_ignored';
  // ACK message, do NOT allocate version, do NOT create workflow stub
}
```

This ensures that if the record was approved, reverted, and re-approved, the stale event `A` will mismatch and terminate gracefully with an **ACK**, while the fresh event `B` will match and proceed.

---

## 10. Channel Account Stub Revalidation

The worker verifies that target channels match active display account stubs in Airtable:

### Validation Rules:
1. **Facebook Platform Matching:**
   - If `target_channels` includes `"Facebook"`, the record must contain at least one linked account reference in `connected_channel_accounts`.
   - If the linked array is empty, classify as `channel_account_missing` (Postgres Ledger updated, **ACK** sent, alert `TR-02` generated).
2. **Linked Account Status:**
   - The linked account stub in Airtable must have status = `"Connected"`. If it is `"Disconnected"`, `"Expired"`, or `"Inactive"`, classify as `channel_account_inactive` (Ledger updated, **ACK** sent).
3. **Server-side Resolution Boundary:**
   - If the Airtable account stub ID cannot be resolved to any server-side channel account reference in the database, classify as `channel_account_unresolved`.
   - **Queue Action:** Issues a **NACK with `requeue=false`** (routing to DLQ if active). If DLQ is temporarily inactive, performs an **ACK + Ledger exception fallback** to prevent queue blockages.
   - *Note:* Secure token resolution and credential retrieval are strictly deferred downstream (US-011 / T-008). No tokens are loaded or decrypted at this worker boundary.

---

## 11. approved_version Allocation

To guarantee zero-gap version history and prevent noisy audit records:
- **Cờ cấp phiên bản:** Phiên bản `approved_version` **chỉ** được cấp sau khi record vượt qua tất cả các bước xác thực: `status == Approved`, `is_valid_for_approval == 1`, `approved_at == approval_ref` và channel account stubs hợp lệ.
- **Không chiếm chỗ:** Các nhánh bị ignore hoặc terminal failures (`state_changed_ignored`, `already_advanced_ignored`, `channel_account_missing`, v.v.) **không được phép** chạy qua hàm cấp version.

### Postgres Counter Pattern:
The allocation is executed atomically inside **Transaction B** (see Section 15) using Postgres row locks on a dedicated counter table:

```sql
INSERT INTO approval_versions (workspace_id, airtable_record_id, current_version)
VALUES ($1, $2, 1)
ON CONFLICT (workspace_id, airtable_record_id)
DO UPDATE SET current_version = approval_versions.current_version + 1, updated_at = NOW()
RETURNING current_version;
```

### Production Idempotency Key:
Once the new `approved_version` is returned (e.g., `3`), the production idempotency key is generated:
```text
airtable.post.approved:{workspace_id}:{record_ref}:{approved_version}
```

### Conflict Handling:
If the production key `idempotency_key` or unique composite `(workspace_id, airtable_record_id, approved_version)` encounters a unique constraint violation in Postgres:
- The transaction is classified as `duplicate_ignored`.
- The worker skips duplicate workflow creation, updates the event status to `duplicate_ignored`, commits, and sends an **ACK**.

---

## 12. Workflow Stub Handoff Boundary

Upon generating a valid production idempotency key, the worker creates a durable downstream handoff stub in the `workflow_runs` table:

```sql
INSERT INTO workflow_runs (
  id,
  workspace_id,
  airtable_record_id,
  approved_version,
  idempotency_key,
  status,
  created_from_webhook_event_id
) VALUES (
  gen_random_uuid(),
  $1, -- workspace_id
  $2, -- airtable_record_id
  $3, -- approved_version
  $4, -- idempotency_key ('airtable.post.approved:...')
  'pending_ai_generation', -- Workflow Run status default
  $5  -- UUID of the webhook_events row
);
```

This stub marks the formal handoff boundary for **US-003 (AI Composer / T-009)**. No AI call or Facebook publish job is initiated during this phase.

---

## 13. ACK / NACK Matrix

| Classification | Ledger Status | Version Allocated | Queue Action | Requeue? | DLQ? | Retry? |
|:---|:---|:---:|:---|:---:|:---:|:---:|
| **Valid Approved Ingress** | `workflow_stub_created` | **Yes** | ACK | No | No | No |
| **Duplicate Ingress Event** | `duplicate_ignored` | No | ACK | No | No | No |
| **Already Advanced** | `already_advanced_ignored` | No | ACK | No | No | No |
| **State Changed** | `state_changed_ignored` | No | ACK | No | No | No |
| **Unknown Status** | `unknown_status_ignored` | No | ACK | No | No | No |
| **Invalid Reload** | `invalid_after_reload_ignored`| No | ACK | No | No | No |
| **Version Mismatch** | `approval_version_mismatch_ignored`| No | ACK | No | No | No |
| **Channel Account Missing**| `channel_account_missing` | No | ACK | No | No | No |
| **Channel Account Inactive**| `channel_account_inactive` | No | ACK | No | No | No |
| **Account Unresolved** | `channel_account_unresolved` | No | NACK (DLQ) | **No** | **Yes**| No |
| **Account Unresolved (No DLQ)**| `channel_account_unresolved` | No | ACK | No | No | No |
| **Airtable API 429 / 503** | `retryable_failed` | No | NACK (Retry)| **Yes**| No | **Yes** |
| **Database Concurrency Lock**| `retryable_failed` | No | NACK (Retry)| **Yes**| No | **Yes** |
| **Permanent Network Fail** | `failed` | No | NACK (DLQ) | **No** | **Yes**| No |

---

## 14. Retry Policy

### Transient Retryable Errors:
- Airtable API Rate Limit (HTTP 429)
- Airtable Service Down (HTTP 503 / 502)
- Server DNS/Timeout connections
- Database deadlock / serializable conflict (Postgres error `40001`)

### Bounded Retry Configuration:
- **Max Processing Opportunities:** 6 (1 initial attempt + 5 retry steps).
- **Retry Mechanism:** Routed back through TTL-staged retry queues.
- **Backoff Stages:**
  1. Attempt 1 Fail -> Route to `airtable.webhook.approved.retry.1m` (TTL: 60s)
  2. Attempt 2 Fail -> Route to `airtable.webhook.approved.retry.5m` (TTL: 300s)
  3. Attempt 3 Fail -> Route to `airtable.webhook.approved.retry.15m` (TTL: 900s)
  4. Attempt 4 Fail -> Route to `airtable.webhook.approved.retry.30m` (TTL: 1800s)
  5. Attempt 5 Fail -> Route to `airtable.webhook.approved.retry.60m` (TTL: 3600s)
  6. Attempt 6 Fail -> Route to DLQ `airtable.webhook.approved.dlq`

---

## 15. Ledger Transaction Boundaries

To guarantee complete message durability and prevent silent event drops, processing is divided into two distinct database transactions:

### Transaction A: Ingress Processing State (Short Write)
Triggered immediately upon message consumption from RabbitMQ.

```sql
BEGIN;

-- 1. Fast-pass check: If this event is already finalized, skip reload.
SELECT status FROM webhook_events WHERE event_id = $1; 
-- If status is finalized, COMMIT and immediately ACK broker.
-- Finalized states:
--   workflow_stub_created
--   duplicate_ignored
--   unrelated_ignored
--   already_advanced_ignored
--   state_changed_ignored
--   unknown_status_ignored
--   invalid_after_reload_ignored
--   approval_version_mismatch_ignored
--   channel_account_missing
--   channel_account_inactive
--   channel_account_unresolved
--   failed
-- Do NOT fast-ACK retryable_failed; retryable_failed remains eligible for bounded retry.

-- 2. Mark event as active processing
UPDATE webhook_events 
SET status = 'processing', processed_at = NOW() 
WHERE event_id = $1;

-- 3. Increment queue attempts
UPDATE queue_events 
SET status = 'consumed', attempt_count = attempt_count + 1, last_attempt_at = NOW() 
WHERE message_id = $2;

-- 4. Record audit trail
INSERT INTO audit_logs (id, workspace_id, actor_type, actor_id, action, entity_type, entity_id)
VALUES (gen_random_uuid(), $3, 'system', 'queue_worker', 'worker_consumed', 'webhook_event', $4);

COMMIT;
```

Fast-pass redelivery rule:
- If a redelivered RabbitMQ message maps to a finalized `webhook_events.status`, the worker MUST NOT reload Airtable and MUST NOT repeat side effects such as version allocation or workflow stub insertion.
- It MAY append sanitized audit action `worker_redelivery_acked`, update `queue_events.status = acked`, commit, then ACK the broker message.
- `retryable_failed` is not treated as finalized; it remains eligible for bounded retry processing.

### Transaction B: Final State Classification & Version Allocation (Serializable/Row-Locking TX)
Executed only after reload and verification logic succeeds.

```sql
BEGIN;

-- 1. Obtain Advisory Lock on workspace + record to prevent race conditions on version allocation
SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2)); -- workspace_id, record_ref

-- 2. Allocate approved_version (ONLY for fresh, valid approvals)
INSERT INTO approval_versions (workspace_id, airtable_record_id, current_version)
VALUES ($1, $2, 1)
ON CONFLICT (workspace_id, airtable_record_id)
DO UPDATE SET current_version = approval_versions.current_version + 1, updated_at = NOW()
RETURNING current_version; -- yields allocated_version (e.g., v3)

-- 3. Update webhook_events status with allocated version and production idempotency key
UPDATE webhook_events
SET status = 'workflow_stub_created',
    approved_version = $3,
    idempotency_key = $4 -- 'airtable.post.approved:...'
WHERE event_id = $5;

-- 4. Insert downstream workflow_runs stub
INSERT INTO workflow_runs (id, workspace_id, airtable_record_id, approved_version, idempotency_key, status, created_from_webhook_event_id)
VALUES (gen_random_uuid(), $1, $2, $3, $4, 'pending_ai_generation', $6);

-- 5. Mark queue_events as acked
UPDATE queue_events 
SET status = 'acked', updated_at = NOW() 
WHERE message_id = $7;

-- 6. Insert audit trail
INSERT INTO audit_logs (id, workspace_id, actor_type, actor_id, action, entity_type, entity_id)
VALUES (gen_random_uuid(), $1, 'system', 'queue_worker', 'worker_acked', 'webhook_event', $6);

COMMIT;
```

*Note:* If the validation logic returns an ignored taxonomy state (e.g. `state_changed_ignored`), **Transaction B** writes the target ignored status directly to `webhook_events`, marks `queue_events` as `acked`, and commits **without** obtaining the advisory lock, incrementing version numbers, or creating workflow stubs.

---

## 16. Security and Privacy Guards

To enforce the **References-Only Queue Principle** and respect credentials boundaries:
1. **Zero Text Logging:** The worker never logs, stores, or transmits `master_copy` text, `cta_url`, or image file names.
2. **Zero Credentials Loading:** The worker does not read platform OAuth tokens or vault credentials. Display references are mapped using database metadata stubs.
3. **No Schemas in Logs:** Error messages written to Postgres `error_message` or stdout are stripped of folder directories, database connection strings, and system stack traces.
4. **RLS Compliance:** Worker database queries must carry the authenticated service credentials and specify `workspace_id` to comply with future Row-Level Security rules.

---

## 17. Worker Pause / Rollback

The architecture supports dynamic worker throttling and rollback without losing inbound events:

```
                  [ Inbound Webhook Signals ]
                               │
                               ▼
                   [ Webhook Receiver API ]
                               │
                      (Writes to Ingress Ledger)
                               │
                               ▼
                    [ RabbitMQ Ingress Queue ]  ◄── (Messages Accumulate Safely)
                               │
                    (Pause Consumer Channel)
                               ❌
                      [ Worker Processes ]
```

### Graceful Pause Strategy:
1. Operations issue a `basic.cancel` command to the active worker consumers.
2. The workers stop consuming new signals from the queue.
3. Webhook receivers continue to accept webhook calls, record them in the Ledger as `received`/`queued`, and push signals into RabbitMQ.
4. Message backlogs safely accumulate in the durable queue `airtable.webhook.approved` up to maximum queue limits.
5. Once issue is resolved, consumers are restarted and resume processing.

### Rollback Strategy:
- The worker deployment can be rolled back to a previous version safely.
- Since the schema migration is additive-only (nullable version/idempotency keys first), rolling back worker binaries does not trigger SQL schema errors.

---

## 18. Test Scenarios

To verify implementation correctness, the test suite must cover these scenarios:

### SC-01: Valid Approved Post Flow
- **Input:** Queue signal `record_ref = rec01`, `approval_ref = T1`.
- **Mock:** Airtable API returns status = `Approved`, `is_valid_for_approval = 1`, `approved_at = T1`.
- **Expected Outcome:** `approved_version` increments, production idempotency key created, `workflow_runs` stub created with status `pending_ai_generation`, `webhook_events.status = workflow_stub_created`, ACK sent.

### SC-02: Already Advanced Ignored
- **Input:** Queue signal `record_ref = rec01`.
- **Mock:** Airtable API returns status = `Scheduled` (or `Published`).
- **Expected Outcome:** `webhook_events.status = already_advanced_ignored`, `approved_version` **NOT** incremented, no workflow stub created, ACK sent.

### SC-03: State Changed Ignored
- **Input:** Queue signal `record_ref = rec01`.
- **Mock:** Airtable API returns status = `Draft` (or `Review`, `Failed`).
- **Expected Outcome:** `webhook_events.status = state_changed_ignored`, `approved_version` **NOT** incremented, no workflow stub, ACK sent.

### SC-04: Invalid After Reload
- **Input:** Queue signal `record_ref = rec01`.
- **Mock:** Airtable API returns status = `Approved`, but `is_valid_for_approval = 0`.
- **Expected Outcome:** `webhook_events.status = invalid_after_reload_ignored`, no version allocation, ACK sent.

### SC-05: Approval Ref Mismatch
- **Input:** Queue signal `record_ref = rec01`, `approval_ref = T1`.
- **Mock:** Airtable API returns status = `Approved`, but `approved_at = T2`.
- **Expected Outcome:** `webhook_events.status = approval_version_mismatch_ignored`, no version allocated, ACK sent.

### SC-06: Channel Account Missing
- **Input:** Queue signal.
- **Mock:** Airtable returns status = `Approved`, `target_channels` = `["Facebook"]`, but `connected_channel_accounts` is empty.
- **Expected Outcome:** `webhook_events.status = channel_account_missing`, no version allocated, ACK sent.

### SC-07: Channel Account Inactive
- **Input:** Queue signal.
- **Mock:** Airtable returns status = `Approved`, but Page stub status = `Disconnected` in Airtable.
- **Expected Outcome:** `webhook_events.status = channel_account_inactive`, no version allocated, ACK sent.

### SC-08: Channel Account Unresolved
- **Input:** Queue signal.
- **Mock:** Airtable stub ID cannot be mapped to server-side metadata ID.
- **Expected Outcome:** `webhook_events.status = channel_account_unresolved`, no version allocated, NACK sent with `requeue=false` (routes to DLQ).

### SC-09: Airtable 429 Rate Limit Retry
- **Input:** Queue signal.
- **Mock:** Airtable API returns HTTP 429.
- **Expected Outcome:** `webhook_events.status = retryable_failed`, event requeued to 1m retry queue, NACK sent.

### SC-10: Idempotent Consumer Redelivery
- **Input:** Ingress message redelivered (`redelivered = true` or same `event_id`).
- **Mock:** Database ledger already has `event_id` marked as `workflow_stub_created` (from a prior successful run where the ACK crashed).
- **Expected Outcome:** Worker detects finalized state immediately, executes **NO** reload API call, records audit log `worker_redelivery_acked`, and ACKs immediately.

---

## 19. Verification Checklist

The implementation of T-007 is considered successful and correct only if it achieves 100% checkmarks:

- [ ] Zero-trust reload query `GET /v0/{base_id}/Posts/{record_id}` implemented correctly.
- [ ] Fast-pass check on `event_id` / ingress `idempotency_key` implemented to handle RabbitMQ redeliveries gracefully without side effects.
- [ ] No `approved_version` is allocated or incremented for stale, business-ignored, or invalid events.
- [ ] `approved_version` is allocated and managed strictly inside Postgres; no write-back to Airtable base schema exists.
- [ ] Invariant "Write Ledger status, commit transaction, then ACK Broker" is strictly preserved.
- [ ] Downstream `workflow_runs` stub created with status `pending_ai_generation` only for fresh, valid approvals.
- [ ] Queue payload validation asserts **References-Only** contract; no raw tokens, post copy, or asset links are present.
- [ ] Sanity test proves worker can be paused/cancelled while receivers safely buffer events in RabbitMQ.
- [ ] Airtable HTTP 429/503 triggers exponential retry schedule via TTL-staged routing keys.
- [ ] DLQ routing occurs for unmappable account references (`channel_account_unresolved`) or exhausted retries.
- [ ] Audit logs write `worker_consumed`, `worker_acked`, `worker_redelivery_acked` with sanitized metadata.

---

## 20. Open Questions / Risks

1. **Airtable Rate Limit Exhaustion under Load:**
   - Under heavy batch campaigns, multiple concurrent workers reloading records might exhaust Airtable's global 5 requests/sec rate limit.
   - *Mitigation:* Limit worker prefetch concurrency and implement random jitter within the retry delays.
2. **Postgres Row-Locking Overhead:**
   - Lock conflicts in the `approval_versions` counter table could block workers if multiple threads process approvals for the same record concurrently.
   - *Mitigation:* The advisory lock `pg_advisory_xact_lock` isolates concurrency on the combination of `(workspace_id, record_ref)`, keeping transactions short and highly isolated.
3. **Queue TTL Precision:**
   - Since v1 uses the TTL queue pattern instead of the delayed-exchange plugin, out-of-order retries may occur if a message in the 5m retry queue is delayed.
   - *Mitigation:* Ledger status acts as the absolute coordinator of event ordering, ignoring any out-of-order signals based on timestamp version checks.
