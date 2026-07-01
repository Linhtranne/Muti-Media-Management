# SPEC-US-006: Facebook MCP Publish Execution

**Status:** Approved  
**Retrofit Note:** Retrospec — US-006 implemented before AI-SDLC completion gate. Historical RED output not captured. Verified from FL-004b, `topologyConfig.ts`, and test files.  
**FL Reference:** FL-004b (Facebook MCP Publish Execution) — `docs/requirements/05_Function_Flow_Logic_Register.md` line 325  
**Backlog AC/BR:** US-006 AC1–AC4, BR1–BR3

---

## Goal

Execute a scheduled Facebook post by consuming the `publish.facebook.validated` event, calling the MCP `publishPost` tool (which resolves token and calls Graph API internally), persisting `external_post_id` and publish state in Ledger, and compensating Airtable post-commit — without exposing raw tokens or raw Graph API responses outside the MCP server.

---

## Source References

- **Backlog:** `docs/requirements/04_Product_Backlog.md` — US-006
- **FL-004b:** `docs/requirements/05_Function_Flow_Logic_Register.md` line 325–373
- **Scheduler:** `apps/orchestrator/src/workers/mcpPublishScheduler.ts`
- **Consumer:** `apps/orchestrator/src/queue/mcpPublishRabbitmqConsumer.ts`
- **Worker:** `apps/orchestrator/src/workers/mcpPublishWorker.ts`
- **Queue topology:** `apps/orchestrator/src/queue/topologyConfig.ts` — `publish.facebook.execute`
- **MCP Tool:** `apps/facebook-mcp-server/src/tools/publishPost.ts` (MCP boundary — called via MCP client)

---

## In Scope

- `McpPublishScheduler` cron scan: queries `publish_jobs` for `status='validated'` and `scheduled_at <= NOW()`.
- Outbox insertion of `publish_execution_events` and enqueuing `publish.facebook.execute`.
- `McpPublishWorker` consuming `publish.facebook.execute`, locking job with DB transaction.
- MCP client call to `publishPost` (Facebook MCP server resolves token and calls `POST /{page_id}/feed`).
- Ledger state update: `status = 'published'`, `external_post_id`, `published_at`.
- Airtable compensation on publish success (non-blocking: failures set `airtable_sync_retry_needed`).
- Slack admin alert on permanent publish failure.

## Out of Scope

- MCP validation (`validate_post`, `get_rate_limit_status`) — belongs to US-005 / FL-004.
- Policy enforcement — belongs to US-004 / FL-003.
- Facebook Graph API calls from orchestrator — MCP server only.
- Token resolution in orchestrator — MCP server boundary only.

---

## Functional Contract

Based on FL-004b and code inspection:

1. **Scheduler (`McpPublishScheduler`):**
   - Cron job queries `publish_jobs WHERE status='validated' AND scheduled_at <= NOW()`.
   - For each due job: insert `publish_execution_events` outbox row (idempotency: one execute event per job_id). Publish `publish.facebook.execute` event (references-only) to RabbitMQ.

2. **Consumer (`mcpPublishRabbitmqConsumer`):**
   - Consume from `publish.facebook.execute`. Validate schema (Zod). Schema fail → DLQ + ACK.

3. **Worker (`McpPublishWorker`):**
   - Load and lock `publish_jobs` row in Postgres transaction. If `status != 'validated'` (already `publishing`/`published`/`failed`) → idempotency ACK, exit.
   - Transition `publish_jobs.status = 'publishing'`. COMMIT. (Prevents concurrent workers from double-publishing.)
   - Call MCP client → `publishPost` tool on Facebook MCP Server.
     - MCP server: resolves token from `SecretStore` → calls `POST /{page_id}/feed` → returns sanitized `{external_post_id, published_at}` (no raw token, no raw Graph API response).
   - **On success:**
     - Transaction: `publish_jobs.status = 'published'`, `external_post_id`, `published_at`. INSERT `audit_logs`: `PUBLISH_SUCCEEDED`. COMMIT.
     - ACK RabbitMQ after COMMIT.
     - Airtable PATCH: update post status to `Published`, `external_post_id`. If Airtable fails → set `publish_jobs.airtable_sync_retry_needed = true` (Ledger is NOT rolled back).
   - **On transient error (timeout / 5xx from MCP):**
     - Increment `publish_jobs.publish_attempt_count`. NACK → requeue (max 5 retries with backoff [2s, 4s, 8s, 16s, 32s]).
   - **On permanent error (auth fail, permission, post deleted):**
     - `publish_jobs.status = 'failed'`. INSERT `audit_logs`: `PUBLISH_FAILED`. COMMIT.
     - ACK RabbitMQ after COMMIT.
     - Publish Slack admin alert via `alerts.slack.send`.

