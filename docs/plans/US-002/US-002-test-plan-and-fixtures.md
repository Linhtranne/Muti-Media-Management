# AI-SDLC Retrofit Header for US-002

status: approved

## Goal

Maintain US-002 behavior for Airtable Approved Webhook Workflow Trigger according to the approved backlog, function flow, and implementation evidence.

## Tasks

- AC-001: Preserve the documented trigger, processing, and output workflow.
- AC-002: Preserve tenant isolation, idempotency, and durable Ledger/audit evidence where applicable.
- AC-003: Preserve zero-token and reference-only security boundaries.
- AC-004: Keep the story compatible with build, lint, tests, and AI-SDLC artifact validation.

## Done When

- AC-001: Story workflow matches the accepted implementation report and function flow register.
- AC-002: Ledger, idempotency, queue, and role/security constraints are documented or tested where applicable.
- AC-003: No raw tokens or oversized/raw provider payloads cross forbidden boundaries.
- AC-004: `npm run ai-sdlc:check -- US-002` passes after retrofit artifacts are present.

# T-010: Test Plan and Fixtures cho US-002 (Airtable Approved Webhook)

## 1. Docs Read
- `docs/architecture/06_Architecture_Composability.md`
- `docs/architecture/11_Coding_Convention.md`
- `docs/requirements/04_Product_Backlog.md`
- `docs/requirements/05_Function_Flow_Logic_Register.md`
- `docs/project-mgmt/07_Risk_Assumption_Decision_Log.md`
- `docs/requirements/03_SRS_MediaOps_Composability.md`
- `docs/requirements/13_Sprint_1_Backlog.md`
- `docs/plans/US-002/` (T-001 đến T-009)
- Agent Skills: `event-architect`, `queue-workers`, `postgres-wizard`, `backend-specialist`, `database-architect`, `debugger`

## 2. Objective
Xác định kế hoạch kiểm thử, thiết kế kịch bản và fixture chi tiết để đảm bảo US-002 (Airtable Webhook Receiver & Worker) hoạt động đúng theo các nguyên tắc Idempotency, Zero-Trust Reload, và Security Boundary trước khi triển khai code.

## 3. Test Scope
- Receiver Layer: Tiếp nhận webhook, xác thực cơ bản, queue event (references-only).
- Queue Layer: RabbitMQ enqueue, retry policies, redelivery (at-least-once).
- Worker Layer: Airtable DB reload, revalidation (zero-trust), channel account mapping, idempotency check.
- Ledger Layer: Audit log, webhook_events, queue_events, workflow_runs persistence.
- Security/Privacy: Không để lọt token, secret, raw content vào queue/audit.

## 4. Out of Scope
- AI Composer generation execution.
- Facebook Graph API physical publish.
- Slack notification sending (thực thi API thật).
- End-to-end Load Testing (sẽ test riêng ở cấp độ hạ tầng sau).

## 5. Acceptance Criteria Coverage Matrix

| AC/BR ID | Description | Test Scenarios (IDs) |
| :--- | :--- | :--- |
| **AC1** | Event Approved được ghi vào Operational Ledger. | TS-01, TS-02, TS-03 |
| **AC2** | Event trùng không tạo workflow trùng. | TS-02, TS-14 |
| **AC3** | Event không liên quan bị bỏ qua nhưng vẫn có log. | TS-04 |
| **AC4** | Lỗi xử lý có trạng thái failed và message rõ. | TS-10, TS-11, TS-12 |
| **BR1** | Middleware chỉ xử lý Post có status Approved (kể cả sau reload). | TS-01, TS-05, TS-06 |
| **BR2** | Mỗi record_id + version chỉ tạo một workflow. | TS-13, TS-14 |
| **BR3** | Không publish trực tiếp từ webhook (via queue & worker only). | TS-01 |

## 6. Fixture Inventory

Các fixture không bao giờ chứa master_copy, cta_url, asset payload hay raw token.

- `fix_webhook_valid.json`: Event hợp lệ, status `Approved`.
- `fix_webhook_unrelated.json`: Event từ table khác hoặc status `Draft`.
- `fix_airtable_reload_valid.json`: Mock response Airtable API cho trạng thái `Approved`, `is_valid_for_approval = 1`.
- `fix_airtable_reload_stale.json`: Mock response Airtable API trạng thái `In Review`.
- `fix_airtable_reload_advanced.json`: Mock response Airtable API trạng thái `Scheduled`.
- `fix_airtable_reload_invalid.json`: Mock response Airtable API trạng thái `Approved` nhưng `is_valid_for_approval = 0`.
- `fix_db_channel_stubs.json`: Mock dữ liệu channel accounts an toàn trong DB.
- `fix_db_channel_missing.json`: DB không có channel map cho Facebook.

