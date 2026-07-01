# AI-SDLC Retrofit Header for US-005

status: approved

## Tasks

- AC-001: Preserve the documented trigger, processing, and output workflow.
- AC-002: Preserve tenant isolation, idempotency, and durable Ledger/audit evidence where applicable.
- AC-003: Preserve zero-token and reference-only security boundaries.
- AC-004: Keep the story compatible with build, lint, tests, and AI-SDLC artifact validation.

## Done When

- AC-001: Story workflow matches the accepted implementation report and function flow register.
- AC-002: Ledger, idempotency, queue, and role/security constraints are documented or tested where applicable.
- AC-003: No raw tokens or oversized/raw provider payloads cross forbidden boundaries.
- AC-004: `npm run ai-sdlc:check -- US-005` passes after retrofit artifacts are present.

# US-005 Implementation Plan: Facebook MCP Validate và Enqueue Publish Job

## 1. Title

**US-005 — Facebook MCP validate và enqueue publish job**

---

## 2. Context

US-005 là bước đầu tiên của **MCP Execution Plane** trong chuỗi publish flow. Flow đầy đủ từ US-001 đến US-006:

- **US-001**: Airtable Control Plane — campaign/post schema, approval workflow.
- **US-002**: Webhook receiver — nhận Post Approved, tạo workflow stub, publish `ai.compose.facebook.requested`.
- **US-003**: AI Composer worker — tạo Facebook variant, write outbox event `policy.evaluate.requested`.
- **US-004**: Policy Engine worker — chạy rule checks, tạo `publish_jobs` stub (minimal) khi pass, write outbox event `publish.facebook.requested`.
- **US-005 (this)**: Facebook MCP Server — consume `publish.facebook.requested`, gọi MCP tool `validate_post`, xác nhận platform constraints, enqueue job bền vững với idempotency key. **Không thực hiện publish thật.**
- **US-006**: Facebook MCP publish execution — gọi Graph API, lưu external post id, cập nhật Airtable/Slack.

US-004 đã tạo `publish_jobs` (minimal stub: `status = 'queued'`) và đã publish `publish.facebook.requested` (references-only) vào RabbitMQ. US-005 consume event đó, thực hiện deep validation bằng MCP tool, và cập nhật trạng thái job thành `validated` (job sẵn sàng cho US-006).

**Ranh giới rõ ràng:**
- Orchestrator **không** gọi Facebook Graph API.
- Facebook Graph API chỉ được gọi **bên trong** `apps/facebook-mcp-server/`.
- US-005 **không** publish post thật (publish thuộc US-006).
- RabbitMQ payload luôn là **references-only**, không chứa body/token/secret.

---

## 3. Goal

Implement Facebook MCP Server tools và worker để xử lý `publish.facebook.requested` events:

1. **Consume** `publish.facebook.requested` message từ RabbitMQ (references-only).
2. **Reload** publish job và variant context từ Postgres Ledger (RLS-scoped).
3. **Gọi MCP tool `validate_post`** để validate platform constraints (text length, media, link, quota, token status) trong MCP server.
4. **Gọi MCP tool `get_rate_limit_status`** để kiểm tra quota còn lại trước khi tiếp tục.
5. **Enqueue/prepare** publish job bền vững: update `publish_jobs.status = 'validated'` + ghi `mcp_validation_result`.
6. **Emit** `publish.facebook.validated` event vào RabbitMQ cho US-006 consumer.
7. **ACK** RabbitMQ chỉ sau khi Ledger state được commit bền vững.
8. **Không** gọi Graph API publish endpoint — US-006 sẽ làm điều này.

---

## 4. Non-goals

- **Không** gọi Facebook Graph API publish endpoint (thuộc US-006: `publish_post` tool).
- **Không** implement `publish_post` MCP tool logic (US-006).
- **Không** implement comment sync (US-007).
- **Không** implement Slack slash command handler (US-008).
- **Không** implement LinkedIn/X/YouTube MCP server (future).
- **Không** implement báo cáo campaign (US-012).
- **Không** implement OAuth Facebook Page flow đầy đủ (US-011); US-005 chỉ dùng `token_reference` đã được US-011 lưu.
- **Không** implement token refresh — nếu token hết hạn → fail closed và yêu cầu admin xử lý.
- **Không** lưu raw Facebook API response nếu có thể chứa sensitive data; chỉ lưu sanitized summary (validation result codes, quota numbers).

---

## 5. Dependencies from US-001 to US-004

| Dependency | Source US | Required For US-005 |
|:---|:---|:---|
| `publish_jobs` table (minimal schema) | US-004 migration `0004` | US-005 ADD COLUMN thêm fields; read/update `status`, `idempotency_key` |
| `publish_jobs.idempotency_key` | US-004 | Reuse làm deduplication key; không tạo key mới |
| `publish_handoff_events` outbox | US-004 | Input: event `publish.facebook.requested` consumed bởi US-005 |
| `content_variants` table | US-003 | Reload variant body/hashtags/cta_url/media để validate |
| `channel_account` table | US-011 | Map `channel_account_id` → `external_page_id`, token reference |
| `token_reference` table | US-011 | Metadata: `secret_ref`, `scopes`, `expires_at`, `token_status` |
| `workflow_runs` table | US-002 | Transition sang `mcp_validation_completed` / `mcp_validation_failed` |
| `publish_rule_results` | US-004 | Read-only: context cho MCP validation (policy checks đã pass) |
| `audit_log` table | US-010 | Append-only audit cho mọi validation/enqueue action |
| RabbitMQ `publish.facebook.requested` queue | US-004 outbox relay | Input message cho US-005 consumer |
| RabbitMQ `publish.facebook.validated` queue | US-005 (new) | Output message cho US-006 consumer |
| RabbitMQ `alerts.slack.send` queue | US-007/US-008 | Gửi alert khi validation fail hoặc DLQ |
| `POLICY_VERSION` constant | US-004 `packages/policy-engine/src/version.ts` | Context cho audit/logging |
| Facebook App ID/Secret (env vars) | US-011/Infra | MCP server cần để validate token, check quota |
| Secret store (token resolution) | US-011/Infra | MCP server đọc actual page token **chỉ bên trong MCP server** |

### Critical state assumptions từ US-004

Khi US-005 nhận event, Ledger phải có:
- `publish_jobs.status = 'queued'`
- `content_variants.policy_status = 'policy_approved'`
- `workflow_runs.status = 'policy_evaluation_completed'`
- `publish_rule_results.allowed = true` cho `variant_id` tương ứng

Nếu không đủ điều kiện → US-005 ACK ngay và log `mcp_validation_ineligible`.

---

## 6. Scope

**In scope:**
- Facebook MCP Server tools: `validate_post` và `get_rate_limit_status` (US-005 scope).
- Worker (`apps/orchestrator/src/workers/mcpPublishValidationWorker.ts`) consume `publish.facebook.requested`.
- Reload variant, job, channel_account, token_reference từ Ledger.
- Gọi MCP tool `validate_post` qua MCP client trong orchestrator.
- Gọi MCP tool `get_rate_limit_status` để kiểm tra daily quota.
- Persist validation result vào `publish_jobs` (ADD COLUMN migration `0005_us005_mcp_validate_enqueue.sql`).
- Transition `publish_jobs.status = 'validated'` khi pass, `'validation_failed'` khi fail.
- Transition `workflow_runs.status = 'mcp_validation_completed'` / `'mcp_validation_failed'`.
- Emit `publish.facebook.validated` message (references-only) khi pass.
- Emit `alerts.slack.send` khi validation fail.
- Idempotency: reuse `publish_jobs.idempotency_key` từ US-004; không tạo duplicate job.
- DLQ handling cho malformed events.
- Worker ACK chỉ sau khi Ledger commit.
- Audit logging cho mọi MCP validation action.
- Rollback plan nếu migration hoặc worker fail.

