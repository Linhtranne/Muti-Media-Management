# PLAN: US-008 Slack Approve/Reject Post Commands

**Version:** 1.1  
**Date:** 2026-06-02  
**Status:** Approved — Implementation in progress  
**Related:** US-008, Epic E04 Communication Plane

---

## Overview

US-008 delivers the Slack slash command layer for approving or rejecting Facebook posts directly from Slack, without requiring the manager to open Airtable. This sits in the **Communication Plane** of the Composability architecture. Slack is a *communication surface* only — it is not a database, not a queue, and not a role authority. All decisions are recorded in the **Operational Ledger** (Postgres) and reflected back to the **Control Plane** (Airtable).

### Architecture Position

```
Slack (Communication Plane)
        |
        | HTTP POST /api/v1/slack/commands
        v
Express Orchestrator  ─── Signature Verifier (raw body)
        |
        | (immediate 200 ack)
        |
     Fast Path: invalid/unauthorized → audit + ephemeral Slack response
        |
     Happy Path: persist command event → validate role from Ledger → enqueue
        |
        v
RabbitMQ: slack.post_approval.requested
        |
        v
SlackPostApprovalWorker
   ├── Reload post/status from Airtable
   ├── Update Airtable status (Approved / Rejected)
   ├── Commit Ledger command event final status
   ├── Write audit_log entry
   └── ACK RabbitMQ (only after Ledger commit)
```

**Boundaries:**
- No platform token (SLACK_BOT_TOKEN, AIRTABLE_API_KEY) appears in queue messages or logs.
- No raw signing secret in logs/audit.
- Slack user ID is **never** trusted as a role — always mapped from Ledger `members` / workspace config.
- Reject reason is stored in Ledger but sanitized before logging/Slack response.

---

## Docs Read

| Priority | Document | Key Constraints Extracted |
|:---|:---|:---|
| **P0** | `docs/architecture/06_Architecture_Composability.md` | Slack = Communication Plane only. Airtable = Control Plane. Ledger = audit/source-of-truth. `slack_command_event` entity listed. RabbitMQ payload = references-only. Workers ACK after Ledger commit. DLQ alert mandatory. |
| **P0** | `docs/architecture/11_Coding_Convention.md` | TypeScript for services. Shared contracts in `packages/shared-contracts`. No raw token in logs/Airtable/Slack/audit. Every external event needs idempotency key. Workers ACK after Ledger state update. DLQ handling must create admin-visible alert. Security test Slack signature verification. |
| **P1** | `docs/requirements/04_Product_Backlog.md` | US-008 ACs: AC1 invalid command rejected, AC2 role guard, AC3 Airtable update, AC4 audit. BRs: BR1 verify signature, BR2 reject needs reason, BR3 fast response. |
| **P1** | `docs/requirements/05_Function_Flow_Logic_Register.md` | FL-004b (Slack Command Handler stub): verify sig → parse → map role → validate permission → execute → update Airtable/Ledger → respond. Audit events: `SLACK_COMMAND_RECEIVED`, `SLACK_COMMAND_REJECTED`, `SLACK_COMMAND_SUCCEEDED`. Security: never trust Slack user id without role mapping, reject stale signed requests. |
| **P2** | `docs/project-mgmt/07_Risk_Assumption_Decision_Log.md` | D-005: Slack before Teams. D-013: per-workspace `auto_approve_enabled`, manager/admin only; permission UI scope of US-008. R-004: Slack command spoofing risk — verify signature + role. R-005: token exposure — critical. A-003: Slack assumed acceptable for MVP. |
| **P2** | `docs/requirements/03_SRS_MediaOps_Composability.md` | SRS 5.6: slash command must verify signature, map Slack user to role, audit all commands. FR-12: Role Mapping required. NFR: command audit, token never in Slack message, Teams = phase 2. |

---

## Skills and Specialist Knowledge Applied

| Skill / Source | Applied Pattern |
|:---|:---|
| `spawner/integrations/slack-bot-builder/skill.yaml` | HTTP mode (not Socket Mode) for production. Acknowledge within 3 seconds — ack immediately, process in background via RabbitMQ. Never log or expose tokens. |
| `spawner/integrations/slack-bot-builder/sharp-edges.yaml` | `request-signing-bypass` (critical): verify `X-Slack-Signature` + `X-Slack-Request-Timestamp` using constant-time HMAC-SHA256 with raw body. Reject timestamps older than 5 minutes. `3-second-acknowledgment` (critical): HTTP handler must respond within 3s — use async queue for Airtable update. `token-exposure` (critical): never log signing secret or bot token. |
| `spawner/backend/queue-workers/skill.yaml` | Idempotent job processing; DLQ pattern; ACK only after state commit; exponential backoff (1s, 2s, 4s, 8s, 16s). |
| Architecture conventions (existing codebase) | Follow `policyRabbitmqConsumer.ts` DLQ pattern. Follow `policyWorker.ts` worker structure. Follow `policyWorkerRepository.ts` transaction pattern with `SET LOCAL app.current_workspace_id`. Follow `redact.ts` for sanitizing logs. |

---

## Current Implementation Context

