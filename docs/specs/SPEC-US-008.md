# SPEC-US-008: Slack Approve/Reject Post Command

**Status:** Approved  
**Retrofit Note:** Retrospec — story implemented before AI-SDLC completion gate. Historical RED output not captured. Current verified behavior documented below based on FL-009, code inspection, and existing tests.  
**FL Reference:** FL-009 (Slack Approve/Reject Post Slash Command) — `docs/requirements/05_Function_Flow_Logic_Register.md` line 749  
**Backlog AC/BR:** US-008 AC1–AC4, BR1–BR3

---

## Goal

Allow authorized managers and admins to approve or reject scheduled posts from Slack using `/approve_post <post_id>` or `/reject_post <post_id> <reason>`, while persisting the command lifecycle to Ledger and propagating the decision to Airtable via async worker.

---

## Source References

- **Backlog:** `docs/requirements/04_Product_Backlog.md` — US-008, Epic E04
- **FL-009:** `docs/requirements/05_Function_Flow_Logic_Register.md` line 749–819
- **Route:** `apps/orchestrator/src/routes/slackCommands.ts`
- **Worker:** `apps/orchestrator/src/workers/slackPostApprovalWorker.ts` (verify path)
- **Repository:** `apps/orchestrator/src/ledger/slackCommandRepository.ts` (verify path)
- **Queue:** `apps/orchestrator/src/queue/topologyConfig.ts` — `slack.post_approval.requested`
- **Parser:** `apps/orchestrator/src/services/slackCommandParser.ts`

---

## In Scope

- HTTP route `POST /api/v1/slack/commands` receiving `/approve_post` and `/reject_post` commands.
- Slack HMAC-SHA256 signature verification using raw body and `SLACK_SIGNING_SECRET`.
- Replay protection: reject requests with timestamp older than 5 minutes.
- Command parsing: extract `action` (approve/reject), `postId`, optional `reason`.
- Role lookup from `workspace_members` table; only `manager` and `admin` roles allowed.
- Idempotency: one `slack_command_events` row per (workspace, user, command, text, slack_timestamp).
- Async worker `SlackPostApprovalWorker`: fetch event → fetch post from Airtable → update Airtable status → update Ledger → audit.
- Fast ephemeral HTTP 200 response before async work.
- RabbitMQ queue: `slack.post_approval.requested` (exchange: `slack.workflows`, DLQ: `slack.post_approval.requested.dlq`).

## Out of Scope

- `/reply_comment` and `/escalate` commands — those belong to US-009.
- Direct message inbox or DM reply workflows — those belong to US-015.
- Proactive Slack alert sending — that uses the shared `alerts.slack.send` queue.
- Full delayed response UX beyond the MVP immediate ephemeral response.
- Claiming complete historical TDD — US-008 was implemented before the AI-SDLC gate.

---

## Functional Contract

Based on FL-009 verified implementation:

**Step 1 — Webhook Receiver (Route Handler):**
1. Parse raw body buffer; compute `HMAC-SHA256(SLACK_SIGNING_SECRET, "v0:{timestamp}:{body}")`.
2. Compare in constant time against `X-Slack-Signature` header. Reject if mismatch → audit `SLACK_SIGNATURE_REJECTED`, return 200 ephemeral error.
3. Check `X-Slack-Request-Timestamp` vs `Date.now()`. Reject if diff > 5 minutes → audit, return 200 ephemeral error.
4. Parse `command` and `text` fields from `application/x-www-form-urlencoded` body.
5. Route: if `command === "/approve_post"` or `command === "/reject_post"` → proceed. Else → ignore (US-009 handles comment commands).
6. Parse via `slackCommandParser.parse(command, text)`: extract `action`, `postId`, optional `reason`. Return usage error if invalid.
7. Reject `/reject_post` if `reason` is empty or whitespace → return ephemeral usage response, no side effect.
8. Compute idempotency key from `(workspace_id, slack_user_id, command, text, slack_timestamp)`. Insert or fetch `slack_command_events` row.
9. Lookup Slack user in `workspace_members` by `slack_user_id`. If role is not `manager` or `admin` → update event to `rejected`, audit `SLACK_COMMAND_REJECTED`, return ephemeral unauthorized response.
10. Update event status to `queued`.
11. Respond immediately with HTTP 200 ephemeral message ("Approval queued.").
12. Publish references-only event to `slack.post_approval.requested`: carries `{command_event_id, workspace_id, correlation_id, idempotency_key}` only — no raw tokens, no reject reason, no Airtable key.

