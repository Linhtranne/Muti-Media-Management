# US-002 Webhook Ingestion Flow

## 1. Docs Read

Read and applied in order:
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
12. `docs/plans/US-002/US-002-ledger-schema-and-idempotency.md`
13. `docs/plans/US-002/US-002-shared-event-and-ledger-contracts.md`
14. `docs/plans/US-002/US-002-webhook-receiver-api-design.md`
15. `docs/plans/US-002/US-002-rabbitmq-topology-approved-post.md`

Specialist knowledge applied silently:
- `C:\Users\Hi\.spawner\skills\backend\api-design\skill.yaml`
- `C:\Users\Hi\.spawner\skills\backend\api-design\sharp-edges.yaml`
- `C:\Users\Hi\.spawner\skills\data\postgres-wizard\skill.yaml`
- `C:\Users\Hi\.spawner\skills\data\postgres-wizard\sharp-edges.yaml`
- `C:\Users\Hi\.spawner\skills\backend\queue-workers\skill.yaml`
- `C:\Users\Hi\.spawner\skills\backend\queue-workers\sharp-edges.yaml`
- `.agent/agents/backend-specialist.md`
- `.agent/agents/database-architect.md`
- `.agent/agents/security-auditor.md`

Conflict priority enforced:
Architecture > Coding Convention > Product Backlog > Function Flow Register > US-002 Scope Lock > Ledger Schema > Shared Contracts > Webhook API Design > RabbitMQ Topology > Plan.

## 2. Flow Objective

Define receiver-only ingestion flow for Airtable webhook signal into US-002 ingress queue with Ledger-first durability, ingress dedupe by `event_id`, references-only queue payload, and sanitized API responses.

## 3. Flow Scope

In scope:
- Request validation and source/config verification.
- Event normalization + correlation metadata generation/propagation.
- Ledger `received` persistence before queue publish.
- Ingress dedupe by `event_id`.
- Queue publish of ingress message (references-only).
- Ledger `queued` update after enqueue success.
- Failure handling paths: duplicate, ignored, validation/source failure, enqueue failure, internal failure.

Out of scope (explicitly prohibited in receiver):
- Airtable reload.
- `approved_version` allocation/increment.
- Workflow stub creation.
- AI Composer call.
- Facebook MCP call.
- Social publish.
- Slack processing.

## 4. Happy Path

1. Receive `POST /api/v1/webhooks/airtable`.
2. Validate method/content-type/json shape/required fields.
3. Verify source signature/config/base allowlist/workspace mapping.
4. Resolve trusted `workspace_id`.
5. Propagate valid inbound `correlation_id` if present, else generate new `correlation_id`.
6. Set `causation_id = event_id`.
7. Compute ingress idempotency key: `airtable.webhook.ingress:{event_id}`.
8. Begin Ledger transaction T1.
9. Insert `webhook_events` row with:
   - `status = received`
   - `event_id`
   - `event_type = airtable.post.approved.ingress`
   - `event_version = 1`
   - `airtable_record_id = record_id`
   - `approval_ref = approved_at`
   - `approved_version = NULL`
   - production idempotency key remains `NULL` (or ingress-scoped key only where schema requires queue-level tracking)
10. Insert audit log `webhook_received`.
11. Commit T1.
12. Publish `AirtableApprovedWebhookIngressMessage` to RabbitMQ routing key `airtable.post.approved.ingress`.
13. Begin Ledger transaction T2.
14. Insert/update `queue_events` with `enqueue_succeeded` and correlation metadata.
15. Update `webhook_events.status = queued`.
16. Insert audit log `queue_enqueue_succeeded`.
17. Commit T2.
18. Return HTTP 202:

```json
{
  "status": "accepted",
  "event_id": "evt_...",
  "correlation_id": "corr_..."
}
```

## 5. Duplicate Event Path

Duplicate key: `event_id` at ingress boundary.

Flow:
1. Detect duplicate by existing ingress event record / idempotency lookup on `event_id`.
2. Do not publish a second queue message.
3. Begin Ledger transaction.
4. Write/confirm `webhook_events.status = duplicate_ignored` (or preserve prior duplicate marker by policy).
5. Insert audit log `webhook_duplicate_ignored`.
6. Commit transaction.
7. Return HTTP 202:

```json
{
  "status": "duplicate_ignored",
  "event_id": "evt_...",
  "correlation_id": "corr_..."
}
```

No workflow stub creation in this path.

## 6. Ignored / Unrelated Event Path

Trigger examples:
- `table_name != Posts`
- `change_type != update`
- event does not map to approved workflow signal

Flow:
1. Request is syntactically valid and source-verified.
2. Classify as unrelated/ignored.
3. Begin Ledger transaction.
4. Insert/update ignored state (`unrelated_ignored`) in webhook ledger context.
5. Insert audit log `webhook_ignored_unrelated`.
6. Commit.
7. Return HTTP 202:

```json
{
  "status": "ignored",
  "reason": "unrelated_event",
  "event_id": "evt_...",
  "correlation_id": "corr_..."
}
```

No queue publish, no noisy error unless source/config appears suspicious.

## 7. Validation Failure Path

Examples:
- non-JSON or wrong content type
- missing `event_id`/`record_id`/`approved_at`
- malformed timestamp
- forbidden field present in payload

Flow:
1. Fail before Ledger persistence for invalid payload classes unless audit-only policy requires minimal rejected record.
2. Return sanitized HTTP 400:

```json
{
  "error": "validation_error",
  "message": "Invalid Airtable webhook payload",
  "correlation_id": "corr_..."
}
```

No internal stack/SQL detail, no queue publish.

## 8. Source Verification Failure Path

Examples:
- signature missing/invalid when required
- `base_id` or resolved `workspace_id` not allowlisted

Flow:
1. Reject fail-closed.
2. Optional security audit entry with redacted metadata.
3. Return sanitized HTTP 401/403:

```json
{
  "error": "unauthorized_source",
  "message": "Webhook source verification failed",
  "correlation_id": "corr_..."
}
```

No queue publish.

## 9. Queue Enqueue Failure Path

Case A: transient enqueue failure after `received` committed:
1. T1 already committed (`received`).
2. Queue publish fails due to transient infra issue.
3. Begin Ledger transaction T3.
4. Update `webhook_events.status = retryable_failed`.
5. Insert/update `queue_events = enqueue_failed_retryable` with attempt metadata.
6. Insert audit log `queue_enqueue_failed_retryable`.
7. Commit T3.
8. Return sanitized 500 (or retry-safe response consistent with receiver API design policy).

Case B: terminal enqueue failure:
1. Begin T3.
2. Update `webhook_events.status = failed`.
3. Insert/update `queue_events = enqueue_failed_terminal`.
4. Insert audit log `queue_enqueue_failed_terminal`.
5. Commit T3.
6. Return sanitized 500.

Rules:
- Do not report success if enqueue was required and failed.
- Do not emit duplicate enqueue without ingress dedupe protections.

## 10. Internal Failure Path

Examples:
- DB transaction failure
- unexpected runtime exception

Flow:
1. Roll back active transaction.
2. If safe to do so, write fallback failure audit in independent best-effort channel with redacted metadata.
3. Return sanitized HTTP 500:

```json
{
  "error": "internal_error",
  "message": "Webhook could not be processed",
  "correlation_id": "corr_..."
}
```

No stack trace, no SQL details, no secrets.

## 11. Ledger Transaction Boundaries

Transaction design:
- T1 (ingress receive): persist `received` + `webhook_received` audit.
- Queue publish occurs outside DB transaction boundary.
- T2 (enqueue success): persist `queue_events.enqueue_succeeded` + status `queued` + audit.
- T3 (enqueue fail): persist `retryable_failed` or `failed` + enqueue failure event + audit.

Important constraint:
- A single atomic transaction cannot include both Postgres commit and RabbitMQ publish without outbox.

Outbox discussion:
- Recommended implementation option: transactional outbox table written in T1, async publisher drains outbox to RabbitMQ.
- If outbox not adopted yet, known failure window exists between T1 commit and successful publish.

Mitigations without outbox:
1. Reconciliation query for `webhook_events.status = received` with no matching successful `queue_events` older than threshold.
2. Retry publish job for reconciliation hits.
3. Keep status `retryable_failed` until publish succeeds.

## 12. Queue Message Construction

Ingress queue message (references-only, exact contract):

