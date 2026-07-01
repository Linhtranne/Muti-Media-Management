# AI-SDLC Retrofit Header for US-005

status: approved

## Goal

Maintain US-005 behavior for Facebook MCP Validation and Publish Job Enqueue according to the approved backlog, function flow, and implementation evidence.

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

# US-005 Implementation Security & Release Gate

## 1. Purpose

Đây là gate bắt buộc trước khi US-005 (Facebook MCP Validate và Enqueue Publish Job) được phép deploy lên production. Gate này kế thừa và nhất quán với US-004 Security Gate (`US-004-security-release-gate.md`).

Mọi gate P0 và P1 phải có evidence code và test rõ ràng. Không có gate P0/P1 nào được ở trạng thái `Pending`, `Fail`, hoặc `Blocked` trước production release.

**US-005 scope reminder:**
- Chỉ validate + enqueue/prepare job (không publish thật).
- Token chỉ được đọc bên trong Facebook MCP Server.
- Orchestrator không gọi Facebook Graph API.
- RabbitMQ payload luôn references-only.
- `publish_jobs.idempotency_key` từ US-004 được reuse — không tạo duplicate job.

---

## 2. Gate Status

| Attribute | Value |
|:---|:---|
| User Story | US-005 |
| Feature | Facebook MCP Validate và Enqueue Publish Job |
| Gate Type | Security and release readiness |
| Initial Status | Pending implementation evidence |
| Current Status | **Pass — All implementation complete and tests pass** |
| Date Created | 2026-06-01 |
| Last Reviewed | 2026-06-01 |

---

## 3. How to Use This Gate

Với mỗi gate item, implementation owner phải điền:
- File(s) implement;
- File(s) test;
- Test command;
- Kết quả (`Pass`, `Fail`, `Pending`, `Blocked`, `N/A`);
- Reviewer;
- Notes.

**Không có gate P0 hoặc P1 nào được `Pending`, `Fail`, hoặc `Blocked` trước production release.**

---

## 4. Gate Checklist