**Step 2 — Worker (SlackPostApprovalWorker):**
1. Consume message from `slack.post_approval.requested`.
2. Fetch `slack_command_events` row by `command_event_id`. If not found → ACK.
3. Fetch target Airtable post by `postId` (from event). Verify post exists and state is compatible with approval/rejection.
4. If `approve`: call Airtable PATCH to set post status to `Approved`.
5. If `reject`: call Airtable PATCH to update review/rejection fields with sanitized `reason`.
6. Update `slack_command_events.status` to `succeeded` or `failed`.
7. Write audit log via `AuditLogRepository`: event `SLACK_COMMAND_SUCCEEDED` or `SLACK_COMMAND_FAILED`.
8. ACK RabbitMQ message ONLY after Ledger state is committed.

---

## Data / Queue / API Contract

### HTTP API
- **Route:** `POST /api/v1/slack/commands`
- **Content-Type:** `application/x-www-form-urlencoded`
- **Required Headers:** `X-Slack-Signature`, `X-Slack-Request-Timestamp`
- **Body fields:** `command`, `text`, `user_id`, `team_id`
- **Accepted commands:** `/approve_post <post_id>`, `/reject_post <post_id> <reason>`

### Ledger Entities
- **`slack_command_events`:** `{command_id, slack_user_id, command, args, verified, role, status, workspace_id, idempotency_key, created_at}`
- **`workspace_members`:** queried by `(workspace_id, slack_user_id)` → returns `role`
- **`audit_logs`:** appended with `{workspace_id, event_type, entity_type, entity_id, actor_type, actor_id, correlation_id, idempotency_key, metadata}`

### Queue Contract
- **Producer:** `POST /api/v1/slack/commands` route
- **Queue:** `slack.post_approval.requested`
- **Exchange:** `slack.workflows` (topic)
- **Routing key:** `slack.post_approval.requested`
- **DLQ:** `slack.post_approval.requested.dlq`
- **Retry:** 5 retries with TTL backoff [1s, 2s, 4s, 8s, 16s]
- **Payload (references-only):** `{command_event_id, workspace_id, correlation_id, idempotency_key, event_type: "slack.post_approval.requested"}`
- **Forbidden in payload:** raw tokens, reject reason, signing secret, Airtable API key

---

## Security & Safety Rules

- **Signature verification mandatory:** every request verified before any business logic.
- **Replay protection:** reject timestamps older than 5 minutes.
- **Role must come from `workspace_members`:** never trust `user_id` from Slack body as authorization.
- **Reject reason never goes into queue payload:** stays in Ledger only, after worker fetch.
- **Audit metadata redacted:** no raw tokens, secrets, signing keys in audit logs (via `AuditLogRepository` redactor).
- **ACK only after Ledger commit:** worker must persist state before ACKing.

---

## Error Cases

| Case | Detection | Action | Ledger Status | Queue |
|:---|:---|:---|:---|:---|
| Invalid signature | HMAC mismatch | Return 200 ephemeral error, audit `SLACK_SIGNATURE_REJECTED` | `rejected` | — |
| Stale timestamp | diff > 5 min | Return 200 ephemeral error, audit | `rejected` | — |
| Invalid command format | Parser returns error | Return 200 usage response, no event inserted | — | — |
| Missing reject reason | `/reject_post` with empty reason | Return 200 usage response, no side effect | — | — |
| Unauthorized role | role not `manager`/`admin` | Update event to `rejected`, return 200 ephemeral | `rejected` | — |
| Duplicate command | Idempotency key exists | Reuse existing event, audit `SLACK_COMMAND_DUPLICATE_IGNORED` | Unchanged | — |
| Airtable transient error | Worker: HTTP 5xx / timeout | NACK → retry with backoff (max 5) | `failed` | Retry |
| Post not found or invalid state | Worker: Airtable 404 or wrong status | Mark `failed`, audit | `failed` | ACK |
| DLQ | Max retries exceeded | Route to `slack.post_approval.requested.dlq` | `failed` | DLQ |

---

## Acceptance Criteria

**Acceptance Criteria**

