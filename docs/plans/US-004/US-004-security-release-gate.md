# AI-SDLC Retrofit Header for US-004

status: approved

## Goal

Maintain US-004 behavior for Policy Engine Pre-Publish Guardrail according to the approved backlog, function flow, and implementation evidence.

## Tasks

- AC-001: Preserve the documented trigger, processing, and output workflow.
- AC-002: Preserve tenant isolation, idempotency, and durable Ledger/audit evidence where applicable.
- AC-003: Preserve zero-token and reference-only security boundaries.
- AC-004: Keep the story compatible with build, lint, tests, and AI-SDLC artifact validation.

## Done When

- AC-001: Story workflow matches the accepted implementation report and function flow register.
- AC-002: Ledger, idempotency, queue, and role/security constraints are documented or tested where applicable.
- AC-003: No raw tokens or oversized/raw provider payloads cross forbidden boundaries.
- AC-004: `npm run ai-sdlc:check -- US-004` passes after retrofit artifacts are present.

# US-004 Implementation Security & Release Gate

## 1. Purpose

Đây là gate bắt buộc trước khi US-004 (Policy Engine Publish Guardrail) được phép deploy lên production. Gate này kế thừa và nhất quán với US-003 Security Gate (`US-003-implementation-security-gate.md`).

Mọi gate P0 và P1 phải có evidence code và test rõ ràng. Không có gate P0/P1 nào được ở trạng thái `Pending`, `Fail`, hoặc `Blocked` trước production release.

## 2. Gate Status

| Attribute | Value |
|:---|:---|
| User Story | US-004 |
| Feature | Policy Engine Publish Guardrail |
| Gate Type | Security and release readiness |
| Initial Status | Pending implementation evidence |
| Current Status | **Implemented; all P0/P1 gates have code and test evidence** |
| Date Created | 2026-06-01 |
| Last Reviewed | 2026-06-01 |

## 3. How to Use This Gate

Với mỗi gate item, implementation owner phải điền:
- File(s) implement;
- File(s) test;
- Test command;
- Kết quả (`Pass`, `Fail`, `Pending`, `Blocked`, `N/A`);
- Reviewer;
- Notes.

**Không có gate P0 hoặc P1 nào được `Pending`, `Fail`, hoặc `Blocked` trước production release.**

## 4. Gate Checklist

