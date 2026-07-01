# AI-SDLC Retrofit Header for US-007

status: approved

## Goal

Maintain US-007 behavior for Facebook Comment Sync to Ledger and Slack according to the approved backlog, function flow, and implementation evidence.

## Tasks

- AC-001: Preserve the documented trigger, processing, and output workflow.
- AC-002: Preserve tenant isolation, idempotency, and durable Ledger/audit evidence where applicable.
- AC-003: Preserve zero-token and reference-only security boundaries.
- AC-004: Keep the story compatible with build, lint, tests, and AI-SDLC artifact validation.

## Done When

- AC-001: Story workflow matches the accepted implementation report and function flow register.
- AC-002: Ledger, idempotency, queue, and role/security constraints are documented or tested where applicable.
- AC-003: No raw tokens or oversized/raw provider payloads cross forbidden boundaries.
- AC-004: `npm run ai-sdlc:check -- US-007` passes after retrofit artifacts are present.

# PLAN: US-007 Facebook Comment Sync to Ledger and Slack

**Date:** 2026-06-02  
**Author:** backend-specialist agent  
**Status:** Draft — Pending Approval Gate  
**Related:** US-007 in Product Backlog, Epic E03 MCP Execution Plane + Epic E04 Communication Plane

---

## Overview

US-007 adds the **Facebook comment ingestion pipeline** to the MediaOps Composability platform. It sits at the intersection of the MCP Execution Plane (Facebook MCP Server) and the Communication Plane (Slack alerts), with Postgres/Ledger as the durable source of truth.

**What it does:**  
Periodically (or on-demand) syncs Facebook Page comments for published posts into the Operational Ledger, classifies each comment's risk level, and dispatches Slack alerts to the appropriate channel (crisis or inbox). Duplicate syncs are idempotent; resolved comments do not re-alert.

**Where it sits in the architecture:**  
- **Trigger:** Scheduler (polling, aligned with the cron pattern used by `McpPublishScheduler` in US-006) OR a future webhook (US-011 scope). MVP = polling.  
- **MCP layer:** `sync_comments` tool added to `apps/facebook-mcp-server`. It owns all Graph API calls and token resolution.  
- **Queue layer:** Two queues — `comments.facebook.sync.requested` (trigger → MCP) and `comments.facebook.ingest` (MCP result → worker).  
- **Ledger layer:** Upsert into `interactions` / `comments` tables with idempotency on `(workspace_id, platform, external_comment_id)`.  
- **Communication layer:** Worker emits to `alerts.slack.send` queue; existing Slack alert publisher carries the message.

---

## Docs Read

| Priority | Document | Key Constraints Extracted |
|:---|:---|:---|
| P0 | `docs/architecture/06_Architecture_Composability.md` | Facebook Graph API only in MCP server. Orchestrator consumes queue, never calls Graph API. RabbitMQ carries references only. Ledger = source of truth. `comments.facebook.ingest` queue named explicitly. `alerts.slack.send` queue defined. DLQ required. |
| P0 | `docs/architecture/11_Coding_Convention.md` | TypeScript. MCP server owns platform API code. Shared contracts in `packages/shared-contracts`. Policy rules in `packages/policy-engine`. No raw token in logs/Airtable/Slack/audit. Every external event needs idempotency key. Workers ACK only after Ledger commit. DLQ → admin-visible alert. |
| P1 | `docs/requirements/04_Product_Backlog.md` | US-007 ACs: no duplicate on re-sync (AC1), risk comment → crisis channel (AC2), normal → inbox channel (AC3), permalink stored (AC4). BRs: no sensitive data in Slack (BR1), crisis keyword escalation (BR2), resolved no re-alert (BR3). |
| P1 | `docs/requirements/05_Function_Flow_Logic_Register.md` | **Documentation defect identified:** the register currently has a mislabelled section linking FL-004b to US-007 (Slack Command Handler), which is incorrect. Implementation must: (1) correct that mislabelling, and (2) add a proper FL-005 entry for Facebook Comment Sync. Reusable flow patterns observed from existing entries: cron scheduler → outbox → RabbitMQ → consumer → worker → Ledger commit → ACK (US-006 pattern); idempotency guard on worker (US-002 pattern); Slack graceful degradation if channel config missing (US-004 pattern). |
| P2 | `docs/project-mgmt/07_Risk_Assumption_Decision_Log.md` | D-006: RabbitMQ Docker Compose dev / CloudAMQP prod. D-014: Slack alert graceful degradation if env var missing. R-001: Meta App permissions — US-007 needs `pages_read_engagement` scope. R-005: Token leak is Critical risk. |
| P2 | `docs/requirements/03_SRS_MediaOps_Composability.md` | FR-06: Slack Alert. FR-08: Escalation to crisis channel. Comment sync in SRS §5.5. SRS §3.4 explicitly requires "Comment Sync: upsert không trùng, map comment đúng post/channel/campaign." |

---

## Skills and Specialist Knowledge Applied

| Skill | Key Patterns Applied |
|:---|:---|
| `queue-workers` (Spawner) | Idempotency key per event; classify transient vs permanent errors before retry/DLQ; ACK only after Ledger commit (matches existing worker pattern); graceful shutdown; correlation ID propagation |
| `queue-workers sharp-edges` | No idempotency → duplicate upsert risk. No DLQ → silent loss. No ACK-after-commit → double-processing on crash. Token must not appear in queue payload. |
| `event-architect` | References-only events on queue. Outbox pattern for reliable event dispatch after DB commit. Correlation/causation IDs threaded through. |
| `slack-bot-builder` | Slack is communication plane only, not database. Alert payload: concise summary + permalink. Graceful degrade if channel config missing (aligned with D-014). No sensitive content in alert. |
| `postgres-wizard` | RLS `USING` + `WITH CHECK` per table. `SET LOCAL app.current_workspace_id`. Unique constraint for idempotency. Append-only audit_logs. Index on `(workspace_id, status)` and `(workspace_id, external_comment_id, platform)`. |
| `agent-tool-builder` | MCP tool contract: stable, references-only input/output. Token read from SecretStore inside MCP only. Sanitized result — no raw Graph API response. |

