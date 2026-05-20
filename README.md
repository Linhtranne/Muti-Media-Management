# Bộ tài liệu dự án MediaOps Composability

Tài liệu này là mục lục làm việc chính của dự án. Quy trình tuân theo tài liệu IOC On-Job Training: Sprint 0 chuẩn bị nền tảng, sau đó phát triển theo Agile Scrum.

## Tài liệu hiện có

- `01_Project_Charter.md`: mục tiêu, phạm vi, vai trò, nguyên tắc dự án.
- `02_Agile_Scrum_Working_Agreement.md`: quy trình Scrum, Git flow, Definition of Ready/Done.
- `03_SRS_MediaOps_Composability.md`: SRS theo mẫu `SRS_Template_Generic.md`.
- `04_Product_Backlog.md`: backlog theo cấu trúc Description -> User Flow -> Data Fields -> Acceptance Criteria -> Business Rules.
- `05_Function_Flow_Logic_Register.md`: file ghi toàn bộ luồng và logic từng chức năng, cập nhật mỗi lần code.
- `06_Architecture_Composability.md`: kiến trúc Control Plane, Orchestration, MCP Execution, RabbitMQ Event Bus, Communication, Operational Ledger.
- `07_Risk_Assumption_Decision_Log.md`: quyết định, giả định, rủi ro, câu hỏi mở.

## Quy tắc cập nhật

- Mọi chức năng trước khi code phải có backlog item và Function Logic Register tương ứng.
- Mọi thay đổi logic trong code phải cập nhật `05_Function_Flow_Logic_Register.md`.
- Mọi quyết định kiến trúc phải ghi vào `07_Risk_Assumption_Decision_Log.md`.
- SRS cập nhật khi có thay đổi phạm vi hoặc yêu cầu chức năng chính.
