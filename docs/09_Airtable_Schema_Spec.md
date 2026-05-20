# Airtable Schema Spec

## Base: MediaOps Control Plane

### Table: Campaigns

| Field | Type | Required | Notes |
| :--- | :--- | :--- | :--- |
| Campaign ID | Formula/Text | Yes | Stable external id |
| Name | Single line text | Yes | Campaign name |
| Objective | Long text | No | Goal/KPI |
| Owner | Collaborator | Yes | SMM owner |
| Start Date | Date | No | Campaign start |
| End Date | Date | No | Campaign end |
| Status | Single select | Yes | Draft, Active, Paused, Completed |
| Auto Publish Enabled | Checkbox | Yes | Default false |
| Auto Approve Enabled | Checkbox | Yes | Manager/Admin only |

### Table: Posts

| Field | Type | Required | Notes |
| :--- | :--- | :--- | :--- |
| Post ID | Formula/Text | Yes | Stable external id |
| Campaign | Linked record | Yes | Link to Campaigns |
| Title | Single line text | Yes | Internal title |
| Master Copy | Long text | Yes | Source content |
| CTA URL | URL | No | Prefer UTM |
| Asset Links | Attachment/URL | No | MVP can use URL |
| Target Channels | Multi select | Yes | Facebook MVP |
| Scheduled At | Date time | Yes | Publish time |
| Status | Single select | Yes | Draft, Review, Approved, Needs Review, Queued, Published, Failed |
| Reviewer | Collaborator | No | Approver |
| Approved At | Date time | No | Set when approved |
| Last Error | Long text | No | Human readable failure |

### Table: Variants

| Field | Type | Required | Notes |
| :--- | :--- | :--- | :--- |
| Variant ID | Formula/Text | Yes | Stable external id |
| Post | Linked record | Yes | Link to Posts |
| Platform | Single select | Yes | Facebook |
| Body | Long text | Yes | Generated/edited content |
| Hashtags | Long text | No | One per line or comma separated |
| CTA URL | URL | No | Variant-specific |
| Approval Status | Single select | Yes | Draft, Review, Approved, Rejected |
| Policy Status | Single select | No | Passed, Warning, Blocked |
| Policy Summary | Long text | No | Blockers/warnings |

### Table: Channel Accounts

| Field | Type | Required | Notes |
| :--- | :--- | :--- | :--- |
| Channel Account ID | Formula/Text | Yes | Stable external id |
| Platform | Single select | Yes | Facebook |
| Display Name | Single line text | Yes | Page name |
| External Account ID | Single line text | Yes | Facebook Page ID |
| Token Status | Single select | Yes | Missing, Valid, Expired, Permission Error |
| Connected By | Collaborator | No | Admin |
| Connected At | Date time | No | OAuth success time |

### Table: Alerts

| Field | Type | Required | Notes |
| :--- | :--- | :--- | :--- |
| Alert ID | Formula/Text | Yes | Stable external id |
| Type | Single select | Yes | Publish Failed, Risk Comment, Legal Review, Token Issue |
| Related Post | Linked record | No | Link to Posts |
| Severity | Single select | Yes | Low, Medium, High, Critical |
| Message | Long text | Yes | Human-readable alert |
| Status | Single select | Yes | New, Acknowledged, Resolved |
| Slack TS | Text | No | Slack message timestamp |

## Views

- Campaign Roadmap: filtered active campaigns.
- Post Calendar: calendar on `Scheduled At`.
- Review Queue: Posts where `Status = Review`.
- Approved Queue: Posts where `Status = Approved`.
- Failed/Needs Review: Posts where `Status in Failed, Needs Review`.
- Channel Health: Channel Accounts grouped by Token Status.
- Alerts Board: Alerts grouped by Severity/Status.

## Automation Trigger

Primary trigger:

- When `Posts.Status` changes to `Approved`, send webhook to Orchestration Middleware.

Guardrail:

- Middleware must reload Airtable record and verify status before processing.
