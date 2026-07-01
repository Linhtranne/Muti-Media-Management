# SPEC-US-002: Airtable Webhook Receiver and Workflow Stub Creation

**Status:** Approved  
**Retrofit Note:** Retrospec — US-002 status: "Designed (Ready for Implementation)" per FL-001. Historical RED output not fully captured.  
**FL Reference:** FL-001 (Airtable Post Approved Webhook) — `docs/requirements/05_Function_Flow_Logic_Register.md` line 51  
**Backlog AC/BR:** US-002 AC1–AC4, BR1–BR5

---

## Goal

Receive the Airtable webhook event when a Post status changes, deduplicate by `event_id` only, enqueue a references-only message to `airtable.webhook.approved`, then in the worker: reload Airtable by `record_id` (zero-trust), revalidate state, allocate `approved_version` (advisory lock), create a `workflow_runs` stub with status `pending_ai_generation`, and ACK only after Ledger commit.

---

## Source References

- **Backlog:** `docs/requirements/04_Product_Backlog.md` — US-002, Epic E01
- **FL-001:** `docs/requirements/05_Function_Flow_Logic_Register.md` line 51–131
- **Receiver route:** `apps/orchestrator/src/routes/airtableWebhook.ts`
- **Worker:** `apps/orchestrator/src/workers/approvedPostWorker.ts`
- **Consumer:** `apps/orchestrator/src/queue/rabbitmqConsumer.ts` (base)
- **Service:** `apps/orchestrator/src/services/channelAccountResolver.ts`
- **Airtable client:** `apps/orchestrator/src/airtable/airtableClient.ts`
- **Queue topology:** `apps/orchestrator/src/queue/topologyConfig.ts` — `airtable.webhook.approved`
- **Plan:** `docs/plans/US-002/PLAN-us-002-airtable-approved-webhook.md`

---

## In Scope

- HTTP POST receiver at `/api/v1/webhook/airtable/approved`.
- Strict Zod validation of webhook payload (`event_id`, `record_id`, `table_name`, `change_type`).
- Deduplication by `event_id` only in receiver (no Airtable reload in receiver).
- Queue publish: `airtable.webhook.approved` (exchange: `airtable.webhooks`) — references-only (no content, no token).
- Worker: Airtable API reload → zero-trust state verification → 9 status classification cases.
- Version allocation: advisory lock on `(workspace_id, airtable_record_id)` → idempotency key `airtable.post.approved:{workspace_id}:{airtable_record_id}:{approved_version}`.
- `workflow_runs` stub creation with `status = 'pending_ai_generation'`.
- ACK only after Ledger commit.

## Out of Scope

- AI composition — belongs to US-003 / FL-002.
- Policy evaluation — belongs to US-004.
- Publishing or MCP calls — strictly out of scope.
- Storing raw Airtable credentials in queue or Ledger.

---

## Functional Contract

Based on FL-001 (7 processing steps):

**Step 1 — Webhook Receiver (Route):**
1. Parse and validate webhook body via Zod (`event_id`, `record_id`, `table_name`, `change_type`). Invalid → 400/ignore.
2. Deduplicate: check if `event_id` already received (in-memory cache or fast Ledger lookup). Duplicate → respond 200, log `unrelated_ignored`, no queue publish.
3. Filter: if `table_name` is not Posts table → log `unrelated_ignored`, respond 200.
4. Publish references-only message to `airtable.webhook.approved`: `{event_id, record_id, workspace_id}`. NO content, NO tokens.
5. Respond 200 immediately.

**Step 2 — Worker (ApprovedPostWorker):**
1. Consume from `airtable.webhook.approved`. Validate message schema.
2. Reload Airtable Post by `record_id` via Airtable API (`GET /v0/{base_id}/Posts/{record_id}`).
3. Zero-trust state verification (9 cases):
   - `Approved` + valid content + channels linked → proceed to step 4.
   - `Scheduled` or `Published` → ACK, log `already_advanced_ignored`.
   - `Draft`, `Review`, `Failed` → ACK, log `state_changed_ignored`.
   - Unknown status → ACK, log `unknown_status_ignored` (fail closed).
   - Invalid content/channels after reload → ACK, log `invalid_after_reload_ignored`.
   - Channel account missing/inactive → ACK, log `channel_account_missing/inactive`.
   - Channel account unresolved → DLQ if Ledger committed, retry if Ledger failed.
   - Infrastructure failure (network/API timeout) → NACK → retry.
   - Duplicate idempotency key → ACK, log `duplicate_ignored`.
