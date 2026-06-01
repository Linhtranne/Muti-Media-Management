# US-004 Implementation Plan: Policy Engine Publish Guardrail

## 1. Title

**US-004 — Policy Engine kiểm tra trước khi publish**

## 2. Context

US-004 là bước bảo vệ cuối cùng trong chuỗi Orchestration & AI Middleware trước khi một publish job được tạo ra. Flow hiện tại:

- **US-001**: Airtable Control Plane thiết lập campaign/post workflow.
- **US-002**: Webhook receiver nhận Post Approved, tạo workflow stub, publish references-only message đến `ai.compose.facebook.requested`.
- **US-003**: AI Composer worker consume message, tạo Facebook variant, lưu `content_variants` với `policy_status = 'pending_policy'`, và write transactional outbox event `policy.evaluate.requested` vào `policy_handoff_events`.
- **US-004 (this)**: Policy Engine worker consume `policy.evaluate.requested`, reload variant từ Ledger, chạy tất cả rule checks, và quyết định `allowed` (→ tạo publish job stub → US-005) hoặc `blocked` (→ update Airtable `Needs Review` + Slack alert).

US-004 là lớp guardrail giữa AI generation và MCP publish execution. Không có rule pass nào đồng nghĩa là không có publish job nào được tạo.

## 3. Goal

Implement Policy Engine worker xử lý `policy.evaluate.requested` events để:

1. Reload variant và context từ Postgres Ledger (RLS-scoped).
2. Chạy đầy đủ bộ policy checks (approval, token, content, channel).
3. Lưu `publish_rule_results` vào Ledger với toàn bộ checks/blockers/warnings.
4. Nếu pass: tạo publish job stub và publish `publish.facebook.requested` message.
5. Nếu block: cập nhật Airtable status `Needs Review`, gửi Slack alert.
6. ACK RabbitMQ chỉ sau khi Ledger state được commit bền vững.

## 4. Non-goals

- Không implement Facebook Graph API calls (thuộc US-005/US-006).
- Không implement MCP `validate_post` hay `enqueue_publish` tool logic (thuộc US-005).
- Không implement Slack slash command handler (thuộc US-008).
- Không implement comment sync (thuộc US-007).
- Không implement LinkedIn/X/YouTube publish (future MCP servers).
- Không implement auto-approve flow vượt quá điều kiện `auto_approve_enabled = true` (Manager/Admin-only config).
- Không implement báo cáo campaign (thuộc US-012).

## 5. Dependencies from US-001 to US-003

| Dependency | Source | Required For US-004 |
|:---|:---|:---|
| `workflow_runs` table | US-002 | Transition sang `policy_evaluation_completed`/`policy_evaluation_failed` |
| `content_variants` table | US-003 | Reload variant body/hashtags/cta_url để check |
| `ai_generation_runs` table | US-003 | Metadata context về AI run |
| `policy_handoff_events` (outbox) | US-003 | Input trigger queue event |
| `channel_account` + `token_reference` | US-011 | Kiểm tra token hợp lệ |
| `publish_rule_results` table | US-004 (new) | Lưu kết quả policy check |
| `publish_jobs` table | US-004 (new migration) | US-004 tạo stub khi pass; US-005 mở rộng thêm fields |
| `POLICY_VERSION` constant | `packages/policy-engine/src/version.ts` | Idempotency key formula |
| RabbitMQ `policy.evaluate.requested` queue | US-003 | Input message |
| RabbitMQ `publish.facebook.requested` queue | US-005 | Output message khi pass |
| RabbitMQ `alerts.slack.send` queue | US-007/US-008 | Output message khi block |
| Airtable field mapping config | US-001/US-002 | Update status `Needs Review` khi block |
| Forbidden terms seed config | `packages/policy-engine/src/forbiddenTerms.ts` | Content check; workspace có thể override |
| `POLICY_BLOCK_SLACK_CHANNEL_ID` env var | Infra | Slack alert channel cho policy block |

### Critical state assumptions from US-003

Khi US-004 nhận event, Ledger phải có:
- `workflow_runs.status = 'ai_generation_completed'`
- `ai_generation_runs.status = 'completed'`
- `content_variants.approval_status = 'needs_review'`
- `content_variants.policy_status = 'pending_policy'`

Nếu không đủ điều kiện → US-004 ACK ngay và bỏ qua (ineligible event).

## 6. Scope

**In scope:**
- Policy Engine worker (`packages/policy-engine/`) xử lý `policy.evaluate.requested`.
- Tất cả rule checks: approval, token/channel, content constraints, forbidden terms, UTM/CTA.
- Lưu `publish_rule_results` vào Postgres Ledger.
- Tạo `publish_jobs` stub khi pass (status `queued`).
- Publish `publish.facebook.requested` message (references-only) khi pass.
- Update Airtable status `Needs Review` khi block.
- Publish `alerts.slack.send` message khi block.
- Audit logging mọi policy result.
- Idempotency: không chạy policy check 2 lần cho cùng một variant version.
- DLQ handling cho malformed events.
- Worker ACK chỉ sau khi Ledger commit.

**Out of scope:**
- Platform API calls (Facebook Graph API ở trong MCP server).
- Prompt rewrite hay AI re-generation.
- Slack command handler.
- Token refresh.

## 7. User Story