---

## Data / Queue / API Contract

### Queue: Input
- **Queue:** `publish.facebook.execute`
- **Exchange:** `publish.workflows` (topic)
- **Routing key:** `publish.facebook.execute`
- **DLQ:** `publish.facebook.execute.dlq`
- **Retry:** 5 retries with slow TTL backoff [2s, 4s, 8s, 16s, 32s]
- **Payload (references-only):** `{event_id, event_type: "publish.facebook.execute", workspace_id, job_id, variant_id, channel_account_id, idempotency_key, correlation_id}`
- **Forbidden:** body text, access_token, raw API response

### Ledger Entities
- **`publish_jobs`:** `{job_id, workspace_id, status: "validated"|"publishing"|"published"|"failed", external_post_id, published_at, publish_attempt_count, airtable_sync_retry_needed}`
- **`publish_execution_events`:** outbox `{id, job_id, workspace_id, idempotency_key, dispatched_at}`
- **`audit_logs`:** `PUBLISH_STARTED`, `PUBLISH_SUCCEEDED`, `PUBLISH_FAILED`

### MCP Tool Contract
- **Tool:** `publishPost` on `apps/facebook-mcp-server`
- **Input (from worker):** `channel_account_id`, `variant_id` (references — no raw content or token)
- **Token resolution:** MCP server reads `SecretStore` internally — never exposed to orchestrator
- **Output:** `{external_post_id: string, published_at: string}` — sanitized, no raw Graph API response

---

## Security & Safety Rules

- **Orchestrator never calls `POST /{page_id}/feed` directly** — always via MCP `publishPost` tool.
- **Raw token never appears in:** orchestrator process, queue payload, audit metadata, logs, Airtable fields, Slack messages.
- **Sanitized response only:** `external_post_id` and `published_at` stored in Ledger — no raw Graph API JSON body.
- **ACK only after Ledger commit:** prevents duplicate publish on crash/restart.
- **Scheduler idempotency:** one `publish_execution_events` row per `job_id` prevents duplicate scheduling.
- **Airtable compensation is non-blocking:** Ledger commit is never rolled back for Airtable failure.

---

## Error Cases

| Case | Detection | `publish_jobs.status` | Queue |
|:---|:---|:---|:---|
| Schema invalid | Zod parse fail | N/A | DLQ + ACK original |
| Already published | status check in worker | Unchanged | ACK |
| Already failed | status check in worker | Unchanged | ACK |
| Transient MCP error | timeout / 5xx | `publishing` (unchanged) | NACK → retry |
| Permanent error (auth/perm) | 401/403 from MCP | `failed` | ACK after commit |
| Scheduler duplicate | `publish_execution_events` key exists | Not dispatched again | — |
| Airtable PATCH fail (post-publish) | Airtable 5xx | `published` (Ledger correct) | ACK; `airtable_sync_retry_needed = true` |
| Exhausted retries | retry_count > 5 | `failed` → DLQ | DLQ |

---

## Acceptance Criteria

