# Airtable Schema Spec

## Base: MediaOps Control Plane

Airtable is the MVP Control Plane for campaign and post workflow management. It is not a queue, audit ledger, token store, or high-volume inbox.

This schema is aligned with `docs/plans/US-001/US-001-final-implementation-notes.md`.

## Table: Campaigns

| Field | Airtable Type | Required | Notes |
|:---|:---|:---|:---|
| `Autonumber` | Autonumber | Yes | Helper field for stable campaign id. |
| `campaign_id` | Formula, primary field | Yes | `"CMP-" & {Autonumber}`. |
| `name` | Single line text | Yes | Campaign name. |
| `objective` | Long text | No | Goal/KPI and planning notes. |
| `start_date` | Date | No | Use consistent GMT/UTC handling. |
| `end_date` | Date | No | Use consistent GMT/UTC handling. |
| `owner` | Collaborator | No | SMM/owner. |
| `status` | Single select | Yes | `Draft`, `Active`, `Paused`, `Completed`. |
| `notion_brief_url` | URL | No | Link to Campaign Brief page in Notion. |
| `posts` | Linked records to Posts | No | One campaign can link many posts. |

## Table: Posts

| Field | Airtable Type | Required | Notes |
|:---|:---|:---|:---|
| `Autonumber` | Autonumber | Yes | Helper field for stable post id. |
| `post_id` | Formula, primary field | Yes | `"PST-" & {Autonumber}`. |
| `campaign_id` | Linked record to Campaigns | Yes | One post belongs to one campaign. |
| `title` | Single line text | Yes | Internal post title. |
| `master_copy` | Long text | Yes | Plain text mode; rich text disabled. |
| `cta_url` | URL | No | CTA URL, preferably with UTM. |
| `asset_links` | Long text | No | Plain text URLs separated by newlines. |
| `target_channels` | Multiple select | Yes | `Facebook` for MVP; later options may be added. |
| `connected_channel_accounts` | Linked records to Channel Accounts | Conditional | Required when `target_channels` contains Facebook. |
| `scheduled_at` | Date & time | Yes | GMT/UTC locked, 24-hour clock. |
| `status` | Single select | Yes | Exactly: `Draft`, `Review`, `Approved`, `Scheduled`, `Published`, `Failed`. |
| `reviewer` | Collaborator | No | Kept during invalid approval reversion for operational trace. |
| `approved_at` | Date & time | No | Read-only/user-protected; populated by automation on valid approval. |
| `is_master_copy_present` | Formula | Yes | Helper boolean for approval validation. |
| `has_connected_channel_accounts` | Formula/Rollup-derived formula | Yes | Helper boolean for linked account validation. |
| `is_scheduled_in_future` | Formula | Yes | Helper boolean based on `scheduled_at` and `NOW()`. |
| `is_valid_for_approval` | Formula | Yes | Returns `1` only when all approval checks pass. |
| `approval_blockers` | Formula | Yes | Human-readable blockers for SMM/Manager. |

### Required Validation Formula: `is_valid_for_approval`

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

### Required Validation Formula: `approval_blockers`

```text
TRIM(
  IF(NOT({is_master_copy_present}), "[Blocker] Master copy is empty; ", "") &
  IF(NOT({has_connected_channel_accounts}), "[Blocker] Missing active connected account stub; ", "") &
  IF(NOT({is_scheduled_in_future}), "[Blocker] scheduled_at must be in the future; ", "")
)
```

## Table: Channel Accounts

| Field | Airtable Type | Required | Notes |
|:---|:---|:---|:---|
| `platform` | Single select | Yes | `Facebook` for MVP. |
| `display_name` | Single line text | Yes | Human-readable account/page name. |
| `channel_account_id` | Formula, primary field | Yes | `{platform} & ": " & {display_name}`. |
| `status` | Single select | Yes | `Connected`, `Disconnected`, `Expired`. |
| `posts` | Linked records to Posts | No | Many-to-many link back to Posts. |

Channel Accounts are display stubs only. They must not contain tokens, app secrets, vault URIs, or raw credential material.

## Required Views

| View | Table | Type | Filter / Sort | Purpose |
|:---|:---|:---|:---|:---|
| `Campaign Overview` | Campaigns | Grid | Sort `start_date` descending | Campaign index and Notion brief links. |
| `Post Pipeline` | Posts | Kanban | Group by `status` | Human workflow board. |
| `Needs Review` | Posts | Grid | `status = Review`, sort `scheduled_at` ascending | SMM/Manager review queue. |
| `Approved Handoff` | Posts | Grid | `status = Approved` AND `is_valid_for_approval = 1`, sort `scheduled_at` ascending | Clean middleware handoff lane. |
| `Invalid Approved / Approval Blocked` | Posts | Grid | `status = Approved` AND `is_valid_for_approval = 0`, sort `scheduled_at` ascending | Exception lane for invalid manual approvals. |
| `Publishing Calendar` | Posts | Calendar | Calendar field `scheduled_at`; status in `Review`, `Approved`, `Scheduled`, `Published`, `Failed` | Active publishing schedule. |
| `Draft Planning Calendar` | Posts | Calendar | `status = Draft` AND `scheduled_at` is not empty | Tentative planning only. |
| `Failed Posts` | Posts | Grid | `status = Failed`, sort `scheduled_at` descending | Recovery queue. |
| `Connected Accounts` | Channel Accounts | Grid | Sort `channel_account_id` ascending | Stub health list. |

## Required Automations

### GR-01 / GR-04 / GR-05 / GR-06: Revert Invalid Approvals

- Trigger: `Posts.status = Approved` AND `Posts.is_valid_for_approval = 0`.
- Actions:
  - update `status` back to `Review`;
  - keep `reviewer`;
  - clear `approved_at` if it was stamped during the invalid attempt;
  - show or send a sanitized notification using `approval_blockers`.

### GR-02: Timestamp Valid Approvals

- Trigger: `Posts.status = Approved` AND `Posts.is_valid_for_approval = 1` AND `approved_at` is empty.
- Action: set `approved_at` to trigger execution time.

### GR-03: Needs Review Triage

- Trigger: `Posts.status = Review` AND `Posts.is_valid_for_approval = 0`.
- Action: allow the record to remain in Review and expose `approval_blockers`.

## Webhook Boundary

US-001 does not implement webhook receiver code. It exposes the clean handoff lane that US-002 will consume.

The downstream event must be minimal:

```json
{
  "event_id": "evt-example",
  "record_id": "rec-example",
  "table_name": "Posts",
  "change_type": "update",
  "approved_at": "2026-05-21T00:00:00.000Z"
}
```

US-002 must reload and reverify the Airtable record before side effects.

## Security Rules

- No raw tokens or secrets in Airtable.
- No queue state or audit ledger in Airtable.
- No `approved_version` field in Airtable; production versioning is Postgres-managed in US-002.
- No publish job creation from US-001.
- Airtable status values must remain exactly as specified for US-001.
