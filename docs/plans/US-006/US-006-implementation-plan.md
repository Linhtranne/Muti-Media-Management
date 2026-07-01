# US-006 Implementation Plan: Facebook MCP Publish Post

## 1. Title

**US-006 — Facebook MCP publish post**

---

## 2. Context

US-006 là bước cuối cùng trong flow publish của hệ thống MediaOps (Epic E03). 
Ở các bước trước:
- **US-004** đã kiểm tra các rule policy và tạo stub cho `publish_jobs`.
- **US-005** đã thực hiện deep validation thông qua MCP tool `validate_post` và `get_rate_limit_status`, cập nhật trạng thái job thành `validated` và đẩy event `publish.facebook.validated` vào RabbitMQ.

**US-006** sẽ chịu trách nhiệm "chốt hạ" việc đưa nội dung lên Facebook:
- Xác định khi nào job đạt đến thời điểm `scheduled_at`.
- Gọi tool `publish_post` trên Facebook MCP Server.
- Xử lý kết quả trả về từ MCP Server (lưu `external_post_id`, xử lý lỗi).
- Cập nhật trạng thái Post trên Airtable thành `Published` hoặc `Failed`.
- Phát đi event thông báo kết quả (Slack alert).

**Ranh giới hệ thống (Nghiêm ngặt):**
- Orchestrator **tuyệt đối không** gọi Facebook Graph API trực tiếp.
- `publish_post` MCP tool là nơi duy nhất tương tác với POST `/feed` của Graph API.
- Actual Facebook Page Token **chỉ tồn tại** trong RAM của Facebook MCP server process và không được truyền qua HTTP payload giữa Orchestrator và MCP server.

---

## 3. Goal

1. **Scheduling / Triggering:** Xử lý cơ chế chờ đến đúng thời điểm `scheduled_at` để thực hiện publish. (Sử dụng delayed queue, hoặc poller worker).
2. **Execute Publish:** Orchestrator gọi MCP tool `publish_post` với input là `secretRef`, `channelAccountId`, và các data của bài post (message, link, hashtags).
3. **Persist State:** Cập nhật `publish_jobs.status` thành `publishing`, sau đó `published` (kèm `external_post_id`) hoặc `failed`.
4. **Sync Airtable:** Cập nhật trạng thái Record trên Airtable tương ứng sang `Published` hoặc `Failed`.
5. **Alerting:** Publish RabbitMQ event `alerts.slack.send` để báo cáo thành công (kèm link bài viết) hoặc thất bại.
6. **Audit Logging:** Ghi nhận đầy đủ audit event trước và sau khi gọi MCP.

---

## 4. Non-goals

- Không implement comment sync (đây là scope của US-007).
- Không implement retry cho các lỗi token/permission (Permanent errors). Chỉ retry các lỗi network 5xx từ Facebook.
- Không support các định dạng Media phức tạp (Reels, Carousel) trong MVP (chỉ text, link, và hashtag).
- Không implement OAuth flow mới (sử dụng Token reference do US-011 tạo ra).

---

## 5. Scope

**In scope:**
- Scheduler Worker quét `publish_jobs` có `status='validated' AND scheduled_at<=NOW()` rồi đẩy message vào queue `publish.facebook.execute`.
- Execution Worker consume `publish.facebook.execute` queue để thực hiện gọi MCP.
- Cập nhật schema/trạng thái database (nếu cần mở rộng từ US-005).
- Facebook MCP Server tool `publish_post`.
- Mappings lỗi Graph API (OAuthException) thành các Enum Errors rõ ràng.
- Cập nhật Airtable API.
- Push messages tới `alerts.slack.send` queue.

**Out of scope:**
- Slack Slash command handler (US-008).
- Data Analytics/Reporting (US-012).

---

## 6. Architecture Fit & Sequence

