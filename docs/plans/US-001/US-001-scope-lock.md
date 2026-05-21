# US-001 Airtable Base Scope Lock

**Date:** 2026-05-20
**Task:** T-001 Product Scope Lock
**User Story:** US-001 — Thiết lập Airtable base cho campaign/post workflow
**Status:** Locked
**Owner:** Product Manager Agent

---

## Docs Read

| Priority | Document | Key Constraints Extracted |
|:---|:---|:---|
| P0 | `PLAN-us-001-airtable-base.md` | T-001 scope, dependency graph, verify criteria |
| P0 | `06_Architecture_Composability.md` | Airtable = Control Plane only; no queue/audit/token/retry |
| P0 | `11_Coding_Convention.md` | No raw token in Airtable/Slack/logs; code in MCP not orchestrator |
| P1 | `04_Product_Backlog.md` | US-001 AC1–4, BR1–3, Campaign/Post data fields |
| P1 | `05_Function_Flow_Logic_Register.md` | FL-001 (US-002) confirms webhook is out of US-001 |
| P2 | `07_Risk_Assumption_Decision_Log.md` | D-002: Airtable is Control Plane MVP; R-005: token exposure critical |
| P2 | `03_SRS_MediaOps_Composability.md` | NFR: Airtable not for queue/inbox; MCP owns platform API |

---

## In Scope Checklist

- [x] **Campaigns table** — `campaign_id`, `name`, `objective`, `start_date`, `end_date`, `owner`, `status`, optional `Notion Brief URL`
- [x] **Posts table** — `post_id`, `campaign_id`, `title`, `master_copy`, `cta_url`, `asset_links`, `target_channels`, `scheduled_at`, `status`, `reviewer`, `approved_at`
- [x] **Posts.status values** — Single Select: `Draft`, `Review`, `Approved`, `Scheduled`, `Published`, `Failed`
- [x] **Campaign ↔ Post linked record** relationship
- [x] **Channel Accounts reference table** (optional/stub) — for BR2 Facebook Page connected check
- [x] **Views:**
  - Campaign Overview (Grid)
  - Post Pipeline (Grid/Kanban by status)
  - Needs Review (filtered: `status = Review`)
  - Approved Handoff (filtered: `status = Approved`)
  - Calendar by `scheduled_at`
  - Failed Posts (filtered: `status = Failed`)
- [x] **Guardrail/validation design** (Airtable-level config):
  - BR1: Block Approved if `master_copy` is empty
  - BR2: Block Approved if `target_channels` includes Facebook without connected Page reference
  - BR3: Block Review/Approved/Scheduled if `scheduled_at` < now
- [x] **Approved Handoff view** — filtered view of `status = Approved`, ready for US-002 webhook middleware to consume
- [x] **Scope documentation** — this file, locking boundaries for downstream agents

---

## Out of Scope Checklist

- [ ] ~~Webhook middleware implementation~~ → US-002
- [ ] ~~RabbitMQ queue/worker setup~~ → US-014
- [ ] ~~AI Composer / AI generation run~~ → US-003
- [ ] ~~Policy Engine runtime~~ → US-004
- [ ] ~~Facebook Graph API / MCP publish~~ → US-005, US-006
- [ ] ~~Token storage / secret management~~ → US-011
- [ ] ~~Audit ledger implementation~~ → US-010
- [ ] ~~Retry / idempotency runtime~~ → US-005, US-014
- [ ] ~~Slack alerts / slash commands~~ → US-008, US-009
- [ ] ~~Notion workspace setup~~ → US-013
- [ ] ~~Direct message inbox~~ → US-015
- [ ] ~~Reporting dashboard~~ → US-012
- [ ] ~~Airtable automation that publishes directly~~ → Forbidden by architecture
- [ ] ~~Any code implementation (TypeScript, Node.js, etc.)~~ → US-002+

---

## Acceptance Criteria Mapping

| AC | Description | US-001 Deliverable | Verification |
|:---|:---|:---|:---|
| AC1 | Có Airtable schema/view cho Campaign và Post | Campaigns table + Posts table + 6 views defined | T-002/T-004 creates actual tables/views |
| AC2 | Post status: Draft, Review, Approved, Scheduled, Published, Failed | Single Select field with exactly these 6 options | T-003 locks field type |
| AC3 | Chỉ record Approved mới được đưa sang middleware handoff | Approved Handoff view filtered `status = Approved`; no Airtable automation publishes directly | T-004 creates view; T-006 defines handoff contract |
| AC4 | Calendar view hiển thị lịch đăng theo `scheduled_at` | Calendar view using `scheduled_at` as date field | T-004 creates view |

---

## Business Rules Mapping

| BR | Rule | Airtable Implementation Approach | Owner Task |
|:---|:---|:---|:---|
| BR1 | Post không được Approved nếu thiếu `master_copy` | Airtable validation formula or automation guard on status change | T-005 |
| BR2 | Post target Facebook phải có Facebook Page/account connected reference | Linked record validation against Channel Accounts reference | T-005 |
| BR3 | `scheduled_at` không được nhỏ hơn thời điểm hiện tại khi chuyển Review/Approved/Scheduled | Airtable formula check or automation guard | T-005 |

**Note:** Airtable native validation is limited. T-005 will design the best guardrail approach — either:
- Airtable Automations that revert invalid status changes + send notification, OR
- Interface form with conditional logic, OR
- Formula field flagging invalid states + Approved Handoff view excludes flagged records

