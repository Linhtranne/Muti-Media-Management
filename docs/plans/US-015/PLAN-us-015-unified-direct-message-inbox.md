# AI-SDLC Retrofit Header for US-015

status: approved

## Goal

Maintain US-015 behavior for Unified Direct Message Inbox according to the approved backlog, function flow, and implementation evidence.

## Tasks

- AC-001: Preserve the documented trigger, processing, and output workflow.
- AC-002: Preserve tenant isolation, idempotency, and durable Ledger/audit evidence where applicable.
- AC-003: Preserve zero-token and reference-only security boundaries.
- AC-004: Keep the story compatible with build, lint, tests, and AI-SDLC artifact validation.

## Done When

- AC-001: Story workflow matches the accepted implementation report and function flow register.
- AC-002: Ledger, idempotency, queue, and role/security constraints are documented or tested where applicable.
- AC-003: No raw tokens or oversized/raw provider payloads cross forbidden boundaries.
- AC-004: `npm run ai-sdlc:check -- US-015` passes after retrofit artifacts are present.

# Implementation Plan: US-015 - Unified Direct Message Inbox

Cung cấp giải pháp Inbox tin nhắn trực tiếp hợp nhất (Unified DM Inbox) cho các nền tảng Messenger, Instagram, và Zalo, sử dụng RabbitMQ để xử lý bất đồng bộ, Postgres Ledger làm nguồn thông tin tin cậy (Source of Truth) và tích hợp Slack/Teams để theo dõi và phản hồi.

---

## 1. Current State Scan

### Hiện trạng Schema & Code liên quan:
* **interactions & comments (US-007):** Bảng `interactions` lưu trữ thông tin comment Facebook và liên kết sang `comments` để giữ body, permalink. 
* **workspace_members (US-008/009):** Lưu thông tin thành viên và phân quyền qua cột `role`. US-009 đã mở rộng `role` enum hỗ trợ thêm role `support`.
* **Slack commands (US-009):** Triển khai `/reply_comment` lưu log vào `comment_action_events` và đẩy job async qua RabbitMQ `slack.comment_action.requested`.
* **RabbitMQ Topology (US-014):** Khai báo tập trung qua `topologyConfig.ts` và tự khởi tạo ở `rabbitmqConsumer.ts`/`rabbitmqPublisher.ts`.
* **event_bus_messages (US-014):** Bảng lưu dấu vết idempotency, hỗ trợ check trùng khóa `(workspace_id, idempotency_key)` và retry/DLQ.

### Quyết định Thiết kế Data Model:
* **Tách riêng bảng:** Không tái sử dụng bảng `interactions` cho DMs để tránh pollution schema (DMs có cấu trúc phân cấp thread/conversation và luồng reply phức tạp hơn comment).
* **Bảng mới:** Tạo các bảng `conversations`, `conversation_messages`, và `direct_message_reply_jobs` độc lập.
* **Số thứ tự Migration tiếp theo:** `0015_us015_unified_direct_message_inbox.sql` đặt sau `0014_us014_event_bus_messages.sql`.

---

## 2. MVP Scope

### Phạm vi MVP:
1. **Target Platform:** Chỉ bật runtime xử lý cho **Facebook Messenger DM** thông qua mock MCP server/webhooks.
2. **Instagram / Zalo:** Chỉ định nghĩa ở mức schema, Zod contract và topology configuration (future-compatible), hoàn toàn tắt (disabled) ở runtime của môi trường production trong US-015.
3. **Slack Command:** Cung cấp lệnh slash command riêng biệt `/reply_dm` dành cho support/manager/admin. Không tích hợp Teams trong MVP này.

---

## 3. Data Model

### Đề xuất Schema Additive (`0015_us015_unified_direct_message_inbox.sql`):