## 7. Test Scenario Matrix

| Scenario ID | Name | Trigger / Input | Expected Result / Output |
| :--- | :--- | :--- | :--- |
| **TS-01** | Valid Approved webhook tạo workflow stub thành công | `fix_webhook_valid.json` + `fix_airtable_reload_valid.json` | Webhook ACK; Workflow stub created; `approved_version = 1`. |
| **TS-02** | Duplicate ingress theo cùng `event_id` | `fix_webhook_valid.json` x2 | Lần 2 bị loại từ Receiver (Duplicate); ACK ngay, không thêm vào queue. |
| **TS-03** | RabbitMQ redelivery sau khi DB commit nhưng broker ACK fail | `fix_webhook_valid.json`, worker commit DB nhưng NACK giả lập | Worker bắt được retry, kiểm tra DB thấy `queue_event` đã xử lý; ACK và bỏ qua. |
| **TS-04** | Unrelated event/table/change type bị `unrelated_ignored` | `fix_webhook_unrelated.json` | Receiver ghi log `unrelated_ignored`, ACK, không đưa vào queue. |
| **TS-05** | Stale Approved webhook khi Airtable đã quay về Draft/In Review | Webhook: Approved, Reload: `fix_airtable_reload_stale.json` | Worker log `state_changed_ignored`, ACK, không tạo workflow. |
| **TS-06** | Approved webhook trễ khi record đã sang Scheduled/Published | Webhook: Approved, Reload: `fix_airtable_reload_advanced.json` | Worker log `already_advanced_ignored`, ACK, không tạo workflow. |
| **TS-07** | `is_valid_for_approval = 0` | Webhook: Approved, Reload: `fix_airtable_reload_invalid.json` | Worker log `invalid_after_reload_ignored`, ACK, không tạo workflow. |
| **TS-08** | Missing channel account | `fix_webhook_valid.json`, `fix_db_channel_missing.json` | Worker log `channel_account_missing`, ACK, no `approved_version`, no `workflow_runs` stub. |
| **TS-09** | Inactive/Disconnected channel account | `fix_webhook_valid.json`, channel status = `Expired` | Worker log `channel_account_inactive`, ACK, no `approved_version`, no `workflow_runs` stub. |
| **TS-10** | Resolver unresolved / retryable failure | Channel map lookup DB fail (Timeout) | If Ledger is writable: record `channel_account_unresolved`, route to DLQ intent, NACK `requeue=false`. If Ledger is unavailable: NACK according to retry policy without ACK. |
| **TS-11** | Airtable reload retryable failure | Airtable API Timeout/502 | Worker log `retryable_failed`, NACK requeue cho RabbitMQ exponential backoff. |
| **TS-12** | Queue enqueue failure ở receiver | RabbitMQ offline khi nhận webhook | Receiver lưu DB state `enqueue_failed`, trả 500 hoặc 200 tuỳ chiến lược (nhưng ưu tiên fallback 500 để Airtable tự retry HTTP). |
| **TS-13** | Concurrent valid approvals với `approved_at` khác nhau tạo version 1 và 2 | 2 webhook valid với timestamp khác nhau tuần tự | Lần 1 tạo `approved_version = 1`. Lần 2 tạo `approved_version = 2`. Cả 2 workflow hợp lệ nếu đúng business flow. |
| **TS-14** | Workflow stub unique conflict được recover thành `duplicate_ignored` | 2 worker cùng xử lý 1 record_id + version do race condition | 1 worker thành công, worker kia hit Unique Constraint, catch và log `duplicate_ignored`, ACK queue. |
| **TS-15** | Production physical delete bị block | Cố gắng gọi ORM `.delete()` trên `workflow_runs` của production workspace | Thất bại. System chỉ cho phép compensating audit entry `workflow_stub_cancelled` và update parent event sang `failed`. |
| **TS-16** | Test workspace physical cleanup được phép | Setup/Teardown trong UT/IT với `workspace_id = test_xxx` | Được phép xoá data để reset state. |
| **TS-17** | Fixture chứa forbidden fields như token/content bị reject | Gửi fixture vi phạm cấu trúc (có `master_copy`) vào Receiver | Schema Validator loại bỏ các field thừa hoặc reject error, không lưu payload thừa vào Ledger. |

