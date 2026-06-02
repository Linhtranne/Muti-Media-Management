# Function Flow & Logic Register

File này là nguồn ghi lại toàn bộ luồng và logic của từng chức năng. Mỗi lần code hoặc đổi logic, developer phải cập nhật section tương ứng trước khi PR được merge.

## Quy tắc cập nhật

- Mỗi function/module có một mã `FL-xxx`.
- Ghi rõ trigger, input, processing steps, output, error handling, audit, test evidence.
- Nếu logic thay đổi, thêm entry mới vào `Change History`, không xóa lịch sử cũ.

## Template cho mỗi chức năng

```md
### FL-xxx: [Tên chức năng]

**Backlog Link:** US-xxx
**Owner:** [Tên/Role]
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

### FL-004: Facebook MCP Validate và Enqueue Publish Job

**Backlog Link:** US-005
**Owner:** MCP/Backend
**Status:** Designed (Ready for Implementation — pending OQ-005-3, OQ-005-4 resolution)

**Trigger**
- RabbitMQ message `publish.facebook.requested` published bởi US-004 transactional outbox relay (`publish_handoff_events`).
- Message arrives khi `publish_jobs.status = 'queued'`, `content_variants.policy_status = 'policy_approved'`, `workflow_runs.status = 'policy_evaluation_completed'`.

**Input**
- RabbitMQ message: `event_id`, `event_type = publish.facebook.requested`, `workspace_id`, `workflow_run_id`, `job_id`, `variant_id`, `channel_account_id`, `scheduled_at`, `idempotency_key`, `correlation_id`, `created_at`.
- Payload là references-only: không chứa body, hashtags, cta_url, token, bearer, secret.
- Ledger reload: `publish_jobs`, `content_variants`, `channel_account`, `token_reference` (metadata: `secret_ref`, `token_status`, `expires_at`, `scopes`).

**Preconditions**
- `publish_jobs.status = 'queued'` (idempotency guard).
- `content_variants.policy_status = 'policy_approved'`.
- `workflow_runs.status = 'policy_evaluation_completed'`.
- `publish_jobs.mcp_validation_idempotency_key` không tồn tại (US-005-level dedup).

**Processing Logic**
1. **Message Schema Validation (Consumer):** Validate message bằng Zod schema `PublishFacebookRequestedEvent`. Invalid → DLQ → ACK original → exit.
2. **Idempotency Check:** Query `publish_jobs` by `job_id`. status `validated`/`publishing`/`published` → ACK, log `already_advanced`, exit. status `validation_failed` → ACK, log `already_failed`, exit. `mcp_validation_idempotency_key` exists → ACK, no-op, exit.
3. **Start Postgres Transaction:** `SET LOCAL app.current_workspace_id = :workspace_id`. Reload context. Transition `publish_jobs.status = 'mcp_validating'`. COMMIT.
4. **Token Pre-check (fast-fail):** Verify `token_reference.token_status = 'active'` AND `expires_at > NOW() + buffer`. Fail → `validation_failed` + Slack alert Admin → ACK → exit.
5. **Call MCP tool `get_rate_limit_status`** via MCP client → Facebook MCP Server. MCP server đọc token từ secret store (chỉ trong MCP server process). Return sanitized `RateLimitStatusResult`. `quotaExceeded = true` → `validation_failed` + Slack → ACK → exit.
6. **Call MCP tool `validate_post`** via MCP client → Facebook MCP Server. MCP server đọc token, apply FB validation rules, return sanitized `ValidatePostResult` (NO raw API response, NO token). violations present → `validation_failed` + Slack → ACK → exit.
7. **Persist Result (Atomic Transaction):** UPDATE `publish_jobs` (`status = 'validated'`, `mcp_validation_result`, `validated_at`, `mcp_validation_idempotency_key`). UPDATE `workflow_runs` (`status = 'mcp_validation_completed'`). INSERT `audit_log` (`MCP_VALIDATION_COMPLETED`). INSERT `mcp_validation_events` outbox. COMMIT.
8. **ACK RabbitMQ chỉ sau COMMIT.**
9. **Post-Commit:** Outbox relay publishes `publish.facebook.validated` → RabbitMQ (for US-006).

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
| Transient MCP/network error | Timeout / 5xx | NACK → requeue (max 5 retries) | `mcp_validating` | NACK |
| Duplicate event | status already advanced | ACK, no-op | Unchanged | ACK |
| Schema invalid | Zod fail | DLQ + ACK original | N/A | DLQ + ACK |
| DB fail before commit | Transaction error | NACK/requeue | Unchanged | NACK |
| Exhausted retries | retry_count > 5 | DLQ + admin Slack | `validation_failed` | DLQ |

**Audit/Telemetry**
- `MCP_VALIDATION_STARTED`, `MCP_VALIDATION_COMPLETED`, `MCP_VALIDATION_FAILED`, `MCP_VALIDATION_INELIGIBLE`, `MCP_TOKEN_PRE_CHECK_FAILED`, `MCP_QUOTA_EXCEEDED`, `MCP_VALIDATED_HANDOFF_ENQUEUED`, `MCP_VALIDATION_DLQ`.
- Metadata: `workspace_id`, `job_id`, `variant_id`, `correlation_id`. Không log: body text, access_token, raw Graph API response.

**Idempotency**
- Job-level key (US-004): `publish.facebook.job:{workspace_id}:{post_id}:{approved_version}:{policy_version}` → `publish_jobs.idempotency_key` UNIQUE.
- MCP validation key (US-005): `mcp.validate.facebook:{workspace_id}:{job_id}:{mcp_tool_version}` → `publish_jobs.mcp_validation_idempotency_key` UNIQUE.
- Outbox key: `publish.facebook.validated:{workspace_id}:{job_id}` → `mcp_validation_events.idempotency_key` UNIQUE.

**Queue Behavior**
- Consumer: `publish.facebook.requested`. DLQ: `publish.facebook.requested.dlq`.
- Output (pass): `publish.facebook.validated` via outbox relay. Output (fail/DLQ): `alerts.slack.send`.
- ACK: chỉ sau Ledger commit. NACK: transient errors (max 5 retries, backoff: 1s, 2s, 4s, 8s, 16s).

**Security Rules**
- `SET LOCAL app.current_workspace_id = :workspace_id` trong mọi tenant-scoped transaction.
- Normal worker không dùng service role; DB connection rejects bypass markers.
- RLS với USING + WITH CHECK cho `publish_jobs`, `mcp_validation_events`, `content_variants`.
- **Token chỉ được đọc trong `apps/facebook-mcp-server/`** từ secret store — không xuất hiện trong orchestrator, RabbitMQ payload, logs, audit metadata, Airtable, Slack.
- **Orchestrator không gọi Facebook Graph API** trực tiếp.
- **`validate_post` không gọi publish endpoint** (POST /feed); regression test bắt buộc.
- `mcp_validation_result` JSONB: chỉ sanitized summary (violation codes, quota numbers), không chứa raw API response.
- Fail closed: token invalid/expired/missing → `validation_failed` ngay, không retry.

**Test Evidence**
- Required: MCP server unit tests mỗi violation code; worker integration tests (happy/fail/idempotency/ACK-after-commit); RLS tests; no-token tests; no-publish regression test; no-Graph-API-from-orchestrator boundary test.
- Phủ đủ MCP-001 đến MCP-016 trong US-005 Security Gate.

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
1. **Message Schema Validation (Consumer):** Validate message using Zod schema for `PolicyEvaluateRequestedEvent`. Invalid schema → DLQ → ACK original → exit.
2. **Idempotency Check:** Query `publish_rule_results` by `idempotency_key`. If row exists → ACK, no-op, exit. If `content_variants.policy_status != 'pending_policy'` → ACK, log `policy_ineligible`, exit.
3. **Start Postgres Transaction:** `SET LOCAL app.current_workspace_id = :workspace_id`. Lock `content_variants` row; verify `policy_status = 'pending_policy'`. Transition `policy_status = 'policy_evaluating'`. COMMIT.
4. **Reload Context from Ledger:** Load `channel_account`, `token_reference`, workspace config, forbidden terms config.
5. **Run Policy Engine Rule Checks (pure functions, no I/O):**
   - `checkApprovalStatus(variant)` → MISSING_APPROVAL blocker.
   - `checkChannelToken(channelAccount, tokenRef)` → INVALID_CHANNEL_TOKEN blocker.
   - `checkChannelAccountActive(channelAccount)` → CHANNEL_ACCOUNT_INACTIVE blocker.
   - `checkFacebookTextLength(variant)` → PLATFORM_TEXT_CONSTRAINT_VIOLATED (limit: 63,206 chars).
   - `checkForbiddenTerms(variant, config)` → FORBIDDEN_TERM_DETECTED (case-insensitive, body + hashtags).
   - `checkCtaUrl(variant, sourcePost)` → MISSING_CTA_URL blocker; MISSING_UTM warning (configurable).
   - `checkAutoPublishConfig(workspaceConfig)` → AUTO_PUBLISH_DISABLED / AUTO_APPROVE_DISABLED blocker.
   - `checkHashtagCount(variant)` → HASHTAG_COUNT_HIGH warning (>10 hashtags).
   - `aggregateRuleResults(checks)` → `{ allowed, blockers, warnings, checks }`.
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
| Blocked | ≥1 blocker | Insert rule_result blocked, Airtable+Slack, commit | `policy_rejected` / `policy_evaluation_blocked` | ACK after commit |
| Duplicate event | `idempotency_key` exists | ACK, no-op | Unchanged | ACK |
| Ineligible (wrong status) | `policy_status != 'pending_policy'` | ACK, log `policy_ineligible` | Unchanged | ACK |
| Invalid message schema | Zod fail | DLQ + ACK original | N/A | DLQ + ACK |
| DB fail before commit | Transaction rollback | NACK/requeue | Unchanged | NACK |
| Airtable fail after commit | HTTP error | `airtable_sync_retry_needed=true` + compensating audit | Ledger committed | Already ACKed |
| Exhausted retries | retry_count > 5 | DLQ + admin Slack alert | `policy_evaluation_failed` | DLQ |

**Audit/Telemetry**
- `POLICY_CHECK_COMPLETED`: sau mỗi evaluation (pass/block).
- `POLICY_CHECK_BLOCKED`: khi `allowed=false`, kèm blocker codes.
- `POLICY_INELIGIBLE`: khi event không đủ điều kiện.
- `PUBLISH_JOB_STUB_CREATED`: khi publish_jobs stub insert thành công.
- `PUBLISH_HANDOFF_ENQUEUED`: khi outbox relay publish thành công.
- `POLICY_AIRTABLE_SYNC_FAILED`: khi Airtable PATCH fail sau commit.
- Metadata: `workspace_id`, `correlation_id`, `content_variant_id`, `result_id`. Không log body text, token, forbidden term raw value.

**Idempotency**
- `POLICY_VERSION` constant: `'policy-facebook-v1'` exported từ `packages/policy-engine/src/version.ts` (Decision D-010). Không hardcode inline trong worker.
- Key formula (policy evaluation): `policy.evaluate.requested:{workspace_id}:{content_variant_id}:{POLICY_VERSION}`.
- Stored in: `publish_rule_results.idempotency_key` (UNIQUE constraint).
- Publish job key (Decision D-011): `publish.facebook.job:{workspace_id}:{post_id}:{approved_version}:{POLICY_VERSION}` — bao gồm policy version để tránh false-positive dedup khi rule set thay đổi breaking.
- Outbox key: `publish.facebook.handoff:{workspace_id}:{job_id}`.

**Queue Behavior**
- Consumer: `policy.evaluate.requested`.
- DLQ: `policy.evaluate.requested.dlq`.
- Output (pass): `publish.facebook.requested` via outbox relay.
- Output (block): `alerts.slack.send`.
- ACK: chỉ sau Ledger commit. NACK: transient errors (max 5 retries, backoff: 1s, 2s, 4s, 8s, 16s).

**Security Constraints**
- `SET LOCAL app.current_workspace_id = :workspace_id` trong mọi tenant-scoped transaction.
- Normal worker không dùng service role; DB connection rejects bypass markers.
- RLS với USING + WITH CHECK cho `publish_rule_results`, `publish_handoff_events`, `publish_jobs`.
- Policy Engine (`packages/policy-engine`) là pure functions, không gọi platform API.
- `PublishFacebookRequestedEvent`: references-only, không chứa body/token/secret.
- Logs/audit không chứa raw token, forbidden term raw value, hoặc provider credentials.
- `checkForbiddenTerms`: NFC normalize + lowercase trước compare; không log raw matched term.
- `POLICY_BLOCK_SLACK_CHANNEL_ID` thiếu: graceful degradation — Ledger và Airtable vẫn commit, tạo audit `alert_pending_config`, không fail policy transaction (Decision D-014).
- Fail closed: token status không xác định → block.

**Test Evidence**
- Required: unit tests cho mỗi rule function; integration tests happy/block/idempotency/ACK-after-commit; contract tests; RLS tests. Phủ đủ POL-001 đến POL-015 trong US-004 Security Gate.

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


### FL-007: Notion Campaign Brief Context Loader

**Backlog Link:** US-013  
**Owner:** Orchestration/BA  
**Status:** Draft

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
- Page unavailable: mark context warning and continue only if fallback allowed.
- Permission error: alert Admin and mark workflow `needs_manual_review`.

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
**Status:** Draft

**Trigger**
- Webhook receiver, MCP server, or middleware creates asynchronous work.

**Input**
- `event_id`, `type`, `workspace_id`, `payload_ref`, `idempotency_key`, `correlation_id`.

**Processing Logic**
1. Producer validates event type.
2. Producer stores event metadata in Ledger.
3. Producer publishes message to RabbitMQ exchange.
4. Queue routes message to worker-specific queue.
5. Worker checks idempotency in Ledger.
6. Worker processes event.
7. Worker updates Ledger and acknowledges message.
8. Worker retries temporary failures.
9. Worker moves exhausted failures to DLQ.

**Output**
- Processed event, retry state, or DLQ event.

**Error Handling**
- Invalid event: reject and audit.
- Temporary worker error: retry with backoff.
- Permanent error: DLQ and alert Admin.

**Audit/Telemetry**
- `QUEUE_EVENT_PUBLISHED`, `QUEUE_EVENT_CONSUMED`, `QUEUE_EVENT_RETRIED`, `QUEUE_EVENT_DLQ`.

**Security Rules**
- Do not put raw tokens in RabbitMQ payload.
- Large payloads must be stored by reference.
- All workers must be idempotent.

**Test Evidence**
- Pending.

**Change History**
- 2026-05-20: Initial logic drafted.

### FL-009: Unified Direct Message Ingestion

**Backlog Link:** US-015  
**Owner:** MCP/Backend/Support  
**Status:** Draft

**Trigger**
- Platform MCP receives direct message webhook or polling result.

**Input**
- Platform, external thread id, external message id, sender metadata, message body, attachments.

**Processing Logic**
1. MCP validates source webhook.
2. MCP publishes `dm.<platform>.ingest` to RabbitMQ.
3. Worker checks duplicate by external message id.
4. Worker upserts conversation.
5. Worker inserts message.
6. Worker evaluates SLA/risk.
7. Worker publishes Slack/Teams alert event if needed.

**Output**
- Conversation and message records in Ledger.

**Error Handling**
- Duplicate message: no-op with audit.
- Payload parse error: DLQ.
- Ledger unavailable: retry.

**Audit/Telemetry**
- `DM_RECEIVED`, `DM_INGESTED`, `DM_DUPLICATE_IGNORED`, `DM_INGEST_FAILED`.

**Security Rules**
- Direct messages are sensitive data.
- Airtable/Notion must not store full DM content.
- Role-based access required for viewing/replying.

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
**Status:** Draft

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
- Page unavailable: mark context warning and continue only if fallback allowed.
- Permission error: alert Admin and mark workflow `needs_manual_review`.

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
**Status:** Draft

**Trigger**
- Webhook receiver, MCP server, or middleware creates asynchronous work.

**Input**
- `event_id`, `type`, `workspace_id`, `payload_ref`, `idempotency_key`, `correlation_id`.

**Processing Logic**
1. Producer validates event type.
2. Producer stores event metadata in Ledger.
3. Producer publishes message to RabbitMQ exchange.
4. Queue routes message to worker-specific queue.
5. Worker checks idempotency in Ledger.
6. Worker processes event.
7. Worker updates Ledger and acknowledges message.
8. Worker retries temporary failures.
9. Worker moves exhausted failures to DLQ.

**Output**
- Processed event, retry state, or DLQ event.

**Error Handling**
- Invalid event: reject and audit.
- Temporary worker error: retry with backoff.
- Permanent error: DLQ and alert Admin.

**Audit/Telemetry**
- `QUEUE_EVENT_PUBLISHED`, `QUEUE_EVENT_CONSUMED`, `QUEUE_EVENT_RETRIED`, `QUEUE_EVENT_DLQ`.

**Security Rules**
- Do not put raw tokens in RabbitMQ payload.
- Large payloads must be stored by reference.
- All workers must be idempotent.

**Test Evidence**
- Pending.

**Change History**
- 2026-05-20: Initial logic drafted.

### FL-009: Unified Direct Message Ingestion

**Backlog Link:** US-015  
**Owner:** MCP/Backend/Support  
**Status:** Draft

**Trigger**
- Platform MCP receives direct message webhook or polling result.

**Input**
- Platform, external thread id, external message id, sender metadata, message body, attachments.

**Processing Logic**
1. MCP validates source webhook.
2. MCP publishes `dm.<platform>.ingest` to RabbitMQ.
3. Worker checks duplicate by external message id.
4. Worker upserts conversation.
5. Worker inserts message.
6. Worker evaluates SLA/risk.
7. Worker publishes Slack/Teams alert event if needed.

**Output**
- Conversation and message records in Ledger.

**Error Handling**
- Duplicate message: no-op with audit.
- Payload parse error: DLQ.
- Ledger unavailable: retry.

**Audit/Telemetry**
- `DM_RECEIVED`, `DM_INGESTED`, `DM_DUPLICATE_IGNORED`, `DM_INGEST_FAILED`.

**Security Rules**
- Direct messages are sensitive data.
- Airtable/Notion must not store full DM content.
- Role-based access required for viewing/replying.

**Test Evidence**
- Pending.

**Change History**
- 2026-05-20: Initial logic drafted.

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
   - Parse `command` and `text` to extract `action` (approve/reject), `postId`, and `reason`.
   - Idempotency check: calculate SHA256 of `workspace_id:slack_user_id:command:text:timestamp`.
   - Check if event exists in `slack_command_events` via Idempotency Key. If yes, respond with duplicate message.
   - Insert received event into `slack_command_events` (status: `received` / `rejected`).
   - Look up user role in `workspace_members`. If not `manager` or `admin`, reject.
   - Update event status to `queued`.
   - Respond immediately with HTTP 200 ephemeral message (e.g., "Processing your request...").
   - Publish `slack.post_approval.requested` to RabbitMQ.

2. **Worker (SlackPostApprovalWorker):**
   - Consume message from RabbitMQ.
   - Fetch event from `slack_command_events` to verify it hasn't been processed.
   - Fetch post from Airtable using `postId`. 
   - Verify post status is valid for review (`Draft`, `Review`, or `Needs Review`).
   - If approve: update Airtable post status to `Approved`.
   - If reject: update Airtable post status to `Review`, and set `rejection_reason` (or `review_notes`) with the reason.
   - Update related `workflow_runs` status to `completed` or `cancelled`.
   - Update `slack_command_events` status to `succeeded` or `failed`.
   - Write `SLACK_COMMAND_SUCCEEDED` / `FAILED` audit log.
   - ACK message.

**Output**
- Ephemeral HTTP 200 response to Slack.
- Updated status and reason in Airtable.
- Audit logs in Ledger.

**Error Handling**
- Invalid signature -> HTTP 200 ephemeral error message, logged and audited.
- Parse errors / Missing arguments -> HTTP 200 ephemeral help message.
- Unauthorized user -> HTTP 200 ephemeral unauthorized message.
- Airtable update fails -> NACK requeue with exponential backoff (max 5 retries).
- Post not found in Airtable -> ACK, mark as failed in Ledger.

**Audit/Telemetry**
- `SLACK_SIGNATURE_REJECTED`
- `SLACK_COMMAND_DUPLICATE_IGNORED`
- `SLACK_COMMAND_REJECTED`
- `SLACK_COMMAND_RECEIVED`
- `SLACK_COMMAND_SUCCEEDED`
- `SLACK_COMMAND_FAILED`

**Security Rules**
- Requires `SLACK_SIGNING_SECRET` configured for verification.
- Enforces replay protection (5 minute window).
- Requires `manager` or `admin` role in `workspace_members` (no implicit trust of Slack User IDs).

**Test Evidence**
- See unit tests in `slackSignatureVerifier.test.ts`, `slackCommandParser.test.ts`, `slackCommandsRoute.test.ts`, and `slackPostApprovalWorker.test.ts`.

**Change History**
- 2026-06-02: Initial implementation drafted for US-008.

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
   - Parses `command` and `text` to extract `action` (reply/escalate), `interactionId`, and `message`/`reason`.
   - Checks Idempotency Key against `comment_action_events`.
   - Inserts received event into `comment_action_events`.
   - Looks up user role in `workspace_members`. Role must be `manager`, `admin`, or `support`.
   - Updates event status to `queued`.
   - Publishes `slack.comment_action.requested` to RabbitMQ.
   - Responds with ephemeral HTTP 200 message.

2. **Worker (SlackCommentActionWorker):**
   - Consumes message from RabbitMQ.
   - Fetches event from `comment_action_events`.
   - Fetches interaction from `interactions`.
   - If `reply`:
     - Looks up active Facebook `channel_account_id`; MCP resolves credentials internally.
     - Calls Facebook MCP server `replyComment` tool.
     - Updates interaction status to `resolved` and saves `external_reply_id`.
   - If `escalate`:
     - Updates interaction status to `escalated`.
     - Publishes Slack alert.
   - Commits updates to Ledger and ACKs RabbitMQ message.

**Output**
- Reply posted to Facebook (via MCP) or Escalation Alert sent to Slack.
- Updated status in Ledger.

**Error Handling**
- MCP failure -> NACK requeue (transient) or mark failed (permanent).
- Interaction not found -> ACK, mark failed.

**Audit/Telemetry**
- `SLACK_COMMENT_ACTION_SUCCEEDED`
- `SLACK_COMMENT_ACTION_FAILED`

**Security Rules**
- Reuses US-008 Slack signature verification.
- Enforces role mapping (`support`, `manager`, `admin`).
- Token resolution happens exclusively inside MCP Server.

**Change History**
- 2026-06-02: Implemented for US-009.

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
2. Recursive redactor strips forbidden keys (e.g., token, secret, password) from any nested level and replaces values with `[REDACTED]`. Marks `metadata_redacted: true` and logs bare `redacted_keys`.
3. Insert into `audit_logs` using canonical schema fields (including `event_type` and `correlation_id`).
4. Conflict resolution on `(workspace_id, idempotency_key)` ignores duplicate inserts safely.

**Output**
- A hardened, redacted, append-only row in `audit_logs`.

**Error Handling**
- DB unique constraint violation (duplicate idempotency) -> gracefully ignored via `DO NOTHING`.
- Missing required fields -> DB constraint error (throws, rejecting parent transaction).

**Audit/Telemetry**
- The insert operation itself is the audit/telemetry.

**Security Rules**
- RLS enforces `workspace_id` isolation (`AS RESTRICTIVE FOR ALL`).
- Append-only Trigger blocks `UPDATE` and `DELETE` globally.
- Redactor ensures no raw tokens are ever logged in the ledger.

**Change History**
- 2026-06-02: Implemented schema migration, redactor utility, and Shared Repository for US-010.

### FL-012: Admin Facebook Page Configuration

**Backlog Link:** US-011
**Owner:** Backend/Orchestration
**Status:** Implemented

**Trigger**
- Admin calls the API routes (/api/v1/admin/facebook/*) to authorize, connect, health-check, or disconnect Facebook Pages.

**Input**
- Admin request with x-admin-role header.
- For connect: pageId, userTokenRef.
- For health-check / disconnect: channelAccountId.

**Processing Logic**
1. **Validation:** Ensure feature flag FACEBOOK_PAGE_CONFIG_ENABLED is true, and admin role matches.
2. **MCP Invocation:** Relay operations to acebook-mcp-server tools (generateOAuthUrl, exchangeCodeAndListPages, connectPage, healthCheckToken).
3. **Dual Write (Connect):** Create/Update channel_accounts using channelAccountAdminRepository. Dual-write the token reference into 	oken_references table for unified secret mapping. Update channel_accounts.secret_ref.
4. **Audit Logging:** Log all administrative actions with ctorId: "system" and actorType user/system, ensuring no secrets are passed.
5. **Airtable Sync:** For connect, disconnect, and health-check, update Airtable safe fields (channel_status, 	oken_status, permission_status).

**Output**
- Standard JSON responses (success, error). Safe channel_account record returned.

**Error Handling**
- Missing role -> 403 Forbidden.
- Feature flag disabled -> 404 Not Found.
- Meta errors or MCP errors -> Propagated cleanly without raw tokens.

**Audit/Telemetry**
- Records event types: FACEBOOK_PAGE_OAUTH_STARTED, FACEBOOK_PAGE_CONNECTED, FACEBOOK_PAGE_DISCONNECTED, FACEBOOK_PAGE_AIRTABLE_SYNC_FAILED.
- Redactor ensures no secrets leak.

**Security Rules**
- Never send pp_secret or raw token back to the Orchestrator or Admin client.
- Always use 	oken_references to store the pointer to the real secret store.

**Change History**
- 2026-06-02: Implemented for US-011.