```sql
BEGIN;

-- Conversations Table
CREATE TABLE IF NOT EXISTS conversations (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id              TEXT NOT NULL,
  platform                  TEXT NOT NULL CHECK (platform IN ('facebook', 'instagram', 'zalo')),
  channel_account_id        UUID NOT NULL REFERENCES channel_accounts(id) ON DELETE RESTRICT,
  external_thread_id        TEXT NOT NULL,
  customer_ref              JSONB NOT NULL DEFAULT '{}', -- { name, external_user_id }
  customer_display_name     TEXT,
  status                    TEXT NOT NULL DEFAULT 'new'
                              CHECK (status IN ('new', 'assigned', 'waiting', 'resolved', 'escalated')),
  assigned_to_member_id     UUID REFERENCES workspace_members(id) ON DELETE SET NULL,
  assigned_slack_user_id    TEXT,
  last_message_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sla_due_at                TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_conversations_workspace_platform_external
    UNIQUE (workspace_id, platform, external_thread_id)
);

-- Conversation Messages Table
CREATE TABLE IF NOT EXISTS conversation_messages (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          TEXT NOT NULL,
  conversation_id       UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  external_message_id   TEXT NOT NULL,
  direction             TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  sender_type           TEXT NOT NULL CHECK (sender_type IN ('customer', 'agent', 'bot')),
  body                  TEXT, -- Plaintext Ledger storage (protected by RLS)
  body_redacted         TEXT, -- Redacted version for external tools/Slack
  attachments_ref       JSONB NOT NULL DEFAULT '[]', -- [{ type, url_ref, id }]
  created_at_platform   TIMESTAMPTZ NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_conversation_messages_external
    UNIQUE (workspace_id, conversation_id, external_message_id)
);

-- Direct Message Reply Jobs Table
CREATE TABLE IF NOT EXISTS direct_message_reply_jobs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          TEXT NOT NULL,
  conversation_id       UUID NOT NULL REFERENCES conversations(id) ON DELETE RESTRICT,
  message_id            UUID REFERENCES conversation_messages(id) ON DELETE SET NULL,
  actor_id              UUID REFERENCES workspace_members(id) ON DELETE RESTRICT,
  reply_body            TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'received'
                          CHECK (status IN ('received', 'queued', 'processing', 'succeeded', 'failed', 'rejected')),
  idempotency_key       TEXT NOT NULL,
  platform_result_ref   JSONB NOT NULL DEFAULT '{}',
  error_code            TEXT,
  error_message         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_dm_reply_jobs_idempotency
    UNIQUE (workspace_id, idempotency_key)
);

-- Indexes for performance & SLA monitoring
CREATE INDEX IF NOT EXISTS idx_conversations_workspace_status ON conversations (workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_conversations_workspace_assigned ON conversations (workspace_id, assigned_to_member_id);
CREATE INDEX IF NOT EXISTS idx_conversations_last_message ON conversations (workspace_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_sla ON conversations (workspace_id, sla_due_at) WHERE status != 'resolved';
CREATE INDEX IF NOT EXISTS idx_conversation_messages_lookup ON conversation_messages (workspace_id, conversation_id, created_at_platform);
CREATE INDEX IF NOT EXISTS idx_dm_reply_jobs_status ON direct_message_reply_jobs (workspace_id, status);

-- ─── FK Assignment Tenant Guard ───────────────────────────────────────────────
-- To ensure that conversations are never assigned to members belonging to another workspace,
-- the repository/service layer must strictly validate that the assigned member belongs
-- to the same workspace: WHERE id = :assigned_to_member_id AND workspace_id = :workspace_id.
-- In production, the DB unique constraint on (workspace_id, id) is supported, but for MVP
-- this constraint is enforced at the repository and verified via tenant assignment tests.

-- Enable RLS and isolate by workspace_id
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE direct_message_reply_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY conversations_workspace_isolation ON conversations
  AS RESTRICTIVE FOR ALL
  USING (workspace_id = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));

CREATE POLICY conversation_messages_workspace_isolation ON conversation_messages
  AS RESTRICTIVE FOR ALL
  USING (workspace_id = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));

CREATE POLICY dm_reply_jobs_workspace_isolation ON direct_message_reply_jobs
  AS RESTRICTIVE FOR ALL
  USING (workspace_id = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));

COMMIT;
```

---

## 4. Shared Contracts

Định nghĩa strict schemas trong `packages/shared-contracts/src/events/envelope.ts` và export từ `index.ts`:

1. **DirectMessageIngestEventSchema:** payload của sự kiện `dm.<platform>.ingest`.
2. **DirectMessageReplyRequestedEventSchema:** payload của sự kiện `dm.reply.requested`.
3. **ConversationStatusSchema:** Zod enum `["new", "assigned", "waiting", "resolved", "escalated"]`.

