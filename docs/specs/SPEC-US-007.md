# SPEC-US-007: Facebook Comment Sync and Risk Classification

**Status:** Approved  
**Retrofit Note:** Retrospec — US-007 implemented before AI-SDLC gate. Verified from FL-005 and `topologyConfig.ts`.  
**FL Reference:** FL-005 (Facebook Comment Sync) — `docs/requirements/05_Function_Flow_Logic_Register.md` line 510  
**Backlog AC/BR:** US-007 AC1–AC4, BR1–BR3

---

## Goal

Run a cron-scheduled comment sync every 5 minutes: push `comments.facebook.sync.requested` events, call MCP `syncComments` tool to fetch new comments from Facebook Graph API, push each comment to `comments.facebook.ingest`, upsert comments into `interactions` and `messages`, classify risk, and send Slack crisis alerts for high-risk comments — without storing raw tokens in queue or logs.

---

## Source References

- **Backlog:** `docs/requirements/04_Product_Backlog.md` — US-007, Epic E03
- **FL-005:** `docs/requirements/05_Function_Flow_Logic_Register.md` line 510–550
- **FL-006 note:** FL-006 (line 552) is listed with `Backlog Link: US-007` but describes a generic Slack Command Handler stub — it does not apply to the US-007 comment sync workflow. FL-005 is the authoritative FL for US-007.
- **Scheduler:** `apps/orchestrator/src/scheduler/commentSyncScheduler.ts`
- **Workers:** `apps/orchestrator/src/workers/facebookCommentSyncWorker.ts`
- **Risk Classifier:** `apps/orchestrator/src/services/commentRiskClassifier.ts`
- **Queue topology:** `apps/orchestrator/src/queue/topologyConfig.ts` — `comments.facebook.sync.requested`, `comments.facebook.ingest`
- **MCP Tool:** `apps/facebook-mcp-server/src/tools/syncComments.ts`

---

## In Scope

- `CommentSyncScheduler` cron (every 5 minutes): scan `publish_jobs` for posts needing sync → push `comments.facebook.sync.requested`.
- Request consumer: consume `comments.facebook.sync.requested`, resolve `secretRef` via `channel_account_id`, call MCP `syncComments`.
- MCP `syncComments`: resolves page token from `SecretStore`, calls Facebook Graph API, returns array of comment objects (sanitized).
- Per-comment ingest: publish `comments.facebook.ingest` events (one per comment).
- Ingest worker (`FacebookCommentSyncWorker`): deduplicate by `external_comment_id`, upsert `interactions` + `messages`, run risk classification, if CRISIS → alert via `alerts.slack.send`.

## Out of Scope

- Replying to comments from Slack — that belongs to US-009 / FL-010.
- Escalating comments from Slack — also US-009.
- Manual comment sync trigger — sync is scheduler-only in US-007.
- Storing raw page tokens in queue or Ledger.

---

## Functional Contract

1. **Scheduler (`CommentSyncScheduler`):** Every 5 minutes, query `publish_jobs WHERE status='published'` (posts needing sync). For each: push `comments.facebook.sync.requested` with `{job_id, external_post_id, channel_account_id}`.

2. **Sync Request Consumer:** Consume from `comments.facebook.sync.requested`. Resolve `secretRef` (token reference) from `channel_accounts` table using `channel_account_id`. Call MCP `syncComments(externalPostId, secretRef)`.
   - MCP server: uses `SecretStore` to resolve page token → calls `GET /{post_id}/comments` → returns array of `{external_comment_id, text, author_name, created_time}` (sanitized, no token).

3. **Per-comment publish:** For each comment returned: publish `comments.facebook.ingest` event with `{external_comment_id, external_post_id, channel_account_id, workspace_id}` (references-only).

4. **Ingest Worker (`FacebookCommentSyncWorker`):** Consume from `comments.facebook.ingest` (prefetch: 5).
   - Deduplicate: check `interactions` by `external_comment_id`. Duplicate → ACK.
   - Upsert `interactions`: `{external_comment_id, external_post_id, channel_account_id, workspace_id, status: "new", platform: "facebook"}`.
   - Insert `messages`: `{interaction_id, direction: "inbound", body: comment text, author_name}`.
   - Run `commentRiskClassifier.classify(comment)` → `{riskLevel: "low"|"medium"|"high"|"crisis", reason}`.
   - If `riskLevel === "crisis"`: publish alert to `alerts.slack.send`.
   - Audit `FACEBOOK_COMMENT_SYNCED`.
   - COMMIT → ACK.

---

## Data / Queue / API Contract

### Queues
| Queue | Exchange | DLQ | Prefetch | Direction |
|:---|:---|:---|:---|:---|
| `comments.facebook.sync.requested` | `comments.workflows` | `.dlq` | 1 | Scheduler → MCP caller |
| `comments.facebook.ingest` | `comments.workflows` | `.dlq` | 5 | MCP caller → ingest worker |
| `alerts.slack.send` | `alerts` | `.dlq` | 5 | Ingest worker → Slack alert |

### Ledger Entities
- **`interactions`:** `{id, workspace_id, external_comment_id, external_post_id, channel_account_id, platform: "facebook", status: "new"|"replied"|"escalated"|"hidden", risk_level, created_at}`
- **`messages`:** `{id, interaction_id, workspace_id, direction: "inbound", body, author_name, created_at}`

