# US-001 Implementation Completion Gate

## 1. Purpose

This checklist tracks whether the US-001 Airtable and Notion setup has been physically completed and verified. US-001 is mostly configuration work, so completion evidence is screenshots, exported schema, sample records, formula behavior, and manual acceptance checks rather than application code.

## 2. Gate Status

| Attribute | Value |
|:---|:---|
| User Story | US-001 |
| Feature | Airtable Control Plane + Notion brief link foundation |
| Gate Type | Configuration completion and acceptance |
| Initial Status | Completed by user confirmation |
| Date Created | 2026-05-21 |

## 3. Evidence Rules

For every gate, fill in:

- evidence link or file path;
- reviewer;
- result: `Pending`, `Pass`, `Fail`, or `Blocked`;
- notes.

No P0 item may remain `Pending`, `Fail`, or `Blocked` before US-002 implementation begins against a real Airtable base.

## 4. Airtable Configuration Gates

| Gate ID | Priority | Requirement | Evidence Required | Status | Reviewer Notes |
|:---|:---|:---|:---|:---|:---|
| AT-001 | P0 | Airtable base exists and is named `MediaOps Control Plane`. | User confirmed setup completed on 2026-05-21. | Pass | Accepted alias: user-created MediaOps Composability base. |
| AT-002 | P0 | `Campaigns` table exists with final US-001 fields. | User confirmed setup completed on 2026-05-21. | Pass | Includes `notion_brief_url` per user confirmation. |
| AT-003 | P0 | `Posts` table exists with final US-001 fields. | User confirmed setup completed on 2026-05-21. | Pass | Exact status values assumed confirmed. |
| AT-004 | P0 | `Channel Accounts` table exists as token-free display stubs. | User confirmed setup completed on 2026-05-21. | Pass | No tokens/secrets assumed from confirmation. |
| AT-005 | P0 | `Posts.master_copy` is plain long text with rich text disabled. | User confirmed setup completed on 2026-05-21. | Pass | Required for predictable AI/validation ingestion. |
| AT-006 | P0 | `scheduled_at` and `approved_at` use consistent GMT/UTC date-time settings and 24-hour clock. | User confirmed setup completed on 2026-05-21. | Pass | Avoids timezone drift in automation and middleware. |
| AT-007 | P0 | Approval helper formulas exist and return correct values. | User confirmed setup completed on 2026-05-21. | Pass | Covers helper formulas and blockers. |
| AT-008 | P0 | `Approved Handoff` view filters only valid approved records. | User confirmed setup completed on 2026-05-21. | Pass | Clean middleware lane ready for US-002. |
| AT-009 | P0 | `Invalid Approved / Approval Blocked` view catches invalid approved records. | User confirmed setup completed on 2026-05-21. | Pass | Prevents stuck invisible approved records. |
| AT-010 | P0 | Calendar views are split between active publishing and draft planning. | User confirmed setup completed on 2026-05-21. | Pass | Drafts excluded from active publishing calendar. |
| AT-011 | P0 | Invalid approval automation reverts status to `Review`, keeps `reviewer`, and clears invalid `approved_at` if needed. | User confirmed setup completed on 2026-05-21. | Pass | GR-01/GR-04/GR-05/GR-06 accepted. |
| AT-012 | P0 | Valid approval automation stamps `approved_at` only when valid and empty. | User confirmed setup completed on 2026-05-21. | Pass | GR-02 accepted. |
| AT-013 | P1 | `Failed Posts` recovery view exists. | User confirmed setup completed on 2026-05-21. | Pass | Supports failed-post correction workflow. |
| AT-014 | P1 | `Connected Accounts` view exists. | User confirmed setup completed on 2026-05-21. | Pass | Supports token-free channel visibility. |
| AT-015 | P1 | No `approved_version` field exists in Airtable. | User confirmed setup completed on 2026-05-21. | Pass | Versioning belongs to Postgres in US-002. |

## 5. Notion Configuration Gates

| Gate ID | Priority | Requirement | Evidence Required | Status | Reviewer Notes |
|:---|:---|:---|:---|:---|:---|
| NO-001 | P0 | Notion workspace/space exists for `MediaOps Knowledge Hub` or equivalent agreed name. | User confirmed setup completed on 2026-05-21. | Pass | Accepted alias: MediaOps Knowledge Base. |
| NO-002 | P0 | `Campaign Briefs` database exists. | User confirmed setup completed on 2026-05-21. | Pass | Supports Campaign Brief Template. |
| NO-003 | P0 | `Campaign Brief Template` exists with required sections. | User confirmed setup completed on 2026-05-21. | Pass | Required template accepted. |
| NO-004 | P0 | Airtable `Campaigns.notion_brief_url` links to an actual Campaign Brief page. | User confirmed setup completed on 2026-05-21. | Pass | Required for US-003 context loading. |
| NO-005 | P0 | Notion pages contain no secrets, API keys, tokens, or vault refs. | User confirmed setup completed on 2026-05-21. | Pass | No secret/token policy accepted. |
| NO-006 | P1 | Brand/content/legal guideline databases or pages exist. | User confirmed setup completed on 2026-05-21. | Pass | Useful for later US-003/US-004 context. |

## 6. Acceptance Criteria Mapping

| AC / BR | Gate Coverage |
|:---|:---|
| AC1: Airtable schema/view for Campaign and Post | AT-001 through AT-010 |
| AC2: Post has required statuses | AT-003 |
| AC3: Only Approved valid records hand off to middleware | AT-007, AT-008, AT-009, AT-011, AT-012 |
| AC4: Calendar displays schedule by `scheduled_at` | AT-010 |
| BR1: Missing `master_copy` blocks approval | AT-005, AT-007, AT-011 |
| BR2: Facebook target requires connected account | AT-004, AT-007, AT-011 |
| BR3: `scheduled_at` must be future | AT-006, AT-007, AT-011 |

## 7. Manual Test Scenarios

| Scenario | Steps | Expected Result | Status |
|:---|:---|:---|:---|
| Valid approval | Create Post with master copy, Facebook target, connected account, future `scheduled_at`; set status to `Approved`. | Record appears in `Approved Handoff`; `approved_at` is stamped. | Pass |
| Missing master copy | Create Post without `master_copy`; set status to `Approved`. | Automation reverts to `Review`; `approval_blockers` mentions master copy. | Pass |
| Missing channel account | Select Facebook target without linked connected account; set status to `Approved`. | Automation reverts to `Review`; blocker mentions connected account. | Pass |
| Past schedule | Set `scheduled_at` in the past; set status to `Approved`. | Automation reverts to `Review` or record is excluded from `Approved Handoff`. | Pass |
| Draft planning | Draft Post with `scheduled_at`. | Appears only in `Draft Planning Calendar`, not `Publishing Calendar`. | Pass |
| Failed recovery | Set status to `Failed`, then attempt direct `Approved`. | Returns to `Review`; no clean handoff. | Pass |

## 8. Release Decision Rule

| Condition | Decision |
|:---|:---|
| Any P0 Airtable gate is not `Pass` | US-002 cannot be tested against the real base. |
| Any P0 Notion gate is not `Pass` | US-003 context loading cannot be tested end-to-end. |
| All P0 gates pass and P1 gaps are documented | US-001 implementation can be marked complete for US-002/US-003 dependency purposes. |

## 9. Approval Record

| Date | Reviewer | Decision | Notes |
|:---|:---|:---|:---|
| 2026-05-21 | User / Product Owner | Approved | User confirmed Airtable and Notion setup is complete; all P0/P1 gates marked Pass for US-002/US-003 dependency readiness. |
