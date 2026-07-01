# SPEC-US-015: Unified Direct Message Inbox

**Status:** Approved  
**Retrofit Note:** Retrospec — US-015 implemented before AI-SDLC completion gate. Historical RED output not captured. Verified from FL-014, `topologyConfig.ts`, and test files.  
**FL Reference:** FL-014 (Unified Direct Message Ingestion and Reply) — `docs/requirements/05_Function_Flow_Logic_Register.md` line 677  
**Backlog AC/BR:** US-015 AC1–AC4, BR1–BR4

---

## Goal

Ingest inbound Facebook direct messages via a `dm.facebook.ingest` queue, store them in a Ledger-backed conversation thread model, notify a Slack inbox channel with a safe preview, and allow support/manager/admin users to reply via Slack `/reply_dm` command (routed through MCP `send_direct_message` tool) — without exposing full message bodies, tokens, or customer PII beyond the necessary preview.

---

## Source References

- **Backlog:** `docs/requirements/04_Product_Backlog.md` — US-015, Epic E06
- **FL-014:** `docs/requirements/05_Function_Flow_Logic_Register.md` line 677–745
- **Ingest Consumer:** `apps/orchestrator/src/queue/directMessageIngestRabbitmqConsumer.ts`
- **Ingest Worker:** `apps/orchestrator/src/workers/directMessageIngestWorker.ts`
- **Reply Consumer:** `apps/orchestrator/src/queue/directMessageReplyRabbitmqConsumer.ts`
- **Reply Worker:** `apps/orchestrator/src/workers/directMessageReplyWorker.ts`
- **Repository:** `apps/orchestrator/src/ledger/directMessageRepository.ts`
- **Redactor:** `apps/orchestrator/src/lib/dmRedactor.ts`
- **MCP Tools:** `apps/facebook-mcp-server/src/tools/getDirectMessage.ts`, `sendDirectMessage.ts`
- **Schema:** `packages/shared-contracts/src/__tests__/directMessageContracts.test.ts`
- **Queue Topology:** `apps/orchestrator/src/queue/topologyConfig.ts` — `dm.facebook.ingest`, `dm.reply.requested`

---

## In Scope

- Ingest flow: `dm.facebook.ingest` queue → `DirectMessageIngestWorker` → upsert `conversations` + insert `conversation_messages` → Slack inbox alert (preview max 80 chars).
- Reply flow: Slack `/reply_dm <conversation_id> <message>` command → `dm.reply.requested` queue → `DirectMessageReplyWorker` → MCP `send_direct_message` → Ledger update → Slack confirmation.
- Idempotency: `(workspace_id, platform, external_message_id)` unique constraint.
- SLA tracking: `conversations.sla_due_at = NOW() + DM_SLA_HOURS` (env-driven, default 2h).
- Role-based command authorization: only `support`, `manager`, `admin` can execute `/reply_dm`.
- MCP boundary: `send_direct_message` resolves token server-side; orchestrator passes `channel_account_id` + `external_thread_id` only.

## Out of Scope

- Instagram, Zalo DMs — queue entries exist as stubs (`dm.instagram.ingest`, `dm.zalo.ingest`) but worker logic is not implemented in US-015 MVP.
- Automated AI-generated reply suggestions — out of scope for US-015.
- `/escalate` DM conversations — that belongs to US-009 (comment escalation) scope; DM escalation is separate.
- Claiming complete historical TDD — US-015 implemented before AI-SDLC gate.

---

## Functional Contract

Based on FL-014:

### Flow 1 — Ingest (Inbound DM)

