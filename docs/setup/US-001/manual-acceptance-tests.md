# US-001 Manual Acceptance Tests

Run these checks after building the Airtable and Notion setup.

## Test 1: Valid Approval

Steps:

1. Create a Campaign.
2. Create a Channel Account stub with `platform = Facebook`, `status = Connected`.
3. Create a Post with:
   - non-empty `master_copy`;
   - `target_channels = Facebook`;
   - linked `connected_channel_accounts`;
   - future `scheduled_at`;
   - `status = Review`.
4. Change `status` to `Approved`.

Expected:

- `is_valid_for_approval = 1`.
- `approved_at` is stamped.
- Record appears in `Approved Handoff`.
- Record does not appear in `Invalid Approved / Approval Blocked`.

## Test 2: Missing Master Copy

Steps:

1. Create a Post with empty `master_copy`.
2. Fill the other approval fields.
3. Change `status` to `Approved`.

Expected:

- `is_valid_for_approval = 0`.
- Automation returns `status` to `Review`.
- `approval_blockers` contains `[Blocker] Master copy is empty`.
- Record does not remain in `Approved Handoff`.

## Test 3: Missing Channel Account

Steps:

1. Create a Post with `target_channels = Facebook`.
2. Leave `connected_channel_accounts` empty.
3. Change `status` to `Approved`.

Expected:

- Automation returns `status` to `Review`.
- `approval_blockers` contains missing connected account blocker.
- Record does not remain in `Approved Handoff`.

## Test 4: Past Schedule

Steps:

1. Create a Post with valid copy/channel fields.
2. Set `scheduled_at` in the past.
3. Change `status` to `Approved`.

Expected:

- `is_scheduled_in_future = 0`.
- `is_valid_for_approval = 0`.
- Automation returns `status` to `Review` or excludes the record from `Approved Handoff`.

## Test 5: Draft Planning Calendar

Steps:

1. Create a Draft Post with future `scheduled_at`.

Expected:

- Record appears in `Draft Planning Calendar`.
- Record does not appear in `Publishing Calendar`.

## Test 6: Failed Recovery

Steps:

1. Set a Post to `Failed`.
2. Attempt to move it directly to `Approved`.

Expected:

- Record is forced back to `Review`.
- Record does not appear in `Approved Handoff` until revalidated.

## Test 7: Notion Link

Steps:

1. Create a Notion Campaign Brief from `Campaign Brief Template`.
2. Copy the page URL.
3. Paste it into `Campaigns.notion_brief_url`.

Expected:

- Airtable campaign links to the Notion brief.
- The Notion page contains no secrets, API keys, tokens, passwords, or vault refs.

