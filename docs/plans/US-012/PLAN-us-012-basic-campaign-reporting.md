# AI-SDLC Retrofit Header for US-012

status: approved

## Goal

Maintain US-012 behavior for Basic Campaign Reporting according to the approved backlog, function flow, and implementation evidence.

## Tasks

- AC-001: Preserve the documented trigger, processing, and output workflow.
- AC-002: Preserve tenant isolation, idempotency, and durable Ledger/audit evidence where applicable.
- AC-003: Preserve zero-token and reference-only security boundaries.
- AC-004: Keep the story compatible with build, lint, tests, and AI-SDLC artifact validation.

## Done When

- AC-001: Story workflow matches the accepted implementation report and function flow register.
- AC-002: Ledger, idempotency, queue, and role/security constraints are documented or tested where applicable.
- AC-003: No raw tokens or oversized/raw provider payloads cross forbidden boundaries.
- AC-004: `npm run ai-sdlc:check -- US-012` passes after retrofit artifacts are present.

# Plan: US-012 Basic Campaign Reporting

## 1. Current State Scan
Qua việc rà soát các migration (0001 đến 0012) và luồng dữ liệu (FL-001 -> FL-005):
- Bảng `publish_jobs` lưu trữ trạng thái post: ĐÃ CÓ (`id`, `workspace_id`, `post_id`, `status`, `created_at`, `published_at`). Bảng này **thiếu cột `updated_at`**.
- Bảng `interactions` lưu trữ comments: ĐÃ CÓ (`id`, `workspace_id`, `publish_job_id`, `risk_code`, `status`, `created_at_platform`, `resolved_at`).
- Bảng `content_variants`: ĐÃ CÓ (liên kết giữa AI Worker và Policy Worker).
- Trường `campaign_id`: **THIẾU TRONG TOÀN BỘ LEDGER**. Hiện tại `campaign_id` chỉ nằm trên Airtable. 
- `resolved_at` của bảng `interactions`: **Chưa được tự động cập nhật** khi `SlackCommentActionWorker` update status.

## 2. Schema Gap Analysis & Migration Proposal
- **Gap:** Không thể query report theo `campaign_id` vì thiếu cột. `updated_at` của `publish_jobs` cũng không tự động cập nhật để làm metric last updated.
- **Migration Đề Xuất:** Tạo migration `0013_us012_campaign_reporting.sql`:
  ```sql
  -- 1. Thêm campaign_id vào content_variants, publish_jobs và interactions
  ALTER TABLE content_variants ADD COLUMN IF NOT EXISTS campaign_id TEXT;
  
  ALTER TABLE publish_jobs 
    ADD COLUMN IF NOT EXISTS campaign_id TEXT,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

  ALTER TABLE interactions 
    ADD COLUMN IF NOT EXISTS campaign_id TEXT;
  
  -- 2. Index cho query reporting
  CREATE INDEX IF NOT EXISTS idx_publish_jobs_campaign ON publish_jobs(workspace_id, campaign_id);
  CREATE INDEX IF NOT EXISTS idx_interactions_campaign ON interactions(workspace_id, campaign_id);

  -- 3. Tạo Trigger cập nhật updated_at tự động cho publish_jobs
  CREATE OR REPLACE FUNCTION trigger_set_publish_jobs_updated_at()
  RETURNS TRIGGER AS $$
  BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS set_publish_jobs_updated_at ON publish_jobs;
  CREATE TRIGGER set_publish_jobs_updated_at
  BEFORE UPDATE ON publish_jobs
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_publish_jobs_updated_at();
  ```

- **Logic propagation `campaign_id` (Hop-by-hop):** 
  1. `AiComposerWorker`: Khi reload Airtable, lấy `campaign_id` và gọi `AiWorkerRepository.markCompleted()` để persist `campaign_id` vào bảng `content_variants`.
  2. `PolicyWorkerRepository`: Tại method `loadAndLockContext()`, `SELECT content_variants.campaign_id`. Sau khi pass policy, insert `publish_jobs` với `campaign_id = context.variant.campaign_id`.
  3. `FacebookCommentSyncWorker`: Khi ingest comment, lookup `campaign_id` từ `publish_jobs` và insert vào `interactions`.
  
  *(Nhờ luồng này, MCP hoàn toàn không đọc/biết về Ledger hay Campaign ID).*

## 3. Proposed Data Model
Data map cho các metrics:
- **`campaign_id`**: Lấy từ cột mới ở `publish_jobs`.
- **`posts_published`**: Lấy COUNT từ `publish_jobs` có `status = 'published'`.
- **`publish_failed`**: Lấy COUNT từ `publish_jobs` có `status IN ('failed', 'validation_failed')`. (Loại bỏ `cancelled` vì đó không phải là lỗi publish).
- **`comments_total`**: Lấy SUM count từ CTE pre-aggregate của `interactions` có `interaction_type = 'comment'`.
- **`risk_comments`**: Lấy SUM count từ CTE pre-aggregate của `interactions` có `risk_code = 'CRISIS'`.
- **`avg_response_time`**: `EXTRACT(EPOCH FROM (resolved_at - created_at_platform))` của các interactions đã `resolved`. 
  - *Lưu ý:* Interactions bị `escalated` tạm thời không tính vào avg response time (chỉ tính comment xử lý dứt điểm = resolved).
- **`last_updated_at`**: `MAX(GREATEST(pj.updated_at, COALESCE(comment_agg.max_updated_at, pj.updated_at)))`.

