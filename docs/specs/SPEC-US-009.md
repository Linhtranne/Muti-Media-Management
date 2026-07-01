# SPEC-US-009: Slack Reply and Escalate Comment Command

**Status:** Approved  
**Retrofit Note:** Retrospec — story implemented before AI-SDLC completion gate. Historical RED output not captured. Current verified behavior documented below based on FL-010, code inspection, and existing tests.  
**FL Reference:** FL-010 (Slack Reply/Escalate Comment Slash Command) — `docs/requirements/05_Function_Flow_Logic_Register.md` line 821  
**Backlog AC/BR:** US-009 AC1–AC4, BR1–BR3

---

## Goal

Allow authorized support, manager, and admin users to reply to or escalate a Facebook comment from Slack using `/reply_comment <interaction_id> <message>` or `/escalate <interaction_id> [reason]`, with the reply dispatched through MCP and the interaction state updated in Ledger.

---

## Source References

- **Backlog:** `docs/requirements/04_Product_Backlog.md` — US-009, Epic E04
- **FL-010:** `docs/requirements/05_Function_Flow_Logic_Register.md` line 821–873
- **Route:** `apps/orchestrator/src/routes/slackCommands.ts` (shared with US-008)
- **Worker:** `apps/orchestrator/src/workers/slackCommentActionWorker.ts`
- **Repository:** `apps/orchestrator/src/ledger/commentActionRepository.ts`
- **Consumer:** `apps/orchestrator/src/queue/slackCommentActionRabbitmqConsumer.ts`
- **Queue:** `apps/orchestrator/src/queue/topologyConfig.ts` — `slack.comment_action.requested`
- **Parser:** `apps/orchestrator/src/services/slackCommandParser.ts`
- **MCP:** `apps/facebook-mcp-server/src/tools/replyComment.ts`

---

## In Scope

- Slack slash commands `/reply_comment <interaction_id> <message>` and `/escalate <interaction_id> [reason]` routed through `POST /api/v1/slack/commands`.
- Signature verification reused from US-008 (same route handler, same middleware).
- Role check: only `support`, `manager`, `admin` allowed to reply or escalate.
- Idempotency via `comment_action_events` table keyed on `(workspace_id, idempotency_key)`.
- Async worker `SlackCommentActionWorker`: fetch event → fetch interaction → resolve channel → call MCP `replyComment` (for reply) or publish Slack escalation alert (for escalate) → update Ledger → ACK.
- RabbitMQ queue: `slack.comment_action.requested` (exchange: `slack.workflows`, DLQ: `slack.comment_action.requested.dlq`).
- Ledger: `comment_action_events`, `interactions`, audit logs.

## Out of Scope

- `/approve_post` and `/reject_post` commands — those belong to US-008.
- Direct message inbox or `dm.reply.requested` queue — those belong to US-015.
- Fetching Facebook comment content directly from Graph API in the route handler; MCP handles Graph API calls.
- Automated escalation without Slack command; that is triggered by risk classifier in US-007.
- Claiming complete historical TDD — US-009 was implemented before the AI-SDLC gate.

---

## Functional Contract

Based on FL-010 verified implementation:

**Step 1 — Webhook Receiver (Route Handler, shared with US-008):**
1. Slack signature verification: same HMAC-SHA256 + replay-window check as US-008.
2. Parse `command` and `text`. Route: if `command === "/reply_comment"` or `command === "/escalate"` → proceed. Other commands → US-008 path.
3. Parse via `slackCommandParser.parse(command, text)`: extract `interactionId` (UUID format) and `message` or `reason`.
4. Reject if `interactionId` is missing or not a valid UUID → return 200 ephemeral usage error, no event inserted.
5. Reject if `message` is empty for `/reply_comment` → return 200 ephemeral usage error.
6. Compute idempotency key for `comment_action_events`. Check for duplicate — if exists, return 200 "already queued" response.
7. Insert `comment_action_events` row with `status = "received"`, `action = "reply"` or `"escalate"`.
8. Lookup Slack user in `workspace_members`. Role must be `support`, `manager`, or `admin`. If `creator` or `viewer` → update event to `rejected`, return 200 unauthorized response.
9. Update event status to `queued`.
10. Respond immediately HTTP 200 ephemeral message.
11. Publish references-only event to `slack.comment_action.requested`: `{action_event_id, workspace_id, correlation_id, idempotency_key, event_type: "slack.comment_action.requested"}`.