| Component | Status | Notes |
|:---|:---|:---|
| `apps/orchestrator/src/server.ts` | Exists | Express app, single `/api/v1` mount. Need to add Slack route with `raw body` middleware. |
| `apps/orchestrator/src/routes/airtableWebhook.ts` | Exists | Pattern reference for route factories. Slack route needs separate `express.raw()` middleware before signature verification. |
| `apps/orchestrator/src/queue/rabbitmqPublisher.ts` | Exists | Has `publishSlackAlert`. Need to add `publishSlackCommandAction`. |
| `apps/orchestrator/src/queue/policyRabbitmqConsumer.ts` | Exists | Full DLQ consumer pattern to replicate. |
| `apps/orchestrator/src/workers/policyWorker.ts` | Exists | Worker pattern: `processQueueMessage` → transaction → side effects → return action. |
| `apps/orchestrator/src/ledger/workerRepository.ts` | Exists | `SET LOCAL app.current_workspace_id` pattern. Audit log via `audit_logs` table. |
| `apps/orchestrator/src/lib/redact.ts` | Exists | Redacts `token`, `secret`, `password`, `api_key` keys and common bearer patterns. |
| `apps/orchestrator/src/config/env.ts` | Exists | Zod schema. Missing: `SLACK_SIGNING_SECRET`, `SLACK_BOT_TOKEN`, `SLACK_COMMANDS_ENABLED`, `SLACK_COMMAND_MAX_REASON_LENGTH`. |
| `packages/shared-contracts/src/` | Exists | No `slack/` subdirectory yet. Need to add Slack command contracts. |
| `db/migrations/` | Exists (0001–0006) | No `members` table. No `slack_command_events` table. Next migration: `0008`. |
| Slack route | **Missing** | `POST /api/v1/slack/commands` does not exist. |
| Slack signature verifier | **Missing** | `SlackSignatureVerifier` service does not exist. |
| Slack command parser | **Missing** | Parser for `/approve_post` and `/reject_post` does not exist. |
| SlackPostApprovalWorker | **Missing** | Worker does not exist. |
| `slackCommandRabbitmqConsumer.ts` | **Missing** | Consumer does not exist. |
| `slackCommandRepository.ts` | **Missing** | Ledger repository does not exist. |
| `members` table | **Missing** | No migration creates a `members` table. Need a stub/minimal version for US-008. |

---

## Scope

### In Scope

1. `POST /api/v1/slack/commands` — Express route with raw body middleware for signature verification.
2. `SlackSignatureVerifier` service — HMAC-SHA256, constant-time comparison, 5-minute timestamp window.
3. `SlackCommandParser` service — parse `/approve_post <post_id>` and `/reject_post <post_id> <reason>`.
4. Shared contracts in `packages/shared-contracts/src/slack/`:
   - `slashCommand.ts` — incoming Slack command payload schema (Zod).
   - `slackCommandAction.ts` — internal RabbitMQ event for `slack.post_approval.requested`.
5. `slack_command_events` Ledger table with full schema (see § Ledger Schema Requirements).
6. `workspace_members` stub table — minimal role mapping (`slack_user_id → role`) for US-008; no full OAuth user-linking.
7. Role lookup from Ledger `workspace_members` table.
8. Idempotency by `idempotency_key = sha256(workspace_id + slack_user_id + command + args + slack_request_ts)`.
9. Fast HTTP acknowledgement (200 + ephemeral text) within Slack's 3-second window.
10. Async RabbitMQ worker `SlackPostApprovalWorker` — updates Airtable status + Ledger + audit.
11. Audit log for every command lifecycle event (received, rejected, succeeded, failed).
12. Sanitized Slack response — no internal error detail, no token.
13. Tests — signature verifier, route, worker, consumer (see § Test Plan).
14. Migration `0008_us008_slack_approve_reject.sql`.
15. Function Logic Register entry `FL-005` for US-008.

### Out of Scope

1. `/reply_comment` and `/escalate` — US-009.
2. Slack alert sender (publishing alerts to Slack via bot) — already partially present in US-004/US-007; out of scope for US-008 beyond ephemeral command responses.
3. Microsoft Teams phase 2.
4. Admin UI for role management — US-010.
5. Full Slack OAuth user linking — MVP uses Ledger mapping stub (`workspace_members` config table).
6. Delayed response using `response_url` — MVP uses immediate ephemeral ack only; final result goes to audit log. *(Open Question OQ-008-2.)*

---

## Success Criteria / AC Mapping

| AC / BR | Implementation Evidence | Test(s) |
|:---|:---|:---|
| AC1: Invalid command rejected | Parser returns `MALFORMED_COMMAND` / `UNKNOWN_COMMAND`; HTTP 200 + ephemeral error; audit `SLACK_COMMAND_REJECTED` | `slackCommandsRoute.test.ts` — malformed, unknown command |
| AC2: Role guard — non-manager/admin rejected | Role lookup returns `viewer`/`creator`; HTTP 200 + ephemeral forbidden; audit `SLACK_COMMAND_REJECTED` | `slackCommandsRoute.test.ts` — unauthorized role |
| AC3: Approve/reject updates Airtable | Worker calls `airtableClient.updatePostStatus(postId, 'Approved'/'Rejected')` | `slackPostApprovalWorker.test.ts` — Airtable called |
| AC4: Every command has audit log | Every code path writes to `audit_logs` via `slackCommandRepository` | All route + worker tests verify audit log |
| BR1: Verify Slack signature | `SlackSignatureVerifier.verify(rawBody, headers)` — constant-time HMAC | `slackSignatureVerifier.test.ts` — valid/invalid/stale |
| BR2: Reject requires reason | Parser validates `reason` present for `/reject_post`; missing → `MISSING_REASON` error | `slackCommandsRoute.test.ts` — reject without reason |
| BR3: Fast response | HTTP handler returns 200 within Slack timeout; Airtable update deferred to worker | `slackCommandsRoute.test.ts` — response before async |
| Security: no raw token in logs | `redact()` applied to all log calls; no `SLACK_SIGNING_SECRET` in logs | `slackSignatureVerifier.test.ts` — no secret in log output |
| Idempotency: duplicate retry | `idempotency_key` UNIQUE constraint; duplicate → fast-pass ACK, no double update | `slackPostApprovalWorker.test.ts` — duplicate idempotency |
| RabbitMQ references-only | Queue payload contains only IDs, no raw body/token/reason blob | `slackPostApprovalWorker.test.ts` — payload inspection |
| Worker ACK after Ledger commit | ACK called only after `slackCommandRepository.commitFinalStatus()` | `slackPostApprovalWorker.test.ts` — ACK timing |

