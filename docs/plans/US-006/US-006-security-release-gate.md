# AI-SDLC Retrofit Header for US-006

status: approved

## Goal

Maintain US-006 behavior for Facebook MCP Publish Execution according to the approved backlog, function flow, and implementation evidence.

## Tasks

- AC-001: Preserve the documented trigger, processing, and output workflow.
- AC-002: Preserve tenant isolation, idempotency, and durable Ledger/audit evidence where applicable.
- AC-003: Preserve zero-token and reference-only security boundaries.
- AC-004: Keep the story compatible with build, lint, tests, and AI-SDLC artifact validation.

## Done When

- AC-001: Story workflow matches the accepted implementation report and function flow register.
- AC-002: Ledger, idempotency, queue, and role/security constraints are documented or tested where applicable.
- AC-003: No raw tokens or oversized/raw provider payloads cross forbidden boundaries.
- AC-004: `npm run ai-sdlc:check -- US-006` passes after retrofit artifacts are present.

# US-006 Security & Release Gate: Facebook MCP Publish Post

## 1. Mục đích

Gate này định nghĩa các tiêu chuẩn bắt buộc về bảo mật, audit, và kiến trúc phải đạt được trước khi tính năng Facebook MCP Publish Post (US-006) được phép merge và deploy lên môi trường Production.

## 2. Tiêu chuẩn Bảo Mật (Security Standards)

- **[SEC-001] Token Privacy & Isolation:** Token cấp quyền cho Facebook Page KHÔNG được xuất hiện ở bất kỳ payload, RabbitMQ message, Log, Audit table, hoặc Airtable record nào.
- **[SEC-002] Secret Storage Access:** Chỉ có tiến trình (process) của Facebook MCP Server mới có quyền truy cập vào Secret Store (hoặc các biến môi trường đặc quyền) để lấy Facebook Page Access Token.
- **[SEC-003] MCP Protocol Sanitization:** Response trả về từ Facebook MCP Server tới Orchestrator (`PublishPostResult`) PHẢI được sanitize, không chứa bất kỳ raw JSON response nào từ Facebook có nguy cơ rò rỉ thông tin nhạy cảm.
- **[SEC-004] No Direct Graph API from Orchestrator:** Phải vượt qua static check đảm bảo codebase của Orchestrator không chứa lời gọi tới `graph.facebook.com`.
- **[SEC-005] Airtable Token Sandbox:** Việc đồng bộ trạng thái ngược lại Airtable phải sử dụng Service Token, không sử dụng Personal Access Token của User để tránh leo thang đặc quyền.
- **[SEC-006] Tenant Isolation (RLS):** Mọi transaction truy vấn dữ liệu từ Ledger (Postgres) trong worker của US-006 đều phải gọi `SET LOCAL app.current_workspace_id = :workspace_id`.
- **[SEC-007] Fail-Closed Principle:** Nếu token hết hạn, bị thu hồi, hoặc thiếu permission scope (OAuthException #190, #463), ứng dụng phải fail-closed, đánh dấu lỗi `PLATFORM_AUTH_FAILED` và ngừng retry ngay lập tức.

## 3. Tiêu chuẩn Độ Ổn Định (Reliability & Robustness)

- **[REL-001] Idempotency:** Worker thực hiện post lên Facebook phải có cơ chế idempotency. (Job chỉ được xử lý 1 lần. Nếu đã sang trạng thái `publishing` hoặc `published` thì các event duplicate sẽ bị ignore).
- **[REL-002] Exponential Backoff Retry:** Chỉ retry đối với các lỗi network (timeout, 5xx từ Facebook MCP).
- **[REL-003] Compensating Transaction cho Airtable:** Nếu việc ghi nhận `published` trên DB Ledger đã thành công, nhưng lời gọi PATCH tới Airtable thất bại, **KHÔNG ĐƯỢC** rollback trạng thái Ledger. (Vì bài post đã lên Facebook thật). Cần có cờ `airtable_sync_retry_needed` để đồng bộ sau.
- **[REL-004] Cron Scheduler Decoupling:** Không sử dụng RabbitMQ long-polling delay messages. Cần có Cron/Scheduler poller độc lập để query DB và push message vào queue khi đến `scheduled_at`.

## 4. Tiêu chuẩn Audit & Telemetry (Observability)

- **[AUD-001] Audit Trail:** Phải có audit log cho các state transition của job:
  - `MCP_PUBLISH_STARTED`: Khi job được bắt đầu thực thi.
  - `MCP_PUBLISH_COMPLETED`: Khi post thành công (kèm `external_post_id`).
  - `MCP_PUBLISH_FAILED`: Khi post thất bại (kèm mã lỗi sanitized).
- **[AUD-002] Log Masking:** Đảm bảo `redact.ts` đã bao gồm các regex mask chuỗi có định dạng giống Access Token.
- **[AUD-003] Slack Alert Routing:** Lỗi post thất bại phải gửi alert tới channel Admin, nhưng không kèm mã token hay raw errors khó hiểu, phải đính kèm `job_id` và link tới Airtable record để tracing.

## 5. Deployment / Rollback Checks

- **[DEP-001] Feature Flags:** Worker poller (Scheduler) và Execution worker của US-006 phải được bọc bằng tính năng bật/tắt qua biến môi trường (ví dụ: `US006_EXECUTION_ENABLED=true`).
- **[DEP-002] Monitoring:** Có metrics đếm số lượng post thành công và số lượng lỗi `PLATFORM_AUTH_FAILED` để phát hiện sự cố hàng loạt.
- **[DEP-003] No Data Loss on Scale-Down:** Việc kill worker đang chạy không được gây thất thoát job (xử lý Graceful Shutdown và NACK nếu chưa commit DB).

---
*Gate Reviewer: Security Auditor (Antigravity)*
*Date: 2026-06-01*

## 6. Implementation References

- **[SEC-001/002]**: \pps/facebook-mcp-server/src/tools/publishPost.ts\ uses \secretStore.resolveSecret()\ and token is never passed back in \PublishPostResult\.
- **[SEC-004]**: Orchestrator delegates all publishing to Facebook MCP server via \FacebookMcpClient.ts\.
- **[REL-001]**: Idempotency handled via \publish_execution_events\ table and \idempotency_key\ in \mcpPublishWorkerRepository.ts\.
- **[REL-002]**: \publishPostHandler\ maps 5xx errors to \PLATFORM_TRANSIENT_ERROR\. \McpPublishWorker\ issues \
ack_requeue\ on transient errors.
- **[REL-003]**: \persistAirtableCompensation\ updates \irtable_sync_retry_needed\ flag if Airtable update fails.
- **[DEP-001]**: \US006_EXECUTION_ENABLED\ environment variable controls \McpPublishScheduler\ loop in \server.ts\.