```json
{
  "event_id": "evt_...",
  "event_type": "airtable.post.approved.ingress",
  "event_version": 1,
  "source": "airtable.webhook_receiver",
  "workspace_id": "workspace_...",
  "record_ref": "rec...",
  "approval_ref": "2026-05-20T07:45:00.000Z",
  "idempotency_key": "airtable.webhook.ingress:evt_...",
  "correlation_id": "corr_...",
  "causation_id": "evt_..."
}
```

Construction rules:
- No `approved_version`.
- `event_version = 1`.
- Immutable, small, references-only.
- Correlation fields preserved as provided/generated in receiver.

## 13. Response Behavior

Response map:
- Accepted enqueue success -> HTTP 202 `accepted`
- Duplicate ingress -> HTTP 202 `duplicate_ignored`
- Ignored unrelated -> HTTP 202 `ignored`
- Validation fail -> HTTP 400 `validation_error`
- Source verification fail -> HTTP 401/403 `unauthorized_source`
- Internal/enqueue fatal fail -> sanitized HTTP 500 `internal_error` or enqueue-failure mapped error

All responses sanitized: no stack trace, no SQL text, no secrets.

## 14. Security and Privacy Guards

Never persist/publish/log raw sensitive content in queue/log/audit metadata.

Forbidden fields/content:
- `approved_version` in ingress queue message
- `master_copy`
- `cta_url`
- `asset_links`
- `access_token`
- `refresh_token`
- `secret_ref`
- `app_secret`
- full Airtable snapshot

Guards:
- strict schema validation
- sensitive key redaction in logs
- structured logs with `correlation_id` + minimal metadata only

## 15. Feature Flag / Rollback Behavior

Feature flags:
- `WEBHOOK_AIRTABLE_RECEIVER_ENABLED`
- `WEBHOOK_AIRTABLE_QUEUE_PUBLISH_ENABLED`
- `WEBHOOK_AIRTABLE_STRICT_SCHEMA`

Rollback behavior:
- Disable queue publishing feature flag while keeping event logging/validation path active.
- Receiver can continue recording ingress attempts and return controlled responses per policy.
- Re-enable publish only after queue path and reconciliation health checks pass.

## 16. Test Scenarios

1. Valid approved webhook -> `received` then enqueue success -> `queued` and HTTP 202 accepted.
2. Duplicate `event_id` -> HTTP 202 duplicate_ignored, no second enqueue.
3. Wrong `table_name` -> HTTP 202 ignored, no enqueue.
4. Wrong `change_type` -> HTTP 202 ignored, no enqueue.
5. Missing `event_id` -> HTTP 400 validation_error.
6. Forbidden field present -> validation/security rejection, no enqueue.
7. Invalid source signature -> HTTP 401/403.
8. Unknown base/workspace mapping -> HTTP 403/401.
9. Transient queue publish failure after T1 -> status `retryable_failed`, enqueue_failed_retryable event.
10. Terminal queue failure -> status `failed`, enqueue_failed_terminal event.
11. Correlation id header present -> propagated unchanged.
12. Correlation id absent -> generated and returned.
13. No `approved_version` present in queue message contract.
14. Ensure no AI/MCP/Slack/social publish call in receiver flow.

## 17. Verification Checklist

- [x] Receiver does not reload Airtable.
- [x] Receiver does not allocate/increment `approved_version`.
- [x] Queue ingress message excludes `approved_version`.
- [x] Queue payload is references-only.
- [x] Duplicate event does not enqueue again.
- [x] Ledger `received` written before enqueue.
- [x] Ledger `queued` written only after enqueue success.
- [x] Queue failure path sets `retryable_failed` or `failed`.
- [x] Transaction boundaries are explicit.
- [x] Outbox/failure-window discussion included.
- [x] No raw token/content/asset data in flow artifacts.
- [x] No AI/MCP/Slack/social publish in receiver flow.
- [x] Test scenarios included.

## 18. Open Questions / Risks

1. Decide whether to mandate transactional outbox in v1 or allow reconciliation-only interim approach.
2. Confirm schema-level uniqueness/indexing strategy for `event_id` dedupe under high concurrency.
3. Align final HTTP code for transient enqueue failure (strict 500 vs accepted-with-retry-state) with API governance.
4. Define operator SLA for reconciliation lag on `received` without enqueue success.