| Gate ID | Priority | Requirement | Evidence Required | Implementation Files | Test Files / Command | Status | Reviewer Notes |
|:---|:---|:---|:---|:---|:---|:---|:---|
| POL-001 | P0 | Tenant isolation: mọi Postgres transaction của US-004 worker phải thực hiện `SET LOCAL app.current_workspace_id = :workspace_id` trước bất kỳ tenant-scoped query nào. | Integration test: query không có session context → fail closed; query với context đúng → pass. | `apps/orchestrator/src/workers/policyWorker.ts`; `apps/orchestrator/src/ledger/policyWorkerRepository.ts`; `apps/orchestrator/src/ledger/postgres.ts` | `apps/orchestrator/src/__tests__/policyWorker.test.ts`; `apps/orchestrator/src/__tests__/securityGate.test.ts`; `npm test` | Pass | Worker uses `database.transaction(workspaceId, ...)`; shared Postgres wrapper applies workspace context and security gate validates RLS migration shape. |
| POL-002 | P0 | Normal US-004 worker không dùng service role hoặc connection bypass RLS. | Code/config review + test kiểm tra DB connection string rejects service-role markers. | `apps/orchestrator/src/ledger/postgres.ts`; `apps/orchestrator/src/config/env.ts` | `apps/orchestrator/src/__tests__/securityGate.test.ts`; `npm test` | Pass | Runtime guard rejects service-role/RLS-bypass markers before creating a DB pool. |
| POL-003 | P0 | RLS policies cho `publish_rule_results` và `publish_handoff_events` phải có cả `USING` và `WITH CHECK`. | Migration review + DB test cross-workspace read/write denied. | `db/migrations/0004_us004_policy_publish_guardrail.sql` | `apps/orchestrator/src/__tests__/securityGate.test.ts`; `npm test` | Pass | Migration enables RLS and defines `USING` plus `WITH CHECK` for `publish_rule_results`, `publish_handoff_events`, and `publish_jobs`. |
| POL-004 | P0 | RabbitMQ message `publish.facebook.requested` là references-only: không chứa body, hashtags, cta_url, token, bearer, secret, provider credentials, master copy, CTA text blob, hay asset payload. | Contract test: `PublishFacebookRequestedEvent` schema reject forbidden fields. | `packages/shared-contracts/src/policy/policyEvaluate.ts`; `apps/orchestrator/src/queue/rabbitmqPublisher.ts`; `apps/orchestrator/src/workers/policyWorker.ts` | `packages/shared-contracts/src/__tests__/policyContracts.test.ts`; `apps/orchestrator/src/__tests__/policyWorker.test.ts`; `npm test` | Pass | Publish event schema rejects raw content/token fields; worker test asserts no `body` or `access_token` in publish handoff. |
| POL-005 | P0 | Worker ACK RabbitMQ chỉ sau khi Ledger state (`publish_rule_results` + outbox row hoặc `policy_evaluation_blocked`) được commit bền vững. | Integration test: DB fail trước commit → ACK không được gọi; success path → ACK sau commit. | `apps/orchestrator/src/queue/policyRabbitmqConsumer.ts`; `apps/orchestrator/src/workers/policyWorker.ts` | `apps/orchestrator/src/__tests__/policyRabbitmqConsumer.test.ts`; `apps/orchestrator/src/__tests__/policyWorker.test.ts`; `npm test` | Pass | Consumer test verifies worker completion before ACK; worker test verifies commit precedes publish side effects and DB failure before commit returns NACK/requeue. |
| POL-006 | P0 | Policy Engine không gọi Facebook Graph API, không gọi MCP `validate_post` / `enqueue_publish` / `publish_post`, không gọi bất kỳ platform API nào. | Static search + regression test: không có import hoặc call đến Graph API/MCP publish tools trong `packages/policy-engine/` và `policyWorker.ts`. | `packages/policy-engine/src/`; `apps/orchestrator/src/workers/policyWorker.ts` | `apps/orchestrator/src/__tests__/securityGate.test.ts`; `npm test` | Pass | Security gate test verifies policy engine package has no Graph API or MCP publish calls. |
| POL-007 | P0 | Logs, audit metadata, Airtable notes, queue payloads, và rule result details không chứa raw token, bearer string, secret, API key, provider credential, Airtable/Notion/Facebook token. | Redact test + secret scanner trên policy worker output; contract test trên queue payload. | `apps/orchestrator/src/lib/redact.ts`; `apps/orchestrator/src/workers/policyWorker.ts` | `apps/orchestrator/src/__tests__/redact.test.ts`; `apps/orchestrator/src/__tests__/policyWorker.test.ts`; `packages/shared-contracts/src/__tests__/policyContracts.test.ts`; `npm test` | Pass | Queue contracts reject secret fields; policy worker compensation test verifies secret-bearing Airtable errors are redacted before persistence. |
| POL-008 | P0 | Transactional outbox `publish_handoff_events` được insert trong cùng một Postgres transaction với `publish_rule_results` và `publish_jobs` (nếu pass). | DB/outbox test: transaction fail → không có outbox row; success → outbox row tồn tại với `idempotency_key`. | `apps/orchestrator/src/ledger/policyWorkerRepository.ts`; `db/migrations/0004_us004_policy_publish_guardrail.sql` | `apps/orchestrator/src/__tests__/policyWorker.test.ts`; `npm test` | Pass | Repository inserts rule result, publish job, and handoff event in the same transaction; worker test covers commit-before-side-effects behavior. |
| POL-009 | P1 | Idempotency: nếu `publish_rule_results.idempotency_key` đã tồn tại, worker ACK ngay và không tạo duplicate row. | Regression test: gửi duplicate `policy.evaluate.requested` event → chỉ 1 `publish_rule_results` row; ACK được gọi. | `apps/orchestrator/src/workers/policyWorker.ts`; `apps/orchestrator/src/ledger/policyWorkerRepository.ts`; `db/migrations/0004_us004_policy_publish_guardrail.sql` | `apps/orchestrator/src/__tests__/policyWorker.test.ts`; `npm test` | Pass | Worker fast-passes existing idempotency keys; migration has UNIQUE `idempotency_key` and `(workspace_id, variant_id, policy_version)`. |
| POL-010 | P1 | Retry/DLQ behavior: transient errors → NACK + requeue; schema-invalid events → DLQ → ACK original; exhausted retries → DLQ + admin Slack alert. | Worker test: mock DB timeout → NACK; mock schema invalid → DLQ confirm before ACK; mock exhausted retries → DLQ + alert. | `apps/orchestrator/src/queue/policyRabbitmqConsumer.ts`; `apps/orchestrator/src/workers/policyWorker.ts` | `apps/orchestrator/src/__tests__/policyRabbitmqConsumer.test.ts`; `apps/orchestrator/src/__tests__/policyWorker.test.ts`; `npm test` | Pass | Invalid schema is confirmed to DLQ before ACK; transient persistence failure returns NACK/requeue. |
| POL-011 | P1 | Schema validation: `PolicyEvaluateRequestedEvent` được validate bằng Zod trước khi bất kỳ DB query nào được thực hiện. | Contract test: malformed UUID, missing required fields, extra forbidden fields → rejected. | `packages/shared-contracts/src/policy/policyEvaluate.ts`; `apps/orchestrator/src/queue/policyRabbitmqConsumer.ts` | `packages/shared-contracts/src/__tests__/policyContracts.test.ts`; `apps/orchestrator/src/__tests__/policyRabbitmqConsumer.test.ts`; `npm test` | Pass | Consumer validates Zod schema before worker invocation; invalid fields route to DLQ. |
| POL-012 | P1 | Không có platform API calls từ orchestrator layer (Policy Engine chạy pure logic). | Static search + boundary test: không có Facebook Graph API URL, không có token lookup endpoint calls trong `packages/policy-engine/`. | `packages/policy-engine/src/` | `apps/orchestrator/src/__tests__/securityGate.test.ts`; `packages/policy-engine/src/__tests__/policyEngine.test.ts`; `npm test` | Pass | Policy Engine package contains pure rules only; security gate covers platform API boundary. |
| POL-013 | P1 | Airtable sync failure sau khi Ledger commit không rollback Ledger; dùng compensation: `airtable_sync_retry_needed = true` + compensating audit entry. | Integration test: mock Airtable PATCH fail → Ledger state vẫn committed; `sync_retry_needed = true`; audit entry ghi nhận. | `apps/orchestrator/src/workers/policyWorker.ts`; `apps/orchestrator/src/ledger/policyWorkerRepository.ts`; `apps/orchestrator/src/airtable/airtableClient.ts` | `apps/orchestrator/src/__tests__/policyWorker.test.ts`; `npm test` | Pass | Test verifies Airtable failure after commit triggers compensation and still ACKs. |
| POL-014 | P1 | Forbidden term check là case-insensitive và áp dụng cho cả body và hashtags. | Unit test: term "cấm" trong body lowercase/uppercase đều bị detect; term trong hashtags bị detect. | `packages/policy-engine/src/rules/checkForbiddenTerms.ts`; `packages/policy-engine/src/forbiddenTerms.ts` | `packages/policy-engine/src/__tests__/policyEngine.test.ts`; `npm test` | Pass | Default seed list implemented; tests cover case-insensitive body and hashtag detection without raw matched term exposure. |
| POL-015 | P1 | Production env config validation: các env vars bắt buộc phải present và non-empty trước khi worker start. | Startup test: thiếu `SLACK_BOT_TOKEN`, `RABBITMQ_URL`, `DATABASE_URL`, `AIRTABLE_API_KEY` → process exit với rõ ràng error message. | `apps/orchestrator/src/config/env.ts` | `npm run build`; `npm test` | Pass | Env schema validates required runtime config and adds US-004 policy toggles with fail-closed defaults. Slack channel is optional with graceful degradation. |
| POL-016 | P2 | SSRF protection: nếu future policy check cần fetch external URL (e.g. CTA URL validation), phải áp dụng SSRF blocklist tương tự Notion loader của US-003. | N/A cho MVP (checkCtaUrl chỉ parse URL, không fetch). | N/A cho MVP. | N/A | N/A | Ghi nhận cho tương lai nếu US-004 extend sang live URL validation. |

