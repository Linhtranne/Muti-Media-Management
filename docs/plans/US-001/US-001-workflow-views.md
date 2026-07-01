# US-001 Workflow Views

**Date:** 2026-05-20  
**Task:** T-004: Workflow Views  
**User Story:** US-001 - Airtable Base Campaign/Post Workflow  
**Status:** Completed  
**Author:** Operations Designer Agent  

---

## 1. Docs Read

The design of the workflow views is fully aligned with the requirements and constraints documented across the project's codebase. The following 11 documents were read and analyzed in order:

| Priority | Document | Key Architectural & Logical Constraints Extracted |
|:---|:---|:---|
| **P0** | [PLAN-us-001-airtable-base.md](file:///d:/Muti-Media%20Management/docs/plans/PLAN-us-001-airtable-base.md) | Extracted the T-004 scope, dependencies on T-003 fields, and downstream handoff relationships. |
| **P0** | [US-001-field-types-and-constraints.md](file:///d:/Muti-Media%20Management/docs/plans/US-001-field-types-and-constraints.md) | Locked physical field names (e.g., `is_valid_for_approval`, `approval_blockers`, `connected_active_platforms`, `scheduled_at`, `master_copy`). |
| **P0** | [US-001-airtable-data-model.md](file:///d:/Muti-Media%20Management/docs/plans/US-001-airtable-data-model.md) | Mapped relationships between Campaigns, Posts, and the Channel Accounts reference stub. |
| **P0** | [US-001-scope-lock.md](file:///d:/Muti-Media%20Management/docs/plans/US-001-scope-lock.md) | Locked the exact list of views, post statuses, and out-of-scope system integrations. |
| **P0** | [06_Architecture_Composability.md](file:///d:/Muti-Media%20Management/docs/architecture/06_Architecture_Composability.md) | Confirmed Airtable operates purely as the Control Plane; no token storage, queue state, or direct publish execution. |
| **P0** | [11_Coding_Convention.md](file:///d:/Muti-Media%20Management/docs/architecture/11_Coding_Convention.md) | Section 5 constraints: zero raw token storage in Airtable; handoff must utilize immutable references only. |
| **P1** | [04_Product_Backlog.md](file:///d:/Muti-Media%20Management/docs/requirements/04_Product_Backlog.md) | Reviewed Epic E01 US-001 Acceptance Criteria (AC1-AC4) and Business Rules (BR1-BR3). |
| **P1** | [05_Function_Flow_Logic_Register.md](file:///d:/Muti-Media%20Management/docs/requirements/05_Function_Flow_Logic_Register.md) | Analyzed FL-001 (US-002 webhook) and confirmed that Record ID acts as the sole idempotency anchor. |
| **P2** | [07_Risk_Assumption_Decision_Log.md](file:///d:/Muti-Media%20Management/docs/project-mgmt/07_Risk_Assumption_Decision_Log.md) | Extracted security boundaries regarding token leakage (R-005) and operational MVP parameters (D-002). |
| **P2** | [12_Notion_Workspace_Spec.md](file:///d:/Muti-Media%20Management/docs/architecture/12_Notion_Workspace_Spec.md) | Ensured Notion campaign briefs are referenced strictly via URL lookup fields in Airtable. |
| **P2** | [03_SRS_MediaOps_Composability.md](file:///d:/Muti-Media%20Management/docs/requirements/03_SRS_MediaOps_Composability.md) | Reviewed Non-Functional Requirements (NFR) ensuring minimal operational footprint in Airtable. |

---

## 2. Design Summary

The T-004 view design establishes a robust, highly visual, and bulletproof user interface system within Airtable, specifically tuned for human collaboration while implementing tight safety gates for automated middleware. The core design principles are:

1. **Clean Lane vs. Exception Lane**: 
   - **Clean Lane (`Approved Handoff`)**: Exposes only posts that are perfectly valid (`status = Approved` AND `is_valid_for_approval = 1`). This is the only view accessible to the middleware, ensuring that invalid posts are never sent for automated processing.
   - **Exception Lane (`Invalid Approved / Approval Blocked`)**: Surfaces posts where the status was manually forced to `Approved` but fails validation rules (`is_valid_for_approval = 0`). This ensures that broken records are immediately visible to Social Media Managers (SMMs) and are never silently stuck.
2. **Publishing vs. Draft Calendars**:
   - **`Publishing Calendar`**: Excludes Draft posts, showing only operational and publishing-committed items (`Review`, `Approved`, `Scheduled`, `Published`, `Failed`). This provides SMMs and Managers with a clear view of ready and live schedules.
   - **`Draft Planning Calendar`**: Displays planning-only Draft posts that have a tentative date. It acts purely as a planning sandbox for Creators, with a strict note that no middleware, automation, or publishing job is triggered.
3. **Failed Recovery Path**:
   - A dedicated **`Failed Posts`** exception queue is defined. It supports human recovery by documenting a strict sequential path: `Failed` -> `Review` -> `Approved` after correction. Detailed error payloads and retries are kept out of Airtable, remaining in the Postgres ledger and MCP servers.
4. **Token-Free Channel Accounts Stub**:
   - The Channel Accounts view surfaces active platforms and connections for referencing, keeping all secrets, access keys, and OAuth details securely server-side.

---

## 3. View Inventory

The Airtable base contains the following views across the three tables:

| Table Name | View Name | View Type | Primary Filter Criteria | Sorting & Grouping | Key Visible Fields | Owner / Audience | Purpose |
|:---|:---|:---|:---|:---|:---|:---|:---|
| **Campaigns** | Campaign Overview | Grid | None | `start_date` Descending | `campaign_id`, `name`, `status`, `start_date`, `end_date`, `owner`, `notion_brief_url`, `posts` | SMM / Manager | List and manage campaign-level metadata and Notion brief links. |
| **Posts** | Post Pipeline | Kanban | None | Group by `status` | `post_id`, `title`, `campaign_id`, `target_channels`, `scheduled_at`, `reviewer`, `is_valid_for_approval` | Creator / SMM | Visual workflow pipeline for tracking posts from drafting to publishing. |
| **Posts** | Needs Review | Grid | `status = Review` | `scheduled_at` Ascending | `post_id`, `title`, `campaign_id`, `master_copy`, `target_channels`, `scheduled_at`, `reviewer`, `approval_blockers` | SMM / Manager | Triage queue for SMM/Manager to review copy and details. |
| **Posts** | Approved Handoff | Grid | `status = Approved` AND `is_valid_for_approval = 1` | `scheduled_at` Ascending | `post_id`, `campaign_id`, `title`, `master_copy`, `cta_url`, `asset_links`, `target_channels`, `connected_channel_accounts`, `scheduled_at`, `approved_at` | Middleware (US-002) | The **Clean Lane** for middleware to query and trigger publishing workflows. |
| **Posts** | Invalid Approved / Approval Blocked | Grid | `status = Approved` AND `is_valid_for_approval = 0` | `scheduled_at` Ascending | `post_id`, `title`, `campaign_id`, `master_copy`, `target_channels`, `connected_channel_accounts`, `scheduled_at`, `reviewer`, `approval_blockers`, `is_valid_for_approval` | SMM / Manager | The **Exception Lane** surfacing manual approvals that violate constraints. Prevents stuck posts. |
| **Posts** | Publishing Calendar | Calendar | `status` is any of `Review`, `Approved`, `Scheduled`, `Published`, `Failed` | N/A (Calendar View) | Calendar field: `scheduled_at`. Label: `post_id` + `title` + `status` | SMM / Manager | Operational calendar representing real publishing schedules. Excludes Drafts. |
| **Posts** | Draft Planning Calendar | Calendar | `status = Draft` AND `scheduled_at` is not empty | N/A (Calendar View) | Calendar field: `scheduled_at`. Label: `post_id` + `title` | Creator / SMM | Planning sandbox for draft scheduling. No automated publish commitment. |
| **Posts** | Failed Posts | Grid | `status = Failed` | `scheduled_at` Descending | `post_id`, `title`, `campaign_id`, `target_channels`, `connected_channel_accounts`, `scheduled_at`, `reviewer`, `approval_blockers`, `is_valid_for_approval` | SMM / Manager | Operational queue to review published failures and guide manual corrections. |
| **Channel Accounts** | Connected Accounts | Grid | None | `channel_account_id` Ascending | `channel_account_id`, `platform`, `display_name`, `status` | Admin / SMM | Reference stub list of active connections. Absolutely no secrets. |

---

## 4. Required View Specifications

### A. Campaign Overview (Campaigns Table)
* **Type:** Grid View
* **Configuration:** Shows all records in the Campaigns table.
* **Fields Shown:**
  1. `campaign_id` (Primary field)
  2. `name`
  3. `status`
  4. `start_date`
  5. `end_date`
  6. `owner`
  7. `notion_brief_url`
  8. `posts`
* **Sorting:** Sorted by `start_date` descending.
* **Operational Value:** Provides an administrative index of all active and planned campaigns. SMMs can open any campaign card to inspect associated posts.

### B. Post Pipeline (Posts Table)
* **Type:** Kanban View
* **Grouping:** Grouped by `status` (columns: `Draft`, `Review`, `Approved`, `Scheduled`, `Published`, `Failed`).
* **Fields Shown on Cards:**
  1. `post_id` (Primary field)
  2. `title`
  3. `campaign_id`
  4. `target_channels`
  5. `scheduled_at`
  6. `reviewer`
  7. `is_valid_for_approval` (Visual check indicator)
* **Operational Value:** Excellent visual overview of post status. Allows creators to easily see their drafting queue, SMMs to see review queues, and managers to monitor live pipelines.

### C. Needs Review (Posts Table)
* **Type:** Grid View
* **Filter:** `status = Review`
* **Fields Shown:**
  1. `post_id` (Primary field)
  2. `title`
  3. `campaign_id`
  4. `master_copy`
  5. `target_channels`
  6. `connected_channel_accounts`
  7. `scheduled_at`
  8. `reviewer`
  9. `approval_blockers`
  10. `is_valid_for_approval`
* **Sorting:** Sorted by `scheduled_at` ascending (prioritizes closest deadlines).
* **Operational Value:** The SMM triage queue. The reviewer inspects the `master_copy`, ensures channels match selected connected accounts, checks the `approval_blockers` field, and coordinates adjustments.

### D. Approved Handoff (Posts Table - The Clean Lane)
* **Type:** Grid View
* **Filters:**
  - `status = Approved`
  - `is_valid_for_approval = 1`
* **Fields Shown:**
  1. `Airtable Record ID` (System level)
  2. `post_id` (Primary field)
  3. `campaign_id`
  4. `title`
  5. `master_copy`
  6. `cta_url`
  7. `asset_links`
  8. `target_channels`
  9. `connected_channel_accounts`
  10. `scheduled_at`
  11. `approved_at`
* **Sorting:** Sorted by `scheduled_at` ascending.
* **Operational Value:** This is the clean handoff interface designed specifically for the middleware API. Filtering for `is_valid_for_approval = 1` guarantees that any post with incomplete copy, missing active channel stubs, or past scheduled dates is filtered out, ensuring zero invalid workflow executions.

### E. Invalid Approved / Approval Blocked (Posts Table - The Exception Lane)
* **Type:** Grid View
* **Filters:**
  - `status = Approved`
  - `is_valid_for_approval = 0`
* **Fields Shown:**
  1. `post_id` (Primary field)
  2. `title`
  3. `campaign_id`
  4. `master_copy`
  5. `target_channels`
  6. `connected_channel_accounts`
  7. `scheduled_at`
  8. `reviewer`
  9. `approval_blockers`
  10. `is_valid_for_approval`
* **Sorting:** Sorted by `scheduled_at` ascending.
* **Operational Value:** Resolves **Edge Case 1**. It surfaces posts that were manually changed to `Approved` but fail business rules. Instead of disappearing from review lists and getting stuck silently, these posts immediately appear here. SMMs and Managers can easily spot them, read the `approval_blockers` warning text, and fix them.

### F. Publishing Calendar (Posts Table)
* **Type:** Calendar View
* **Date Mapping Field:** `scheduled_at`
* **Filters:**
  - `status` is any of `Review`, `Approved`, `Scheduled`, `Published`, `Failed`
* **Operational Value:** Resolves **Edge Case 2**. This is the operational calendar that satisfies US-001 AC4. It strictly excludes Drafts. Managers and SMMs use this view to inspect what is committed to go live or under official review. No planned draft drafts will clutter this schedule, preventing any confusion.

### G. Draft Planning Calendar (Posts Table)
* **Type:** Calendar View
* **Date Mapping Field:** `scheduled_at`
* **Filters:**
  - `status = Draft`
  - `scheduled_at is not empty`
* **Operational Value:** Resolves **Edge Case 2**. Creator-centric planning sandbox. It treats `scheduled_at` on Draft posts as a tentative planning date rather than a publish commitment. It carries NO middleware handoff, NO publish readiness guarantees, and NO automation triggers.

### H. Failed Posts (Posts Table - Exception Recovery Queue)
* **Type:** Grid View
* **Filters:**
  - `status = Failed`
* **Fields Shown:**
  1. `post_id` (Primary field)
  2. `title`
  3. `campaign_id`
  4. `target_channels`
  5. `connected_channel_accounts`
  6. `scheduled_at`
  7. `reviewer`
  8. `approval_blockers`
  9. `is_valid_for_approval`
* **Sorting:** Sorted by `scheduled_at` descending.
* **Operational Value:** Resolves **Edge Case 3**. This is an operational review queue where failures are highlighted for SMMs and Managers to investigate. SMMs inspect failures, make corrections directly in Airtable, and move the status back to `Review` to trigger the human re-approval path.

---

## 5. Field Visibility and Accessibility Matrix

To maintain high data integrity and prevent user errors, we establish the following field permissions and visibility rules on the Airtable Base/Interface:

| Field Name | Content Creator Role | Social Media Manager (SMM) | Operations Manager | Middleware / API | Read/Write Rule |
|:---|:---|:---|:---|:---|:---|
| `post_id` | Visible | Visible | Visible | Visible | Read-only (Formula) |
| `campaign_id` | Editable | Editable | Editable | Visible | Read/Write for users |
| `title` | Editable | Editable | Editable | Visible | Read/Write for users |
| `master_copy` | Editable | Editable | Editable | Visible | Read/Write for users (Plain) |
| `cta_url` | Editable | Editable | Editable | Visible | Read/Write for users |
| `asset_links` | Editable | Editable | Editable | Visible | Read/Write for users (URLs) |
| `target_channels` | Editable | Editable | Editable | Visible | Read/Write for users |
| `connected_channel_accounts`| Editable | Editable | Editable | Visible | Read/Write for users |
| `scheduled_at` | Editable | Editable | Editable | Visible | Read/Write for users |
| `status` | Editable (Draft/Review) | Editable | Editable | Editable (Scheduled/Failed/Published)| User status changes restricted |
| `reviewer` | Read-only | Editable | Editable | Read-only | SMM/Manager assignment |
| `approved_at` | Read-only | Read-only | Read-only | Editable (via API/Automation) | Automated timestamp |
| `is_valid_for_approval`| Visible | Visible | Visible | Visible | Read-only (Formula) |
| `approval_blockers` | Visible | Visible | Visible | Hidden | Read-only (Formula) |

---

## 6. Approved Handoff Safety Notes

1. **The Core Guardrail**: The view `Approved Handoff` only exposes posts matching the exact logical filter:
   ```text
   status = Approved AND is_valid_for_approval = 1
   ```
2. **Exclusion of Invalid Records**: If a Manager manually sets a post's status to `Approved` but the post does not meet the basic validation criteria (e.g. `master_copy` is missing, or the selected channels have no active connected accounts stubs, or the schedule date is in the past), `is_valid_for_approval` immediately computes to `0`. 
3. **Silent Stuck Avoidance**: Because it computes to `0`, the record is automatically excluded from the `Approved Handoff` view. Crucially, it is immediately routed to the `Invalid Approved / Approval Blocked` view. This exception lane serves as an operational dashboard for SMMs and Managers, eliminating silent stuck records.

---

## 7. Calendar Configuration Details

1. **Date Source**: Both the `Publishing Calendar` and `Draft Planning Calendar` utilize the exact `scheduled_at` date-time field as their date mapping. 
2. **GMT/UTC Locking**: In compliance with the T-003 constraint, both calendars render times strictly within the locked **GMT/UTC** timezone. This ensures that the visual block on the calendar corresponds exactly to the ISO 8601 UTC timestamp fetched by the queue workers, preventing local offset mismatches.
3. **Status Isolation**: 
   - Exclusions are maintained natively by Airtable filters. Drafts do not mix into the publishing calendar, which prevents stakeholders from mistaking tentative content drafts for committed, scheduled media.

---

## 8. Operational Usage and Recovery Notes

### A. Operational Workflows
* **Content Creators**: Write and schedule posts in the pipeline. Creators utilize the `Draft Planning Calendar` to slot tentative copy. Once complete, they change the post status to `Review`.
* **Social Media Managers (SMMs)**: Triage the `Needs Review` grid, check the `approval_blockers` field, verify correct channel account linkage, assign a `reviewer` (Manager), and perform final copy adjustments.
* **Managers**: Move the status of valid reviewed posts to `Approved`.
* **Support / Operations Team**: Monitor the `Failed Posts` exception queue.

### B. Human Recovery Workflow for Failed Posts (Edge Case 3)
If a post is marked as `Failed` (due to API token expiry, network errors, or temporary service crashes):
1. **Manual Inspection**: The SMM or Manager navigates to the `Failed Posts` grid.
2. **Airtable Constraints**: Airtable implements **NO direct retry logic**, **NO Graph API error handling**, and **NO automation triggers** on the `Failed` state. Detailed error stacks and API payloads are kept out of Airtable, residing in the Postgres ledger and MCP logs.
3. **Status Reversion**: If corrections are required (e.g., text edits or linking a different active channel account), the SMM or Manager moves the status from `Failed` back to `Review`.
4. **Re-Approval**: The reviewer inspects the updated post in `Needs Review` and, once valid, moves it back to `Approved`. This places the record back into `Approved Handoff`.
5. **No direct Failed -> Approved**: Direct transition from `Failed` to `Approved` is prohibited if `is_valid_for_approval = 0`.

---

## 9. Handoff Notes for T-005 Approval Guardrails

Task T-005 (Approval Guardrails) must design the automated reinforcement mechanisms based on the views defined here:

1. **Invalid Approval Guardrail**: T-005 must implement an Airtable Automation or Interface rule triggered when a post's status is changed to `Approved` while `is_valid_for_approval = 0`.
   - **Requirement:** T-005 should immediately revert the status back to `Review` and alert the user (via Airtable-native notification/admin-visible Ledger note) with the contents of the `approval_blockers` field.
2. **Failed -> Approved Block**: T-005 should ensure that if a user attempts to transition a post directly from `Failed` to `Approved` (bypassing the `Review` status), the transition is blocked or reverted if `is_valid_for_approval = 0`.
3. **No Code / No Scripts**: All guardrails designed in T-005 must be achieved using native Airtable configurations (Interface forms, conditional rules, or native Airtable Automations), strictly keeping logic out of external codebases.

---

## 10. Handoff Notes for T-006 Middleware Contract

Task T-006 (Middleware Contract Stub) must establish the integration interface based on these views:

1. **View Bound**: The middleware must consume and query **ONLY** the `Approved Handoff` view. No other grid, kanban, or calendar view is exposed to the API.
2. **Record ID Anchor**: The middleware must use the immutable system-level **Airtable Record ID** (e.g., `recXXXXX`) as the unique reference and idempotency key for ledger and job transactions.
3. **Handoff Fields**: The contract must ingest only standard fields: `record_id`, `post_id`, `campaign_id`, `status`, `approved_at`, `scheduled_at`, `target_channels`, and reference links. No credentials or large raw payloads are transmitted.
4. **Re-approval Event Processing**: Future middleware must treat a re-approved post (a post that moved from `Failed` -> `Review` -> `Approved`) as a brand-new approved workflow. Ledger idempotency rules will recognize the new `approved_at` timestamp or update the existing ledger state based on the Airtable Record ID, preventing duplicate publishes.

---

## 11. Out-of-Scope Confirmations

To prevent scope creep, the following components are officially out of scope for T-004:
* **No Webhook Setup:** No webhook URLs or receiver configurations are implemented in this view design task (belongs to T-006 / US-002).
* **No Code Execution:** No TypeScript, Node.js, or Airtable Script Block code was written (belongs to US-002+).
* **No Token Storage:** No API tokens, keys, secrets, or OAuth credentials are configured or referenced in these views.
* **No Native Retries:** Airtable contains no retry button, automatic retry automation, or integration with external queue managers.

---

## 12. Risks / Open Questions

| ID | Operational Risk | Impact | View-level Mitigation |
|:---|:---|:---|:---|
| **OR-01** | User changes a post directly from `Failed` to `Approved` without fixing the underlying issues. | The record would re-enter the middleware lane even if it is still invalid, causing another publishing failure. | The `Approved Handoff` filter acts as a hard filter. If the record remains invalid, `is_valid_for_approval` stays `0`, excluding the record from the handoff view and routing it to the `Invalid Approved / Approval Blocked` exception view. T-005 will reinforce this with automated reverts. |
| **OR-02** | User schedules a draft post on `Draft Planning Calendar` and assumes it is scheduled to publish. | Misalignment of expectations and missed publishing deadlines. | The `Draft Planning Calendar` will be clearly labeled as a Creator planning sandbox. It strictly filters for `Draft` status only. The operational `Publishing Calendar` strictly excludes Drafts. |
| **OR-03** | Local timezone confusion by global team members when reading the calendars. | Publishing time confusion. | All date/time fields have been locked to **GMT/UTC** at the database level (T-003). Both calendar configurations will have timezone labels reminding users that times are locked to UTC, matching middleware schedules. |
