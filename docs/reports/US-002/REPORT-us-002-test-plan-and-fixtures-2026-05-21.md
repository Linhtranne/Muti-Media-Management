# Report: US-002 Test Plan and Fixtures

**Date:** 2026-05-21
**Agent(s) Used:** QA/Test Planning Agent (Inheriting backend-specialist, database-architect, debugger, spawner skills)
**Related User Story:** US-002
**Status:** Completed

## Summary
Đã hoàn thành thiết kế Test Plan và Fixtures (T-010) cho US-002, bao gồm đầy đủ các ma trận kiểm thử bao phủ toàn bộ Acceptance Criteria, Business Rules, các kịch bản cạnh (edge cases) và ràng buộc bảo mật / kiến trúc của hệ thống.

## What Was Done
- [x] Tạo file kế hoạch kiểm thử: `docs/plans/US-002/US-002-test-plan-and-fixtures.md`
- [x] Áp dụng các rules từ `AGENTS.md`, `11_Coding_Convention.md` và kiến trúc hệ thống.
- [x] Define Coverage Matrix cho AC1-AC4 và BR1-BR3.
- [x] Thiết kế Test Scenario Matrix bao phủ toàn bộ 17 kịch bản bắt buộc (từ Valid, Duplicate, Stale, Missing Channel đến Concurrent/Idempotency issues).
- [x] Thiết kế Expected Ledger State Matrix và RabbitMQ ACK/NACK Matrix.
- [x] Xác định các quy tắc Fixture Security và Rollback trong test.
- [x] Post-review correction: aligned expected statuses with final US-002 taxonomy (`workflow_stub_created`, `acked`, `pending_ai_generation`, `duplicate_ignored`) and clarified resolver unresolved DLQ handling.

## How It Was Done
### Approach
1. Đọc và phân tích các tài liệu yêu cầu, kiến trúc và spec (06, 11, 04, 05, 07, 03, 13, và US-002 plans).
2. Tích hợp knowledge từ event-sourcing (RabbitMQ redelivery, CQRS/Projections), PostgreSQL (MVCC, Unique Constraints, Append-only Audit), Queue workers (Idempotency, DLQ, Graceful shutdown).
3. Thiết lập Test Plan với cấu trúc đầy đủ, chỉ rõ cách hệ thống xử lý các "sharp edges" (ví dụ: missing idempotency key dẫn đến data loss, rabbitmq redeliver).
4. Áp dụng Strict boundary: không mang payload nhạy cảm vào webhook payload, audit log. Zero-trust reload tại worker.

### Tools & Skills Used
| Tool/Skill | Purpose |
|:---|:---|
| default_api (view_file) | Đọc các tài liệu kiến trúc, backlog, spawner skills để hiểu bối cảnh. |
| default_api (write_to_file) | Tạo file Test Plan và Report. |
| event-architect (spawner) | Phân tích retry logic, idempotent, redelivery kịch bản. |
| queue-workers (spawner) | Hiểu rõ cơ chế ACK/NACK, DLQ. |
| postgres-wizard (spawner) | Áp dụng unique constraint cho concurrency test case. |

### Files Changed
| File | Action | Description |
|:---|:---|:---|
| `docs/plans/US-002/US-002-test-plan-and-fixtures.md` | Created | Test Plan chi tiết và fixture inventory |
| `docs/reports/US-002/REPORT-us-002-test-plan-and-fixtures-2026-05-21.md` | Created | Report tiến độ và phương pháp làm việc |

## Impact & Purpose
Tạo nền tảng cho việc triển khai QA Automation / Unit Test và Integration Test cho US-002. Đảm bảo mọi dòng code sắp tới được kiểm tra kỹ lưỡng các lỗi phân tán như race condition, data corruption, message duplication.

## Decisions Made
| Decision | Rationale | Alternatives Considered |
|:---|:---|:---|
| Tạo test case hit unique constraint DB thay vì lock ở Redis. | Postgres Ledger là Source of Truth; unique key `(workspace_id, airtable_record_id, approved_version)` đáng tin cậy và không bị stale như distributed locks (Redis). | Dùng Redis DLM, tốn công setup và dễ lỗi timeout lock. |
| Fixture chỉ giới hạn refs, không full data. | Bảo mật & Tuân thủ kiến trúc Event-Bus refs only. | Push full data vào mock message (vi phạm bảo mật & data size). |
| Mock NACK bằng timeout giả. | Dễ test tính năng redelivery / at-least-once của RabbitMQ. | Gửi NACK cứng (không test được network failure scenario thật). |

## Verification
- [x] Tests planned coverage (100% AC/BR).
- [x] Docs updated.
- [x] No secrets exposed in fixture plan.
- [x] Acceptance criteria met: Kế hoạch test đã đủ để xác minh AC1-AC4 và BR1-BR3 của US-002.
- [x] Post-review taxonomy check: removed stale `processed`, `drafting`, and `stale_ignored` expectations from the T-010 matrices.

## Open Items / Next Steps
- Implement Unit/Integration tests based on this plan.
- Generate actual fixture JSON files during implementation.
