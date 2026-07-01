# Project Charter: MediaOps Composability

## 1. Tầm nhìn

MediaOps Composability là hệ sinh thái quản lý truyền thông đa kênh cho đội marketing, dùng Airtable làm Control Plane, Notion làm Knowledge & Brief Plane, AI Orchestrator để tự động hóa nội dung, MCP server để thực thi tích hợp nền tảng, Slack/Teams để cảnh báo và tương tác, InsForge/Postgres để lưu operational ledger.

## 2. Mục tiêu Sprint 0

- Thống nhất phạm vi MVP.
- Xây dựng Product Backlog ban đầu.
- Hoàn thiện SRS cơ bản.
- Xây dựng kiến trúc composability.
- Xác định luồng dữ liệu, use case, data fields và business rules chính.
- Chuẩn bị quy trình Scrum, Git flow, Definition of Ready, Definition of Done.

## 3. MVP Scope

In scope:

- Airtable Control Plane cho campaign, post, variant, approval, channel account.
- Webhook từ Airtable sang Orchestration Middleware.
- AI Composer tạo biến thể nội dung cho Facebook Page.
- Policy/approval guardrail trước khi publish.
- Facebook MCP Server cho validate, enqueue, publish, sync comments.
- RabbitMQ queues cho webhook, publish job, comment/direct message ingestion, alert v? retry.
- Slack alerts và slash commands cho approve/reject/reply/escalate.
- Operational Ledger lưu job, audit, webhook event, interaction cache.

Out of scope cho MVP:

- Full custom SaaS dashboard.
- Full Messenger inbox.
- Multi-platform publish ngoài Facebook Page.
- Microsoft Teams command implementation.
- ROI attribution phức tạp đa chạm.

## 4. Vai trò dự án

- Product Owner: chốt ưu tiên backlog, phạm vi MVP, acceptance criteria.
- Project Manager/Scrum Master: quản lý sprint, ceremony, impediment, báo cáo tiến độ.
- BA: viết user story, user flow, data fields, business rules.
- Solution Architect: thiết kế composability architecture, integration boundaries.
- Developer: triển khai middleware, MCP server, ledger, integration.
- Tester: viết test case, test API/webhook/command, regression.
- Pentest/Security Reviewer: audit token, webhook, MCP tools, Slack command, RLS.

## 5. Success Metrics

- 100% post publish qua Facebook MCP có audit log.
- 0 publish job được thực thi nếu thiếu approval hoặc fail policy.
- Comment mới từ Facebook xuất hiện trong Slack alert và ledger trong vòng 5 phút ở MVP.
- Social Media Manager có thể quản lý ý tưởng -> duyệt -> publish từ Airtable mà không cần dùng app riêng.
- Team có backlog, SRS, function logic register đủ để bắt đầu Sprint 1.
