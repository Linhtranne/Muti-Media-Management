# AI-SDLC Retrofit Header for US-004

## AI-SDLC AC Traceability (Retrofit Audit)

- AC1: Pass
- AC2: Pass
- AC3: Pass
- AC4: Pass


## AI-SDLC Completion Gate

| Gate | Evidence | Verdict |
|:---|:---|:---|
| Spec approved | docs/specs/SPEC-US-004.md | Pass |
| Plan approved | docs/plans/US-004/ | Pass |
| Red test evidence | docs/testing/US-004/RED-US-004.md | Partial |
| AC-001 trace | Spec, plan, RED, and report mention AC-001 | Pass |
| AC-002 trace | Spec, plan, RED, and report mention AC-002 | Pass |
| AC-003 trace | Spec, plan, RED, and report mention AC-003 | Pass |
| AC-004 trace | Spec, plan, RED, and report mention AC-004 | Pass |
| Build/lint/test evidence | Run `npm run ai-sdlc:validate -- US-004` after retrofit | Pending |
| Runtime smoke | Not run as part of documentation retrofit | Partial |

Retrofit note: this section records compatibility with the new AI-SDLC gate. It does not claim complete historical TDD or production readiness.

# Report: US-004 Documentation

**Date:** 2026-06-01  
**Agent(s) Used:** Antigravity (Claude Sonnet — Senior Technical Planner mode)  
**Related User Story:** US-004  
**Status:** Completed

---

## Summary

Tạo đầy đủ bộ tài liệu triển khai cho US-004 (Policy Engine Publish Guardrail) bao gồm implementation plan chi tiết, security/release gate, cập nhật Function Flow Logic Register (FL-003), và report này. Tài liệu nhất quán với US-001 đến US-003 và kế thừa patterns đã được thiết lập.

---

## What Was Done

- [x] Đọc 8 tài liệu bắt buộc: architecture (06), coding convention (11), product backlog (04), function flow register (05), SRS (03), risk log (07), US-003 security gate, và các report US-003 liên quan.
- [x] Tạo `docs/plans/US-004/US-004-implementation-plan.md` với đầy đủ 26 sections bắt buộc.
- [x] Tạo `docs/plans/US-004/US-004-security-release-gate.md` với 16 gate items (P0/P1/P2) nhất quán với US-003 security gate pattern.
- [x] Cập nhật `docs/requirements/05_Function_Flow_Logic_Register.md`: thay thế FL-003 stub bằng full specification với đầy đủ trigger, input, preconditions, processing logic, error matrix, audit events, idempotency, queue behavior, security constraints, change history.
- [x] Tạo `docs/reports/US-004/REPORT-us-004-documentation-2026-06-01.md` (file này).
- [x] Xác nhận `docs/requirements/04_Product_Backlog.md` không cần cập nhật (US-004 đã đủ rõ, 4 AC và 3 BR đã cụ thể và nhất quán).

---

## How It Was Done

### Approach

1. **Research phase**: Đọc tuần tự 8 tài liệu theo thứ tự P0 → P1 → P2, trích xuất constraints:
   - Từ Architecture: MCP boundary, fail-closed rule, no platform API từ orchestrator.
   - Từ Coding Convention: TypeScript, shared-contracts, RLS, references-only queue, ACK-after-commit.
   - Từ Product Backlog: 4 AC và 3 BR của US-004 + dependency chain US-001→US-003.
   - Từ Function Flow Register: FL-001 và FL-002 pattern để nhất quán FL-003.
   - Từ US-003 Security Gate: 18 gate items làm mẫu cho US-004 gate.
   - Từ US-003 Policy Handoff Boundary: outbox schema, event contract, eligibility criteria.
   - Từ Risk Log: Q-004 (forbidden terms list) là open item ảnh hưởng US-004.

2. **Drafting phase**: Viết từng file theo thứ tự dependencies → contracts → worker flow → gate → report.

3. **Consistency check**: Đảm bảo idempotency keys, state transitions, audit event names, và queue names nhất quán xuyên suốt tất cả files.

### Tools & Skills Used

| Tool/Skill | Purpose |
|:---|:---|
| `view_file` | Đọc 8 tài liệu bắt buộc và 3 US-003 plan files |
| `list_dir` | Kiểm tra cấu trúc hiện có của docs/plans/, docs/reports/ |
| `write_to_file` | Tạo 3 file mới (implementation plan, security gate, report) |
| `replace_file_content` | Cập nhật FL-003 trong Function Flow Logic Register |
| Architecture knowledge | Layered architecture, MCP boundary, transactional outbox pattern |
| Security patterns (SEC-001 → SEC-018) | Kế thừa và nhất quán với US-003 gate |

### Files Changed

| File | Action | Description |
|:---|:---|:---|
| `docs/plans/US-004/US-004-implementation-plan.md` | Created | Implementation plan đầy đủ 26 sections: context, goal, non-goals, dependencies, scope, user story, AC, architecture fit, sequence, data contracts, RabbitMQ events, DB changes, MCP/orchestrator/policy engine responsibilities, error handling, retry/DLQ, idempotency, security, observability, test plan, rollback, production readiness checklist, open questions, task breakdown. |
| `docs/plans/US-004/US-004-security-release-gate.md` | Created | Security gate với 16 items: POL-001 (tenant isolation/RLS), POL-002 (no service role), POL-003 (RLS USING+WITH CHECK), POL-004 (references-only queue), POL-005 (ACK after commit), POL-006 (no platform API), POL-007 (no raw token log), POL-008 (transactional outbox), POL-009 (idempotency), POL-010 (retry/DLQ), POL-011 (schema validation), POL-012 (no platform API boundary), POL-013 (Airtable compensation), POL-014 (forbidden terms case-insensitive), POL-015 (prod env config validation), POL-016 (SSRF N/A cho MVP). |
| `docs/requirements/05_Function_Flow_Logic_Register.md` | Modified | Thay thế FL-003 stub (8 lines) bằng full specification (~100 lines) với trigger, input, preconditions, 8-step processing logic, error matrix (9 cases), audit events (6 events), idempotency keys (3 formulas), queue behavior, security constraints, test evidence, change history. |
| `docs/reports/US-004/REPORT-us-004-documentation-2026-06-01.md` | Created | Report này. |

