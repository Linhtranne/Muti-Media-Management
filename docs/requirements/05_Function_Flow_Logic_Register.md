# Function Flow & Logic Register

File nÃ y lÃ  nguá»“n ghi láº¡i toÃ n bá»™ luá»“ng vÃ  logic cá»§a tá»«ng chá»©c nÄƒng. Má»—i láº§n code hoáº·c Ä‘á»•i logic, developer pháº£i cáº­p nháº­t section tÆ°Æ¡ng á»©ng trÆ°á»›c khi PR Ä‘Æ°á»£c merge.

## Quy táº¯c cáº­p nháº­t

- Má»—i function/module cÃ³ má»™t mÃ£ `FL-xxx`.
- Ghi rÃµ trigger, input, processing steps, output, error handling, audit, test evidence.
- Náº¿u logic thay Ä‘á»•i, thÃªm entry má»›i vÃ o `Change History`, khÃ´ng xÃ³a lá»‹ch sá»­ cÅ©.

## Template cho má»—i chá»©c nÄƒng

```md
### FL-xxx: [TÃªn chá»©c nÄƒng]

**Backlog Link:** US-xxx
**Owner:** [TÃªn/Role]
**Status:** Draft/In Progress/Implemented/Changed/Deprecated

**Trigger**
- ...

**Input**
- ...

**Processing Logic**
1. ...
2. ...

**Output**
- ...

**Error Handling**
- ...

**Audit/Telemetry**
- ...

**Security Rules**
- ...

**Test Evidence**
- ...

**Change History**
- YYYY-MM-DD: ...
```

---

### FL-001: Airtable Post Approved Webhook

**Backlog Link:** US-002  
**Owner:** Backend/Orchestration  
**Status:** Designed (Ready for Implementation)

**Trigger**
- Airtable webhook fires when a Post record is modified.

**Input**
- Webhook payload: `event_id`, `record_id`, `table_name`, `change_type`, `approved_at` (acting as temporary `approval_ref`).

**Processing Logic**
1. **Webhook Ingestion (Receiver):** 
   - Strict Zod/Pydantic validation.
   - Deduplicate by `event_id` only (ignores unrelated events with `unrelated_ignored`). 
   - Do NOT reload Airtable. Do NOT allocate `approved_version`.
2. **References-Only Queue (Receiver -> RabbitMQ):** 
   - Enqueue a minimal message containing only immutable references (`event_id`, `record_ref`, `workspace_id`). 
   - Payload contains NO tokens, NO content, NO assets, NO `master_copy`, NO CTA URL.
3. **Database Reload (Worker Zero-Trust):** 
   - Worker consumes queue message, queries Airtable API: `GET /v0/base_id/Posts/record_id`.
4. **State Verification (Worker Zero-Trust Reload Logic):** 
   - Reverify current status:
     - `Approved`: continue revalidation (step 5).
     - `Scheduled` or `Published` (already processed): classify as `already_advanced_ignored`. ACK event, do NOT allocate version.
     - `Draft`, `Review`, or `Failed` (stale/state changed after approval): classify as `state_changed_ignored`. ACK event, do NOT allocate version.
     - Any unknown status: classify as `unknown_status_ignored`. ACK event, do NOT allocate version.
   - Reverify validity (copy present, channels linked). If invalid, classify `invalid_after_reload_ignored`, ACK event, do NOT allocate version.
5. **Channel Account Revalidation:**
   - If missing/inactive: log sanitized reason, ACK event (no workflow).
   - If unresolved: send to DLQ if Ledger commit succeeds; retry if Ledger commit fails.
6. **Version Allocation & Idempotency (Worker):**
   - ONLY allocate `approved_version` via advisory lock `(workspace_id, airtable_record_id)` after seeing fresh, valid `Approved` state.
   - Production Idempotency Key: `airtable.post.approved:{workspace_id}:{airtable_record_id}:{approved_version}`.
   - If duplicate idempotency key is detected during workflow creation, status is `duplicate_ignored`.
7. **Orchestrate:** 
   - Create workflow stub with status `pending_ai_generation`.
   - Workflow runs `channel_account_refs` contains safe metadata only.
   - Worker ACKs RabbitMQ message ONLY AFTER Ledger commit is successful.

**Output**
- Ledger audit trail and orchestrated downstream publishing workflow stub started (success status: `workflow_stub_created`).

**Error Handling & Reload Revalidation Matrix**

| Case | Detection | Action | Ledger Status | Retry? |
|:---|:---|:---|:---|:---|
| Approved Post event | Reloaded status is `Approved` & valid | Allocate version, create workflow stub, commit Ledger, ACK | `workflow_stub_created` | No |
| Duplicate workflow | Idempotency key already exists | ACK event; log sanitized note; do not allocate new version | `duplicate_ignored` | No |
| Unrelated ingress | Webhook not targeting correct table/event | ACK event; ignore | `unrelated_ignored` | No |
| Already advanced approved event | Reloaded status is `Scheduled` or `Published` | ACK event; log sanitized note; do not allocate version | `already_advanced_ignored` | No |
| State changed after approval | Reloaded status is `Draft`, `Review`, or `Failed` | ACK event; log sanitized note; do not allocate version | `state_changed_ignored` | No |
| Unknown status | Reloaded status is any unrecognized value | ACK event (fail closed); log critical unknown status note | `unknown_status_ignored` | No |
| Invalid after reload | Invalid conditions met | ACK event; log validation blockers | `invalid_after_reload_ignored` | No |
| Channel account missing/inactive | Target platform has no stubs linked or inactive | ACK event; log sanitized reason; no workflow | `channel_account_missing` / `channel_account_inactive` | No |
| Channel account unresolved | Reference stub cannot be mapped server-side | Send to DLQ if Ledger writes, retry if Ledger fails | `channel_account_unresolved` | DLQ/Retry |
| Infrastructure failure | Temporary network timeout or Airtable API limit hit | NACK event (re-enqueue); log retry status | `retryable_failed` | Yes |

**Audit/Telemetry**
- Events: `WEBHOOK_RECEIVED`, `WEBHOOK_RELOAD_SUCCESS`, `WEBHOOK_PROCESSING_FAILED`.
- Global log sanitizer/redactor applied. No raw tokens/secrets/vault refs in logs, queue, audit, fixtures.
- Rollbacks in production must use compensating audit (no physical DELETE for `workflow_runs`).
- All DB operations scoped by `workspace_id`.

**Security Rules**
- **Do not trust Airtable event payload alone.** Reload and revalidate before any side effect.
- **Zero Token Storage:** Airtable contains display stubs only. Never expect credentials from Airtable.
- **Payload Privacy:** RabbitMQ and logs carry references only. Mask all token references and secrets in ledger logs.
- Worker ACK only after Ledger commit.

**Test Evidence**
- Test cleanup only for non-production + `workspace_id LIKE 'test_%'`.
- Fully documented in US-002 design phase.

**Change History**
- 2026-05-20: Initial logic drafted.
- 2026-05-20: Refined with strict reload revalidation, credential boundaries, and error matrix in T-006.
- 2026-05-20: Updated reload revalidation logic and status mapping stubs to resolve stale events and handle reviewer trace preservation in T-008.
- 2026-05-21: Finalized US-002 specs: decoupled receiver (dedupe by event_id), moved version allocation to worker (only on fresh Approved), enforced strict zero-trust queue payload, corrected statuses (`workflow_stub_created`, `duplicate_ignored`, `pending_ai_generation`), and enforced ACK-after-Ledger-commit.

### FL-002: AI Composer Facebook Variant

**Backlog Link:** US-003  
**Owner:** AI/Backend  
**Status:** Designed (Ready for Implementation, Conditional Security Approval)