**Step 2 — Worker (SlackCommentActionWorker):**
1. Consume message from `slack.comment_action.requested`.
2. Fetch `comment_action_events` row by `action_event_id`. If not found → ACK.
3. Fetch `interactions` row by `interactionId`. If not found → mark event `failed`, audit, ACK.
4. Resolve `channel_account_id` from the interaction (platform-specific).
5. **If `reply`:**
   - Call Facebook MCP tool `replyComment` via MCP client, passing `channel_account_id`, `external_comment_id`, `message`.
   - MCP server resolves token from secret store; calls Graph API.
   - On success: update `interactions.status` → returned value, write `external_reply_id` to Ledger, update event `succeeded`, audit `SLACK_COMMENT_ACTION_SUCCEEDED`.
   - On MCP error: determine retryable vs terminal; retry via NACK or mark `failed`.
6. **If `escalate`:**
   - Update `interactions.status = "escalated"`.
   - Publish Slack alert to crisis channel via `alerts.slack.send` queue.
   - Update event `succeeded`, audit `SLACK_COMMENT_ACTION_SUCCEEDED`.
7. ACK RabbitMQ message ONLY after Ledger state committed.

---

## Data / Queue / API Contract

### HTTP API
- **Route:** `POST /api/v1/slack/commands` (shared with US-008)
- **Accepted commands:** `/reply_comment <interaction_id_uuid> <message>`, `/escalate <interaction_id_uuid> [reason]`
- **Interaction ID format:** UUID (`/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i`)

### Ledger Entities
- **`comment_action_events`:** `{id, workspace_id, slack_user_id, action: "reply"|"escalate", interaction_id, message, status: "received"|"queued"|"processing"|"succeeded"|"rejected"|"failed", idempotency_key, created_at}`
- **`interactions`:** queried by `(workspace_id, id)` → returns `{external_comment_id, platform, status, channel_account_id}`
- **`audit_logs`:** appended with `event_type: "SLACK_COMMENT_ACTION_SUCCEEDED"|"SLACK_COMMENT_ACTION_FAILED"`

### Queue Contract
- **Queue:** `slack.comment_action.requested`
- **Exchange:** `slack.workflows` (topic)
- **Routing key:** `slack.comment_action.requested`
- **DLQ:** `slack.comment_action.requested.dlq`
- **Retry:** 5 retries with TTL backoff [1s, 2s, 4s, 8s, 16s]
- **Payload (references-only):** `{action_event_id, workspace_id, correlation_id, idempotency_key, event_type: "slack.comment_action.requested"}`
- **Forbidden in payload:** raw tokens, message body, signing secret

### MCP Tool (Reply path only)
- **Tool:** `replyComment` on `apps/facebook-mcp-server`
- **Input:** `channel_account_id`, `external_comment_id`, `reply_body`
- **Token:** resolved inside MCP server from secret store — never exposed to orchestrator or queue

---

## Security & Safety Rules

- **MCP boundary enforced:** `SlackCommentActionWorker` never calls Facebook Graph API directly; always via MCP `replyComment` tool.
- **Role check mandatory:** `creator` and `viewer` cannot reply or escalate — resolved from `workspace_members`, not Slack user_id.
- **Empty message rejected:** `/reply_comment` with blank message returns usage error before event insert.
- **Queue payload references-only:** message body, channel token, and signing secret must not appear in queue payload.
- **ACK only after Ledger commit:** worker ACKs after both `comment_action_events` update and any MCP call state are persisted.
- **Audit metadata redacted:** no raw tokens in audit_logs.

---

## Error Cases

| Case | Detection | Action | Ledger Status | Queue |
|:---|:---|:---|:---|:---|
| Invalid signature | HMAC mismatch | Return 200 ephemeral error, no event | — | — |
| Invalid interaction ID format | Parser: UUID validation fails | Return 200 usage error, no event | — | — |
| Empty message for reply | Parser: blank message | Return 200 usage error, no event | — | — |
| Unauthorized role (`creator`, `viewer`) | `workspace_members` role check | Event `rejected`, return 200 unauthorized | `rejected` | — |
| Duplicate command | Idempotency key exists | Return 200 "already queued", no new publish | Unchanged | — |
| Interaction not found | Worker: DB lookup returns null | Mark event `failed`, audit, ACK | `failed` | ACK |
| MCP reply transient error | Timeout / 5xx from MCP | NACK → retry with backoff (max 5) | Unchanged | Retry |
| MCP reply terminal error | Auth fail / permission error | Mark event `failed`, audit `SLACK_COMMENT_ACTION_FAILED`, ACK | `failed` | ACK |
| DLQ | Max retries exceeded | Route to `slack.comment_action.requested.dlq` | `failed` | DLQ |

---

## Acceptance Criteria

**Acceptance Criteria**