**Out of scope:**
- `publish_post` tool implementation (US-006).
- Facebook Graph API publish call (US-006).
- Token refresh flow (US-011 khi cần extend).
- `sync_comments` tool (US-007).
- `reply_comment` tool (US-009).
- Media upload validation cho rich media (Phase 2 sau MVP text/link post).

---

## 7. User Story

> **Là hệ thống**, tôi muốn Facebook MCP server validate và enqueue publish job để đảm bảo idempotency, quota và retry trước khi thực sự publish.

**Persona**: System actor (automated worker), không có human trigger.

**Trigger**: US-004 Policy Engine worker pass → tạo `publish_jobs` stub và write `publish_handoff_events` outbox → outbox relay publish `publish.facebook.requested` vào RabbitMQ → US-005 consumer nhận message.

**Value**: Tách validation platform-specific (token, quota, text constraint thực tế từ Graph API) khỏi orchestrator logic. MCP server là nơi duy nhất giữ và sử dụng platform token.

---

## 8. Acceptance Criteria

| AC | Description | Testable Signal |
|:---|:---|:---|
| AC1 | Cùng `idempotency_key` không tạo job trùng | Gửi duplicate `publish.facebook.requested` → chỉ 1 validation run; job status không bị override nếu đã `validated` |
| AC2 | Job có trạng thái `queued` → `validated` khi pass validation | `publish_jobs.status = 'validated'` sau khi MCP tool `validate_post` return pass |
| AC3 | MCP kiểm tra quota trước khi chấp nhận job | `get_rate_limit_status` được gọi; nếu quota hết → `validation_failed` với blocker `QUOTA_EXCEEDED` |
| AC4 | Job fail có error message và audit | `publish_jobs.last_error` chứa error code/message (sanitized); `audit_log` có entry |
| AC5 | Token không bao giờ xuất hiện trong RabbitMQ payload, log, audit, Airtable, Slack | Contract test + redact test |
| AC6 | MCP tool validation kiểm tra text length (platform-level, chính xác từ Graph API validation rules) | `validate_post` trả `PLATFORM_TEXT_CONSTRAINT_VIOLATED` nếu body quá dài |
| AC7 | Job fail do token không hợp lệ/hết hạn → `validation_failed` và gửi Slack alert yêu cầu Admin | `publish_jobs.status = 'validation_failed'`, blocker `INVALID_TOKEN`, Slack alert với action required |
| AC8 | Worker ACK RabbitMQ chỉ sau Ledger commit | Integration test: DB fail trước commit → ACK không được gọi |
| AC9 | Publish job `validated` → emit `publish.facebook.validated` references-only message | Message chứa `job_id`, `workspace_id`, `variant_id`, không chứa body/token/secret |
| AC10 | MCP server không gọi Graph API publish endpoint trong US-005 scope | Static search + regression test: không có POST đến `/feed` endpoint trong `validate_post` và `enqueue_publish` tools |
| AC11 | Orchestrator không gọi Graph API trực tiếp | Static search: không có Facebook Graph API URL trong `apps/orchestrator/` |
| AC12 | Transient MCP/network errors → retry với backoff; permanent token/permission errors → fail closed | Worker test: mock network timeout → NACK; mock OAuthException → `validation_failed` + Slack alert |

**Business Rules (từ Backlog):**
- BR1: Không publish nếu quota ngày đã hết.
- BR2: Retry chỉ áp dụng lỗi tạm thời (network, 5xx).
- BR3: Lỗi permission/token phải fail ngay và yêu cầu admin xử lý.

---

## 9. Architecture Fit

US-005 thuộc **MCP Execution Plane**, được gọi bởi Orchestrator qua MCP client:

```
Airtable (Control Plane)
    │ webhook
    ▼
Webhook Receiver (US-002)
    │ ai.compose.facebook.requested
    ▼
AI Composer Worker (US-003)
    │ policy.evaluate.requested (outbox → RabbitMQ)
    ▼
Policy Engine Worker (US-004)
    │ publish.facebook.requested (outbox → RabbitMQ)
    ▼
MCP Publish Validation Worker (US-005)  ← THIS STORY
    │ [MCP call] → Facebook MCP Server → validate_post + get_rate_limit_status
    │ publish.facebook.validated (RabbitMQ, references-only)
    ▼
MCP Publish Execution Worker (US-006)
    │ [MCP call] → Facebook MCP Server → publish_post → Graph API
    ▼
Facebook Page
```

**Layer boundaries:**

| Layer | Module | Responsibility |
|:---|:---|:---|
| Orchestrator | `apps/orchestrator/src/workers/mcpPublishValidationWorker.ts` | Queue consume, Ledger reload, MCP client call, persist result, emit validated event, ACK |
| MCP Client | `apps/orchestrator/src/mcp/facebookMcpClient.ts` | Gọi MCP tool qua MCP protocol; không giữ token |
| Facebook MCP Server | `apps/facebook-mcp-server/src/tools/validatePost.ts` | Giải quyết token từ secret store, call Graph API validation, trả kết quả sanitized |
| Facebook MCP Server | `apps/facebook-mcp-server/src/tools/getRateLimitStatus.ts` | Kiểm tra quota từ Graph API rate limit headers/endpoint |
| Ledger (Postgres) | `apps/orchestrator/src/ledger/mcpValidationRepository.ts` | Reload job/variant/channel/token_ref, persist validation result, transition status |
| Queue | RabbitMQ | `publish.facebook.requested` (in), `publish.facebook.validated` (out), DLQ |

**Quy tắc bất di bất dịch:**
- `apps/orchestrator/` **không bao giờ** import Facebook Graph API SDK hoặc gọi `graph.facebook.com`.
- `apps/orchestrator/` **không bao giờ** đọc actual access token từ secret store.
- Token được đọc **chỉ bên trong** `apps/facebook-mcp-server/`.
- MCP tool trả về **sanitized result** (status code, constraint violations, quota numbers) — không trả raw API response.

---

## 10. Sequence / Flow

### Happy Path (Validation Pass)

