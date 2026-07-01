# SPEC-US-001: Airtable Campaign and Post Base Configuration

**Status:** Approved  
**Retrofit Note:** Retrospec — US-001 is Airtable configuration (no backend code). No FL entry in Function Flow Logic Register — verified by `rg "US-001" docs/requirements/05_Function_Flow_Logic_Register.md` returning 0 results. Verification is manual via Airtable base inspection.  
**FL Reference:** None (Airtable data model — no backend workflow)  
**Backlog AC/BR:** US-001 AC1–AC4

---

## Goal

Establish the Airtable base as the control plane for Campaign and Post records, defining the field schema, status machine, and views that downstream middleware (US-002+) uses as input references — without implementing backend code or webhooks (those belong to US-002).

---

## Source References

- **Backlog:** `docs/requirements/04_Product_Backlog.md` — US-001, Epic E01
- **Middleware Handoff Contract:** `docs/plans/US-001/US-001-middleware-handoff-contract.md`
- **Final Notes:** `docs/plans/US-001/US-001-final-implementation-notes.md`
- **Report:** `docs/reports/US-001/REPORT-us-001-middleware-handoff-contract-2026-05-20.md`
- **FL-001 reference:** FL-001 (`docs/requirements/05_Function_Flow_Logic_Register.md` line 51) is the downstream webhook for US-002, not US-001. US-001 is the Airtable setup that makes the webhook possible.

---

## In Scope

- **Campaigns table:** fields for campaign objective, brief URL (Notion), target channels, duration, budget tier.
- **Posts table:** fields for `master_copy`, CTA URL, UTM parameters, `status` (state machine below), `target_channels` (multi-select: Facebook, Instagram, etc.), `approved_at`, `approved_version`, `airtable_record_id` as idempotency anchor.
- **Status state machine** for Posts (Airtable-side values):
  `Draft` → `Review` → `Approved` → `Scheduled` → `Published` | `Failed`
- **Channel Accounts table:** display stubs linking Campaigns/Posts to a platform channel — no raw tokens. Includes `airtable_channel_account_record_id` for Airtable sync from US-011.
- **Views required:** `Pending Review`, `Approved`, `Scheduled`, `Published`, `Failed`.
- **Webhook configuration:** Airtable webhook set to fire on Post record modification (trigger for US-002). Webhook URL points to `POST /api/v1/webhook/airtable/approved`.

## Out of Scope

- Webhook receiver or middleware logic — that belongs to US-002 / FL-001.
- AI generation, policy engine, or publish — those belong to US-003 through US-006.
- Storing raw access tokens, bearer strings, or API keys in any Airtable field.

---

## Functional Contract

US-001 is configuration, not a code workflow. The "functional contract" is the Airtable data model:

**Posts table required fields (used by FL-001 zero-trust reload):**
| Field | Type | Notes |
|:---|:---|:---|
| `Record ID` | Auto / Airtable native | Idempotency anchor for US-002 (`airtable_record_id`) |
| `Status` | Single select | Values: `Draft`, `Review`, `Approved`, `Scheduled`, `Published`, `Failed` |
| `Master Copy` | Long text | Source content for AI Composer |
| `CTA URL` | URL | Must include UTM params for Facebook posts |
| `Target Channels` | Multi-select | Values: `Facebook`, `Instagram`, `Zalo`, `WhatsApp`, `Threads` |
| `Approved At` | Date/time | Set when status moves to `Approved` |
| `Campaign` | Link to another record | Link to Campaigns table |
| `Scheduled At` | Date/time | Target publish time |

**Campaigns table required fields:**
| Field | Type | Notes |
|:---|:---|:---|
| `Campaign Objective` | Single line | AI Composer context |
| `Notion Brief URL` | URL | Optional — loaded by US-013 if present |
| `Target Channels` | Multi-select | Platform targeting |

**Channel Accounts table:**
| Field | Type | Notes |
|:---|:---|:---|
| `Platform` | Single select | `facebook`, `instagram`, etc. |
| `Display Name` | Single line | Safe display only — no token |
| `Token Status` | Single select | `active`, `expired`, `disconnected`, `error` — synced from US-011 |
| `Connected Posts` | Link to another record | Link to Posts |

**Webhook:**
- Trigger: field change on Posts table
- Fires when: any field changes (receiver filters for `Approved` status transition)
- Destination: `POST /api/v1/webhook/airtable/approved` (US-002 receiver)
- Payload: Airtable native format (raw, not JWT-signed) — zero-trust reload required by US-002

---

## Data / Queue / API Contract

No queue or HTTP API in US-001. The data model is the contract.

**Zero-trust boundary:** US-002 must NEVER trust Airtable webhook payload content for business decisions. Reload required. This is enforced by FL-001's zero-trust reload step.

---

## Security & Safety Rules

