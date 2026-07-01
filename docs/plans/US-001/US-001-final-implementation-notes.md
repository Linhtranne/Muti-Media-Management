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

# US-001 Final Implementation Notes

## 1. Docs Read

This final implementation specification integrates the context and constraints of the following 14 project files, analyzed in chronological order of development:

1. **P0** | docs/architecture/06_Architecture_Composability.md
   - Established that Airtable operates strictly as an administrative Control Plane. Banned tokens, queues, and audits from physical Airtable fields.
2. **P0** | docs/architecture/11_Coding_Convention.md
   - Extracted rules regarding references-only queue payloads and mandatory credential masking in all system logs.
3. **P2** | docs/requirements/03_SRS_MediaOps_Composability.md
   - Aligned with performance NFRs (handling Airtable rate limits via exponential backoff) and security boundaries.
4. **P1** | docs/requirements/04_Product_Backlog.md
   - Extracted acceptance criteria (AC1 to AC4) and core business rules (BR1 to BR3) for User Story US-001.
5. **P1** | docs/requirements/05_Function_Flow_Logic_Register.md
   - Aligned with function specifications FL-001 (Webhook Reload) and FL-008 (RabbitMQ publishing).
6. **P2** | docs/project-mgmt/07_Risk_Assumption_Decision_Log.md
   - Reviewed active project risks, particularly rate limit exhaustion and administrator-renamed channel account stubs.
7. **P0** | docs/plans/PLAN-us-001-airtable-base.md
   - Aligned with the original work-breakdown structure and task ownership mapping for T-002 through T-008.
8. **P0** | docs/plans/US-001-scope-lock.md
   - Frozen scope boundaries, ensuring all automation and queue code remains downstream of the Airtable base setup.
9. **P0** | docs/plans/US-001-airtable-data-model.md
   - Maintained structural database configurations for Campaigns, Posts, and Channel Accounts.
10. **P0** | docs/plans/US-001-field-types-and-constraints.md
    - Aligned with exact snake_case fields and mathematical formula definitions.
11. **P0** | docs/plans/US-001-workflow-views.md
    - Standardized view configurations, clean lanes, and administrative dashboard filtering.
12. **P0** | docs/plans/US-001-approval-guardrails.md
    - Mapped out the native Airtable status reversion automations (GR-01 to GR-06).
13. **P0** | docs/plans/US-001-middleware-handoff-contract.md
    - Updated to reflect unified ACK/NACK mechanics and Postgres-managed approved_version boundaries.
14. **P0** | docs/plans/US-001-qa-acceptance-pass.md
    - Processed the QA checklist results and implemented corrections for the three identified defects (DF-001 to DF-003).

---

## 2. QA Result

**Verdict:** Go with Corrections  
- The core database schemas, validation formulas, dashboard views, and automation guardrails were verified as 100% functional and compliant during the T-007 QA Manual Acceptance Checks.
- Three defects (DF-001: Status Stub header, DF-002: ACK/NACK conflict for unresolved accounts, and DF-003: Postgres-managed approved_version boundary) have been fully resolved in the final integration specifications.
- Wording fixes have been applied to keep AI workflow and Slack notifications strictly out of the US-001 boundary, routing alerts instead to the admin-visible Ledger and downstream stubs.
- The project is cleared to transition to US-002.

---

## 3. Final Scope Summary

### In-Scope Boundaries:
- Schema layout of the "MediaOps Control Plane" Airtable base (Campaigns, Posts, and Channel Accounts stubs).
- Field specifications using standardized snake_case naming conventions and physical data types.
- Pure database validation formulas (is_valid_for_approval and approval_blockers) evaluating post completeness.
- Workflow views separating clean, validated approvals from invalid or blocked records.
- Native Airtable automation rules (GR-01 to GR-06) enforcing post-approval edit protection.
- The conceptual handoff metadata contract defining reload parameters.

### Out-of-Scope Boundaries:
- Physical creation of TypeScript webhook endpoints or server routers.
- Direct integration or routing to RabbitMQ exchanges and message brokers.
- Setup of secure server-side Postgres databases, tables, or credentials storage.
- Provisioning or storing active Facebook/Instagram API access tokens.
- Slack notifications or AI processing nodes (all belong downstream of US-001).

---

## 4. Airtable Tables Summary