1. **Ingestion source:** MCP validates origin/signature of Facebook DM webhook. Publishes references-only event to `dm.facebook.ingest` (exchange: `mediaops.events.topic`). No raw message body in queue payload.
2. **Consumer (`directMessageIngestRabbitmqConsumer`):** Validate schema via `DirectMessageIngestEventSchema`. Invalid → DLQ (`dm.facebook.ingest.dlq`) + ACK.
3. **Idempotency:** `checkIdempotency()` on `(workspace_id, platform, external_message_id)`. Duplicate → audit `DM_DUPLICATE_IGNORED` → ACK.
4. **Worker (`DirectMessageIngestWorker`):** Start transaction `SET LOCAL app.current_workspace_id = :workspace_id`.
5. **MCP `get_direct_message`:** Call via MCP client, passing `channel_account_id` + `external_message_id`. MCP resolves token server-side and returns sanitized `{body, sender_name, created_at}` (no raw token).
6. **Upsert `conversations`:** Lookup by `(workspace_id, platform, external_thread_id)`.
   - New: set `status = 'new'`, `sla_due_at = NOW() + DM_SLA_HOURS`.
   - Existing + resolved: set `status = 'new'`, update `last_message_at`.
   - Existing + open: update `last_message_at` only.
7. **Insert `conversation_messages`:** direction `inbound`, sender `customer`, body (plaintext — stored in DB).
8. **Audit `DM_INGESTED`.**
9. **Slack notification:** publish preview to Slack inbox channel — sender name + `body_preview` max 80 chars (via `dmRedactor`). NO full message body.
10. **COMMIT and ACK.**

### Flow 2 — Reply (Outbound DM)

1. **Slack command `/reply_dm <conversation_id> <message>`:** received via `POST /api/v1/slack/commands` (shared route).
2. **Signature verification:** same HMAC-SHA256 + replay-window as US-008/US-009.
3. **Role check:** `workspace_members` role must be `support`, `manager`, or `admin`. `creator`/`viewer` → reject.
4. **Create `direct_message_reply_jobs`:** `status = 'received'`. Publish references-only event to `dm.reply.requested`.
5. **Worker (`DirectMessageReplyWorker`):** Claims job in transaction, transitions to `processing`.
6. **MCP `send_direct_message`:** Worker calls MCP client with `channel_account_id`, `external_thread_id`, `reply_body`. MCP resolves token from secret store → calls Graph API `POST /{thread_id}/messages`. Returns `{external_message_id}` (no token).
7. **On success:**
   - `direct_message_reply_jobs.status = 'succeeded'`.
   - Insert `conversation_messages` (direction `outbound`, sender `agent`).
   - Update `conversations.status = 'waiting'`.
   - Audit `DM_REPLY_SUCCEEDED`.
   - ACK.
8. **On permanent error (auth fail):**
   - `direct_message_reply_jobs.status = 'failed'`.
   - Audit `DM_REPLY_FAILED`.
   - Slack admin alert.
   - ACK.

---

## Data / Queue / API Contract

### Queue: Ingest
- **Queue:** `dm.facebook.ingest`
- **Exchange:** `mediaops.events.topic` (canonical topic)
- **DLQ:** `dm.facebook.ingest.dlq`
- **Retry:** 5 retries with TTL [1s, 2s, 4s, 8s]
- **Payload (references-only):** `{event_id, event_type: "dm.facebook.ingest", workspace_id, platform: "facebook", channel_account_id, external_thread_id, external_message_id, customer_ref, body_preview, created_at_platform, has_attachments, idempotency_key, correlation_id}`
- **Forbidden:** raw message body, token, full customer PII

### Queue: Reply
- **Queue:** `dm.reply.requested`
- **Exchange:** `mediaops.events.topic`
- **DLQ:** `dm.reply.requested.dlq`
- **Retry:** 5 retries with TTL [1s, 2s, 4s, 8s]
- **Payload (references-only):** `{event_id, event_type: "dm.reply.requested", workspace_id, conversation_id, reply_job_id, channel_account_id, external_thread_id, idempotency_key, correlation_id}` — NO reply_body in queue

### Ledger Entities
- **`conversations`:** `{id, workspace_id, platform, external_thread_id, customer_ref, status: "new"|"assigned"|"waiting"|"resolved"|"escalated", sla_due_at, last_message_at, assigned_to_member_id}`
- **`conversation_messages`:** `{id, conversation_id, workspace_id, direction: "inbound"|"outbound", sender: "customer"|"agent", body, external_message_id, created_at}`
- **`direct_message_reply_jobs`:** `{id, workspace_id, conversation_id, reply_body (stored in Ledger), status: "received"|"processing"|"succeeded"|"failed", idempotency_key}`
- **`audit_logs`:** `DM_RECEIVED`, `DM_INGESTED`, `DM_DUPLICATE_IGNORED`, `DM_INGEST_FAILED`, `DM_REPLY_QUEUED`, `DM_REPLY_SUCCEEDED`, `DM_REPLY_FAILED`