**Trigger**
- A durable `workflow_runs` row created by FL-001/US-002 with `status = 'pending_ai_generation'`.
- US-002 publishes a references-only RabbitMQ message to `ai.compose.facebook.requested` after the workflow stub is committed.
- The trigger payload contains references only, never source copy, credentials, tokens, prompts, AI output, CTA text blobs, assets, or large content bodies.

**Input**
- Ledger references: `workspace_id`, `workflow_run_id`, `airtable_record_id`, `approved_version`, safe `channel_account_refs`.
- RabbitMQ message: `event_id`, `event_type = ai.compose.facebook.requested`, `workspace_id`, `workflow_run_id`, `prompt_version`, `idempotency_key`, `correlation_id`, `causation_id`.
- Airtable reload fields: `post_id`, `campaign_id`, `master_copy`, `cta_url`, `asset_links`, `target_channels`, `scheduled_at`, `status`, campaign objective, optional `notion_brief_url`.
- Runtime config: active `prompt_version`, validated provider/model config, Airtable field mapping config.
- Optional Notion context references loaded through the allowlisted Notion context loader.

**Processing Logic**
1. **Claim Workflow:**
   - Start a Postgres transaction.
   - Execute `SET LOCAL app.current_workspace_id = :workspace_id`.
   - Select and lock one `workflow_runs.status = 'pending_ai_generation'` row.
   - Transition the workflow to `ai_generation_processing`.
   - Initialize or resume `ai_generation_runs` using idempotency key `ai.compose.facebook:{workspace_id}:{workflow_run_id}:{prompt_version}`.
   - Commit before external I/O.
2. **Reload and Revalidate Airtable Context:**
   - Reload the Airtable Post by reference.
   - Verify the source record is still compatible with AI generation.
   - Require `target_channels` to explicitly contain `Facebook`.
   - Verify required content fields and safe channel account references.
3. **Load Notion Context:**
   - Treat Notion as optional, untrusted knowledge context.
   - Allow only `https` official Notion hosts (`api.notion.com`, `www.notion.so`, `notion.so`).
   - Block redirects, custom/shortened domains, userinfo, nonstandard ports, and private/link-local/loopback DNS targets.
   - If configured fallback is allowed, record fallback in `notion_context_refs`; do not create a new workflow fallback status.
4. **Build Prompt:**
   - Use the active versioned Facebook composer prompt.
   - Delimit Airtable/Notion text as untrusted data.
   - Do not include tokens, secret refs, API keys, provider credentials, or platform credentials.
5. **Call AI Provider:**
   - Use the provider adapter with validated config.
   - Enforce timeout and bounded retry for transient provider failures.
   - Sanitize provider errors before logs, audit, or Airtable notes.
6. **Validate Structured Output:**
   - Require `body`, `hashtags`, and optional `cta_url`.
   - Normalize hashtags by trimming, adding `#`, lowercasing before dedupe, and limiting to 10.
   - Validate CTA URL and exact UTM preservation with a dedicated utility.
   - Detect intent drift and prompt-injection indicators.
7. **Persist Result in Ledger:**
   - On success, write sanitized `input_snapshot`, `notion_context_refs`, `output_snapshot`, provider/model metadata, and a `content_variants` row with `approval_status = 'needs_review'` and `policy_status = 'pending_policy'`.
   - Transition `workflow_runs` to `ai_generation_completed`.
   - On validation/manual-review failure, set `ai_generation_runs.status = 'needs_manual_review'`, parent workflow `ai_generation_failed`, and do not create an active `content_variants` draft.
   - On hard security failure, set `ai_generation_runs.status = 'failed'`, parent workflow `ai_generation_failed`, and persist only sanitized metadata plus `rawOutputHash` when needed.
8. **Sync Airtable Review Fields:**
   - Use Airtable field mapping config instead of hardcoded field names.
   - Reload the Airtable Post immediately before PATCH and require the current status to remain compatible with the claimed approval; if stale, do not PATCH and set `sync_retry_needed = true`.
   - Update only reviewable draft fields or sanitized review notes.
   - Never mutate the main Post status to `Approved`, `Scheduled`, `Published`, or publish-driving states.
   - If Airtable sync fails after Ledger commit, set `content_variants.sync_retry_needed = true` and write compensating audit metadata.
9. **Policy Handoff:**
   - If generation completed successfully, write a transactional outbox event `policy.evaluate.requested`.
   - The event is references-only and includes `idempotency_key`.
   - Do not create publish jobs and do not call Facebook Graph API or MCP publish tools.
10. **Broker Acknowledgement:**
   - ACK RabbitMQ only after the durable Ledger state is committed.
   - Invalid AI queue messages are written to the AI DLQ and only then ACKed from the main queue.
   - Retryable failures must be recorded durably and retried via delayed retry/scheduler, not a hot NACK loop.

**Output**
- On success: one Facebook `content_variants` draft linked to the correct `workspace_id`, `workflow_run_id`, `airtable_record_id`, `post_id`, `approved_version`, and `platform = 'facebook'`.
- One `ai_generation_runs` record with sanitized input/output snapshots, prompt version, provider/model metadata, and Notion context refs.
- One `policy.evaluate.requested` transactional outbox event for US-004.
- On failure: durable Ledger failure/review state and sanitized Airtable review note, with no publish queue side effect.

**Error Handling**
- `PROVIDER_TIMEOUT` / `PROVIDER_RATE_LIMIT`: mark `retryable_failed`, schedule bounded delayed retry, ACK only after Ledger commit.
- `SCHEMA_PARSING_FAILED`, `INTENT_DRIFT`, `CTA_UTM_MUTATED`, `CTA_URL_INVALID`, `CTA_URL_MISSING`: mark `needs_manual_review`, parent `ai_generation_failed`, do not create active variant.
- `PROMPT_INJECTION_DETECTED`: hard fail, parent `ai_generation_failed`, do not store raw malicious output.
- `INVALID_MODEL_CONFIG`: terminal failure requiring operator/developer intervention.
- `AIRTABLE_CONTEXT_UNREACHABLE`, `AIRTABLE_CONTEXT_INVALID`, `STALE_SOURCE_STATUS_CHANGED`: map to compatible terminal or manual-review state with sanitized reason.
- Airtable sync failure after Ledger success: do not roll back Ledger; set `sync_retry_needed = true` and create compensating audit entry.

**Audit/Telemetry**
- `ai_run_claimed`
- `ai_run_completed`
- `ai_run_retryable_failed`
- `ai_run_validation_failed`
- `ai_run_failed`
- `airtable_variant_synced`
- `airtable_variant_sync_failed`
- `policy_handoff_enqueued`
- All audit metadata must be workspace-scoped and sanitized.

**Security Rules**
- Every tenant-scoped DB transaction must execute `SET LOCAL app.current_workspace_id = :workspace_id`.
- Normal tenant workers must not use a service role that bypasses RLS.
- RLS policies must include both `USING` and `WITH CHECK`.
- No raw tokens, API keys, bearer strings, vault refs, provider credentials, or platform credentials in prompts, queues, logs, snapshots, Slack, Airtable, or audit metadata.
- RabbitMQ messages contain references only.
- AI Composer cannot publish, create publish jobs, call Facebook Graph API, or invoke MCP publish tools.
- Notion URLs must pass strict SSRF controls before any fetch.
- Prompt injection hard failures must not persist raw malicious output.

**Test Evidence**
- Design-level coverage is documented in `docs/plans/US-003/US-003-test-plan-and-evals.md`.
- Required implementation tests: happy path, duplicate/redelivery, ACK-after-Ledger, provider retry, malformed JSON, hashtag normalization, CTA missing/invalid/UTM mutation, Notion fallback, SSRF blocklist, prompt injection, Airtable sync compensation, RLS fail-closed, and no-publish-boundary regression.