```
1.  [RabbitMQ] publish.facebook.requested message arrives at mcpPublishValidationWorker
2.  [Worker] Validate message schema (Zod) → invalid → DLQ → ACK original; exit
3.  [Worker] Start Postgres transaction
4.  [DB] SET LOCAL app.current_workspace_id = :workspace_id
5.  [DB] Reload publish_jobs WHERE id = :job_id AND workspace_id = :workspace_id
6.  [DB] Check publish_jobs.status = 'queued' (idempotency guard)
        → status = 'validated'/'publishing'/'published' → ACK, log 'already_advanced', exit
        → status = 'validation_failed' → ACK, log 'already_failed', exit
        → status = 'queued' → continue
7.  [DB] Check mcp_validation_idempotency_key (US-005 own idempotency within job)
        → exists → ACK, no-op; exit
8.  [DB] Reload content_variants WHERE id = :variant_id (get body, hashtags, cta_url, media_refs)
9.  [DB] Reload channel_account WHERE id = :channel_account_id (get external_page_id, token_status)
10. [DB] Reload token_reference WHERE channel_account_id = :channel_account_id (get secret_ref, scopes, expires_at)
11. [DB] Verify token_reference.token_status = 'active' AND expires_at > NOW() + buffer
        → invalid/expired → COMMIT 'token_invalid' status → ACK → Slack alert; exit (fail closed)
12. [DB] COMMIT transition: publish_jobs.status = 'mcp_validating'
13. [Worker] Call MCP client → Facebook MCP Server: get_rate_limit_status({ channel_account_id, secret_ref })
14. [MCP Server] Resolve token from secret store (server-side only)
15. [MCP Server] Call Graph API rate limit check
16. [MCP Server] Return sanitized quota result: { remaining_today, limit_today, reset_at }
17. [Worker] Check quota: remaining_today == 0 → transition 'quota_exceeded' → fail path
18. [Worker] Call MCP client → Facebook MCP Server: validate_post({ variant_content_ref, channel_account_id, secret_ref })
19. [MCP Server] Resolve token from secret store (server-side only)
20. [MCP Server] Call Graph API content validation (or apply FB rules locally: text length, link, media constraints)
21. [MCP Server] Return sanitized validation result: { passed, violations[], warnings[] }
22. [Worker] IF violations exist → transition 'platform_constraint_failed' → fail path
23. [Worker/DB] Start atomic Postgres transaction:
24.   [DB] SET LOCAL app.current_workspace_id = :workspace_id
25.   [DB] UPDATE publish_jobs SET status = 'validated', mcp_validation_result = :result, validated_at = NOW()
26.   [DB] UPDATE workflow_runs SET status = 'mcp_validation_completed'
27.   [DB] INSERT audit_log (action = 'mcp_validation_completed', metadata = sanitized)
28.   [DB] INSERT mcp_validation_events outbox row (event_type = 'publish.facebook.validated', references-only)
29.   [DB] COMMIT
30. [Outbox Relay] Publish publish.facebook.validated to RabbitMQ (references-only)
31. [Worker] ACK publish.facebook.requested message

### Fail Path (Validation Fail)

23-fail. [Worker/DB] Start atomic Postgres transaction:
24.   [DB] SET LOCAL app.current_workspace_id = :workspace_id
25.   [DB] UPDATE publish_jobs SET status = 'validation_failed', last_error = :sanitized_error, retry_count++
26.   [DB] UPDATE workflow_runs SET status = 'mcp_validation_failed'
27.   [DB] INSERT audit_log (action = 'mcp_validation_failed', metadata = sanitized)
28.   [DB] COMMIT
29. [Worker] Publish alerts.slack.send (sanitized error, job_id, action required)
30. [Worker] ACK publish.facebook.requested message
```

**Fail-closed rules:**
- Token invalid/expired → fail ngay, không retry, gửi Slack alert "Admin action required".
- Quota exceeded → `validation_failed` với blocker `QUOTA_EXCEEDED`; gửi Slack alert.
- Transient MCP/network error → NACK/requeue (max 5 retries, exponential backoff).
- Schema invalid message → DLQ → ACK original.
- DB fail trước commit → NACK/requeue, không ACK.

---

## 11. MCP Tool Contracts

### 11.1. Tool: `validate_post`

**Defined in:** `apps/facebook-mcp-server/src/tools/validatePost.ts`

**Input (from MCP client call):**

```typescript
// packages/shared-contracts/src/mcp/validatePost.ts
export interface ValidatePostInput {
  variantRef: {
    variantId: string;           // UUID, MCP server uses to load variant content from Ledger
    bodyLength: number;          // Orchestrator pre-computes; MCP verifies
    hashtagCount: number;        // Pre-computed by orchestrator
    hasMedia: boolean;           // Whether media refs present
    ctaUrl?: string;             // CTA URL for link post validation
  };
  channelAccountId: string;      // MCP server resolves to external_page_id
  secretRef: string;             // Opaque server-side reference; MCP resolves to token in secret store
  // NO: body text, hashtag strings, access_token, bearer
}

export interface ValidatePostResult {
  passed: boolean;
  violations: McpValidationViolation[];
  warnings: McpValidationWarning[];
  checkedAt: string;             // ISO datetime
}

export type McpViolationCode =
  | 'PLATFORM_TEXT_TOO_LONG'
  | 'PLATFORM_LINK_INVALID'
  | 'PLATFORM_MEDIA_UNSUPPORTED'
  | 'PLATFORM_PERMISSION_MISSING'
  | 'PLATFORM_TOKEN_INVALID'
  | 'PLATFORM_TOKEN_EXPIRED'
  | 'QUOTA_EXCEEDED';

export type McpWarningCode =
  | 'LINK_PREVIEW_UNAVAILABLE'
  | 'HASHTAG_COUNT_HIGH'
  | 'CTA_URL_REDIRECT';

export interface McpValidationViolation {
  code: McpViolationCode;
  detail: string;              // sanitized, no raw token, no raw API response
}

export interface McpValidationWarning {
  code: McpWarningCode;
  detail: string;
}
```

**Implementation boundary:**
- MCP server nhận `secretRef`, gọi secret store để lấy actual token — **chỉ bên trong MCP server process**.
- MCP server **không trả** actual token về orchestrator.
- MCP server gọi Graph API validation (hoặc apply FB rules locally nếu validation không cần API call).
- MCP server trả về **sanitized `ValidatePostResult`** — không trả raw Graph API response.
- Nếu Graph API trả `OAuthException` hoặc `#190` → map to `PLATFORM_TOKEN_INVALID` hoặc `PLATFORM_TOKEN_EXPIRED`.

### 11.2. Tool: `get_rate_limit_status`

**Defined in:** `apps/facebook-mcp-server/src/tools/getRateLimitStatus.ts`

```typescript
// packages/shared-contracts/src/mcp/rateLimitStatus.ts
export interface GetRateLimitStatusInput {
  channelAccountId: string;
  secretRef: string;
}

export interface RateLimitStatusResult {
  remainingToday: number;        // Remaining publish calls today
  limitToday: number;            // Total daily limit
  resetAt: string;               // ISO datetime when quota resets
  quotaExceeded: boolean;
}
```

**Note:** Facebook Graph API rate limits cho Page Publishing: hiện tại FB không expose granular daily post limit qua API header. MVP assumption: MCP server track quota in Ledger (`publish_jobs` count per `channel_account_id` per day) + check against configurable `MAX_DAILY_POSTS_PER_PAGE` env var. Graph API rate limit errors (code 32, subcode 613) → map to `QUOTA_EXCEEDED`.

### 11.3. Tool: `enqueue_publish` (US-005 boundary clarification)

`enqueue_publish` trong architecture doc có thể hiểu là cả "validate + prepare job". Quyết định phân chia:
- US-005: implement `validate_post` + `get_rate_limit_status` + **update job status trong Ledger** = "enqueue" = "prepare durable job".
- US-006: implement `publish_post` = thực sự gọi Graph API publish.
- `enqueue_publish` tool trong MCP server = alias cho validate + ledger update flow của US-005.