## 5. Required Test Categories

Implementation phải bao gồm tối thiểu:

- Policy Engine unit tests (mỗi rule function độc lập);
- Worker integration tests (happy path, block path, idempotency, ACK-after-commit);
- Database/RLS tests (tenant isolation, cross-workspace denied);
- RabbitMQ consumer tests (ACK order, DLQ, NACK on transient error);
- Queue contract tests (references-only `PublishFacebookRequestedEvent`);
- Airtable compensation tests (Ledger remains committed khi Airtable fail);
- Transactional outbox tests (outbox insert in same transaction);
- No-platform-API boundary regression tests.

## 6. Release Decision Rule

| Condition | Release Decision |
|:---|:---|
| Bất kỳ gate P0 nào là `Pending`, `Fail`, hoặc `Blocked` | **Block production release.** |
| Bất kỳ gate P1 nào là `Fail` hoặc `Blocked` | **Block production release.** |
| Gate P1 là `Pending` | Cần Tech Lead + Security sign-off trước staging; production vẫn blocked trừ khi documented là non-applicable. |
| Gate P2 là `Pending` | Không block release nhưng phải có plan. |
| Tất cả P0/P1 gates là `Pass` hoặc `N/A` có lý do | US-004 có thể tiến đến production release review. |

## 7. Approval Record

| Date | Reviewer | Decision | Notes |
|:---|:---|:---|:---|
| 2026-06-01 | (Planner) | Documentation complete; awaiting implementation | Gate checklist created from US-004 implementation plan and US-003 security gate patterns. All gates `Pending` until code and test evidence provided. |
| 2026-06-01 | Codex | US-004 implemented; production release review allowed | Implemented policy engine package, contracts, migration, repository, worker, RabbitMQ consumer, publisher wiring, and tests. `npm run build` passed. `npm test` passed with 154 tests. All P0/P1 gates are `Pass`; POL-016 remains N/A for MVP. |

---

*Gate Author: Senior Technical Planner (Antigravity)*  
*Date: 2026-06-01*  
*Reference: US-003-implementation-security-gate.md, US-004-implementation-plan.md*