### Quy tắc Bảo mật Dữ liệu nhạy cảm (Forbidden Fields Guard):
* Zod schema tự động áp dụng `superRefine` để từ chối bất kỳ message nào chứa các trường cấm: `token`, `access_token`, `refresh_token`, `secret`, `secret_ref`, `api_key`, `authorization`, `bearer`, `raw_response`, `raw_payload`.
* Sử dụng number literal cho phiên bản sự kiện (`event_version: 1`), không sử dụng string.

---

## 5. Queue Topology

Khai báo các queue mới vào `QUEUE_TOPOLOGY` tại `apps/orchestrator/src/queue/topologyConfig.ts`:

| Queue Name | Routing Key | Exchange | Prefetch | Max Retries | Worker Binding |
|:---|:---|:---|:---|:---|:---|
| `dm.facebook.ingest` | `dm.facebook.ingest` | `mediaops.events.topic` | 5 | 5 | `DirectMessageIngestWorker` |
| `dm.instagram.ingest` | `dm.instagram.ingest` | `mediaops.events.topic` | 5 | 5 | Stub |
| `dm.zalo.ingest` | `dm.zalo.ingest` | `mediaops.events.topic` | 5 | 5 | Stub |
| `dm.reply.requested` | `dm.reply.requested` | `mediaops.events.topic` | 1 | 5 | `DirectMessageReplyWorker` |

* **DLQ:** Mỗi queue đều đi kèm một DLQ riêng (`<queue_name>.dlq`).
* **Retry Queue:** Cơ chế retry thông qua hàng đợi tạm (TTL) dựa theo mảng `[1000, 2000, 4000, 8000]` ms.
* **Deduplication:** Enforce `event_bus_messages` idempotency guard trước khi gọi logic nghiệp vụ của worker.

---

## 6. Ingestion Flow

1. **MCP Webhook Receiver:** MCP server nhận webhook từ Facebook Messenger, kiểm tra chữ ký, sau đó publish sự kiện reference-only `dm.facebook.ingest` qua RabbitMQ.
2. **Queue Validation:** Ingest Worker nhận event, kiểm tra schema và thực hiện check trùng bằng `checkIdempotency()`.
3. **Context Reload:** Worker gọi MCP tool `get_direct_message` để lấy body tin nhắn đầy đủ (Zero-Trust boundary). **MCP tool này bắt buộc phải được định nghĩa và triển khai trong Facebook MCP server như một phần của US-015**. Tool sẽ nhận `channel_account_id` cùng `external_message_id`/`external_thread_id` để tải đầy đủ nội dung tin nhắn và danh sách file đính kèm (credentials/tokens được giải quyết nội bộ trong MCP server). Đối với môi trường test/mock, mock MCP server phải trả về mock content xác thực theo message ID.
4. **Ledger Commit:**
   * Upsert conversation: Tìm kiếm thread theo `(workspace_id, platform, external_thread_id)`. Nếu mới, tạo thread và tính `sla_due_at` (NOW + `DM_SLA_HOURS` hoặc 2 tiếng mặc định).
   * Insert message: Ghi nhận message vào bảng `conversation_messages` cùng với plain text body.
5. **Auditing:** Ghi nhận sự kiện audit `DM_RECEIVED` và `DM_INGESTED` (hoặc `DM_DUPLICATE_IGNORED`).
6. **Slack Alert:** Nếu là tin nhắn mới từ khách hàng, gửi alert tóm tắt (không kèm full content/token) đến Slack channel.
7. **ACK:** Chỉ thực hiện `channel.ack(msg)` sau khi Ledger transaction commit thành công.

---

## 7. Reply Flow

1. **Slack Slash Command:** `/reply_dm <conversation_id> <message>` được kích hoạt từ Slack.
2. **Middleware Authorization Check:**
   * Xác minh Slack signature và timestamp.
   * Lấy Slack user ID và truy vấn role trong `workspace_members`.
   * Cho phép role `support`, `manager`, `admin`. Chặn role `creator` và `viewer`.
3. **Job Insertion:** Tạo bản ghi job ở trạng thái `received` trong bảng `direct_message_reply_jobs` và gửi sự kiện `dm.reply.requested`.
4. **Reply Worker Execution:**
   * Khóa dòng job, chuyển trạng thái sang `processing`.
   * Gọi MCP tool `send_direct_message` để gửi tin nhắn đến Facebook Page (Graph API call hoàn toàn nằm trong MCP server).
   * Nhận phản hồi thành công từ MCP, cập nhật job sang `succeeded`, insert message phản hồi (`outbound`) vào `conversation_messages`, và chuyển trạng thái conversation sang `waiting` (đang đợi khách hàng phản hồi).
   * Ghi nhận audit `DM_REPLY_SUCCEEDED`.
   * Acknowledge RabbitMQ message.