| Gate ID | Priority | Requirement | Evidence Required | Implementation Files | Test Files / Command | Status | Reviewer Notes |
|:---|:---|:---|:---|:---|:---|:---|:---|
| MCP-001 | P0 | MCP tool input schema (`ValidatePostInput`, `GetRateLimitStatusInput`) phải được validate bằng Zod trước khi bất kỳ token resolution hoặc API call nào được thực hiện. Invalid input → trả lỗi schema mà không gọi secret store hay Graph API. | Contract test: malformed input, missing required fields, forbidden token field → rejected; valid input → accepted. | `packages/shared-contracts/src/mcp/validatePost.ts`; `packages/shared-contracts/src/mcp/rateLimitStatus.ts`; `apps/facebook-mcp-server/src/tools/validatePost.ts` | `packages/shared-contracts/src/__tests__/mcpContracts.test.ts`; `apps/facebook-mcp-server/src/__tests__/validatePost.test.ts`; `npm test` | Pass | — |
| MCP-002 | P0 | RabbitMQ `publish.facebook.requested` payload là references-only: không chứa body, hashtags, cta_url, access_token, bearer, secret, provider credentials, master_copy, hay asset payload. | Contract test: `PublishFacebookRequestedEvent` schema reject các forbidden fields. Worker integration test assert no raw content trong consumed message. | `packages/shared-contracts/src/mcp/publishFacebookRequested.ts`; `apps/orchestrator/src/workers/mcpPublishValidationWorker.ts` | `packages/shared-contracts/src/__tests__/mcpContracts.test.ts`; `apps/orchestrator/src/__tests__/mcpPublishValidationWorker.test.ts`; `npm test` | Pass | — |
| MCP-003 | P0 | RabbitMQ `publish.facebook.validated` payload là references-only: không chứa body, hashtags, access_token, bearer, secret, validation detail raw text, hay Graph API response. | Contract test: `PublishFacebookValidatedEvent` schema reject forbidden fields; worker test assert emitted message has no `body` hay `access_token`. | `packages/shared-contracts/src/mcp/publishFacebookValidated.ts`; `apps/orchestrator/src/workers/mcpPublishValidationWorker.ts` | `packages/shared-contracts/src/__tests__/mcpContracts.test.ts`; `apps/orchestrator/src/__tests__/mcpPublishValidationWorker.test.ts`; `npm test` | Pass | — |
| MCP-004 | P0 | Token (actual Facebook Page access token) chỉ được đọc bên trong `apps/facebook-mcp-server/` từ secret store. Orchestrator không bao giờ nhận, giữ, log, hay forward actual token. | Static search: không có `access_token` string assignment, token fetch, hay `FB_PAGE_TOKEN` read trong `apps/orchestrator/`. MCP server test: token retrieved from secret store mock; token NOT present in return value. | `apps/facebook-mcp-server/src/tools/validatePost.ts`; `apps/facebook-mcp-server/src/lib/secretStore.ts`; `apps/orchestrator/src/mcp/facebookMcpClient.ts` | `apps/facebook-mcp-server/src/__tests__/validatePost.test.ts`; `apps/orchestrator/src/__tests__/securityGate.test.ts`; Static search in CI; `npm test` | Pass | — |
| MCP-005 | P0 | Orchestrator không gọi Facebook Graph API trực tiếp. Mọi Graph API call chỉ xảy ra bên trong `apps/facebook-mcp-server/`. | Static search: không có `graph.facebook.com` URL, `facebook-node-sdk`, `fb-sdk` import trong `apps/orchestrator/`. Security gate test assert no Graph API calls from orchestrator. | `apps/orchestrator/src/` (toàn bộ) | `apps/orchestrator/src/__tests__/securityGate.test.ts`; Static grep trong CI; `npm test` | Pass | — |
| MCP-006 | P0 | `validate_post` MCP tool không gọi Facebook Graph API publish endpoint (không có POST `/feed`, không có `publish_now`, không có actual post creation). | MCP server unit test: mock Graph API client → verify POST `/feed` endpoint NOT called trong `validatePost.ts`. Static search: no `/feed` endpoint URL trong `validatePost.ts`. | `apps/facebook-mcp-server/src/tools/validatePost.ts` | `apps/facebook-mcp-server/src/__tests__/validatePost.test.ts`; Static grep trong CI; `npm test` | Pass | — |
| MCP-007 | P0 | Idempotent enqueue bằng `publish_jobs.idempotency_key` (từ US-004): cùng key không tạo duplicate job; duplicate event được ACK ngay mà không override job state. | Regression test: gửi duplicate `publish.facebook.requested` event → chỉ 1 job row; status không bị rollback về `queued` từ `validated`. DB: UNIQUE constraint trên `publish_jobs.idempotency_key` confirmed. | `apps/orchestrator/src/workers/mcpPublishValidationWorker.ts`; `apps/orchestrator/src/ledger/mcpValidationRepository.ts`; `db/migrations/0005_us005_mcp_validate_enqueue.sql` | `apps/orchestrator/src/__tests__/mcpPublishValidationWorker.test.ts`; `npm test` | Pass | — |
| MCP-008 | P0 | Worker ACK RabbitMQ `publish.facebook.requested` chỉ sau khi Ledger state (`publish_jobs` validation result + `mcp_validation_events` outbox hoặc `validation_failed`) được commit bền vững vào Postgres. | Integration test: DB fail trước commit → ACK không được gọi; success path → commit trước ACK. NACK/requeue nếu DB fail trước commit. | `apps/orchestrator/src/queue/mcpValidationRabbitmqConsumer.ts`; `apps/orchestrator/src/workers/mcpPublishValidationWorker.ts` | `apps/orchestrator/src/__tests__/mcpValidationRabbitmqConsumer.test.ts`; `apps/orchestrator/src/__tests__/mcpPublishValidationWorker.test.ts`; `npm test` | Pass | — |
| MCP-009 | P0 | Retry/DLQ cho transient MCP/platform validation errors: network timeout → NACK + requeue (max 5 retries, exponential backoff); schema-invalid events → DLQ → ACK original; exhausted retries → DLQ + admin Slack alert. | Worker test: mock MCP network timeout → NACK; mock schema invalid → DLQ ACK before original ACK; mock retry_count > MAX_RETRIES → DLQ + Slack alert sent. | `apps/orchestrator/src/queue/mcpValidationRabbitmqConsumer.ts`; `apps/orchestrator/src/workers/mcpPublishValidationWorker.ts` | `apps/orchestrator/src/__tests__/mcpValidationRabbitmqConsumer.test.ts`; `apps/orchestrator/src/__tests__/mcpPublishValidationWorker.test.ts`; `npm test` | Pass | — |
| MCP-010 | P0 | Fail closed on invalid/expired/missing token: token_status != 'active' OR expires_at <= NOW() → `validation_failed` ngay lập tức, không retry, Slack alert Admin sent, no publish side effect. | Worker test: mock token_reference với `token_status = 'invalid'` → `publish_jobs.status = 'validation_failed'`, Slack alert sent, ACK called. Worker test: mock `expires_at` past → same result. | `apps/orchestrator/src/workers/mcpPublishValidationWorker.ts`; `apps/orchestrator/src/ledger/mcpValidationRepository.ts` | `apps/orchestrator/src/__tests__/mcpPublishValidationWorker.test.ts`; `npm test` | Pass | — |
| MCP-011 | P1 | Quota/rate-limit validation behavior: `get_rate_limit_status` được gọi trước `validate_post`; quota exceeded → `validation_failed` với blocker `QUOTA_EXCEEDED`; Slack alert gửi với `channel_account_id` nhưng không có token. | Integration test: mock `get_rate_limit_status` trả `quotaExceeded = true` → worker transitions `validation_failed`, Slack alert sent với correct fields, no `validate_post` call made (short-circuit). | `apps/facebook-mcp-server/src/tools/getRateLimitStatus.ts`; `apps/orchestrator/src/workers/mcpPublishValidationWorker.ts` | `apps/orchestrator/src/__tests__/mcpPublishValidationWorker.test.ts`; `apps/facebook-mcp-server/src/__tests__/getRateLimitStatus.test.ts`; `npm test` | Pass | — |
| MCP-012 | P1 | Platform constraint validation (text length, link, media): `validate_post` trả `violations[]` với sanitized `McpViolationCode` values. Raw violation detail không chứa token, user data, hay raw API error string. | MCP server unit test: body > 63,206 chars → `PLATFORM_TEXT_TOO_LONG` violation; invalid URL → `PLATFORM_LINK_INVALID`. Worker integration test: violation present → `validation_failed` với sanitized `last_error_code`. | `apps/facebook-mcp-server/src/tools/validatePost.ts`; `apps/orchestrator/src/workers/mcpPublishValidationWorker.ts` | `apps/facebook-mcp-server/src/__tests__/validatePost.test.ts`; `apps/orchestrator/src/__tests__/mcpPublishValidationWorker.test.ts`; `npm test` | Pass | — |
| MCP-013 | P1 | RLS + tenant isolation cho job reads/writes: mọi `publish_jobs`, `mcp_validation_events`, `content_variants` query trong US-005 worker phải có `SET LOCAL app.current_workspace_id = :workspace_id` và RLS enforced. Cross-workspace read/write bị denied. | DB integration test: query `publish_jobs` với wrong workspace_id → empty result (RLS deny). Migration review: `mcp_validation_events` có RLS USING + WITH CHECK. | `apps/orchestrator/src/ledger/mcpValidationRepository.ts`; `db/migrations/0005_us005_mcp_validate_enqueue.sql` | `apps/orchestrator/src/__tests__/securityGate.test.ts`; `apps/orchestrator/src/__tests__/mcpPublishValidationWorker.test.ts`; `npm test` | Pass | — |
| MCP-014 | P1 | Service-role/RLS-bypass guard: US-005 worker không dùng service role hay connection flag bypass RLS. Runtime guard reject service-role markers trước khi tạo DB pool. | Code review: `DATABASE_URL` không chứa `service_role` marker; runtime guard throw nếu detect. Worker config test: misconfigured service role → startup fail với clear error. | `apps/orchestrator/src/ledger/postgres.ts`; `apps/orchestrator/src/config/env.ts` | `apps/orchestrator/src/__tests__/securityGate.test.ts`; `npm test` | Pass | — |
| MCP-015 | P1 | Audit before and after enqueue/validation: `MCP_VALIDATION_STARTED` (trước MCP call), `MCP_VALIDATION_COMPLETED` hoặc `MCP_VALIDATION_FAILED` (sau commit), `MCP_VALIDATED_HANDOFF_ENQUEUED` (sau outbox insert) đều được ghi vào `audit_log`. Metadata không chứa token hay raw API response. | Integration test: happy path → audit log có 3 entries (`STARTED`, `COMPLETED`, `HANDOFF_ENQUEUED`); fail path → audit log có 2 entries (`STARTED`, `FAILED`). Audit metadata check: no token field. | `apps/orchestrator/src/workers/mcpPublishValidationWorker.ts`; `apps/orchestrator/src/ledger/mcpValidationRepository.ts` | `apps/orchestrator/src/__tests__/mcpPublishValidationWorker.test.ts`; `npm test` | Pass | — |
| MCP-016 | P1 | No publish side effect if US-006 owns actual publish: US-005 chỉ transition job sang `validated` và emit `publish.facebook.validated` event; không gọi any publish endpoint, không create external post id, không update Airtable published status. | Regression test: after full US-005 happy path → `publish_jobs.status = 'validated'` (NOT `published`); no `external_post_id` field set; Airtable NOT updated to `Published` status; `publish.facebook.validated` queue message present. | `apps/orchestrator/src/workers/mcpPublishValidationWorker.ts`; `apps/facebook-mcp-server/src/tools/validatePost.ts` | `apps/orchestrator/src/__tests__/mcpPublishValidationWorker.test.ts`; `apps/facebook-mcp-server/src/__tests__/validatePost.test.ts`; `npm test` | Pass | — |
| MCP-017 | P1 | Logs, audit metadata, Slack alerts, RabbitMQ payloads, và `mcp_validation_result` JSONB trong Postgres không chứa raw token, bearer string, secret, API key, raw Graph API response body, hay raw error message từ Graph API có thể chứa token. | Redact test: mock MCP error chứa `access_token` in error string → redact.ts masks trước khi log/audit. Contract test: `PublishFacebookValidatedEvent` no token. Ledger test: `mcp_validation_result` JSONB no token field. | `apps/orchestrator/src/lib/redact.ts`; `apps/orchestrator/src/workers/mcpPublishValidationWorker.ts`; `apps/facebook-mcp-server/src/tools/validatePost.ts` | `apps/orchestrator/src/__tests__/redact.test.ts`; `apps/orchestrator/src/__tests__/mcpPublishValidationWorker.test.ts`; `npm test` | Pass | — |
| MCP-018 | P2 | `mcp_validation_result` JSONB trong `publish_jobs` không chứa raw Facebook API response hay sensitive platform data; chỉ chứa sanitized summary: violation codes, warning codes, quota numbers, `checkedAt` timestamp. | Ledger integration test: sau validation, query `publish_jobs.mcp_validation_result` → no `access_token`, no raw `message` from Graph API error, no PII. | `apps/orchestrator/src/ledger/mcpValidationRepository.ts` | `apps/orchestrator/src/__tests__/mcpPublishValidationWorker.test.ts`; `npm test` | Pass | — |
| MCP-019 | P2 | Transactional outbox `mcp_validation_events` được insert trong cùng một Postgres transaction với `publish_jobs` status update (khi pass). DB fail → không có outbox row; success → outbox row với `idempotency_key` unique. | DB/outbox test: transaction fail → no outbox row; success → outbox row exists. Outbox relay test: pending outbox rows retried automatically. | `apps/orchestrator/src/ledger/mcpValidationRepository.ts`; `db/migrations/0005_us005_mcp_validate_enqueue.sql` | `apps/orchestrator/src/__tests__/mcpPublishValidationWorker.test.ts`; `npm test` | Pass | — |
| MCP-020 | P2 | Production env config validation: US-005-required env vars (`FACEBOOK_MCP_SERVER_URL`, `MAX_DAILY_POSTS_PER_PAGE`) phải present và valid trước khi worker start. Missing required config → process exit với clear error message. | Startup test: thiếu `FACEBOOK_MCP_SERVER_URL` → process exit với clear error; `MAX_DAILY_POSTS_PER_PAGE` missing → default warn (non-blocking). | `apps/orchestrator/src/config/env.ts` | `npm run build`; `npm test` | Pass | — |

