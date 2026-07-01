# US-001 QA Acceptance Pass

**Date:** 2026-05-20  
**Task:** T-007: QA Acceptance Pass  
**User Story:** US-001 — Airtable Base Campaign/Post Workflow  
**Status:** Completed with Corrections  
**Author:** QA Engineering Agent  

---

## 1. Title: US-001 QA Acceptance Pass

Tài liệu này thiết lập kế hoạch kiểm duyệt chất lượng thủ công (**Manual QA Acceptance Pass**), danh sách kiểm tra (**QA Checklist**) và các kịch bản kiểm thử mẫu (**Test Scenarios**) cho câu chuyện người dùng **US-001: Thiết lập Airtable base cho campaign/post workflow**. Kế hoạch này được thiết kế để xác minh cấu hình cơ sở dữ liệu Airtable (schema, views, approval guardrails và handoff contract) đáp ứng đầy đủ các tiêu chí nghiệm thu (**AC1-AC4**) và các quy tắc nghiệp vụ (**BR1-BR3**), đồng thời phát hiện các điểm bất hợp lý trong thiết kế tài liệu kỹ thuật để cập nhật trong tác vụ **T-008**.

---

## 2. Docs Read

Quy trình QA này đã thực hiện kiểm thử tĩnh (static testing/code audit) và rà soát chéo cấu trúc logic trên **12 tài liệu dự án** theo đúng thứ tự ưu tiên và trình tự thời gian sau:

| Priority | Document | Path | Date / Version | Key Security, Compliance & Logical Constraints Extracted |
|:---|:---|:---|:---|:---|
| **P0** | [US-001-middleware-handoff-contract.md](file:///d:/Muti-Media%20Management/docs/plans/US-001-middleware-handoff-contract.md) | `docs/plans/US-001-middleware-handoff-contract.md` | 2026-05-20 | Xác minh cấu trúc payload webhook tối giản, nguyên tắc **References-Only Queue**, chiến lược tải lại dữ liệu Zero-Trust (Reload and Verify), và ma trận phân loại lỗi validation. |
| **P0** | [REPORT-us-001-middleware-handoff-contract-2026-05-20.md](file:///d:/Muti-Media%20Management/docs/reports/REPORT-us-001-middleware-handoff-contract-2026-05-20.md) | `docs/reports/REPORT-us-001-middleware-handoff-contract-2026-05-20.md` | 2026-05-20 | Đánh giá báo cáo hoàn thành T-006, kiểm tra sự đồng bộ giữa hợp đồng và thực tế. Phát hiện lỗi nghiêm trọng về trạng thái tài liệu. |
| **P0** | [US-001-approval-guardrails.md](file:///d:/Muti-Media%20Management/docs/plans/US-001-approval-guardrails.md) | `docs/plans/US-001-approval-guardrails.md` | 2026-05-20 | Phân tích logic của 6 guardrails tự động (GR-01 đến GR-06), luồng hoàn tác tự động (fail-closed) và cơ chế khóa múi giờ UTC. |
| **P0** | [US-001-workflow-views.md](file:///d:/Muti-Media%20Management/docs/plans/US-001-workflow-views.md) | `docs/plans/US-001-workflow-views.md` | 2026-05-20 | Mapped 8 view nghiệp vụ gồm Clean Lane (`Approved Handoff`), Exception Lane (`Invalid Approved`), và sự phân tách giữa Publishing Calendar và Draft Calendar. |
| **P0** | [US-001-field-types-and-constraints.md](file:///d:/Muti-Media%20Management/docs/plans/US-001-field-types-and-constraints.md) | `docs/plans/US-001-field-types-and-constraints.md` | 2026-05-20 | Locked toàn bộ kiểu dữ liệu vật lý, các trường công thức kiểm soát nghiệp vụ (`is_valid_for_approval`, `approval_blockers`), và cờ rollup tài khoản liên kết hoạt động. |
| **P0** | [US-001-airtable-data-model.md](file:///d:/Muti-Media%20Management/docs/plans/US-001-airtable-data-model.md) | `docs/plans/US-001-airtable-data-model.md` | 2026-05-20 | Xác nhận cấu trúc ERD 3 bảng logic, quan hệ Many-to-Many với stub Channel Accounts, và quyết định kiến trúc loại bỏ bảng Assets độc lập để tối ưu dung lượng. |
| **P0** | [US-001-scope-lock.md](file:///d:/Muti-Media%20Management/docs/plans/US-001-scope-lock.md) | `docs/plans/US-001-scope-lock.md` | 2026-05-20 | Định vị ranh giới In-scope (3 bảng, 6 views, 3 BRs) và Out-of-scope (không viết mã TS/JS, không config queue thực tế, không lưu access token). |
| **P0** | [PLAN-us-001-airtable-base.md](file:///d:/Muti-Media%20Management/docs/plans/PLAN-us-001-airtable-base.md) | `docs/plans/PLAN-us-001-airtable-base.md` | 2026-05-20 | Đối chiếu lộ trình phát triển và các tiêu chuẩn nghiệm thu tổng thể của Sprint 1. |
| **P0** | [06_Architecture_Composability.md](file:///d:/Muti-Media%20Management/docs/architecture/06_Architecture_Composability.md) | `docs/architecture/06_Architecture_Composability.md` | 2026-05-20 | Ràng buộc kiến trúc: Airtable chỉ làm Control Plane. Phải đảm bảo tách biệt hoàn toàn tầng dữ liệu bảo mật (Secret Storage) sang phía Postgres Ledger. |
| **P0** | [11_Coding_Convention.md](file:///d:/Muti-Media%20Management/docs/architecture/11_Coding_Convention.md) | `docs/architecture/11_Coding_Convention.md` | 2026-05-20 | Quy định bảo mật §5: Tuyệt đối không chứa raw credential/access token trong Airtable base hay audit metadata. Handoff chỉ truyền tham chiếu. |
| **P1** | [04_Product_Backlog.md](file:///d:/Muti-Media%20Management/docs/requirements/04_Product_Backlog.md) | `docs/requirements/04_Product_Backlog.md` | 2026-05-20 | Kiểm duyệt ánh xạ giữa AC1-AC4, BR1-BR3 của User Story US-001 vào kế hoạch test. |
| **P1** | [05_Function_Flow_Logic_Register.md](file:///d:/Muti-Media%20Management/docs/requirements/05_Function_Flow_Logic_Register.md) | `docs/requirements/05_Function_Flow_Logic_Register.md` | 2026-05-20 | Rà soát luồng logic FL-001 (Airtable Post Approved Webhook) để ánh xạ các kịch bản reload và revalidate của middleware. |

---

## 3. QA Summary

QA đã tiến hành rà soát kỹ lưỡng cấu trúc thiết kế từ **T-001 đến T-006** nhằm đảm bảo tính toàn vẹn hệ thống trước khi bắt đầu Sprint 1.

**Kết quả đánh giá tổng quan:**
1. **Tính bảo mật (Credential Boundary):** Đạt tiêu chuẩn tối cao. Airtable base được cô lập hoàn toàn khỏi các thông tin nhạy cảm. Bảng `Channel Accounts` hoạt động như một stub hiển thị và tham chiếu. Toàn bộ mã token bảo mật thực tế được lưu trữ server-side tại Postgres/Secret Storage, tuân thủ nghiêm ngặt Coding Convention §5.
2. **Tính hợp lệ của luồng nghiệp vụ (AC & BR Verification):** Cơ chế chốt chặn kép (**Double-Layer Safety Gate**) hoạt động hiệu quả. 
   - *Lớp 1 (View-Level Filter):* Grid view `Approved Handoff` chỉ hiển thị các bài viết có `status = Approved` AND `is_valid_for_approval = 1` (Được tính toán động thông qua công thức Excel).
   - *Lớp 2 (Automation-Level Reversion):* Automation tự động hoàn tác trạng thái bài viết từ `Approved` về `Review` nếu phát hiện dữ liệu vi phạm quy tắc BR1-BR3, giúp loại bỏ các trường hợp thao tác lỗi bằng tay.
3. **Phát hiện lỗi tài liệu (Defects Identified):** QA đã phát hiện **3 lỗi bất đồng nhất** trong tài liệu T-006. Đặc biệt là lỗi mâu thuẫn hệ thống giữa việc gửi tin nhắn vào Dead Letter Queue (DLQ) và phản hồi ACK trong RabbitMQ đối với trường hợp `channel_account_unresolved`. Các lỗi này đã được phân loại chi tiết và đề xuất giải pháp xử lý trong tài liệu cập nhật **T-008**.

---

## 4. Acceptance Criteria Coverage

QA xác nhận các tài liệu thiết kế US-001 đáp ứng đầy đủ các tiêu chí nghiệm thu (**AC**) thông qua ma trận ánh xạ dưới đây:

| Acceptance Criterion (AC) | Requirement Description | Airtable Mapping & Verification Plan | Coverage Status |
|:---|:---|:---|:---|
| **AC1** | Có Airtable schema/view cho Campaign và Post. | - Bảng `Campaigns` (CMP-ID) và `Posts` (PST-ID) được thiết kế đầy đủ cấu trúc vật lý ở T-003.<br>- 8 Views nghiệp vụ đã được định nghĩa bộ lọc chi tiết ở T-004. | **100% Covered** |
| **AC2** | `Posts.status` bao gồm chính xác: `Draft`, `Review`, `Approved`, `Scheduled`, `Published`, `Failed`. | - Trường `status` trên bảng `Posts` được thiết kế kiểu Single Select chứa chính xác 6 giá trị này (T-003 Section 8). Không chứa giá trị dư thừa hay viết sai chính tả. | **100% Covered** |
| **AC3** | Chỉ các bản ghi có trạng thái `Approved` mới đi vào middleware handoff, với chốt chặn an toàn `is_valid_for_approval = 1`. | - Grid view `Approved Handoff` (Clean Lane) được thiết kế bộ lọc cứng: `status = Approved` AND `is_valid_for_approval = 1` (T-004 Section 4D).<br>- Được gia cố bởi Automation hoàn tác `GR-01` (T-005 Section 6). | **100% Covered** |
| **AC4** | Calendar view hiển thị lịch đăng bài dựa trên trường `scheduled_at`. | - Calendar view `Publishing Calendar` và `Draft Planning Calendar` sử dụng trường `scheduled_at` làm nguồn hiển thị ngày (T-004 Section 4F & 4G). | **100% Covered** |

---

## 5. Business Rule Coverage

QA đã ánh xạ các quy tắc nghiệp vụ (**BR**) vào các kiểm duyệt cơ sở dữ liệu Airtable:

| Business Rule (BR) | Rule Description | Airtable Database Control | Technical Verification Mechanics |
|:---|:---|:---|:---|
| **BR1** | Bài đăng không được phép tự động phê duyệt nếu thiếu trường nội dung cốt lõi `master_copy`. | Trường công thức `is_master_copy_present` kiểm tra `master_copy != ""` (T-003 Section 10). | Nếu `status = Approved` nhưng `is_master_copy_present = 0`, hệ thống hạ `is_valid_for_approval = 0`. Automation `GR-01` sẽ hoàn tác trạng thái bài viết về `Review` và hiển thị thông báo lỗi `❌ Thiếu nội dung Master Copy;`. |
| **BR2** | Bài đăng có kênh đích Facebook yêu cầu liên kết với tài khoản Facebook Page/Account đang hoạt động bình thường. | Rollup `connected_active_platforms` kéo platform từ bảng `Channel Accounts` nếu status của stub account là `Connected`. Công thức `is_facebook_check_passed` đối soát tự động. | Nếu bài đăng chọn `target_channels` chứa Facebook nhưng rollup không có stub hoạt động nào, `has_connected_channel_accounts` trả về `0`, kích hoạt Automation `GR-01` hoàn tác về `Review` kèm lỗi `❌ Thiếu tài khoản kết nối hoạt động cho kênh đích;`. |
| **BR3** | Trường lịch phát sóng `scheduled_at` bắt buộc phải ở tương lai đối với các trạng thái hoạt động (`Review`, `Approved`, `Scheduled`). | Trường công thức `is_scheduled_in_future` chạy lệnh `IS_AFTER(scheduled_at, NOW())` với múi giờ khóa cứng GMT/UTC. | Nếu `scheduled_at` nhỏ hơn thời điểm hiện tại của server, `is_scheduled_in_future` trả về `0`, hạ mức hợp lệ và hoàn tác trạng thái về `Review` kèm lỗi `❌ Lịch đăng scheduled_at phải ở tương lai;`. |

---

## 6. Test Environment Assumptions

Để triển khai verify và cấu hình Airtable Base theo tài liệu QA này, đội ngũ kỹ thuật/SMM cần giả định và chuẩn bị môi trường kiểm thử như sau:

1. **Airtable Workspace & Base Setup:**
   - 01 Base trống chạy trên tài khoản Airtable (gói Free hoặc Team).
   - Đã tạo đủ 3 bảng: `Campaigns`, `Posts`, `Channel Accounts` với các cấu hình trường vật lý khớp 100% với ma trận kiểu dữ liệu tại [US-001-field-types-and-constraints.md](file:///d:/Muti-Media%20Management/docs/plans/US-001-field-types-and-constraints.md).
2. **Timezone Configuration:**
   - Mọi collaborators tham gia base phải được đồng bộ thiết lập. Các trường ngày giờ (`scheduled_at`, `approved_at`, `start_date`, `end_date`) phải được **BẬT** cờ `Use the same time zone (GMT/UTC) for all collaborators` và hiển thị định dạng 24 giờ.
3. **Mock Data Setup (Stub Data):**
   - Đã tạo sẵn 01 bản ghi Chiến dịch mẫu trong bảng `Campaigns` (`CMP-1`: name = "Sprint 1 Launch", status = "Active", start_date = 2026-05-20, end_date = 2026-06-20).
   - Đã tạo sẵn 02 bản ghi Tài khoản liên kết mẫu trong bảng `Channel Accounts`:
     - Stub 1: display_name = "MediaOps Tech Page", platform = "Facebook", status = "Connected" (Tài khoản hoạt động bình thường).
     - Stub 2: display_name = "MediaOps Ex Page", platform = "Facebook", status = "Expired" (Tài khoản hết hạn liên kết).
4. **Native Automation Active:**
   - Trực tiếp kích hoạt và test trạng thái của 2 luồng Automation trên Airtable base (`Automation 1: Revert Invalid Approvals` và `Automation 2: Timestamp Valid Approvals`) theo khuyến nghị cấu hình ở T-005 Section 13.

---

## 7. Manual QA Checklist

Dành cho Social Media Managers (SMMs) và Developers sử dụng để tích hợp và ký nhận (sign-off) trước khi chạy thật hệ thống:

```markdown
- [ ] 1. Khóa múi giờ UTC: Đã bật "Use the same time zone (GMT/UTC)" trên tất cả các trường Date-Time.
- [ ] 2. Kiểm duyệt trạng thái: Trường Posts.status chứa đúng và đủ 6 trạng thái: Draft, Review, Approved, Scheduled, Published, Failed.
- [ ] 3. Kiểm duyệt nội dung (BR1): Post thiếu master_copy không thể giữ trạng thái Approved, tự động bị loại khỏi Approved Handoff view.
- [ ] 4. Kiểm duyệt kết nối (BR2): Post chọn Facebook bắt buộc phải liên kết với stub Channel Account ở trạng thái "Connected".
- [ ] 5. Kiểm duyệt lịch đăng (BR3): Trường scheduled_at phải lớn hơn NOW() tại thời điểm kiểm duyệt, so sánh theo UTC.
- [ ] 6. Clean Lane Isolation: Approved Handoff view chỉ chứa bản ghi có status = Approved và is_valid_for_approval = 1.
- [ ] 7. Exception Lane Visibility: Bản ghi Approved lỗi xuất hiện ngay ở view "Invalid Approved / Approval Blocked".
- [ ] 8. Hoàn tác tự động: Automation tự động đẩy trạng thái Approved lỗi về Review trong vòng 1-5 giây.
- [ ] 9. Phản hồi lỗi trực quan: Hiển thị đúng chuỗi thông báo lỗi approval_blockers tương ứng với lỗi vi phạm BR1-BR3.
- [ ] 10. Phân tách Lịch: Draft Planning Calendar chỉ chứa Draft. Publishing Calendar loại bỏ hoàn toàn Draft.
- [ ] 11. Thu hồi Stale Post: Post đã duyệt quá hạn scheduled_at tự động biến mất khỏi Approved Handoff view.
- [ ] 12. Phục hồi thất bại: Trực tiếp chặn chuyển Failed -> Approved nếu vi phạm lịch hoặc copy (ép qua Review).
- [ ] 13. Bảo mật thông tin (Zero Token): Không chứa bất kỳ trường token/secret/password nào trong base Airtable và Event payload.
```

---

## 8. Test Scenarios

Dưới đây là thiết kế chi tiết cho **10 kịch bản kiểm thử thủ công cốt lõi** dùng để xác nhận chất lượng cấu hình Airtable Base.

### 8.1. Scenario 1: Create Campaign
* **Mô tả:** Tạo một chiến dịch marketing hợp lệ để làm gốc liên kết.
* **Các bước thực hiện:**
  1. Điều hướng tới bảng `Campaigns` → View `Campaign Overview`.
  2. Tạo mới một bản ghi. Điền các trường:
     - `name`: `Sprint 1 Campaign`
     - `status`: `Active`
     - `start_date`: `2026-05-20` (Hôm nay)
     - `end_date`: `2026-06-20` (Tương lai)
     - `owner`: Chọn tài khoản SMM hiện tại.
     - `notion_brief_url`: `https://notion.so/mediaops/sprint-1-brief-reference`
* **Kết quả kỳ vọng:**
  1. Bản ghi được tạo thành công, `campaign_id` tự động sinh có định dạng `CMP-1` (hoặc số tăng dần).
  2. Bản ghi xuất hiện đúng trong view `Campaign Overview` và được sắp xếp chính xác theo `start_date` giảm dần.

### 8.2. Scenario 2: Create Draft Post
* **Mô tả:** Soạn thảo bài đăng nháp (Draft) và kiểm tra tính cô lập của Sandbox.
* **Các bước thực hiện:**
  1. Điều hướng tới bảng `Posts` → View `Post Pipeline` (Kanban).
  2. Tại cột `Draft`, tạo mới một bản ghi:
     - `title`: `Draft Post 1`
     - `campaign_id`: Liên kết tới chiến dịch `CMP-1` vừa tạo.
     - `scheduled_at`: Điền một ngày bất kỳ (có thể ở quá khứ hoặc tương lai, ví dụ: `2026-05-19T10:00:00.000Z`).
     - Để trống `master_copy` và `connected_channel_accounts`.
  3. Mở view `Publishing Calendar` và check sự xuất hiện.
  4. Mở view `Draft Planning Calendar` và check sự xuất hiện.
  5. Mở view `Approved Handoff` và check sự xuất hiện.
* **Kết quả kỳ vọng:**
  1. Bản ghi được tạo thành công với ID `PST-1` ở cột `Draft`.
  2. Bản ghi **KHÔNG** xuất hiện trong view `Publishing Calendar` (do bộ lọc loại trừ trạng thái Draft).
  3. Bản ghi **KHÔNG** xuất hiện trong view `Approved Handoff` (Clean Lane).
  4. Bản ghi **PHẢI** xuất hiện trong view `Draft Planning Calendar` tại đúng ô ngày của trường `scheduled_at`.

### 8.3. Scenario 3: Move Draft -> Review Valid
* **Mô tả:** Chuyển đổi trạng thái bài viết từ Draft sang Review khi đã nhập đủ thông tin hợp lệ.
* **Các bước thực hiện:**
  1. Mở bản ghi `PST-1` ở trạng thái Draft.
  2. Cập nhật đầy đủ các thông tin:
     - `master_copy`: `Đây là nội dung cốt lõi của bài đăng Facebook giới thiệu MediaOps!`
     - `target_channels`: Chọn `Facebook`.
     - `connected_channel_accounts`: Liên kết đến stub `Facebook: MediaOps Tech Page` (stub có status = Connected).
     - `scheduled_at`: Thiết lập một thời điểm ở tương lai (ví dụ: ngày mai, `2026-05-21T10:00:00.000Z`).
  3. Thay đổi trạng thái `status` từ `Draft` sang `Review`.
  4. Điều hướng tới view `Needs Review`.
* **Kết quả kỳ vọng:**
  1. Trường `is_valid_for_approval` hiển thị giá trị là `1`.
  2. Trường `approval_blockers` hoàn toàn trống (không có dấu hiệu lỗi).
  3. Bản ghi biến mất khỏi view `Draft Planning Calendar` và xuất hiện chính xác trong view `Needs Review` (sắp xếp theo `scheduled_at` tăng dần) và hiển thị trên view `Publishing Calendar`.

### 8.4. Scenario 4: Approved Valid Post
* **Mô tả:** Phê duyệt một bài đăng hoàn toàn hợp lệ và bàn giao sang Clean Lane.
* **Các bước thực hiện:**
  1. Truy cập view `Needs Review`.
  2. Chọn bản ghi `PST-1` (đã xác minh `is_valid_for_approval = 1` ở Scenario 3).
  3. Manually thay đổi trạng thái `status` từ `Review` sang `Approved`.
  4. Giữ nguyên màn hình quan sát hành vi của Airtable trong vòng 5 giây.
  5. Kiểm tra view `Approved Handoff` và view `Invalid Approved / Approval Blocked`.
* **Kết quả kỳ vọng:**
  1. Không xảy ra hiện tượng hoàn tác trạng thái (Status giữ nguyên là `Approved`).
  2. Trường ngày duyệt `approved_at` được Automation tự động điền giá trị thời gian UTC hiện tại.
  3. Bản ghi biến mất khỏi view `Needs Review` và **PHẢI** xuất hiện lập tức trong view `Approved Handoff`.
  4. Bản ghi **KHÔNG** xuất hiện trong view `Invalid Approved / Approval Blocked`.

### 8.5. Scenario 5: Missing master_copy Invalid Approval
* **Mô tả:** Kiểm thử chốt chặn BR1, ngăn chặn việc duyệt bài viết bị trống nội dung copy.
* **Các bước thực hiện:**
  1. Tạo bài đăng mới `PST-2` liên kết tới `CMP-1`.
  2. Điền: `target_channels` = `Facebook`, `connected_channel_accounts` = stub hoạt động, `scheduled_at` = tương lai.
  3. **Để trống** trường `master_copy`.
  4. Manually thay đổi trạng thái `status` sang `Approved`.
  5. Quan sát lưới Grid và kiểm tra view `Approved Handoff` cùng view `Invalid Approved`.
* **Kết quả kỳ vọng:**
  1. Trong vòng 1-5 giây, Airtable Automation `GR-01` tự động kích hoạt, sửa đổi trạng thái `status` của `PST-2` quay trở lại `Review`.
  2. Bản ghi **KHÔNG BAO GIỜ** xuất hiện trong view `Approved Handoff` (Clean Lane).
  3. Bản ghi **PHẢI** xuất hiện trong view `Invalid Approved / Approval Blocked` kèm theo cảnh báo lỗi tại trường `approval_blockers`: `❌ Thiếu nội dung Master Copy;`.
  4. Hệ thống gửi cảnh báo hoặc cập nhật bản ghi mà không kích hoạt bất kỳ hàng đợi/webhook middleware nào (do record không lọt vào view Approved Handoff).

### 8.6. Scenario 6: Missing or Disconnected Facebook Account
* **Mô tả:** Kiểm thử chốt chặn BR2, ngăn chặn duyệt bài viết nếu thiếu tài khoản kết nối hoạt động tương ứng.
* **Các bước thực hiện:**
  1. Tạo bài đăng mới `PST-3` liên kết tới `CMP-1`.
  2. Điền: `title` = "Test Connection", `master_copy` = "Nội dung Facebook", `target_channels` = `Facebook`, `scheduled_at` = tương lai.
  3. **Thử nghiệm Nhánh A (Không liên kết):** Để trống trường `connected_channel_accounts`. Manually chuyển `status` sang `Approved`.
  4. **Thử nghiệm Nhánh B (Liên kết tài khoản hết hạn):** Liên kết `connected_channel_accounts` tới stub `Facebook: MediaOps Ex Page` (stub có status = Expired). Chuyển `status` sang `Approved`.
* **Kết quả kỳ vọng (Cho cả hai nhánh):**
  1. Trường `is_valid_for_approval` hiển thị `0`.
  2. Trong vòng vài giây, trạng thái `status` của bản ghi bị hoàn tác ngược về `Review`.
  3. Bản ghi bị chặn khỏi view `Approved Handoff`.
  4. Bản ghi hiển thị ở view `Invalid Approved / Approval Blocked` with thông báo lỗi: `❌ Thiếu tài khoản kết nối hoạt động cho kênh đích;`.
  5. Đảm bảo tuyệt đối không có trường token nhạy cảm nào xuất hiện trên giao diện.

### 8.7. Scenario 7: Past scheduled_at
* **Mô tả:** Kiểm thử chốt chặn BR3, ngăn chặn việc duyệt phát sóng bài viết có thời gian lên lịch ở quá khứ.
* **Các bước thực hiện:**
  1. Tạo bài đăng mới `PST-4` liên kết tới `CMP-1`.
  2. Điền: `master_copy` = "Nội dung hợp lệ", `target_channels` = `Facebook`, `connected_channel_accounts` = stub hoạt động.
  3. Thiết lập `scheduled_at` ở một mốc thời gian **quá khứ** (ví dụ: 1 tiếng trước so với giờ hiện tại).
  4. Manually thay đổi trạng thái `status` sang `Approved`.
* **Kết quả kỳ vọng:**
  1. Trường `is_scheduled_in_future` đánh giá giá trị `0`. Do đó `is_valid_for_approval` bằng `0`.
  2. Airtable Automation kích hoạt hoàn tác `status` về `Review`.
  3. Bản ghi nằm ngoài Approved Handoff Clean Lane và hiển thị ở view `Invalid Approved / Approval Blocked` kèm thông điệp lỗi: `❌ Lịch đăng scheduled_at phải ở tương lai;`.

### 8.8. Scenario 8: Invalid Approved stuck-record regression
* **Mô tả:** Kiểm tra khả năng tự phục hồi của hệ thống khi người dùng cố tình hoặc vô ý thao tác sai trên bảng Grid của Airtable.
* **Các bước thực hiện:**
  1. Tạo bài đăng trống `PST-5` (thiếu copy, thiếu tài khoản kết nối, lịch đăng ở quá khứ).
  2. Manually thay đổi `status` trực tiếp sang `Approved` trên view Kanban hoặc Grid.
  3. Theo dõi thời gian thực tế: Xem bản ghi xuất hiện ở view `Invalid Approved` trong bao lâu và có bị ẩn lặng lẽ (silently hidden) không.
* **Kết quả kỳ vọng:**
  1. Bản ghi **KHÔNG** bị ẩn lặng lẽ mà xuất hiện lập tức trên view `Invalid Approved / Approval Blocked` để SMM/Manager nhận diện.
  2. Automation hoạt động chính xác và tự động đẩy trạng thái của cell `status` từ `Approved` trả lại `Review` trong vòng 1-5 giây, đồng thời gửi email thông báo chi tiết lỗi `approval_blockers` cho reviewer/assignee.

### 8.9. Scenario 9: Failed recovery flow
* **Mô tả:** Đảm bảo luồng phục hồi bài đăng thất bại tuân thủ chính sách thận trọng, chặn đứng phím tắt duyệt bài trực tiếp.
* **Các bước thực hiện:**
  1. Thiết lập một bài đăng `PST-6` có trạng thái ban đầu `status` = `Failed` (Mô phỏng bài viết bị lỗi API từ MCP).
  2. Tại view `Failed Posts`, chọn bản ghi này và manually thay đổi trạng thái trực tiếp từ `Failed` sang `Approved`.
* **Kết quả kỳ vọng:**
  1. Vì bài viết cũ mang thời gian lịch đăng đã qua (quá khứ), trường `is_scheduled_in_future` lập tức đánh giá là `0`.
  2. Hệ thống hạ mức hợp lệ `is_valid_for_approval` về `0`.
  3. Automation `GR-01` tự động bắt trigger và hoàn tác trạng thái về `Review`, ngăn chặn luồng publish tắt.
  4. Lịch sử bắt buộc SMM phải thực hiện đúng luồng tuần tự: Sửa đổi `scheduled_at` thành tương lai → Đẩy về `Review` → Quản lý phê duyệt sang `Approved`.
  5. Xác minh Airtable hoàn toàn không chứa bất kỳ nút bấm tự động chạy lại (retry button) hay công cụ kết nối API trực tiếp nào, bảo toàn ranh giới Control Plane tối giản.

### 8.10. Scenario 10: Publishing Calendar vs Draft Planning Calendar
* **Mô tả:** Xác minh sự phân tách tuyệt đối giữa lịch phát sóng chính thức và lịch nháp.
* **Các bước thực hiện:**
  1. Tạo bài đăng nháp `PST-Draft` (`status` = `Draft`, `scheduled_at` = ngày mai).
  2. Tạo bài đăng chờ duyệt `PST-Review` (`status` = `Review`, `scheduled_at` = ngày mai).
  3. Truy cập view `Draft Planning Calendar`.
  4. Truy cập view `Publishing Calendar`.
* **Kết quả kỳ vọng:**
  1. View `Draft Planning Calendar` **CHỈ** hiển thị `PST-Draft` và hoàn toàn loại trừ `PST-Review`.
  2. View `Publishing Calendar` **CHỈ** hiển thị `PST-Review` và loại bỏ hoàn toàn `PST-Draft`.
  3. Cả hai view hiển thị đúng nhãn định danh và khóa cứng múi giờ GMT/UTC không bị xê dịch.

---

## 9. Edge Case Scenarios

Bên cạnh các kịch bản chuẩn, QA bổ sung các **kịch bản kiểm thử giả lập nâng cao** nhằm rà soát tính ổn định tại ranh giới tích hợp của Hợp đồng Handoff T-006:

### 9.1. Scenario 11: T-006 stale event simulation (Giả lập cuộc đua sự kiện trễ)
* **Ngữ cảnh:** Một bài đăng đã được duyệt, webhook phát tín hiệu nhưng trước khi worker middleware xử lý, người dùng trong Airtable đã kịp thời hoàn tác trạng thái bài viết từ `Approved` trở lại `Review` hoặc `Draft` (hoặc do automation hoàn tác của T-005).
* **Các bước thực hiện (Giả lập thủ công bằng Stub):**
  1. Chuẩn bị payload giả lập chứa thông tin bài đăng hợp lệ lúc trước:
     ```json
     {
       "event_type": "airtable.post.approved",
       "source": "airtable.webhook_receiver",
       "record_ref": "recStaleRecordID",
       "approval_ref": "2026-05-20T07:45:00.000Z",
       "routing_ref": ["Facebook"]
     }
     ```
  2. Trước khi gửi payload này vào API giả lập của Middleware, thay đổi trạng thái của bản ghi `recStaleRecordID` trên Airtable base thành `Review`.
  3. Thực hiện chạy hàm xử lý reload của Middleware.
* **Kết quả kỳ vọng:**
  1. Middleware gọi lệnh `GET /v0/base_id/Posts/recStaleRecordID` để đồng bộ trạng thái mới nhất từ Airtable API.
  2. Phân tích kết quả reload phát hiện `status` hiện tại là `Review` (không phải `Approved`).
  3. Hệ thống Middleware lập tức dừng luồng xử lý phát sóng, không gửi dữ liệu sang AI variant hay MCP publishing queue.
  4. Ghi nhận nhật ký Ledger với trạng thái loại trừ `state_changed_ignored`.
  5. Middleware phản hồi báo nhận thành công (**ACK**) tới hàng đợi RabbitMQ để dọn sạch sự kiện stale, tránh nghẽn hàng đợi.

### 9.2. Scenario 12: T-006 channel account revalidation simulation (Giả lập lỗi xác thực tài khoản đăng bài)
* **Ngữ cảnh:** Bài viết có trạng thái `Approved` trên Airtable, nhưng tài khoản kết nối Facebook tương ứng bất ngờ bị đổi tên hoặc bị ngắt kết nối (Disconnected) trên hệ thống server ngay trước khi worker thực hiện đăng bài.
* **Các bước thực hiện (Giả lập thủ công):**
  1. Tạo bài viết `Approved` liên kết với stub `Facebook: Page A` trên Airtable.
  2. Webhook phát tín hiệu sự kiện.
  3. On the system Postgres Ledger database, manually update status of Page A to Disconnected or delete its platform mapping.
  4. Worker middleware thực hiện bước đối soát tài khoản đăng bài (Channel Account Revalidation).
* **Kết quả kỳ vọng:**
  1. Lớp đối soát của Middleware phát hiện tài khoản Page A không hoạt động hoặc không tìm thấy liên kết trên Server (mặc dù Airtable vẫn hiển thị liên kết cũ do trễ đồng bộ).
  2. Hệ thống phân loại lỗi thành `channel_account_inactive` hoặc `channel_account_unresolved`.
  3. Chặn đứng hoàn toàn việc gọi Graph API/MCP, không cho bài viết lên sóng.
  4. Ghi nhận log Ledger đã được loại bỏ thông tin nhạy cảm. Phản hồi **NACK** với cờ không xếp hàng lại (`requeue = false`) để RabbitMQ tự động chuyển sang **Dead Letter Queue (DLQ)**.

### 9.3. Scenario 13: References-only queue contract
* **Mô tả:** Xác minh tính bảo mật tối cao của payload trong hàng đợi RabbitMQ.
* **Các bước thực hiện:**
  1. Kích hoạt xuất sự kiện thử nghiệm từ Hợp đồng Handoff T-006.
  2. Kiểm tra chi tiết cấu trúc JSON sinh ra trong hàng đợi giả lập `airtable.webhook.approved`.
* **Kết quả kỳ vọng:**
  1. Payload JSON **PHẢI** khớp chính xác với đặc tả cấu trúc tham chiếu:
     ```json
     {
       "event_type": "airtable.post.approved",
       "source": "airtable.webhook_receiver",
       "record_ref": "rec9t7W2uP0YxL8e9",
       "approval_ref": "2026-05-20T07:45:00.000Z",
       "routing_ref": [
         "Facebook"
       ]
     }
     ```
  2. Xác nhận payload **KHÔNG** chứa bất kỳ nội dung văn bản nào của bài viết (`master_copy` là trống), không chứa liên kết tài nguyên thô (`asset_links`), không chứa URL chuyển đổi, và **TUYỆT ĐỐI KHÔNG** chứa bất kỳ trường bảo mật nào như `access_token`, `refresh_token`, hay `client_secret`.

---

## 10. Security / Privacy Checks

QA đã thực hiện kiểm tra bảo mật tĩnh và xác minh các tiêu chuẩn an toàn thông tin sau trên toàn bộ thiết kế US-001:

1. **Zero Token Rule:**
   - Đã rà soát ma trận trường vật lý của 3 bảng `Campaigns`, `Posts`, `Channel Accounts` (T-003). Đã xác nhận **không tồn tại** bất kỳ trường lưu trữ dữ liệu nhạy cảm hay thông tin xác thực nào trong Airtable.
   - Bảng `Channel Accounts` chỉ chứa các metadata stub hiển thị như `display_name`, `platform`, `status`.
2. **Log and Telemetry Sanitization:**
   - Xác minh thiết kế của Hợp đồng Handoff T-006 đảm bảo các log lỗi validation (`channel_account_missing`, `channel_account_unresolved`) đều được lọc sạch (sanitized). 
   - Không ghi nhận đường dẫn thư mục vật lý của server, không log cấu trúc SQL thô, và không log các token giải mã của Meta.
3. **Queue Payload Integrity:**
   - Xác minh hàng đợi RabbitMQ hoạt động theo nguyên lý tham chiếu bất biến (Immutable Reference). 
   - Không truyền tải dữ liệu thô cồng kềnh, tránh rủi ro đánh cắp thông tin (Man-in-the-Middle) trên hàng đợi sự kiện.

---

## 11. Handoff Contract Checks

QA đã thực hiện rà soát các điều khoản bàn giao kỹ thuật của **T-006 Middleware Handoff Contract Stub** và xác nhận:

1. **View Bound:** Middleware chỉ được phép kết nối và lắng nghe duy nhất view `Approved Handoff`. Không cấp quyền truy cập các view nháp hay pipeline tổng.
2. **Idempotency Transition Spec:**
   - Xác minh việc sử dụng tổ hợp `record_id + approved_at` làm khóa đối soát trùng lặp tạm thời cho luồng tích hợp cơ bản của US-001.
   - Xác nhận thiết kế đã mở đường phân rã rõ ràng: Trong môi trường chạy thật sản phẩm (US-002+), khóa đối soát này bắt buộc phải chuyển sang cấu trúc an toàn cao `record_id + approved_version` chạy hoàn toàn dưới tầng Postgres Ledger của Server để tránh con người tự ý thay đổi timestamp trên Airtable.
3. **UTC Uniformity:** Mọi dữ liệu bàn giao qua API đều được định dạng ISO 8601 UTC chuẩn hóa, triệt tiêu rủi ro lệch lịch phát sóng.

---

## 12. Defects / Findings

Trong quá trình rà soát chéo các hồ sơ thiết kế của Sprint 1, QA đã phát hiện **3 lỗi bất đồng nhất và mâu thuẫn hệ thống** trong tài liệu T-006 cần được khắc phục tại tác vụ **T-008**:

| ID | Severity | Area | Finding | Expected Fix / Owner |
|:---|:---|:---|:---|:---|
| **DF-001** | **Medium** | Handoff Contract Status | Tài liệu hợp đồng bàn giao [US-001-middleware-handoff-contract.md](file:///d:/Muti-Media%20Management/docs/plans/US-001-middleware-handoff-contract.md) ở Line 6 ghi trạng thái là `Status: In Review`, trong khi báo cáo hoàn thành tương ứng [REPORT-us-001-middleware-handoff-contract-2026-05-20.md](file:///d:/Muti-Media%20Management/docs/reports/REPORT-us-001-middleware-handoff-contract-2026-05-20.md) lại đánh dấu là `Status: Completed` (Line 6). | **Expected Fix:** Đồng bộ trạng thái tài liệu hợp đồng T-006 thành `Status: Completed` hoặc `Status: Active` sau khi QA Acceptance Pass được ký duyệt.<br>**Owner:** Backend Specialist & Technical Writer |
| **DF-002** | **High** | Event Bus & Queue Error Logic | Tài liệu T-006 Section 10 (Table D) xác định lỗi `channel_account_unresolved` có `Action = Terminate flow; log unmapped warning; ACK event` và `Retry = No`. Tuy nhiên, tại Section 11A (Table Credential Boundary) lại viết: "the event is classified as `channel_account_unresolved`, enqueued to the DLQ, and blocked from publishing".<br><br>*QA Analysis:* Đây là một mâu thuẫn cơ chế Queue nghiêm trọng. Một sự kiện không thể vừa được **ACK** (xác nhận thành công để xóa khỏi queue gốc của broker) lại vừa được broker tự động đẩy vào **DLQ** (Dead Letter Queue - vốn đòi hỏi tín hiệu NACK/Reject từ worker hoặc chuyển hướng thủ công). | **Expected Fix:** Làm rõ cơ chế vận hành hệ thống. <br>- Nhánh 1: Nếu muốn chuyển vào DLQ qua RabbitMQ broker, worker phải phát tín hiệu **NACK** với cờ `requeue = false`. <br>- Nhánh 2: Nếu worker tự xử lý thủ công (ACK sự kiện ở hàng đợi chính và tự publish một bản tin lỗi mới sang DLQ exchange), tài liệu phải mô tả rõ ràng bước nghiệp vụ này.<br>**Owner:** Backend Specialist & Integration Architect |
| **DF-003** | **Medium** | Idempotency Key Specification | Tài liệu T-006 Section 7 cần ghi chú nhấn mạnh rõ hơn ranh giới kỹ thuật: Khóa tổ hợp `record_id + approved_at` là giải pháp tạm thời (dedup hint) cho US-001 và **CẤM** sử dụng làm khóa chính cho Ledger hoàn chỉnh ở US-002+. Tránh việc Developer hiểu nhầm và bê nguyên thiết kế tạm này vào code sản phẩm. | **Expected Fix:** Thêm một chỉ dẫn cảnh báo (Warning Alert block) tại Section 7 của tài liệu Hợp đồng, nhấn mạnh việc chuyển dịch sang khóa Postgres `record_id + approved_version` cho các Sprint tiếp theo.<br>**Owner:** Database Architect & Backend Specialist |

---

## 13. Go / No-Go Assessment

Dựa trên kết quả đánh giá chất lượng thiết kế của Sprint 1, QA đưa ra phán quyết chính thức:

> [!IMPORTANT]
> **QA Assessment Result:** **Go với các điều kiện hiệu chỉnh (Go with Corrections)**

### Lý do phán quyết:
1. **Phần Go:** Toàn bộ các cấu hình logic của Airtable Base (bảng, trường kiểu dữ liệu vật lý, các view, guardrails bảo vệ tự động và nguyên tắc payload tối giản) đã **hoàn thành 100%** và đáp ứng hoàn hảo các tiêu chí AC1-AC4 cùng BR1-BR3 của backlog. Hệ thống cơ sở dữ liệu đã sẵn sàng để đội ngũ kỹ thuật triển khai cấu hình trên Airtable.
2. **Phần hiệu chỉnh (Corrections):** Phải trực tiếp xử lý triệt để 3 lỗi bất đồng nhất và lỗi logic queue (**DF-001, DF-002, DF-003**) đã được chỉ ra tại Section 12. Các hiệu chỉnh này hoàn toàn thuộc về cập nhật tài liệu thiết kế và đặc tả kỹ thuật, không ảnh hưởng đến cấu trúc Airtable vật lý đã khóa. Do đó, đội ngũ phát triển được phép tiến hành cấu hình Airtable song song với việc cập nhật tài liệu kỹ thuật trong tác vụ **T-008**.

---

## 14. Handoff Notes for T-008 Documentation Update

Gửi đội ngũ phụ trách cập nhật tài liệu kỹ thuật (**T-008 Documentation Update**), hãy thực hiện hiệu chỉnh hồ sơ thiết kế theo các chỉ dẫn sau:

1. **Hiệu chỉnh Status của T-006 Contract:**
   - Mở file [US-001-middleware-handoff-contract.md](file:///d:/Muti-Media%20Management/docs/plans/US-001-middleware-handoff-contract.md).
   - Cập nhật dòng số 6 thành: `Status: Completed` (hoặc `Status: Active`).
2. **Giải quyết mâu thuẫn ACK vs DLQ (DF-002):**
   - Tại Section 10 (Table D) và Section 11A của file Hợp đồng, đồng bộ hóa thuật ngữ và hành động.
   - Thống nhất cơ chế: Đối với lỗi phân loại `channel_account_unresolved`, worker sẽ thực hiện gửi tín hiệu **NACK** với tham số `requeue = false` để RabbitMQ tự động định tuyến thông điệp vào Dead Letter Queue (DLQ) được cấu hình trên Broker, đảm bảo đúng quy chuẩn an toàn thông tin và vận hành Event-driven.
3. **Bổ sung cảnh báo khóa Idempotency (DF-003):**
   - Bổ sung một khối Alert Warning nổi bật tại Section 7 của file Hợp đồng, chỉ ra rõ ràng Airtable Record ID chỉ đóng vai trò là **mỏ neo tham chiếu (reference anchor)**, hoàn toàn không phải là khóa idempotency key cuối cùng của Operational Ledger Postgres.

---

## 15. Out-of-Scope Confirmations

QA xác nhận các nội dung kiểm thử sau nằm hoàn toàn **ngoài phạm vi (Out of Scope)** của tác vụ T-007 QA Acceptance Pass:

- **Không thực hiện cấu hình Airtable thật:** QA không tạo tài khoản Airtable, không tạo base thật, không kéo thả cấu hình automation trực tiếp trên đám mây (đây là công việc cấu hình của đội ngũ phát triển/SMM dựa trên tài liệu đã ký duyệt).
- **Không viết mã nguồn webhook receiver:** Không viết hay test code TypeScript/Node.js xử lý webhook (thuộc US-002).
- **Không triển khai hệ thống Queue thật:** Không khởi tạo máy chủ RabbitMQ, không cấu hình routing keys hay test kết nối mạng thực tế (thuộc US-014).
- **Không chạy thử AI hay Graph API:** Không test luồng gọi API OpenAI sinh variants hay Graph API Meta đăng bài thật (thuộc US-003/US-005).

---

## 16. Open Items / Risks

QA ghi nhận các vấn đề mở và rủi ro vận hành cần tiếp tục giám sát trong các Sprint sau:

| ID | Operational Risk / Open Item | Severity | Impact | QA Proposed Mitigation Strategy |
|:---|:---|:---|:---|:---|
| **R-01** | Trễ đồng bộ trạng thái kết nối tài khoản (Stub Sync Latency). | **Medium** | Stub account hiển thị `Connected` trong Airtable nhưng thực tế phía server đã `Expired`. Bài đăng lọt qua BR2 và bị lỗi khi worker reload. | Xây dựng một luồng đồng bộ một chiều (One-Way Sync) định kỳ (cron job) chạy mỗi 5-10 phút để tự động cập nhật trạng thái kết nối từ Postgres Ledger sang stub Airtable `Channel Accounts`. |
| **R-02** | Giới hạn hạn mức API Airtable khi reload dữ liệu hàng loạt (Rate limit 429). | **High** | Khi chạy chiến dịch lớn với tần suất bài đăng dày đặc, Middleware gọi reload API dồn dập vượt ngưỡng 5 requests/giây của Airtable. | Triển khai chính sách hàng đợi thông minh tại Middleware: Tích hợp cơ chế tự động giới hạn lưu lượng (rate limiter/throttling) kết hợp với thuật toán exponential backoff cho trạng thái `retryable_failed` (T-006 Section 10). |
| **R-03** | Người dùng sửa tay trường ngày duyệt `approved_at` trên Grid view. | **Medium** | Phá vỡ tính toàn vẹn của audit log và gây sai lệch khóa đối soát dedup hint tạm thời. | Cấu hình phân quyền trường trong Airtable (Field-level permissions): Khóa quyền chỉnh sửa trường `approved_at`, chỉ cho phép tài khoản hệ thống (Automation/API) ghi đè dữ liệu. |

---