### MCP Tool Contract
- **`syncComments(externalPostId, secretRef)`** → array of `{external_comment_id, text, author_name, created_time}` (sanitized)
- **Token resolution:** MCP server resolves page token from `SecretStore` using `secretRef` — token never in orchestrator or queue

---

## Security & Safety Rules

- **No raw tokens in queue payloads.** `secretRef` (pointer) may appear in sync request, not actual token.
- **ACK only after Ledger commit** for ingest worker.
- **`external_comment_id` uniqueness** enforced before upsert to prevent duplicate classification.
- **Crisis alert payload**: Slack notification contains only `interaction_id`, `risk_level`, `reason` — not raw comment text or token.
- **MCP boundary**: orchestrator cannot call Facebook Graph API directly for comments.

---

## Error Cases

| Case | Action | Queue |
|:---|:---|:---|
| MCP `syncComments` transient error | NACK → retry | Retry |
| MCP `syncComments` channel account missing | DLQ | DLQ |
| Duplicate `external_comment_id` | ACK no-op | ACK |
| DB fail during ingest commit | NACK → retry | Retry |
| Risk classifier throws | Log error, ACK with partial data | ACK |
| Slack alert publish fail | Log `FACEBOOK_COMMENT_SYNC_ALERT_FAILED`, continue | No retry |

---

## Acceptance Criteria

**AC1 — New comments are ingested and deduplicated (Backlog AC1)**
- *Given* a published post with 3 new comments from Facebook
- *When* `CommentSyncScheduler` triggers and MCP `syncComments` returns the comments
- *Then* 3 `interactions` rows and 3 `messages` rows are upserted; a second sync with the same comments produces no additional rows (dedup by `external_comment_id`).
- *Trace evidence:* Test case `"should ingest new comments and ignore duplicates"` in [facebookCommentSyncWorker.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/facebookCommentSyncWorker.test.ts) and [REPORT-us-007-implementation-2026-06-02.md](file:///d:/Muti-Media%20Management/docs/reports/US-007/REPORT-us-007-implementation-2026-06-02.md).

**AC2 — Crisis comment triggers Slack alert (Backlog AC2)**
- *Given* a comment classified as `riskLevel = "crisis"` by `CommentRiskClassifier`
- *When* the ingest worker processes it
- *Then* an alert event is published to `alerts.slack.send` and `interactions.risk_level = "crisis"` is persisted.
- *Trace evidence:* Test case `"should trigger crisis alert on crisis comment risk classification"` in [facebookCommentSyncWorker.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/facebookCommentSyncWorker.test.ts) and risk keyword checks in [commentRiskClassifier.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/commentRiskClassifier.test.ts).

**AC3 — Tokens never appear in queue payloads (Backlog AC3, BR2)**
- *Given* any message in `comments.facebook.sync.requested` or `comments.facebook.ingest`
- *When* the payload is inspected
- *Then* no `access_token`, `page_token`, `bearer`, or raw token string is present.
- *Trace evidence:* Contract schemas verified in [facebookCommentSyncWorker.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/facebookCommentSyncWorker.test.ts) (checking Zod contract boundaries).

- *Trace evidence:* Test case `"should query published jobs and trigger requests"` in [facebookCommentSyncWorker.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/facebookCommentSyncWorker.test.ts).

---

## Test Plan

### Existing Test Files (Verified)

| Test File | Path | Coverage |
|:---|:---|:---|
| [facebookCommentSyncWorker.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/facebookCommentSyncWorker.test.ts) | `apps/orchestrator/src/__tests__/facebookCommentSyncWorker.test.ts` | Cron scheduling queries, comment ingestion, duplicate key constraints, risk classification, crisis alerting |
| [commentRiskClassifier.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/commentRiskClassifier.test.ts) | `apps/orchestrator/src/__tests__/commentRiskClassifier.test.ts` | Crisis keyword risk categorization checks |
| [syncComments.test.ts](file:///d:/Muti-Media%20Management/apps/facebook-mcp-server/src/__tests__/syncComments.test.ts) | `apps/facebook-mcp-server/src/__tests__/syncComments.test.ts` | MCP tool execution, FB Graph API sync returns |

### Verification Evidence Reports

TDD cycles and verification notes:
- [REPORT-us-007-implementation-2026-06-02.md](file:///d:/Muti-Media%20Management/docs/reports/US-007/REPORT-us-007-implementation-2026-06-02.md)

### RED Evidence Status

**Partial** — Implemented before AI-SDLC gate. Original RED stage execution outputs not captured. However, regression tests exist and currently run green.

---

## Documentation Conflict

**FL-006 backlink mismatch:** FL-006 (`docs/requirements/05_Function_Flow_Logic_Register.md` line 552) states `Backlog Link: US-007` but describes a generic Slack Command Handler (not the comment sync flow). This is a pre-existing documentation artifact. FL-005 is the authoritative FL for US-007. No code impact.

---

## Validation Level

**L2** — Verification suite passes with automated tests. Run command:
`npm run test apps/orchestrator/src/__tests__/facebookCommentSyncWorker.test.ts`