4. **Version allocation** (advisory lock on `(workspace_id, airtable_record_id)`):
   - Allocate `approved_version` (monotonic increment or timestamp).
   - Compute idempotency key: `airtable.post.approved:{workspace_id}:{airtable_record_id}:{approved_version}`.
5. **Transaction:** INSERT `workflow_runs` (`status = 'pending_ai_generation'`, `workspace_id`, `airtable_record_id`, `approved_version`, `idempotency_key`, `channel_account_refs` as safe metadata). INSERT `audit_logs` (`WEBHOOK_RECEIVED`, `WEBHOOK_RELOAD_SUCCESS`). COMMIT.
6. **ACK** RabbitMQ ONLY after COMMIT.
7. **Post-Commit:** Outbox relay publishes `ai.compose.facebook.requested` for US-003.

---

## Data / Queue / API Contract

### HTTP API
- **Route:** `POST /api/v1/webhook/airtable/approved`
- **Body:** Airtable webhook native format (not signed by Airtable)
- **Required fields:** `event_id`, `record_id`, `table_name`, `change_type`
- **Response:** 200 always (Airtable expects 200 even for ignored events)

### Queue
- **Queue:** `airtable.webhook.approved`
- **Exchange:** `airtable.webhooks` (topic)
- **Routing key:** `airtable.post.approved.ingress`
- **DLQ:** `airtable.webhook.approved.dlq`
- **Retry:** 5 retries with TTL [1s, 2s, 4s, 8s, 16s]
- **Payload (references-only):** `{event_id, record_id, workspace_id}`
- **Forbidden:** `master_copy`, `cta_url`, tokens, content, assets

### Ledger Entities
- **`workflow_runs`:** `{id, workspace_id, airtable_record_id, approved_version, idempotency_key (UNIQUE), status: "pending_ai_generation", channel_account_refs, created_at}`
- **`audit_logs`:** `WEBHOOK_RECEIVED`, `WEBHOOK_RELOAD_SUCCESS`, `WEBHOOK_PROCESSING_FAILED`

### Idempotency Key
`airtable.post.approved:{workspace_id}:{airtable_record_id}:{approved_version}` → `workflow_runs.idempotency_key` UNIQUE

---

## Security & Safety Rules

- **Zero-trust reload:** Receiver does NOT use Airtable webhook payload for business decisions. Worker reloads from Airtable API with fresh authentication.
- **References-only queue payload:** `master_copy`, CTA URL, content, and tokens must NEVER appear in queue payload.
- **Worker ACKs only after Ledger commit.**
- **Advisory lock** on version allocation prevents concurrent workers from allocating duplicate versions for the same record.
- **Global log redactor** applied to all audit entries — no raw tokens, vault refs, or secrets.

---

## Error Cases

See FL-001 error matrix (9 cases). Key outcomes:

| Case | Ledger Status | Queue |
|:---|:---|:---|
| `Approved` + valid | `workflow_stub_created` | ACK after commit |
| Duplicate idempotency | `duplicate_ignored` | ACK |
| Already `Scheduled`/`Published` | `already_advanced_ignored` | ACK |
| Status changed to `Draft`/`Review`/`Failed` | `state_changed_ignored` | ACK |
| Unknown status | `unknown_status_ignored` | ACK |
| Invalid content after reload | `invalid_after_reload_ignored` | ACK |
| Channel account missing/inactive | `channel_account_missing/inactive` | ACK |
| Channel account unresolved | `channel_account_unresolved` | DLQ or retry |
| Infrastructure failure | `retryable_failed` | NACK |

---

## Acceptance Criteria

