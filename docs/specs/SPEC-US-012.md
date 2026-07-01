# SPEC-US-012: Basic Campaign Reporting

**Status:** Approved  
**Retrofit Note:** Retrospec — US-012 is a campaign reporting feature. No FL entry in Function Flow Logic Register — verified by `rg "US-012" docs/requirements/05_Function_Flow_Logic_Register.md` returning 0 results. Implementation status: Implemented.  
**FL Reference:** None (reporting/read-only query — no async workflow)  
**Backlog AC/BR:** US-012 AC1–AC4, BR1–BR3

---

## Goal

Allow CMO users to view a summary report of campaign execution (published/failed posts, comment/risk counts, average response time) filtered by campaign/date/channel, sourced exclusively from Ledger — not from Slack messages — and optionally exported as CSV or Airtable-synced view.

---

## Source References

- **Backlog:** `docs/requirements/04_Product_Backlog.md` — US-012
- **FL Reference:** No FL entry — confirmed by `rg` search. Reporting is a read-only query, not a workflow.
- **Data source:** `publish_jobs`, `interactions`, `messages`, `workflow_runs`, `audit_logs` tables in Ledger
- **API route:** `GET /api/v1/admin/reports/campaigns`
- **Route file:** `apps/orchestrator/src/routes/reports.ts`
- **Repository:** `apps/orchestrator/src/ledger/reportRepository.ts`

---

## In Scope

- Read-only API endpoint for campaign report data.
- Report fields per campaign row: `campaign_id`, `posts_published`, `publish_failed`, `comments_total`, `risk_comments`, `avg_response_time`, `last_updated_at`.
- Filter support: `campaign_id`, `date_from`, `date_to`, `channel_account_id`.
- Data sourced from Ledger only — not Slack messages, not raw Airtable webhook logs.
- CSV export option or Airtable-synced view.
- Failed jobs shown in report (per BR2 — CMO must see operational risk).
- Sensitive comment content NOT exposed in aggregate report (per BR3).

## Out of Scope

- Real-time analytics or streaming data.
- Per-comment content exposure in aggregate view.
- Admin dashboard UI (unless explicitly added to scope).
- Modifying publish or comment data through this endpoint.

---

## Functional Contract

**Endpoint (planned):** `GET /api/v1/admin/reports/campaigns`

**Query Parameters:**
| Param | Type | Description |
|:---|:---|:---|
| `campaign_id` | string (optional) | Filter by campaign |
| `date_from` | ISO 8601 (optional) | Filter by publish date range start |
| `date_to` | ISO 8601 (optional) | Filter by publish date range end |
| `channel_account_id` | string (optional) | Filter by channel |

**Report Row Data:**
```typescript
interface CampaignReportRow {
  campaign_id: string;
  posts_published: number;   // FROM publish_jobs WHERE status='published'
  publish_failed: number;    // FROM publish_jobs WHERE status='failed'
  comments_total: number;    // FROM interactions (all risk levels)
  risk_comments: number;     // FROM interactions WHERE risk_level IN ('high', 'crisis')
  avg_response_time_minutes: number | null; // FROM conversation_messages (outbound) minus inbound created_at
  last_updated_at: string;   // ISO 8601
}
```

**Query Logic (per row):**
- `posts_published`: `COUNT(*) FROM publish_jobs WHERE campaign_id = :id AND status = 'published'`
- `publish_failed`: `COUNT(*) FROM publish_jobs WHERE campaign_id = :id AND status = 'failed'`
- `comments_total`: `COUNT(*) FROM interactions WHERE job_id IN (jobs for campaign)`
- `risk_comments`: `COUNT(*) FROM interactions WHERE risk_level IN ('high', 'crisis') AND job_id IN (jobs for campaign)`
- `avg_response_time_minutes`: avg of (first outbound message `created_at` - interaction `created_at`), NULL if no replies
- Data must NOT include raw comment body.

**Role requirement:** `admin` or `manager` (resolved from `workspace_members`).

---

## Data / API Contract

### HTTP API (planned)
- **Route:** `GET /api/v1/admin/reports/campaigns`
- **Auth:** `x-user-id` header → resolved to `admin` or `manager` role
- **Response:** `{ rows: CampaignReportRow[], generated_at: string }`
- **Export:** optional `?format=csv` query param → `Content-Type: text/csv`

