# Test Case and Bug Report Templates

## Test Case Template

| Field | Description |
| :--- | :--- |
| Test Case ID | TC-xxx |
| Related Story | US-xxx |
| Module | Feature/module name |
| Preconditions | Required setup/data |
| Test Steps | Step-by-step actions |
| Test Data | Input data |
| Expected Result | Expected behavior |
| Actual Result | Filled during execution |
| Status | Pass/Fail/Blocked |
| Tester | Name |
| Execution Date | Date |

## Example Test Case

| Field | Description |
| :--- | :--- |
| Test Case ID | TC-001 |
| Related Story | US-002 |
| Module | Airtable Webhook Handler |
| Preconditions | Post exists with Status Draft |
| Test Steps | Change Post Status to Approved; wait for webhook; check Ledger |
| Test Data | Post ID `post_001` |
| Expected Result | Webhook event stored, AI workflow created once |
| Actual Result | TBD |
| Status | TBD |
| Tester | TBD |
| Execution Date | TBD |

## Bug Report Template

| Field | Description |
| :--- | :--- |
| Bug ID | BUG-xxx |
| Related Story/Test Case | US-xxx / TC-xxx |
| Title | Short bug title |
| Severity | Critical/High/Medium/Low |
| Priority | P0/P1/P2/P3 |
| Environment | Local/Staging/Production |
| Steps to Reproduce | Numbered steps |
| Expected Result | Expected behavior |
| Actual Result | Actual behavior |
| Evidence | Screenshot/log/link |
| Root Cause | Filled by Dev |
| Fix Summary | Filled by Dev |
| Retest Result | Pass/Fail |

## Severity Guide

- Critical: token leak, unauthorized publish, data loss, system unavailable.
- High: publish blocked incorrectly, duplicate publish, Slack command permission bypass.
- Medium: wrong status, missing alert, retry issue.
- Low: typo, non-blocking UI/documentation issue.