> **Là Manager**, tôi muốn hệ thống kiểm tra rule trước khi publish để tránh đăng sai, thiếu approval hoặc vi phạm rule nội dung.

**Persona**: Manager (và Admin) là người config policy rules. System là actor thực hiện check tự động.

**Trigger**: AI Composer (US-003) hoàn thành variant và write outbox event `policy.evaluate.requested`.

## 8. Acceptance Criteria

| AC | Description | Testable Signal |
|:---|:---|:---|
| AC1 | Block khi thiếu approval | `content_variants.approval_status != 'needs_review'` → `publish_rule_results.allowed = false`, blocker `MISSING_APPROVAL` |
| AC2 | Block khi thiếu Facebook token hợp lệ | `channel_account` không có active token → blocker `INVALID_CHANNEL_TOKEN` |
| AC3 | Block khi có forbidden term | Variant body/hashtags chứa term trong forbidden list → blocker `FORBIDDEN_TERM_DETECTED` |
| AC4 | Warning khi thiếu UTM nhưng không block nếu rule config `warn_only = true` | `publish_rule_results.warnings` chứa `MISSING_UTM`; `allowed = true` nếu không có blocker khác |
| AC5 | Nếu pass tất cả checks, tạo `publish_jobs` stub với status `queued` | Row tồn tại trong `publish_jobs` với đúng `workspace_id`, `post_id`, `variant_id`, `channel_account_id`, `idempotency_key` |
| AC6 | Nếu pass, publish `publish.facebook.requested` references-only message vào RabbitMQ | Message chứa `job_id`, `workspace_id`, `variant_id`, không chứa body/token/secret |
| AC7 | Nếu block, cập nhật Airtable Post status sang `Needs Review` | Airtable record field `status` = `Needs Review`; field `policy_blockers` chứa danh sách blockers |
| AC8 | Nếu block, gửi Slack alert vào configured channel | Slack message chứa `post_id`, danh sách blockers, link Airtable record |
| AC9 | Mọi policy result được audit | `audit_log` row với action `policy_check_completed` tồn tại sau mỗi evaluation |
| AC10 | Cùng `idempotency_key` không chạy policy check 2 lần | Nếu `publish_rule_results` đã tồn tại → ACK ngay, không overwrite |
| AC11 | `auto_publish_enabled = false` → không tạo publish job dù pass | Job stub không được tạo; workflow dừng ở `policy_evaluation_completed` chờ manual |
| AC12 | Worker ACK chỉ sau khi Ledger commit thành công | Test: DB fail trước commit → ACK không được gọi |

**Business Rules (từ Backlog):**
- BR1: Auto publish chỉ chạy nếu `auto_publish_enabled = true` **và** `auto_approve_enabled = true`.
- BR2: Role `manager` hoặc `admin` mới bật auto-approve.
- BR3: Mọi rule result phải được audit.

## 9. Architecture Fit

Policy Engine nằm trong **Orchestration & AI Middleware** layer:

```
Airtable (Control Plane)
    │ webhook
    ▼
Webhook Receiver (US-002)
    │ ai.compose.facebook.requested
    ▼
AI Composer Worker (US-003)
    │ policy.evaluate.requested (transactional outbox → RabbitMQ)
    ▼
Policy Engine Worker (US-004)  ← THIS STORY
    │ Pass → publish.facebook.requested
    │ Block → alerts.slack.send + Airtable update
    ▼
Facebook MCP Server (US-005/US-006)
```

**Layer boundaries:**
- `packages/policy-engine/`: chứa rule logic (pure functions, testable).
- `apps/orchestrator/src/workers/policyWorker.ts`: RabbitMQ consumer + Ledger persistence.
- Platform API (Facebook Graph) chỉ nằm trong `apps/facebook-mcp-server/`.
- Orchestrator không gọi Graph API trực tiếp.

## 10. Sequence / Flow

```
1. [RabbitMQ] policy.evaluate.requested message arrives at policyWorker
2. [Worker] Validate message schema (Zod) → invalid → DLQ → ACK original
3. [Worker] Start Postgres transaction
4. [DB] SET LOCAL app.current_workspace_id = :workspace_id
5. [DB] Reload content_variants WHERE id = :content_variant_id AND workspace_id = :workspace_id
6. [DB] Check policy_status = 'pending_policy' (idempotency guard) → already processed → ACK
7. [DB] Transition content_variants.policy_status = 'policy_evaluating'
8. [DB] Reload channel_account + token_reference (active token check)
9. [DB] Reload workspace config (auto_publish_enabled, auto_approve_enabled)
10. [DB] COMMIT transition (before external calls)
11. [PolicyEngine] Run rule checks (pure functions, no I/O):
    - check_approval_status(variant)
    - check_channel_token(channel_account, token_ref)
    - check_content_constraints(variant, platform='facebook')
    - check_forbidden_terms(variant, forbidden_terms_config)
    - check_cta_utm(variant, post_source)
    - check_auto_publish_config(workspace_config)
12. [PolicyEngine] Aggregate → { allowed, blockers, warnings, checks }
13. [DB Transaction] Write publish_rule_results row
14. [DB] Update content_variants.policy_status:
    - Pass → 'policy_approved'
    - Block → 'policy_rejected'
15. [DB] Update workflow_runs.status:
    - Pass → 'policy_evaluation_completed'
    - Block → 'policy_evaluation_blocked'
16. [DB] Write audit_log (policy_check_completed)
    IF PASS AND auto_publish_enabled AND auto_approve_enabled:
17.   [DB] Insert publish_jobs stub (status = 'queued', idempotency_key)
18.   [DB] Insert outbox event: publish.facebook.requested
19. [DB] COMMIT all above atomically
20. IF PASS (auto-publish):
21.   [Outbox Relay] Publish publish.facebook.requested to RabbitMQ
22. IF BLOCKED:
23.   [Airtable] PATCH Post status → 'Needs Review', policy_blockers field
24.   [Queue] Publish alerts.slack.send message
25. [Worker] ACK RabbitMQ message
```