**AC1 — Only authorized roles can reply/escalate (Backlog AC1, AC2)**
- *Given* a valid signed `/reply_comment <uuid> Hello` from a Slack user with role `support`
- *When* the route resolves the role
- *Then* the event is queued with `status = "queued"` and a queue message is published.
- *Trace evidence:* Test case `"should enqueue reply event on authorized role support"` in [slackCommandsRoute.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/slackCommandsRoute.test.ts) and [REPORT-us-009-implementation-2026-06-02.md](file:///d:/Muti-Media%20Management/docs/reports/REPORT-us-009-implementation-2026-06-02.md).

- *Given* the same command from a Slack user with role `creator`
- *When* the route resolves the role
- *Then* the event is stored with `status = "rejected"` and no queue message is published.
- *Trace evidence:* Test case `"should reject with unauthorized for creator role"` in [slackCommandsRoute.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/slackCommandsRoute.test.ts).

**AC2 — Empty message for reply_comment is rejected (Backlog BR2)**
- *Given* a valid signed `/reply_comment <uuid>` with no message text
- *When* the parser processes the command
- *Then* a usage error response is returned, no `comment_action_events` row is inserted.
- *Trace evidence:* Test case `"should return error for missing message in reply_comment"` in [slackCommandParser.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/slackCommandParser.test.ts).

**AC3 — Reply failure has clear error and interaction not marked resolved (Backlog AC3)**
- *Given* a queued reply event and MCP `replyComment` returns a terminal auth error
- *When* `SlackCommentActionWorker` processes the event
- *Then* `comment_action_events.status = "failed"`, the interaction status is NOT updated to `resolved`, and an audit log entry `SLACK_COMMENT_ACTION_FAILED` is written.
- *Trace evidence:* Test case `"should fail event and keep interaction open on terminal MCP error"` in [slackCommentActionWorker.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/workers/__tests__/slackCommentActionWorker.test.ts).

**AC4 — Escalate sends crisis channel alert (Backlog AC4)**
- *Given* a valid signed `/escalate <uuid>` from a `support` user
- *When* `SlackCommentActionWorker` processes the event
- *Then* `interactions.status = "escalated"` is committed, a Slack alert is published to the crisis channel via `alerts.slack.send` queue, and `comment_action_events.status = "succeeded"`.
- *Trace evidence:* Test case `"should process escalate command and dispatch crisis Slack alert"` in [slackCommentActionWorker.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/workers/__tests__/slackCommentActionWorker.test.ts).

---

## Test Plan

### Existing Test Files (Verified)

| Test File | Path | Coverage |
|:---|:---|:---|
| [slackCommandParser.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/slackCommandParser.test.ts) | `apps/orchestrator/src/__tests__/slackCommandParser.test.ts` | Slack commands parser Zod checking, empty message bounds, UUID formatting |
| [slackCommentActionWorker.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/workers/__tests__/slackCommentActionWorker.test.ts) | `apps/orchestrator/src/workers/__tests__/slackCommentActionWorker.test.ts` | Escalation flow, Slack alert publish, database status commit logic, MCP error NACK retries |
| [slackCommentActionRabbitmqConsumer.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/queue/__tests__/slackCommentActionRabbitmqConsumer.test.ts) | `apps/orchestrator/src/queue/__tests__/slackCommentActionRabbitmqConsumer.test.ts` | Zod schema payload checks, RabbitMQ topology declaration |
| [replyComment.test.ts](file:///d:/Muti-Media%20Management/apps/facebook-mcp-server/src/tools/__tests__/replyComment.test.ts) | `apps/facebook-mcp-server/src/tools/__tests__/replyComment.test.ts` | MCP server tool execution, FB token integration |

### Verification Evidence Reports

TDD cycles and verification notes:
- [REPORT-us-009-implementation-2026-06-02.md](file:///d:/Muti-Media%20Management/docs/reports/REPORT-us-009-implementation-2026-06-02.md)

### RED Evidence Status

**Partial** — Implemented before AI-SDLC gate. Original RED stage execution outputs not captured. However, regression tests exist and currently run green.

---

## Validation Level

**L2** — Verification suite passes with automated tests. Run command:
`npm run test apps/orchestrator/src/workers/__tests__/slackCommentActionWorker.test.ts`

---

## Open Questions

- OQ-009-1: Does `/escalate` reply on Facebook? *Resolved:* No. It only transitions the Ledger interaction status to `escalated` and publishes a Slack crisis alert via the queue. No Meta Graph API call is made.
- OQ-009-2: Is there a specific crisis channel env? *Resolved:* It uses `POLICY_BLOCK_SLACK_CHANNEL_ID` as the target crisis alert channel for escalation notifications as well to avoid configuration redundancy.

