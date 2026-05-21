# US-001 Airtable Manual Runbook

## 1. Base

Create or confirm an Airtable base named `MediaOps Control Plane`.

`MediaOps Composability` is acceptable as an alias if this is the base you already created.

## 2. Tables

Create three separate tables:

1. `Campaigns`
2. `Posts`
3. `Channel Accounts`

Do not create a single combined table for Campaign/Post/Channel Account.

## 3. Campaigns

Create fields:

| Field | Type / Config |
|:---|:---|
| `Autonumber` | Autonumber |
| `campaign_id` | Formula primary field: `"CMP-" & {Autonumber}` |
| `name` | Single line text |
| `objective` | Long text |
| `start_date` | Date |
| `end_date` | Date |
| `owner` | Collaborator |
| `status` | Single select: `Draft`, `Active`, `Paused`, `Completed` |
| `notion_brief_url` | URL |
| `posts` | Link to `Posts`, allow multiple |

Create view:

- `Campaign Overview`: grid, sort by `start_date` descending.

## 4. Channel Accounts

Create fields:

| Field | Type / Config |
|:---|:---|
| `platform` | Single select: `Facebook` |
| `display_name` | Single line text |
| `channel_account_id` | Formula primary field: `{platform} & ": " & {display_name}` |
| `status` | Single select: `Connected`, `Disconnected`, `Expired` |
| `posts` | Link to `Posts`, allow multiple |

Create view:

- `Connected Accounts`: grid, sort by `channel_account_id` ascending.

Create at least one sample token-free stub:

| platform | display_name | status |
|:---|:---|:---|
| Facebook | MediaOps Test Page | Connected |

Do not store Facebook Page tokens, app secrets, API keys, or vault URIs.

## 5. Posts

Create fields:

| Field | Type / Config |
|:---|:---|
| `Autonumber` | Autonumber |
| `post_id` | Formula primary field: `"PST-" & {Autonumber}` |
| `campaign_id` | Link to `Campaigns`, single record only |
| `title` | Single line text |
| `master_copy` | Long text, rich text disabled |
| `cta_url` | URL |
| `asset_links` | Long text, URLs separated by newlines |
| `target_channels` | Multiple select: `Facebook` |
| `connected_channel_accounts` | Link to `Channel Accounts`, allow multiple |
| `scheduled_at` | Date-time, GMT/UTC, 24-hour clock |
| `status` | Single select: `Draft`, `Review`, `Approved`, `Scheduled`, `Published`, `Failed` |
| `reviewer` | Collaborator |
| `approved_at` | Date-time, GMT/UTC, 24-hour clock, automation-only by process |

Helper formulas:

```text
is_master_copy_present =
LEN(TRIM({master_copy} & "")) > 0
```

```text
has_connected_channel_accounts =
COUNTA({connected_channel_accounts}) > 0
```

```text
is_scheduled_in_future =
IF({scheduled_at}, IS_AFTER({scheduled_at}, NOW()), 0)
```

```text
is_valid_for_approval =
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

```text
approval_blockers =
TRIM(
  IF(NOT({is_master_copy_present}), "[Blocker] Master copy is empty; ", "") &
  IF(NOT({has_connected_channel_accounts}), "[Blocker] Missing active connected account stub; ", "") &
  IF(NOT({is_scheduled_in_future}), "[Blocker] scheduled_at must be in the future; ", "")
)
```

## 6. Posts Views

Create:

| View | Type | Config |
|:---|:---|:---|
| `Post Pipeline` | Kanban | Group by `status` |
| `Needs Review` | Grid | Filter `status = Review`; sort `scheduled_at` ascending |
| `Approved Handoff` | Grid | Filter `status = Approved` AND `is_valid_for_approval = 1`; sort `scheduled_at` ascending |
| `Invalid Approved / Approval Blocked` | Grid | Filter `status = Approved` AND `is_valid_for_approval = 0`; sort `scheduled_at` ascending |
| `Publishing Calendar` | Calendar | Date field `scheduled_at`; statuses `Review`, `Approved`, `Scheduled`, `Published`, `Failed` |
| `Draft Planning Calendar` | Calendar | Date field `scheduled_at`; filter `status = Draft` and `scheduled_at` not empty |
| `Failed Posts` | Grid | Filter `status = Failed`; sort `scheduled_at` descending |

## 7. Automations

### Revert Invalid Approvals

Trigger:

```text
Posts.status = Approved
AND Posts.is_valid_for_approval = 0
```

Actions:

1. Update same record: set `status = Review`.
2. Keep `reviewer` unchanged.
3. Clear `approved_at` if the invalid attempt stamped it.
4. Surface `approval_blockers` through visible field or notification.

### Timestamp Valid Approvals

Trigger:

```text
Posts.status = Approved
AND Posts.is_valid_for_approval = 1
AND approved_at is empty
```

Action:

1. Update same record: set `approved_at` to trigger execution time.

## 8. Required Samples

Create at least:

1. One valid campaign with `notion_brief_url`.
2. One connected Facebook channel account stub.
3. One valid post that can move to `Approved Handoff`.
4. One invalid post missing `master_copy`.
5. One invalid post missing `connected_channel_accounts`.
6. One draft post with future `scheduled_at`.