**AC1 — Receiver enqueues references-only for Approved posts (Backlog AC1)**
- *Given* a webhook POST with `event_id`, `record_id`, and the Airtable record status is `Approved`
- *When* the receiver processes the webhook
- *Then* a message is published to `airtable.webhook.approved` containing only `{event_id, record_id, workspace_id}` — no `master_copy`, CTA URL, or content.
- *Trace evidence:* Test case `"should enqueue webhook event and respond 200"` in [slackCommandsRoute.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/slackCommandsRoute.test.ts) (conceptual validation) and [REPORT-us-002-webhook-receiver-api-design-2026-05-20.md](file:///d:/Muti-Media%20Management/docs/reports/US-002/REPORT-us-002-webhook-receiver-api-design-2026-05-20.md).

**AC2 — Stale approval is ignored without workflow creation (Backlog AC2)**
- *Given* a webhook for a Post whose status changed from `Approved` back to `Draft` before the worker reloads
- *When* the worker zero-trust reloads from Airtable and sees `Draft`
- *Then* the event is ACKed with `state_changed_ignored` and no `workflow_runs` row is created.
- *Trace evidence:* Test case `"should skip and ACK if status changed to Draft after reload"` in [approvedPostWorker.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/approvedPostWorker.test.ts) and [REPORT-us-002-approved-post-worker-reload-reverify-2026-05-21.md](file:///d:/Muti-Media%20Management/docs/reports/US-002/REPORT-us-002-approved-post-worker-reload-reverify-2026-05-21.md).

**AC3 — Version allocation is idempotent (Backlog AC3)**
- *Given* two concurrent workers receive the same `airtable.webhook.approved` message
- *When* both attempt to allocate `approved_version` for the same `airtable_record_id`
- *Then* only one succeeds (advisory lock) and the second detects duplicate idempotency key, ACKing with `duplicate_ignored`.
- *Trace evidence:* Test case `"should fail closed on duplicate idempotency key"` in [approvedPostWorker.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/approvedPostWorker.test.ts) and [REPORT-us-002-ledger-schema-and-idempotency-2026-05-20.md](file:///d:/Muti-Media%20Management/docs/reports/US-002/REPORT-us-002-ledger-schema-and-idempotency-2026-05-20.md).

**AC4 — Workflow stub triggers AI composer (Backlog AC4)**
- *Given* a successful `workflow_runs` INSERT with `status = 'pending_ai_generation'`
- *When* the transaction commits
- *Then* an outbox event `ai.compose.facebook.requested` is relayed to the queue for US-003.
- *Trace evidence:* Test case `"should transition to pending_ai_generation and insert outbox event"` in [approvedPostWorker.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/approvedPostWorker.test.ts) and [REPORT-us-002-workflow-stub-creation-2026-05-21.md](file:///d:/Muti-Media%20Management/docs/reports/US-002/REPORT-us-002-workflow-stub-creation-2026-05-21.md).

---

## Test Plan

### Existing Test Files (Verified)

| Test File | Path | Coverage |
|:---|:---|:---|
| [approvedPostWorker.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/approvedPostWorker.test.ts) | `apps/orchestrator/src/__tests__/approvedPostWorker.test.ts` | Happy path, stale status (`Draft`), duplicate version (idempotency key constraint), channel account missing |
| [airtableClient.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/airtableClient.test.ts) | `apps/orchestrator/src/__tests__/airtableClient.test.ts` | Airtable GET reload, 404 handling |
| [channelAccountResolver.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/channelAccountResolver.test.ts) | `apps/orchestrator/src/__tests__/channelAccountResolver.test.ts` | Channel account resolution, inactive account validation |
| [rabbitmqConsumer.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/queue/__tests__/rabbitmqConsumer.test.ts) | `apps/orchestrator/src/queue/__tests__/rabbitmqConsumer.test.ts` | Base consumer message schema validation, DLQ routing |
| [airtableContracts.test.ts](file:///d:/Muti-Media%20Management/packages/shared-contracts/src/__tests__/airtableContracts.test.ts) | `packages/shared-contracts/src/__tests__/airtableContracts.test.ts` | Webhook body Zod validation schema contract |

### Verification Evidence Reports

Detailed TDD runs and verification evidence are archived in:
- [REPORT-us-002-approved-post-worker-2026-05-27.md](file:///d:/Muti-Media%20Management/docs/reports/US-002/REPORT-us-002-approved-post-worker-2026-05-27.md)
- [REPORT-us-002-approved-post-worker-reload-reverify-2026-05-21.md](file:///d:/Muti-Media%20Management/docs/reports/US-002/REPORT-us-002-approved-post-worker-reload-reverify-2026-05-21.md)
- [REPORT-us-002-channel-account-resolution-boundary-2026-05-21.md](file:///d:/Muti-Media%20Management/docs/reports/US-002/REPORT-us-002-channel-account-resolution-boundary-2026-05-21.md)

### RED Evidence Status

**Partial** — Implemented before AI-SDLC gate. Original red-stage execution outputs not captured. However, the regression tests exist and currently run green.

---

## Validation Level

**L2** — Verification suite passes with automated tests. Run command:
`npm run test apps/orchestrator/src/__tests__/approvedPostWorker.test.ts`

---

## Open Questions

- OQ-002-1: Is there a receiver-level Airtable signature header? *Resolved:* No signature exists in Airtable webhooks. We verify webhook authenticity via secure origin settings and zero-trust reloads.
- OQ-002-2: Where is the advisory lock implemented? *Resolved:* Implemented in Postgres repository layer using `pg_advisory_xact_lock` for the `(workspace_id, airtable_record_id)` combination inside `approvedPostWorker.ts`.