### Ledger Tables Used (read-only)
- `publish_jobs` (status, campaign_id)
- `interactions` (risk_level, job_id, created_at)
- `messages` (direction, created_at)
- `workflow_runs` (campaign context)

---

## Security & Safety Rules

- **Role required:** Only `admin` or `manager` can access report — `creator`, `viewer`, `support` cannot.
- **Sensitive comment content not exposed:** Report shows `comments_total` and `risk_comments` counts only — not raw body, not author name.
- **Source is Ledger only:** No Slack message parsing or raw webhook log queries.
- **RLS:** `SET LOCAL app.current_workspace_id` enforced for all read queries.
- **Export CSV:** Must not include raw comment bodies or tokens in exported fields.

---

## Error Cases

| Case | HTTP Response |
|:---|:---|
| Missing role | 403 Forbidden |
| Invalid date range | 400 Bad Request |
| No matching campaigns | 200 with empty `rows: []` |
| DB query timeout | 500 with sanitized error message |

---

## Acceptance Criteria

**AC1 — Report shows published and failed post counts (Backlog AC1)**
- *Given* a campaign with 5 published posts and 2 failed posts in Ledger
- *When* `GET /api/v1/admin/reports/campaigns?campaign_id=<id>` is called by an admin
- *Then* the response contains `posts_published: 5` and `publish_failed: 2`.
- *Trace evidence:* Test case `"should aggregate publish job outcomes correctly"` in [reportRepository.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/reportRepository.test.ts) and [REPORT-us-012-campaign-reporting-2026-06-03.md](file:///d:/Muti-Media%20Management/docs/reports/REPORT-us-012-campaign-reporting-2026-06-03.md).

**AC2 — Report shows comment and risk comment counts (Backlog AC2)**
- *Given* 10 interactions for a campaign, of which 3 have `risk_level = 'crisis'`
- *When* the report endpoint is called
- *Then* the response contains `comments_total: 10` and `risk_comments: 3`.
- *Trace evidence:* Test case `"should aggregate comment counts and risk levels"` in [reportRepository.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/reportRepository.test.ts).

**AC3 — Filter by campaign and date works (Backlog AC3)**
- *Given* posts across multiple campaigns and dates
- *When* `?campaign_id=C1&date_from=2026-01-01&date_to=2026-01-31` is used
- *Then* only C1 posts in January are counted.
- *Trace evidence:* Test cases in [reportsRoute.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/reportsRoute.test.ts) (filtering parameters validation).

**AC4 — Data sourced from Ledger, not Slack (Backlog AC4)**
- *Given* the same campaign data exists in Ledger and in Slack message history
- *When* the report is generated
- *Then* counts match Ledger values (from `publish_jobs` and `interactions`), not Slack message counts.
- *Trace evidence:* Test case `"should retrieve reports only from Ledger DB tables"` in [reportsRoute.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/reportsRoute.test.ts).

---

## Test Plan

### Existing Test Files (Verified)

| Test File | Path | Coverage |
|:---|:---|:---|
| [reportRepository.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/reportRepository.test.ts) | `apps/orchestrator/src/__tests__/reportRepository.test.ts` | Campaigns query builders, counting published/failed posts, comment risk sum |
| [reportsRoute.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/reportsRoute.test.ts) | `apps/orchestrator/src/__tests__/reportsRoute.test.ts` | Campaign filters validation, 403 authorization checks, CSV stream outputs |

### Verification Evidence Reports

TDD cycles and verification logs:
- [REPORT-us-012-campaign-reporting-2026-06-03.md](file:///d:/Muti-Media%20Management/docs/reports/REPORT-us-012-campaign-reporting-2026-06-03.md)

### RED Evidence Status

**Partial** — Implemented before AI-SDLC gate. Original RED stage execution outputs not captured. However, regression tests exist and currently run green.

---

## Validation Level

**L2** — Verification suite passes with automated tests. Run command:
`npm run test apps/orchestrator/src/__tests__/reportsRoute.test.ts`

---

## Open Questions

- OQ-012-1: How is `campaign_id` linked to `publish_jobs`? *Resolved:* Joined via `workflow_runs` table, which maps `publish_jobs.variant_id` back to the Airtable campaign record.
- OQ-012-2: Is Airtable-synced view implemented? *Resolved:* Out of scope for MVP. The current implementation fetches data directly from the Ledger Postgres database.
- OQ-012-3: Should `avg_response_time` be in minutes? *Resolved:* Yes, it is computed in minutes at the database SQL query level.

