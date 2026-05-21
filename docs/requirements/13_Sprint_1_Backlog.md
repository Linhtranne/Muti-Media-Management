# Sprint 1 Backlog: Control Plane Event Foundation

## Sprint Goal

Thiết lập nền tảng vận hành đầu tiên: Airtable Control Plane, Notion Knowledge Plane, RabbitMQ Event Bus, webhook receiver và Postgres/InsForge Operational Ledger đủ để nhận sự kiện `Post Approved` một cách idempotent.

## Sprint Duration

Khuyến nghị: 2 tuần.

## Sprint Scope

In scope:

- Tạo Airtable base theo `09_Airtable_Schema_Spec.md`.
- Tạo Notion workspace/template theo `12_Notion_Workspace_Spec.md`.
- Thiết kế Ledger schema cho webhook events, queue metadata, audit logs.
- Thiết kế RabbitMQ exchanges/queues cho Sprint 1.
- Xây webhook receiver contract cho Airtable `Post Approved`.
- Ghi Function Logic Register cho mọi logic được code.

## Ownership

| Area | Owner |
| :--- | :--- |
| Airtable Base | Product Owner / Social Media Manager |
| Notion Workspace | Product Owner / BA |
| Airtable Webhook Config | Tech Lead / Admin |
| RabbitMQ Topology | Tech Lead / Backend Specialist |
| Operational Ledger Schema | Tech Lead / Database Architect |

Out of scope:

- AI Composer thật.
- Facebook publish thật.
- Slack slash commands.
- Direct Message inbox implementation.

## Selected Product Backlog Items

| Story | Title | Sprint Priority | Notes |
| :--- | :--- | :--- | :--- |
| US-001 | Thiết lập Airtable base cho campaign/post workflow | P0 | Bắt buộc để có Control Plane |
| US-002 | Webhook Airtable kích hoạt workflow khi Post Approved | P0 | Bắt buộc để có event entrypoint |
| US-013 | Thiết lập Notion Knowledge & Brief Plane | P1 | Bắt buộc để AI có context ở Sprint 2 |
| US-014 | RabbitMQ Event Bus cho publish/comment/direct message | P0 | Sprint 1 chỉ cần foundation queues |
| US-010 | Operational Ledger và Audit Log | P0 | Sprint 1 chỉ cần webhook/queue/audit subset |

## Task Breakdown

| Task ID | Task | Owner/Agent | Input | Output | Verify |
| :--- | :--- | :--- | :--- | :--- | :--- |
| S1-01 | Create Airtable Base Spec Checklist | BA/PM | `09_Airtable_Schema_Spec.md` | Checklist fields/views/statuses | All required tables/fields mapped |
| S1-02 | Create Notion Template Checklist | BA/PM | `12_Notion_Workspace_Spec.md` | Campaign Brief and Guideline checklist | Airtable Campaign has `Notion Brief URL` mapping |
| S1-03 | Design Ledger Schema v1 | Database Architect | US-002, US-010, US-014 | Tables for webhook_events, queue_events, audit_logs | Constraints/idempotency keys documented |
| S1-04 | Design RabbitMQ Topology v1 | Backend Specialist | US-014 | Exchanges, queues, routing keys, DLQ policy | Each queue has producer/consumer and retry rule |
| S1-05 | Define Airtable Webhook Receiver Contract | Backend Specialist | FL-001 | Endpoint contract, payload shape, validation rules | Contract handles approved, ignored, duplicate, failed |
| S1-06 | Define Worker Contract for Approved Post Event | Backend Specialist | FL-008 | Consumer contract and ack/retry rules | Worker updates Ledger before ack |
| S1-07 | Security Review for Sprint 1 Foundation | Security Reviewer | Schema + queue + webhook contract | Security notes | No raw token, signed/verified event plan, audit coverage |
| S1-08 | Update Function Logic Register | Tech Lead | S1 design outputs | FL-001/FL-008 updated | Register matches implementation plan |

## Webhook Receiver Deployment Path

### Phase A: Dev, Sprint 1 Week 1

```text
Airtable webhook
-> ngrok public URL
-> Local Node.js server on localhost:3000
-> console.log / local structured log
```

Goal:

- Prove Airtable can call the webhook receiver.
- Inspect real Airtable payload shape.
- Validate status-change detection for `Post Approved`.
- No RabbitMQ/Ledger dependency required for the first smoke test.

Done:

- Airtable webhook reaches local server.
- Local server logs request headers, method and sanitized body.
- Test event can be replayed manually.

### Phase B: Staging/Production, Sprint 1 Week 2+

```text
Airtable webhook
-> Railway/Render stable container URL
-> Webhook receiver validates + normalizes event
-> RabbitMQ
-> Worker
-> Operational Ledger
```

Goal:

- Move from local tunnel to stable URL.
- Add idempotency, queue publish and Ledger persistence.
- Prepare the foundation for AI Composer in Sprint 2.

Done:

- Railway/Render deployment has stable HTTPS endpoint.
- Receiver publishes `airtable.webhook.approved` event to RabbitMQ.
- Worker writes event metadata to Ledger before ack.
- Failed events are observable.

## Acceptance Criteria

- AC1: Airtable schema and views are ready to create manually or via API.
- AC2: Notion Campaign Brief template is ready and linkable from Airtable Campaign.
- AC3: Ledger schema v1 covers webhook event, queue event and audit log.
- AC4: RabbitMQ topology defines queue names, routing keys, retry and DLQ.
- AC5: Webhook receiver contract includes idempotency and reload-record rule.
- AC6: Sprint 1 outputs are reflected in `05_Function_Flow_Logic_Register.md`.

## Definition of Done

- Documentation and contracts reviewed.
- No unresolved P0 architecture decisions.
- Sprint 1 implementation can start without choosing schema/queue names ad hoc.
- All new code, when implemented, must follow `AGENTS.md` and `docs/11_Coding_Convention.md`.