**Fail-closed rule**: nếu bất kỳ DB step nào fail trước commit ở step 19 → NACK/retry; không ACK.

## 11. Data Contracts

### 11.1. Input: Policy Evaluate Requested Event (from US-003)

```typescript
// packages/shared-contracts/src/policy/policyEvaluate.ts
export interface PolicyEvaluateRequestedEvent {
  eventId: string;                          // UUID v4
  eventType: 'policy.evaluate.requested';
  workspaceId: string;
  correlationId: string;
  workflowRunId: string;
  aiGenerationRunId: string;
  contentVariantId: string;
  airtableRecordId: string;
  platform: 'facebook';
  promptVersion: string;
  approvedVersion: number;
  idempotencyKey: string;                   // policy.evaluate.requested:{workspace_id}:{content_variant_id}:{policy_version}
  createdAt: string;                        // ISO datetime
}
```

### 11.2. Policy Rule Result

```typescript
// packages/policy-engine/src/types.ts
export interface PolicyRuleResult {
  resultId: string;        // UUID
  workspaceId: string;
  postId: string;
  variantId: string;
  workflowRunId: string;
  allowed: boolean;
  blockers: PolicyBlocker[];
  warnings: PolicyWarning[];
  checks: PolicyCheck[];
  createdAt: string;
}

export type PolicyBlockerCode =
  | 'MISSING_APPROVAL'
  | 'INVALID_CHANNEL_TOKEN'
  | 'FORBIDDEN_TERM_DETECTED'
  | 'CONTENT_TOO_LONG'
  | 'MISSING_CTA_URL'
  | 'AUTO_PUBLISH_DISABLED'
  | 'AUTO_APPROVE_DISABLED'
  | 'CHANNEL_ACCOUNT_INACTIVE'
  | 'PLATFORM_TEXT_CONSTRAINT_VIOLATED';

export type PolicyWarningCode =
  | 'MISSING_UTM'
  | 'HASHTAG_COUNT_HIGH'
  | 'CTA_URL_UNSAFE';

export interface PolicyBlocker {
  code: PolicyBlockerCode;
  detail: string;            // sanitized, no secrets
}

export interface PolicyWarning {
  code: PolicyWarningCode;
  detail: string;
}

export interface PolicyCheck {
  rule: string;
  passed: boolean;
  detail?: string;
}
```

### 11.3. Output: Publish Job Stub (khi pass)

```typescript
export interface PublishJobStub {
  jobId: string;
  workspaceId: string;
  postId: string;
  variantId: string;
  channelAccountId: string;
  scheduledAt: string;       // ISO datetime từ Airtable Post
  status: 'queued';
  idempotencyKey: string;    // publish.facebook.job:{workspace_id}:{post_id}:{approved_version}:{policy_version}
  queueMessageId?: string;
}
```

### 11.4. Output: Publish Facebook Requested Event (RabbitMQ, references-only)

```typescript
export interface PublishFacebookRequestedEvent {
  eventId: string;
  eventType: 'publish.facebook.requested';
  workspaceId: string;
  correlationId: string;
  workflowRunId: string;
  jobId: string;             // pointer to publish_jobs row
  variantId: string;         // pointer to content_variants row
  channelAccountId: string;  // pointer to channel_account row
  scheduledAt: string;
  idempotencyKey: string;
  createdAt: string;
  // NO: body, hashtags, cta_url, token, secret, bearer
}
```

## 12. RabbitMQ Events

| Queue / Exchange | Direction | Producer | Consumer | Payload Rule |
|:---|:---|:---|:---|:---|
| `policy.evaluate.requested` | Input | US-003 outbox relay | US-004 worker | References-only (IDs only) |
| `publish.facebook.requested` | Output (pass) | US-004 outbox relay | US-005 worker | References-only (IDs only) |
| `alerts.slack.send` | Output (block) | US-004 worker | Slack alert worker | Sanitized alert text + links |
| `policy.evaluate.requested.dlq` | DLQ | US-004 consumer | Admin tooling | Malformed/exhausted events |

**DLQ rule**: event bị reject do schema invalid hoặc quá số lần retry → đẩy vào DLQ → gửi `alerts.slack.send` admin notification.

**Outbox table cho publish handoff**: `publish_handoff_events` (tương tự `policy_handoff_events` của US-003).

## 13. Database / Ledger Changes

### 13.1. New Table: `publish_rule_results`

