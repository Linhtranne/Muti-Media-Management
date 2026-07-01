# SPEC-US-005: Facebook MCP Validation and Publish Job Enqueue

**Status:** Approved  
**Retrofit Note:** Retrospec — US-005 was designed (FL-004 status: "Designed, ready for implementation"). Implementation status: in progress. Test evidence is Partial.  
**FL Reference:** FL-004 (Facebook MCP Validate Publish) — `docs/requirements/05_Function_Flow_Logic_Register.md` line 242  
**Backlog AC/BR:** US-005 AC1–AC4, BR1–BR5

---

## Goal

Consume the `publish.facebook.requested` queue event, validate the post through MCP tools (`get_rate_limit_status`, `validate_post`), persist the validation result atomically in Ledger, and emit `publish.facebook.validated` for execution by US-006 — without exposing tokens outside the MCP server.

---

## Source References

- **Backlog:** `docs/requirements/04_Product_Backlog.md` — US-005
- **FL-004:** `docs/requirements/05_Function_Flow_Logic_Register.md` line 242–321
- **Consumer:** `apps/orchestrator/src/queue/mcpPublishRabbitmqConsumer.ts` (MCP validate consumer)
- **Worker:** `apps/orchestrator/src/workers/mcpValidateWorker.ts` (verify path — per topology: `McpValidateWorker`)
- **Queue topology:** `apps/orchestrator/src/queue/topologyConfig.ts` — `publish.facebook.requested` and `publish.facebook.validated`
- **MCP Tools:** `apps/facebook-mcp-server/src/tools/validatePost.ts`, `apps/facebook-mcp-server/src/tools/getRateLimitStatus.ts`
- **Schema:** `packages/shared-contracts/src/__tests__/mcpPublishContracts.test.ts`

---

## In Scope

- Consuming `publish.facebook.requested` (exchange: `publish.workflows`, consumer: `McpValidateWorker`).
- Zod schema validation of incoming event.
- Idempotency checks at 3 levels: job-level, MCP-validation-key-level, outbox-level.
- Token pre-check: `token_reference.token_status = 'active'` AND `expires_at > NOW() + buffer`.
- MCP tool calls via MCP client (orchestrator side): `get_rate_limit_status` → `validate_post`.
- Atomic Ledger update: `publish_jobs.status = 'validated'`, `mcp_validation_events` outbox insertion, `workflow_runs` status update.
- `publish.facebook.validated` event emitted via outbox relay post-commit.
- Slack admin alert on validation failure.

## Out of Scope

- Actual publish execution (calling `POST /{page_id}/feed`) — that belongs to US-006 / FL-004b.
- Policy enforcement (content, CTA, UTM, approval rules) — that belongs to US-004 / FL-003.
- Direct Graph API calls from orchestrator — MCP server only.
- Token resolution or storage in orchestrator — MCP server boundary only.

---

## Functional Contract

Based on FL-004 (9 processing steps):

1. **Schema Validation (Consumer):** Validate message via Zod `PublishFacebookRequestedEvent`. Schema failure → DLQ (`publish.facebook.requested.dlq`) + ACK original → exit.
2. **Idempotency Check:** Query `publish_jobs` by `job_id`.
   - Status `validated`/`publishing`/`published` → ACK, log `mcp_validation_ineligible`, exit.
   - Status `validation_failed` → ACK, log `already_failed`, exit.
   - `mcp_validation_idempotency_key` already set → ACK, no-op, exit.
3. **Start Postgres Transaction:** `SET LOCAL app.current_workspace_id = :workspace_id`. Reload `publish_jobs`, `content_variants`, `channel_account`, `token_reference`. Transition `publish_jobs.status = 'mcp_validating'`. COMMIT.
4. **Token Pre-check (fast-fail):** Verify `token_reference.token_status = 'active'` AND `expires_at > NOW() + buffer`. Failure → `validation_failed` + Slack admin alert → ACK → exit. No retry on token failure.
5. **Call MCP `get_rate_limit_status`** via MCP client. Returns sanitized `RateLimitStatusResult`. `quotaExceeded = true` → `validation_failed` + `MCP_QUOTA_EXCEEDED` + Slack → ACK → exit.
6. **Call MCP `validate_post`** via MCP client. MCP server reads token from secret store, applies Facebook validation rules, returns sanitized `ValidatePostResult` (NO raw API response, NO token). Violations present → `validation_failed` + Slack → ACK → exit.
7. **Atomic Persist (Transaction):**
   - UPDATE `publish_jobs`: `status = 'validated'`, `mcp_validation_result`, `validated_at`, `mcp_validation_idempotency_key`.
   - UPDATE `workflow_runs`: `status = 'mcp_validation_completed'`.
   - INSERT `audit_logs`: `MCP_VALIDATION_COMPLETED`.
   - INSERT `mcp_validation_events` (outbox): `{job_id, workspace_id, idempotency_key}`.
   - COMMIT.
