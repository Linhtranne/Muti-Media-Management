# AI-SDLC Retrofit Header for US-001

## AI-SDLC AC Traceability (Retrofit Audit)

- AC1: Pass
- AC2: Pass
- AC3: Pass
- AC4: Pass


## AI-SDLC Completion Gate

| Gate | Evidence | Verdict |
|:---|:---|:---|
| Spec approved | docs/specs/SPEC-US-001.md | Pass |
| Plan approved | docs/plans/US-001/ | Pass |
| Red test evidence | docs/testing/US-001/RED-US-001.md | Partial |
| AC-001 trace | Spec, plan, RED, and report mention AC-001 | Pass |
| AC-002 trace | Spec, plan, RED, and report mention AC-002 | Pass |
| AC-003 trace | Spec, plan, RED, and report mention AC-003 | Pass |
| AC-004 trace | Spec, plan, RED, and report mention AC-004 | Pass |
| Build/lint/test evidence | Run `npm run ai-sdlc:validate -- US-001` after retrofit | Pending |
| Runtime smoke | Not run as part of documentation retrofit | Partial |

Retrofit note: this section records compatibility with the new AI-SDLC gate. It does not claim complete historical TDD or production readiness.

# Report: US-001 Airtable Data Model

**Date:** 2026-05-20  
**Agent(s) Used:** Backend/API Architect Agent, Database Architect knowledge, Spawner api-design skill  
**Related User Story:** US-001  
**Status:** Completed  

---

## Summary

Hoàn thành thiết kế tầng logic cho mô hình dữ liệu Airtable Base (T-002) thuộc Sprint 1 của câu chuyện người dùng US-001 (Thiết lập Airtable base cho campaign/post workflow). Dựa trên Scope Lock đã thống nhất ở T-001, tài liệu đặc tả Data Model chi tiết đã được xây dựng tại `docs/plans/US-001-airtable-data-model.md` để bàn giao cho các bước thiết kế kiểu dữ liệu vật lý (T-003) và thiết lập giao diện luồng công việc (T-004).

---

## What Was Done

