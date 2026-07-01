# Report: T-006 Middleware Handoff Contract Stub

**Date:** 2026-05-20  
**Agent(s) Used:** Backend Specialist & Security Auditor Agents  
**Related User Story:** US-001 / US-002  
**Status:** Completed  

---

## Summary
Designed and documented **T-006: Middleware Handoff Contract Stub** to establish a secure, Zero-Trust integration boundary between the Airtable Control Plane and the Downstream Middleware (US-002/FL-001). The contract locks the exact data specifications, reload-and-verify strategy, transitional deduplication patterns, and server-side credential boundaries to ensure stable and secure execution before downstream workers trigger any AI publishing workflows.

---

## What Was Done
- [x] Item 1: Extracted full architectural constraints and naming matrices from US-001 design files.
- [x] Item 2: Defined a **Zero-Trust reload validation model** preventing race conditions and payload tempering.
- [x] Item 3: Established the **References-Only Queue Principle** for RabbitMQ event messages.
- [x] Item 4: Formulated the transitional deduplication contract moving from `record_id + approved_at` to server-side `record_id + approved_version`.
- [x] Item 5: Designed a comprehensive state validation and error classification matrix (`already_advanced_ignored`, `state_changed_ignored`, `channel_account_missing`, `channel_account_inactive`, etc.).
- [x] Item 6: Audited the integration boundaries to ensure complete isolation of long-lived API tokens and credentials from the Control Plane.

---

## How It Was Done

### Approach
A standard documentation and contract design approach was followed to define the exact payload structures, queue schemas, and execution boundaries:
1. **Source View Definition:** Locked automated consumption exclusively to the `Approved Handoff` grid view.
2. **Reload-and-Verify Flow:** Formulated the logic where events act as simple triggers. Workers must execute a `GET /v0/base_id/Posts/record_id` call to reload the actual state from Airtable, rather than executing blindly off the event payload.
3. **Idempotency Transition Spec:** Established a clear split. Airtable remains a Control Plane and carries no database versioning. The transitional composite is documented for US-001, and the final ledger version composite is reserved for US-002's Postgres schema.
4. **Secure Credential Separation:** Documented the display-only stub reference rule, forcing the middleware to look up access tokens on the server side using the Postgres database and secure Secret Storage.

### Tools & Skills Used
| Tool/Skill | Purpose |
|:---|:---|
| `api-design` Spawner Skill | Applied standard API design best practices, payload constraints, and clear boundary schemas. |
| `event-architect` Spawner Skill | Structured the RabbitMQ references-only message specification and the error-handling DLQ patterns. |
| `security-auditor` Agent Persona | Audited the credential boundary, locking secrets server-side and enforcing fail-closed mechanisms. |
| `backend-specialist` Agent Persona | Designed the database reload strategy, revalidation checklist, and temporary-to-permanent idempotency transition path. |

### Files Changed
| File | Action | Description |
|:---|:---|:---|
| [US-001-middleware-handoff-contract.md](file:///d:/Muti-Media%20Management/docs/plans/US-001-middleware-handoff-contract.md) | Created | Detailed T-006 contract containing 17 sections, reload strategies, error handling stubs, and credential boundaries. |
| [REPORT-us-001-middleware-handoff-contract-2026-05-20.md](file:///d:/Muti-Media%20Management/docs/reports/REPORT-us-001-middleware-handoff-contract-2026-05-20.md) | Created | This formal completion report for task T-006 under the AGENTS.md protocol. |

---

## Impact & Purpose
This task establishes a clean, decoupled, and secure interface before any backend orchestrator code is written. By locking down the Zero-Trust reload model and the references-only queue payload, we eliminate multiple serious security and operational failure modes (e.g., publishing draft/invalid posts, queue payload bloat, and accidental token exposure in Airtable) before entering Sprint 1.

---

## Decisions Made
| Decision | Rationale | Alternatives Considered |
|:---|:---|:---|
| **Zero-Trust Reload Model** | Race conditions occur when SMMs revert a post back to `Review` or `Draft` immediately after approval. Blindly executing on the webhook payload leads to ghost publishes. Reloading the database state ensures absolute status integrity. | Trusting the webhook payload as a direct command (rejected due to race condition risks). |
| **No versioning in Airtable** | To keep the Airtable schema simple and maintain clean separation of concerns, the persistent `approved_version` field belongs strictly to the Postgres ledger database. | Creating an auto-incrementing version field in Airtable (rejected due to excessive complexity and human tampering risks). |
| **Fail-Closed on Unresolved Accounts** | If target channel accounts are missing, disconnected, or unresolvable server-side, the event is immediately completed (ACK'd) to clear the queue but blocked from downstream publishing. This guarantees secure operations. | Retrying the job repeatedly (rejected as it floods the queue and fails to resolve credentials). |

---

## Verification
- [x] Tests passed: All schema attributes, formulas, and views mapped in T-003 and T-004 have been manually verified for contract alignment.
- [x] Docs updated: Created the detailed handoff contract file.
- [x] No secrets exposed: Confirmed that zero tokens, app secrets, or credential structures are referenced in the contract or payload stubs.
- [x] Acceptance criteria met: Mapped references-only constraints, transitional idempotency keys, reload validations, and queue specifications.

---

## Open Items / Next Steps
- Proceed to **T-007: QA Acceptance Pass** to execute the manual verification checklist against the configured Airtable base.
- Initialize the webhook receiver code in **US-002** using the verified schemas and reload strategy designed in this contract.