---

## Current Implementation Context

### Orchestrator (`apps/orchestrator/src/`)

- **`server.ts`**: Bootstraps all consumers and schedulers. Pattern for US-007: add `facebookCommentSyncConsumer.start()` alongside existing consumers. A new `CommentSyncScheduler` (mirroring `McpPublishScheduler`) polls Ledger for published jobs needing sync.
- **`queue/`**: 6 consumer files, all following same `createXxxRabbitMqConsumer` factory pattern with `handleXxxQueueMessage` for testability. DLQ write then ACK. prefetch(1). confirm channel.
- **`workers/`**: 5 worker classes + 1 scheduler. All take `(database, mcpClient/airtable, logger, workspaceId, queuePublisher)`. Return `{action, status}`. Repository injected at construction (private field).
- **`ledger/`**: 7 repository files. Pattern: `workerRepository.ts` has base helpers (`loadAndLockContext`, `persist*`). All transactions use `database.transaction(workspaceId, async (client) => ...)`.
- **`queue/rabbitmqPublisher.ts`**: Exposes `publishSlackAlert`, `publishFacebookRequest`, etc. **Must add `publishCommentSyncRequest` and `publishCommentIngest` methods** plus declare their exchanges/queues/routing keys.

### Facebook MCP Server (`apps/facebook-mcp-server/src/`)

- **`index.ts`**: Registers 3 tools (`validatePost`, `getRateLimitStatus`, `publishPost`). **Must add `syncComments` tool** registration here.
- **`tools/`**: 3 tool files. Pattern: `async function syncCommentsHandler(input, secretStore, graphClient?)`. Token resolved via `secretStore.resolveSecret(secretRef)`. Errors mapped to typed codes. Result sanitized (no raw Graph response).
- **`lib/secretStore.ts`**: `EnvSecretStore` reads env var by name. Used for token resolution.

### Shared Contracts (`packages/shared-contracts/src/`)

- **`index.ts`**: Exports all schemas. **Must add exports for comment sync contracts**.
- **`mcp/`**: 5 contract files for existing MCP tools. Pattern: Zod schema + TypeScript type + strict() validation.
- **No comment contracts yet** — must create `mcp/syncComments.ts` and `events/facebookCommentSync.ts`.

### DB Migrations (`db/migrations/`)

- 6 migrations, latest: `0006_us006_facebook_publish_execution.sql`.
- RLS pattern: `AS RESTRICTIVE FOR ALL USING(...) WITH CHECK(...)`.
- **Must create** `0007_us007_facebook_comment_sync.sql`.

### Slack Alert

- `queuePublisher.publishSlackAlert(payload, messageId, correlationId)` already exists and publishes to `alerts.slack.send` queue.
- Pattern from `McpPublishWorker`: channel_id from env var, graceful degrade if missing.

---

## Scope

### In Scope

1. **Shared contracts** for comment sync request event, ingest event, MCP input/output, and Slack alert event.
2. **Facebook MCP tool `syncComments`** — calls Graph API `/{post_id}/comments`, returns sanitized comment list (no raw response).
3. **Ledger schema** — new tables: `interactions`, `comments`, `comment_sync_events`, `slack_comment_alerts`. New status types.
4. **DB migration** `0007_us007_facebook_comment_sync.sql` with RLS on all new tables.
5. **Scheduler `CommentSyncScheduler`** — cron poller scanning `publish_jobs WHERE status='published'` for posts needing comment sync.
6. **RabbitMQ consumer `facebookCommentSyncRabbitmqConsumer`** — consumes `comments.facebook.ingest`.
7. **Worker `FacebookCommentSyncWorker`** — idempotent upsert comment → classify risk → emit Slack alert event → ACK after commit.
8. **Repository `commentSyncWorkerRepository`** — all DB operations for the worker.
9. **Risk classifier** — configurable keyword list from env var (`COMMENT_RISK_KEYWORDS`), case-insensitive normalized match, returns only risk code (not raw matched term in logs).
10. **Permalink persistence** — stored on `comments.permalink`.
11. **Slack alert routing** — crisis channel for risk comments, inbox channel for normal. No re-alert if comment already `resolved`.
12. **QueuePublisher extension** — add `publishCommentSyncRequest` and `publishCommentIngest` methods.
13. **Server.ts wiring** — add new consumer and scheduler to orchestrator startup/shutdown.
14. **Tests** — unit + integration for all components.
15. **FL-005 entry** in `docs/requirements/05_Function_Flow_Logic_Register.md`.

### Out of Scope

- Slack slash command `/reply_comment` / `/escalate` (US-009).
- Full sentiment AI model (US-007 uses keyword/rule stub only).
- Facebook webhook subscription setup / OAuth page config (US-011).
- Microsoft Teams phase 2.
- Full Direct Message Inbox (US-015).
- Multi-platform comment sync (LinkedIn, X, YouTube — future MCP servers).
- Admin UI for comment management.
- Real-time WebSocket push to frontend.
- **Slack alert consumer/sender** — the `alerts.slack.send` consumer that actually calls the Slack Web API does not yet exist in the codebase. US-007 only enqueues the alert event into `alerts.slack.send`. The actual Slack HTTP delivery is a **dependency/blocker** that must be implemented (in this US or a dedicated Slack sender US) before alerts are received by the team. See also the note in Architecture Flow §5.

---

## Success Criteria / AC Mapping