---

## Architecture Flow

```
1.  Slack sends HTTP POST to `POST /api/v1/slack/commands`
       Headers: X-Slack-Signature, X-Slack-Request-Timestamp
       Body:    application/x-www-form-urlencoded (raw)

2.  Express route receives raw body (express.raw({ type: '*/*' }))
    — NOT express.json() — so HMAC can be computed on original bytes.

3.  SlackSignatureVerifier.verify(rawBody, headers):
       a. Parse X-Slack-Request-Timestamp; reject if abs(now - ts) > 300s.
       b. Compute HMAC-SHA256 over "v0:{ts}:{rawBody}" with SLACK_SIGNING_SECRET.
       c. Constant-time comparison (timingSafeEqual) with X-Slack-Signature.
       d. Reject → HTTP 200 + ephemeral "Command failed" + audit SLACK_SIGNATURE_REJECTED.

4.  Parse URL-encoded body:
       command: "/approve_post" | "/reject_post"
       text:    "<post_id>" | "<post_id> <reason>"
       user_id: Slack user ID (untrusted — used only for lookup)
       team_id: Slack team/workspace ID

5.  Persist slack_command_events row (status='received') with idempotency_key.
    — If duplicate idempotency_key: return 200 ack, log SLACK_COMMAND_DUPLICATE_IGNORED.

6.  Validate command syntax:
       /approve_post: post_id must be present and non-empty.
       /reject_post:  post_id + reason both required; reason trimmed + length check.
       Unknown command → MALFORMED_COMMAND error → update status='rejected' → audit → 200 ack.

7.  Role lookup from Ledger:
       SELECT role FROM workspace_members WHERE workspace_id = $1 AND slack_user_id = $2
       If not found or role NOT IN ('manager', 'admin'):
           → update status='rejected', error_code='UNAUTHORIZED_ROLE' → audit → 200 ack.

8.  Valid command, authorized user:
       Update slack_command_events.status = 'queued'.
       Publish to RabbitMQ queue 'slack.post_approval.requested' (references-only payload).
       HTTP 200 + ephemeral "Processing your request..." (within 3s window).

9.  SlackPostApprovalWorker (async):
       a. Validate queue message schema (Zod).
       b. Idempotency check on slack_command_events by idempotency_key.
       c. SET LOCAL app.current_workspace_id = :workspace_id.
       d. Reload post status from Airtable (zero-trust reload).
       e. Verify post is in a reviewable state.
       f. Call airtableClient.updatePostStatus(postId, 'Approved'|'Rejected', reason?).
       g. Update slack_command_events.status = 'succeeded'|'failed'.
       h. Append audit_log entry (SLACK_COMMAND_SUCCEEDED | SLACK_COMMAND_FAILED).
       i. COMMIT Ledger.
       j. ACK RabbitMQ (only after COMMIT).

10. If Airtable update fails after Ledger commit:
       slack_command_events.airtable_sync_retry_needed = true
       Compensating audit entry.
       Do NOT roll back Ledger.

Boundary Rules:
  - SLACK_SIGNING_SECRET never logged, never in audit metadata.
  - SLACK_BOT_TOKEN never in queue payload or logs.
  - Slack user ID is looked up against workspace_members; never trusted as a role directly.
  - Reject reason stored in Ledger (sanitized length) but not echoed verbatim to Slack response.
  - Queue payload: { command_event_id, workspace_id, action, post_id, correlation_id, idempotency_key }
    — NO reason text, NO user display name, NO raw headers.
```

---

## Proposed Files

### New Files

| File | Action | Purpose |
|:---|:---|:---|
| `packages/shared-contracts/src/slack/slashCommand.ts` | **NEW** | Zod schema for incoming Slack slash command payload |
| `packages/shared-contracts/src/slack/slackCommandAction.ts` | **NEW** | Zod schema + TypeScript type for internal `slack.post_approval.requested` queue event |
| `packages/shared-contracts/src/__tests__/slackCommandContracts.test.ts` | **NEW** | Contract tests for both Slack schemas |
| `apps/orchestrator/src/routes/slackCommands.ts` | **NEW** | Express router for `POST /api/v1/slack/commands` |
| `apps/orchestrator/src/services/slackSignatureVerifier.ts` | **NEW** | HMAC-SHA256 verifier with constant-time comparison |
| `apps/orchestrator/src/services/slackCommandParser.ts` | **NEW** | Parse and validate `/approve_post` and `/reject_post` |
| `apps/orchestrator/src/workers/slackPostApprovalWorker.ts` | **NEW** | Async worker: Airtable update + Ledger commit + ACK |
| `apps/orchestrator/src/queue/slackCommandRabbitmqConsumer.ts` | **NEW** | RabbitMQ consumer for `slack.post_approval.requested` |
| `apps/orchestrator/src/ledger/slackCommandRepository.ts` | **NEW** | Ledger operations for `slack_command_events` and audit |
| `apps/orchestrator/src/__tests__/slackSignatureVerifier.test.ts` | **NEW** | Security gate: valid/invalid/stale signature tests |
| `apps/orchestrator/src/__tests__/slackCommandsRoute.test.ts` | **NEW** | Route integration tests |
| `apps/orchestrator/src/__tests__/slackPostApprovalWorker.test.ts` | **NEW** | Worker unit/integration tests |
| `db/migrations/0008_us008_slack_approve_reject.sql` | **NEW** | `slack_command_events` table + `workspace_members` stub + RLS |