- **No raw tokens in Airtable fields.** Channel Accounts table stores display-only metadata (`token_status`) — actual credentials live in Postgres `token_references` (US-011).
- **No personal customer data in Campaign or Post fields** beyond the normal content scope.
- **Webhook URL is not a secret** — but the receiver (US-002) must validate source via Airtable webhook signature or trusted IP range.
- **`Approved At` field must not be manually editable** by non-admin roles in Airtable — Airtable role restriction required.

---

## Acceptance Criteria

**AC1 — Status machine is correctly defined (Backlog AC1)**
- *Given* the Posts table in Airtable
- *When* a record's Status field is inspected
- *Then* it is a Single Select with exactly the values: `Draft`, `Review`, `Approved`, `Scheduled`, `Published`, `Failed` — no other values.
- *Evidence Trace:* Verified in [REPORT-us-001-field-types-and-constraints-2026-05-20.md](file:///d:/Muti-Media%20Management/docs/reports/US-001/REPORT-us-001-field-types-and-constraints-2026-05-20.md) and manual base schema inspection.

**AC2 — Webhook fires on record modification (Backlog AC2)**
- *Given* a Post record where Status is changed to `Approved`
- *When* the Airtable automation runs
- *Then* a webhook POST is sent to `POST /api/v1/webhook/airtable/approved` within 30 seconds containing the `record_id` and `change_type = "modified"`.
- *Evidence Trace:* Verified in [REPORT-us-001-implementation-completion-gate-2026-05-21.md](file:///d:/Muti-Media%20Management/docs/reports/US-001/REPORT-us-001-implementation-completion-gate-2026-05-21.md).

**AC3 — Channel Accounts table has no raw token fields (Backlog AC3)**
- *Given* the Channel Accounts table schema
- *When* all fields are inspected
- *Then* no field is named `access_token`, `bearer`, `client_secret`, or equivalent, and `token_status` contains only status enum values.
- *Evidence Trace:* Confirmed in [REPORT-us-001-qa-acceptance-pass-2026-05-20.md](file:///d:/Muti-Media%20Management/docs/reports/US-001/REPORT-us-001-qa-acceptance-pass-2026-05-20.md).

**AC4 — CTA URL field exists and is type URL (Backlog AC4)**
- *Given* the Posts table
- *When* the field schema is inspected
- *Then* `CTA URL` field type is `URL` and `UTM Parameters` (if separate) field type is `Single line text`.
- *Evidence Trace:* Verified in [REPORT-us-001-field-types-and-constraints-2026-05-20.md](file:///d:/Muti-Media%20Management/docs/reports/US-001/REPORT-us-001-field-types-and-constraints-2026-05-20.md).

---

## Test Plan

### Verification Method (Manual)
The configuration is verified manually by checking the Airtable Schema and automations:
1. Log into Airtable base. Inspect Posts table field list against the field table.
2. Confirm Status field type is Single Select with exactly the required values.
3. Confirm Channel Accounts table has no token-like fields.
4. Trigger Airtable automation with a test record status change → verify webhook fires to correct endpoint.
5. Confirm webhook URL matches `POST /api/v1/webhook/airtable/approved`.

Manual validation logs and outcomes are documented in:
- [REPORT-us-001-field-types-and-constraints-2026-05-20.md](file:///d:/Muti-Media%20Management/docs/reports/US-001/REPORT-us-001-field-types-and-constraints-2026-05-20.md) (AC1, AC4 Verification)
- [REPORT-us-001-workflow-views-2026-05-20.md](file:///d:/Muti-Media%20Management/docs/reports/US-001/REPORT-us-001-workflow-views-2026-05-20.md) (Workflow views setup verification)
- [REPORT-us-001-qa-acceptance-pass-2026-05-20.md](file:///d:/Muti-Media%20Management/docs/reports/US-001/REPORT-us-001-qa-acceptance-pass-2026-05-20.md) (AC3 verification)
- [REPORT-us-001-implementation-completion-gate-2026-05-21.md](file:///d:/Muti-Media%20Management/docs/reports/US-001/REPORT-us-001-implementation-completion-gate-2026-05-21.md) (AC2 automation verification)

### RED Evidence Status
**Not Applicable** — US-001 is configuration-only. No code tests.

---

## Validation Level
**L0** for this retrofit spec (docs-only).  
**Manual verification** is the primary validation path as documented in the manual reports list.

---

## Open Questions

- OQ-001-1: Is the webhook payload HMAC-signed by Airtable? *Resolved:* No, Airtable sends plain-text JSON body. Ingress security relies on HTTPS, webhook ID validation, and zero-trust reloads.
- OQ-001-2: Are UTM parameters in a separate field? *Resolved:* They are expected to be part of the `CTA URL` field value or configured inside Campaign metadata. No separate `UTM Parameters` field exists on the post level to keep the structure simple.