| AC / BR | Implementation Evidence | Test |
|:---|:---|:---|
| AC1: Re-sync no duplicate | `UNIQUE (workspace_id, platform, external_comment_id)` constraint + worker idempotency check | `TC-01`: sync same comment twice → 1 DB row, 1 Slack alert |
| AC2: Risk → crisis channel | Risk classifier returns `risk`; worker routes to `SLACK_CRISIS_CHANNEL_ID` | `TC-02`: comment with crisis keyword → alert on crisis channel |
| AC3: Normal → inbox channel | Classifier returns `normal`; worker routes to `SLACK_INBOX_CHANNEL_ID` | `TC-03`: benign comment → alert on inbox channel |
| AC4: Permalink stored | `comments.permalink` persisted from MCP result | `TC-04`: after sync, `comments.permalink IS NOT NULL` |
| BR1: No sensitive data in Slack | Alert payload: `interaction_id`, `comment_preview_80chars`, `permalink`, `risk_code` only | `TC-05`: Slack payload does not contain `access_token`, `secret_ref`, raw body |
| BR2: Crisis escalation | `CommentRiskClassifier.classify()` returns `CRISIS` if keyword match | `TC-06`: keyword match → `CRISIS` risk code |
| BR3: Resolved no re-alert | Worker checks `comments.resolved_at IS NOT NULL` before emitting alert | `TC-07`: resolved comment sync → no Slack alert dispatched |

---

## Architecture Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ BOUNDARY: apps/facebook-mcp-server                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ Graph API calls ONLY here. Token resolved from SecretStore here.        ││
│  │ Orchestrator NEVER touches Graph API directly.                          ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘

1. [CommentSyncScheduler] (in orchestrator)
   - Polls publish_jobs WHERE status='published' AND needs_comment_sync=true
   - Creates outbox entry in comment_sync_events
   - Publishes references-only SyncRequest to comments.facebook.sync.requested queue
     Payload: { event_id, workspace_id, job_id, channel_account_id, external_post_id,
                idempotency_key, correlation_id, created_at }
     FORBIDDEN in payload: access_token, secret_ref, body text, raw data

2. [SyncRequestConsumer] (new, in orchestrator)
   - Validates SyncRequest schema (Zod)
   - Reloads `channel_account` + `token_reference` from Ledger by `channel_account_id`
     (aligned with US-005/US-006 pattern: orchestrator reads `secret_ref` from Ledger for MCP call input)
   - Calls FacebookMcpClient.syncComments({ postRef, channelAccountId, secretRef })
     NOTE on boundary: `secretRef` is the opaque reference key stored in Ledger — not the raw token.
     It is passed to the MCP tool so the MCP server can resolve the actual token from SecretStore.
     `secretRef` MUST NOT appear in any RabbitMQ payload, log line, audit metadata, or Slack message.
   - MCP Server: resolves actual token from SecretStore using `secretRef` → calls Graph API → sanitizes result
   - MCP result: { comments: [{ externalId, authorName, body, permalink, createdAtPlatform }] }
     (no access_token, no raw Graph response in result)
   - Publishes one CommentIngestEvent per comment to comments.facebook.ingest
     Payload: { event_id, workspace_id, job_id, external_comment_id, author_ref,
                comment_preview, permalink, created_at_platform, correlation_id }
     NOTE: Full body optionally stored in Ledger by the worker, NOT in the queue message.
   - ACKs sync.requested only after all ingest events published OR DLQ on fatal MCP error.

3. [CommentIngestConsumer] (new, in orchestrator)
   - Validates CommentIngestEvent schema (Zod)
   - Calls FacebookCommentSyncWorker.processQueueMessage(event, messageId)

4. [FacebookCommentSyncWorker]
   - Workspace guard
   - BEGIN TRANSACTION + SET LOCAL app.current_workspace_id
   - Idempotency check: SELECT FROM comments WHERE workspace_id=? AND platform='facebook'
     AND external_comment_id=?
     → If exists: ACK (already processed), no Slack re-alert if resolved
   - UPSERT interaction + comment rows, store permalink, body (full or preview per decision)
   - Classify risk: CommentRiskClassifier.classify(body, config)
     → Returns: { riskCode: 'CRISIS' | 'NORMAL', matched: false }
     (never log raw matched term)
   - If risk=CRISIS and comment not resolved: emit alerts.slack.send with crisis channel
   - If risk=NORMAL and comment not resolved: emit alerts.slack.send with inbox channel
   - INSERT audit_log (COMMENT_INGESTED, COMMENT_RISK_CLASSIFIED, SLACK_ALERT_EMITTED)
   - COMMIT
   - ACK RabbitMQ ONLY after COMMIT

5. [Slack Alert] — ⚠️ **DEPENDENCY / BLOCKER**
   - US-007 enqueues a references-only alert payload into `alerts.slack.send` queue via `queuePublisher.publishSlackAlert()`.
   - **There is currently no consumer in the codebase that reads `alerts.slack.send` and calls the Slack Web API.**
   - US-007 is complete when the alert is durably enqueued in `alerts.slack.send` with the correct payload.
   - A dedicated Slack sender (consumer + Slack SDK call) must be implemented — either as part of US-007 scope (preferred for end-to-end validation) or as a follow-up task before the feature is usable in production.
   - Payload shape: `{ interaction_id, comment_preview_80chars, permalink, risk_code, channel_id }`
   - No sensitive data in payload.

6. [DLQ / Error] → admin Slack alert via alerts.slack.send

BOUNDARY ENFORCEMENT:
   ✓ Graph API: apps/facebook-mcp-server ONLY
   ✓ Raw token: SecretStore in MCP server, never in orchestrator memory
   ✓ secretRef: orchestrator reads from Ledger → passes to MCP tool input ONLY (never into queue/log/audit)
   ✓ Queue payload: references + safe metadata only (no secretRef, no access_token)
   ✓ Ledger: source of truth; Slack = communication plane only
   ✓ Slack consumer: alerts.slack.send is a queue — actual Slack HTTP call is a separate sender (dependency)