### Modified Files

| File | Action | Change |
|:---|:---|:---|
| `apps/orchestrator/src/server.ts` | **MODIFY** | Mount `slackCommandsRouter`, start `slackCommandConsumer` |
| `apps/orchestrator/src/config/env.ts` | **MODIFY** | Add `SLACK_SIGNING_SECRET`, `SLACK_BOT_TOKEN`, `SLACK_COMMANDS_ENABLED`, `SLACK_COMMAND_MAX_REASON_LENGTH` |
| `apps/orchestrator/src/queue/rabbitmqPublisher.ts` | **MODIFY** | Add `publishSlackCommandAction` method |
| `packages/shared-contracts/src/index.ts` | **MODIFY** | Export Slack command contracts |
| `docs/requirements/05_Function_Flow_Logic_Register.md` | **MODIFY** | Replace FL-004b stub with full FL-005 for US-008 |

---

## Ledger Schema Requirements

### `slack_command_events` Table

```sql
CREATE TABLE IF NOT EXISTS slack_command_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      TEXT NOT NULL,
  slack_user_id     TEXT NOT NULL,                      -- untrusted, from Slack payload
  slack_team_id     TEXT NOT NULL,                      -- Slack workspace/team ID
  command           TEXT NOT NULL,                      -- '/approve_post' | '/reject_post'
  action            TEXT NOT NULL,                      -- 'approve' | 'reject'
  args              TEXT NOT NULL,                      -- sanitized text (post_id [reason])
  target_post_id    TEXT NOT NULL,
  reason            TEXT,                               -- NULL for approve; sanitized for reject
  verified          BOOLEAN NOT NULL DEFAULT false,     -- signature verified
  role              TEXT,                               -- resolved role (manager/admin/viewer/unknown)
  status            TEXT NOT NULL DEFAULT 'received',   -- received/queued/succeeded/rejected/failed
  idempotency_key   TEXT NOT NULL UNIQUE,
  correlation_id    TEXT NOT NULL,
  error_code        VARCHAR(80),
  error_message     TEXT,
  airtable_sync_retry_needed BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT slack_command_events_action_chk CHECK (action IN ('approve', 'reject')),
  CONSTRAINT slack_command_events_status_chk CHECK (
    status IN ('received', 'queued', 'succeeded', 'rejected', 'failed', 'duplicate_ignored')
  )
);

CREATE INDEX IF NOT EXISTS idx_slack_command_events_workspace_status
  ON slack_command_events (workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_slack_command_events_user
  ON slack_command_events (workspace_id, slack_user_id);
```

RLS:
```sql
ALTER TABLE slack_command_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS slack_command_events_workspace_rls ON slack_command_events;
CREATE POLICY slack_command_events_workspace_rls ON slack_command_events
  USING (workspace_id = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));
```

### `workspace_members` Stub Table (role mapping)

```sql
CREATE TABLE IF NOT EXISTS workspace_members (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  TEXT NOT NULL,
  slack_user_id TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'viewer',         -- 'admin' | 'manager' | 'viewer' | 'creator'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT workspace_members_role_chk CHECK (role IN ('admin', 'manager', 'viewer', 'creator')),
  CONSTRAINT uq_workspace_members_user UNIQUE (workspace_id, slack_user_id)
);

ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_members_workspace_rls ON workspace_members;
CREATE POLICY workspace_members_workspace_rls ON workspace_members
  USING (workspace_id = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));
```

> **Note:** If a `members` or `workspace_members` table already exists at implementation time, adapt the migration to `ADD COLUMN` or `CREATE TABLE IF NOT EXISTS`. Current scan of migrations 0001–0006 shows **no** `members` or `workspace_members` table exists.

---

## Event Contracts

### Incoming Slack Slash Command (HTTP Body — `application/x-www-form-urlencoded`)

Parsed from raw body by `SlackCommandParser`:

```typescript
// packages/shared-contracts/src/slack/slashCommand.ts
export const SlackSlashCommandSchema = z.object({
  command:      z.string().startsWith('/'),
  text:         z.string().max(500).default(''),      // sanitized args
  user_id:      z.string().min(1),                    // Slack user ID (untrusted)
  team_id:      z.string().min(1),
  channel_id:   z.string().optional(),
  response_url: z.string().url().optional(),          // for delayed response (OQ-008-2)
});
```

**Forbidden fields in any log/audit/queue:**
- `SLACK_SIGNING_SECRET`
- `SLACK_BOT_TOKEN`
- raw `X-Slack-Signature` header value
- raw request body if it could contain PII beyond sanitized args

### Internal Queue Event: `slack.post_approval.requested`

