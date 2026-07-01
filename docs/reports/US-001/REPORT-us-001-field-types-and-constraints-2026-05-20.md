# AI-SDLC Retrofit Header for US-001

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

# Report: US-001 Field Types and Constraints

**Date:** 2026-05-20  
**Agent(s) Used:** Database Architect Agent, Spawner database-schema-design skill  
**Related User Story:** US-001  
**Status:** Completed  

---

## Summary

Hoàn thành thiết kế kiểu dữ liệu vật lý và các ràng buộc dữ liệu chi tiết (T-003) cho Airtable Base thuộc Sprint 1 của câu chuyện người dùng US-001 (Thiết lập Airtable base cho campaign/post workflow). Dựa trên mô hình dữ liệu logic T-002 đã được kiểm chứng và phản hồi của người dùng qua Socratic Gate, tài liệu đặc tả cấu hình vật lý chi tiết đã được xây dựng hoàn thiện tại `docs/plans/US-001-field-types-and-constraints.md`. Đây là cơ sở kỹ thuật cốt lõi để các Agent tiếp theo thực hiện thiết lập giao diện luồng công việc (T-004) và cấu hình các chốt chặn an toàn phê duyệt (T-005 Guardrails).

---

## What Was Done

- [x] Nghiên cứu toàn bộ tài liệu dự án liên quan theo đúng trình tự ưu tiên để trích xuất đầy đủ ràng buộc thiết kế.
- [x] Áp dụng các kiến thức chuyên môn từ Spawner Database Schema Design để thiết lập mô hình dữ liệu vật lý an toàn và tối ưu hóa.
- [x] Tạo lập tài liệu thiết kế kiểu dữ liệu vật lý và ràng buộc chi tiết [US-001-field-types-and-constraints.md](file:///d:/Muti-Media%20Management/docs/plans/US-001-field-types-and-constraints.md) gồm đầy đủ 16 chương mục.
- [x] Xác lập quy chuẩn trường hệ thống/API dạng `snake_case` và định nghĩa chi tiết Field Type Matrix cho 3 bảng: `Campaigns`, `Posts` và `Channel Accounts` stub.
- [x] Khóa múi giờ **UTC/GMT** bắt buộc đối với tất cả các trường Date/Date-Time (`scheduled_at`, `approved_at`, `start_date`, `end_date`) để đảm bảo tính dự đoán cho Middleware và Queue.
- [x] Thiết kế giải pháp **kiểm duyệt nền tảng động** (Generalized Platform Verification) để giải quyết yêu cầu kiểm duyệt đa kênh (BR2), sẵn sàng mở rộng cho LinkedIn, Twitter/X, Zalo, YouTube trong tương lai mà không cần đổi cấu trúc DB.
- [x] Định nghĩa chi tiết các trường công thức thông minh (`is_valid_for_approval`, `approval_blockers`) để cung cấp nguyên liệu đầu vào hoàn hảo cho việc xây dựng Guardrails (T-005).
- [x] Cam kết tuyệt đối không đưa bất kỳ trường nào chứa Token bảo mật hay secrets vào Airtable Base.
- [x] Cam kết không thiết kế bất kỳ webhook receiver, automation tự động, hàng đợi RabbitMQ hay mã code backend nào trong Airtable ở nhiệm vụ này.
- [x] Cung cấp hướng dẫn bàn giao chi tiết cho thiết kế View (T-004), cấu hình Guardrails (T-005) và Middleware Contract (T-006).

---

## How It Was Done

### Approach

Quy trình thiết kế sử dụng phương pháp **Dynamic Relational Integrity & Global Predictability (Bảo toàn liên kết động & Khả năng dự đoán toàn cục)**:
1. **Khóa Múi giờ Toàn cục**: Nhận diện rủi ro chênh lệch múi giờ giữa các máy chủ (Timezone Chaos), thiết lập khóa múi giờ UTC/GMT đồng nhất trên tất cả các trường thời gian để Middleware và Queue Worker (RabbitMQ) xử lý chuẩn xác lịch đăng bài.
2. **Kiểm duyệt Đa kênh Động**: Thay vì kiểm duyệt cứng cho một nền tảng Facebook, sử dụng trường **Conditional Rollup** `connected_active_platforms` (chỉ gom các tài khoản ở trạng thái `Connected`) kết hợp với chuỗi công thức kiểm tra động từng nền tảng (`is_[platform]_check_passed`). Giải pháp này giúp hệ thống tự động kiểm duyệt tương thích với bất kỳ sự kết hợp kênh nào trong trường multi-select `target_channels`.
3. **Cơ chế Bẫy lỗi Trực quan (Error Trapping)**: Thiết kế trường công thức `approval_blockers` tự động tổng hợp danh sách các lỗi vi phạm nghiệp vụ BR1-BR3 trực tiếp dưới dạng văn bản có icon cảnh báo, hỗ trợ người phê duyệt phát hiện và khắc phục lỗi lập tức trên giao diện.

### Tools & Skills Used

| Công cụ / Kỹ năng | Mục đích sử dụng |
|:---|:---|
| `Spawner database-schema-design` | Hướng dẫn thiết kế mô hình dữ liệu vật lý chuẩn chỉ: khóa ngoại (linked records), các ràng buộc bắt buộc (NOT NULL), và tối ưu hóa kiểu dữ liệu. |
| `Spawner postgres-wizard` (Tư duy) | Áp dụng tư duy toàn vẹn dữ liệu (Data Integrity) cấp cao, bẫy lỗi ở tầng cơ sở dữ liệu trước khi chuyển lên tầng ứng dụng. |
| `database-architect` | Phân tích quan hệ thực thể, thiết lập Rollup có điều kiện, khóa múi giờ và thiết kế các trường công thức nghiệp vụ tối ưu. |

### Files Changed

| Đường dẫn tệp | Hành động | Mô tả chi tiết |
|:---|:---|:---|
| [US-001-field-types-and-constraints.md](file:///d:/Muti-Media%20Management/docs/plans/US-001-field-types-and-constraints.md) | Created | Tài liệu đặc tả vật lý chi tiết Airtable Base với 16 chương mục. |
| [REPORT-us-001-field-types-and-constraints-2026-05-20.md](file:///d:/Muti-Media%20Management/docs/reports/REPORT-us-001-field-types-and-constraints-2026-05-20.md) | Created | Báo cáo hoàn thành nhiệm vụ T-003. |

---

## Impact & Purpose

Bản đặc tả kiểu dữ liệu vật lý và ràng buộc này là **cột mốc khóa cứng cấu hình cơ sở dữ liệu**:
- Loại bỏ hoàn toàn sự mập mờ về kiểu dữ liệu và định dạng cho các Agent phát triển giao diện (T-004) và cấu hình chốt chặn kiểm duyệt (T-005).
- Định hình sẵn một cơ chế kiểm duyệt dữ liệu cực kỳ mạnh mẽ, linh hoạt và an toàn ở ngay tầng cơ sở dữ liệu để ngăn chặn các bản ghi lỗi hoặc thiếu dữ liệu đi vào hàng đợi publish.
- Bảo vệ an toàn tuyệt đối cho hệ thống trước nguy cơ rò rỉ token thông tin bảo mật (R-005).

---

## Decisions Made

| Quyết định thiết kế | Lý do kỹ thuật | Phương án thay thế đã cân nhắc |
|:---|:---|:---|
| **Bật bắt buộc GMT/UTC cho tất cả trường ngày giờ** | Đảm bảo đồng nhất múi giờ tuyệt đối khi chuyển giao dữ liệu qua API/Webhook, tránh lỗi lệch giờ đăng bài giữa các vùng miền. | Để múi giờ mặc định cục bộ (gây rủi ro lệch giờ nghiêm trọng khi Middleware xử lý). |
| **Sử dụng Conditional Rollup + Matching Formulas cho BR2** | Cho phép hệ thống mở rộng kiểm duyệt cho nhiều nền tảng trong tương lai một cách linh hoạt, chỉ gom các tài khoản có trạng thái `Connected`. | Viết mã script kiểm tra cứng trong Airtable hoặc chỉ kiểm tra riêng cho kênh Facebook (thiếu khả năng mở rộng). |
| **Trường `master_copy` tắt chế độ Rich Text** | Đảm bảo dữ liệu thô gửi sang Facebook Graph API qua MCP server không bị lẫn các thẻ markdown hoặc định dạng HTML gây lỗi hiển thị. | Bật Rich Text (gây phức tạp cho việc chuẩn hóa định dạng văn bản khi đăng bài). |

---

## Verification

Bản thiết kế đã vượt qua toàn bộ các tiêu chí kiểm định trong Checklist:

- [x] Đã nghiên cứu kỹ mô hình dữ liệu logic T-002 và trích xuất đầy đủ ràng buộc thiết kế.
- [x] Xây dựng đầy đủ bảng ma trận kiểu dữ liệu vật lý cho `Campaigns` hoàn chỉnh.
- [x] Xây dựng đầy đủ bảng ma trận kiểu dữ liệu vật lý cho `Posts` hoàn chỉnh.
- [x] Xây dựng đầy đủ bảng ma trận kiểu dữ liệu vật lý cho `Channel Accounts` hoàn chỉnh.
- [x] Trường `Posts.status` hỗ trợ đúng chính tả và duy nhất 6 trạng thái bắt buộc (`Draft`, `Review`, `Approved`, `Scheduled`, `Published`, `Failed`).
- [x] Trường `target_channels` là Multi-select hỗ trợ `Facebook` làm kênh cốt lõi ban đầu và các kênhproposed mở rộng.
- [x] Kiểu dữ liệu của trường `scheduled_at` và `approved_at` là Date-Time có khóa cứng múi giờ UTC/GMT.
- [x] Thiết lập chính xác các mối quan hệ Linked Record hai chiều giữa `Campaigns` ↔ `Posts` và `Channel Accounts` ↔ `Posts` (Many-to-Many).
- [x] Thiết kế chi tiết 10 trường công thức thông minh phục vụ kiểm duyệt tự động BR1-BR3 và hiển thị danh sách lỗi trực quan (`approval_blockers`).
- [x] Cam kết tuyệt đối không tạo bất kỳ trường nào chứa token bí mật hoặc secrets trong Airtable Base.
- [x] Cam kết không thiết kế bất kỳ webhook receiver, automation tự động, hàng đợi RabbitMQ hay mã code backend nào trong Airtable ở nhiệm vụ này.
- [x] Tài liệu đầu ra được cấu hình khoa học, sẵn sàng chuyển tiếp cho các Agent tiếp theo ở T-004 và T-005.

---

## Open Items / Next Steps

1. **Chuyển giao cho T-004 & T-005**: Bàn giao tài liệu đặc tả vật lý chi tiết này cho Agent Thiết kế Giao diện (T-004) để dựng các View và Agent Phê duyệt (T-005) để cấu hình chốt chặn tự động trên Airtable base thực tế.
2. **Q-005 (Quyền phê duyệt)**: Tiếp tục làm rõ câu hỏi mở về vai trò phê duyệt bài viết (Manager/Admin) từ Product Owner để chuẩn bị cho việc cấu hình Interface ở bước T-005.