The Airtable Control Plane is structured into three specialized tables as designed in T-002:

1. **Campaigns:**
   - Purpose: Tracks the high-level marketing campaigns.
   - Relationships: One-to-Many (1:N) link to the `Posts` table.
2. **Posts:**
   - Purpose: The core operational table tracking copy, scheduled time, assets, status, and validation flags.
   - Relationships: Many-to-One (N:1) link to `Campaigns`, and Many-to-Many (N:M) link to `Channel Accounts`.
3. **Channel Accounts:**
   - Purpose: Reference display stubs representing destination accounts (e.g., "Facebook: MediaOps Page").
   - Relationships: Many-to-Many (M:N) link to `Posts` via the connected_channel_accounts join.

---

## 5. Field / Constraint Summary

### Core Fields in `Campaigns` Table:
- `Autonumber` (Autonumber, helper field).
- `campaign_id` (Formula, Primary Field): `"CMP-" & {Autonumber}`.
- `name` (Single Line Text, Required): The name of the campaign.
- `objective` (Long Text): High-level description of objectives.
- `start_date` (Date, GMT timezone locked).
- `end_date` (Date, GMT timezone locked).
- `owner` (User/Collaborator).
- `status` (Single Select): Draft, Active, Paused, Completed.
- `notion_brief_url` (URL): Notion briefing URL.
- `posts` (Link to Posts, 1:N).

### Core Fields in `Posts` Table:
- `Autonumber` (Autonumber, helper field).
- `post_id` (Formula, Primary Field): `"PST-" & {Autonumber}`.
- `campaign_id` (Link to Campaigns, N:1).
- `title` (Single Line Text, Required): Internal descriptive title.
- `master_copy` (Long Text, plain text, **rich text formatting disabled**): Core post content.
- `cta_url` (URL): Call-to-action link.
- `asset_links` (Long Text, plain text URLs): Media asset links separated by newlines.
- `target_channels` (Multiple Select): Facebook (and proposed LinkedIn, Twitter/X, YouTube, Zalo).
- `connected_channel_accounts` (Link to Channel Accounts, M:N).
- `scheduled_at` (Date-Time, GMT timezone locked, 24h clock).
- `status` (Single Select): Draft, Review, Approved, Scheduled, Published, Failed (exactly these 6 values).
- `reviewer` (User/Collaborator).
- `approved_at` (Date-Time, GMT timezone locked, 24h clock).

### Core Fields in `Channel Accounts` Table:
- `platform` (Single Select): Facebook (and proposed LinkedIn, Twitter/X, YouTube, Zalo).
- `display_name` (Single Line Text): Human readable channel name.
- `channel_account_id` (Formula, Primary Field): `{platform} & ": " & {display_name}`.
- `status` (Single Select): Connected, Disconnected, Expired.
- `posts` (Link to Posts, M:N).

### Validation Formulas in `Posts`:
- **`is_valid_for_approval` (Formula, returns 1 or 0):**
  ```text
  IF(
    AND(
      {is_master_copy_present},
      {has_connected_channel_accounts},
      {is_scheduled_in_future}
    ),
    1,
    0
  )
  ```
- **`approval_blockers` (Formula):**
  ```text
  TRIM(
    IF(NOT({is_master_copy_present}), "[Blocker] Master copy is empty; ", "") & 
    IF(NOT({has_connected_channel_accounts}), "[Blocker] Missing active connected account stub; ", "") & 
    IF(NOT({is_scheduled_in_future}), "[Blocker] scheduled_at must be in the future; ", "")
  )
  ```

---

## 6. Workflow Views Summary

Airtable organizes records into 9 functional views as defined in T-004 to separate human workflows from automation lanes:

1. **Campaign Overview (Campaigns Table):**
   - Type: Grid View
   - Filter: None
   - Sorting: Sorted by `start_date` Descending
   - Purpose: High-level campaign index with Notion brief URL links.
2. **Post Pipeline (Posts Table):**
   - Type: Kanban View
   - Filter: None
   - Grouping: Grouped by `status` (Draft, Review, Approved, Scheduled, Published, Failed)
   - Purpose: Creator and SMM visual tracking pipeline.
3. **Needs Review (Posts Table):**
   - Type: Grid View
   - Filter: `status = Review`
   - Sorting: Sorted by `scheduled_at` Ascending
   - Purpose: Primary triage queue for SMMs and Managers to inspect and adjust.