```typescript
// packages/shared-contracts/src/slack/slackCommandAction.ts
export const SlackCommandActionEventSchema = z.object({
  event_id:          z.string().uuid(),
  event_type:        z.literal('slack.post_approval.requested'),
  event_version:     z.number().int().default(1),
  workspace_id:      z.string().min(1),
  command_event_id:  z.string().uuid(),               // FK → slack_command_events.id
  action:            z.enum(['approve', 'reject']),
  target_post_id:    z.string().min(1),
  idempotency_key:   z.string().min(1),
  correlation_id:    z.string().min(1),
  created_at:        z.string().datetime(),
});
```

**Forbidden fields in queue payload:**
- `SLACK_SIGNING_SECRET`
- `SLACK_BOT_TOKEN`
- `reason` text (reload from Ledger in worker)
- `slack_user_id` raw (worker reads from DB via `command_event_id`)
- raw request headers
- Any token or large content blob

---

## Command Parsing Rules

| Input | Result |
|:---|:---|
| `/approve_post POST-123` | action=`approve`, post_id=`POST-123`, reason=null |
| `/reject_post POST-123 Content policy violation` | action=`reject`, post_id=`POST-123`, reason=`Content policy violation` |
| `/approve_post` (no post_id) | Error: `MISSING_POST_ID` |
| `/reject_post POST-123` (no reason) | Error: `MISSING_REASON` |
| `/reject_post POST-123 ` (whitespace only) | Error: `MISSING_REASON` |
| `/approve_post ` (empty text) | Error: `MISSING_POST_ID` |
| `/unknown_command ...` | Error: `UNKNOWN_COMMAND` |
| reason > `SLACK_COMMAND_MAX_REASON_LENGTH` chars | Error: `REASON_TOO_LONG` (default: 500) |
| post_id contains special chars / injection | Sanitize to alphanumeric + `-` + `_`; reject if empty after sanitize |

---

## Security Constraints

| Constraint | Implementation |
|:---|:---|
| Verify signature using raw body | `express.raw({ type: '*/*' })` mounted before route; body passed as `Buffer` to verifier |
| Reject stale timestamp | `abs(Date.now()/1000 - ts) > 300` → reject |
| Constant-time comparison | `crypto.timingSafeEqual(expected, received)` |
| Do not log raw signing secret | `SLACK_SIGNING_SECRET` used only inside `SlackSignatureVerifier`; never passed to logger or redact |
| Do not trust Slack user ID as role | `workspace_members` lookup required before any action |
| Role manager/admin only | `role NOT IN ('manager', 'admin')` → `UNAUTHORIZED_ROLE` rejection |
| Idempotency for duplicate Slack retry | `idempotency_key` UNIQUE in DB; duplicate → ACK no-op |
| Audit all decisions | Every code branch writes to `audit_logs` |
| No secrets in logs/audit/Slack response | `redact()` applied; error messages are generic user-facing codes |
| RabbitMQ payload references-only | `SlackCommandActionEvent` contains only IDs + action enum |

---

## Error Handling Matrix

| Case | Detection | HTTP Response | Ledger Status | Audit Event | RabbitMQ |
|:---|:---|:---|:---|:---|:---|
| Invalid signature | HMAC mismatch | 200 + ephemeral error | `rejected` (signature_invalid) | `SLACK_SIGNATURE_REJECTED` | None |
| Stale timestamp | ts > 5 min old | 200 + ephemeral error | `rejected` (stale_timestamp) | `SLACK_SIGNATURE_REJECTED` | None |
| Malformed command | Parse error | 200 + ephemeral error | `rejected` (malformed_command) | `SLACK_COMMAND_REJECTED` | None |
| Missing post_id | Parse error | 200 + ephemeral error | `rejected` (missing_post_id) | `SLACK_COMMAND_REJECTED` | None |
| Missing reason (reject) | Parse error | 200 + ephemeral error | `rejected` (missing_reason) | `SLACK_COMMAND_REJECTED` | None |
| Reason too long | Parse error | 200 + ephemeral error | `rejected` (reason_too_long) | `SLACK_COMMAND_REJECTED` | None |
| Unauthorized role | Role lookup fail | 200 + ephemeral "Not authorized" | `rejected` (unauthorized_role) | `SLACK_COMMAND_REJECTED` | None |
| Duplicate command retry | Idempotency key exists | 200 + ephemeral "Already processed" | `duplicate_ignored` | `SLACK_COMMAND_DUPLICATE_IGNORED` | None |
| Valid command, enqueued | Happy path | 200 + ephemeral "Processing..." | `queued` | `SLACK_COMMAND_RECEIVED` | Publish |
| Airtable update success | Worker happy path | (async) | `succeeded` | `SLACK_COMMAND_SUCCEEDED` | ACK |
| Airtable update failure | Airtable API error | (async, no re-response) | `failed` + `airtable_sync_retry_needed=true` | `SLACK_COMMAND_FAILED` | ACK (compensating) |
| Ledger failure before ACK | DB error | (async) | Unchanged | None (NACK → retry) | NACK |
| Queue publish failure | RabbitMQ error | 200 ack already sent | Mark `queued` failed; log error | `SLACK_COMMAND_QUEUE_FAILED` | N/A |
| Unknown post_id in Airtable | Worker reload | (async) | `failed` (unknown_post) | `SLACK_COMMAND_FAILED` | ACK |
| Post no longer reviewable | Worker status check | (async) | `failed` (post_not_reviewable) | `SLACK_COMMAND_FAILED` | ACK |
| Worker exhausted retries | DLQ threshold | (async) | `failed` (dlq) | `SLACK_COMMAND_DLQ` | DLQ |