### FL-004: Facebook MCP Validate vÃ  Enqueue Publish Job

**Backlog Link:** US-005
**Owner:** MCP/Backend
**Status:** Designed (Ready for Implementation â€” pending OQ-005-3, OQ-005-4 resolution)

**Trigger**
- RabbitMQ message `publish.facebook.requested` published bá»Ÿi US-004 transactional outbox relay (`publish_handoff_events`).
- Message arrives khi `publish_jobs.status = 'queued'`, `content_variants.policy_status = 'policy_approved'`, `workflow_runs.status = 'policy_evaluation_completed'`.

**Input**
- RabbitMQ message: `event_id`, `event_type = publish.facebook.requested`, `workspace_id`, `workflow_run_id`, `job_id`, `variant_id`, `channel_account_id`, `scheduled_at`, `idempotency_key`, `correlation_id`, `created_at`.
- Payload lÃ  references-only: khÃ´ng chá»©a body, hashtags, cta_url, token, bearer, secret.
- Ledger reload: `publish_jobs`, `content_variants`, `channel_account`, `token_reference` (metadata: `secret_ref`, `token_status`, `expires_at`, `scopes`).

**Preconditions**
- `publish_jobs.status = 'queued'` (idempotency guard).
- `content_variants.policy_status = 'policy_approved'`.
- `workflow_runs.status = 'policy_evaluation_completed'`.
- `publish_jobs.mcp_validation_idempotency_key` khÃ´ng tá»“n táº¡i (US-005-level dedup).

**Processing Logic**
1. **Message Schema Validation (Consumer):** Validate message báº±ng Zod schema `PublishFacebookRequestedEvent`. Invalid â†’ DLQ â†’ ACK original â†’ exit.
2. **Idempotency Check:** Query `publish_jobs` by `job_id`. status `validated`/`publishing`/`published` â†’ ACK, log `already_advanced`, exit. status `validation_failed` â†’ ACK, log `already_failed`, exit. `mcp_validation_idempotency_key` exists â†’ ACK, no-op, exit.
3. **Start Postgres Transaction:** `SET LOCAL app.current_workspace_id = :workspace_id`. Reload context. Transition `publish_jobs.status = 'mcp_validating'`. COMMIT.
4. **Token Pre-check (fast-fail):** Verify `token_reference.token_status = 'active'` AND `expires_at > NOW() + buffer`. Fail â†’ `validation_failed` + Slack alert Admin â†’ ACK â†’ exit.
5. **Call MCP tool `get_rate_limit_status`** via MCP client â†’ Facebook MCP Server. MCP server Ä‘á»c token tá»« secret store (chá»‰ trong MCP server process). Return sanitized `RateLimitStatusResult`. `quotaExceeded = true` â†’ `validation_failed` + Slack â†’ ACK â†’ exit.
6. **Call MCP tool `validate_post`** via MCP client â†’ Facebook MCP Server. MCP server Ä‘á»c token, apply FB validation rules, return sanitized `ValidatePostResult` (NO raw API response, NO token). violations present â†’ `validation_failed` + Slack â†’ ACK â†’ exit.
7. **Persist Result (Atomic Transaction):** UPDATE `publish_jobs` (`status = 'validated'`, `mcp_validation_result`, `validated_at`, `mcp_validation_idempotency_key`). UPDATE `workflow_runs` (`status = 'mcp_validation_completed'`). INSERT `audit_log` (`MCP_VALIDATION_COMPLETED`). INSERT `mcp_validation_events` outbox. COMMIT.
8. **ACK RabbitMQ chá»‰ sau COMMIT.**
9. **Post-Commit:** Outbox relay publishes `publish.facebook.validated` â†’ RabbitMQ (for US-006).

**Output**
- Pass: `publish_jobs.status = 'validated'`, `mcp_validation_events` outbox pending, `publish.facebook.validated` emitted.
- Fail: `publish_jobs.status = 'validation_failed'`, sanitized error in Ledger, Slack alert sent.
- Ineligible: ACK, no state change, audit `mcp_validation_ineligible`.

**Error Handling**

| Case | Detection | Action | `publish_jobs.status` | RabbitMQ |
|:---|:---|:---|:---|:---|
| Pass | All checks pass | Commit `validated` + outbox | `validated` | ACK after commit |
| Token invalid/expired | `token_status != 'active'` OR OAuthException | `validation_failed` + Slack Admin alert | `validation_failed` | ACK after commit |
| Quota exceeded | `quotaExceeded = true` | `validation_failed` + `QUOTA_EXCEEDED` + Slack | `validation_failed` | ACK after commit |
| Platform constraint violated | violations present | `validation_failed` + Slack | `validation_failed` | ACK after commit |
| Transient MCP/network error | Timeout / 5xx | NACK â†’ requeue (max 5 retries) | `mcp_validating` | NACK |
| Duplicate event | status already advanced | ACK, no-op | Unchanged | ACK |
| Schema invalid | Zod fail | DLQ + ACK original | N/A | DLQ + ACK |
| DB fail before commit | Transaction error | NACK/requeue | Unchanged | NACK |
| Exhausted retries | retry_count > 5 | DLQ + admin Slack | `validation_failed` | DLQ |

**Audit/Telemetry**
- `MCP_VALIDATION_STARTED`, `MCP_VALIDATION_COMPLETED`, `MCP_VALIDATION_FAILED`, `MCP_VALIDATION_INELIGIBLE`, `MCP_TOKEN_PRE_CHECK_FAILED`, `MCP_QUOTA_EXCEEDED`, `MCP_VALIDATED_HANDOFF_ENQUEUED`, `MCP_VALIDATION_DLQ`.
- Metadata: `workspace_id`, `job_id`, `variant_id`, `correlation_id`. KhÃ´ng log: body text, access_token, raw Graph API response.

**Idempotency**
- Job-level key (US-004): `publish.facebook.job:{workspace_id}:{post_id}:{approved_version}:{policy_version}` â†’ `publish_jobs.idempotency_key` UNIQUE.
- MCP validation key (US-005): `mcp.validate.facebook:{workspace_id}:{job_id}:{mcp_tool_version}` â†’ `publish_jobs.mcp_validation_idempotency_key` UNIQUE.
- Outbox key: `publish.facebook.validated:{workspace_id}:{job_id}` â†’ `mcp_validation_events.idempotency_key` UNIQUE.

**Queue Behavior**
- Consumer: `publish.facebook.requested`. DLQ: `publish.facebook.requested.dlq`.
- Output (pass): `publish.facebook.validated` via outbox relay. Output (fail/DLQ): `alerts.slack.send`.
- ACK: chá»‰ sau Ledger commit. NACK: transient errors (max 5 retries, backoff: 1s, 2s, 4s, 8s, 16s).

**Security Rules**
- `SET LOCAL app.current_workspace_id = :workspace_id` trong má»i tenant-scoped transaction.
- Normal worker khÃ´ng dÃ¹ng service role; DB connection rejects bypass markers.
- RLS vá»›i USING + WITH CHECK cho `publish_jobs`, `mcp_validation_events`, `content_variants`.
- **Token chá»‰ Ä‘Æ°á»£c Ä‘á»c trong `apps/facebook-mcp-server/`** tá»« secret store â€” khÃ´ng xuáº¥t hiá»‡n trong orchestrator, RabbitMQ payload, logs, audit metadata, Airtable, Slack.
- **Orchestrator khÃ´ng gá»i Facebook Graph API** trá»±c tiáº¿p.
- **`validate_post` khÃ´ng gá»i publish endpoint** (POST /feed); regression test báº¯t buá»™c.
- `mcp_validation_result` JSONB: chá»‰ sanitized summary (violation codes, quota numbers), khÃ´ng chá»©a raw API response.
- Fail closed: token invalid/expired/missing â†’ `validation_failed` ngay, khÃ´ng retry.

