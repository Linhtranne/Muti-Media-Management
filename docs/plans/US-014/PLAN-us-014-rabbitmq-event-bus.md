# Implementation Plan: US-014 - RabbitMQ Event Bus

Cung cấp cơ sở hạ tầng hàng đợi (Queue/Event Bus) chuẩn xác, production-ready cho các luồng Publish, Comment Sync, và Direct Message. Đảm bảo tuân thủ nghiêm ngặt các nguyên tắc zero-trust, idempotency, ACK-after-Ledger-commit, và bảo mật (không token).

## Current State Scan
- Dự án đang sử dụng RabbitMQ qua thư viện `amqplib`.
- Các file quản lý connection và helper đang nằm ở `apps/orchestrator/src/queue/` (`rabbitmqConsumer.ts`, `rabbitmqPublisher.ts`).
- Các worker được bind trực tiếp thông qua helper cũ. Một số queue đã có DLQ riêng nhưng **hành vi DLQ, retry queue (TTL), và confirm ACK/Idempotency chưa được chuẩn hóa và thống nhất toàn hệ thống**.
- Việc khởi tạo queue (Topology) đang bị hardcode rải rác trong các helper/consumer.

## Existing Queue Topology Inventory
Các luồng cũ đã pass test và đang chạy trên production (cần đảm bảo Backward Compatibility):
1. `airtable.webhook.approved` (US-002 webhook ingress)
2. `ai.compose.facebook.requested` (US-003 AI Composer queue)
3. `policy.evaluate.requested` (US-004)
4. `publish.facebook.requested` / `publish.facebook.validated` (US-005 - Validate)
5. `publish.facebook.execute` (US-006 - Publish Execution)
6. `comments.facebook.sync.requested` / `comments.facebook.ingest` (US-007)
7. `slack.post_approval.requested` (US-008)
8. `slack.comment_action.requested` (US-009)
9. `alerts.slack.send` (Shared Alerting)

## Scope / Non-Scope
**Scope:**
- Xây dựng shared wrapper (Consumer/Publisher) cho `amqplib` hỗ trợ Idempotency, DLQ, TTL Retry.
- Cấu hình topology bằng mảng (config-driven).
- Khai báo thêm Canonical Topic Exchange cho event bus mới.

**Non-Scope:**
- KHÔNG chuyển sang BullMQ, Redis, Nest Queue hay framework khác.
- KHÔNG sửa đổi business logic bên trong các worker class hiện tại (giữ nguyên handler).
- KHÔNG đổi tên/routing key của các queue hiện hữu (từ US-001 đến US-013).

## Canonical Event Contract
- File: `packages/shared-contracts/src/events/envelope.ts`.
- Schema bắt buộc của mọi message trong hệ thống:
  - `event_id` (UUID)
  - `type` (String)
  - `workspace_id` (UUID)
  - `idempotency_key` (String)
  - `correlation_id` (String)
  - `causation_id` (String, optional)
  - `payload` (Object - **References Only**, tuyệt đối không truyền raw tokens).

## Ledger / Audit Model
- Mọi logic Idempotency phải dựa trên Transaction của Ledger (Postgres). Worker không tự lưu state trên RAM.
- **Audit Logging:** Khi message rớt vào DLQ, phải ghi nhận sự kiện `QUEUE_EVENT_DLQ` (hoặc taxonomy tương đương trong Ledger / US-010).

## Producer Rules
- **Library:** `amqplib`.
- Phải sử dụng `ConfirmChannel` khi publish. Promise chỉ resolve khi RabbitMQ broker báo đã nhận message.
- Bắt buộc tuân thủ Canonical Event Contract (không raw token).

## Consumer Rules
- **Library:** `amqplib`.
- **Prefetch:** Bắt buộc cấu hình prefetch (e.g., `prefetch: 10`) để backpressure.
- **Idempotency Guard:** Trước khi gọi worker handler, check `idempotency_key` trong DB, skip nếu đã xử lý.
- **ACK Policy:** `channel.ack(msg)` CHỈ được gọi khi hàm handler thực thi xong (Ledger đã commit transaction) HOẶC message đã được confirm publish vào Retry/DLQ queue an toàn.

## Backward Compatibility Plan
- Canonical Topic Exchange mới (`mediaops.events.topic`) sẽ dùng cho chuẩn sự kiện mới.
- Khai báo config array (Topology) sẽ chứa cả các định nghĩa direct exchange và queue cũ, đảm bảo các worker cũ tiếp tục consume đúng như cũ, chỉ thừa hưởng thêm logic Idempotency, Retry, và DLQ nhất quán từ wrapper mới.

## Migration Plan
- Không cần data migration vì RabbitMQ chỉ lưu trữ message transient. Topology migration chỉ yêu cầu deploy orchestrator mới, hệ thống sẽ tự động tạo các Exchange/Queue còn thiếu và setup các bindings/DLQ tương ứng (thông qua `assertExchange`, `assertQueue`, `bindQueue`).

## Implementation Tasks
1. **[Core] Event Contract:** Tạo file `envelope.ts` tại `packages/shared-contracts` với strict Zod schema.
2. **[Topology] Queue Config:** Tạo `topologyConfig.ts` chứa mảng khai báo: `{ exchange, queue, routingKey, dlq, retryTTL, prefetch, workerBinding }`.
3. **[Core] Idempotency Guard:** Cập nhật helper tại `idempotencyGuard.ts` để chặn duplicate messages trước khi gọi handler.
4. **[Core] DLQ & Retry Strategy:** 
   - Thống nhất per-queue DLQ (`<queue_name>.dlq`).
   - Cập nhật wrapper trong `rabbitmqConsumer.ts`: try/catch -> ném vào TTL Retry Queue (với x-message-ttl) -> rớt sang DLQ.
5. **[Core] Publisher:** Nâng cấp `rabbitmqPublisher.ts` dùng `ConfirmChannel` và validate theo Envelope.
6. **[Wiring] Bootstrap:** Sửa logic init RabbitMQ lúc startup để iterate mảng topology và bind các workers.

## Test Matrix
- **Unit Tests:** `idempotencyGuard.ts` chặn duplicate. Envelope schema validates successfully / throws errors.
- **Integration Tests:** 
  - `queueTopology.test.ts`: Khởi chạy mảng config xem có đúng Exchange/Queue/DLQ properties không.
  - Test worker quăng `Transient Error` -> chui vào Retry queue.
  - Test worker quăng `Permanent Error` -> chui thẳng DLQ và sinh ra Audit log.
- **Regression:** Chạy toàn bộ test (`npm test`) đảm bảo Slack, Facebook Sync, Publish vẫn xanh.

## Rollout Plan
1. Merge PR chứa US-014.
2. Tại môi trường Staging, chạy thử các flow hiện hành (Publish, Slack Command, Comment Sync).
3. Đảm bảo toàn bộ topology và DLQ queues được RabbitMQ tạo ra.
4. Triển khai Production (Additive, an toàn tuyệt đối do các handler cũ không thay đổi).

## Production Readiness Checklist
- [ ] No secrets exposed in payload.
- [ ] ACK after Ledger commit verified.
- [ ] Graceful shutdown (SIGTERM intercepts to finish active workers).
- [ ] Queue metrics (Publish, Consume, Retried, DLQ) exposed/auditable.
- [ ] DLQ replay instruction documented for Ops team.