```text
Airtable (Control Plane)
    ▲
    │ (6) PATCH Status = 'Published'
    │
Orchestrator Worker (US-006)
    │
    │ (1) Scheduler query DB -> đẩy event 'publish.facebook.execute' vào queue
    │ (1b) Execution Worker consume 'publish.facebook.execute'
    │ (2) Read Job & Variant from Ledger
    │ (3) Call MCP: publish_post(secretRef, pageId, message, link)
    │ (5) Update Ledger & Send Slack Alert
    ▼
Facebook MCP Server (US-006)
    │
    │ (4) Get Token from Secret Store -> Call Graph API POST /{page_id}/feed
    ▼
Facebook Graph API
```

### Happy Path (Publish Pass)

1. **Trigger:** Message `publish.facebook.execute` được worker nhận khi `scheduled_at <= NOW()`.
2. **Transaction Start:** Lock job trong `publish_jobs`, kiểm tra status `validated`. Nếu status khác `validated` → ACK, no-op (Idempotency).
3. **Transition:** Cập nhật `publish_jobs.status = 'publishing'`.
4. **Context Load:** Load `variant` (message, hashtags, cta_url), `channel_account`, `token_reference` (cần `secretRef`).
5. **MCP Call:** Orchestrator gọi `publish_post` MCP tool.
6. **MCP Execution:**
   - MCP Server lấy actual token dựa vào `secretRef`.
   - MCP Server parse text content (ghép body + hashtags + url).
   - MCP Server call Graph API: `POST /{page_id}/feed`.
   - MCP Server parse response lấy `id` (post id).
   - MCP Server trả về `PublishPostResult` (có `external_post_id`, không có token).
7. **Ledger Commit:**
   - `publish_jobs.status = 'published'`
   - `publish_jobs.external_post_id = {id}`
   - Tạo Audit Log `MCP_PUBLISH_COMPLETED`.
8. **Airtable Sync:** Gọi Airtable API PATCH record status = 'Published'. (Nếu fail, đánh dấu `airtable_sync_retry_needed = true`).
9. **Slack Alert:** Push vào `alerts.slack.send` báo thành công.
10. **ACK:** ACK RabbitMQ message gốc.

### Fail Path (Publish Fail)

- Nếu Graph API trả lỗi Permission (190, 463) hoặc Validation (không thể bypass) → **Permanent Error**.
- MCP Server trả `PublishPostResult` với `passed = false` và mảng `errors`.
- Orchestrator cập nhật `publish_jobs.status = 'failed'`, ghi lỗi vào `last_error`.
- Orchestrator update Airtable status = 'Failed' (kèm ghi chú lỗi).
- Gửi Slack alert lỗi tới Admin channel.
- ACK message (không retry).

---

## 7. MCP Tool Contracts

### Tool: `publish_post`

**Defined in:** `apps/facebook-mcp-server/src/tools/publishPost.ts`

**Input (`PublishPostInput`):**
```typescript
export interface PublishPostInput {
  jobRef: {
    jobId: string;
  };
  channelAccountId: string; 
  secretRef: string;
  content: {
    body: string;
    hashtags?: string[];
    link?: string;
  };
}
```

**Output (`PublishPostResult`):**
```typescript
export interface PublishPostResult {
  passed: boolean;
  externalPostId?: string;       // Bắt buộc nếu passed = true
  errors?: McpPublishError[];
  warnings?: McpPublishWarning[];
  publishedAt?: string;
}

export interface McpPublishError {
  code: 'PLATFORM_AUTH_FAILED' | 'PLATFORM_RATE_LIMIT' | 'PLATFORM_VALIDATION_ERROR' | 'UNKNOWN_ERROR';
  detail: string; // Sanitized, no tokens
}
```

---

## 8. Database / Ledger Changes