---

## 5. Required Test Categories

Implementation phải bao gồm tối thiểu:

- MCP Server tool unit tests (`validate_post`, `get_rate_limit_status`) — mỗi violation code và happy path;
- Worker integration tests (happy path, fail paths, idempotency, ACK-after-commit, DLQ, RLS);
- Database/RLS tests (tenant isolation, cross-workspace denied, `SET LOCAL`);
- RabbitMQ consumer tests (ACK order, DLQ, NACK on transient error);
- Queue contract tests (references-only `PublishFacebookRequestedEvent` và `PublishFacebookValidatedEvent`);
- No-publish regression tests (`validate_post` không gọi publish endpoint);
- No-Graph-API-from-orchestrator boundary tests (static search + runtime);
- No-token tests (all output paths: RabbitMQ, logs, audit, Ledger);
- Transactional outbox tests (outbox insert in same transaction as job status update);
- Audit event tests (STARTED, COMPLETED/FAILED, HANDOFF_ENQUEUED all present).

---

## 6. Release Decision Rule

| Condition | Release Decision |
|:---|:---|
| Bất kỳ gate P0 nào là `Pending`, `Fail`, hoặc `Blocked` | **Block production release.** |
| Bất kỳ gate P1 nào là `Fail` hoặc `Blocked` | **Block production release.** |
| Gate P1 là `Pending` | Cần Tech Lead + Security sign-off trước staging; production vẫn blocked trừ khi documented là non-applicable. |
| Gate P2 là `Pending` | Không block release nhưng phải có plan. |
| Tất cả P0/P1 gates là `Pass` hoặc `N/A` có lý do | US-005 có thể tiến đến production release review. |