```

---

## Proposed Files

### New Files

| File | Action | Description |
|:---|:---|:---|
| `packages/shared-contracts/src/mcp/syncComments.ts` | CREATE | Zod schemas for `SyncCommentsInput` / `SyncCommentsResult` / `CommentSyncError` |
| `packages/shared-contracts/src/events/facebookCommentSync.ts` | CREATE | Zod schemas for `CommentSyncRequestedEvent` and `CommentIngestEvent` |
| `packages/shared-contracts/src/__tests__/facebookCommentContracts.test.ts` | CREATE | Contract rejection tests (raw token, large payload, forbidden fields) |
| `apps/facebook-mcp-server/src/tools/syncComments.ts` | CREATE | `syncCommentsHandler(input, secretStore, graphClient?)` |
| `apps/facebook-mcp-server/src/__tests__/syncComments.test.ts` | CREATE | MCP tool unit tests (happy, auth fail, rate limit, 5xx, malformed) |
| `apps/orchestrator/src/workers/facebookCommentSyncWorker.ts` | CREATE | Main worker class |
| `apps/orchestrator/src/workers/commentSyncScheduler.ts` | CREATE | Cron poller for published jobs needing sync |
| `apps/orchestrator/src/queue/facebookCommentSyncRequestConsumer.ts` | CREATE | Consumer for `comments.facebook.sync.requested` |
| `apps/orchestrator/src/queue/facebookCommentSyncIngestConsumer.ts` | CREATE | Consumer for `comments.facebook.ingest` |
| `apps/orchestrator/src/ledger/commentSyncWorkerRepository.ts` | CREATE | All DB operations (upsert comment, load context, persist audit) |
| `apps/orchestrator/src/services/commentRiskClassifier.ts` | CREATE | Pure function: `classify(body, keywords)` → `{riskCode, matched}` |
| `apps/orchestrator/src/__tests__/facebookCommentSyncWorker.test.ts` | CREATE | Worker integration tests (all TC-01 through TC-13) |
| `apps/orchestrator/src/__tests__/commentRiskClassifier.test.ts` | CREATE | Risk classifier unit tests |
| `db/migrations/0007_us007_facebook_comment_sync.sql` | CREATE | Schema for interactions, comments, comment_sync_events, slack_comment_alerts |
| `docs/reports/US-007/REPORT-us-007-plan-setup-2026-06-02.md` | CREATE | Post-work report (see below) |

### Modified Files

| File | Change |
|:---|:---|
| `packages/shared-contracts/src/index.ts` | Add exports for new event and MCP contracts |
| `apps/facebook-mcp-server/src/index.ts` | Register `syncComments` tool definition + handler |
| `apps/orchestrator/src/queue/rabbitmqPublisher.ts` | Add `publishCommentSyncRequest` and `publishCommentIngest` methods + declare exchanges/queues |
| `apps/orchestrator/src/server.ts` | Wire `CommentSyncScheduler`, `facebookCommentSyncRequestConsumer`, `facebookCommentSyncIngestConsumer` |
| `apps/orchestrator/src/mcp/facebookMcpClient.ts` | Add `syncComments(input)` method |
| `docs/requirements/05_Function_Flow_Logic_Register.md` | Fix documentation defect + add FL-005 — the current file has a mislabelled section around line 621 that links `FL-004b` to US-007 (Slack Command Handler), which is incorrect. The fix must: (1) correct the mislabelling, and (2) add a proper FL-005 stub for Facebook Comment Sync. |

---

## Ledger Schema Requirements

```sql
-- Migration: 0007_us007_facebook_comment_sync.sql

-- -----------------------------------------------------------------------
-- interactions: parent entity for any inbound user engagement
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS interactions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        TEXT NOT NULL,
  platform            TEXT NOT NULL,                  -- 'facebook'
  external_id         TEXT NOT NULL,                  -- platform's comment ID
  -- publish_job_id: FK to publish_jobs (the Ledger job that produced the post being commented on)
  publish_job_id      UUID REFERENCES publish_jobs(id) ON DELETE RESTRICT,
  -- airtable_record_id: denormalized for fast campaign/post reporting without joining publish_jobs
  airtable_record_id  TEXT,
  -- external_post_id: the Facebook post ID on the platform (e.g. '12345678_99999999')
  -- stored for direct Graph API permalink construction and future sync reconciliation
  external_post_id    TEXT NOT NULL,
  author_ref          JSONB NOT NULL DEFAULT '{}',    -- { name, external_user_id } only, no PII beyond display name
  interaction_type    TEXT NOT NULL DEFAULT 'comment',
  status              TEXT NOT NULL DEFAULT 'new',    -- 'new', 'acknowledged', 'resolved', 'escalated'
  risk_code           TEXT NOT NULL DEFAULT 'NORMAL', -- 'NORMAL', 'CRISIS'
  resolved_at         TIMESTAMPTZ,
  created_at_platform TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT interactions_platform_chk CHECK (platform IN ('facebook', 'instagram', 'zalo')),
  CONSTRAINT interactions_status_chk CHECK (status IN ('new', 'acknowledged', 'resolved', 'escalated')),
  CONSTRAINT interactions_risk_code_chk CHECK (risk_code IN ('NORMAL', 'CRISIS')),
  CONSTRAINT uq_interactions_workspace_platform_external
    UNIQUE (workspace_id, platform, external_id)
);

