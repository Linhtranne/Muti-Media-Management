# AI-SDLC Retrofit Header for US-001

status: approved

## Goal

Maintain US-001 behavior for Airtable Campaign and Post Workflow Base according to the approved backlog, function flow, and implementation evidence.

## Tasks

- AC-001: Preserve the documented trigger, processing, and output workflow.
- AC-002: Preserve tenant isolation, idempotency, and durable Ledger/audit evidence where applicable.
- AC-003: Preserve zero-token and reference-only security boundaries.
- AC-004: Keep the story compatible with build, lint, tests, and AI-SDLC artifact validation.

## Done When

- AC-001: Story workflow matches the accepted implementation report and function flow register.
- AC-002: Ledger, idempotency, queue, and role/security constraints are documented or tested where applicable.
- AC-003: No raw tokens or oversized/raw provider payloads cross forbidden boundaries.
- AC-004: `npm run ai-sdlc:check -- US-001` passes after retrofit artifacts are present.

# PLAN: US-001 Airtable Base Campaign/Post Workflow

## Overview

Thiết lập Airtable base làm Control Plane cho MediaOps để Social Media Manager, Creator và Manager quản lý campaign, post, asset reference, lịch đăng và trạng thái duyệt ở một nơi chung.

Phạm vi này chỉ bao gồm Airtable schema, views, validation/guardrail cấu hình và tài liệu bàn giao. Không implement webhook middleware, RabbitMQ, AI Composer hay publish workflow; các phần đó thuộc US-002 trở đi.

## Project Type

Operations / No-code Control Plane setup.

Không phải WEB/MOBILE/BACKEND implementation. Nếu cần script automation cho Airtable về sau, dùng TypeScript và đặt phần gọi Platform API trong MCP server hoặc tooling được phê duyệt, không đặt trong orchestrator.

## Success Criteria

- AC1: Airtable có schema và view cho `Campaigns` và `Posts`.
- AC2: `Posts.status` có đủ `Draft`, `Review`, `Approved`, `Scheduled`, `Published`, `Failed`.
- AC3: Chỉ record `Approved` được đưa vào view/automation handoff sang middleware; chưa publish trực tiếp từ Airtable.
- AC4: Calendar view hiển thị theo `scheduled_at`.
- BR1: Không cho Approved khi thiếu `master_copy`.
- BR2: Post target Facebook phải có Facebook Page/account connected reference.
- BR3: `scheduled_at` không được nhỏ hơn thời điểm hiện tại khi chuyển Review/Approved/Scheduled.

## Tech Stack

- Airtable Base: Control Plane cho Campaign/Post workflow.
- Airtable Interface/Views: thao tác review, approval và calendar.
- Airtable Automations hoặc filtered handoff view: chỉ chuẩn bị trigger cho Approved records; webhook implementation thuộc US-002.
- Docs: cập nhật spec/schema và checklist vận hành trong repo.

## File Structure

```text
docs/
  PLAN-us-001-airtable-base.md
  04_Product_Backlog.md
  05_Function_Flow_Logic_Register.md
  06_Architecture_Composability.md
  11_Coding_Convention.md
```

## Agent Assignments

### T-001: Product Scope Lock

- Agent: Product Manager
- Skills: product-management
- Priority: P0
- Dependencies: none
- Input: US-001 backlog, architecture Control Plane rules
- Output: confirmed in-scope/out-of-scope checklist for Airtable setup
- Verify: checklist excludes queue processing, audit ledger, token storage, retry/idempotency, AI generation and publish execution

### T-002: Airtable Data Model

- Agent: Backend/API Architect acting as Airtable Schema Designer
- Skills: API design awareness, data modeling
- Priority: P0
- Dependencies: T-001
- Input: US-001 data fields and business rules
- Output: table specs for `Campaigns`, `Posts`, optional `Channel Accounts` reference, optional `Assets` reference
- Verify: `Campaigns` has `campaign_id`, `name`, `objective`, `start_date`, `end_date`, `owner`, `status`, optional `Notion Brief URL`; `Posts` has all required US-001 fields and links to Campaign

### T-003: Field Types and Constraints