## 4. API Design
- **GET** `/api/v1/reports/campaigns` (Trả JSON array)
- **GET** `/api/v1/reports/campaigns.csv` (Trả CSV text stream)
- **Query Params:**
  - `campaign_id` (optional)
  - `date_from`, `date_to` (optional)
  - `channel_account_id` (optional - thay cho `channel` filter để dùng chung index của `publish_jobs`).
- **Response Schema** sẽ được đặt trong `packages/shared-contracts` với tên schema `CampaignReportResponse`.

## 5. Authorization & Security
- Chỉ user có role `admin` hoặc `manager` (mapping từ `workspace_members`) mới được phép truy cập. 
- Bỏ qua/không tin header role do user tự khai.
- **Không expose** raw body của comment trong report response. Chỉ trả aggregate count.
- **Không có** tokens, secret references, hay provider data ở trong report.

## 6. SQL/View/Repository Design
- Thiết kế **Repository (ReportRepository)**: Dùng CTE để **pre-aggregate `interactions` theo `publish_job_id`** trước khi `LEFT JOIN` với `publish_jobs`. Để tránh double count metrics của `publish_jobs`.
- Mọi queries **bắt buộc** tenant-scoped (`WHERE workspace_id = ?` + `SET LOCAL app.current_workspace_id`).
- Lọc channel: Dùng trực tiếp column `publish_jobs.channel_account_id` cho MVP.

## 7. Audit
- Dùng `AuditLogRepository` (đã có) để ghi lại log mỗi khi report được truy cập.
- Event type: `REPORT_ACCESSED`, `REPORT_EXPORTED`.
- Metadata chỉ log `campaign_id`, `date_from`, `date_to`, `channel_account_id` (Redacted các tham số nhạy cảm khác).

## 8. CSV Export
- API route format trả về `text/csv`.
- Bảng export chỉ có cột aggregate: `campaign_id, posts_published, publish_failed, comments_total, risk_comments, avg_response_time, last_updated_at`.

## 9. Airtable Sync
- MVP: **Chỉ hỗ trợ JSON API + CSV Export.** 
- Airtable synced view sẽ được cân nhắc vào Phase 2.

## 10. Required Code Changes (Implementation Task List)
1. Tạo migration `0013_us012_campaign_reporting.sql`.
2. Update `AiWorkerRepository.markCompleted()` để nhận và save `campaign_id` vào `content_variants`.
3. Update `PolicyWorkerRepository` để SELECT `campaign_id` từ variants, rồi INSERT vào `publish_jobs`.
4. Update `FacebookCommentSyncWorker` để lấy `campaign_id` từ `publish_jobs` ghi vào `interactions`.
5. Bắt buộc: Update `commentActionRepository.updateInteractionStatus()`: 
   ```sql
   UPDATE interactions 
   SET status = $3, 
       updated_at = NOW(), 
       resolved_at = CASE WHEN $3 = 'resolved' THEN COALESCE(resolved_at, NOW()) ELSE resolved_at END
   ```
   Để ghi nhận được `resolved_at` phục vụ tính `avg_response_time`.
6. Implement logic API `ReportRepository` và HTTP Route bằng CTE join và xử lý GREATEST function.

## 11. Test Matrix
- Happy path: CTE aggregate không bị double-count post.
- Publish failed status taxonomy: đếm đúng các status failed, không bao gồm `cancelled`.
- Risk comments: Đếm chuẩn status CRISIS.
- Filter: check `date_from`, `date_to`, `channel_account_id`.
- CSV Output: Kiểm tra đúng format và header.
- Security: Không có comment text hoặc token rò rỉ.
- Auth: Reject request không có quyền `admin` / `manager`.
- RLS / Multi-workspace: Không lộ data của workspace khác.

---

> [!WARNING]
> ## Open Questions (Resolved into Defaults)
> Dưới đây là các câu hỏi mở đã được giải quyết:
>
> **1. `campaign_id` canonical source nằm ở đâu? Nếu hiện chưa persist trong Ledger, nên lưu ở đâu?**
> *Resolved:* Load từ Airtable ở `AiComposerWorker`, lưu vào `content_variants`, propagate qua `publish_jobs` (bởi `PolicyWorkerRepository`), cuối cùng `FacebookCommentSyncWorker` copy sang `interactions`.
>
> **2. `avg_response_time` định nghĩa chính xác là gì?**
> *Resolved:* Là khoảng thời gian từ `interactions.created_at_platform` đến `interactions.resolved_at`. `commentActionRepository` bắt buộc sửa query UPDATE status để set `resolved_at`. `escalated` không tính vào trung bình cộng.
>
> **3. Role nào được xem report?**
> *Resolved:* Role `admin` và `manager`.
>
> **4. Date filter dùng mốc nào?**
> *Resolved:* Lọc theo `publish_jobs.created_at` chung cho MVP. 
>
> **5. Failed statuses chính xác cần tính gồm những status nào?**
> *Resolved:* Gồm `validation_failed`, `failed` (KHÔNG gồm `cancelled`).
>
> **6. Có bắt buộc Airtable synced view trong MVP không?**
> *Resolved:* Chỉ cung cấp JSON + CSV API.
>
> **7. Filter channel sử dụng trường nào?**
> *Resolved:* Sử dụng `channel_account_id` trong MVP.

## Checklist
- [x] Ready for implementation? **YES**


## AI-SDLC AC Traceability (Retrofit Audit)

- AC1: Planned and defined.
- AC2: Planned and defined.
- AC3: Planned and defined.
- AC4: Planned and defined.
