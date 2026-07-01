# Report: US-005 Documentation

**Date:** 2026-06-01
**Agent(s) Used:** Codex (Antigravity)
**Related User Story:** US-005
**Status:** Completed

## Summary
Đã hoàn thành toàn bộ tài liệu thiết kế và plan cho US-005 (Facebook MCP Validate và Enqueue Publish Job). Bao gồm implementation plan, security release gate, và cập nhật Function Flow Logic Register. Các tài liệu này vạch ra ranh giới rõ ràng giữa Orchestrator và MCP server để đảm bảo zero-trust token handling và reference-only queue payloads.

## What Was Done
- [x] Tạo `US-005-implementation-plan.md` với kiến trúc 4 phase, MCP tool contracts (`validate_post`, `get_rate_limit_status`), RabbitMQ references-only events, và migration schema (`publish_jobs` extend, `mcp_validation_events` outbox).
- [x] Tạo `US-005-security-release-gate.md` với 20 gate items chặt chẽ (P0/P1/P2) để đảm bảo không rò rỉ token, không gọi trực tiếp Graph API từ orchestrator, và rollback an toàn.
- [x] Cập nhật `05_Function_Flow_Logic_Register.md`: tách biệt US-005 (FL-004) khỏi US-006 (FL-004b), định nghĩa rõ processing logic, idempotency, và security rules. Khôi phục lại các FL-005, FL-006 cũ bị mất/hỏng trong quá trình patch file.

## How It Was Done
### Approach
1.  **Context Loading:** Đọc kỹ architecture, coding conventions, backlog, SRS, flow logic, và kế thừa format từ tài liệu US-004. Đảm bảo US-005 tương thích 100% với `publish_jobs` stub và message được tạo từ US-004.
2.  **Implementation Plan:** Thiết kế flow trong đó Orchestrator đóng vai trò business logic + Ledger state, MCP Server đóng vai trò platform logic + Token resolution. Defind rõ `ValidatePostResult` trả về sanitized code thay vì raw Graph API response.
3.  **Security Gate:** Đặt các hard constraints (ví dụ: `validate_post` tuyệt đối không được gọi endpoint `/feed` publish; logs không chứa raw error message từ Facebook).
4.  **Flow Register Update:** Chia tách stub cũ thành FL-004 (US-005 Validate) và FL-004b (US-006 Execution). Cập nhật error matrix chi tiết. Sửa lỗi edit script làm hỏng FL-005/FL-006 cũ bằng Node.js script trực tiếp.

### Tools & Skills Used
| Tool/Skill | Purpose |
|:---|:---|
| `view_file` | Đọc tài liệu kiến trúc, US-004 report, flow logic register. |
| `write_to_file` | Tạo file implementation plan và security gate. |
| `replace_file_content` | Cập nhật `05_Function_Flow_Logic_Register.md`. |
| Node.js script (`fix.cjs`) | Khôi phục nội dung FL-005/FL-006 bị ghi đè nhầm do replace_file_content. |

### Files Changed
| File | Action | Description |
|:---|:---|:---|
| `docs/plans/US-005/US-005-implementation-plan.md` | Created | Detailed plan, contracts, migration, worker flow. |
| `docs/plans/US-005/US-005-security-release-gate.md` | Created | 20 testable security/architecture rules for CI/CD. |
| `docs/requirements/05_Function_Flow_Logic_Register.md` | Modified | Updated FL-004 for US-005 scope, stubbed US-006 as FL-004b. |

## Impact & Purpose
Tài liệu US-005 cung cấp lộ trình thực thi và kiểm duyệt bảo mật chi tiết, tuân thủ nguyên tắc composability, reference-only events, và tenant-isolation. Nó chuẩn bị sẵn sàng cho phase code implementation.

## Decisions Made
| Decision | Rationale | Alternatives Considered |
|:---|:---|:---|
| US-005 chỉ bao gồm validate và prepare job | US-006 sẽ thực thi publish thực tế. Tránh một worker ôm cả validate và publish dễ sinh lỗi mạng timeout dài và phức tạp rollback. | Gộp chung validate/publish vào một worker. |
| `get_rate_limit_status` tính theo Ledger count MVP | Facebook Graph API rate limit headers không expose chính xác "daily posts remaining". | Parse rate limit error sau khi bị block. |
| Token pre-check từ Ledger | Tránh gọi MCP nếu metadata đã hết hạn, fail fast. | Chỉ check token lúc gọi MCP. |

## Verification
- [x] Docs updated (Implementation Plan, Security Gate, Flow Register).
- [x] No secrets exposed (không hardcode token trong docs).
- [x] Acceptance criteria met: tài liệu rất chi tiết, có testable flow, chia biên giới rõ ràng.

## Open Items / Next Steps
- Cần review lại Open Questions (OQ-005-1 đến OQ-005-8) trong `US-005-implementation-plan.md`, đặc biệt là OQ-005-3/4 về cơ chế secret store.
- Đợi BA/Security team approve plan trước khi bắt đầu chuyển sang code (implementation mode).