8. **ACK RabbitMQ** ONLY after COMMIT.
9. **Post-Commit:** Outbox relay publishes `publish.facebook.validated` → RabbitMQ for US-006 consumer.

---

## Data / Queue / API Contract

### Queue: Input
- **Queue:** `publish.facebook.requested`
- **Exchange:** `publish.workflows` (topic)
- **Routing key:** `publish.facebook.requested`
- **DLQ:** `publish.facebook.requested.dlq`
- **Payload (references-only):** `{event_id, event_type: "publish.facebook.requested", workspace_id, workflow_run_id, job_id, variant_id, channel_account_id, scheduled_at, idempotency_key, correlation_id, created_at}`
- **Forbidden:** body text, hashtags, cta_url, token, bearer, secret

### Queue: Output (pass path)
- **Queue:** `publish.facebook.validated`
- **Exchange:** `publish.workflows` (topic)
- **DLQ:** `publish.facebook.validated.dlq`
- **Payload:** same references-only envelope

### Ledger Entities
- **`publish_jobs`:** `{job_id, workspace_id, status, mcp_validation_idempotency_key, mcp_validation_result (JSONB sanitized), validated_at}`
- **`workflow_runs`:** `{run_id, workspace_id, status}`
- **`mcp_validation_events`:** outbox `{id, job_id, workspace_id, idempotency_key, dispatched_at}`
- **`content_variants`:** reloaded — must have `policy_status = 'policy_approved'`
- **`token_reference`:** `{secret_ref, token_status, expires_at, scopes}` — no raw token

### Idempotency Keys (3 levels)
| Level | Key format | Column |
|:---|:---|:---|
| Job-level (US-004) | `publish.facebook.job:{workspace_id}:{post_id}:{approved_version}:{policy_version}` | `publish_jobs.idempotency_key` |
| MCP validation (US-005) | `mcp.validate.facebook:{workspace_id}:{job_id}:{mcp_tool_version}` | `publish_jobs.mcp_validation_idempotency_key` |
| Outbox (US-005) | `publish.facebook.validated:{workspace_id}:{job_id}` | `mcp_validation_events.idempotency_key` |

### Audit Events
`MCP_VALIDATION_STARTED`, `MCP_VALIDATION_COMPLETED`, `MCP_VALIDATION_FAILED`, `MCP_VALIDATION_INELIGIBLE`, `MCP_TOKEN_PRE_CHECK_FAILED`, `MCP_QUOTA_EXCEEDED`, `MCP_VALIDATED_HANDOFF_ENQUEUED`, `MCP_VALIDATION_DLQ`

---

## Security & Safety Rules

- **Token never leaves MCP server:** orchestrator only sees `secret_ref` from `token_reference`. MCP resolves and uses token internally.
- **Orchestrator never calls Facebook Graph API directly:** all MCP calls via MCP client only.
- **`validate_post` must not call publish endpoint:** regression test required (`MCP-016` gate item).
- **`mcp_validation_result` is sanitized JSONB:** violation codes, quota numbers only — no raw Graph API response, no token.
- **Fail closed on token invalid:** no retry on `token_status != 'active'` or expired token.
- **RLS enforced:** `SET LOCAL app.current_workspace_id = :workspace_id` for every tenant-scoped transaction.
- **No token in logs, Slack, Airtable, audit metadata.**

---

## Error Cases

| Case | Detection | `publish_jobs.status` | Queue |
|:---|:---|:---|:---|
| Schema invalid | Zod parse fail | N/A | DLQ + ACK original |
| Already validated/published | status check | Unchanged | ACK |
| Already validation_failed | status check | Unchanged | ACK |
| Duplicate (idempotency key) | key exists | Unchanged | ACK |
| Token invalid/expired | pre-check fail | `validation_failed` | ACK after commit |
| Quota exceeded | MCP returns `quotaExceeded` | `validation_failed` | ACK after commit |
| Platform constraint violated | MCP returns violations | `validation_failed` | ACK after commit |
| Transient MCP/network error | timeout / 5xx | `mcp_validating` (no change) | NACK → retry (max 5) |
| DB fail before commit | transaction error | Unchanged | NACK |
| Exhausted retries | retry_count > 5 | `validation_failed` → DLQ | DLQ |