**Test Evidence**
- Required: MCP server unit tests má»—i violation code; worker integration tests (happy/fail/idempotency/ACK-after-commit); RLS tests; no-token tests; no-publish regression test; no-Graph-API-from-orchestrator boundary test.
- Phá»§ Ä‘á»§ MCP-001 Ä‘áº¿n MCP-016 trong US-005 Security Gate.

**Change History**
- 2026-05-20: Initial logic drafted (combined stub US-005/US-006 as FL-004).
- 2026-06-01: Fully detailed for US-005 scope only: separated from US-006 (publish_post execution). Added trigger, preconditions, processing logic (9 steps), error matrix, idempotency strategy (3 levels), queue behavior, security constraints, and audit events taxonomy. Aligned with US-004 handoff boundary (`publish_jobs` minimal schema from migration `0004`), US-005 implementation plan, and US-005 security release gate.

---

### FL-004b: Facebook MCP Publish Execution (US-006)

**Backlog Link:** US-006
**Owner:** MCP/Backend
**Status:** Implemented

**Trigger**
- Cron Scheduler (`McpPublishScheduler`) scans `publish_jobs` for `status='validated'` and `scheduled_at <= NOW()`.

**Input**
- `job_id`, `variant_id`, `channel_account_id`, `scheduled_at`, `idempotency_key` (references-only from `publish.facebook.execute` event).
- Ledger reload: `publish_jobs`, `content_variants`, `channel_account`.

**Processing Logic**
1. **Scheduler:** `McpPublishScheduler` queries due jobs, creates an outbox entry in `publish_execution_events`, and pushes `publish.facebook.execute` to RabbitMQ.
2. **Consumer:** `mcpPublishRabbitmqConsumer` reads the message and verifies schema.
3. **Worker:** `McpPublishWorker` loads job and locks it via DB transaction, changing status to `publishing`.
4. **MCP Tool Call:** Worker calls `publishPost` on Facebook MCP Server via the MCP Client.
5. **Graph API Execution:** MCP server uses `SecretStore` to resolve the token and calls `POST /{page_id}/feed`. Returns sanitized result.
6. **State Persistence:** 
   - On success: status `published`, `external_post_id` saved, `published_at` timestamp set.
   - On transient error (5xx, timeout): `publish_attempt_count` incremented, message requeued via NACK.
   - On permanent error (auth fail, permission): status `failed`, Slack alert dispatched.
7. **Airtable Compensation:** If the Ledger state is saved successfully but the Airtable PATCH fails, `airtable_sync_retry_needed` is set to true for future polling. Ledger is NOT rolled back.

**Output**
- `published` job with `external_post_id`; or `failed` job with sanitized error audit.

**Error Handling**
- Temporary network/API error: retry via RabbitMQ NACK with backoff.
- Permission/token error: fail closed, mark `failed`, alert Admin.
- Duplicate publish: idempotency check in scheduler ensures only one execute event is pushed. Idempotency check in worker ensures already `published` jobs are ACKed as no-op.

**Audit/Telemetry**
- `PUBLISH_STARTED`, `PUBLISH_SUCCEEDED`, `PUBLISH_FAILED`.
- `publish_execution_events` stores tracking of dispatched execute events.

**Security Rules**
- No raw token in logs, Slack, Airtable.
- Orchestrator never calls Graph API directly; uses Facebook MCP Server via tool.
- Only sanitized response summary stored in Ledger (no raw Graph API response).

**Test Evidence**
- Tested via `mcpPublishWorker.test.ts`, `mcpPublishRabbitmqConsumer.test.ts`, and `publishPost.test.ts`.

**Change History**
- 2026-05-20: Initial logic drafted (combined stub as FL-004).
- 2026-06-01: Separated from FL-004 (US-005); renamed FL-004b as US-006 stub placeholder.
- 2026-06-01: Implemented logic matching the scheduler architecture, decoupling validation from execution.

- 2026-05-21: Finalized US-003 design in T-013 with Ledger schema, idempotency, worker flow, context boundaries, prompt/versioning, structured validation, provider retry policy, Airtable compensation, policy outbox handoff, and mandatory security controls.
- 2026-06-01: Updated implementation logic to use RabbitMQ `ai.compose.facebook.requested` handoff from US-002, enforce references-only AI queue messages, ACK only after AI Ledger commit or confirmed DLQ write, persist prompt-injection hard failures as hash-only sanitized snapshots, and guard Airtable sync with a fresh status reload before PATCH.

### FL-003: Policy Engine Publish Guardrail

**Backlog Link:** US-004  
**Owner:** Backend/Security  
**Status:** Implemented

**Trigger**
- RabbitMQ message `policy.evaluate.requested` published by US-003 transactional outbox relay.
- Message arrives when `workflow_runs.status = 'ai_generation_completed'`, `content_variants.policy_status = 'pending_policy'`.

**Input**
- RabbitMQ message: `event_id`, `event_type = policy.evaluate.requested`, `workspace_id`, `workflow_run_id`, `ai_generation_run_id`, `content_variant_id`, `airtable_record_id`, `platform = 'facebook'`, `prompt_version`, `approved_version`, `idempotency_key`, `correlation_id`, `created_at`.
- Payload is references-only: no body text, hashtags, CTA, token, or credentials.
- Runtime context reloaded from Ledger: `content_variants`, `channel_account`, `token_reference`, workspace config (`auto_publish_enabled`, `auto_approve_enabled`), forbidden terms config.

**Preconditions**
- `content_variants.policy_status = 'pending_policy'` (idempotency guard).
- `content_variants.approval_status = 'needs_review'`.
- `workflow_runs.status = 'ai_generation_completed'`.
- No existing `publish_rule_results` row for the same `idempotency_key`.

**Processing Logic**
1. **Message Schema Validation (Consumer):** Validate message using Zod schema for `PolicyEvaluateRequestedEvent`. Invalid schema â†’ DLQ â†’ ACK original â†’ exit.
2. **Idempotency Check:** Query `publish_rule_results` by `idempotency_key`. If row exists â†’ ACK, no-op, exit. If `content_variants.policy_status != 'pending_policy'` â†’ ACK, log `policy_ineligible`, exit.
3. **Start Postgres Transaction:** `SET LOCAL app.current_workspace_id = :workspace_id`. Lock `content_variants` row; verify `policy_status = 'pending_policy'`. Transition `policy_status = 'policy_evaluating'`. COMMIT.
4. **Reload Context from Ledger:** Load `channel_account`, `token_reference`, workspace config, forbidden terms config.
5. **Run Policy Engine Rule Checks (pure functions, no I/O):**
   - `checkApprovalStatus(variant)` â†’ MISSING_APPROVAL blocker.
   - `checkChannelToken(channelAccount, tokenRef)` â†’ INVALID_CHANNEL_TOKEN blocker.
   - `checkChannelAccountActive(channelAccount)` â†’ CHANNEL_ACCOUNT_INACTIVE blocker.
   - `checkFacebookTextLength(variant)` â†’ PLATFORM_TEXT_CONSTRAINT_VIOLATED (limit: 63,206 chars).
   - `checkForbiddenTerms(variant, config)` â†’ FORBIDDEN_TERM_DETECTED (case-insensitive, body + hashtags).
   - `checkCtaUrl(variant, sourcePost)` â†’ MISSING_CTA_URL blocker; MISSING_UTM warning (configurable).
   - `checkAutoPublishConfig(workspaceConfig)` â†’ AUTO_PUBLISH_DISABLED / AUTO_APPROVE_DISABLED blocker.
   - `checkHashtagCount(variant)` â†’ HASHTAG_COUNT_HIGH warning (>10 hashtags).
   - `aggregateRuleResults(checks)` â†’ `{ allowed, blockers, warnings, checks }`.
