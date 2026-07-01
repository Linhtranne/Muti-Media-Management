# Risk, Assumption & Decision Log

## Decisions

| ID | Date | Decision | Rationale | Status |
| :--- | :--- | :--- | :--- | :--- |
| D-001 | 2026-05-20 | Chọn Composability thay vì custom SaaS dashboard | Giảm nợ kỹ thuật, tận dụng Airtable/Slack, phù hợp workflow marketing | Accepted |
| D-002 | 2026-05-20 | Airtable là Control Plane MVP | Có table/view/calendar/webhook phù hợp hơn Notion cho MVP automation | Accepted |
| D-003 | 2026-05-20 | InsForge/Postgres làm Operational Ledger | Airtable không phù hợp làm queue/audit/inbox lớn | Accepted |
| D-004 | 2026-05-20 | Facebook Page là execution platform đầu tiên | Phù hợp thị trường Việt Nam và scope publish/comment | Accepted |
| D-005 | 2026-05-20 | Slack trước Teams | Slack slash command đơn giản hơn cho MVP; Teams phase sau | Accepted |
| D-006 | 2026-05-20 | RabbitMQ dùng Docker Compose cho dev/staging, CloudAMQP (managed) cho production | Docker Compose đơn giản cho dev, không cần ops phức tạp; CloudAMQP free tier đủ cho MVP traffic; tránh tự quản lý RabbitMQ cluster trên production | Accepted |
| D-007 | 2026-05-20 | Webhook receiver Sprint 1 triển khai 2 phase | Phase A local Node.js + ngrok ở tuần 1 để bắt payload thật; Phase B Railway/Render container ở tuần 2+ để có URL ổn định, RabbitMQ và Ledger | Accepted |
| D-008 | 2026-05-20 | Ownership Sprint 1 đã chốt | Airtable Base: Product Owner/Social Media Manager; Notion Workspace: Product Owner/BA; Airtable Webhook config: Tech Lead/Admin | Accepted |
| D-009 | 2026-06-01 | US-004: Forbidden terms seed list trong `packages/policy-engine/src/forbiddenTerms.ts` | Không block implementation trong khi BA/Marketing review. 10 conservative terms: chính trị nhạy cảm, bạo lực, lừa đảo, cam kết lợi nhuận, thuốc chữa khỏi, thù ghét, kỳ thị, 18+, cờ bạc, bản quyền. Workspace có thể override sau. Answers Q-004. | Accepted |
| D-010 | 2026-06-01 | US-004: `POLICY_VERSION = 'policy-facebook-v1'` constant trong `packages/policy-engine/src/version.ts` | MVP: constant đủ ổn định cho idempotency key, không cần DB version table sớm. Version bump khi rule set thay đổi breaking. | Accepted |
| D-011 | 2026-06-01 | US-004: Publish job idempotency key bao gồm `policy_version`: `publish.facebook.job:{ws}:{post}:{approved_ver}:{policy_ver}` | Tránh false-positive dedup khi policy version bump → cùng post/version có thể cần re-evaluate và re-create job. | Accepted |
| D-012 | 2026-06-01 | US-004 tự tạo migration `0004_us004_policy_publish_guardrail.sql` cho `publish_jobs` minimal schema | US-004 AC5 yêu cầu tạo publish job khi pass; không thể phụ thuộc US-005. US-005 ADD COLUMN khi implement. | Accepted |
| D-013 | 2026-06-01 | US-004: `auto_approve_enabled` per-workspace; US-004 chỉ đọc và fail closed | Backlog BR2: chỉ manager/admin mới bật. Việc thay đổi config scope US-008/US-010. Answers Q-005 (partial). | Accepted |
| D-014 | 2026-06-01 | US-004: Slack alert dùng env var `POLICY_BLOCK_SLACK_CHANNEL_ID`; thiếu → graceful degradation | Slack là post-commit side effect; không được phép fail policy transaction. Audit `alert_pending_config` khi biến môi trường thiếu. | Accepted |

## Assumptions

