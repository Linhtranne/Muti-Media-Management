# 01 - AI Working Rules

File này định nghĩa cách agent phải làm việc trong repo MediaOps Composability theo AI-Driven SDLC.

## 1. Prime Directive

Agent phải giúp repo tiến lên mà không phá vỡ boundary kiến trúc, security model, dữ liệu tenant, queue semantics hoặc audit trail.

Không được ưu tiên “code chạy nhanh” hơn các nguyên tắc:

- References-only queue payload.
- No raw token leakage.
- ACK after Ledger commit.
- Workspace-scoped data access.
- MCP boundary for platform API.
- Shared contract consistency.
- Evidence-based report.

## 2. Không sửa code production khi task chỉ yêu cầu tài liệu

Nếu task là tài liệu, review, plan, report hoặc SDLC:

- Không sửa `apps/**/src/**`.
- Không sửa `packages/**/src/**`.
- Không sửa `db/migrations/**`.
- Không sửa runtime scripts trừ khi được yêu cầu rõ.
- Chỉ tạo/sửa tài liệu trong phạm vi được yêu cầu.

Nếu phát hiện code bug khi đang làm tài liệu, ghi vào Open Items hoặc đề xuất follow-up; không tự sửa.

## 3. Pre-work bắt buộc

Trước khi tạo plan hoặc code:

1. Đọc `docs/architecture/06_Architecture_Composability.md`.
2. Đọc `docs/architecture/11_Coding_Convention.md`.
3. Đọc `docs/requirements/04_Product_Backlog.md`.
4. Đọc `docs/requirements/05_Function_Flow_Logic_Register.md`.
5. Đọc plan/report liên quan nếu có.
6. Inspect code, migration, tests liên quan.

Agent phải nêu ngắn trong final/report đã đọc những nhóm tài liệu nào.

## 4. Scope control

Agent chỉ được sửa đúng phần liên quan trực tiếp đến yêu cầu.

Không làm:

- Refactor rộng khi task chỉ yêu cầu bug fix nhỏ.
- Đổi tên file/folder theo sở thích.
- Sửa formatting hàng loạt.
- “Dọn” dirty files không liên quan.
- Thay đổi migration cũ nếu không cần cho task.
- Chèn dependency mới khi repo đã có cách làm hiện hữu.

Nếu phát hiện vấn đề ngoài scope:

```text
Finding: ...
Impact: ...
Suggested follow-up: ...
Not changed in this task because: out of scope.
```

## 5. Architecture rules

### MCP boundary

- Orchestrator không gọi Facebook Graph API trực tiếp.
- Facebook-specific API, token resolution và platform error mapping nằm trong `apps/facebook-mcp-server`.
- Orchestrator chỉ gọi MCP client/tool contract.

### Queue boundary

- RabbitMQ message chỉ chứa reference, idempotency key, workspace, correlation/causation metadata.
- Không đưa token, body lớn, raw provider response, full DM body hoặc secret ref không cần thiết vào queue.
- Consumer phải validate schema trước khi xử lý.
- Invalid schema đi DLQ và ACK original sau khi DLQ publish confirm.

### Ledger boundary

- PostgreSQL/InsForge là source of truth.
- Worker phải persist state trước khi ACK.
- Không dùng RabbitMQ như durable database.
- Không ghi audit hoặc queue events thiếu `workspace_id`.

### Token and secret boundary

- Raw token không xuất hiện trong logs, Slack, Airtable, Notion, audit metadata, queue payload hoặc report.
- `secret_ref` cũng phải được coi là sensitive boundary; chỉ truyền khi contract thật sự yêu cầu.
- Audit metadata phải được sanitized qua `AuditLogRepository`/redactor.

### Tenant boundary

- Query phải scope bằng `workspace_id`.
- Idempotency phải scope theo workspace.
- Assignment, role lookup, channel/account resolution phải kiểm tra cùng workspace.
- RLS context phải được set trong transaction nếu code path phụ thuộc RLS.

## 6. Implementation rules

### TypeScript

- Giữ strict TypeScript.
- Tránh `any`; nếu bắt buộc, giải thích trong code/test hoặc thu hẹp phạm vi.
- Dùng discriminated union cho result nhiều nhánh.
- Dùng Zod cho runtime validation ở boundary.
- Dùng existing local helpers trước khi tạo abstraction mới.

### Database

- Dùng parameterized SQL.
- Migration phải additive khi có dữ liệu hiện hữu.
- Backfill trước khi thêm `NOT NULL`/CHECK nếu có khả năng dữ liệu cũ không hợp lệ.
- Unique idempotency phải có workspace scope.
- Trigger append-only không được block chính migration/backfill.

### RabbitMQ

- Prefer confirm channel cho publish quan trọng.
- Không dùng blocking sleep để retry.
- Dùng TTL retry queue hoặc scheduler.
- ACK original message chỉ sau khi retry/DLQ publish confirm hoặc Ledger commit.
- DLQ payload phải sanitized và references-only.

### Tests

- Test phải đi cùng risk.
- Contract change cần contract tests.
- Queue behavior cần ACK/NACK/DLQ tests.
- Security boundary cần negative tests.
- Repository SQL critical path cần mock/query assertion hoặc integration test nếu feasible.
- Nếu thêm test file mới, kiểm tra `run-tests.mjs`.

## 7. Documentation rules

Khi thay đổi behavior:

- Cập nhật `docs/requirements/05_Function_Flow_Logic_Register.md`.
- Cập nhật hoặc tạo `docs/reports/REPORT-...md`.
- Nếu task có plan, cập nhật plan status/open items khi phù hợp.
- Report phải factual: what changed, why, files, verification, open items.

Khi chỉ thay đổi tài liệu:

- Không tạo claims vượt quá code hiện có.
- Phân biệt implemented, designed, mock/staging, production blocker.

## 8. AI usage rules

Agent được dùng AI để:

- Tóm tắt tài liệu.
- Tạo plan.
- Sinh code skeleton.
- Review diff.
- Tạo test ideas.

Agent không được:

- Apply AI output mà không đọc diff.
- Bỏ qua validation vì “AI đã chắc”.
- Đưa secret, token thật hoặc raw production data vào prompt.
- Tự sửa nhiều module ngoài scope vì AI đề xuất.
- Che giấu phần không verify được.

## 9. Status language

Khi báo trạng thái, dùng các nhãn rõ ràng:

- `Verified`: đã kiểm tra bằng file/command/test hiện tại.
- `User-reported`: người dùng nói đã xong nhưng agent chưa kiểm chứng.
- `Assumption`: suy luận từ docs/code, chưa chạy.
- `Blocked`: không thể tiếp tục nếu thiếu external access/config.
- `Out of scope`: phát hiện nhưng không sửa theo task hiện tại.

Không dùng:

- “Production-ready” nếu chưa deploy và chưa verify runtime thật.
- “Done 100%” nếu còn external blocker.
- “No risk” cho integration liên quan token, queue, DB hoặc external APIs.

## 10. Final response rules

Final response phải ngắn, cụ thể:

- File đã tạo/sửa.
- Verification đã chạy hoặc chưa chạy.
- Caveat nếu có.
- Không đổ lỗi vòng vo.
- Không giấu blocker.