6. **Persist Rule Result (Atomic Transaction):** INSERT `publish_rule_results`; UPDATE `content_variants.policy_status` (`policy_approved` or `policy_rejected`); UPDATE `workflow_runs.status` (`policy_evaluation_completed` or `policy_evaluation_blocked`); INSERT `audit_log`. If PASS AND auto_publish_enabled AND auto_approve_enabled: INSERT `publish_jobs` stub + `publish_handoff_events` outbox row. COMMIT.
7. **ACK RabbitMQ only after COMMIT.**
8. **Post-Commit Side Effects (async):** Outbox relay publishes `publish.facebook.requested`. If BLOCKED: PATCH Airtable `Needs Review` + blockers; publish `alerts.slack.send`. If Airtable PATCH fails: `airtable_sync_retry_needed = true` + compensating audit; do NOT rollback Ledger.

**Output**
- Pass: `publish_rule_results` (`allowed=true`), `publish_jobs` stub (`queued`), `publish_handoff_events` outbox, `policy_approved` variant status.
- Block: `publish_rule_results` (`allowed=false`, blockers/warnings), Airtable `Needs Review`, Slack alert, `policy_rejected` variant status.
- Ineligible: ACK, no state change, audit `policy_ineligible`.

**Error Handling**

| Case | Detection | Action | Ledger Status | RabbitMQ |
|:---|:---|:---|:---|:---|
| Pass (auto-publish enabled) | All checks pass + auto_publish_enabled | Insert publish_job + outbox, commit | `policy_approved` / `policy_evaluation_completed` | ACK after commit |
| Pass (manual) | All checks pass, auto_publish_enabled=false | Insert rule_result only, commit | `policy_approved` / `policy_evaluation_completed` | ACK after commit |
| Blocked | â‰¥1 blocker | Insert rule_result blocked, Airtable+Slack, commit | `policy_rejected` / `policy_evaluation_blocked` | ACK after commit |
| Duplicate event | `idempotency_key` exists | ACK, no-op | Unchanged | ACK |
| Ineligible (wrong status) | `policy_status != 'pending_policy'` | ACK, log `policy_ineligible` | Unchanged | ACK |
| Invalid message schema | Zod fail | DLQ + ACK original | N/A | DLQ + ACK |
| DB fail before commit | Transaction rollback | NACK/requeue | Unchanged | NACK |
| Airtable fail after commit | HTTP error | `airtable_sync_retry_needed=true` + compensating audit | Ledger committed | Already ACKed |
| Exhausted retries | retry_count > 5 | DLQ + admin Slack alert | `policy_evaluation_failed` | DLQ |

**Audit/Telemetry**
- `POLICY_CHECK_COMPLETED`: sau má»—i evaluation (pass/block).
- `POLICY_CHECK_BLOCKED`: khi `allowed=false`, kÃ¨m blocker codes.
- `POLICY_INELIGIBLE`: khi event khÃ´ng Ä‘á»§ Ä‘iá»u kiá»‡n.
- `PUBLISH_JOB_STUB_CREATED`: khi publish_jobs stub insert thÃ nh cÃ´ng.
- `PUBLISH_HANDOFF_ENQUEUED`: khi outbox relay publish thÃ nh cÃ´ng.
- `POLICY_AIRTABLE_SYNC_FAILED`: khi Airtable PATCH fail sau commit.
- Metadata: `workspace_id`, `correlation_id`, `content_variant_id`, `result_id`. KhÃ´ng log body text, token, forbidden term raw value.

**Idempotency**
- `POLICY_VERSION` constant: `'policy-facebook-v1'` exported tá»« `packages/policy-engine/src/version.ts` (Decision D-010). KhÃ´ng hardcode inline trong worker.
- Key formula (policy evaluation): `policy.evaluate.requested:{workspace_id}:{content_variant_id}:{POLICY_VERSION}`.
- Stored in: `publish_rule_results.idempotency_key` (UNIQUE constraint).
- Publish job key (Decision D-011): `publish.facebook.job:{workspace_id}:{post_id}:{approved_version}:{POLICY_VERSION}` â€” bao gá»“m policy version Ä‘á»ƒ trÃ¡nh false-positive dedup khi rule set thay Ä‘á»•i breaking.
- Outbox key: `publish.facebook.handoff:{workspace_id}:{job_id}`.

**Queue Behavior**
- Consumer: `policy.evaluate.requested`.
- DLQ: `policy.evaluate.requested.dlq`.
- Output (pass): `publish.facebook.requested` via outbox relay.
- Output (block): `alerts.slack.send`.
- ACK: chá»‰ sau Ledger commit. NACK: transient errors (max 5 retries, backoff: 1s, 2s, 4s, 8s, 16s).

**Security Constraints**
- `SET LOCAL app.current_workspace_id = :workspace_id` trong má»i tenant-scoped transaction.
- Normal worker khÃ´ng dÃ¹ng service role; DB connection rejects bypass markers.
- RLS vá»›i USING + WITH CHECK cho `publish_rule_results`, `publish_handoff_events`, `publish_jobs`.
- Policy Engine (`packages/policy-engine`) lÃ  pure functions, khÃ´ng gá»i platform API.
- `PublishFacebookRequestedEvent`: references-only, khÃ´ng chá»©a body/token/secret.
- Logs/audit khÃ´ng chá»©a raw token, forbidden term raw value, hoáº·c provider credentials.
- `checkForbiddenTerms`: NFC normalize + lowercase trÆ°á»›c compare; khÃ´ng log raw matched term.
- `POLICY_BLOCK_SLACK_CHANNEL_ID` thiáº¿u: graceful degradation â€” Ledger vÃ  Airtable váº«n commit, táº¡o audit `alert_pending_config`, khÃ´ng fail policy transaction (Decision D-014).
- Fail closed: token status khÃ´ng xÃ¡c Ä‘á»‹nh â†’ block.

**Test Evidence**
- Required: unit tests cho má»—i rule function; integration tests happy/block/idempotency/ACK-after-commit; contract tests; RLS tests. Phá»§ Ä‘á»§ POL-001 Ä‘áº¿n POL-015 trong US-004 Security Gate.

**Change History**
- 2026-05-20: Initial logic drafted (stub).
- 2026-06-01: Fully detailed with processing logic, error matrix, preconditions, idempotency, queue behavior, security constraints, and audit events taxonomy. Aligned with US-003 handoff boundary spec (`US-003-policy-handoff-boundary.md`) and US-004 implementation plan.
- 2026-06-01 (P0/P1 decisions): Updated idempotency keys (publish job key now includes `POLICY_VERSION` per D-011); added `POLICY_VERSION` constant source (`version.ts`, D-010); updated security constraints with forbidden terms no-log rule and Slack graceful degradation (D-014); updated RLS scope to include `publish_jobs` (D-012).
- 2026-06-01: Implemented US-004 policy engine package, references-only contracts, Postgres migration `0004_us004_policy_publish_guardrail.sql`, PolicyWorker, RabbitMQ consumer, publish/slack queue publishers, Airtable Needs Review sync, compensation path, and release-gate tests. `npm run build` passed; `npm test` passed with 154 tests.

1. Verify Slack signature and timestamp.
2. Parse command and args.
3. Map Slack user to workspace role.
4. Validate permission.
5. Execute action via middleware/MCP.
6. Update Airtable/Ledger.
7. Return Slack response.

**Output**
- Command result and audit log.

**Error Handling**
- Invalid signature: reject.
- Missing permission: reject.
- MCP failure: show actionable error.