---

## Queue Behavior

| Property | Value |
|:---|:---|
| Exchange | `slack.workflows` (topic, durable) |
| Queue | `slack.post_approval.requested` (durable) |
| Routing Key | `slack.post_approval.requested` |
| DLQ Queue | `slack.post_approval.requested.dlq` (durable) |
| Prefetch | 1 (per consumer channel) |
| Retry backoff | Exponential: 1s, 2s, 4s, 8s, 16s (max 5 retries) |
| ACK rule | Only after Ledger `slack_command_events.status` committed |
| NACK rule | Transient DB / network errors → requeue |
| DLQ trigger | Schema invalid OR retry_count > 5 |
| Idempotency key | Stored in `slack_command_events.idempotency_key` (UNIQUE) |
| Correlation ID | Propagated from HTTP handler → queue → worker → audit |
| Causation ID | HTTP request ID |

---

## Slack Response Behavior

| Scenario | Slack Response |
|:---|:---|
| Invalid signature / stale ts | HTTP 200 + ephemeral: "Command verification failed. Please try again." |
| Malformed command | HTTP 200 + ephemeral: "Invalid command. Usage: /approve_post \<post_id\>" |
| Missing reject reason | HTTP 200 + ephemeral: "Reject reason is required. Usage: /reject_post \<post_id\> \<reason\>" |
| Unauthorized role | HTTP 200 + ephemeral: "You are not authorized to approve or reject posts." |
| Duplicate retry | HTTP 200 + ephemeral: "This command has already been processed." |
| Valid, queued for processing | HTTP 200 + ephemeral: "Processing your request..." |
| Async success (optional delayed) | *OQ-008-2: If `response_url` used, send delayed response via Slack API.* |
| Internal error (queue fail) | HTTP 200 + ephemeral: "An error occurred. Please try again or contact admin." |

**Rules:**
- All responses are ephemeral (visible only to the user who ran the command).
- No internal error detail, stack trace, or system identifier in Slack response.
- No token, secret, or user's role string in Slack response.
- Response sent within Slack's 3-second timeout window from the HTTP handler.

---

## Test Plan

### Security Gate Tests (`slackSignatureVerifier.test.ts`)

| Test ID | Description |
|:---|:---|
| SIG-001 | Valid signature accepted — correct HMAC computed |
| SIG-002 | Invalid signature rejected — HMAC mismatch |
| SIG-003 | Stale timestamp rejected — > 300s old |
| SIG-004 | Future timestamp rejected — > 300s ahead |
| SIG-005 | Missing signature header rejected |
| SIG-006 | Missing timestamp header rejected |
| SIG-007 | Constant-time comparison used (no timing leak assertion via mock) |
| SIG-008 | Signing secret NOT present in any log output |

### Route Integration Tests (`slackCommandsRoute.test.ts`)

| Test ID | Description |
|:---|:---|
| CMD-001 | Valid approve command accepted — 200 + ephemeral ack |
| CMD-002 | Valid reject command with reason accepted |
| CMD-003 | Invalid signature → 200 + ephemeral error + audit logged |
| CMD-004 | Stale timestamp → 200 + ephemeral error + audit logged |
| CMD-005 | Missing post_id → MALFORMED_COMMAND + audit |
| CMD-006 | Reject without reason → MISSING_REASON + audit |
| CMD-007 | Reason too long → REASON_TOO_LONG + audit |
| CMD-008 | Unknown command → UNKNOWN_COMMAND + audit |
| CMD-009 | Unauthorized role (viewer) → UNAUTHORIZED_ROLE + audit |
| CMD-010 | Duplicate idempotency key → DUPLICATE_IGNORED + no double enqueue |
| CMD-011 | Valid command triggers queue publish |
| CMD-012 | Queue payload is references-only (no reason, no token, no raw body) |

### Worker Tests (`slackPostApprovalWorker.test.ts`)

| Test ID | Description |
|:---|:---|
| WKR-001 | Approve command — Airtable updatePostStatus called with 'Approved' |
| WKR-002 | Reject command — Airtable updatePostStatus called with 'Rejected' + reason |
| WKR-003 | Audit log written for every command (succeeded / failed) |
| WKR-004 | ACK called only after Ledger commit (not before) |
| WKR-005 | Duplicate idempotency key → ACK no-op, no double update |
| WKR-006 | Airtable update failure → `airtable_sync_retry_needed=true` + compensating audit |
| WKR-007 | Ledger failure before ACK → NACK requeue |
| WKR-008 | Unknown post_id → status=`failed` (unknown_post) + audit |
| WKR-009 | Post not in reviewable state → status=`failed` (post_not_reviewable) + audit |
| WKR-010 | No secret/token in Ledger or log output (redact assertion) |
| WKR-011 | Worker ACK after exhausted retries → DLQ |

### Contract Tests (`slackCommandContracts.test.ts`)

| Test ID | Description |
|:---|:---|
| CON-001 | SlackSlashCommandSchema accepts valid approve payload |
| CON-002 | SlackSlashCommandSchema accepts valid reject payload |
| CON-003 | SlackCommandActionEventSchema rejects payload with reason field |
| CON-004 | SlackCommandActionEventSchema rejects payload with token field |

---

## Task Breakdown

### T-001: Migration `0008_us008_slack_approve_reject.sql`