CREATE INDEX IF NOT EXISTS idx_interactions_workspace_status
  ON interactions (workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_interactions_workspace_risk
  ON interactions (workspace_id, risk_code) WHERE risk_code = 'CRISIS';
CREATE INDEX IF NOT EXISTS idx_interactions_publish_job
  ON interactions (publish_job_id);
CREATE INDEX IF NOT EXISTS idx_interactions_external_post
  ON interactions (workspace_id, platform, external_post_id);

-- -----------------------------------------------------------------------
-- comments: comment-specific data linked to interaction
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interaction_id  UUID NOT NULL REFERENCES interactions(id) ON DELETE CASCADE,
  workspace_id    TEXT NOT NULL,
  body            TEXT,                             -- full body (see OQ-007-2)
  body_preview    TEXT,                             -- first 80 chars, always populated
  permalink       TEXT,                             -- REQUIRED per AC4
  reply_count     INTEGER NOT NULL DEFAULT 0,
  like_count      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_comments_interaction
  ON comments (interaction_id);

-- -----------------------------------------------------------------------
-- comment_sync_events: outbox/tracking for sync dispatch
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comment_sync_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          UUID NOT NULL,
  event_type        TEXT NOT NULL,
  workspace_id      TEXT NOT NULL,
  job_id            UUID NOT NULL REFERENCES publish_jobs(id) ON DELETE RESTRICT,
  idempotency_key   TEXT UNIQUE NOT NULL,
  status            TEXT NOT NULL DEFAULT 'dispatched', -- 'dispatched', 'completed', 'failed'
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------
-- slack_comment_alerts: tracks which comments had Slack alerts sent
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS slack_comment_alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interaction_id  UUID NOT NULL REFERENCES interactions(id) ON DELETE RESTRICT,
  workspace_id    TEXT NOT NULL,
  channel_id      TEXT NOT NULL,
  channel_type    TEXT NOT NULL,   -- 'crisis', 'inbox'
  alert_type      TEXT NOT NULL,   -- 'comment_risk', 'comment_normal'
  message_ts      TEXT,            -- Slack message timestamp (for threading later)
  status          TEXT NOT NULL DEFAULT 'sent',   -- 'sent', 'pending_config', 'failed'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_slack_comment_alerts_interaction
    UNIQUE (interaction_id)         -- one alert per interaction (idempotency)
);

-- publish_jobs: add comment sync tracking column
ALTER TABLE publish_jobs
  ADD COLUMN IF NOT EXISTS last_comment_sync_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS comment_sync_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- -----------------------------------------------------------------------
-- RLS — all tables workspace-scoped, AS RESTRICTIVE
-- -----------------------------------------------------------------------
ALTER TABLE interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE comment_sync_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE slack_comment_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS interactions_workspace_rls ON interactions;
CREATE POLICY interactions_workspace_rls ON interactions
  AS RESTRICTIVE FOR ALL
  USING (workspace_id = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));

DROP POLICY IF EXISTS comments_workspace_rls ON comments;
CREATE POLICY comments_workspace_rls ON comments
  AS RESTRICTIVE FOR ALL
  USING (workspace_id = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));

DROP POLICY IF EXISTS comment_sync_events_workspace_rls ON comment_sync_events;
CREATE POLICY comment_sync_events_workspace_rls ON comment_sync_events
  AS RESTRICTIVE FOR ALL
  USING (workspace_id = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));

DROP POLICY IF EXISTS slack_comment_alerts_workspace_rls ON slack_comment_alerts;
CREATE POLICY slack_comment_alerts_workspace_rls ON slack_comment_alerts
  AS RESTRICTIVE FOR ALL
  USING (workspace_id = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));
```

---

## Event Contracts

### `CommentSyncRequestedEvent` — queue: `comments.facebook.sync.requested`

```typescript
// Trigger: CommentSyncScheduler → MCP SyncRequest consumer
z.object({
  event_id:             z.string().uuid(),
  event_type:           z.literal('comments.facebook.sync.requested'),
  event_version:        z.literal(1),                // number, not string — aligns with repo convention
  workspace_id:         z.string().min(1),
  job_id:               z.string().uuid(),            // Ledger publish_jobs.id
  channel_account_id:   z.string().min(1),            // reference only
  external_post_id:     z.string().min(1),            // Facebook Page post ID
  idempotency_key:      z.string().min(1),
  correlation_id:       z.string().uuid(),
  created_at:           z.string().datetime(),
}).strict()

// FORBIDDEN FIELDS (Zod strict() + contract test must reject):
// access_token, secret_ref, body, raw_payload, large_content
```

### `CommentIngestEvent` — queue: `comments.facebook.ingest`

```typescript
// Published per-comment by SyncRequestConsumer after MCP returns
z.object({
  event_id:               z.string().uuid(),
  event_type:             z.literal('comments.facebook.ingest'),
  event_version:          z.literal(1),              // number, not string — aligns with repo convention
  workspace_id:           z.string().min(1),
  job_id:                 z.string().uuid(),
  external_comment_id:    z.string().min(1),
  author_ref:             z.object({
                            name:             z.string().max(255),
                            external_user_id: z.string().optional()
                          }),
  comment_preview:        z.string().max(80),         // safe preview for queue
  permalink:              z.string().url(),
  created_at_platform:    z.string().datetime(),
  correlation_id:         z.string().uuid(),
  causation_id:           z.string().uuid(),          // = sync_requested event_id
  created_at:             z.string().datetime(),
}).strict()

// FORBIDDEN FIELDS:
// access_token, full body > 80 chars in queue (full body stored in Ledger by worker only),
// raw_graph_response, secret_ref
```

### `SlackAlertEvent` — queue: `alerts.slack.send` (existing, shape extended)

```typescript
// Shape compatible with existing publishSlackAlert payload
{
  event_id:       string uuid,
  workspace_id:   string,
  correlation_id: string uuid,
  channel_id:     string | null,      // SLACK_CRISIS_CHANNEL_ID or SLACK_INBOX_CHANNEL_ID
  alert_type:     'comment_risk' | 'comment_normal' | 'alert_pending_config',
  severity:       'warning' | 'info',
  entity_type:    'comment',
  entity_id:      string uuid,        // interaction_id
  metadata: {
    comment_preview: string,          // max 80 chars, never full body
    permalink:       string,
    risk_code:       'CRISIS' | 'NORMAL',
    // FORBIDDEN: access_token, body, author PII beyond display name
  },
  created_at:     string datetime
}
```

---

## Risk Classification

### MVP Rule Engine (`apps/orchestrator/src/services/commentRiskClassifier.ts`)

```typescript
// Pure function — no I/O, no side effects, no logging of raw matched terms
export type RiskCode = 'CRISIS' | 'NORMAL';

export interface RiskClassificationResult {
  riskCode: RiskCode;
  matched: boolean; // true if any keyword matched, do NOT log which keyword
}

