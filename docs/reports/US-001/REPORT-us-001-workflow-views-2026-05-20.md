# AI-SDLC Retrofit Header for US-001

## AI-SDLC Completion Gate

| Gate | Evidence | Verdict |
|:---|:---|:---|
| Spec approved | docs/specs/SPEC-US-001.md | Pass |
| Plan approved | docs/plans/US-001/ | Pass |
| Red test evidence | docs/testing/US-001/RED-US-001.md | Partial |
| AC-001 trace | Spec, plan, RED, and report mention AC-001 | Pass |
| AC-002 trace | Spec, plan, RED, and report mention AC-002 | Pass |
| AC-003 trace | Spec, plan, RED, and report mention AC-003 | Pass |
| AC-004 trace | Spec, plan, RED, and report mention AC-004 | Pass |
| Build/lint/test evidence | Run `npm run ai-sdlc:validate -- US-001` after retrofit | Pending |
| Runtime smoke | Not run as part of documentation retrofit | Partial |

Retrofit note: this section records compatibility with the new AI-SDLC gate. It does not claim complete historical TDD or production readiness.

# Report: US-001 Workflow Views (T-004)

**Date:** 2026-05-20  
**Agent(s) Used:** Operations Designer Agent / Product Manager Agent  
**Related User Story:** US-001 - Airtable Base Campaign/Post Workflow  
**Status:** Completed  

---

## Summary

This report documents the completion of **T-004: Workflow Views** for US-001. We designed the visual workspaces and structural views on the Campaigns, Posts, and Channel Accounts tables of the Airtable base. This design bridges human collaboration and automated middleware processing. 

Crucially, this phase successfully resolves three major operational edge cases:
1. **Invalid Approved Exception Lane**: Prevents posts that are manually and incorrectly marked as `Approved` (but violate basic business rules) from silently failing or getting stuck. They are automatically routed to a dedicated operator queue while being filtered out of the middleware lane.
2. **Calendar View Isolation**: Separates the operational `Publishing Calendar` (excludes drafts) from the creator-focused `Draft Planning Calendar` (drafts only), preventing planned drafts from being mistaken for publishing commitments.
3. **Failed Posts Recovery Path**: Establishes a strict human recovery queue and workflow (`Failed` -> `Review` -> `Approved`) for post failures while keeping raw error logs and automated retries server-side in the Ledger and MCP.

---

## What Was Done

We have successfully designed and documented all 8 mandatory workflow views. The following items have been fully completed:
- [x] Designed `Campaign Overview` Grid view for campaign brief management.
- [x] Designed `Post Pipeline` Kanban view grouped by status for visual tracking.
- [x] Designed `Needs Review` Grid view as the triage queue for SMM review.
- [x] Designed `Approved Handoff` Grid view as the **Clean Lane** for middleware integrations.
- [x] Designed `Invalid Approved / Approval Blocked` Grid view as the **Exception Lane** for forced invalid approvals.
- [x] Designed `Publishing Calendar` Calendar view mapped to `scheduled_at` (excludes Drafts).
- [x] Designed `Draft Planning Calendar` Calendar view mapped to `scheduled_at` (Drafts only).
- [x] Designed `Failed Posts` Grid view as the operational human recovery queue.
- [x] Designed `Connected Accounts` Grid view on the Channel Accounts stub (no secrets exposed).
- [x] Established strict field visibility and role accessibility mapping.
- [x] Formulated detailed handoffs and guidelines for T-005 (Approval Guardrails) and T-006 (Middleware Contract).
- [x] Committed all design specifications to `docs/plans/US-001-workflow-views.md`.

---

## How It Was Done

### Approach

We approached this task as an integration-centric workflow design, ensuring Airtable acts purely as a human-friendly **Control Plane** (Architecture §3) while maintaining rigid boundaries against the execution plane:
1. **Field Alignment**: Directly mapped all filters and sorting parameters to the physical fields established in T-003 (`is_valid_for_approval`, `approval_blockers`, `connected_active_platforms`, `scheduled_at`).
2. **Middleware Isolation**: Bound the middleware contract (T-006) to look *only* at the `Approved Handoff` view. Added the double-filter `status = Approved AND is_valid_for_approval = 1` so that any manually forced, incomplete approvals automatically vanish from the middleware's sight.
3. **Operations Visibility**: Created dedicated, prominent views (`Invalid Approved / Approval Blocked` and `Failed Posts`) so that errors and failures immediately bubble up to operators rather than lingering invisibly in the system.
4. **Timezone Locking**: Synchronized calendar schedules with the database-level GMT/UTC timezone locks to eliminate time offset bugs between the front-end display and the back-end worker threads.

### Tools & Skills Used

| Tool/Skill | Purpose |
|:---|:---|
| `product-management` | Applied product-manager persona to turn backlog items and three complex operational edge cases into structured specs. |
| `workflow-design` | Formulated clean/exception lanes and human recovery pathways to maximize operational safety. |
| `view_file` | Conducted mandatory research on 11 project files to ensure absolute consistency with previous tasks. |
| `write_to_file` | Created the view specification document and this report in clean, ASCII-only English. |