- Agent: Database Architect
- Skills: schema design
- Priority: P0
- Dependencies: T-002
- Input: Airtable data model
- Output: field type matrix with required fields, single/multi-select options, linked records, computed fields and validation formula recommendations
- Verify: status options exactly include `Draft`, `Review`, `Approved`, `Scheduled`, `Published`, `Failed`; `target_channels` supports Facebook; `scheduled_at` is date-time; `approved_at` is date-time

### T-004: Workflow Views

- Agent: Operations Designer
- Skills: product-management, workflow design
- Priority: P1
- Dependencies: T-003
- Input: field matrix and user flow
- Output: Airtable views: Campaign Overview, Post Pipeline, Needs Review, Approved Handoff, Calendar by `scheduled_at`, Failed Posts
- Verify: Calendar uses `scheduled_at`; Approved Handoff filters `status = Approved`; Needs Review filters `status = Review`

### T-005: Approval Guardrails

- Agent: Security Auditor / Governance Reviewer
- Skills: security, policy review
- Priority: P1
- Dependencies: T-003
- Input: BR1-BR3 and security rules
- Output: Airtable validation/automation design to block or flag invalid approvals
- Verify: missing `master_copy`, missing Facebook channel account, and past `scheduled_at` cannot silently enter Approved handoff; no tokens are stored in Airtable

### T-006: Middleware Handoff Contract Stub

- Agent: Backend Specialist
- Skills: event-architect awareness
- Priority: P1
- Dependencies: T-004, T-005
- Input: Approved Handoff view and US-002 FL-001 draft
- Output: handoff field list for future webhook: `record_id`, `post_id`, `campaign_id`, `status`, `approved_at`, `scheduled_at`, `target_channels`, version/dedupe hint
- Verify: handoff contains references only; no raw tokens or large payloads; no direct publish action from Airtable

### T-007: QA Acceptance Pass

- Agent: QA Engineer
- Skills: qa-engineering
- Priority: P2
- Dependencies: T-004, T-005, T-006
- Input: Airtable base configuration and US-001 AC/BR
- Output: manual QA checklist with pass/fail evidence
- Verify: create campaign, create post, move Draft -> Review -> Approved, reject invalid Approved cases, confirm Calendar and Approved Handoff views

### T-008: Documentation Update

- Agent: Technical Writer / Project Manager
- Skills: documentation, product-management
- Priority: P2
- Dependencies: T-007
- Input: final Airtable schema, views, QA evidence
- Output: updated docs or linked implementation notes for US-001
- Verify: docs mention Airtable is Control Plane only and reference US-002 for webhook behavior

## Dependency Graph

```text
T-001
  -> T-002
    -> T-003
      -> T-004
      -> T-005
        -> T-006
          -> T-007
            -> T-008
```

T-004 and T-005 can run in parallel after T-003. T-006 waits for both because middleware handoff must reflect the final views and guardrails.

## RACI

| Workstream | Responsible | Accountable | Consulted | Informed |
| --- | --- | --- | --- | --- |
| Scope and acceptance | Product Manager | Project Manager | SMM, Manager | Team |
| Airtable schema | Airtable Schema Designer | Project Manager | Backend, Database Architect | SMM |
| Guardrails | Security Auditor | Project Manager | Backend, SMM | Manager |
| Handoff contract | Backend Specialist | Tech Lead | Security Auditor | PM |
| QA evidence | QA Engineer | Project Manager | SMM, Manager | Team |
| Documentation | Technical Writer | Project Manager | All owners | Team |

## Phase X: Verification

- [ ] Campaign and Post tables exist with required fields.
- [ ] Post status options exactly match US-001 AC2.
- [ ] Approved Handoff view filters only `Approved`.
- [ ] Calendar view uses `scheduled_at`.
- [ ] Invalid approval cases are blocked or visibly flagged.
- [ ] Facebook target requires connected Page/account reference.
- [ ] No raw token field exists in Airtable.
- [ ] Handoff contract contains references only.
- [ ] US-001 QA evidence recorded.



## AI-SDLC AC Traceability (Retrofit Audit)

- AC1: Planned and defined.
- AC2: Planned and defined.
- AC3: Planned and defined.
- AC4: Planned and defined.