export function classifyCommentRisk(
  body: string,
  crisisKeywords: string[]  // from COMMENT_RISK_KEYWORDS env, split by comma
): RiskClassificationResult {
  // Normalize: NFC, lowercase, trim
  const normalized = body.normalize('NFC').toLowerCase().trim();
  const matched = crisisKeywords.some(kw =>
    normalized.includes(kw.normalize('NFC').toLowerCase().trim())
  );
  return { riskCode: matched ? 'CRISIS' : 'NORMAL', matched };
}
```

**Rules:**
- Keywords sourced from env var `COMMENT_RISK_KEYWORDS` (comma-separated) — configurable without code change.
- Case-insensitive + Unicode NFC normalization before match.
- Return only `riskCode` and boolean `matched`. **Never log the raw matched keyword or the raw comment body that triggered a match** in audit/logs.
- Resolved comments (`interactions.resolved_at IS NOT NULL`) skip Slack alert regardless of risk code (BR3).
- Expand to workspace-level DB config table in a future US if needed (OQ-007-3).

---

## Error Handling Matrix

| Case | Detection | Worker Action | Ledger Status | RabbitMQ |
|:---|:---|:---|:---|:---|
| New comment (happy path) | `external_comment_id` not in Ledger | Upsert, classify, alert, commit | `interactions.status = 'new'` | ACK after commit |
| Duplicate comment | Unique constraint or idempotency check | ACK, no-op, audit `COMMENT_DUPLICATE_IGNORED` | Unchanged | ACK |
| Already resolved comment | `interactions.resolved_at IS NOT NULL` | Upsert metadata update only, no Slack alert | Unchanged | ACK |
| Token invalid / expired | MCP returns `PLATFORM_AUTH_FAILED` | Fail closed, DLQ sync.requested, admin Slack alert | `comment_sync_events.status = 'failed'` | DLQ |
| Permission missing (`pages_read_engagement`) | MCP returns `PLATFORM_PERMISSION_DENIED` | Fail closed, DLQ, admin alert | `failed` | DLQ |
| Facebook rate limit | MCP returns `PLATFORM_RATE_LIMIT` | NACK + requeue (backoff), max 5 retries | `dispatched` | NACK |
| Graph API 5xx / timeout | MCP returns `PLATFORM_TRANSIENT_ERROR` | NACK + requeue, max 5 retries | `dispatched` | NACK |
| Malformed MCP result | Zod parse fail on MCP result | DLQ, audit `COMMENT_SYNC_MALFORMED_MCP` | N/A | DLQ |
| Slack config missing (channel env var absent) | `channel_id = null` | Graceful degrade: emit `alert_pending_config`, commit Ledger | `interactions.status = 'new'`, `slack_comment_alerts.status = 'pending_config'` | ACK after commit |
| Slack publish failure after Ledger commit | Queue publish throws | Mark `slack_comment_alerts.status = 'failed'`, no Ledger rollback | Ledger committed | ACK (Slack is non-critical) |
| DB failure before commit | Transaction exception | NACK / requeue | Unchanged | NACK |
| Exhausted retries → DLQ | retry_count > 5 | DLQ write + admin Slack alert | `comment_sync_events.status = 'failed'` | DLQ + ACK |

---

## Queue Behavior

### Queues and Routing Keys

| Queue | Exchange | Routing Key | DLQ | Consumer |
|:---|:---|:---|:---|:---|
| `comments.facebook.sync.requested` | `comments.workflows` | `comments.facebook.sync.requested` | `comments.facebook.sync.requested.dlq` | `facebookCommentSyncRequestConsumer` |
| `comments.facebook.ingest` | `comments.workflows` | `comments.facebook.ingest` | `comments.facebook.ingest.dlq` | `facebookCommentSyncIngestConsumer` |
| `alerts.slack.send` | `alerts` (existing) | `alerts.slack.send` | — | ⚠️ **No consumer yet** — US-007 enqueues only; Slack HTTP delivery is a blocker dependency |

### ACK / NACK Rules

- **ACK:** Only after Ledger transaction committed and Slack alert emitted (or gracefully degraded).
- **NACK + requeue:** Transient errors (rate limit, 5xx, DB timeout). Exponential backoff: 1s, 2s, 4s, 8s, 16s. Max 5 retries.
- **DLQ + ACK original:** Schema validation failure, permanent auth/permission errors, exhausted retries.
- **prefetch(1):** Each consumer channel.

### Idempotency Strategy

| Level | Key Formula | Stored In |
|:---|:---|:---|
| Sync request dispatch | `comments.facebook.sync:{workspace_id}:{job_id}:{sync_date}` | `comment_sync_events.idempotency_key` UNIQUE |
| Comment ingest | `(workspace_id, 'facebook', external_comment_id)` | `interactions` UNIQUE constraint |
| Slack alert | `(interaction_id)` | `slack_comment_alerts` UNIQUE constraint |

### Correlation / Causation IDs

- `CommentSyncRequestedEvent.correlation_id` = new UUID generated by scheduler.
- `CommentIngestEvent.correlation_id` = same as sync request (propagated).
- `CommentIngestEvent.causation_id` = `CommentSyncRequestedEvent.event_id`.
- All audit log entries include `correlation_id`.

---

## Security Constraints

- [ ] **No raw token** anywhere except `SecretStore` inside `apps/facebook-mcp-server/`.
- [ ] **No direct Graph API call** in orchestrator — verified by test `TC-12: no Graph API in orchestrator`.
- [ ] **No large/raw payload in RabbitMQ** — `comment_preview` max 80 chars; full body in Ledger only (pending OQ-007-2 decision).
- [ ] **Sanitized logs/audit/Slack** — no raw matched crisis keyword, no raw body in alert, no token in metadata.
- [ ] **RLS** — `AS RESTRICTIVE` + `USING` + `WITH CHECK` on all 4 new tables.
- [ ] **`SET LOCAL app.current_workspace_id`** — every tenant-scoped DB transaction.
- [ ] **Fail closed** on token/permission uncertainty — auth errors go to DLQ immediately, no retry.
- [ ] **Slack channel missing** — graceful degrade: Ledger commits, `slack_comment_alerts.status = 'pending_config'`, audit entry created. Ledger is NOT rolled back.
- [ ] **`author_ref`** — only safe metadata (`name`, `external_user_id`). No email, no phone.

---

## Test Plan

All tests use `node:test` + `node:assert/strict` (matching existing convention: `mcpPublishWorker.test.ts`). Mocks via `mock.fn()`.

| Test ID | File | Description | Assertion |
|:---|:---|:---|:---|
| TC-01 | `facebookCommentSyncWorker.test.ts` | Duplicate sync does not duplicate comment or Slack alert | 1 DB row, 1 Slack emit on second sync |
| TC-02 | `facebookCommentSyncWorker.test.ts` | Risk comment routes to crisis channel | `publishSlackAlert` called with `SLACK_CRISIS_CHANNEL_ID` |
| TC-03 | `facebookCommentSyncWorker.test.ts` | Normal comment routes to inbox channel | `publishSlackAlert` called with `SLACK_INBOX_CHANNEL_ID` |
| TC-04 | `facebookCommentSyncWorker.test.ts` | Permalink stored in Ledger | `repository.upsertComment` called with `permalink !== null` |
| TC-05 | `facebookCommentSyncWorker.test.ts` | Resolved comment does not re-alert | `publishSlackAlert` NOT called |
| TC-06 | `facebookCommentSyncWorker.test.ts` | DB failure NACKs | Result `{ action: 'nack_requeue' }` |
| TC-07 | `facebookCommentSyncWorker.test.ts` | Slack failure after Ledger commit → compensation mark, no rollback | `result.action === 'ack'`, `persistSlackCompensation` called |
| TC-08 | `facebookCommentSyncWorker.test.ts` | ACK only after Ledger commit | `repository.commit` called before `ack` |
| TC-09 | `commentRiskClassifier.test.ts` | Crisis keyword match (case-insensitive) | `riskCode === 'CRISIS'` |
| TC-10 | `commentRiskClassifier.test.ts` | No keyword match → NORMAL | `riskCode === 'NORMAL'` |
| TC-11 | `facebookCommentContracts.test.ts` | Contract rejects raw token in CommentIngestEvent | `schema.safeParse({ ...event, access_token: '...' }).success === false` |
| TC-12 | `syncComments.test.ts` (MCP) | Happy path returns sanitized comment list | No `access_token` in result |
| TC-13 | `syncComments.test.ts` (MCP) | Auth fail → `PLATFORM_AUTH_FAILED` error code | `result.passed === false && errors[0].code === 'PLATFORM_AUTH_FAILED'` |
| TC-14 | `syncComments.test.ts` (MCP) | Rate limit → `PLATFORM_RATE_LIMIT` | `result.errors[0].code === 'PLATFORM_RATE_LIMIT'` |
| TC-15 | Security Gate | Orchestrator has no `graph.facebook.com` import or fetch call | `grep -r 'graph.facebook.com' apps/orchestrator/src/ | wc -l` === 0 |

---

## Task Breakdown

| Task | Owner/Agent | Priority | Dependencies | Input | Output | Verification | Rollback |
|:---|:---|:---|:---|:---|:---|:---|:---|
| T-001: Shared contracts | backend-specialist | P0 | — | OQ-007-2 decision on body storage | `facebookCommentSync.ts`, `syncComments.ts`, export index | TC-11 passes | Delete contract files |
| T-002: DB migration | backend-specialist | P0 | T-001 | Schema spec above | `0007_us007_facebook_comment_sync.sql` | Migration runs clean; RLS test | `DROP TABLE` rollback script |
| T-003: MCP syncComments tool | backend-specialist | P0 | T-001 | `SyncCommentsInput` contract | `syncComments.ts` handler + `index.ts` registration | TC-12, TC-13, TC-14 | Remove tool registration |
| T-004: Risk classifier | backend-specialist | P1 | T-001 | Keywords config | `commentRiskClassifier.ts` | TC-09, TC-10 | N/A (pure function) |
| T-005: CommentSyncWorkerRepository | backend-specialist | P1 | T-002 | DB schema | `commentSyncWorkerRepository.ts` | Manual DB query post-test | N/A (stateless) |
| T-006: FacebookCommentSyncWorker | backend-specialist | P1 | T-003, T-004, T-005 | Event contracts | `facebookCommentSyncWorker.ts` | TC-01 through TC-08 | N/A (stateless class) |
| T-007: RabbitMQ consumers | backend-specialist | P1 | T-001 | Consumer pattern | `facebookCommentSyncRequestConsumer.ts`, `facebookCommentSyncIngestConsumer.ts` | Consumer connects, schema validation | Remove from server.ts |
| T-008: CommentSyncScheduler | backend-specialist | P1 | T-002, T-007 | Scheduler pattern | `commentSyncScheduler.ts` | Scheduler queries DB; no DQ from missing posts | Disable env flag |
| T-009: QueuePublisher extension | backend-specialist | P1 | T-001 | Publisher pattern | `rabbitmqPublisher.ts` + new methods | Integration test publish + receive | Revert added methods |
| T-010: MCP Client extension | backend-specialist | P1 | T-003 | MCP client pattern | `facebookMcpClient.ts` + `syncComments()` | Unit test: MCP client calls tool | Revert method |
| T-011: server.ts wiring | backend-specialist | P2 | T-006, T-007, T-008 | Startup pattern | Updated `server.ts` | Server starts without error | Remove wiring |
| T-012: Tests | backend-specialist | P1 | T-006 | Test plan above | All test files | All TC pass | N/A |
| T-013: FL-005 in Logic Register | backend-specialist | P2 | T-006 | Design finalized | Updated `05_Function_Flow_Logic_Register.md` | PR review | N/A |
| T-014: Report | backend-specialist | P2 | All | Completed work | `REPORT-us-007-*.md` | File exists | N/A |

---

## Dependency Graph

```
T-001 (contracts)
  ├── T-002 (migration) ──────────────────────┐
  ├── T-003 (MCP syncComments tool)            │
  │     └── T-010 (MCP client extension)       │
  ├── T-007 (consumers)                        │
  └── T-004 (risk classifier)                  │
        │                                      │
        ▼                                      ▼
      T-005 (repository) ◄── T-002 ──────────►T-005
        │
        ▼
      T-006 (worker) ◄── T-003 (via MCP client) ◄── T-010
        │
        ├── T-007 (consumers wire to worker)
        ├── T-012 (tests)
        └── T-008 (scheduler)
              │
              ▼
            T-009 (publisher) ─► T-011 (server.ts)
                                   │
                                   └── T-013 (FL-005) ─► T-014 (report)