**Audit/Telemetry**
- `SLACK_COMMAND_RECEIVED`, `SLACK_COMMAND_REJECTED`, `SLACK_COMMAND_SUCCEEDED`.

**Security Rules**
- Never trust Slack user id without role mapping.
- Reject stale signed requests.

**Test Evidence**
- Pending.

**Change History**
- 2026-05-20: Initial logic drafted.


### FL-005: Facebook Comment Sync

**Backlog Link:** US-007  
**Owner:** MCP/Backend  
**Status:** Implemented

**Trigger**
- `CommentSyncScheduler` triggers every 5 minutes and pushes `comments.facebook.sync.requested` to RabbitMQ for jobs matching criteria.

**Input**
- `job_id`, `external_post_id`, `channel_account_id`.
- Ledger context: `channel_accounts`, `publish_jobs`, `interactions`, `messages`.

**Processing Logic**
1. **Request Consumer:** consumes `comments.facebook.sync.requested`, resolves `secretRef` using `channel_account_id`.
2. **MCP Call:** Calls `syncComments` tool on Facebook MCP server with `externalPostId` and `secretRef`.
3. **Ingest Push:** For each comment, pushes `comments.facebook.ingest` to RabbitMQ.
4. **Worker (FacebookCommentSyncWorker):**
   - Consumes `comments.facebook.ingest`.
   - Checks duplicate using `external_comment_id`.
   - Upserts `interactions` and `messages` (idempotent).
   - Classifies risk (`CommentRiskClassifier`).
   - If CRISIS, pushes `alerts.slack.send` via Publisher.
   - Commits to Ledger and ACKs.

**Output**
- New comments stored in `messages` and `interactions`.
- Slack alerts for crisis comments.

**Error Handling**
- MCP Error: DLQ or retry.
- Missing Channel Account: DLQ.

**Audit/Telemetry**
- `FACEBOOK_COMMENT_SYNCED`, `FACEBOOK_COMMENT_SYNC_FAILED`.

**Security Rules**
- No tokens in queue. Orchestrator fetches `secretRef` and passes it to MCP; MCP resolves token securely.

**Change History**
- 2026-06-02: Implemented for US-007.

### FL-006: Slack Command Handler

**Backlog Link:** US-007  
**Owner:** Backend/Platform  
**Status:** Active

**Trigger**
- Slack Slash Command HTTP POST (Verified via signing secret).

**Processing Logic**
1. Verify Slack signature and timestamp.
2. Parse command and args.
3. Map Slack user to workspace role.
4. Validate permission.
5. Execute action via middleware/MCP.
6. Update Airtable/Ledger.
7. Return Slack response.

**Output**
- Command result and audit log.

**Error Handling**
- Invalid signature: reject.
- Missing permission: reject.
- MCP failure: show actionable error.

**Audit/Telemetry**
- `SLACK_COMMAND_RECEIVED`, `SLACK_COMMAND_REJECTED`, `SLACK_COMMAND_SUCCEEDED`.

**Security Rules**
- Never trust Slack user id without role mapping.
- Reject stale signed requests.

**Test Evidence**
- Pending.

**Change History**
- 2026-05-20: Initial logic drafted.

### FL-007: Notion Campaign Brief Context Loader

**Backlog Link:** US-013  
**Owner:** Orchestration/BA  
**Status:** Designed (Ready for Implementation)

**Trigger**
- AI Composer starts for an Approved Post with `Notion Brief URL`.

**Input**
- `notion_page_id` or `notion_brief_url`, campaign id, configured guideline page ids.

**Processing Logic**
1. Resolve Notion page id from Airtable Campaign field.
2. Fetch allowed Notion page content or use manually exported context in MVP.
3. Extract brief summary, brand voice, do/avoid terms, legal notes.
4. Store context reference, not full sensitive raw content if not needed.
5. Pass normalized context into AI prompt builder.

**Output**
- Normalized context object for AI Composer.

**Error Handling**
- SSRF/not allowlisted URL: hard fail AI run with `failed`, set parent workflow to `ai_generation_failed`, and do not silently fallback.
- Notion 404/API unavailable/permission error: fallback to `campaign_objective` if configured and persist sanitized fallback context reference.

**Audit/Telemetry**
- `NOTION_CONTEXT_LOADED`, `NOTION_CONTEXT_LOAD_FAILED`.

**Security Rules**
- Never read arbitrary Notion workspace pages.
- Only configured pages linked from Airtable Campaign are allowed.
- No secrets/tokens in Notion.

**Test Evidence**
- Pending.

**Change History**
- 2026-05-20: Initial logic drafted.


### FL-008: RabbitMQ Event Bus Processing

**Backlog Link:** US-014  
**Owner:** Backend/Platform  
**Status:** Designed (Ready for Implementation)

**Trigger**
- Orchestrator produces async event. Existing functions emitting events: FL-001, FL-003, FL-004b, FL-005, FL-014.

**Input**
- Payload (Reference-Only): `event_id`, `type`, `workspace_id`, `idempotency_key`, `correlation_id`, `causation_id`, reference fields.
- Properties: `content_type=application/json`, `delivery_mode=2`.

**Processing Logic**
1. **Producer Side:** Publish with `ConfirmChannel`. Validate schema (no token). 
2. **Broker Routing:** 
   - New standard: use canonical topic exchange `mediaops.events.topic`.
   - Legacy compatibility: Keep existing direct exchanges/queues for backward compatibility without breaking existing US-006->013 flows.
3. **Consumer Side (amqplib):** 
   - Config-driven topology registration for wiring (exchange, queue, routingKey, dlq, prefetch, retry TTL). Does not mutate business logic.
   - Enforce idempotency guard before executing worker logic.
4. **Error Handling & Retry:** 
   - Implement retry through RabbitMQ TTL retry queues + DLQ (Slack command consumer pattern).
   - Per-queue DLQ (e.g., `publish.facebook.execute.dlq`).
5. **ACK Policy:**
   - ACK original message ONLY after Ledger commit AND after any retry/DLQ publish confirms.

**Output**
- Updated Ledger state, or messages routed to DLQ.

**Error Handling**
- Temporary error: TTL retry queue.
- Permanent error/exhausted: Publish to DLQ via ConfirmChannel, then ACK original message.

**Audit/Telemetry**
- `QUEUE_EVENT_PUBLISHED`, `QUEUE_EVENT_CONSUMED`, `QUEUE_EVENT_RETRIED`, `QUEUE_EVENT_DLQ`.

**Security Rules**
- RabbitMQ payload must be reference-only, ZERO tokens.
- Idempotency check mandatory.

**Change History**
- 2026-05-20: Initial logic drafted.
- 2026-06-03: Designed for US-014 (amqplib, canonical topic + legacy compatibility, per-queue DLQ, config-driven registration).

### FL-014: Unified Direct Message Ingestion and Reply

**Backlog Link:** US-015  
**Owner:** MCP/Backend/Support  
**Status:** Implemented

**Trigger**
- Platform MCP receives inbound direct message webhook or polling result.
- Support or admin user executes Slack slash command `/reply_dm`.

**Input**
- Webhook Payload / Ingest Event: `event_id`, `event_type = dm.facebook.ingest`, `workspace_id`, `idempotency_key`, `correlation_id`, reference payload containing `platform`, `channel_account_id`, `external_thread_id`, `external_message_id`, `customer_ref`, `body_preview`, `created_at_platform`, `has_attachments`.
- Slack command input: `/reply_dm <conversation_id> <message>`.