### MCP Tool Contracts
- **`get_direct_message(channel_account_id, external_message_id)`** → `{body: string, sender_name: string, created_at: string}` (sanitized)
- **`send_direct_message(channel_account_id, external_thread_id, reply_body)`** → `{external_message_id: string}` (sanitized)

---

## Security & Safety Rules

- **No full message body in Slack notification, Airtable, or Notion:** `dmRedactor` enforces max 80-char preview.
- **Token resolution strictly in MCP server:** orchestrator passes references only to both `get_direct_message` and `send_direct_message`.
- **RLS on all DM tables:** `SET LOCAL app.current_workspace_id = :workspace_id` in every transaction.
- **FK tenant guard on assignment:** `assigned_to_member_id` must be validated against `workspace_members WHERE workspace_id = :workspace_id` before write.
- **Role check for reply:** only `support`, `manager`, `admin` — enforced in route handler, not worker.
- **`reply_body` not in queue payload:** stored in Ledger (`direct_message_reply_jobs`); worker reads from Ledger, not from queue.

---

## Error Cases

| Case | Detection | Ledger Status | Queue |
|:---|:---|:---|:---|
| Malformed ingest event | Zod schema fail | `DM_INGEST_FAILED` | DLQ + ACK |
| Duplicate ingest | Idempotency guard | `DM_DUPLICATE_IGNORED` | ACK |
| MCP `get_direct_message` transient error | Timeout | Unchanged | NACK → retry |
| DB transaction fail (ingest) | Postgres timeout | Unchanged | NACK → retry |
| Unauthorized Slack user for reply | Role not support/manager/admin | Reply job `rejected` | ACK |
| MCP `send_direct_message` auth error | 401/403 | Reply job `failed` | ACK after commit |
| MCP `send_direct_message` transient | 5xx/timeout | `processing` | NACK → retry |

---

## Acceptance Criteria