```sql
CREATE TABLE publish_rule_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  variant_id UUID NOT NULL REFERENCES content_variants(id) ON DELETE RESTRICT,
  workflow_run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE RESTRICT,
  ai_generation_run_id UUID NOT NULL REFERENCES ai_generation_runs(id) ON DELETE RESTRICT,
  allowed BOOLEAN NOT NULL,
  blockers JSONB NOT NULL DEFAULT '[]'::jsonb,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  checks JSONB NOT NULL DEFAULT '[]'::jsonb,
  policy_version TEXT NOT NULL,           -- version of policy rules applied
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_policy_result_per_variant UNIQUE (workspace_id, variant_id, policy_version)
);

ALTER TABLE publish_rule_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY prr_workspace_isolation ON publish_rule_results
  FOR ALL
  USING (workspace_id = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));

CREATE INDEX idx_prr_variant ON publish_rule_results (workspace_id, variant_id);
CREATE INDEX idx_prr_post ON publish_rule_results (workspace_id, post_id);
```

### 13.2. New Table: `publish_handoff_events` (Transactional Outbox)

```sql
CREATE TABLE publish_handoff_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  event_id UUID NOT NULL UNIQUE,
  event_type TEXT NOT NULL DEFAULT 'publish.facebook.requested',
  correlation_id UUID NOT NULL,
  workflow_run_id UUID NOT NULL,
  job_id UUID NOT NULL REFERENCES publish_jobs(id) ON DELETE RESTRICT,
  variant_id UUID NOT NULL,
  channel_account_id TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'published', 'failed'
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ NULL
);

ALTER TABLE publish_handoff_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY phe_workspace_isolation ON publish_handoff_events
  FOR ALL
  USING (workspace_id = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));

CREATE INDEX idx_phe_pending ON publish_handoff_events (status, created_at)
  WHERE status = 'pending';
```

### 13.3. Modified: `content_variants` — new policy_status values

Thêm enum values (nếu dùng Postgres enum) hoặc CHECK constraint:
- Existing: `'pending_policy'`
- New: `'policy_evaluating'`, `'policy_approved'`, `'policy_rejected'`

### 13.4. Modified: `workflow_runs` — new status values

- New: `'policy_evaluation_completed'`, `'policy_evaluation_blocked'`, `'policy_evaluation_failed'`

### 13.5. New Table: `publish_jobs` (minimal stub — Decision OQ-004-6)

> **Chốt (Decision OQ-004-6):** US-004 tự tạo migration tối thiểu cho `publish_jobs`. US-005 mở rộng thêm fields (quota tracking, retry_count, last_error, v.v.) khi implement.

Migration file: `db/migrations/0004_us004_policy_publish_guardrail.sql` (bao gồm cả `publish_rule_results`, `publish_handoff_events`, và `publish_jobs` minimal).

```sql
-- Minimal publish_jobs created by US-004; US-005 will ADD COLUMN as needed.
CREATE TABLE publish_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  variant_id UUID NOT NULL REFERENCES content_variants(id) ON DELETE RESTRICT,
  channel_account_id TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',  -- queued | publishing | published | failed | cancelled | needs_review
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE publish_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY pj_workspace_isolation ON publish_jobs
  FOR ALL
  USING (workspace_id = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));

CREATE INDEX idx_pj_workspace_status ON publish_jobs (workspace_id, status);
CREATE INDEX idx_pj_post ON publish_jobs (workspace_id, post_id);

-- Insert stub (used by US-004 policy worker on pass):
-- INSERT INTO publish_jobs (workspace_id, post_id, variant_id, channel_account_id,
--   scheduled_at, status, idempotency_key)
-- VALUES (:workspace_id, :post_id, :variant_id, :channel_account_id,
--   :scheduled_at, 'queued', :idempotency_key)
-- ON CONFLICT (idempotency_key) DO NOTHING;
```

## 14. MCP Server Responsibilities

US-004 **không gọi** Facebook MCP Server. Policy Engine chạy thuần logic:

- Không gọi `validate_post`, `enqueue_publish`, `publish_post`.
- Không gọi Facebook Graph API.
- Không gọi bất kỳ platform API nào.

MCP Server được gọi bởi US-005/US-006 worker sau khi publish job đã được tạo.

## 15. Orchestrator Responsibilities

Orchestrator (`apps/orchestrator/src/workers/policyWorker.ts`):

1. **Subscribe** `policy.evaluate.requested` queue.
2. **Validate** message schema (Zod) → invalid → DLQ → ACK.
3. **Idempotency check**: query `publish_rule_results` by `idempotency_key` → exists → ACK.
4. **Reload** context từ Ledger (variant, channel_account, workspace config).
5. **Invoke** Policy Engine (packages/policy-engine) với context đã reload.
6. **Persist** kết quả vào Ledger trong một transaction.
7. **Side effects** (Airtable update, Slack alert) sau Ledger commit.
8. **ACK** chỉ sau khi Ledger commit và side effects ghi nhận.

## 16. Policy Engine Responsibilities

`packages/policy-engine/src/`:

| Rule Function | Check | Blocker/Warning |
|:---|:---|:---|
| `checkApprovalStatus(variant)` | `variant.approval_status === 'needs_review'` | MISSING_APPROVAL |
| `checkChannelToken(channelAccount, tokenRef)` | Token tồn tại, `token_status = 'active'`, chưa expired | INVALID_CHANNEL_TOKEN |
| `checkChannelAccountActive(channelAccount)` | `channel_account.status = 'active'` | CHANNEL_ACCOUNT_INACTIVE |
| `checkFacebookTextLength(variant)` | body ≤ 63,206 chars (Facebook limit) | PLATFORM_TEXT_CONSTRAINT_VIOLATED |
| `checkForbiddenTerms(variant, config)` | body + hashtags không chứa forbidden terms (case-insensitive, Unicode-normalized) | FORBIDDEN_TERM_DETECTED |
| `checkCtaUrl(variant, sourcePost)` | CTA URL hợp lệ, UTM preserved nếu source có UTM | MISSING_CTA_URL |
| `checkUtmPresence(variant, config)` | UTM params có mặt | MISSING_UTM (warning) |
| `checkAutoPublishConfig(workspaceConfig)` | `auto_publish_enabled = true` AND `auto_approve_enabled = true` (per-workspace) | AUTO_PUBLISH_DISABLED / AUTO_APPROVE_DISABLED |
| `checkHashtagCount(variant)` | hashtags.length ≤ 10 | HASHTAG_COUNT_HIGH (warning) |

**Design rules:**
- Tất cả rule functions là **pure functions** (no I/O, no side effects).
- Input: context object loaded bởi orchestrator.
- Output: `PolicyRuleResult` object.
- Tests: unit test từng rule function độc lập.

**`POLICY_VERSION` constant** (Decision OQ-004-2):
```typescript
// packages/policy-engine/src/version.ts
export const POLICY_VERSION = 'policy-facebook-v1' as const;
export type PolicyVersion = typeof POLICY_VERSION;
```
- Export từ `version.ts`, không hardcode inline trong worker.
- Idempotency keys sử dụng `POLICY_VERSION` để đảm bảo deterministic deduplication.
- Khi rule set thay đổi breaking → bump version string; existing idempotency records giữ nguyên.

**Forbidden Terms Seed** (Decision OQ-004-1):
```typescript
// packages/policy-engine/src/forbiddenTerms.ts
export const DEFAULT_FORBIDDEN_TERMS: readonly string[] = [
  'chính trị nhạy cảm',
  'bạo lực',
  'lừa đảo',
  'cam kết lợi nhuận',
  'thuốc chữa khỏi',
  'thù ghét',
  'kỳ thị',
  '18+',
  'cờ bạc',
  'bản quyền',
] as const;

// Workspace có thể override bằng cách cung cấp list riêng từ workspace config.
// checkForbiddenTerms nhận merged list: DEFAULT_FORBIDDEN_TERMS + workspace override.
// Không log raw forbidden term matched; chỉ log code + count + category nếu cần.
```
- List trên là conservative seed cho MVP, unblock implementation trong khi BA/Marketing review.
- Product/Marketing có thể thêm/bớt qua workspace config sau; không cần redeploy.
- `checkForbiddenTerms` normalize Unicode (NFC) và lowercase trước khi compare.

## 17. Error Handling

| Case | Detection | Action | Ledger Status | RabbitMQ |
|:---|:---|:---|:---|:---|
| Valid policy pass | All checks pass | Create publish_jobs + outbox, commit | `policy_approved` | ACK after commit |
| Valid policy blocked | ≥1 blocker | Write rule_result, update Airtable, Slack alert | `policy_rejected` | ACK after commit |
| Ineligible event (already processed) | `publish_rule_results` idempotency key exists | ACK, no-op | Unchanged | ACK |
| Invalid message schema | Zod validation fail | Write to DLQ, ACK original | N/A | DLQ + ACK |
| Variant not found / wrong status | DB query return empty / wrong policy_status | ACK with audit log `policy_ineligible` | Unchanged | ACK |
| Airtable update fail (after Ledger commit) | HTTP error | Retry async, mark `airtable_sync_retry_needed`, write compensating audit | Ledger remains committed | Already ACKed |
| Slack alert fail (after Ledger commit) | Network error | Retry via `alerts.slack.send` queue | Ledger remains committed | Already ACKed |
| DB fail before commit | Transaction error | NACK/requeue | Unchanged | NACK |
| Publish job idempotency conflict | Unique constraint violation | Treat as already enqueued, commit remaining | `policy_approved` | ACK |
| Exhausted retries | retry_count > MAX_RETRIES | DLQ + admin Slack alert | `policy_evaluation_failed` | DLQ |

## 18. Retry / DLQ Strategy

- **Transient errors** (DB timeout, network): NACK → requeue với exponential backoff (max 5 retries).
- **Permanent errors** (schema invalid, payload corrupt): DLQ ngay lập tức.
- **DLQ action**: ghi audit log + gửi `alerts.slack.send` admin notification.
- **Airtable/Slack side effects**: retry async độc lập, không block ACK chính.
- **Max retry per message**: 5 lần với backoff 1s, 2s, 4s, 8s, 16s.

## 19. Idempotency Strategy

> **Chốt (Decision OQ-004-2):** `POLICY_VERSION` lấy từ constant `packages/policy-engine/src/version.ts`, không hardcode inline.

| Level | Key Formula | Storage |
|:---|:---|:---|
| Policy evaluation | `policy.evaluate.requested:{workspace_id}:{content_variant_id}:{POLICY_VERSION}` | `publish_rule_results.idempotency_key` UNIQUE constraint |
| Publish job creation | `publish.facebook.job:{workspace_id}:{post_id}:{approved_version}:{POLICY_VERSION}` | `publish_jobs.idempotency_key` UNIQUE + ON CONFLICT DO NOTHING |
| Publish handoff event | `publish.facebook.handoff:{workspace_id}:{job_id}` | `publish_handoff_events.idempotency_key` UNIQUE |