- **Owner:** Backend
- **Priority:** P0 (blocks all other tasks)
- **Dependencies:** Migrations 0001–0006 applied
- **Input:** Schema design from § Ledger Schema Requirements
- **Output:** `slack_command_events` table + `workspace_members` stub + RLS policies applied
- **Verification:** Migration runs without error on clean DB; `\d slack_command_events` shows all columns; `\d workspace_members` shows role constraint
- **Rollback:** `DROP TABLE IF EXISTS slack_command_events CASCADE; DROP TABLE IF EXISTS workspace_members CASCADE;`

---

### T-002: Shared Contracts — Slack

- **Owner:** Backend
- **Priority:** P0 (blocks route, worker, consumer)
- **Dependencies:** T-001
- **Input:** Event contract spec from § Event Contracts
- **Output:** `slashCommand.ts`, `slackCommandAction.ts`, `index.ts` exports, `slackCommandContracts.test.ts` passing
- **Verification:** `npm run build` in `packages/shared-contracts` succeeds; contract tests pass
- **Rollback:** Delete new files

---

### T-003: Env Config Update

- **Owner:** Backend
- **Priority:** P0
- **Dependencies:** None
- **Input:** `apps/orchestrator/src/config/env.ts`
- **Output:** Added vars: `SLACK_SIGNING_SECRET` (string, required when `SLACK_COMMANDS_ENABLED=true`), `SLACK_BOT_TOKEN` (optional), `SLACK_COMMANDS_ENABLED` (boolean string), `SLACK_COMMAND_MAX_REASON_LENGTH` (number, default 500)
- **Verification:** `loadEnv()` parses correctly; Zod throws on missing `SLACK_SIGNING_SECRET` when enabled

---

### T-004: SlackSignatureVerifier Service

- **Owner:** Backend/Security
- **Priority:** P0
- **Dependencies:** T-003
- **Input:** Env `SLACK_SIGNING_SECRET`; HTTP headers `X-Slack-Signature`, `X-Slack-Request-Timestamp`; raw body `Buffer`
- **Output:** `SlackSignatureVerifier.verify(rawBody, headers): { valid: boolean; errorCode?: string }`
- **Verification:** `slackSignatureVerifier.test.ts` SIG-001 through SIG-008 pass; no secret in logs
- **Rollback:** Delete file

---

### T-005: SlackCommandParser Service

- **Owner:** Backend
- **Priority:** P1 (blocks route)
- **Dependencies:** T-002
- **Input:** URL-decoded `command`, `text`, `user_id`, `team_id`
- **Output:** `ParsedSlackCommand | ParseError`
- **Verification:** Unit tests for all parse cases in § Command Parsing Rules

---

### T-006: SlackCommandRepository (Ledger)

- **Owner:** Backend
- **Priority:** P1 (blocks route + worker)
- **Dependencies:** T-001, T-003
- **Input:** Parsed command, idempotency key, workspace ID
- **Output:** CRUD for `slack_command_events`; role lookup from `workspace_members`; audit log writes
- **Verification:** Integration test against test DB; `SET LOCAL app.current_workspace_id` verified

---

### T-007: RabbitMQ Publisher Extension

- **Owner:** Backend
- **Priority:** P1 (blocks route)
- **Dependencies:** T-002
- **Input:** `SlackCommandActionEvent` typed message
- **Output:** `QueuePublisher.publishSlackCommandAction()` method on existing publisher
- **Verification:** Unit test confirms message published to correct exchange/routing key; payload is references-only

---

### T-008: Slack Commands Route

- **Owner:** Backend
- **Priority:** P1
- **Dependencies:** T-002, T-003, T-004, T-005, T-006, T-007
- **Input:** `POST /api/v1/slack/commands` with raw body
- **Output:** Route factory `createSlackCommandsRouter(verifier, parser, repository, publisher, logger)`; all CMD-xxx tests passing
- **Implementation notes:**
  - Mount with `express.raw({ type: 'application/x-www-form-urlencoded' })` BEFORE `express.json()` middleware for this route.
  - Respond to Slack within 3 seconds; all slow operations happen after HTTP response via queue.
- **Verification:** `slackCommandsRoute.test.ts` CMD-001 through CMD-012 pass

---

### T-009: SlackPostApprovalWorker

- **Owner:** Backend
- **Priority:** P1
- **Dependencies:** T-002, T-006, T-001
- **Input:** `SlackCommandActionEvent` from queue; Airtable client; DB client
- **Output:** Worker class with `processQueueMessage()` → `{ action: 'ack' | 'nack_requeue' | 'nack_dlq'; status: string }`
- **Verification:** WKR-001 through WKR-011 pass

---

### T-010: SlackCommandRabbitmqConsumer

- **Owner:** Backend
- **Priority:** P1
- **Dependencies:** T-002, T-009
- **Input:** RabbitMQ connection; worker instance; logger
- **Output:** Consumer following `policyRabbitmqConsumer.ts` pattern; DLQ pattern implemented
- **Verification:** Consumer starts/stops cleanly; message routing to worker tested

---

### T-011: Server Integration

- **Owner:** Backend
- **Priority:** P2
- **Dependencies:** T-008, T-010
- **Input:** `apps/orchestrator/src/server.ts`
- **Output:**
  - Slack route mounted: `app.use('/api/v1', createSlackCommandsRouter(...))`
  - Consumer started/stopped in lifecycle
  - Guard by `SLACK_COMMANDS_ENABLED` env var