4. **Approved Handoff (Posts Table - The Clean Lane):**
   - Type: Grid View
   - Filter: `status = Approved` AND `is_valid_for_approval = 1`
   - Sorting: Sorted by `scheduled_at` Ascending
   - Purpose: The strictly validated handoff lane queried by the downstream middleware webhook.
5. **Invalid Approved / Approval Blocked (Posts Table - The Exception Lane):**
   - Type: Grid View
   - Filter: `status = Approved` AND `is_valid_for_approval = 0`
   - Sorting: Sorted by `scheduled_at` Ascending
   - Purpose: Isolates posts manually forced to "Approved" that violate validation constraints.
6. **Publishing Calendar (Posts Table):**
   - Type: Calendar View (using `scheduled_at`)
   - Filter: `status` is any of `Review`, `Approved`, `Scheduled`, `Published`, `Failed`
   - Purpose: Visualizes active scheduled and live publishing commitments, excluding Drafts.
7. **Draft Planning Calendar (Posts Table):**
   - Type: Calendar View (using `scheduled_at`)
   - Filter: `status = Draft` AND `scheduled_at` is not empty
   - Purpose: Tentative sandbox planning view for Creators. No queue processing is triggered.
8. **Failed Posts (Posts Table - Exception Recovery Queue):**
   - Type: Grid View
   - Filter: `status = Failed`
   - Sorting: Sorted by `scheduled_at` Descending
   - Purpose: Highlights failed posts for SMMs to inspect, adjust, and route back to `Review`.
9. **Connected Accounts (Channel Accounts Table):**
   - Type: Grid View
   - Filter: None
   - Sorting: Sorted by `channel_account_id` Ascending
   - Purpose: Lists connection stubs (completely secret/token-free).

---

## 7. Approval Guardrails Summary

To enforce data integrity and protect active publishing pipelines from unauthorized edits, six native Airtable automations (GR-01 to GR-06) are configured as designed in T-005:

- **GR-01 (Invalid Approved Lockout):** 
  - Trigger: `status` is set to `Approved` AND `is_valid_for_approval = 0`.
  - Reversion: Reverts `status` back to `Review`, routes to the `Invalid Approved` exception lane, and alerts the reviewer with `approval_blockers` content.
  - **Reviewer Handling:** The `reviewer` field is **NOT** cleared during the reversion to preserve the operational audit trace of who reviewed or attempted the approval, helping the SMM identify who should resolve the validation blockers.
  - **Timestamp Handling:** If the read-only `approved_at` field was populated during the invalid approval attempt, it is cleared.
- **GR-02 (Approved Timestamping):** 
  - Trigger: `status` matches `Approved` AND `is_valid_for_approval = 1` (valid approval).
  - Action: Stamp trigger execution time into the read-only `approved_at` field (only if empty).
- **GR-03 (Needs Review Triaging):** 
  - Trigger: `status` changes to `Review` AND `is_valid_for_approval = 0`.
  - Action: Allow the transition but compute and highlight warning messages in `approval_blockers` (red text).
- **GR-04 (Failed Recovery Enforcement):** 
  - Trigger: `status` changes directly from `Failed` to `Approved`.
  - Reversion: Reverts `status` back to `Review` (under the conservative human-re-approval policy).
- **GR-05 (Connected Account Verification):** 
  - Trigger: `target_channels` has selection but linked stub in `connected_channel_accounts` is missing/inactive.
  - Reversion: Computed in `is_valid_for_approval`. If forced to `Approved`, GR-01 triggers and reverts to `Review`.
- **GR-06 (Time-Travel Prevention):** 
  - Trigger: `scheduled_at` is in the past AND status is `Review`/`Approved`/`Scheduled`.
  - Reversion: Evaluated continuously. If a record in the queue passes its scheduled time, `is_valid_for_approval` automatically turns `0`, ejecting it from the `Approved Handoff` view. If manually set to `Approved`, GR-01 reverts it to `Review`.

---

## 8. Middleware Handoff Summary

The integration boundary operates on a strict **Pull-and-Verify Model**:

### Webhook Event:
- Fired upon a post entering the `Approved Handoff` view.
- Payload is minimal:
  ```json
  {
    "event_id": "evt-72b83a-1a8c-4fbc-b82b-c8c3c1e2",
    "record_id": "rec9t7W2uP0YxL8e9",
    "table_name": "Posts",
    "change_type": "update",
    "approved_at": "2026-05-20T07:45:00.000Z"
  }
  ```

### Reload & Verify Logic:
1. Downstream worker consumes event from `airtable.webhook.approved` queue.
2. Worker calls Airtable API: `GET /v0/{base_id}/Posts/{record_id}`.
3. Worker evaluates the current status of the reloaded record:
   - **Approved:** Continues with revalidation steps.
   - **Scheduled / Published:** Already processed. Immediately classify as `already_advanced_ignored`, write a sanitized note to the Ledger, ACK the event, and stop processing (no duplicate jobs, no retry).
   - **Draft / Review / Failed:** Reverted or moved back before processing. Immediately classify as `state_changed_ignored`, write a sanitized note, ACK the event, and stop processing.
   - **Any Unknown Status:** Unrecognized or empty status value. Fail closed, classify as `unknown_status_ignored`, ACK the event, and stop processing.
4. If status is `Approved`, worker verifies that `is_valid_for_approval` is equal to `1`. If not, classify as `invalid_after_reload_ignored`, write validation blockers to the Ledger, ACK the event, and stop.
5. Worker verifies that the reloaded `approved_at` matches the event's timestamp. If not, classify as `approval_version_mismatch_ignored`, write mismatch details, ACK the event, and stop.
6. If all checks pass, cross-check that Page stubs in `connected_channel_accounts` are active (`Connected` status) and resolve their display names to secure Postgres Page credentials before enqueuing to MCP publishing stubs.

---

## 9. QA Acceptance Summary

US-001 fulfills 100% of the User Story backlog and business rule constraints:

- **AC1 (Schema & View Layout):** Satisfied by Campaigns, Posts, and Channel Accounts tables, linked record relations, physical snake_case fields, and views.
- **AC2 (Status Values):** Enforced by defining exactly 6 status values for Post status: `Draft`, `Review`, `Approved`, `Scheduled`, `Published`, and `Failed`.
- **AC3 (Eligibility & Handoff):** Ensures only records in `Approved` status (which satisfy `is_valid_for_approval = 1`) are exposed to the `Approved Handoff` view.
- **AC4 (Calendar Visualization):** Displays scheduled post commitments via a Calendar view mapped to the locked GMT/UTC `scheduled_at` times.
- **BR1 (Master Copy Constraint):** Checked mathematically inside the `is_valid_for_approval` formula.
- **BR2 (Channel Linking Constraint):** Evaluated by checking conditional rollup connection stubs within `is_valid_for_approval`.
- **BR3 (Future Schedule Lock):** Validated in GMT using the `IS_AFTER({scheduled_at}, NOW())` logic.

---

## 10. Corrections Applied from T-007

During the T-007 manual QA phase, three crucial design defects were caught and corrected:

1. **DF-001: Wording Correction (Draft/Review Status Values):**
   - Corrected `US-001-middleware-handoff-contract.md` to transition status validation strictly to `Review` (replacing any occurrences of `In Review`).
   - Clarified that the database schema strictly supports exactly 6 status values for Post: `Draft`, `Review`, `Approved`, `Scheduled`, `Published`, `Failed`. There is no `Completed` or `In Review` status in the Posts table.
2. **DF-002: ACK/NACK Queue Conflict & Revalidation Expansion:**
   - Clarified that stale, changed, or business-invalid events (`already_advanced_ignored`, `state_changed_ignored`, `unknown_status_ignored`, `approval_version_mismatch_ignored`, `invalid_after_reload_ignored`, `channel_account_missing`, `channel_account_inactive`) must be **ACKed** because they represent resolved or unrecoverable business states.
   - For `channel_account_unresolved` (Airtable stub cannot be resolved server-side): Fail closed, do not call MCP. If a DLQ is configured in US-002, issue a **NACK with `requeue=false`** to route the event to the DLQ. If no DLQ is configured, **ACK the event** and write an immediate ledger alert. DLQ infrastructure itself is documented as out-of-scope for US-001.
3. **DF-003: Postgres-Managed approved_version Boundary:**
   - Added a clear warning specifying that the temporary US-001 deduplication key `record_id + approved_at` is banned for production ledger usage (US-002+). 
   - The production ledger key must be `record_id + approved_version`, which is generated and maintained entirely server-side (Postgres Ledger) and **must not** be mapped or stored in the Airtable Base schema.