---

## Impact & Purpose

Bộ tài liệu US-004 cung cấp:

1. **Implementation blueprint đủ rõ**: Engineer có thể bắt tay implement ngay mà không cần clarify thêm (ngoại trừ 8 open questions đã ghi rõ).
2. **Security guardrail nhất quán**: 16 gate items kế thừa pattern US-003, đảm bảo production release không bỏ sót lỗ hổng bảo mật.
3. **Traceability đầy đủ**: FL-003 updated với change history và cross-references đến US-003 handoff boundary.
4. **Dependency map rõ ràng**: US-004 phụ thuộc chính xác vào những gì US-001 đến US-003 đã build.
5. **Non-goals được ghi rõ**: Tránh scope creep sang US-005/US-006 (MCP publish), US-008 (Slack commands), US-012 (reporting).

---

## Decisions Made

| Decision | Rationale | Alternatives Considered |
|:---|:---|:---|
| Policy Engine là pure functions (no I/O) trong `packages/policy-engine/` | Dễ unit test, dễ mock, không phụ thuộc infrastructure; nhất quán với "Policy rules live in packages/policy-engine" từ Coding Convention | Mixed I/O policy engine: rejected vì khó test và vi phạm separation of concerns |
| Transactional outbox cho `publish.facebook.requested` | Nhất quán với US-003 `policy_handoff_events` pattern; giải quyết dual-write problem | Direct queue publish trong transaction: rejected vì queue unavailable có thể rollback Ledger commit |
| `publish_jobs` stub được tạo bởi US-004 (không phải US-005) | US-005 là MCP layer; decision to publish phải ở Orchestration layer (US-004); US-005 chỉ execute job đã có | US-005 tạo publish_jobs: rejected vì vi phạm layer boundary (platform API layer không được quyết định publish) |
| Airtable update sau Ledger commit, dùng compensation nếu fail | Postgres là source of truth; Airtable failure không rollback durable state; nhất quán với FL-002 (US-003) | Block ACK chờ Airtable update: rejected vì Airtable rate limit có thể gây cascading bottleneck |
| `auto_publish_enabled` VÀ `auto_approve_enabled` cả hai phải true | BR1 từ Backlog yêu cầu cả hai; fail closed cho publish; Manager/Admin only (BR2) | Chỉ cần auto_publish_enabled: rejected vì thiếu approval guardrail |
| Product Backlog không cập nhật | US-004 trong backlog đã đủ rõ (4 AC, 3 BR); tránh thay đổi không cần thiết | Cập nhật backlog thêm sub-ACs: rejected vì scope đã đủ; chi tiết nằm trong implementation plan |

---

## Verification

- [x] Tất cả 8 tài liệu bắt buộc đã đọc và constraints được áp dụng.
- [x] US-004 scope không mở rộng sang US-005, US-006, US-008, US-012.
- [x] Không có platform API code trong Policy Engine hoặc Orchestrator.
- [x] RabbitMQ messages là references-only (body/token/secret không được phép trong contract).
- [x] Mọi external event có idempotency key (3 formulas cho 3 levels).
- [x] Worker ACK chỉ sau Ledger commit (documented trong processing logic bước 7 và gate POL-005).
- [x] Không log token/secret/raw credential (gate POL-007).
- [x] Postgres tenant data yêu cầu RLS + `SET LOCAL app.current_workspace_id` (gate POL-001, POL-002, POL-003).
- [x] Transactional outbox cho publish handoff (gate POL-008).
- [x] Acceptance criteria trong backlog được map rõ ra AC1-AC12 trong implementation plan.
- [x] Không secrets trong tài liệu được tạo.

---

## Open Items / Next Steps

| ID | Item | Owner | Priority |
|:---|:---|:---|:---|
| OQ-004-1 | Forbidden terms list ban đầu (Q-004 từ Risk Log) | BA/Marketing | P0 cho implementation |
| OQ-004-2 | `policy_version` source: hardcode hay versioned config table? | Tech Lead | P0 cho idempotency key |
| OQ-004-3 | `auto_approve_enabled` per-workspace hay global? Ai được bật? | Product Owner | P1 |
| OQ-004-4 | Slack alert channel cho policy block | SMM/Ops | P1 |
| OQ-004-5 | Khi auto_publish_disabled: có cần notify Manager không? | Product Owner | P2 |
| OQ-004-6 | `publish_jobs` table đã có từ US-005 migration hay US-004 tự tạo? | Tech Lead | P0 cho DB migration ordering |
| OQ-004-7 | Facebook text limit check: cần check link attachment constraints không? | BA | P2 |
| OQ-004-8 | UTM warn_only: global hay per-workspace config? | Product Owner | P2 |
| Next step | Engineer bắt đầu với Phase 1: Contracts & Schema (T-001 đến T-008) | Backend team | Sprint 2 |
| Next step | Resolve OQ-004-1 và OQ-004-6 trước khi bắt đầu Phase 2 | BA + Tech Lead | Sprint 2 |