---

## 12. RabbitMQ Events

| Queue / Exchange | Direction | Producer | Consumer | Payload Rule |
|:---|:---|:---|:---|:---|
| `publish.facebook.requested` | Input | US-004 outbox relay | US-005 worker | References-only: `job_id`, `variant_id`, `channel_account_id`, `workspace_id` — **NO body/token** |
| `publish.facebook.validated` | Output (pass) | US-005 outbox relay | US-006 worker | References-only: `job_id`, `variant_id`, `workspace_id` — **NO body/token** |
| `alerts.slack.send` | Output (fail/DLQ) | US-005 worker | Slack alert worker | Sanitized alert: `job_id`, error code, action required, **NO token** |
| `publish.facebook.requested.dlq` | DLQ | US-005 consumer | Admin tooling | Malformed/exhausted events |

**Input message schema (`PublishFacebookRequestedEvent` — defined by US-004):**

```typescript
// packages/shared-contracts/src/mcp/publishFacebookRequested.ts
export interface PublishFacebookRequestedEvent {
  eventId: string;
  eventType: 'publish.facebook.requested';
  workspaceId: string;
  correlationId: string;
  workflowRunId: string;
  jobId: string;               // pointer to publish_jobs row
  variantId: string;           // pointer to content_variants row
  channelAccountId: string;    // pointer to channel_account row
  scheduledAt: string;         // ISO datetime
  idempotencyKey: string;      // reuse from publish_jobs.idempotency_key
  createdAt: string;
  // Explicitly FORBIDDEN: body, hashtags, cta_url, access_token, bearer, secret
}
```

**Output message schema (`PublishFacebookValidatedEvent`):**

```typescript
// packages/shared-contracts/src/mcp/publishFacebookValidated.ts
export interface PublishFacebookValidatedEvent {
  eventId: string;
  eventType: 'publish.facebook.validated';
  workspaceId: string;
  correlationId: string;
  workflowRunId: string;
  jobId: string;
  variantId: string;
  channelAccountId: string;
  scheduledAt: string;
  idempotencyKey: string;
  validatedAt: string;
  createdAt: string;
  // Explicitly FORBIDDEN: body, hashtags, access_token, bearer, secret, validationDetail
}
```

---

## 13. Database / Ledger Changes

### 13.1. Migration: `0005_us005_mcp_validate_enqueue.sql`

> **Migration ordering**: US-004 đã tạo `publish_jobs` (minimal). US-005 ADD COLUMN để extend.
> Migration này phải chạy SAU `0004_us004_policy_publish_guardrail.sql`.

```sql
-- Migration: 0005_us005_mcp_validate_enqueue.sql
-- Run after: 0004_us004_policy_publish_guardrail.sql

-- ADD COLUMNS to publish_jobs (US-004 minimal schema → US-005 extended)
ALTER TABLE publish_jobs
  ADD COLUMN IF NOT EXISTS mcp_validation_result JSONB NULL,
  ADD COLUMN IF NOT EXISTS mcp_validation_idempotency_key TEXT NULL UNIQUE,
  ADD COLUMN IF NOT EXISTS validated_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS validation_failed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error TEXT NULL,        -- sanitized error message/code only
  ADD COLUMN IF NOT EXISTS last_error_code TEXT NULL,   -- MCP violation code enum
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS max_retries INTEGER NOT NULL DEFAULT 5;

-- ADD new status values to publish_jobs.status CHECK (if constraint-based)
-- Status values: queued | mcp_validating | validated | validation_failed |
--               publishing | published | failed | cancelled | needs_review

-- New table: mcp_validation_events (transactional outbox for US-005 → US-006 handoff)
CREATE TABLE mcp_validation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  event_id UUID NOT NULL UNIQUE,
  event_type TEXT NOT NULL DEFAULT 'publish.facebook.validated',
  correlation_id UUID NOT NULL,
  workflow_run_id UUID NOT NULL,
  job_id UUID NOT NULL REFERENCES publish_jobs(id) ON DELETE RESTRICT,
  variant_id UUID NOT NULL,
  channel_account_id TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',   -- 'pending' | 'published' | 'failed'
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ NULL
);

ALTER TABLE mcp_validation_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY mve_workspace_isolation ON mcp_validation_events
  FOR ALL
  USING (workspace_id = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));

CREATE INDEX idx_mve_pending ON mcp_validation_events (status, created_at)
  WHERE status = 'pending';

-- ADD new workflow_runs status values (US-005)
-- Values: ... | mcp_validation_completed | mcp_validation_failed
-- (Add via constraint migration or enum update per schema approach)

-- Index for scheduled jobs (US-006 polling)
CREATE INDEX idx_pj_scheduled ON publish_jobs (workspace_id, status, scheduled_at)
  WHERE status = 'validated';

-- Index for retry queue
CREATE INDEX idx_pj_retry ON publish_jobs (status, next_retry_at)
  WHERE status = 'validation_failed' AND next_retry_at IS NOT NULL;
```

### 13.2. Extended `publish_jobs` status state machine

```
queued          (US-004 creates)
    ↓
mcp_validating  (US-005: transition khi bắt đầu validate)
    ↓ pass
validated       (US-005: validation pass, ready for US-006)
    ↓
publishing      (US-006: đang publish)
    ↓ success
published       (US-006: done)
    ↓ fail
failed          (US-006: publish fail terminal)

    ↓ validation fail (from mcp_validating)
validation_failed   (US-005: fail — token invalid, quota, platform constraint)

    ↓ (any) → manual intervention
needs_review    (Admin action required)
cancelled       (Admin cancelled)
```

### 13.3. `mcp_validation_result` JSONB schema

Stored in `publish_jobs.mcp_validation_result` — **sanitized only**, không chứa raw API response:

```json
{
  "passed": true,
  "violations": [],
  "warnings": [{ "code": "LINK_PREVIEW_UNAVAILABLE", "detail": "Link preview could not be fetched" }],
  "quotaRemaining": 42,
  "quotaLimit": 100,
  "checkedAt": "2026-06-01T14:30:00Z",
  "mcpToolVersion": "validate_post@1.0"
}
```

---

## 14. Facebook MCP Server Responsibilities

File: `apps/facebook-mcp-server/`

### Tools US-005 implements:

#### `validate_post` tool (`src/tools/validatePost.ts`)