Cần migration `0006_us006_facebook_publish_execution.sql` để bổ sung các field cần thiết vào bảng `publish_jobs`:
- `external_post_id` (TEXT NULL)
- `published_at` (TIMESTAMPTZ NULL)
- `platform_response_summary` (JSONB NULL)
- `publish_idempotency_key` (TEXT NULL UNIQUE)
- `airtable_sync_retry_needed` (BOOLEAN NOT NULL DEFAULT false)
- `publish_attempt_count` (INTEGER NOT NULL DEFAULT 0)

Ngoài ra:
- Mở rộng logic `workflow_runs.status`: `mcp_publish_completed`, `mcp_publish_failed`.
- Đảm bảo index `idx_pj_scheduled` (tạo ở US-005) được sử dụng tốt cho Scheduler Worker.

---

## 9. Scheduling Strategy (Open Question Resolution)

Vì `scheduled_at` có thể là tương lai xa, hệ thống sẽ KHÔNG cho worker consume trực tiếp `publish.facebook.validated` từ RabbitMQ queue (như một số luồng trước đó gợi ý).
**Quyết định chính thức:**
1. US-005 Worker sau khi validate thành công, lưu `publish_jobs` với `status = 'validated'`.
2. Có một Cron-based Worker (Scheduler) chạy mỗi 1 phút: `SELECT id FROM publish_jobs WHERE status = 'validated' AND scheduled_at <= NOW()`.
3. Scheduler này push messages vào queue `publish.facebook.execute` (mới).
4. US-006 Worker consume `publish.facebook.execute` queue và thực hiện gọi MCP.
*Cách này decouple validation event và execution event, dễ scale và không bị block queue.*

---

## 10. Security Requirements

- **Token Privacy:** Token không xuất hiện trong payload input/output của MCP tool. 
- **Graph API Boundary:** Orchestrator KHÔNG chứa package/module để gọi Graph API.
- **Tenant Isolation:** Mọi query cập nhật Database trong Worker đều bọc trong transaction set `app.current_workspace_id`.
- **Airtable Token:** Orchestrator sử dụng service token (hoặc OAuth token) an toàn để PATCH Airtable, không dùng token user frontend.
- **Fail Closed:** Lỗi về quyền hạn token sẽ không retry tự động để tránh khóa tài khoản.

---

## 11. Rollback & Fault Tolerance Plan

- **Nếu Graph API 5xx timeout:** NACK `publish.facebook.execute` để retry (tối đa 3 lần). Cập nhật `publish_jobs.retry_count`.
- **Nếu Airtable API sập:** Vẫn commit Postgres `published` thành công. Cắm cờ `airtable_sync_retry_needed = true` để async worker đồng bộ lại sau, KHÔNG rollback publish của Facebook vì post đã lên live.
- **Nếu MCP Server sập:** Orchestrator timeout khi call MCP, thực hiện NACK và retry theo exponential backoff.

---

## 12. Implementation Tasks

- [ ] **T-000:** Tạo DB Migration `0006_us006_facebook_publish_execution.sql` để bổ sung `external_post_id`, `published_at`, `platform_response_summary`, `publish_idempotency_key`, `airtable_sync_retry_needed`, `publish_attempt_count` vào `publish_jobs`.
- [ ] **T-001:** Định nghĩa `PublishPostInput`, `PublishPostResult` tại `packages/shared-contracts`.
- [ ] **T-002:** Implement Scheduler Worker chạy cron quét `publish_jobs.status = 'validated'` và `scheduled_at <= NOW()`. Đẩy vào queue `publish.facebook.execute`.
- [ ] **T-003:** Implement `publish_post` tool trong `facebook-mcp-server`. Map các error code từ Graph API.
- [ ] **T-004:** Implement Execution Worker trong `orchestrator` consume `publish.facebook.execute`.
- [ ] **T-005:** Implement logic PATCH record trên Airtable (để đổi sang trạng thái `Published` / `Failed`).
- [ ] **T-006:** Implement đẩy event `alerts.slack.send` dựa trên kết quả.
- [ ] **T-007:** Add tests: Contract tests, Unit tests cho `publish_post`, và Integration test cho worker flow.