---

## 8. Security & Privacy

* **Plaintext Ledger & RLS:** Dữ liệu DM đầy đủ được lưu plaintext trong Ledger Postgres, bảo vệ bằng chính sách RLS cực kỳ chặt chẽ theo tenant (`workspace_id`).
* **Zero Token Rule:** Tuyệt đối không lưu token hoặc secret trong queue, log, Slack notifications, Airtable, Notion.
* **Slack Preview Redaction:** Slack alert chỉ hiển thị tối đa 80 ký tự (`body_preview` hoặc `body_redacted`), che giấu thông tin cá nhân/nhạy cảm.
* **Sanitized Audit:** Tất cả metadata của audit log đều được làm sạch qua `AuditLogRepository`.

---

## 9. Backward Compatibility

* Không thay đổi hoặc tái sử dụng bất kỳ queue/exchange/routing key nào của publish workflow cũ hay comment sync cũ.
* Bảng `interactions` (US-007) được bảo toàn nguyên vẹn.
* Sử dụng chung cơ chế role-mapping và validation của workspace member từ US-008/US-009.

---

## 10. Test Matrix

### Shared Contracts:
- Test Zod schemas chặn đứng các payload chứa access_token/secret_ref (kể cả camelCase/PascalCase).

### Ingestion Flow:
- Test duplicate `external_message_id` không tạo message mới (được ACK no-op).
- Test payload sai định dạng -> trôi vào DLQ.
- Test DB crash -> requeue tin nhắn.

### Reply Flow:
- Test role creator/viewer bị chặn khi reply.
- Test role support/manager/admin được phép reply.
- Test reply job idempotency (trùng key không gửi 2 lần).
- Test MCP boundary: Đảm bảo orchestrator không gọi Graph API trực tiếp.

### RLS Isolation:
- Test truy cập chéo workspace ID khác bị từ chối ở mức DB policy.

---

## 11. Quyết định về các Câu hỏi mở (Open Questions Decisions)

1. **MVP Platform:** Chốt Facebook DM generic/mock MCP first. Instagram/Zalo chỉ cấu hình topology future-compatible.
2. **DM Body Storage:** Lưu plaintext trong Ledger ở MVP, bảo mật qua RLS restrictive. Đưa column-level encryption vào danh sách Open Item cho phase tiếp theo.
3. **Slack Command:** Tạo command `/reply_dm` độc lập.
4. **SLA Defaults:** Đọc từ biến môi trường `DM_SLA_HOURS` (mặc định 2).
5. **Assignment:** Schema lưu cả `assigned_to_member_id` (canonical UUID) và `assigned_slack_user_id` (Slack integration helper).

---

## 12. Rollout Plan

1. Áp dụng file migration `0015_us015_unified_direct_message_inbox.sql` vào DB.
2. Set feature flag `DM_INBOX_ENABLED=true` và cấu hình env `DM_SLA_HOURS=2`.
3. Khởi động RabbitMQ topology (hệ thống tự tạo các queue/bindings mới).
4. Thực hiện smoke test: ingest tin nhắn mock -> verify Ledger -> verify Slack alert.
5. Thực hiện smoke test: gửi command reply từ Slack -> verify MCP tools call -> verify update status.

---

## 13. Production Readiness Checklist

* [ ] Không có secrets/tokens xuất hiện trong queue message payload, log, hoặc audit.
* [ ] RLS policies được định nghĩa đầy đủ (`USING` + `WITH CHECK`).
* [ ] Consumer ACK chỉ xảy ra sau khi Ledger đã commit và đánh dấu idempotency thành công.
* [ ] DLQ ghi nhận audit `QUEUE_EVENT_DLQ` đầy đủ.
* [ ] feature flag và SLA env variable được cấu hình đúng.
* [ ] Luồng test coverage đảm bảo không bị regression ở comment sync.


## AI-SDLC AC Traceability (Retrofit Audit)

- AC1: Planned and defined.
- AC2: Planned and defined.
- AC3: Planned and defined.
- AC4: Planned and defined.