| ID | Assumption | Impact if Wrong | Validation |
| :--- | :--- | :--- | :--- |
| A-001 | Team có thể dùng Airtable làm CMS chính | Phải chuyển sang Notion/custom UI | Xác nhận với stakeholder |
| A-002 | Facebook Page API permission có thể được cấp cho test/production | MVP publish thật bị chậm | Xác minh Meta App và docs trước Sprint 3 |
| A-003 | Slack là communication channel chấp nhận được cho MVP | Cần đổi sang Teams sớm | Xác nhận môi trường vận hành |
| A-004 | InsForge/Postgres phù hợp làm Ledger | Cần chọn Postgres khác | Kiểm tra schema/RLS trong Sprint 1 |
| A-005 | CloudAMQP free tier (Little Lemur) đủ cho MVP message volume | Cần upgrade plan hoặc self-host nếu vượt 1M msg/tháng | Monitor message volume trong Sprint 2-3 |

## Risks

| ID | Risk | Severity | Mitigation |
| :--- | :--- | :--- | :--- |
| R-001 | Meta App Review chậm hoặc thiếu permission | High | Tách MCP, hỗ trợ test mode/mock, chuẩn bị permission checklist |
| R-002 | Airtable webhook duplicate hoặc thiếu event | Medium | Idempotency, scheduled reconciliation job |
| R-003 | AI sinh nội dung sai hoặc rủi ro | High | Policy Engine, approval guardrail, legal keywords, audit |
| R-004 | Slack command bị giả mạo | High | Verify signature, timestamp, role mapping |
| R-005 | Token bị lộ qua log/Airtable/Slack | Critical | Token secret store, metadata only, log masking |
| R-006 | Scope creep sang nhiều kênh quá sớm | High | MVP khóa Facebook Page trước, platform khác phase sau |

## Open Questions

| ID | Question | Owner | Needed By |
| :--- | :--- | :--- | :--- |
| Q-001 | What fixed sections should the Notion Campaign Brief template include beyond brand voice/legal note? | Product Owner/BA | Sprint 0 |
| Q-003 | Meta App/Facebook Page test có sẵn chưa? | Admin/IT | Sprint 2 |
| ~~Q-004~~ | ~~Danh sách forbidden terms/legal keywords ban đầu là gì?~~ | ~~BA/Marketing~~ | ~~Sprint 2~~ → **Answered: D-009** |
| ~~Q-005~~ | ~~Ai có quyền Manager/Admin trong workflow duyệt?~~ | ~~Product Owner~~ | ~~Sprint 1~~ → **Answered (partial): D-013** — per-workspace, manager/admin only; full permission UI thuộc US-008/US-010 |
| ~~Q-006~~ | ~~RabbitMQ sẽ self-host, Docker Compose hay dùng managed broker?~~ | ~~Tech Lead/Admin~~ | ~~Sprint 0~~ → **Answered: D-006** |
| ~~Q-007~~ | ~~Ai sở hữu Airtable base, Notion workspace và webhook config?~~ | ~~Product Owner/Tech Lead~~ | ~~Sprint 1~~ → **Answered: D-008** |
| ~~Q-008~~ | ~~Webhook receiver Sprint 1 chạy kiểu nào?~~ | ~~Tech Lead/Admin~~ | ~~Sprint 1~~ → **Answered: D-007** |

## DEC-006: Facebook Publishing Decoupled Architecture
- **Date**: 2026-06-01
- **Decision**: US-006 implements Facebook publishing by strictly separating the Orchestrator from Graph API calls. Orchestrator relies on Facebook MCP Server via tool calls. Scheduling is handled via a cron poller that pushes events to RabbitMQ rather than relying on RabbitMQ delayed messages.
- **Rationale**: Keeps tokens strictly isolated in the MCP layer. Ensures that scheduled posts wait in Postgres (Ledger), where they can be queried easily or canceled if needed, rather than being hidden in a RabbitMQ delayed exchange.
- **Risks**: Polling loop can create DB load if not indexed. (Mitigation: index on status and scheduled_at).