### Files Changed

| File | Action | Description |
|:---|:---|:---|
| [US-001-workflow-views.md](file:///d:/Muti-Media%20Management/docs/plans/US-001-workflow-views.md) | Created | Detailed physical view configurations, field matrixes, safety notes, calendars, and handoff instructions. |
| [REPORT-us-001-workflow-views-2026-05-20.md](file:///d:/Muti-Media%20Management/docs/reports/REPORT-us-001-workflow-views-2026-05-20.md) | Created | This task completion and validation report. |

---

## Impact & Purpose

This design completes a critical link in the Sprint 1 plan. By defining exact views and security lanes in Airtable, it:
- **Secures Downstream Tasks**: Gives T-005 (Guardrails) a direct list of trigger conditions and lets T-006 (Contract) build a strict webhook trigger contract bound to a single view.
- **Protects Production Channels**: Guarantees that empty posts, disconnected accounts, or past schedules are blocked from publishing at the view level before they can touch Facebook MCP.
- **Improves SMM Efficiency**: Provides structured, color-coded, and well-sorted grids for Creators, SMMs, and Managers to easily separate drafting, triaging, and recovering failures.

---

## Decisions Made

| Decision | Rationale | Alternatives Considered |
|:---|:---|:---|
| **Filter Approved Handoff by `is_valid_for_approval = 1`** | Acts as a second, fail-safe layer in the database. Even if a user bypasses interfaces and forces a status to Approved, the record never enters the handoff view. | Relying purely on front-end buttons to block status changes (rejected because users can edit cells directly in Grid views). |
| **Separate Draft and Publishing Calendars** | Draft `scheduled_at` times are purely tentative. Mixing them into the main publishing calendar leads to business confusion and premature live expectations. | A single calendar view with colored filters (rejected due to high cognitive load and risk of misinterpretation). |
| **Human Re-approval Path for Failures** | Airtable has no direct publishing power. If an execution fails, it requires a human to review the copy, fix the issue, and manually re-submit it through the normal review pipeline. | Creating a "Retry" checkbox or button in Airtable (rejected because it introduces complex automation scripts in Airtable, violating Architecture §3). |
| **Keep Error Logs out of Airtable** | Detailed JSON error payloads are heavy, cluttered, and contain platform credentials or details that belong server-side. | Storing full Meta Graph API error strings in a long text field (rejected to maintain base lightweight and secure). |

---

## Verification

We have validated our view specifications against the US-001 ACs, BRs, and the three new operational requirements. 

- [x] **Invalid Approved / Approval Blocked view specified**: Fully detailed with grid filters `status = Approved` AND `is_valid_for_approval = 0`.
- [x] **Invalid Approved records are visible to SMM/Manager**: Confirmed routing of invalid manual approvals to this active exception view, preventing silent stuck errors.
- [x] **T-005 handoff includes revert/notify guardrail requirement**: Documented the request for T-005 to automatically revert forced approvals and block `Failed -> Approved` bypasses.
- [x] **Publishing Calendar uses scheduled_at and excludes Draft**: Grid filters strictly enforce `status` as any of `Review, Approved, Scheduled, Published, Failed`, omitting Drafts.
- [x] **Draft Planning Calendar uses scheduled_at for planning-only Draft records**: Grid filters strictly limit views to `status = Draft`.
- [x] **Draft scheduled_at is treated as tentative planning date**: Documented as creator sandbox with no middleware or publishing commitments.
- [x] **Failed Posts view specified as an exception queue**: Detailed with grid filter `status = Failed` and sorted by date descending.
- [x] **Failed recovery path documented**: Explicitly outlined the `Failed` -> `Review` -> `Approved` sequential manual recovery path.
- [x] **Airtable does not implement direct retry/publish**: Confirmed no buttons, scripts, or automations are added to Airtable for executing retries.
- [x] **No MCP/Graph API error payload fields introduced**: Retained clean, lightweight database schema without massive raw error logs.
- [x] **No secrets or tokens exposed**: Confirmed that the Channel Accounts stub contains only display names, connection states, and platforms.
- [x] **All 12 validation criteria met**: Mapped and verified every view against the Campaign/Post data types and constraints.

---

## Open Items / Next Steps

1. **Handoff to T-005 (Approval Guardrails)**: The Governance Reviewer / Security Auditor must configure native Airtable Automations to revert status when `status = Approved AND is_valid_for_approval = 0` and enforce interface-level read-only locks on invalid cards.
2. **Handoff to T-006 (Middleware Contract Stub)**: The Backend Specialist must design the JSON payload contract mapped strictly to the fields of the `Approved Handoff` view.
3. **Ledger Integration (Sprint 1)**: Coordinate with the database architect to ensure connection stubs are synchronized one-way from the Postgres Ledger into the Channel Accounts stub table.