**AC1 — Inbound DM stored and Slack notification sent (Backlog AC1)**
- *Given* a `dm.facebook.ingest` event with a valid `external_message_id` for a new thread
- *When* `DirectMessageIngestWorker` processes the event
- *Then* a `conversations` row with `status = 'new'` and `sla_due_at` set is upserted, a `conversation_messages` row with direction `inbound` is inserted, a Slack inbox notification with `body_preview` ≤ 80 chars is sent, and `audit_logs` contains `DM_INGESTED`.
- *Trace evidence:* Test case `"should ingest new direct messages and notify Slack"` in [directMessageIngestWorker.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/workers/__tests__/directMessageIngestWorker.test.ts) and [REPORT-us-015-implementation-2026-06-05.md](file:///d:/Muti-Media%20Management/docs/reports/US-015/REPORT-us-015-implementation-2026-06-05.md).

**AC2 — Duplicate DM is ignored without side effects (Backlog AC2)**
- *Given* a `dm.facebook.ingest` event with the same `external_message_id` as a previously ingested message
- *When* the consumer checks idempotency
- *Then* no new `conversation_messages` row is inserted, `audit_logs` contains `DM_DUPLICATE_IGNORED`, and the message is ACKed.
- *Trace evidence:* Test case `"should ignore duplicate inbound direct messages"` in [directMessageIngestWorker.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/workers/__tests__/directMessageIngestWorker.test.ts).

**AC3 — Reply routed through MCP without token in queue (Backlog AC3)**
- *Given* a valid `/reply_dm <conversation_id> <message>` command from a `support` user
- *When* the route creates a reply job and the worker processes `dm.reply.requested`
- *Then* the queue payload contains no `reply_body` field, `direct_message_reply_jobs.status = 'succeeded'`, and a `conversation_messages` row with direction `outbound` is inserted.
- *Trace evidence:* Test case `"should process reply job and send direct message through MCP"` in [directMessageReplyWorker.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/workers/__tests__/directMessageReplyWorker.test.ts).

**AC4 — Unauthorized role rejected for reply (Backlog AC4)**
- *Given* a `/reply_dm` command from a Slack user with role `creator`
- *When* the route handler resolves the role
- *Then* the reply job is stored with `status = 'rejected'`, no queue message is published, and an ephemeral unauthorized response is returned.
- *Trace evidence:* Test case `"should reject DM reply from creator role"` in [slackCommandsRoute.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/slackCommandsRoute.test.ts).

---

## Test Plan

### Existing Test Files (Verified)

| Test File | Path | Coverage |
|:---|:---|:---|
| [directMessageIngestWorker.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/workers/__tests__/directMessageIngestWorker.test.ts) | `apps/orchestrator/src/workers/__tests__/directMessageIngestWorker.test.ts` | Inbound DM ingestion, duplicate processing prevention, Slack message truncation alerts |
| [directMessageReplyWorker.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/workers/__tests__/directMessageReplyWorker.test.ts) | `apps/orchestrator/src/workers/__tests__/directMessageReplyWorker.test.ts` | Slack `/reply_dm` command handling, MCP send_direct_message calls, Ledger updates |
| [directMessageIngestRabbitmqConsumer.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/queue/__tests__/directMessageIngestRabbitmqConsumer.test.ts) | `apps/orchestrator/src/queue/__tests__/directMessageIngestRabbitmqConsumer.test.ts` | Schema fail → DLQ, valid messages routing |
| [directMessageReplyRabbitmqConsumer.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/queue/__tests__/directMessageReplyRabbitmqConsumer.test.ts) | `apps/orchestrator/src/queue/__tests__/directMessageReplyRabbitmqConsumer.test.ts` | Schema check for reply requests |
| [directMessageRepository.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/directMessageRepository.test.ts) | `apps/orchestrator/src/__tests__/directMessageRepository.test.ts` | conversations + conversation_messages Ledger queries |
| [dmRedactor.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/lib/__tests__/dmRedactor.test.ts) | `apps/orchestrator/src/lib/__tests__/dmRedactor.test.ts` | dmRedactor 80-char boundaries checking |
| [directMessage.test.ts](file:///d:/Muti-Media%20Management/apps/facebook-mcp-server/src/tools/__tests__/directMessage.test.ts) | `apps/facebook-mcp-server/src/tools/__tests__/directMessage.test.ts` | MCP server tools getDirectMessage + sendDirectMessage execution testing |
| [directMessageContracts.test.ts](file:///d:/Muti-Media%20Management/packages/shared-contracts/src/__tests__/directMessageContracts.test.ts) | `packages/shared-contracts/src/__tests__/directMessageContracts.test.ts` | Event schema validations for DM payloads |

### Verification Evidence Reports

TDD cycles and verification logs:
- [REPORT-us-015-implementation-2026-06-05.md](file:///d:/Muti-Media%20Management/docs/reports/US-015/REPORT-us-015-implementation-2026-06-05.md)
- [us-015-bugfix-2026-06-05.md](file:///d:/Muti-Media%20Management/docs/reports/us-015-bugfix-2026-06-05.md)

### RED Evidence Status

**Partial** — Implemented before AI-SDLC gate. Original RED stage execution outputs not captured. However, regression tests exist and currently run green.

---

## Validation Level

**L2** — Verification suite passes with automated tests. Run command:
`npm run test apps/orchestrator/src/workers/__tests__/directMessageIngestWorker.test.ts`

---

## Open Questions

- OQ-015-1: Are `get_direct_message` and `send_direct_message` MCP tools implemented? *Resolved:* Yes. They are implemented inside [getDirectMessage.ts](file:///d:/Muti-Media%20Management/apps/facebook-mcp-server/src/tools/getDirectMessage.ts) and [sendDirectMessage.ts](file:///d:/Muti-Media%20Management/apps/facebook-mcp-server/src/tools/sendDirectMessage.ts).
- OQ-015-2: Is `/reply_dm` handled in the same `slackCommands.ts` route? *Resolved:* Yes, the single Slack Commands endpoint maps `/reply_dm` commands alongside other admin tools.