**Rationale publish job key bao gồm `POLICY_VERSION`**: nếu policy version bump (rule thay đổi breaking), cùng post/approved_version có thể cần re-evaluate và re-create job với policy mới. Key bao gồm version ngăn false-positive dedup.

**Deduplication flow**:
1. Worker checks `publish_rule_results.idempotency_key` trước khi bắt đầu.
2. Nếu tồn tại → ACK ngay, no-op.
3. Nếu `content_variants.policy_status != 'pending_policy'` → ACK ngay (đã xử lý).

## 20. Security Requirements

| Requirement | Implementation |
|:---|:---|
| Tenant isolation | `SET LOCAL app.current_workspace_id = :workspace_id` ở đầu mỗi DB transaction |
| RLS enforced | RLS policies với USING + WITH CHECK cho `publish_rule_results`, `publish_handoff_events`, `publish_jobs` |
| Normal worker không dùng service role | DB connection rejects service-role/bypass markers |
| No raw token in RabbitMQ payload | `PublishFacebookRequestedEvent` chứa references only; test contract rejects token fields |
| No raw token in logs | `redact.ts` áp dụng toàn bộ log output |
| No raw token in audit metadata | `audit_log.metadata` chứa only IDs, codes, sanitized details |
| No platform API từ orchestrator | Policy Engine không gọi Facebook/Airtable token endpoint |
| Forbidden terms không log raw match | `checkForbiddenTerms` chỉ log code + count, không log matched term string trong audit |
| `auto_approve_enabled` per-workspace | US-004 chỉ đọc config; việc thay đổi config thuộc US-008/US-010 (manager/admin only) |
| Slack alert graceful degradation | Nếu `POLICY_BLOCK_SLACK_CHANNEL_ID` thiếu: persist Ledger + Airtable bình thường, tạo audit `alert_pending_config`, không fail policy transaction |
| Fail closed for publish | Nếu token status không xác định được → block |

## 21. Observability Requirements

| Signal | Implementation |
|:---|:---|
| Audit events | `POLICY_CHECK_COMPLETED`, `POLICY_CHECK_BLOCKED`, `POLICY_INELIGIBLE`, `PUBLISH_JOB_STUB_CREATED`, `PUBLISH_HANDOFF_ENQUEUED` |
| Log level | INFO cho pass/block result (sanitized); ERROR cho DB fail/schema invalid |
| Log fields | `workspace_id`, `correlation_id`, `content_variant_id`, `job_id` (no body text, no token) |
| Metrics (future) | Policy check duration, pass rate, block rate per workspace (Prometheus counter) |
| Alerting | DLQ events → Slack admin alert via `alerts.slack.send` |
| Trace | `correlation_id` preserved qua toàn bộ flow từ US-002 → US-004 |

## 22. Test Plan

### Unit Tests (`packages/policy-engine/src/__tests__/`)

| Test Case | Coverage |
|:---|:---|
| `checkApprovalStatus` — missing approval | MISSING_APPROVAL blocker |
| `checkChannelToken` — expired token | INVALID_CHANNEL_TOKEN blocker |
| `checkChannelToken` — active token | No blocker |
| `checkForbiddenTerms` — term in body | FORBIDDEN_TERM_DETECTED blocker |
| `checkForbiddenTerms` — term in hashtags | FORBIDDEN_TERM_DETECTED blocker |
| `checkForbiddenTerms` — clean content | No blocker |
| `checkFacebookTextLength` — 63206 chars | Exactly at limit, pass |
| `checkFacebookTextLength` — over limit | PLATFORM_TEXT_CONSTRAINT_VIOLATED |
| `checkCtaUrl` — missing CTA | MISSING_CTA_URL blocker |
| `checkCtaUrl` — valid CTA with UTM | Pass |
| `checkCtaUrl` — UTM mutated | Warning or blocker per config |
| `checkUtmPresence` — no UTM, warn_only config | MISSING_UTM warning, allowed=true |
| `checkAutoPublishConfig` — disabled | AUTO_PUBLISH_DISABLED blocker |
| Multiple blockers aggregated | `allowed=false`, blockers array has all |

### Integration Tests (`apps/orchestrator/src/__tests__/policyWorker.test.ts`)

| Test Case | Coverage |
|:---|:---|
| Happy path — all checks pass, auto_publish enabled | Publish job created, handoff published |
| Happy path — all checks pass, auto_publish disabled | Rule result saved, no publish job |
| Block path — forbidden term | Rule result blocked, Airtable updated, Slack alert sent |
| Block path — invalid token | Rule result blocked |
| Idempotency — duplicate event | ACK, no duplicate rule_result |
| Invalid message schema | DLQ + ACK |
| DB fail before commit | NACK, no ACK |
| ACK after Ledger commit | Order verified: commit → ACK |
| Ineligible event (wrong policy_status) | ACK, no processing |
| Airtable fail after commit | Ledger committed, sync_retry_needed=true, compensating audit |
| RLS fail-closed | Cross-workspace read denied |
| Tenant isolation (`SET LOCAL`) | Every transaction has workspace context |

### Contract Tests (`packages/shared-contracts/src/__tests__/policyContracts.test.ts`)

