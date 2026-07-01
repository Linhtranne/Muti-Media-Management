# Report: Setup Plan cho US-014 RabbitMQ Event Bus

**Date:** 2026-06-03
**Agent(s) Used:** project-planner, backend-specialist, event-architect
**Related User Story:** US-014
**Status:** Completed

## Summary
Đã hoàn thành việc lập plan cho US-014 (RabbitMQ Event Bus). Đã review toàn bộ docs kiến trúc, coding convention, và các spawner skills chuyên sâu (`queue-workers`, `event-architect`, `postgres-wizard`). Đã scan hệ thống hiện tại để bảo đảm backward compatibility.

## What Was Done
- [x] Quét kiến trúc queue hiện tại (`apps/orchestrator/src/queue/`).
- [x] Đọc và áp dụng các pattern từ Spawner skills (BullMQ/RabbitMQ patterns, DLQ, Idempotency, Graceful shutdown).
- [x] Cập nhật `docs/requirements/05_Function_Flow_Logic_Register.md` cho mục FL-008.
- [x] Tạo file kế hoạch chi tiết `docs/plans/US-014/PLAN-us-014-rabbitmq-event-bus.md`.

## How It Was Done
### Approach
1. **Discovery:** Dùng bash/grep để phân tích cấu trúc queue consumer/publisher hiện tại. Hiện tại dự án đang xài `amqplib` (thông qua `rabbitmqPublisher.ts` và `rabbitmqConsumer.ts`).
2. **Analysis:** Đối chiếu với các file Spawner skill. Xác định các sharp edges (Một số queue đã có DLQ riêng, nhưng DLQ/retry TTL/confirm ACK/idempotency chưa được chuẩn hóa toàn hệ thống).
3. **Plan Formulation:** Viết bản plan chi tiết tập trung vào việc tạo base class/utility hỗ trợ DLQ, Idempotency (gắn liền với Postgres Ledger), và retry. Không rewrite toàn bộ worker cũ nhưng cung cấp cơ chế để migrate hoặc áp dụng rule mới (ACK sau khi commit).

### Tools & Skills Used
| Tool/Skill | Purpose |
|:---|:---|
| `grep_search` | Tìm kiếm các queue/exchange đang dùng. |
| `view_file` | Đọc skill yaml để trích xuất pattern chuẩn. |
| `event-architect` | Đảm bảo payload queue chỉ chứa reference (Zero-Token). |
| `queue-workers` | Đảm bảo rule DLQ, Idempotency, và Graceful Shutdown. |

### Files Changed
| File | Action | Description |
|:---|:---|:---|
| `docs/requirements/05_Function_Flow_Logic_Register.md` | Modified | Cập nhật spec chi tiết cho FL-008. |
| `docs/plans/US-014/PLAN-us-014-rabbitmq-event-bus.md` | Created | File kế hoạch implement US-014. |
| `docs/reports/US-014/REPORT-us-014-plan-setup-2026-06-03.md` | Created | Report hoàn thành task planning. |

## Impact & Purpose
Cung cấp một nền tảng Event Bus chuẩn xác, an toàn, và có thể mở rộng cho các luồng xử lý bất đồng bộ (publish, comment, DM). Loại bỏ nguy cơ mất data, rò rỉ token, và xử lý trùng lặp.

## Decisions Made
| Decision | Rationale | Alternatives Considered |
|:---|:---|:---|
| Không đổi sang thư viện queue khác (như BullMQ) | Dự án đã dùng `amqplib` và RabbitMQ. Việc đổi sang Redis-based queue sẽ phá vỡ kiến trúc hiện tại và yêu cầu Redis. | Dùng BullMQ (bỏ qua vì đang xài RabbitMQ). |
| Giữ nguyên các worker hiện hành, nâng cấp helper | Requirement yêu cầu không được rewrite toàn bộ worker. Ta sẽ nâng cấp `rabbitmqConsumer` và `rabbitmqPublisher` để hỗ trợ DLQ/Idempotency. | Rewrite toàn bộ (vi phạm requirements). |

## Verification
- [x] Docs updated (FL-008)
- [x] No secrets exposed
- [x] Acceptance criteria met: Chuẩn bị đủ plan cho AC của US-014

## Open Items / Next Steps
- Chờ user approve plan.
- Bắt đầu implement các base queue class và DLQ logic.