**AC1 — Published job has `external_post_id` and audit (Backlog AC1)**
- *Given* a `publish.facebook.execute` message for a job with `status='validated'`
- *When* `McpPublishWorker` calls MCP `publishPost` successfully
- *Then* `publish_jobs.status = 'published'`, `external_post_id` is a non-empty string, `published_at` is set, and `audit_logs` contains `PUBLISH_SUCCEEDED` with no raw token.
- *Trace evidence:* Test case `"should update job to published on success"` in [mcpPublishWorker.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/workers/__tests__/mcpPublishWorker.test.ts) and [REPORT-us-006-facebook-publish-2026-06-01.md](file:///d:/Muti-Media%20Management/docs/reports/US-006/REPORT-us-006-facebook-publish-2026-06-01.md).

**AC2 — Token never exposed (Backlog AC2, BR2)**
- *Given* any successful or failed publish execution
- *When* inspecting queue payload, audit_logs, Airtable record, and Slack alert
- *Then* none of these surfaces contain an `access_token`, bearer string, or raw Graph API JSON body.
- *Trace evidence:* Verified in token-leak negative test suite inside [mcpPublishWorker.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/workers/__tests__/mcpPublishWorker.test.ts) and [REPORT-us-006-implementation-2026-06-01.md](file:///d:/Muti-Media%20Management/docs/reports/US-006/REPORT-us-006-implementation-2026-06-01.md).

**AC3 — Transient MCP error triggers retry, not fail-fast (Backlog AC3)**
- *Given* `publishPost` MCP tool returns a timeout on attempt 1
- *When* the worker processes the NACK
- *Then* `publish_jobs.publish_attempt_count` is incremented, the message is requeued with backoff, and `status` remains `publishing` (not `failed`).
- *Trace evidence:* Test case `"should retry and NACK on transient errors"` in [mcpPublishWorker.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/workers/__tests__/mcpPublishWorker.test.ts) and [REPORT-us-006-facebook-publish-2026-06-01.md](file:///d:/Muti-Media%20Management/docs/reports/US-006/REPORT-us-006-facebook-publish-2026-06-01.md).

**AC4 — Permanent error alerts admin and fails cleanly (Backlog AC4)**
- *Given* `publishPost` MCP tool returns a permission error (403)
- *When* the worker processes the result
- *Then* `publish_jobs.status = 'failed'`, audit `PUBLISH_FAILED` is written, a Slack admin alert is sent via `alerts.slack.send`, and the RabbitMQ message is ACKed (no retry loop).
- *Trace evidence:* Test case `"should transition to failed on permanent OAuth error"` in [mcpPublishWorker.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/workers/__tests__/mcpPublishWorker.test.ts).

**AC — Airtable failure does not roll back Ledger (BR3)**
- *Given* a successful publish (Ledger committed) followed by an Airtable PATCH 503
- *When* the worker handles the Airtable error
- *Then* `publish_jobs.status = 'published'` remains, `airtable_sync_retry_needed = true` is set, and no rollback occurs.
- *Trace evidence:* Test case `"should update airtable_sync_retry_needed on Airtable failure"` in [mcpPublishWorker.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/workers/__tests__/mcpPublishWorker.test.ts).

---

## Test Plan

### Existing Test Files (Verified)

| Test File | Path | Coverage |
|:---|:---|:---|
| [mcpPublishWorker.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/workers/__tests__/mcpPublishWorker.test.ts) | `apps/orchestrator/src/workers/__tests__/mcpPublishWorker.test.ts` | Happy path variant publish, transient network retries (NACK), permanent Meta error failures, RLS-checked transactions |
| [mcpPublishScheduler.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/workers/__tests__/mcpPublishScheduler.test.ts) | `apps/orchestrator/src/workers/__tests__/mcpPublishScheduler.test.ts` | Scan validated jobs, outbox creation and queue emission scheduling |
| [mcpPublishRabbitmqConsumer.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/queue/__tests__/mcpPublishRabbitmqConsumer.test.ts) | `apps/orchestrator/src/queue/__tests__/mcpPublishRabbitmqConsumer.test.ts` | Zod schema parse validation on routing keys |
| [publishPost.test.ts](file:///d:/Muti-Media%20Management/apps/facebook-mcp-server/src/__tests__/publishPost.test.ts) | `apps/facebook-mcp-server/src/__tests__/publishPost.test.ts` | MCP server tool execution, token secret resolution |

### Verification Evidence Reports

TDD cycles and verification logs:
- [REPORT-us-006-facebook-publish-2026-06-01.md](file:///d:/Muti-Media%20Management/docs/reports/US-006/REPORT-us-006-facebook-publish-2026-06-01.md)
- [REPORT-us-006-implementation-2026-06-01.md](file:///d:/Muti-Media%20Management/docs/reports/US-006/REPORT-us-006-implementation-2026-06-01.md)
- [REPORT-us-006-documentation-2026-06-01.md](file:///d:/Muti-Media%20Management/docs/reports/US-006/REPORT-us-006-documentation-2026-06-01.md)

### RED Evidence Status

**Partial** — Implemented before AI-SDLC gate. Original red-stage execution outputs not captured. However, the regression tests exist and currently run green.

---

## Validation Level

**L2** — Verification suite passes with automated tests. Run command:
`npm run test apps/orchestrator/src/workers/__tests__/mcpPublishWorker.test.ts`

---

## Open Questions

- OQ-006-1: Does `McpPublishWorker` lock job? *Resolved:* Yes, using SELECT-FOR-UPDATE inside the Postgres transaction before calling the MCP server.
- OQ-006-2: Is `airtable_sync_retry_needed` polled? *Resolved:* Yes, a separate polling cron worker picks up failed syncs to ensure final state consistency.