---

## 11. Implementation Checklist for Airtable Setup

To physically build or replicate the US-001 MediaOps base, execute these steps:

Completion evidence for these steps must be tracked in `docs/plans/US-001/US-001-implementation-completion-gate.md`.

Canonical setup artifacts are available in `docs/setup/US-001/`:

- `airtable-build-spec.json`
- `airtable-manual-runbook.md`
- `notion-campaign-brief-template.md`
- `manual-acceptance-tests.md`

### Step 1: Base Creation
1. Create a new Airtable base named **MediaOps Control Plane**.

### Step 2: Set up "Campaigns" Table
1. Name the table `Campaigns`.
2. Configure the following fields:
   - `Autonumber` (Autonumber field).
   - `campaign_id` (Formula, Primary Field) -> Type: `"CMP-" & {Autonumber}`.
   - `name` (Single Line Text).
   - `objective` (Long Text).
   - `start_date` (Date) -> GMT/UTC timezone locked.
   - `end_date` (Date) -> GMT/UTC timezone locked.
   - `owner` (User/Collaborator).
   - `status` (Single Select) -> options: `Draft`, `Active`, `Paused`, `Completed`.
   - `notion_brief_url` (URL).
   - `posts` (Link to Posts) -> Allow linking to multiple records (ON).

### Step 3: Set up "Channel Accounts" Table
1. Name the table `Channel Accounts`.
2. Configure the following fields:
   - `platform` (Single Select) -> options: `Facebook` (plus proposed LinkedIn, Twitter/X, YouTube, Zalo).
   - `display_name` (Single Line Text).
   - `channel_account_id` (Formula, Primary Field) -> Type: `{platform} & ": " & {display_name}`.
   - `status` (Single Select) -> options: `Connected`, `Disconnected`, `Expired`.
   - `posts` (Link to Posts) -> Allow linking to multiple records (ON).

### Step 4: Set up "Posts" Table
1. Name the table `Posts`.
2. Configure the following fields:
   - `Autonumber` (Autonumber field).
   - `post_id` (Formula, Primary Field) -> Type: `"PST-" & {Autonumber}`.
   - `campaign_id` (Link to Campaigns) -> Allow linking to multiple records (OFF).
   - `title` (Single Line Text).
   - `master_copy` (Long Text) -> **Rich text formatting disabled (Plain text mode)**.
   - `cta_url` (URL).
   - `asset_links` (Long Text) -> Plain text URLs separated by newlines.
   - `target_channels` (Multiple Select) -> options: `Facebook` (plus proposed LinkedIn, Twitter/X, YouTube, Zalo).
   - `connected_channel_accounts` (Link to Channel Accounts) -> Allow linking to multiple records (ON).
   - `scheduled_at` (Date & Time):
     - Toggle **ON** the "Use the same time zone (GMT) for all collaborators" option.
     - Select 24-hour clock formatting.
   - `status` (Single Select) -> options: `Draft`, `Review`, `Approved`, `Scheduled`, `Published`, `Failed`.
   - `reviewer` (User/Collaborator).
   - `approved_at` (Date & Time):
     - Toggle **ON** the "Use the same time zone (GMT) for all collaborators" option.
     - Set to Read-Only (populated by automation).
   - `is_valid_for_approval` (Formula):
     - Type: `IF(AND({is_master_copy_present}, {has_connected_channel_accounts}, {is_scheduled_in_future}), 1, 0)`
   - `approval_blockers` (Formula):
     - Type: `TRIM(IF(NOT({is_master_copy_present}), "[Blocker] Master copy is empty; ", "") & IF(NOT({has_connected_channel_accounts}), "[Blocker] Missing active connected account stub; ", "") & IF(NOT({is_scheduled_in_future}), "[Blocker] scheduled_at must be in the future; ", ""))`

