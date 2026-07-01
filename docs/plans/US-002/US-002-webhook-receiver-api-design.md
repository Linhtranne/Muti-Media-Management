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

# US-002 Webhook Receiver API Design

## 1. Docs Read

Read and applied in required order:
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

Specialist knowledge applied silently:
- `C:\Users\Hi\.spawner\skills\backend\api-design\skill.yaml`
- `C:\Users\Hi\.spawner\skills\backend\api-design\sharp-edges.yaml`
- `C:\Users\Hi\.spawner\skills\backend\event-architect\skill.yaml`
- `C:\Users\Hi\.spawner\skills\backend\event-architect\sharp-edges.yaml`
- `.agent/agents/backend-specialist.md`
- `.agent/agents/security-auditor.md`

Conflict priority enforced:
Architecture > Coding Convention > Product Backlog > Function Flow Register > US-002 Scope Lock > Ledger Schema > Shared Contracts > Plan.

## 2. Design Objective

Design API contract for webhook receiver endpoint `POST /api/v1/webhooks/airtable`.

Receiver responsibilities in US-002/T-004 design:
- validate request shape/content type/guard fields
- verify source and config allowlist
- normalize ingress event and assign correlation metadata
- perform ingress dedupe using `event_id`
- write/update Ledger states for ingress lifecycle
- hand off references-only ingress queue message

Receiver non-responsibilities:
- no Airtable reload
- no production `approved_version` allocation
- no workflow stub creation
- no AI Composer calls
- no Facebook MCP calls
- no social publish
- no Slack handling

## 3. Endpoint Contract

Method and path:
- `POST /api/v1/webhooks/airtable`

Request headers:
- `Content-Type: application/json` (required)
- `X-Correlation-Id` (optional, if valid then propagated)
- `X-Airtable-Signature` (required when signature verification mode enabled)

Expected minimum request body:

```json
{
  "event_id": "evt_...",
  "record_id": "rec_...",
  "table_name": "Posts",
  "change_type": "update",
  "approved_at": "2026-05-20T07:45:00.000Z",
  "base_id": "app_...",
  "workspace_id": "workspace_..."
}
```

Workspace resolution order:
1. explicit `workspace_id` in payload (if present and allowlisted)
2. mapping lookup by `base_id`
3. static default only in dev mode with explicit opt-in flag

If no trusted workspace can be resolved: reject request.

## 4. Request Validation

Validation rules:
1. HTTP method must be POST.
2. `Content-Type` must be JSON.
3. `event_id` required, non-empty string.
4. `record_id` required, non-empty string.
5. `table_name` must be present. If it is not `Posts`, classify as unrelated and return 202 ignored with Ledger log.
6. `change_type` must be present. If it is not `update`, classify as unrelated and return 202 ignored with Ledger log.
7. `approved_at` must be ISO8601 timestamp for approved-related `Posts/update` path.
8. Reject payloads containing forbidden fields (Section 12).
9. Reject oversized payload above configured max size.
10. Reject unknown root fields in strict mode (or log and drop in compatibility mode).

Unrelated event behavior:
- If syntactically valid but not relevant to Approved workflow conditions, return accepted ignored response and write ignored audit/ledger state (no enqueue).
- Examples: `table_name != Posts`, `change_type != update`, or a configured webhook event type that is not part of the Approved workflow.

## 5. Source / Config Verification

Required checks:
1. Verify webhook source secret/signature when available.
2. Verify `base_id` belongs to allowlist config.
3. Verify resolved `workspace_id` belongs to allowlist mapping.
4. Verify `table_name = Posts`.
5. Reject unknown base/workspace combinations.

Fail-closed policy:
- If signature verification is required but missing/invalid -> 401/403.
- If deployment cannot verify source (platform limitation), endpoint remains disabled unless explicit dev override flag is enabled.

## 6. Correlation and Causation IDs

Correlation behavior:
- If `X-Correlation-Id` exists and passes format checks, reuse it.
- Else generate new `correlation_id` (`corr_<uuid>`).

Causation behavior:
- `causation_id = event_id` for ingress signal.

Propagation:
- `correlation_id` and `causation_id` must be persisted to Ledger and copied into queue ingress message.

## 7. Ingress Dedupe Behavior

Ingress dedupe key:
- `airtable.webhook.ingress:{event_id}`

Rules:
1. Dedupe is ingress-level only in receiver.
2. Duplicate `event_id` returns duplicate/no-op response and does not enqueue again.
3. Production workflow idempotency remains post-reload worker concern (`record_id + approved_version`).
4. Receiver must not allocate or assume `approved_version`.

## 8. Ledger Write Behavior

Receiver writes/updates only ingress-relevant states:
- `received`
- `duplicate_ignored`
- `unrelated_ignored`
- `queued`
- `retryable_failed`
- `failed`

Behavior details:
1. Insert ingress event row/status `received` after request passes validation + source checks.
2. If dedupe hit, update status to `duplicate_ignored` (or preserve existing duplicate marker) and return no-op.
3. After enqueue success, set status `queued`.
4. If enqueue fails transiently, set status `retryable_failed` and return retry-safe response.
5. If permanent internal failure, set status `failed`.

Receiver does NOT:
- set `processing`
- set `workflow_stub_created`
- set statuses requiring reload/reverify branches

## 9. Queue Handoff Behavior

Receiver enqueues references-only `AirtableApprovedWebhookIngressMessage`:

```json
{
  "event_id": "evt_...",
  "event_type": "airtable.post.approved.ingress",
  "event_version": 1,
  "source": "airtable.webhook_receiver",
  "workspace_id": "workspace_...",
  "record_ref": "rec_...",
  "approval_ref": "2026-05-20T07:45:00.000Z",
  "idempotency_key": "airtable.webhook.ingress:evt_...",
  "correlation_id": "corr_...",
  "causation_id": "evt_..."
}
```

Rules:
- No `approved_version` in ingress message.
- No content fields, token fields, or full Airtable snapshot.
- Queue publish happens only after ledger received state is persisted.

## 10. Response Contract

### 10.1 Accepted

HTTP 202

```json
{
  "status": "accepted",
  "event_id": "evt_...",
  "correlation_id": "corr_..."
}
```

### 10.2 Duplicate no-op

HTTP 202

```json
{
  "status": "duplicate_ignored",
  "event_id": "evt_...",
  "correlation_id": "corr_..."
}
```

### 10.3 Ignored unrelated

HTTP 202

```json
{
  "status": "ignored",
  "reason": "unrelated_event",
  "event_id": "evt_...",
  "correlation_id": "corr_..."
}
```

### 10.4 Validation error

HTTP 400

```json
{
  "error": "validation_error",
  "message": "Invalid Airtable webhook payload",
  "details": [],
  "correlation_id": "corr_..."
}
```

### 10.5 Unauthorized source/signature

HTTP 401/403

```json
{
  "error": "unauthorized_source",
  "message": "Webhook source verification failed",
  "correlation_id": "corr_..."
}
```

### 10.6 Internal error

HTTP 500

```json
{
  "error": "internal_error",
  "message": "Webhook could not be processed",
  "correlation_id": "corr_..."
}
```

No stack trace, SQL error, or secret leakage in response.

## 11. Error Handling

Error categories:
1. Validation errors -> 400, `validation_error`.
2. Source/config verification errors -> 401/403, `unauthorized_source` or `invalid_source_config`.
3. Unsupported media type -> 415.
4. Method not allowed -> 405.
5. Duplicate event -> 202 `duplicate_ignored`.
6. Internal transient infra failures -> 500 with sanitized message; ledger status `retryable_failed` if enqueue path failed.
7. Internal terminal failures -> 500 with sanitized message; ledger status `failed`.

Logging rules:
- log structured error code and correlation_id only
- never log full request body if forbidden fields detected
- never log token/secret material

## 12. Security and Privacy Rules

Forbidden request/metadata fields (must reject or sanitize-drop before persistence):
- `master_copy`
- `cta_url`
- `asset_links`
- `access_token`
- `refresh_token`
- `secret_ref`
- `app_secret`
- full Airtable record snapshot
- raw Facebook/Page token
- raw Slack signing secret

Additional guards:
- payload size limits
- strict JSON parser and schema validator
- constant-time compare for signatures (when configured)
- redact known sensitive key patterns in logs

## 13. Feature Flag / Rollback

Feature flags:
- `WEBHOOK_AIRTABLE_RECEIVER_ENABLED` (default false until rollout approval)
- `WEBHOOK_AIRTABLE_ALLOW_DEV_UNVERIFIED_SOURCE` (default false)
- `WEBHOOK_AIRTABLE_STRICT_SCHEMA` (default true in staging/prod)

Rollback strategy:
1. Disable endpoint via `WEBHOOK_AIRTABLE_RECEIVER_ENABLED=false`.
2. Keep API route registered but return 503 feature-disabled response (sanitized).
3. No schema rollback required for design phase.

## 14. Test Scenarios

1. Valid Approved webhook accepted.
2. Duplicate `event_id` returns `duplicate_ignored` (no second enqueue).
3. Wrong `table_name` ignored with ledger log.
4. Wrong `change_type` ignored with ledger log.
5. Missing required field returns validation error.
6. Forbidden field in payload is rejected or sanitized according to policy.
7. Unknown `base_id` rejected.
8. Missing/invalid source verification rejected unless explicit dev override enabled.
9. Internal ledger failure returns sanitized 500 and no enqueue.
10. Queue enqueue failure after ledger received marks `retryable_failed`.
11. Correlation ID propagated from header when present and valid.
12. Correlation ID generated when header absent.

## 15. Verification Checklist

- [x] File exists at `docs/plans/US-002/US-002-webhook-receiver-api-design.md`.
- [x] Endpoint is `POST /api/v1/webhooks/airtable`.
- [x] Request validation rules defined.
- [x] Source/config verification defined.
- [x] Correlation/causation behavior defined.
- [x] Ingress dedupe uses `event_id`.
- [x] Receiver does not allocate production `approved_version`.
- [x] Receiver does not reload Airtable.
- [x] Receiver does not create workflow stub.
- [x] Receiver does not call AI/MCP/Slack/social publish.
- [x] Sanitized error response contract defined.
- [x] Forbidden fields guard defined.
- [x] Feature flag/rollback strategy defined.
- [x] Test scenarios included.

## 16. Open Questions / Risks

1. Exact Airtable signature/header verification capability may vary by deployment path; finalize canonical approach before implementation.
2. Need final decision on strict unknown-field rejection in early rollout to balance safety vs debugging.
3. Define canonical correlation ID format/length constraints shared across services.
4. Confirm whether ignored unrelated events should always return 202 vs 200 in API gateway standards.
5. Decide whether feature-disabled response should be 404 (hidden route) or 503 (explicitly disabled).