**AC1 — Invalid commands rejected (Backlog AC1)**
- *Given* a POST to `/api/v1/slack/commands` with a valid signature but `command=/approve_post` and empty `text`
- *When* the route processes the request
- *Then* it returns HTTP 200 with an ephemeral usage error, no `slack_command_events` row is inserted, and no queue message is published.
- *Trace evidence:* Test case `"should return error for missing post id in approve"` in [slackCommandParser.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/slackCommandParser.test.ts) and [REPORT-us-008-slack-approve-reject-2026-06-02.md](file:///d:/Muti-Media%20Management/docs/reports/REPORT-us-008-slack-approve-reject-2026-06-02.md).

**AC2 — Unauthorized role rejected (Backlog AC2)**
- *Given* a valid signed Slack command `/approve_post POST-123` from a Slack user with role `creator` in `workspace_members`
- *When* the route resolves the role
- *Then* the command event is stored with `status = "rejected"`, the route returns 200 with an unauthorized ephemeral message, and no queue message is published.
- *Trace evidence:* Test case `"should reject with ephemeral error if user role is not admin or manager"` in [slackCommandsRoute.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/slackCommandsRoute.test.ts).

**AC3 — Approve/reject updates Airtable (Backlog AC3)**
- *Given* a valid signed `/approve_post POST-123` from a `manager` user
- *When* `SlackPostApprovalWorker` processes the queued event
- *Then* the Airtable post status is updated to `Approved`, `slack_command_events.status = "succeeded"`, and an audit log entry with `event_type = "SLACK_COMMAND_SUCCEEDED"` is written.
- *Trace evidence:* Test case `"should process approve command and update Airtable status"` in [slackPostApprovalWorker.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/slackPostApprovalWorker.test.ts).

**AC3b — Reject requires reason (Backlog BR2)**
- *Given* a valid signed `/reject_post POST-123` with no reason text
- *When* the route processes the request
- *Then* it returns HTTP 200 with a usage error and no side effect occurs.
- *Trace evidence:* Test case `"should return error for missing reason in reject"` in [slackCommandParser.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/slackCommandParser.test.ts).

**AC4 — Audit log written (Backlog AC4)**
- *Given* any completed approve or reject command lifecycle
- *When* the worker finishes
- *Then* `audit_logs` contains a row with `workspace_id`, `actor_id = slack_user_id`, `entity_type = "post"`, `entity_id = post_id`, and `metadata` with no raw tokens, signing secrets, or Airtable API keys.
- *Trace evidence:* Test case `"should record audit logs upon successful post approval"` in [slackPostApprovalWorker.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/slackPostApprovalWorker.test.ts).

---

## Test Plan

### Existing Test Files (Verified)

| Test File | Path | Coverage |
|:---|:---|:---|
| [slackCommandParser.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/slackCommandParser.test.ts) | `apps/orchestrator/src/__tests__/slackCommandParser.test.ts` | Valid command parsing, extraction of arguments, empty/missing reason checks |
| [slackSignatureVerifier.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/slackSignatureVerifier.test.ts) | `apps/orchestrator/src/__tests__/slackSignatureVerifier.test.ts` | HMAC check, replay timestamps older than 5 min |
| [slackCommandsRoute.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/slackCommandsRoute.test.ts) | `apps/orchestrator/src/__tests__/slackCommandsRoute.test.ts` | Ephemeral message responses, workspace role checks |
| [slackPostApprovalWorker.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/slackPostApprovalWorker.test.ts) | `apps/orchestrator/src/__tests__/slackPostApprovalWorker.test.ts` | Success approval/rejection state transitions, Airtable API failures, DB audits |
| [slackCommandContracts.test.ts](file:///d:/Muti-Media%20Management/packages/shared-contracts/src/__tests__/slackCommandContracts.test.ts) | `packages/shared-contracts/src/__tests__/slackCommandContracts.test.ts` | Zod validation contracts for command events |

### Verification Evidence Reports

TDD cycles and verification logs:
- [REPORT-us-008-slack-approve-reject-2026-06-02.md](file:///d:/Muti-Media%20Management/docs/reports/REPORT-us-008-slack-approve-reject-2026-06-02.md)

### RED Evidence Status

**Partial** — Implemented before AI-SDLC gate. Original RED stage execution outputs not captured. However, regression tests exist and currently run green.

---

## Validation Level

**L2** — Verification suite passes with automated tests. Run command:
`npm run test apps/orchestrator/src/__tests__/slackPostApprovalWorker.test.ts`

---

## Evidence Requirements

- Spec approved: this file, `status: Approved`
- Test evidence: test files listed above exist and pass.
- RED evidence: Partial (pre-gate implementation).

---

## Documentation Conflict

**No unresolved conflict.** FL-009 exists at line 749 of `docs/requirements/05_Function_Flow_Logic_Register.md` and correctly references US-008.

**FL-006 (line 552, Backlog Link: US-007):** FL-006 is a legacy generic Slack Command Handler stub predating FL-009. It has no impact on code behavior.

---

## Open Questions

- OQ-008-1: Does `SlackPostApprovalWorker` write reject reason to Ledger? *Resolved:* Yes, the worker reads the reason parsed from the command event and persists it to the ledger before updating Airtable.
- OQ-008-2: Is Airtable rate limit retry handled at the queue level? *Resolved:* Yes, it is caught and handled via queue-level NACK with exponential backoff (max 5 retries).