```

---

## RACI

| Task Area | Responsible | Accountable | Consulted | Informed |
|:---|:---|:---|:---|:---|
| Architecture / Boundaries | backend-specialist agent | Tech Lead | Product Owner | Team |
| Schema Design | backend-specialist agent | Tech Lead | BA | DBA |
| MCP Tool Implementation | backend-specialist agent | Tech Lead | — | — |
| Risk Classifier Rules | backend-specialist agent | BA / Marketing | Legal | Tech Lead |
| Slack Channel Config | Admin/IT | Tech Lead | Product Owner | Support team |
| Test Writing | backend-specialist agent | Tech Lead | — | — |
| Security Gate | security-auditor agent | Tech Lead | — | — |
| Plan Approval | — | Tech Lead + Product Owner | backend-specialist | All |

---

## Environment Variables

```bash
# Feature flag — disable sync if needed without redeploy
FACEBOOK_COMMENT_SYNC_ENABLED=true

# Scheduler interval in ms (default: 5 minutes)
FACEBOOK_COMMENT_SYNC_INTERVAL_MS=300000

# Comma-separated crisis/risk keywords (configurable without code change)
COMMENT_RISK_KEYWORDS=khủng hoảng,crisis,scam,lừa đảo,tẩy chay

# Slack channel IDs (required for routing; graceful degrade if missing)
SLACK_INBOX_CHANNEL_ID=
SLACK_CRISIS_CHANNEL_ID=