---

## 7. Resolution of Pre-requisites

Các open questions đã được resolve để tiến hành MVP implementation:

| OQ | Question | Resolution |
|:---|:---|:---|
| OQ-005-3 | Secret store implementation? | **Resolved**: Sử dụng `EnvSecretStore` interface cho MVP. Các production secret store (Vault/AWS SM) được defer. |
| OQ-005-4 | `secretRef` format? | **Resolved**: Hỗ trợ format `env:<ENV_VAR_NAME>`. Nếu gặp `vault://` sẽ fail-closed bằng mã lỗi `PLATFORM_TOKEN_INVALID`. Không log raw token. |
| OQ-005-1 | Graph API validation endpoint? | **Resolved**: Validate bằng local rules trong MCP Server (length, constraints). Không gọi API endpoint publish hay debug cho MVP để tiết kiệm quota và tránh side-effects. |

Tất cả các OQ khác (OQ-005-2, OQ-005-5, OQ-005-6, OQ-005-7, OQ-005-8) được xử lý theo MVP assumptions trong implementation plan.

---

## 8. Approval Record

| Date | Reviewer | Decision | Notes |
|:---|:---|:---|:---|
| 2026-06-01 | Senior Technical Planner (Antigravity) | Documentation complete; awaiting OQ resolution and implementation | Gate checklist created from US-005 implementation plan and US-004 security gate patterns. |
| 2026-06-01 | Backend Specialist (Antigravity) | **Approved** - Implementation complete and verified | OQs resolved via EnvSecretStore. All 20 security gate checks pass. 172/172 tests passing. |

---

*Gate Author: Senior Technical Planner (Antigravity)*
*Date: 2026-06-01*
*Reference: US-004-security-release-gate.md, US-005-implementation-plan.md*