---

## Architectural Constraints

1. **Airtable IS Control Plane** — campaign/post management, calendar, approval status, asset reference, human editing/review (Architecture §3).
2. **Airtable IS NOT** — queue processor, audit ledger, token store, high-volume inbox, retry/idempotency engine (Architecture §3).
3. **No raw token** in any Airtable field, formula, or automation output (Coding Convention §5, Risk R-005).
4. **Handoff = references only** — Approved Handoff view/automation must expose record references (`record_id`, `post_id`, `campaign_id`, `status`, `approved_at`, `scheduled_at`, `target_channels`), not tokens or large payloads (Architecture §7, Coding Convention §5).
5. **No direct publish from Airtable** — Airtable may prepare handoff data for Approved records, but actual publish goes through Middleware → MCP (Architecture §5, §6).
6. **Notion Brief URL** — Campaign may contain a URL field linking to Notion Campaign Brief; this is a reference only, no API integration in US-001 (Architecture §4).
7. **Facebook Page = reference stub** — Channel Accounts table (if created) stores display name/reference only; actual token and OAuth are in US-011 server-side secret store.

---

## Dependencies for Next Tasks

| Next Task | What It Needs from T-001 |
|:---|:---|
| **T-002: Airtable Data Model** | Confirmed field list for Campaigns and Posts; confirmed linked record structure; optional Channel Accounts stub |
| **T-003: Field Types & Constraints** | Confirmed status values (6), confirmed data fields, confirmed BR1-BR3 for validation design |
| **T-004: Workflow Views** | Confirmed 6 views with filter criteria |
| **T-005: Approval Guardrails** | Confirmed BR1-BR3 rules and constraint that guardrails stay within Airtable config (no backend code) |
| **T-006: Middleware Handoff Contract Stub** | Confirmed Approved Handoff view fields; confirmed references-only rule |

---

## Risks / Ambiguities

| ID | Risk/Ambiguity | Impact | Mitigation |
|:---|:---|:---|:---|
| RA-01 | Airtable native validation is weak — no true field-level required-on-status-change enforcement | BR1/BR2/BR3 may need automation-based guard or Interface form workaround | T-005 will evaluate and document approach |
| RA-02 | Channel Accounts table scope unclear — is it a full reference table or minimal stub? | Affects BR2 check and T-006 handoff | Decision: minimal stub in US-001 with `channel_account_id`, `platform`, `display_name`, `status`; full OAuth/token in US-011 |
| RA-03 | `Campaigns.status` values not defined in backlog | Inconsistency if different agents assume different values | Recommendation: `Draft`, `Active`, `Paused`, `Completed` — to be confirmed in T-002 |
| RA-04 | Q-005 open: Who has Manager/Admin role in approval workflow? | Affects BR1-BR3 guardrail design in T-005 | Needs Product Owner answer before T-005 |
| RA-05 | `asset_links` field type ambiguous — single URL, multi-URL, or attachment? | Affects schema design in T-002/T-003 | Recommendation: Multi-line text or Multi-select URL list; not Airtable Attachment (to avoid storage cost concerns at scale) |

---

## Handoff Notes for T-002 Airtable Data Model

### Confirmed Tables

1. **Campaigns** — primary table for campaign management
2. **Posts** — primary table for post content and workflow, linked to Campaigns
3. **Channel Accounts** (optional stub) — reference table for connected platform accounts

### Confirmed Fields

**Campaigns:**
`campaign_id` (autonumber/formula), `name`, `objective`, `start_date`, `end_date`, `owner`, `status`, `Notion Brief URL` (optional URL field)

**Posts:**
`post_id` (autonumber/formula), `campaign_id` (linked record → Campaigns), `title`, `master_copy` (long text), `cta_url`, `asset_links`, `target_channels` (multi-select: Facebook, future platforms), `scheduled_at` (date-time), `status` (single select: Draft/Review/Approved/Scheduled/Published/Failed), `reviewer`, `approved_at` (date-time)

**Channel Accounts (stub):**
`channel_account_id`, `platform` (single select: Facebook), `display_name`, `status` (single select: Connected/Disconnected/Expired)

### Confirmed Views

| View | Type | Filter/Config |
|:---|:---|:---|
| Campaign Overview | Grid | All campaigns |
| Post Pipeline | Grid or Kanban | Group by `status` |
| Needs Review | Grid | `status = Review` |
| Approved Handoff | Grid | `status = Approved` |
| Calendar | Calendar | Date field = `scheduled_at` |
| Failed Posts | Grid | `status = Failed` |

### Design Constraints for T-002

- No token field in any table.
- No large payload field (e.g., full AI output) — that goes to Ledger.
- `Notion Brief URL` is a plain URL, no API integration.
- Channel Accounts stub has no `token` or `secret_ref` field.
- Airtable record IDs are the primary identifiers for handoff; do not create custom UUID fields unless needed for idempotency (which is a Ledger concern, not Airtable).

### What T-002 Must NOT Do

- Do not add webhook configuration — that's T-006/US-002.
- Do not add Airtable Automations — that's T-005 (guardrails) or T-006 (handoff).
- Do not create AI-related fields (variant, policy result) — that's US-003/US-004.
- Do not store any publish result or external post ID — that's the Ledger (US-010).