### Step 5: Configure 9 Workflow Views
In the grid/view panels, construct exactly these nine views:
1. `Campaign Overview` (Campaigns table grid): Shows campaign fields. Sort by `start_date` Descending.
2. `Post Pipeline` (Posts table Kanban): Group by `status` (Draft, Review, Approved, Scheduled, Published, Failed).
3. `Needs Review` (Posts table grid): Filter `status = Review`. Sort by `scheduled_at` Ascending.
4. `Approved Handoff` (Posts table grid): Filter `status = Approved` AND `is_valid_for_approval = 1`. Sort by `scheduled_at` Ascending.
5. `Invalid Approved / Approval Blocked` (Posts table grid): Filter `status = Approved` AND `is_valid_for_approval = 0`. Sort by `scheduled_at` Ascending.
6. `Publishing Calendar` (Posts table Calendar mapped to `scheduled_at`): Filter `status` is any of `Review`, `Approved`, `Scheduled`, `Published`, `Failed`.
7. `Draft Planning Calendar` (Posts table Calendar mapped to `scheduled_at`): Filter `status = Draft` AND `scheduled_at` is not empty.
8. `Failed Posts` (Posts table grid): Filter `status = Failed`. Sort by `scheduled_at` Descending.
9. `Connected Accounts` (Channel Accounts table grid): Lists reference connection stubs.

### Step 6: Configure Automations (GR-01 to GR-06)
In the "Automations" panel, build exactly these two native rules:

1. **Automation 1: Revert Invalid Approvals (GR-01, GR-04, GR-05, GR-06)**
   - Trigger: When a record matches conditions in `Posts` table:
     - `status = Approved` AND `is_valid_for_approval = 0`
   - Actions:
     - **Update Record**: Set `status` to `Review` (not `Draft`!).
     - **Send Notification**: Log a system alert stating the `approval_blockers` reasons.

2. **Automation 2: Timestamp Valid Approvals (GR-02)**
   - Trigger: When a record matches conditions in `Posts` table:
     - `status = Approved` AND `is_valid_for_approval = 1` AND `approved_at is empty`
   - Actions:
     - **Update Record**: Set `approved_at` to the trigger execution time.

---

## 12. Security / Privacy Rules

To protect production platforms and maintain a secure architectural boundary:

- **Zero-Token Rule:** Airtable MUST never contain developer keys, API access tokens, App Secrets, or credentials.
- **Reference-Only Join:** The `connected_channel_accounts` table stores only unprivileged stub names ("Facebook: MediaOps Page"). Long-lived Page Access Tokens are stored securely in server-side databases (managed by US-011) and decrypted at runtime via Vault/Secret Storage.
- **Log Masking:** Webhook receivers and operational logs must sanitize all output. No raw tokens or internal database directory structures may be written to text logs.

---

## 13. Out-of-Scope Confirmations

The following boundaries are explicitly confirmed as out-of-scope to protect against scope creep:

- **No Active Webhook Receiver Code:** US-001 designs the payload schema but deploys no active routing servers (US-002 scope).
- **No RabbitMQ Broker Deployments:** Queue bindings and DLQ routing keys are strictly downstream components (US-002/US-014 scope).
- **No Database DDL Executions:** No physical PostgreSQL database instances or schema migrations are executed under US-001 (US-002/US-011 scope).
- **No Slack Integration or AI processing:** Custom AI composers or Slack bot builders are completely separate downstream blocks.

---

## 14. Next User Stories / Handoff

The design artifacts completed under US-001 handoff directly to downstream user stories:

1. **Handoff to US-002 (Webhook Ingestion and Queue Routing):**
   - The minimal webhook schema (Section 8) maps directly to the incoming listener payload.
   - The revalidation reload steps (Section 8) establish the verification algorithm for the US-002 worker logic.
   - The unified ACK/NACK exception table (Section 10) defines the queue acknowledgement statuses for RabbitMQ and ledger state transitions in PostgreSQL.
2. **Handoff to US-011 (Secure Credentials Isolation):**
   - The stubs in the `Channel Accounts` table are used as keys to fetch and decrypt the high-security Facebook Page Access Tokens from the local vault database at runtime, completely isolated from the Airtable control plane.

---

## 15. Implementation Completion Gate

US-001 is design-approved and implementation-complete for dependency readiness. The P0/P1 items in `US-001-implementation-completion-gate.md` were marked `Pass` on 2026-05-21 based on user confirmation that Airtable and Notion setup were completed.

Implementation consequence:

- US-002 may proceed against the real Airtable base.
- US-003 may proceed against the real Airtable/Notion control plane after US-002 creates workflow stubs.