1. Nhận `ValidatePostInput` từ orchestrator MCP client.
2. **Đọc `secretRef`** → gọi secret store (e.g., Infra vault) để lấy actual Facebook Page access token. **Token không rời khỏi MCP server process.**
3. Apply Facebook content validation rules:
   - Text length ≤ 63,206 chars (từ variant's `bodyLength`).
   - Link validation: nếu `hasMedia = false` và `ctaUrl` present → validate URL reachable (optional, MVP có thể skip fetch).
   - Media validation: nếu `hasMedia = true` → check supported formats (MVP: log warning only).
4. Optionally call Graph API debug endpoint nếu cần validation mà không publish: e.g., `POST /{page_id}/feed?preview=true` hoặc Graph API field validation.
5. Trả về `ValidatePostResult` — **không trả raw API response**, chỉ trả mapped violation/warning codes.
6. Nếu Graph API trả `OAuthException (190)` → map to `PLATFORM_TOKEN_INVALID`.
7. Nếu Graph API trả `OAuthException (463)` → map to `PLATFORM_TOKEN_EXPIRED`.
8. **Không gọi POST `/feed` publish endpoint.**

#### `get_rate_limit_status` tool (`src/tools/getRateLimitStatus.ts`)

1. Nhận `GetRateLimitStatusInput`.
2. Đọc `secretRef` → lấy token.
3. MVP strategy: query Ledger `publish_jobs` count per `channel_account_id` cho ngày hôm nay + compare với `MAX_DAILY_POSTS_PER_PAGE` config. Fallback: parse `X-App-Usage` / `X-Business-Use-Case-Usage` header từ Graph API nếu available.
4. Return `RateLimitStatusResult` (sanitized numbers, no raw headers).

### Responsibility boundaries:

| Responsibility | MCP Server | Orchestrator |
|:---|:---|:---|
| Đọc actual Facebook token | ✅ YES — từ secret store | ❌ NO |
| Gọi Facebook Graph API | ✅ YES — chỉ validation endpoints | ❌ NO |
| Lưu kết quả validation vào Ledger | ❌ NO | ✅ YES — sau khi nhận sanitized result |
| Kiểm tra idempotency | ❌ NO (MCP là stateless tool) | ✅ YES |
| Publish kết quả lên RabbitMQ | ❌ NO | ✅ YES |
| Audit logging | ❌ NO | ✅ YES |
| Token rotation / refresh | ❌ NO (US-011) | ❌ NO |

---

## 15. Orchestrator Responsibilities

Module: `apps/orchestrator/src/workers/mcpPublishValidationWorker.ts`

1. **Subscribe** `publish.facebook.requested` queue.
2. **Validate** message schema (Zod `PublishFacebookRequestedEvent`) → invalid → DLQ → ACK.
3. **Idempotency check**: query `publish_jobs` by `id` và `idempotency_key`:
   - status `validated`/`publishing`/`published` → ACK, log `already_advanced`.
   - status `validation_failed` AND retry not applicable → ACK, log `already_failed`.
   - `mcp_validation_idempotency_key` exists → ACK, no-op.
4. **Reload** context từ Ledger (publish_job, variant, channel_account, token_reference).
5. **Pre-check token** trước khi gọi MCP (fast-fail nếu token inactive/expired theo Ledger metadata).
6. **Transition** `publish_jobs.status = 'mcp_validating'` (trước khi gọi MCP).
7. **Call MCP client** → `facebook-mcp-server`:
   - `get_rate_limit_status` → check quota.
   - `validate_post` → check platform constraints.
8. **Parse result** từ MCP server (sanitized; orchestrator không nhìn thấy token).
9. **Persist** validation result vào Ledger trong một atomic transaction (pass hoặc fail path).
10. **Emit** `publish.facebook.validated` outbox event (nếu pass).
11. **Side effects** (Slack alert nếu fail) sau Ledger commit.
12. **ACK** RabbitMQ message **chỉ sau khi Ledger commit**.

**Điều orchestrator KHÔNG được làm:**
- Gọi Facebook Graph API trực tiếp.
- Giữ/log actual Facebook access token.
- Ghi raw MCP/Graph API response vào Ledger.
- Retry vô hạn khi lỗi permanent (token/permission).

---

## 16. Token / Secret Boundary

```
┌─────────────────────────────────────────────┐
│          ORCHESTRATOR LAYER                 │
│                                             │
│  Biết: secret_ref (opaque string ID)        │
│  Biết: token_status, expires_at (metadata) │
│  KHÔNG biết: actual access_token string    │
│  KHÔNG biết: client_secret                 │
└──────────────────┬──────────────────────────┘
                   │  MCP call (secretRef only)
                   ▼
┌─────────────────────────────────────────────┐
│        FACEBOOK MCP SERVER LAYER           │
│                                             │
│  Nhận: secretRef                            │
│  Đọc: actual token từ secret store          │
│  Dùng: token để gọi Graph API              │
│  Trả về: sanitized result (NO token)       │
└──────────────────┬──────────────────────────┘
                   │  HTTPS
                   ▼
┌─────────────────────────────────────────────┐
│        SECRET STORE (Infra)                │
│  Lưu: actual Facebook Page access token    │
│  Access: chỉ MCP server service account    │
└─────────────────────────────────────────────┘
```

**Rules:**
- `secret_ref` là opaque ID, không phải token string.
- MCP server là nơi duy nhất decode `secret_ref` → actual token.
- `actual token` **không xuất hiện** trong: RabbitMQ payload, Postgres Ledger, log output, audit metadata, Airtable fields, Slack messages.
- Nếu MCP server fail khi đọc secret → `MCP_SECRET_RESOLUTION_ERROR` → `validation_failed` + Slack alert Admin.

---

## 17. Idempotency Strategy

> Reuse `publish_jobs.idempotency_key` được tạo bởi US-004. US-005 **không** tạo key mới.

| Level | Key | Storage | Guard |
|:---|:---|:---|:---|
| Job-level dedup (từ US-004) | `publish.facebook.job:{workspace_id}:{post_id}:{approved_version}:{policy_version}` | `publish_jobs.idempotency_key` UNIQUE | Nếu job đã tồn tại → US-005 ACK ngay, không override |
| MCP validation-level dedup | `mcp.validate.facebook:{workspace_id}:{job_id}:{mcp_tool_version}` | `publish_jobs.mcp_validation_idempotency_key` UNIQUE | Nếu validation đã run → ACK, no-op |
| Validated outbox dedup | `publish.facebook.validated:{workspace_id}:{job_id}` | `mcp_validation_events.idempotency_key` UNIQUE | Outbox không insert trùng |

**RabbitMQ redelivery handling:**
- Consumer nhận lại message → check `publish_jobs.status`:
  - `validated` → ACK immediately (already done).
  - `mcp_validating` → kiểm tra `mcp_validation_idempotency_key` → nếu exists ACK; nếu không exists nghĩa là process crash mid-flight → retry validation.
  - `queued` → proceed normally.
- Worker phải handle at-least-once delivery mà không tạo duplicate job.

---

## 18. Retry / DLQ Strategy

| Error Type | Classification | Action | Max Retries | Backoff |
|:---|:---|:---|:---|:---|
| Network timeout đến MCP server | Transient | NACK → requeue | 5 | 1s, 2s, 4s, 8s, 16s |
| MCP server 5xx / unavailable | Transient | NACK → requeue | 5 | Same |
| Graph API 5xx (server error) | Transient | NACK → requeue | 5 | Same |
| Graph API `OAuthException #190` (invalid token) | Permanent | `validation_failed` + Slack alert + ACK | 0 (no retry) | N/A |
| Graph API `OAuthException #463` (expired token) | Permanent | `validation_failed` + Slack alert + ACK | 0 | N/A |
| Graph API rate limit (code 32, subcode 613) | Quota | `validation_failed` + `QUOTA_EXCEEDED` + Slack | 0 | N/A |
| Platform constraint violation | Permanent | `validation_failed` + Slack | 0 | N/A |
| Schema invalid message | Permanent | DLQ → ACK original | 0 | N/A |
| DB fail trước commit | Transient | NACK → requeue | 5 | Same |
| DB fail sau commit | Compensation | Side effects retry async; Ledger committed | N/A | N/A |
| Exhausted retries (>5) | Permanent | DLQ → admin Slack alert | — | — |

**DLQ action**: admin tooling + Slack alert + audit `mcp_validation_dlq`.

---

## 19. Error Handling Matrix

| Case | Detection | Action | `publish_jobs.status` | `workflow_runs.status` | RabbitMQ |
|:---|:---|:---|:---|:---|:---|
| Validation pass | All checks pass | Update `validated`, emit outbox, commit | `validated` | `mcp_validation_completed` | ACK after commit |
| Token invalid | Graph API OAuthException #190 hoặc Ledger `token_status != 'active'` | `validation_failed` + Slack alert Admin | `validation_failed` | `mcp_validation_failed` | ACK after commit |
| Token expired | Graph API OAuthException #463 hoặc `expires_at < NOW()` | `validation_failed` + Slack alert Admin | `validation_failed` | `mcp_validation_failed` | ACK after commit |
| Quota exceeded | Daily limit reached | `validation_failed` + `QUOTA_EXCEEDED` + Slack | `validation_failed` | `mcp_validation_failed` | ACK after commit |
| Platform constraint violated | `validate_post` returns violations | `validation_failed` + log violations (sanitized) + Slack | `validation_failed` | `mcp_validation_failed` | ACK after commit |
| Secret resolution error | MCP server cannot fetch token from store | `validation_failed` + Slack alert Admin | `validation_failed` | `mcp_validation_failed` | ACK after commit |
| Transient MCP/network error | Timeout / 5xx | NACK → requeue with backoff | `mcp_validating` (stays) | Unchanged | NACK |
| Duplicate event (already validated) | `publish_jobs.status = 'validated'` | ACK, no-op | Unchanged | Unchanged | ACK |
| Ineligible event (wrong status) | `publish_jobs.status` not `queued`/`mcp_validating` | ACK, log `mcp_validation_ineligible` | Unchanged | Unchanged | ACK |
| Schema invalid message | Zod fail | DLQ + ACK original | N/A | N/A | DLQ + ACK |
| DB fail before commit | Transaction error | NACK/requeue | Unchanged | Unchanged | NACK |
| Airtable side effect fail | HTTP error | `airtable_sync_retry_needed = true` + compensating audit | Already committed | Already committed | Already ACKed |
| Exhausted retries | `retry_count > MAX_RETRIES` | DLQ + admin Slack alert | `validation_failed` | `mcp_validation_failed` | DLQ |

---

## 20. Security Requirements

| Requirement | Implementation |
|:---|:---|
| Token không xuất hiện trong RabbitMQ | `PublishFacebookRequestedEvent` và `PublishFacebookValidatedEvent` không có token fields; contract test reject |
| Token không xuất hiện trong logs | `redact.ts` áp dụng toàn bộ log output trong orchestrator |
| Token không xuất hiện trong audit metadata | `audit_log.metadata` chứa only IDs, codes, sanitized details |
| Token không xuất hiện trong Airtable | Không sync raw token; chỉ sync job status codes |
| Token không xuất hiện trong Slack | Alert chứa job_id, error code, action link — no token |
| Token chỉ được đọc trong MCP server | `apps/facebook-mcp-server/` là nơi duy nhất gọi secret store |
| Orchestrator không gọi Graph API | Static search: không có `graph.facebook.com` trong `apps/orchestrator/` |
| Tenant isolation | `SET LOCAL app.current_workspace_id = :workspace_id` trong mọi worker transaction |
| RLS enforced | `publish_jobs`, `mcp_validation_events`, `content_variants` đều có RLS |
| Service role guard | Worker không dùng service role hoặc connection bypass RLS |
| MCP validation result sanitized | MCP server không trả raw Graph API response; chỉ trả mapped violation codes |
| No raw Facebook API response trong Ledger | `mcp_validation_result` JSONB chứa only sanitized summary |
| Fail closed on invalid/expired/missing token | Token không hợp lệ → `validation_failed` ngay, không retry, Slack alert Admin |
| Quota fail closed | `quotaRemaining == 0` → `validation_failed`, không publish |
| No publish side effect in US-005 | `validate_post` tool không gọi POST `/feed`; regression test bắt buộc |
| RLS + tenant isolation cho `mcp_validation_events` | RLS với USING + WITH CHECK |

---

## 21. Observability / Audit Requirements

### Audit Events

| Event | When | Metadata |
|:---|:---|:---|
| `MCP_VALIDATION_STARTED` | Khi bắt đầu validate (sau transition `mcp_validating`) | `workspace_id`, `job_id`, `variant_id`, `correlation_id` |
| `MCP_VALIDATION_COMPLETED` | Pass validation | `workspace_id`, `job_id`, `variant_id`, `correlation_id`, `warnings[]` |
| `MCP_VALIDATION_FAILED` | Fail validation | `workspace_id`, `job_id`, `variant_id`, `correlation_id`, `error_code` (no raw error) |
| `MCP_VALIDATION_INELIGIBLE` | Job status không phù hợp | `workspace_id`, `job_id`, reason code |
| `MCP_TOKEN_PRE_CHECK_FAILED` | Token metadata invalid trước MCP call | `workspace_id`, `job_id`, `channel_account_id` (no token) |
| `MCP_QUOTA_EXCEEDED` | Quota check fail | `workspace_id`, `job_id`, `channel_account_id`, remaining/limit numbers |
| `MCP_VALIDATED_HANDOFF_ENQUEUED` | Outbox event emitted cho US-006 | `workspace_id`, `job_id`, `event_id` |
| `MCP_VALIDATION_DLQ` | Event pushed to DLQ | `workspace_id` nếu có, `error_code` |

### Log Requirements

- Log level: `INFO` cho validation result (pass/fail với sanitized details); `ERROR` cho DB fail/schema invalid.
- Log fields: `workspace_id`, `job_id`, `correlation_id`, `error_code` — **no body text, no token, no raw API response**.
- `redact.ts` phải cover pattern `access_token=...`, `Bearer ...`, token-length strings.

### Metrics (future/Phase 2)

- `mcp_validation_duration_ms` histogram per `channel_account_id`.
- `mcp_validation_pass_rate` gauge per workspace.
- `mcp_quota_remaining` gauge per `channel_account_id`.
- `publish_job_validation_failed_total` counter by error code.

---

## 22. Test Plan

### Unit Tests (`apps/facebook-mcp-server/src/__tests__/`)

| Test Case | Coverage |
|:---|:---|
| `validate_post` — body exactly at 63,206 chars | Pass |
| `validate_post` — body > 63,206 chars | PLATFORM_TEXT_TOO_LONG violation |
| `validate_post` — invalid CTA URL | PLATFORM_LINK_INVALID violation |
| `validate_post` — OAuthException #190 from Graph API | PLATFORM_TOKEN_INVALID violation |
| `validate_post` — OAuthException #463 from Graph API | PLATFORM_TOKEN_EXPIRED violation |
| `validate_post` — Graph API 5xx | Throw transient error (caller handles NACK) |
| `validate_post` — valid content | Pass, empty violations |
| `get_rate_limit_status` — quota available | `quotaExceeded = false` |
| `get_rate_limit_status` — quota exceeded | `quotaExceeded = true` |
| `validate_post` does NOT call POST `/feed` | Regression: no publish side effect |
| Token not in return value | Contract: result has no token field |

### Integration Tests (`apps/orchestrator/src/__tests__/mcpPublishValidationWorker.test.ts`)

| Test Case | Coverage |
|:---|:---|
| Happy path — validation pass, auto emit validated event | `publish_jobs.status = 'validated'`, outbox row created |
| Fail path — token invalid | `validation_failed`, Slack alert sent |
| Fail path — quota exceeded | `validation_failed`, Slack alert sent |
| Fail path — platform constraint violated | `validation_failed` |
| Idempotency — duplicate `publish.facebook.requested` | ACK, no duplicate validation run |
| Idempotency — job already `validated` | ACK immediately |
| Invalid message schema | DLQ + ACK |
| DB fail before commit | NACK, no ACK |
| ACK after Ledger commit | Order: commit → ACK |
| Transient MCP error | NACK → requeue |
| Airtable fail after commit | Ledger committed; compensation path |
| RLS fail-closed | Cross-workspace read denied |
| Tenant isolation (`SET LOCAL`) | Every transaction has workspace context |
| No Graph API call from orchestrator | Static/runtime assertion |
| No token in `PublishFacebookValidatedEvent` | Contract test |

### Contract Tests (`packages/shared-contracts/src/__tests__/mcpContracts.test.ts`)

| Test Case | Coverage |
|:---|:---|
| `PublishFacebookRequestedEvent` — valid schema | Pass |
| `PublishFacebookRequestedEvent` — forbidden fields (body, token) | Rejected |
| `PublishFacebookValidatedEvent` — valid schema | Pass |
| `PublishFacebookValidatedEvent` — forbidden fields (body, token) | Rejected |
| `ValidatePostInput` — no token field | Pass |
| `ValidatePostResult` — no token field in output | Pass |

### Security Tests

| Test Case | Coverage |
|:---|:---|
| No token in `PublishFacebookValidatedEvent` | Contract test |
| No token in logs | Redact test |
| RLS rejects cross-workspace | DB integration test |
| `SET LOCAL` executed before tenant work | DB integration test |
| `validate_post` does not call publish endpoint | MCP server regression test |
| Orchestrator does not call Graph API | Static search + boundary test |
| `mcp_validation_result` JSONB has no token | Ledger integration test |

---

## 23. Rollback Plan

| Phase | Rollback Action |
|:---|:---|
| Migration `0005` failed | Revert migration file; US-004 schema still intact; no US-005 code deployed |
| Worker deployed, DLQ filling | Scale down `mcpPublishValidationWorker`; events stay in `publish.facebook.requested` queue; root cause fix |
| MCP server `validate_post` returning wrong results | Disable MCP validation step via feature flag (`MCP_VALIDATION_ENABLED=false`) → jobs remain `queued`; alert Ops |
| False positive quota exceeded | Update `MAX_DAILY_POSTS_PER_PAGE` env var; admin tool reset quota counter in Ledger |
| False positive token invalid | Admin reconnect Facebook Page via US-011 OAuth flow; re-queue failed jobs via admin script |
| Outbox relay broken (validated jobs not reaching US-006) | Restart outbox relay; `mcp_validation_events` with `status='pending'` retry automatically |
| `validated` jobs stuck (US-006 not deployed yet) | Expected: US-006 consumer not present → jobs sit in `publish.facebook.validated` queue; no data loss |

**No physical DELETE**: mọi rollback dùng status update, không xóa audit rows.

---

## 24. Production Readiness Checklist

- [ ] Migration `db/migrations/0005_us005_mcp_validate_enqueue.sql` applied: ADD COLUMNs to `publish_jobs` + `mcp_validation_events` table + RLS + indexes.
- [ ] Migration ordering verified: `0005` runs after `0004`.
- [ ] RLS policies kiểm tra với cross-workspace query → denied.
- [ ] `SET LOCAL app.current_workspace_id` trong mọi worker transaction.
- [ ] Worker không dùng service-role DB connection.
- [ ] Facebook MCP Server `validate_post` tool implemented và không gọi publish endpoint.
- [ ] Facebook MCP Server `get_rate_limit_status` tool implemented.
- [ ] MCP server token resolution: token chỉ đọc trong MCP server từ secret store.
- [ ] `ValidatePostResult` không chứa raw API response hay token field.
- [ ] RabbitMQ queues `publish.facebook.requested`, `publish.facebook.validated`, DLQs declared.
- [ ] `PublishFacebookRequestedEvent` và `PublishFacebookValidatedEvent` contract tests pass (no-token check).
- [ ] Integration tests pass: happy path, fail path, idempotency, ACK-after-commit, RLS.
- [ ] Redact tests pass cho log output trong orchestrator và MCP server.
- [ ] No Graph API call in orchestrator (static search verified).
- [ ] No publish side effect in `validate_post` tool (regression test).
- [ ] `MAX_DAILY_POSTS_PER_PAGE` env var configured.
- [ ] `FACEBOOK_MCP_SERVER_URL` env var configured trong orchestrator.
- [ ] `SLACK_BOT_TOKEN` + Slack alert channel for validation failures configured.
- [ ] DLQ alert routing đến admin Slack channel.
- [ ] `correlation_id` preserved từ US-004 → US-005 → US-006.
- [ ] Audit log schema phủ đủ 8 audit events documented.
- [ ] Outbox relay service (`mcp_validation_events`) deployed và monitoring.
- [ ] MCP server deployed với secret store access (không hardcode token).
- [ ] `MCP_VALIDATION_ENABLED` feature flag available cho rollback.

---

## 25. Open Questions

| ID | Question | Owner | Priority | Status |
|:---|:---|:---|:---|:---|
| OQ-005-1 | Facebook Graph API có endpoint validation không publish (preview/validate) không? Hay US-005 chỉ apply rules locally? | Tech Lead / BA | P1 | Open — MVP default: apply FB rules locally (text length) + optional Graph API check; document assumption |
| OQ-005-2 | Quota tracking strategy: Ledger-based count vs Graph API header-based? Graph API không expose granular daily post limit clearly. | Tech Lead | P1 | Open — MVP assumption: Ledger count + `MAX_DAILY_POSTS_PER_PAGE` config; fallback to Graph API rate limit error |
| OQ-005-3 | Secret store implementation: HashiCorp Vault, AWS Secrets Manager, hay Infra env var approach? | Admin/IT | P0 | Open — phải resolve trước implement US-005; MCP server design phụ thuộc secret store client |
| OQ-005-4 | `secretRef` format: UUID reference, ARN, hay path string? Cần đồng nhất giữa US-011 (store) và US-005 (read). | Tech Lead | P0 | Open — phải resolve cùng với OQ-005-3; US-011 stores ref, US-005 reads it |
| OQ-005-5 | Khi `validation_failed` do quota exceeded, có cần auto-schedule retry vào ngày hôm sau không? Hay chờ Admin manual? | Product Owner | P2 | Open — MVP default: Slack alert + manual admin action; auto-reschedule là phase sau |
| OQ-005-6 | `scheduled_at` scheduling: US-005 chỉ validate tại thời điểm job đến `validated`; US-006 có thực sự chờ đến `scheduled_at` không hay publish ngay? | Product Owner | P1 | Open — US-006 plan phải clarify; US-005 không ảnh hưởng scheduling logic |
| OQ-005-7 | Khi `auto_publish_enabled = false` (US-004 pass nhưng không tạo publish job), US-005 vẫn có thể được trigger manual không? | Product Owner | P2 | Open — MVP: US-005 chỉ triggered bởi RabbitMQ event; manual trigger thuộc US-008/Admin tooling |
| OQ-005-8 | Facebook Page Publishing permission scopes cần thiết cho `validate_post`: `pages_manage_posts` sufficient không? Cần `pages_read_engagement`? | Admin/IT | P1 | Open — A-002 assumption: cần xác minh trước Sprint 3; MCP server fail closed nếu thiếu scope |

---

## 26. Implementation Task Breakdown

### Phase 1: Contracts & Schema

- [ ] T-001: Tạo `ValidatePostInput`, `ValidatePostResult`, `McpViolationCode`, `McpWarningCode` trong `packages/shared-contracts/src/mcp/validatePost.ts`.
- [ ] T-002: Tạo `GetRateLimitStatusInput`, `RateLimitStatusResult` trong `packages/shared-contracts/src/mcp/rateLimitStatus.ts`.
- [ ] T-003: Tạo `PublishFacebookValidatedEvent` trong `packages/shared-contracts/src/mcp/publishFacebookValidated.ts` (forbidden fields: body, token).
- [ ] T-004: Viết contract tests cho T-001, T-002, T-003 (`packages/shared-contracts/src/__tests__/mcpContracts.test.ts`).
- [ ] T-005: DB migration `db/migrations/0005_us005_mcp_validate_enqueue.sql`: ADD COLUMNs to `publish_jobs` + create `mcp_validation_events` + RLS + indexes.
- [ ] T-006: Verify migration ordering: `0005` dependency check on `0004`.

### Phase 2: Facebook MCP Server Tools

- [ ] T-007: Implement `apps/facebook-mcp-server/src/tools/validatePost.ts`:
  - Secret resolution (stub → real secret store client).
  - Facebook content rules (text length, URL validation).
  - Graph API OAuthException mapping.
  - NO publish endpoint call (regression test required).
- [ ] T-008: Unit tests cho `validatePost.ts` (all violation codes, happy path, token errors, no-publish regression).
- [ ] T-009: Implement `apps/facebook-mcp-server/src/tools/getRateLimitStatus.ts`:
  - Ledger-based quota count (MVP).
  - `MAX_DAILY_POSTS_PER_PAGE` env var.
- [ ] T-010: Unit tests cho `getRateLimitStatus.ts`.
- [ ] T-011: Register tools trong `apps/facebook-mcp-server/src/server.ts`.

### Phase 3: Orchestrator Worker & MCP Client

- [ ] T-012: Implement `apps/orchestrator/src/mcp/facebookMcpClient.ts` (MCP protocol client, không giữ token).
- [ ] T-013: Implement `apps/orchestrator/src/ledger/mcpValidationRepository.ts`:
  - `reloadPublishJob(jobId, workspaceId)`
  - `reloadVariant(variantId, workspaceId)`
  - `reloadChannelAccount(channelAccountId, workspaceId)`
  - `reloadTokenReference(channelAccountId, workspaceId)`
  - `transitionJobStatus(jobId, workspaceId, status, extra)`
  - `persistValidationResult(jobId, workspaceId, result)`
  - `insertValidatedOutbox(outboxEvent)`
- [ ] T-014: Implement `apps/orchestrator/src/workers/mcpPublishValidationWorker.ts`:
  - Schema validate (Zod).
  - Idempotency check.
  - Reload context.
  - Pre-check token from metadata.
  - Call MCP client (quota check + validate_post).
  - Persist result (pass/fail path).
  - Emit validated outbox.
  - Side effects (Slack alert).
  - ACK.
- [ ] T-015: Implement RabbitMQ consumer cho `publish.facebook.requested` (`apps/orchestrator/src/queue/mcpValidationRabbitmqConsumer.ts`).
- [ ] T-016: Implement outbox relay cho `mcp_validation_events`.
- [ ] T-017: Register consumer trong `apps/orchestrator/src/server.ts`.
- [ ] T-018: Update `apps/orchestrator/src/config/env.ts` cho US-005 env vars.

### Phase 4: Integration Tests & Security Gate

- [ ] T-019: Integration tests: happy path, fail paths, idempotency, ACK-after-commit, RLS, no-token checks.
- [ ] T-020: Security gate checklist fill (MCP-001 → MCP-015).
- [ ] T-021: Verify `npm run build` + `npm test` pass.
- [ ] T-022: Static search: confirm no `graph.facebook.com` in `apps/orchestrator/`; confirm no publish endpoint in `validate_post`.

---

## 27. Decisions Log

| ID | Decision | Rationale | Status |
|:---|:---|:---|:---|
| D-US005-1 | US-005 implements `validate_post` + `get_rate_limit_status` only; `publish_post` belongs to US-006 | Clear boundary: US-005 = validate/enqueue; US-006 = execute publish | Accepted |
| D-US005-2 | `enqueue_publish` MCP tool = combination of validate + Ledger job status update (US-005 scope) | Architecture doc names `enqueue_publish` as a tool; US-005 owns the enqueue/prepare phase | Accepted |
| D-US005-3 | US-005 ADD COLUMN to `publish_jobs` (not recreate); migration `0005` runs after `0004` | D-012 from US-004 established minimal schema ownership; US-005 extends | Accepted |
| D-US005-4 | Reuse `publish_jobs.idempotency_key` from US-004; US-005 adds `mcp_validation_idempotency_key` for MCP-level dedup | Two levels of idempotency: job-level (US-004 key) + MCP-validation-level (US-005 key) | Accepted |
| D-US005-5 | MVP quota strategy: Ledger count + `MAX_DAILY_POSTS_PER_PAGE` env var; Graph API rate limit error as fallback | OQ-005-2 not fully resolved; Ledger-based is deterministic and testable without Graph API | Tentative — confirm before implementation |
| D-US005-6 | Token not returned from MCP server to orchestrator; orchestrator only sees sanitized `ValidatePostResult` | Core security boundary from Architecture doc §6: MCP owns token, AI Agent never stores long-lived platform tokens | Accepted |
| D-US005-7 | No publish side effect in `validate_post` tool; regression test required | US-006 scope boundary; US-005 must never call POST /feed | Accepted |
| D-US005-8 | `validation_failed` due to permanent error (token/permission) → ACK immediately + Slack alert, no retry | Retrying permanent errors wastes quota and hides real issue; admin must intervene | Accepted |

---

*Plan Author: Senior Technical Planner (Antigravity)*
*Date: 2026-06-01*
*Based on: US-004 implementation plan, US-004 security release gate, Architecture doc v1, Product Backlog v1, Function Flow Logic Register v1*
*Docs read: 06_Architecture_Composability.md, 11_Coding_Convention.md, 04_Product_Backlog.md, 05_Function_Flow_Logic_Register.md, 03_SRS_MediaOps_Composability.md, 07_Risk_Assumption_Decision_Log.md, US-004-implementation-plan.md, US-004-security-release-gate.md, REPORT-us-004-implementation-2026-06-01.md*