## 8. Expected Ledger State Matrix

Dựa theo luồng xử lý:

| Event Result | `webhook_events.status` | `queue_events.status` | `workflow_runs` |
| :--- | :--- | :--- | :--- |
| TS-01 (Success) | `workflow_stub_created` | `acked` | Inserted (status `pending_ai_generation`) |
| TS-04 (Unrelated) | `unrelated_ignored` | (No entry) | (No entry) |
| TS-05 (Stale) | `state_changed_ignored` | `acked` | (No entry) |
| TS-06 (Advanced) | `already_advanced_ignored` | `acked` | (No entry) |
| TS-07 (Invalid approval formula) | `invalid_after_reload_ignored` | `acked` | (No entry) |
| TS-08 (Missing account) | `channel_account_missing` | `acked` | (No entry) |
| TS-09 (Inactive account) | `channel_account_inactive` | `acked` | (No entry) |
| TS-10 (Resolver unresolved with Ledger writable) | `channel_account_unresolved` | `dlq_routed` | (No entry) |
| TS-11 (Retryable Airtable reload) | `retryable_failed` -> `workflow_stub_created` | `retrying` -> `acked` | (No entry) -> Inserted |
| TS-14 (Conflict)| `duplicate_ignored` | `acked` | 1 Inserted, duplicate rejected/reused |

## 9. Expected RabbitMQ ACK/NACK Matrix

- **ACK:** Xử lý thành công (TS-01), bỏ qua an toàn sau khi Ledger commit (TS-04, 05, 06, 07, 08, 09, 14), hit DB unique đã recover thành `duplicate_ignored` (TS-14).
- **NACK (Requeue=true):** Lỗi tạm thời khi Ledger chưa ghi được trạng thái an toàn, hoặc Airtable 5xx/timeout còn trong retry budget (TS-11).
- **NACK (Requeue=false / To DLQ):** Resolver unresolved đã ghi Ledger được và cần operator review (TS-10), corrupt data format, unhandled exception sau max retry.

## 10. Security / Privacy Fixture Rules

1. **Payload Webhook:** Chỉ test với `record_id`, `table_name`, `change_type`, `event_id`, không test đẩy data nội dung.
2. **RabbitMQ Message:** Payload mô phỏng chỉ chứa `{ record_ref, approval_ref, routing_ref }`.
3. **Ledger Audit:** Các test sẽ kiểm tra bảng audit xem có bị dính chuỗi secret nào không.

## 11. Idempotency and Redelivery Coverage

- **Receiver Level:** Check `webhook_events.event_id` exists.
- **Worker Level:** Check `workflow_runs` unique constraint trên `(workspace_id, airtable_record_id, approved_version)` và canonical `idempotency_key`.
- **Queue Level:** Xử lý `redelivered = true` từ message meta, kiểm tra DB nếu trạng thái queue_event đã hoàn tất thì bỏ qua, nếu đang dở dang thì xử lý tiếp theo khoá (idempotency pattern).

## 12. Rollback / Cleanup Rules

- Production data: Append-only, status update. Không test delete.
- Trong quá trình test tự động, mọi fixture sinh ra phải thuộc `workspace_id` dạng `test_xxx` và sau test suite gọi API/DB clear data dựa trên regex `test_%`.

## 13. Verification Checklist
- [x] Mỗi AC và BR có ít nhất một test case.
- [x] Mọi test input, output, trạng thái ledger, và rabbitmq behaviour được mapping rõ ràng.
- [x] Mọi fixture tuân thủ nguyên tắc Security & Privacy.
- [x] Sự thống nhất trạng thái taxonomies (đã define trong các spec trước).

## 14. Open Questions / Risks
- **Risk:** Cần đảm bảo schema validator ở Receiver đủ chặt để không deserialize payload lạ gây memory leak. (Sẽ xử lý ở code level bằng Zod/Pydantic).
- **Question:** Test timeout retry có nên setup RabbitMQ TTL/Dead Letter ngắn lại để test nhanh không? (Có, sẽ config retry delay 1s cho test environment).
