# Report: US-001 Product Scope Lock

**Date:** 2026-05-20
**Agent(s) Used:** Product Manager Agent (Spawner: product-management skill)
**Related User Story:** US-001
**Status:** Completed

## Summary

Thực hiện T-001 Product Scope Lock cho US-001 Airtable Base Campaign/Post Workflow. Đọc toàn bộ tài liệu bắt buộc, trích xuất constraints từ architecture/backlog/SRS, và tạo scope lock document chốt ranh giới in-scope/out-of-scope cho các agent tiếp theo.

## What Was Done

- [x] Đọc 7 tài liệu bắt buộc theo thứ tự ưu tiên
- [x] Đọc Spawner skill `product-management` (skill.yaml + sharp-edges.yaml)
- [x] Tạo `docs/plans/US-001-scope-lock.md` với đầy đủ 10 sections
- [x] Xác nhận in-scope: Campaigns table, Posts table, Channel Accounts stub, 6 views, guardrail design, handoff view
- [x] Xác nhận out-of-scope: webhook, RabbitMQ, AI, Policy Engine, MCP, token, audit, retry, Slack
- [x] Map AC1–AC4 và BR1–BR3 với deliverables cụ thể
- [x] Ghi nhận 5 risks/ambiguities cần giải quyết ở tasks tiếp theo
- [x] Soạn handoff notes chi tiết cho T-002

## How It Was Done

### Approach

Đọc docs theo thứ tự Architecture (P0) → Coding Convention (P0) → Backlog (P1) → Function Flow (P1) → Risk Log (P2) → SRS (P2). Trích xuất constraints áp dụng cho US-001, cross-reference giữa docs để phát hiện mâu thuẫn (không tìm thấy mâu thuẫn). Áp dụng Spawner product-management anti-patterns: explicit out-of-scope list (scope-creep-monster), no solution-first (chỉ lock scope, không implement).

### Tools & Skills Used

| Tool/Skill | Purpose |
|:---|:---|
| Spawner product-management/skill.yaml | PM principles, anti-patterns awareness |
| Spawner product-management/sharp-edges.yaml | Scope creep prevention, stakeholder alignment |
| Architecture doc §3 | Control Plane boundaries |
| Risk Log D-002 | Airtable = Control Plane MVP confirmation |

### Files Changed

| File | Action | Description |
|:---|:---|:---|
| `docs/plans/US-001-scope-lock.md` | Created | Full scope lock document with 10 sections |
| `docs/reports/REPORT-us-001-product-scope-lock-2026-05-20.md` | Created | This report |

## Impact & Purpose

Scope lock document định rõ ranh giới cho toàn bộ chain T-002 → T-008. Các agent sau (Backend/Schema Designer, Database Architect, Operations Designer, Security Auditor) sẽ dựa vào document này để:
- Biết chính xác tables/fields/views cần tạo
- Biết rõ cái gì KHÔNG làm trong US-001
- Hiểu architectural constraints trước khi thiết kế
- Có handoff notes cụ thể cho T-002

## Decisions Made

| Decision | Rationale | Alternatives Considered |
|:---|:---|:---|
| Channel Accounts = minimal stub table | BR2 cần reference check; full OAuth ở US-011 | Không tạo table (thiếu BR2 check) / Full table (scope creep) |
| Campaign.status recommend: Draft/Active/Paused/Completed | Backlog không specify; cần consistency | Không define (để mỗi agent tự chọn) |
| asset_links = multi-line text or multi-URL | Avoid Airtable Attachment storage cost | Single URL (insufficient) / Attachment (cost concern) |

## Verification

- [x] Đã đọc tất cả docs bắt buộc (7/7)
- [x] Scope chỉ nằm trong Airtable Control Plane
- [x] Không có token/secrets trong document
- [x] Không implement webhook/publish/AI/queue
- [x] Output sẵn sàng cho T-002 Airtable Data Model
- [x] Acceptance criteria covered: AC1, AC2, AC3, AC4
- [x] Business rules covered: BR1, BR2, BR3

## Open Items / Next Steps

- **Q-005 (open):** Ai có quyền Manager/Admin trong workflow duyệt? → Cần Product Owner trả lời trước T-005.
- **RA-01:** Airtable validation weakness → T-005 sẽ evaluate guardrail approach.
- **RA-03:** Campaign.status values chưa chính thức → T-002 confirm.
- **RA-05:** asset_links field type → T-003 confirm.
- **Next:** T-002 Airtable Data Model agent có thể bắt đầu dựa trên scope lock này.
