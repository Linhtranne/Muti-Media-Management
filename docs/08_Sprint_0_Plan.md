# Sprint 0 Plan

## Sprint Goal

Team hiểu thống nhất dự án MediaOps Composability, có backlog/SRS/kiến trúc/base workflow đủ để bắt đầu Sprint 1.

## Duration

Khuyến nghị: 1 tuần.

## Sprint 0 Backlog

| ID | Task | Owner | Output | Done Criteria |
| :--- | :--- | :--- | :--- | :--- |
| S0-01 | Chốt phạm vi MVP | PO/PM | Project Charter cập nhật | In/out scope rõ |
| S0-02 | Hoàn thiện SRS | BA | SRS `.md` và `.docx` | Stakeholder review được |
| S0-03 | Hoàn thiện Product Backlog | BA/PM | Backlog theo mẫu | Mỗi story có Description/User Flow/Data Fields/AC/Business Rules |
| S0-04 | Thiết kế Airtable schema | BA/Architect | Airtable Schema Spec | Field/type/status rõ |
| S0-05 | Thiết kế kiến trúc composability | Architect | Architecture doc | Layer, data flow, boundaries rõ |
| S0-06 | Thiết kế Function Logic Register | PM/Tech Lead | Register template + initial flows | Mỗi chức năng chính có FL entry |
| S0-07 | Thống nhất Git/Coding convention | Tech Lead | Convention doc | Branch/commit/PR rule rõ |
| S0-08 | Chuẩn bị Test/Bug templates | Tester | Test/Bug template | Dùng được trong Sprint 1 |
| S0-09 | Xác nhận tool/account | Admin/IT | Access checklist | Airtable/Slack/Meta/InsForge owner rõ |

## Sprint 0 Review Checklist

- Có thể giải thích hệ thống bằng sơ đồ architecture.
- Có thể demo mock workflow Airtable: Draft -> Review -> Approved.
- Có backlog đủ cho ít nhất 2 sprint tiếp theo.
- Có tài liệu logic để developer cập nhật khi code.
- Có danh sách rủi ro và câu hỏi mở.

## Sprint 1 Candidate Goal

Thiết lập Airtable Control Plane, webhook receiver và Operational Ledger schema để nhận Post Approved event một cách idempotent.
