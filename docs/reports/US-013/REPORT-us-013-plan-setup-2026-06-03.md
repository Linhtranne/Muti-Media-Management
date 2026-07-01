# AI-SDLC Retrofit Header for US-013

## AI-SDLC Completion Gate

| Gate | Evidence | Verdict |
|:---|:---|:---|
| Spec approved | docs/specs/SPEC-US-013.md | Pass |
| Plan approved | docs/plans/US-013/ | Pass |
| Red test evidence | docs/testing/US-013/RED-US-013.md | Partial |
| AC-001 trace | Spec, plan, RED, and report mention AC-001 | Pass |
| AC-002 trace | Spec, plan, RED, and report mention AC-002 | Pass |
| AC-003 trace | Spec, plan, RED, and report mention AC-003 | Pass |
| AC-004 trace | Spec, plan, RED, and report mention AC-004 | Pass |
| Build/lint/test evidence | Run `npm run ai-sdlc:validate -- US-013` after retrofit | Pending |
| Runtime smoke | Not run as part of documentation retrofit | Partial |

Retrofit note: this section records compatibility with the new AI-SDLC gate. It does not claim complete historical TDD or production readiness.

# Report: Thiết lập Notion Knowledge & Brief Plane

**Date:** 2026-06-03
**Agent(s) Used:** project-planner
**Related User Story:** US-013
**Status:** Completed (Plan Setup Only)

## Summary
Đã thực hiện rà soát kiến trúc hiện tại, logic đang có trong hệ thống và đưa ra bản kế hoạch (Plan) chi tiết để hoàn thiện US-013. US-013 nhắm mục tiêu dùng Notion làm hệ lưu trữ ngữ cảnh (Context Plane) cho nội dung, trong khi vẫn dùng Airtable làm hệ quản lý luồng (Control Plane).

## What Was Done
- [x] Đọc và đối chiếu `AGENTS.md`, `06_Architecture_Composability.md`, `11_Coding_Convention.md`, `12_Notion_Workspace_Spec.md`.
- [x] Đọc Requirements Backlog US-013 và Function Flow Register FL-007.
- [x] Scan và phân tích code hiện tại (`notionClient.ts`, `aiComposerWorker.ts`, `airtableClient.ts`, `composer.ts`, cùng các test files).
- [x] Phát hiện các điểm cần chỉnh sửa (schema của `notion_context_refs`, sự duplicate của FL-007, giới hạn prompt injection boundary).
- [x] Xóa bỏ đoạn mã FL-007/008/009 bị lặp (duplicate) trong tệp `05_Function_Flow_Logic_Register.md` và chuyển trạng thái FL-007 chính thức sang `Designed`.
- [x] Lập và lưu trữ Plan chi tiết.

## How It Was Done
### Approach
1. **Phân tích Codebase:** Phân tích `fetchNotionBrief` xem nó hỗ trợ tính năng gì (SSRF block, mock/test mode, extract properties).
2. **Review Schema:** Phát hiện `notion_context_refs` đang để lỏng lẻo (`z.array(z.any())`).
3. **Draft Plan:** Định nghĩa hành vi an toàn (hard fail cho SSRF, fallback cho API error), chốt template Notion, trả lời các Open Questions với recommended default.

### Tools & Skills Used
| Tool/Skill | Purpose |
|:---|:---|
| view_file | Đọc các tệp kiến trúc, convention, backlog và mã nguồn |
| write_to_file | Tạo file report và plan |
| project-planner | Phân tích yêu cầu và chuyển thành kế hoạch rõ ràng |

### Files Changed
| File | Action | Description |
|:---|:---|:---|
| `docs/requirements/05_Function_Flow_Logic_Register.md` | Modified | Xóa bỏ đoạn mã trùng lặp FL-007/008/009, cập nhật status FL-007 thành Designed |
| `docs/plans/US-013/PLAN-us-013-notion-knowledge-brief-plane.md` | Created | Bản kế hoạch chi tiết cho US-013 |
| `docs/reports/US-013/REPORT-us-013-plan-setup-2026-06-03.md` | Created | Báo cáo công việc (file này) |

## Impact & Purpose
- Tạo nền tảng để đội ngũ lập trình có thể implement hoàn thiện và an toàn phần Notion Integration (US-013).
- Chốt ranh giới chức năng của Notion: Chỉ làm nguồn đọc tham khảo (Knowledge & Brief Plane), không phải hệ thống quản lý queue, audit, hay token.
- Đảm bảo an toàn thông qua SSRF hard-fails và schema hardening, tuân thủ đúng yêu cầu bảo mật hiện hành.

## Decisions Made
| Decision | Rationale | Alternatives Considered |
|:---|:---|:---|
| Dùng `properties-only fetch` thay vì `page blocks` | Đáp ứng nhanh, đủ cho MVP. Việc phân tích page blocks là quá nặng và không mang lại lợi ích tương xứng ở Sprint 1. | Lấy toàn bộ văn bản (blocks) của trang. Khó parse và dễ gặp token limits trên LLMs. |
| Hard fail cho SSRF error | SSRF là rủi ro security lớn. AI run phải chuyển sang `failed`, parent workflow sang `ai_generation_failed`, không silent fallback. | Fallback về `campaign_objective`. Từ chối vì rủi ro hacker bypass log. |
| Lưu Page ID thay vì raw content | Airtable/DB chỉ lưu tham chiếu. Không để raw text bừa bãi ngoài audit log nếu không thực sự cần. | Cố định raw Notion API json vào DB. |

## Verification
- [x] Tests passed (Không áp dụng vì không sinh code)
- [x] Docs updated (Plan created)
- [x] No secrets exposed
- [x] Acceptance criteria met: Thỏa mãn tiêu chí Plan creation.

## Open Items / Next Steps
- (Implementation Task) Cập nhật định nghĩa schema `NotionContextRefSchema` với cấu trúc chặt chẽ (`.strict()`) và thay thế `z.array(z.any())` trong `packages/shared-contracts/src/ai/composer.ts`.
- Cập nhật `systemPrompt` trong `promptRegistry.ts` (nếu cần) để xử lý Prompt Injection Boundary.
- Viết các missing tests theo đúng Test Matrix.
