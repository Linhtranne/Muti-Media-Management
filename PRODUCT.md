# Product Context

## Product Purpose

MediaOps Composability là hệ sinh thái quản lý truyền thông đa kênh cho đội marketing, kết hợp Airtable Control Plane, Notion Knowledge & Brief Plane, AI Orchestrator, MCP Execution Plane, RabbitMQ Event Bus, Slack/Teams Communication Plane và Operational Ledger.

## Register

product

## Users

- CMO cần nhìn trạng thái campaign, publish quality, rủi ro và báo cáo vận hành.
- Social Media Manager cần lập lịch, kiểm duyệt và theo dõi nội dung trong Airtable.
- Content Creator cần tạo master copy và nhận biến thể nội dung từ AI.
- Support cần xử lý bình luận/cảnh báo từ Slack.
- Admin cần quản lý webhook, token, MCP server, quyền và audit log.

## Product Principles

- Tận dụng công cụ sẵn có thay vì build custom dashboard quá sớm.
- Airtable là Control Plane cho workflow có cấu trúc.
- Notion là Knowledge & Brief Plane cho tài liệu dài, brief và guideline.
- AI Agent không gọi API mạng xã hội trực tiếp; execution đi qua MCP.
- RabbitMQ xử lý queue/event bus; Postgres/InsForge là source of truth.
- Mọi publish/reply/command quan trọng phải có audit và policy guardrail.
- Token và secret không xuất hiện trong Airtable, Slack hoặc log thường.

## Tone

Rõ ràng, thực dụng, chuyên nghiệp. Tránh khẩu hiệu quảng cáo.
