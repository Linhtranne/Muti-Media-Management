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
**Status:** Draft

**Trigger**
- Airtable webhook fires when a Post record changes.

**Input**
- `event_id`, `table_name`, `record_id`, changed fields, timestamp.

**Processing Logic**
1. Verify webhook source/config.
2. Load Post record from Airtable.
3. If `status != Approved`, store event as ignored.
4. Check idempotency by `record_id + approved_version`.
5. Store webhook event in Operational Ledger.
6. Publish orchestration event to RabbitMQ.

**Output**
- Workflow started or event ignored.

**Error Handling**
- Airtable API failure: mark event `retryable_failed`.
- Invalid payload: mark event `rejected`.
- Duplicate event: mark `duplicate_ignored`.

**Audit/Telemetry**
- `WEBHOOK_RECEIVED`, `WEBHOOK_IGNORED`, `WEBHOOK_PROCESSING_FAILED`.

**Security Rules**
- Do not trust Airtable payload alone; reload record before action.

**Test Evidence**
- Pending.

**Change History**
- 2026-05-20: Initial logic drafted.

### FL-002: AI Composer Facebook Variant

**Backlog Link:** US-003  
**Owner:** AI/Backend  
**Status:** Draft

**Trigger**
- Workflow created from Approved Post.

**Input**
- `master_copy`, `cta_url`, `asset_links`, `campaign_objective`, `target_channels`, `notion_brief_url`, `brand_guideline_refs`.

**Processing Logic**
1. Load approved Post snapshot from Airtable.
2. Load Notion campaign brief/guideline context if configured.
3. Build AI prompt from Airtable data and Notion context.
4. Generate Facebook variant.
5. Normalize hashtags and CTA.
6. Store AI run input/output snapshot and Notion context references.
7. Update Airtable with variant draft or review state.
8. Send variant to Policy Engine.

**Output**
- Facebook content variant.

**Error Handling**
- AI provider timeout: retry with backoff.
- Invalid AI output: mark `needs_manual_review`.

**Audit/Telemetry**
- `AI_RUN_STARTED`, `AI_VARIANT_CREATED`, `AI_RUN_FAILED`.

**Security Rules**
- AI output cannot publish directly.
- AI prompt must not include raw access tokens.

**Test Evidence**
- Pending.

**Change History**
- 2026-05-20: Initial logic drafted.

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