---

## Acceptance Criteria

**AC1 — Only policy-approved variants are validated (Backlog AC1)**
- *Given* a `publish.facebook.requested` message for a job where `content_variants.policy_status = 'draft'`
- *When* `McpValidateWorker` reloads context from Ledger
- *Then* the job transitions to `validation_failed`, an audit log is written, and no MCP tool is called.
- *Planned Trace:* Target test case `"should block validation if variant is not policy-approved"` in [mcpValidateWorker.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/mcpValidateWorker.test.ts).

**AC2 — Token never exposed during validation (Backlog AC2, BR3)**
- *Given* a valid job that reaches the MCP `validate_post` tool call
- *When* the tool is invoked
- *Then* the orchestrator side passes only `channel_account_id` (no access_token); the raw token appears only inside the MCP server process; `mcp_validation_result` in Ledger contains no raw token.
- *Planned Trace:* Target test case `"should call MCP validate_post tool using channel account ref only"` in [mcpValidateWorker.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/mcpValidateWorker.test.ts).

**AC3 — Rate limit exceeded fails the job cleanly (Backlog AC3)**
- *Given* `get_rate_limit_status` returns `{quotaExceeded: true}`
- *When* the worker processes the result
- *Then* `publish_jobs.status = 'validation_failed'`, audit event `MCP_QUOTA_EXCEEDED` is written, a Slack admin alert is sent, and the message is ACKed (no retry loop).
- *Planned Trace:* Target test case `"should fail validation on quota exceeded"` in [mcpValidateWorker.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/mcpValidateWorker.test.ts).

**AC4 — Validated job emits `publish.facebook.validated` (Backlog AC4)**
- *Given* all preconditions pass and `validate_post` returns no violations
- *When* the atomic transaction commits
- *Then* `publish_jobs.status = 'validated'`, `mcp_validation_events` outbox row inserted, and `publish.facebook.validated` event appears in the queue for US-006 consumer.
- *Planned Trace:* Target test case `"should transition to validated and emit outbox event"` in [mcpValidateWorker.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/mcpValidateWorker.test.ts).

---

## Test Plan

### Planned & Existing Test Files

| Test File | Path | Coverage |
|:---|:---|:---|
| [mcpValidateWorker.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/mcpValidateWorker.test.ts) | `apps/orchestrator/src/__tests__/mcpValidateWorker.test.ts` | Happy path validation transition, token precheck fail, rate limit quota exceeded, platform constraints |
| [validatePost.test.ts](file:///d:/Muti-Media%20Management/apps/facebook-mcp-server/src/__tests__/validatePost.test.ts) | `apps/facebook-mcp-server/src/__tests__/validatePost.test.ts` | MCP validation rules for text size limits and formatting |
| [getRateLimitStatus.test.ts](file:///d:/Muti-Media%20Management/apps/facebook-mcp-server/src/__tests__/getRateLimitStatus.test.ts) | `apps/facebook-mcp-server/src/__tests__/getRateLimitStatus.test.ts` | MCP rate limit quota check logic |
| [mcpPublishContracts.test.ts](file:///d:/Muti-Media%20Management/packages/shared-contracts/src/__tests__/mcpPublishContracts.test.ts) | `packages/shared-contracts/src/__tests__/mcpPublishContracts.test.ts` | Event schema validations for RabbitMQ payloads |

### Verification Evidence Reports
- [REPORT-us-005-documentation-2026-06-01.md](file:///d:/Muti-Media%20Management/docs/reports/US-005/REPORT-us-005-documentation-2026-06-01.md)
- [REPORT-us-005-implementation-2026-06-01.md](file:///d:/Muti-Media%20Management/docs/reports/US-005/REPORT-us-005-implementation-2026-06-01.md)

### RED Evidence Status

**Under Development** — US-005 implementation is in progress. The initial scaffolding has been validated against the planned test suite, but a complete TDD red-green cycle report is pending final worker completion.

---

## Validation Level

**L1** — Design-complete and initial scaffolding implemented. The test plan is finalized. Run command:
`npm run test apps/orchestrator/src/__tests__/mcpValidateWorker.test.ts`

---

## Open Questions

- OQ-005-1: Are OQ-005-3 and OQ-005-4 resolved? *Resolved:* Yes, the handoff payload structures and error states have been resolved in the shared contract specifications.
- OQ-005-2: What is `mcp_tool_version` in the idempotency key? *Resolved:* It is configured as a constant environment variable `MCP_TOOL_VERSION` representing the release version of the Facebook MCP Server validate tools.