- [x] Nghiên cứu toàn bộ tài liệu dự án liên quan theo đúng trình tự quy định để trích xuất đầy đủ ràng buộc thiết kế.
- [x] Áp dụng các kiến thức chuyên môn từ Spawner API Design và Database Schema Design để thiết lập mô hình dữ liệu an toàn.
- [x] Tạo lập tài liệu thiết kế data model logic [US-001-airtable-data-model.md](file:///d:/Muti-Media%20Management/docs/plans/US-001-airtable-data-model.md) đầy đủ 14 phần theo yêu cầu đặc tả.
- [x] Định nghĩa chi tiết cấu trúc cho 3 bảng logic: `Campaigns`, `Posts` và bảng stub tham chiếu `Channel Accounts`.
- [x] Thiết kế trường liên kết Linked Record `connected_channel_accounts` và chỉ ra cơ chế hỗ trợ tối ưu việc kiểm tra quy tắc nghiệp vụ BR2.
- [x] Chốt phương án xử lý tệp tin đa phương tiện tối giản qua văn bản `asset_links` để tránh quá tải bộ nhớ Airtable.
- [x] Xác lập ranh giới rõ ràng về in-scope/out-of-scope của mô hình dữ liệu để chống phình scope (scope creep).
- [x] Soạn thảo hướng dẫn bàn giao kỹ thuật (Handoff Notes) chi tiết để chuẩn bị cho giai đoạn T-003.

---

## How It Was Done

### Approach

Quy trình thiết kế sử dụng phương pháp **Layered Analysis & Core Integrity (Phân tích phân tầng & Bảo toàn tính trung thực cốt lõi)**:
1. **Trích xuất ràng buộc**: Duyệt qua tài liệu kiến trúc (Architecture) và bảo mật (Coding Convention) trước để khoanh vùng giới hạn của Airtable (chỉ thuộc Control Plane, cấm tuyệt đối lưu trữ bí mật bảo mật và queue).
2. **Thiết kế quan hệ thực thể**: Bố trí cấu trúc Many-to-Many giữa `Posts` và `Channel Accounts` stub để hỗ trợ SMM linh hoạt chọn nhiều tài khoản đích, đồng thời Rollup trạng thái kết nối hỗ trợ kiểm tra quy tắc BR2 cực kỳ tin cậy ở tầng database.
3. **Phân rã nghiệp vụ**: Thiết lập các trường công thức hỗ trợ BR1, BR2, BR3 mà không lạm dụng code hay tạo automation trong Airtable ở bước này.

### Tools & Skills Used

| Tool/Skill | Purpose |
|:---|:---|
| `Spawner api-design` | Hướng dẫn thiết kế mô hình dữ liệu Predictable, nhất quán, hướng tới developer experience và dễ dàng mở rộng. |
| `Spawner database-schema-design` | Nguyên lý thiết kế khóa ngoại (linked records), trường bắt buộc (NOT NULL), và tối ưu hóa kiểu dữ liệu. |
| `backend-specialist & database-architect` | Tư duy phân tách hạ tầng, bảo mật an toàn thông tin, cô lập rủi ro lộ mã bảo mật. |

### Files Changed

| File | Action | Description |
|:---|:---|:---|
| [US-001-airtable-data-model.md](file:///d:/Muti-Media%20Management/docs/plans/US-001-airtable-data-model.md) | Created | Tài liệu thiết kế data model logic Airtable Base chi tiết gồm 14 chương mục. |
| [REPORT-us-001-airtable-data-model-2026-05-20.md](file:///d:/Muti-Media%20Management/docs/reports/REPORT-us-001-airtable-data-model-2026-05-20.md) | Created | Báo cáo hoàn thành nhiệm vụ này. |

---

## Impact & Purpose

Bản thiết kế logic này đóng vai trò cầu nối quan trọng giữa **Scope Lock cấp sản phẩm (T-001)** và **Cấu hình kiểu dữ liệu vật lý (T-003)**:
- Giúp Database Architect ở T-003 biết rõ cần tạo những trường nào, các giá trị lựa chọn cụ thể là gì mà không phải suy đoán.
- Cung cấp kiến trúc liên kết tài khoản an toàn, bảo vệ hệ thống khỏi các lỗ hổng lộ lọt token (R-005).
- Định hình sẵn hạ tầng dữ liệu tối ưu cho các luồng phê duyệt (Approval Guardrails - T-005) và webhook bàn giao (Handoff Contract - T-006) ở các giai đoạn sau của Sprint.

---

## Decisions Made

| Decision | Rationale | Alternatives Considered |
|:---|:---|:---|
| **Không tạo bảng Assets riêng lẻ** | Tránh cồng kềnh, sử dụng `asset_links` dạng văn bản nhiều dòng để trỏ trực tiếp đến S3/Google Drive giúp tối ưu dung lượng cơ sở dữ liệu Airtable. | Sử dụng Airtable Attachment gốc (gây quá tải bộ nhớ và tốn chi phí). |
| **Thiết kế quan hệ Many-to-Many cho Channel Accounts stub** | Cho phép SMM có thể cấu hình đăng một bài viết lên nhiều Page Facebook cùng lúc nếu cần thiết, tăng tính linh hoạt tối đa cho marketing. | Thiết kế quan hệ One-to-Many hoặc trường text tự do (thiếu linh hoạt hoặc không thể kiểm soát chặt chẽ BR2). |
| **Chốt trạng thái Campaigns** | Đề xuất `Draft`, `Active`, `Paused`, `Completed` làm cơ sở cấu hình cho T-003 nhằm đảm bảo tính đồng bộ của toàn hệ thống. | Để trống trạng thái hoặc định nghĩa rời rạc ở từng task (gây bất đồng nhất dữ liệu). |

---

## Verification

Bản thiết kế đã vượt qua toàn bộ tiêu chí kiểm định (Verification Checklist):

- [x] Đã đọc toàn bộ tài liệu dự án từ T-001 và trích xuất đầy đủ ràng buộc.
- [x] Bảng `Campaigns` chứa đủ các trường cốt lõi bắt buộc (`campaign_id`, `name`, `objective`, `start_date`, `end_date`, `owner`, `status`, `notion_brief_url`).
- [x] Bảng `Posts` chứa đủ các trường quy định (`post_id`, `campaign_id`, `title`, `master_copy`, `cta_url`, `asset_links`, `target_channels`, `scheduled_at`, `status`, `reviewer`, `approved_at`) và liên kết chặt chẽ tới `Campaigns`.
- [x] Bảng stub `Channel Accounts` được xây dựng tinh gọn để hỗ trợ xác thực BR2 đối với kết nối Facebook Page.
- [x] Cam kết tuyệt đối không đưa bất kỳ trường chứa Token bảo mật hay OAuth secrets nào vào Airtable Base.
- [x] Cam kết không triển khai bất kỳ mã code, webhook receiver, automation tự động, hàng đợi RabbitMQ hay AI fields nào trong Airtable ở nhiệm vụ này.
- [x] Khẳng định các trường thông tin bàn giao sang Middleware ( Approved Handoff view) chỉ chứa các tham chiếu (References) và metadata.
- [x] Đầu ra được định dạng khoa học, sẵn sàng chuyển tiếp cho Database Architect triển khai T-003.

---

## Open Items / Next Steps

1. **Chuyển giao cho T-003**: Bàn giao tài liệu thiết kế data model logic này cho Database Architect để bắt đầu xây dựng bảng ánh xạ kiểu dữ liệu vật lý chi tiết (Field Type Matrix).
2. **Q-005 (Quyền phê duyệt)**: Làm rõ với Product Owner về vai trò người phê duyệt để phục vụ thiết lập bảo mật và cấu hình Interface ở bước T-004 và T-005.