| Test Case | Coverage |
|:---|:---|
| `PolicyEvaluateRequestedEvent` — valid schema | Pass |
| `PolicyEvaluateRequestedEvent` — forbidden fields (body, token) | Rejected |
| `PublishFacebookRequestedEvent` — valid schema | Pass |
| `PublishFacebookRequestedEvent` — forbidden fields (body, token) | Rejected |

### Security Tests

| Test Case | Coverage |
|:---|:---|
| No token in `PublishFacebookRequestedEvent` | Contract test |
| No token in logs | Redact test |
| RLS rejects cross-workspace | DB integration test |
| `SET LOCAL` executed before tenant work | DB integration test |
| Forbidden term detection case-insensitive | Unit test |

## 23. Rollback Plan

| Phase | Rollback Action |
|:---|:---|
| DB Migration failed | Revert migration; no code deployed yet |
| Policy worker deployed, DLQ filling | Scale down worker, events stay in queue; root cause fix |
| Airtable update logic broken | Disable Airtable update via feature flag; alert Ops; events still ACKed normally |
| False positive blocking (wrong forbidden terms) | Update forbidden terms config (env/DB config); re-queue blocked variants via admin tool |
| Publish job stub incorrectly created | Admin script to mark jobs `cancelled`; re-evaluate manually |
| Outbox relay broken (jobs not reaching MCP) | Outbox relay restart; pending rows retry automatically |

**No physical DELETE**: mọi rollback dùng status update, không xóa audit rows.

## 24. Production Readiness Checklist

- [ ] Migration `db/migrations/0004_us004_policy_publish_guardrail.sql` applied: `publish_rule_results`, `publish_handoff_events`, `publish_jobs` (minimal) + RLS + indexes.
- [ ] RLS policies kiểm tra với cross-workspace query → denied.
- [ ] `SET LOCAL app.current_workspace_id` trong mọi worker transaction.
- [ ] Worker không dùng service-role DB connection.
- [ ] RabbitMQ queues `policy.evaluate.requested`, `publish.facebook.requested`, DLQs declared.
- [ ] `packages/policy-engine/src/version.ts` export `POLICY_VERSION = 'policy-facebook-v1'`.
- [ ] `packages/policy-engine/src/forbiddenTerms.ts` có DEFAULT_FORBIDDEN_TERMS seed list (10 terms).
- [ ] `packages/policy-engine/` unit tests pass (≥ 95% coverage).
- [ ] Integration tests pass cho happy path, block path, idempotency, ACK-after-commit.
- [ ] Contract tests xác nhận no-token trong `PublishFacebookRequestedEvent`.
- [ ] Redact tests pass cho log output.
- [ ] `checkForbiddenTerms` Unicode-normalize và lowercase trước compare; không log raw matched term.
- [ ] `POLICY_BLOCK_SLACK_CHANNEL_ID` env var: set nếu có; thiếu → graceful degradation (audit `alert_pending_config`).
- [ ] `SLACK_BOT_TOKEN` configured.
- [ ] Airtable field mapping config validated (field name cho `Needs Review` status).
- [ ] `auto_publish_enabled` và `auto_approve_enabled` per-workspace flags validated (manager/admin-only modify).
- [ ] DLQ alert routing đến admin Slack channel.
- [ ] `correlation_id` preserved qua flow.
- [ ] Audit log schema phủ đủ mọi event (6 audit events documented).
- [ ] Outbox relay service deployed và monitoring.

## 25. Open Questions

| ID | Question | Owner | Status | Decision |
|:---|:---|:---|:---|:---|
| OQ-004-1 | Danh sách forbidden terms ban đầu là gì? | BA/Marketing | ✅ **Resolved** | Seed 10 terms trong `forbiddenTerms.ts`; workspace override sau; không block implementation |
| OQ-004-2 | `policy_version` source? | Tech Lead | ✅ **Resolved** | Constant `POLICY_VERSION = 'policy-facebook-v1'` trong `packages/policy-engine/src/version.ts`; không dùng hardcode inline |
| OQ-004-3 | `auto_approve_enabled` scope và permissions? | Product Owner | ✅ **Resolved** | Per-workspace; US-004 chỉ đọc và fail closed; thay đổi config thuộc US-008/US-010 (manager/admin only) |
| OQ-004-4 | Slack alert channel cho policy block? | SMM/Ops | ✅ **Resolved** | Env var `POLICY_BLOCK_SLACK_CHANNEL_ID`; thiếu → graceful degradation + audit `alert_pending_config`; không fail policy transaction |
| OQ-004-5 | Khi `auto_publish_enabled = false`, cần Slack notify cho Manager không? | Product Owner | 🟡 Open | Chưa chốt; hiện tại: workflow dừng ở `policy_evaluation_completed`, không auto-notify; có thể add ở phase sau |
| OQ-004-6 | `publish_jobs` table: US-004 tự tạo migration hay chờ US-005? | Tech Lead | ✅ **Resolved** | US-004 tạo migration `0004_us004_policy_publish_guardrail.sql` (minimal schema); US-005 ADD COLUMN khi cần |
| OQ-004-7 | Facebook text limit: cần check link attachment constraints không? | BA | 🟡 Open | MVP: chỉ check body text ≤ 63,206 chars; link attachment constraints scope của US-005 |
| OQ-004-8 | UTM warn_only: global hay per-workspace? | Product Owner | 🟡 Open | MVP default: warn_only = true global; per-workspace config có thể add sau |

