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
- The trigger payload or worker selection contains references only, never source copy, credentials, tokens, or large content bodies.

**Input**
- Ledger references: `workspace_id`, `workflow_run_id`, `airtable_record_id`, `approved_version`, safe `channel_account_refs`.
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
   - On hard security failure, set `ai_generation_runs.status = 'failed'`, parent workflow `ai_generation_failed`, and persist only sanitized metadata plus raw output hash when needed.
8. **Sync Airtable Review Fields:**
   - Use Airtable field mapping config instead of hardcoded field names.
   - Update only reviewable draft fields or sanitized review notes.
   - Never mutate the main Post status to `Approved`, `Scheduled`, `Published`, or publish-driving states.
   - If Airtable sync fails after Ledger commit, set `content_variants.sync_retry_needed = true` and write compensating audit metadata.
9. **Policy Handoff:**
   - If generation completed successfully, write a transactional outbox event `policy.evaluate.requested`.
   - The event is references-only and includes `idempotency_key`.
   - Do not create publish jobs and do not call Facebook Graph API or MCP publish tools.
10. **Broker Acknowledgement:**
   - ACK RabbitMQ only after the durable Ledger state is committed.
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

**Change History**
- 2026-05-20: Initial logic drafted.
- 2026-05-21: Finalized US-003 design in T-013 with Ledger schema, idempotency, worker flow, context boundaries, prompt/versioning, structured validation, provider retry policy, Airtable compensation, policy outbox handoff, and mandatory security controls.

### FL-003: Policy Engine Publish Guardrail

**Backlog Link:** US-004  
**Owner:** Backend/Security  
**Status:** Draft

**Trigger**
- AI variant created or Slack approval command received.

**Input**
- Variant, campaign settings, actor role, channel account status, forbidden terms config.

**Processing Logic**
1. Check campaign auto publish flag.
2. Check manager/admin approval.
3. Check variant approval status.
4. Check Facebook text/media constraints.
5. Check CTA/UTM.
6. Check forbidden terms and legal flags.
7. Check token/channel account status.
8. Return allowed/blockers/warnings.

**Output**
- `allowed`, `blockers`, `warnings`, `checks`.

**Error Handling**
- Missing config: fail closed.
- Missing token status: fail closed.

**Audit/Telemetry**
- `POLICY_CHECK_PASSED`, `POLICY_CHECK_BLOCKED`.

**Security Rules**
- Fail closed for publish actions.
- Warnings can continue only if explicitly configured.

**Test Evidence**
- Pending.

**Change History**
- 2026-05-20: Initial logic drafted.

### FL-004: Facebook MCP Publish Job

**Backlog Link:** US-005, US-006  
**Owner:** MCP/Backend  
**Status:** Draft

**Trigger**
- Policy Engine allowed publish and scheduled time is due.

**Input**
- `job_id`, `variant`, `channel_account_id`, `idempotency_key`, `scheduled_at`.

**Processing Logic**
1. Validate job status and idempotency.
2. Validate quota and token.
3. Mark job `publishing`.
4. Call Facebook Graph API inside MCP server.
5. Store external post id on success.
6. Mark job `published`.
7. Send Slack success/failure alert.

**Output**
- Published post or failed job.

**Error Handling**
- Temporary network/API error: retry.
- Permission/token error: fail and alert Admin.
- Duplicate idempotency key: return existing job state.

**Audit/Telemetry**
- `PUBLISH_STARTED`, `PUBLISH_SUCCEEDED`, `PUBLISH_FAILED`.

**Security Rules**
- No raw token in logs, Slack, Airtable.
- AI Agent never calls Graph API directly.

**Test Evidence**
- Pending.

**Change History**
- 2026-05-20: Initial logic drafted.

### FL-005: Facebook Comment Sync and Slack Alert

**Backlog Link:** US-007  
**Owner:** MCP/Communication  
**Status:** Draft

**Trigger**
- Scheduled sync, Facebook webhook, or manual sync command.

**Input**
- `external_post_id`, `channel_account_id`, `since`, Page token reference.

**Processing Logic**
1. MCP fetches comments or receives webhook.
2. MCP publishes `comments.facebook.ingest` event to RabbitMQ.
3. Worker upserts by platform external comment id.
3. Classify sentiment/risk keyword.
4. Store interaction/comment in Ledger.
5. Send Slack alert to inbox or crisis channel.

**Output**
- Interaction records and Slack alerts.

**Error Handling**
- Facebook API error: mark sync failed and retry if temporary.
- Slack send failure: store alert failed for retry.

**Audit/Telemetry**
- `COMMENTS_SYNCED`, `COMMENT_ALERT_SENT`, `COMMENT_ESCALATED`.

**Security Rules**
- Mask sensitive data in broad channels.
- Do not alert resolved interactions again.

**Test Evidence**
- Pending.

**Change History**
- 2026-05-20: Initial logic drafted.

### FL-006: Slack Slash Command Handler

**Backlog Link:** US-008, US-009  
**Owner:** Communication/Backend  
**Status:** Draft

**Trigger**
- Slack command: `/approve_post`, `/reject_post`, `/reply_comment`, `/escalate`.

**Input**
- Slack signed request, user id, command, args, timestamp.

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