# Max retries before DLQ
COMMENT_SYNC_MAX_RETRIES=5

# Already present in system
RABBITMQ_URL=
DATABASE_URL=

# In Facebook MCP Server (NOT in orchestrator)
# FB_PAGE_TOKEN_{CHANNEL_ACCOUNT_ID}= (resolved via SecretStore)
```

> ⚠️ **No actual tokens or secrets committed to env files.** Secret refs only in Ledger; actual tokens in secret store (env in dev, Vault/managed secret in prod).

---

## Open Questions

| ID | Question | Impact on Scope | Owner | Needed By |
|:---|:---|:---|:---|:---|
| OQ-007-1 | **Trigger:** MVP = cron scheduler polling `publish_jobs WHERE status='published'`. Is this acceptable, or does Product want a webhook trigger (real-time)? | Webhook = significantly higher complexity; US-011 OAuth must be stable first. Plan assumes polling. | Product Owner / Tech Lead | Before T-001 |
| OQ-007-2 | **Comment body storage:** Store full body in Ledger (`comments.body`)? Or only preview (80 chars) + external ref? Support needs to read/respond quickly per backlog. BR1 says don't send sensitive data to Slack — but full body in Ledger is fine if RLS-secured. | Affects `comments.body` column nullable/required + `CommentIngestEvent` payload. Plan assumes full body in Ledger, preview only in queue. | Product Owner / BA | Before T-001 |
| OQ-007-3 | **Risk keyword config source:** Env var (MVP) vs. per-workspace Postgres config table vs. Notion guideline? Env var is simplest and aligns with D-009 pattern for forbidden terms. | If workspace config table → T-002 needs additional table + T-004 needs DB read. | Tech Lead / BA | Before T-004 |
| OQ-007-4 | **Slack alert body format:** Show `author_name + preview + permalink`? Or just `permalink + risk_code`? Affects UX for Support team. | Minor — affects alert payload metadata structure only. | Product Owner / Support team | Before T-007 |
| OQ-007-5 | **Token source for sync:** US-007 sync needs a Page token. US-011 (OAuth/admin config) is not yet implemented. For MVP, should `syncComments` use `token_reference.secret_ref` from existing `channel_account` row (if present), or a dedicated env var mock in MCP server? | If channel_account has no token_reference yet, need placeholder. | Admin / IT | Before T-003 |
| OQ-007-6 | **Queue topology:** Single `comments.facebook.ingest` queue for all comments per sync, or separate `comments.facebook.sync.requested` → MCP → result → ingest? Plan uses two-queue approach for clean MCP boundary separation. Tech Lead must confirm. | Two-queue adds one hop but keeps MCP boundary clean. Single queue requires orchestrator to call MCP inline. | Tech Lead | Before T-001 |

---

## Approval Gate Before Coding

**The following must be approved or resolved before any implementation begins:**

- [ ] **OQ-007-1:** Trigger confirmed as polling (cron) for MVP.
- [ ] **OQ-007-2:** Comment body storage decision made (full body in Ledger / preview only / hybrid).
- [ ] **OQ-007-3:** Risk keyword source confirmed (env var for MVP).
- [ ] **OQ-007-5:** Token source for MVP sync confirmed.
- [ ] **OQ-007-6:** Two-queue topology approved by Tech Lead.
- [ ] **Architecture review:** Plan reviewed and no boundary violations flagged.
- [ ] **Security review:** No raw token in queue contracts; RLS on all tables confirmed.
- [ ] **Scope sign-off:** Out-of-scope items (US-009 reply, US-011 OAuth) confirmed deferred.

**Plan Author Sign-off:** backend-specialist agent, 2026-06-02  
**Tech Lead Sign-off:** _pending_  
**Product Owner Sign-off:** _pending_


## AI-SDLC AC Traceability (Retrofit Audit)

- AC1: Planned and defined.
- AC2: Planned and defined.
- AC3: Planned and defined.
- AC4: Planned and defined.