## 26. Implementation Task Breakdown

### Phase 1: Contracts & Schema

- [ ] T-001: Tạo `PolicyEvaluateRequestedEvent` schema trong `packages/shared-contracts/src/policy/`.
- [ ] T-002: Tạo `PublishFacebookRequestedEvent` schema (references-only, forbidden fields test).
- [ ] T-003: Tạo `PolicyRuleResult`, `PolicyBlocker`, `PolicyWarning` types trong `packages/policy-engine/src/types.ts`.
- [ ] T-004: Viết contract tests cho T-001, T-002.
- [ ] **T-005**: Tạo `packages/policy-engine/src/version.ts` với `POLICY_VERSION = 'policy-facebook-v1'`.
- [ ] **T-006**: Tạo `packages/policy-engine/src/forbiddenTerms.ts` với `DEFAULT_FORBIDDEN_TERMS` seed (10 terms).
- [ ] T-007: DB migration `db/migrations/0004_us004_policy_publish_guardrail.sql`: tạo `publish_rule_results` + `publish_handoff_events` + `publish_jobs` (minimal) + RLS + indexes.
- [ ] T-008: DB migration (trong cùng file 0004 hoặc tách): thêm `policy_evaluating`, `policy_approved`, `policy_rejected` vào `content_variants.policy_status`.
- [ ] T-009: DB migration (0004): thêm `policy_evaluation_completed`, `policy_evaluation_blocked`, `policy_evaluation_failed` vào `workflow_runs.status`.

### Phase 2: Policy Engine Rule Logic

- [ ] T-010: Implement `checkApprovalStatus` + unit test.
- [ ] T-011: Implement `checkChannelToken` + `checkChannelAccountActive` + unit test.
- [ ] T-012: Implement `checkFacebookTextLength` + unit test.
- [ ] T-013: Implement `checkForbiddenTerms` (NFC normalize, lowercase, check body + hashtags, không log raw matched term) + unit test (case variants, Unicode, body, hashtags).
- [ ] T-014: Implement `checkCtaUrl` + `checkUtmPresence` (warn_only default) + unit test.
- [ ] T-015: Implement `checkAutoPublishConfig` (per-workspace, fail closed if config missing/false) + unit test.
- [ ] T-016: Implement `aggregateRuleResults` (combine all checks → PolicyRuleResult) + unit test.

### Phase 3: Worker & Persistence

- [ ] T-016: Implement `policyWorkerRepository.ts` (Ledger queries: reload variant, channel, config; persist rule_result, publish_jobs stub, outbox).
- [ ] T-017: Implement `policyWorker.ts` (orchestrate: validate schema, idempotency check, reload, run engine, persist, side effects, ACK).
- [ ] T-018: Implement RabbitMQ consumer cho `policy.evaluate.requested` queue.
- [ ] T-019: Implement outbox relay cho `publish_handoff_events`.
- [ ] T-020: Implement Airtable update (PATCH `Needs Review` + blockers field) on block.
- [ ] T-021: Implement Slack alert publisher (via `alerts.slack.send` queue) on block.
- [ ] T-022: Register consumer trong `server.ts`.

### Phase 4: Integration Tests & Security Gate

- [ ] T-024: Integration tests: happy path, block path, idempotency, ACK-after-commit, RLS.
- [ ] T-025: Fill US-004 Security Gate checklist (POL-001 → POL-015).
- [ ] T-026: Verify `npm run build` + `npm test` pass.

---

## 27. Decisions Log (từ P0/P1 Decisions 2026-06-01)

| ID | Decision | Rationale |
|:---|:---|:---|
| D-US004-1 | Forbidden terms seed trong `packages/policy-engine/src/forbiddenTerms.ts` | Không block implementation trong khi BA/Marketing review; workspace có thể override sau |
| D-US004-2 | `POLICY_VERSION = 'policy-facebook-v1'` trong `version.ts` | Ổn định cho MVP idempotency key; dễ migrate sau sang DB version table |
| D-US004-3 | Publish job key bao gồm `POLICY_VERSION`: `publish.facebook.job:{ws}:{post}:{approved_ver}:{policy_ver}` | Policy version bump → cần re-evaluate và có thể re-create job; tránh false-positive dedup |
| D-US004-4 | US-004 tự tạo migration `0004_us004_policy_publish_guardrail.sql` cho `publish_jobs` minimal | US-004 AC5 yêu cầu tạo publish job khi pass; không thể chờ US-005 |
| D-US004-5 | `auto_approve_enabled` per-workspace; US-004 chỉ đọc và fail closed | Backlog BR2 rõ ràng; US-004 không implement config UI/permission flow |
| D-US004-6 | `POLICY_BLOCK_SLACK_CHANNEL_ID` env var; thiếu → graceful degradation | Slack là side effect không được phép fail policy transaction |

---

*Plan Author: Senior Technical Planner (Antigravity)*  
*Date: 2026-06-01*  
*Last Updated: 2026-06-01 (P0/P1 decisions incorporated)*  
*Based on: US-003 handoff boundary spec, Architecture doc v1, Product Backlog v1*

---

*Plan Author: Senior Technical Planner (Antigravity)*  
*Date: 2026-06-01*  
*Based on: US-003 handoff boundary spec, Architecture doc v1, Product Backlog v1*