**Processing Logic**
1. **Ingestion (Inbound DM):**
   - MCP validates origin/signature of source webhook and publishes references-only event to `dm.facebook.ingest`.
   - Consumer validates payload schema via `DirectMessageIngestEventSchema`. Invalid payload -> DLQ -> ACK.
   - Enforce idempotency via `checkIdempotency()`. If duplicate -> ignore, audit `DM_DUPLICATE_IGNORED`, ACK.
   - Start transaction: `SET LOCAL app.current_workspace_id = :workspace_id`.
   - Call MCP tool `get_direct_message` by reference to reload message details securely (no tokens in middleware). **Note:** This tool must be implemented in the Facebook MCP server as part of US-015, querying by `channel_account_id` and `external_message_id`/`external_thread_id`. For mock/testing environments, it must return deterministic mock message bodies.
   - Upsert `conversations` thread: lookup by `(workspace_id, platform, external_thread_id)`. If new, set `status='new'` and `sla_due_at = NOW() + DM_SLA_HOURS` (fallback to 2 hours). If thread exists, update `last_message_at` and change status to `new` (if resolved).
   - Insert message in `conversation_messages` with plaintext body.
   - Audit event `DM_INGESTED`.
   - Publish references-only notification to Slack inbox channel (shows sender name and `body_preview` max 80 chars, no tokens, no full message body).
   - Commit ledger transaction and ACK message from queue.

2. **Replying (Outbound DM):**
   - Slash command receiver verifies Slack signature and timestamp.
   - Map Slack user ID to `workspace_members` role. Allow only `support`, `manager`, `admin`; reject `creator`/`viewer`.
   - Create record in `direct_message_reply_jobs` (status `received`) and publish `dm.reply.requested` to RabbitMQ.
   - Reply Worker claims job in transaction, transitions status to `processing`.
   - Calls MCP tool `send_direct_message` passing `channel_account_id`, `external_thread_id`, and `reply_body`.
   - MCP resolves channel account token from server-side vault and makes Graph API post.
   - On success: update job status to `succeeded`, insert message in `conversation_messages` (direction `outbound`, sender `agent`), update conversation status to `waiting`.
   - Audit event `DM_REPLY_SUCCEEDED`.
   - ACK message from queue.

**Output**
- Conversations, conversation messages, and reply jobs updated in database Ledger.
- Outbound message sent on target social platform.
- Audits and Slack confirmation.

**Error Handling & Ingestion Matrix**

| Case | Detection | Action | Ledger Status | Retry? |
|:---|:---|:---|:---|:---|
| Valid Ingress message | New external_message_id | Upsert conversation, insert message, alert, ACK | `DM_INGESTED` | No |
| Duplicate message | Idempotency guard duplicate key | Skip worker execution, log ignore, ACK | `DM_DUPLICATE_IGNORED` | No |
| Malformed event payload | Zod schema validation fail | Route straight to DLQ, ACK | `DM_INGEST_FAILED` | DLQ |
| Platform error on reply | Graph API error / OAuth exception | Update job `failed` with code, alert Slack Admin, ACK | `DM_REPLY_FAILED` | No |
| Database transaction fail | Postgres connection timeout | NACK (re-enqueue with backoff, max 5) | Unchanged | Yes |

**Audit/Telemetry**
- Events: `DM_RECEIVED`, `DM_INGESTED`, `DM_DUPLICATE_IGNORED`, `DM_INGEST_FAILED`, `DM_REPLY_QUEUED`, `DM_REPLY_SUCCEEDED`, `DM_REPLY_FAILED`.
- Sanitized metadata via `AuditLogRepository`, no raw tokens or secrets.

**Security Rules**
- RLS enabled on all DM tables. Transactions must set `app.current_workspace_id`.
- Zero token policy. Token references only in database, token resolution strictly in MCP server.
- No full message body in Slack notifications, Airtable, or Notion (redact/preview max 80 chars).
- **FK Assignment Tenant Guard:** Any thread assignment action must strictly validate that the assigned member belongs to the same workspace (`WHERE id = :assigned_to_member_id AND workspace_id = :workspace_id`) in the repository/service layer to prevent cross-workspace leaks.

**Test Evidence**
- Planned tests: Zod contract checks, RLS workspace separation tests, mock consumer idempotency, worker ACK after commit, role-based command authorization, reply execution boundary validation.

**Change History**
- 2026-05-20: Initial logic drafted (Draft).
- 2026-06-03: Designed and promoted to Designed status (Facebook MVP chot generic/mock MCP, SLA env-driven, separate reply_dm command, and workspace-scoped composite uniqueness/RLS).

---

### FL-009: Slack Approve/Reject Post Slash Command

**Backlog Link:** US-008
**Owner:** Backend/Orchestration
**Status:** Implemented

**Trigger**
- User types `/approve_post <post_id>` or `/reject_post <post_id> <reason>` in Slack.
- Slack sends an HTTP POST request to `/api/v1/slack/commands`.

**Input**
- `application/x-www-form-urlencoded` body containing `command`, `text`, `user_id`, `team_id`.
- Headers: `X-Slack-Signature`, `X-Slack-Request-Timestamp`.

**Processing Logic**
1. **Webhook Receiver (Route):**
   - Read body raw to verify `X-Slack-Signature` using `HMAC-SHA256` in constant time against `SLACK_SIGNING_SECRET`.
   - Reject if signature is invalid or timestamp is older than 5 minutes.
   - Parse `command` and `text` to extract `action` (`approve` or `reject`), `postId`, and optional `reason`.
   - Reject invalid commands, missing post id, or missing reject reason with a safe ephemeral response.
   - Calculate an idempotency key from workspace, Slack user, command, text, and Slack timestamp.
   - Insert or reuse `slack_command_events` row.
   - Look up user role in `workspace_members`; only `manager` and `admin` may approve/reject.
   - Update event status to `queued`.
   - Respond immediately with HTTP 200 ephemeral message.
   - Publish references-only event `slack.post_approval.requested` to RabbitMQ.

2. **Worker (SlackPostApprovalWorker):**
   - Consume message from RabbitMQ.
   - Fetch event from `slack_command_events`.
   - Fetch target post from Airtable.
   - Verify current post state is valid for approval/rejection.
   - If approve: update Airtable post status to `Approved`.
   - If reject: update Airtable post status/review fields with the sanitized reason.
   - Update related workflow state where available.
   - Update `slack_command_events` status to `succeeded` or `failed`.
   - Write audit log.
   - ACK only after Ledger state is committed.

**Output**
- Fast ephemeral Slack response.
- Updated Airtable post approval/rejection state.
- `slack_command_events` and audit rows in Ledger.

**Error Handling**
- Invalid signature or stale timestamp -> safe rejection response, audit, no side effect.
- Invalid command or missing arguments -> safe usage response, audit, no side effect.
- Unauthorized user -> safe rejection response, audit, no side effect.
- Airtable transient failure -> retry/backoff per queue policy.
- Post not found or invalid state -> mark failed, audit, ACK.

**Audit/Telemetry**
- `SLACK_SIGNATURE_REJECTED`
- `SLACK_COMMAND_DUPLICATE_IGNORED`
- `SLACK_COMMAND_REJECTED`
- `SLACK_COMMAND_RECEIVED`
- `SLACK_COMMAND_SUCCEEDED`
- `SLACK_COMMAND_FAILED`

**Security Rules**
- Requires `SLACK_SIGNING_SECRET`.
- Enforces replay protection.
- Requires role mapping from `workspace_members`; Slack user id is not trusted as authorization.
- Queue payload is reference-only and must not contain raw token, signing secret, Airtable key, or reject reason.

**Test Evidence**
- See `slackSignatureVerifier.test.ts`, `slackCommandParser.test.ts`, `slackCommandsRoute.test.ts`, `slackPostApprovalWorker.test.ts`, and shared Slack command contract tests.

**Change History**
- 2026-06-02: Implemented for US-008.
- 2026-06-29: Deduplicated Function Flow Register and narrowed US-008 to Slack approve/reject post only.