- **Verification:** Server starts without error; `GET /health` still returns 200; Slack route reachable

---

### T-012: Function Logic Register Update

- **Owner:** Backend/Tech Lead
- **Priority:** P2
- **Dependencies:** T-011 (all implementation complete)
- **Input:** `docs/requirements/05_Function_Flow_Logic_Register.md`
- **Output:** Replace the duplicate `FL-004b` (Slack Command Handler stub) with a proper `FL-005: US-008 Slack Approve/Reject Post Commands` entry with full Processing Logic, Error Handling, Audit/Telemetry, Security Rules, and Test Evidence.
- **Verification:** No duplicate FL entries; test evidence references actual test files

---

## Dependency Graph

```
T-001 (Migration)
    └── T-002 (Contracts)
            ├── T-005 (Parser)
            ├── T-006 (Repository) ── T-001
            ├── T-007 (Publisher)
            └── T-008 (Route) ── T-003, T-004, T-005, T-006, T-007
                    └── T-009 (Worker) ── T-006, T-001
                            └── T-010 (Consumer) ── T-009
                                    └── T-011 (Server) ── T-008, T-010
                                            └── T-012 (FL Register)

T-003 (Env Config) → T-004 (Verifier)
T-003 (Env Config) → T-006 (Repository)
T-003 (Env Config) → T-008 (Route)
```

**Parallel opportunities after T-001 + T-002 + T-003 complete:**
- T-004 (Verifier) and T-005 (Parser) can proceed in parallel.
- T-006 (Repository) and T-007 (Publisher) can proceed in parallel.

---

## RACI

| Task | Responsible | Accountable | Consulted | Informed |
|:---|:---|:---|:---|:---|
| Migration (T-001) | Backend Dev | Tech Lead | DBA | Product Owner |
| Contracts (T-002) | Backend Dev | Tech Lead | — | — |
| Env Config (T-003) | Backend Dev | Tech Lead | DevOps | Admin |
| Signature Verifier (T-004) | Backend Dev | Tech Lead | Security | — |
| Command Parser (T-005) | Backend Dev | Tech Lead | — | — |
| Repository (T-006) | Backend Dev | Tech Lead | — | — |
| Publisher Extension (T-007) | Backend Dev | Tech Lead | — | — |
| Route (T-008) | Backend Dev | Tech Lead | Security | Product Owner |
| Worker (T-009) | Backend Dev | Tech Lead | — | Product Owner |
| Consumer (T-010) | Backend Dev | Tech Lead | — | — |
| Server Integration (T-011) | Backend Dev | Tech Lead | DevOps | — |
| FL Register (T-012) | Tech Lead / Dev | Product Owner | BA | — |

---

## Environment Variables

```dotenv
# Required for US-008
SLACK_SIGNING_SECRET=                   # From Slack App Basic Information — NEVER log
SLACK_COMMANDS_ENABLED=true             # Feature flag to enable/disable slash command route
SLACK_COMMAND_MAX_REASON_LENGTH=500     # Max characters for reject reason

# Existing (already in env.ts) — referenced but not new
SLACK_BOT_TOKEN=                        # For Slack API calls (optional for US-008 MVP response)
RABBITMQ_URL=                           # Already present
DATABASE_URL=                           # Already present
AIRTABLE_API_KEY=                       # Already present
AIRTABLE_BASE_ID=                       # Already present
WORKSPACE_ID=                           # Already present
```

---

## Open Questions (Resolved)

| ID | Question | Resolution |
|:---|:---|:---|
| OQ-008-1 | **Role mapping source:** `workspace_members` is planned as a new stub table. Is there an existing `members` or `users` table that already maps `slack_user_id → role`? Or should US-008 define the canonical `workspace_members` table? | **Resolved**: Implement a minimal Ledger-backed role mapping table (`workspace_members` or `slack_user_mappings`) scoped by `workspace_id`. Only manager/admin can approve/reject. |
| OQ-008-2 | **Slack response mode:** Should US-008 send a delayed response via `response_url` (Slack delayed message API) once the async worker completes, or is the immediate ephemeral "Processing..." ack sufficient for MVP? | **Resolved**: Immediate ephemeral Slack responses for MVP. The HTTP handler must respond quickly. No delayed `response_url` implementation in MVP. |
| OQ-008-3 | **Airtable field/status exact mapping for approve/reject:** Which Airtable field and values map to `Approved` / `Rejected`? Is `Rejected` a new status or does it map to `Draft` / `Needs Review`? | **Resolved**: Approve sets status to `Approved`. Reject sets status to `Review` (no new status) and writes reason to `rejection_reason` (fallback: `review_notes`). Reject reason is required and sanitized. |
| OQ-008-4 | **Ledger workflow update:** Should the worker also update `workflow_runs` status when a post is approved/rejected from Slack, or is Airtable + `slack_command_events` audit sufficient? | **Resolved**: Worker updates related `workflow_runs` when one exists (e.g. marking rejected/cancelled). Absence of workflow run must not fail the command. |
| OQ-008-5 | **SLACK_COMMANDS_ENABLED as a feature flag:** Should the feature flag be an env var (already proposed) or a per-workspace DB config (like `auto_approve_enabled`)? | **Resolved**: Use environment variable `SLACK_COMMANDS_ENABLED` for MVP. If disabled, return safe disabled response. |

---

## Approval Gate Before Coding

✅ **All decisions resolved.** Implementation can proceed in T-001 → T-002 → T-003 order (parallel where noted).