### FL-010: Slack Reply/Escalate Comment Slash Command

**Backlog Link:** US-009
**Owner:** Backend/Orchestration
**Status:** Implemented

**Trigger**
- User types `/reply_comment <interaction_id> <message>` or `/escalate <interaction_id> [reason]` in Slack.
- Slack sends an HTTP POST request to `/api/v1/slack/commands`.

**Input**
- `application/x-www-form-urlencoded` body containing `command`, `text`, `user_id`, `team_id`.
- Headers: `X-Slack-Signature`, `X-Slack-Request-Timestamp`.

**Processing Logic**
1. **Webhook Receiver (Route):**
   - Reuses US-008 signature verification.
   - Parses `command` and `text` to extract `action`, `interactionId`, and `message` or `reason`.
   - Checks idempotency against `comment_action_events`.
   - Inserts received event into `comment_action_events`.
   - Looks up user role in `workspace_members`; role must be `support`, `manager`, or `admin`.
   - Updates event status to `queued`.
   - Publishes `slack.comment_action.requested` to RabbitMQ.
   - Responds with ephemeral HTTP 200 message.

2. **Worker (SlackCommentActionWorker):**
   - Consumes message from RabbitMQ.
   - Fetches event from `comment_action_events`.
   - Fetches interaction from `interactions`.
   - For reply: resolves channel context by interaction and calls Facebook MCP `replyComment`.
   - For escalate: updates interaction status to `escalated` and publishes Slack alert after Ledger commit.
   - Commits updates to Ledger and ACKs RabbitMQ message.

**Output**
- Reply posted to Facebook through MCP or escalation alert sent to Slack.
- Updated interaction and audit state in Ledger.

**Error Handling**
- MCP failure -> retry or mark failed according to error type.
- Interaction not found -> ACK and mark failed.

**Audit/Telemetry**
- `SLACK_COMMENT_ACTION_SUCCEEDED`
- `SLACK_COMMENT_ACTION_FAILED`

**Security Rules**
- Reuses US-008 Slack signature verification.
- Enforces role mapping (`support`, `manager`, `admin`).
- Token resolution happens exclusively inside MCP Server.

**Change History**
- 2026-06-02: Implemented for US-009.
- 2026-06-29: Deduplicated Function Flow Register.

### FL-011: Operational Ledger & Audit Log Hardening

**Backlog Link:** US-010
**Owner:** Backend/Platform
**Status:** Implemented

**Trigger**
- Any worker, route, or subsystem calls `AuditLogRepository.insertAuditLog`.

**Input**
- `workspaceId`, `eventType`, `entityType`, `entityId`, `actorType`, `actorId`, `correlationId`, `causationId`, `idempotencyKey`, `severity`, `metadata`.

**Processing Logic**
1. Pass `metadata` through `auditRedactor.sanitizeAuditMetadata`.
2. Recursive redactor strips forbidden keys from nested objects/arrays and replaces values with `[REDACTED]`.
3. Insert into `audit_logs` using canonical schema fields.
4. Conflict resolution on `(workspace_id, idempotency_key)` ignores duplicate inserts safely.

**Output**
- A hardened, redacted, append-only row in `audit_logs`.

**Error Handling**
- Duplicate idempotency key -> gracefully ignored.
- Missing required fields -> DB constraint error.

**Audit/Telemetry**
- The insert operation itself is the audit/telemetry.

**Security Rules**
- RLS enforces `workspace_id` isolation.
- Append-only trigger blocks `UPDATE` and `DELETE`.
- Redactor prevents raw token persistence.

**Change History**
- 2026-06-02: Implemented schema migration, redactor utility, and shared repository for US-010.
- 2026-06-29: Deduplicated Function Flow Register.

### FL-012: Admin Facebook Page Configuration

**Backlog Link:** US-011
**Owner:** Backend/Orchestration
**Status:** Implemented

**Trigger**
- Admin calls `/api/v1/admin/facebook/*` routes to authorize, connect, health-check, or disconnect Facebook Pages.

**Input**
- Admin request with `x-user-id` mapped to an admin role.
- For connect: page id and OAuth session reference.
- For health-check/disconnect: channel account id.

**Processing Logic**
1. Validate feature flag and admin role.
2. Relay OAuth/page operations to `facebook-mcp-server` tools.
3. Persist channel account metadata and token references without exposing raw tokens.
4. Audit all administrative actions with sanitized metadata.
5. Sync safe status fields back to Airtable where configured.

**Output**
- Standard JSON responses with safe channel account records.

**Error Handling**
- Missing admin role -> 403 Forbidden.
- Feature disabled -> 404 Not Found.
- Meta/MCP errors -> clean response without raw token data.

**Audit/Telemetry**
- `FACEBOOK_PAGE_OAUTH_STARTED`
- `FACEBOOK_PAGE_CONNECTED`
- `FACEBOOK_PAGE_DISCONNECTED`
- `FACEBOOK_PAGE_AIRTABLE_SYNC_FAILED`

**Security Rules**
- Never send app secret or raw token back to the Orchestrator or Admin client.
- Store and pass token references only.

**Change History**
- 2026-06-02: Implemented for US-011.
- 2026-06-29: Deduplicated Function Flow Register.

### FL-017: TikTok Publish via MCP

**Backlog Link:** US-017
**Owner:** Backend / MCP
**Status:** Draft (Pending OQ-017 resolutions)

**Trigger**
- Policy engine approves TikTok variant -> enqueues `publish.tiktok.requested`.
- Execution scheduler emits `publish.tiktok.execute` for a validated job.
- Async polling loop emits `publish.tiktok.status_check`.

**Input**
- RabbitMQ payload containing reference-only `job_id`, `variant_id`, `channel_account_id`.
- Media derivatives generated by US-016.

**Processing Logic**
1. **Validation:** `TiktokValidationWorker` calls TikTok MCP `validate_tiktok_post` with US-016 media references and variant details. Checks platform constraints (e.g. text length, photo vs video count).
2. **Execution:** `TiktokPublishWorker` calls MCP `publish_tiktok_post`. Updates job to `pending_platform_status` and emits `publish.tiktok.status_check` for async polling.
3. **Status Polling:** `TiktokStatusWorker` consumes `status_check` event, calls MCP `get_tiktok_publish_status`.
   - If still processing: requeues `status_check` with delay via RabbitMQ TTL.
   - If success: updates job status to `published`.
   - If failed: updates job to `failed` and alerts Slack.

**Output**
- TikTok publish job transitioning from `queued` -> `validated` -> `pending_platform_status` -> `published` / `failed`.
- Slack alerts for failures.

**Error Handling**
- TikTok validation fail: Mark job `validation_failed`, alert Slack.
- Transient API error: Requeue with backoff (RabbitMQ NACK).
- TikTok publish rejection (permanent): Mark job `failed`, alert Slack.
- Dead letter queue (DLQ) for poison messages on all queues.

**Audit/Telemetry**
- `TIKTOK_VALIDATION_COMPLETED`
- `TIKTOK_VALIDATION_FAILED`
- `TIKTOK_PUBLISH_STARTED`
- `TIKTOK_PUBLISH_STATUS_PENDING`
- `TIKTOK_PUBLISH_SUCCEEDED`
- `TIKTOK_PUBLISH_FAILED`

**Security Rules**
- No TikTok API calls directly from Orchestrator.
- No tokens, signed URL query secrets, or binary media in RabbitMQ payloads or Slack messages.
- Token resolution handled internally inside the TikTok MCP Server.
- RLS scoping by `workspace_id` for all job and log queries.

**Dependencies**
- Requires US-016 optimized media derivatives in Cloudflare R2 (`tiktok_video` or `tiktok_photo`).

**Change History**
- 2026-07-01: Initial logic drafted for US-017 planning phase.
