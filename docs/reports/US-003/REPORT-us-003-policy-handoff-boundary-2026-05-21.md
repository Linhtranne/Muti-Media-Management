# Report: Policy Engine Handoff Boundary Design

**Date:** 2026-05-21  
**Agent(s) Used:** `backend-specialist` (Gemini 3.5 Flash)  
**Related User Story:** US-003 / T-010  
**Status:** Completed  

---

## Summary
Designed the high-fidelity technical handoff boundary specification between **AI Composer (US-003)** and **Policy Engine (US-004)**. This specification details the exact eligibility criteria for variants entering policy check, designs the references-only RabbitMQ event contract `policy.evaluate.requested` (Zero Data Leakage), designs the additive Transactional Outbox table (`policy_handoff_events`), specifies the transactional database boundaries, details strict idempotency and deduplication rules, establishes fail-closed guidelines, logs standardized audit events, and defines the integration rules for the downstream Policy Engine.

---

## What Was Done
- [x] Reviewed 11 required system documents to extract architectural constraints, coding conventions, backlog criteria, functional flow logic, and persistence parameters.
- [x] Defined concrete eligibility and ineligibility conditions for variants entering policy check.
- [x] Designed the references-only RabbitMQ event contract `policy.evaluate.requested` with full JSON Schema and TypeScript typings to prevent data leakage in transit.
- [x] Designed the additive Transactional Outbox table (`policy_handoff_events`) and its physical database schema.
- [x] Defined complete SQL transactional blocks for atomic happy path persistence and Outbox relay synchronization flow.
- [x] Specified deterministic idempotency key structures and deduplication rules at both producer (Outbox write) and consumer (Policy Engine check) boundaries.
- [x] Established robust fail-closed criteria, prompt-injection bypass guards, and non-blocking fallback rules for Airtable sync retries.
- [x] Mapped out a comprehensive State Transition Matrix for workflow runs, AI runs, and content variants.
- [x] Registered a standardized taxonomy of 4 Audit Events with detailed JSON metadata payload structures.
- [x] Authored the complete technical design spec to [US-003-policy-handoff-boundary.md](file:///d:/Muti-Media%20Management/docs/plans/US-003/US-003-policy-handoff-boundary.md).
- [x] Generated the mandatory closure report file.
- [x] Post-review correction added `idempotency_key` and `metadata` to the outbox/event design, changed the outbox FK to `ON DELETE RESTRICT`, added RLS `WITH CHECK`, removed the publish-oriented exchange example, and corrected retryable workflow state handling to return to `pending_ai_generation`.

---

## How It Was Done

### Approach
Designed the boundary using the **Transactional Outbox Pattern** to resolve the dual-write consistency problem in the Composability Architecture. By persisting the pending handoff metadata to an additive database table (`policy_handoff_events`) inside the same ACID transaction as the ledger updates, we guarantee that the ledger state is in perfect synchronization with enqueued events. 

To maintain strict data security and compliance with the **Zero-Token Logging** and privacy requirements, we adopted a **References-Only Payload Pattern** on the event queue, forcing downstream processors to reload verified content safely from the ledger via RLS-scoped Postgres queries.

### Tools & Skills Used
| Tool/Skill | Purpose |
|:---|:---|
| `default_api:view_file` | Read existing architecture, coding conventions, backlog, and US-003 design specs. |
| `default_api:write_to_file` | Created the new handoff boundary plan and report files. |
| `event-architect` | Applied expertise on immutable events, correlation/causation tracing, and idempotency structures. |
| `queue-workers` | Addressed background processing, durable consumption, retry limits, and worker ACK constraints. |
| `postgres-wizard` | Tuned ACID boundaries, Outbox schema design, composite index lookups, and multi-tenant RLS checks. |

### Files Changed
| File | Action | Description |
|:---|:---|:---|
| [US-003-policy-handoff-boundary.md](file:///d:/Muti-Media%20Management/docs/plans/US-003/US-003-policy-handoff-boundary.md) | Created | High-fidelity technical specification detailing all eligibility rules, outbox schemas, SQL transactions, idempotency formulas, state transition matrix, and integration boundaries. |
| [REPORT-us-003-policy-handoff-boundary-2026-05-21.md](file:///d:/Muti-Media%20Management/docs/reports/US-003/REPORT-us-003-policy-handoff-boundary-2026-05-21.md) | Created | Technical closure report summarizing accomplishments, decisions made, and next steps in compliance with `AGENTS.md`. |

---

## Impact & Purpose
This handoff boundary provides a solid and secure integration baseline between the AI content creation flow and the automated brand compliance check (Policy Engine). By adopting the Transactional Outbox and References-Only event queue, it eliminates distributed state desynchronization, protects user privacy, guarantees that no raw/unvalidated content bypasses policy, and ensures a seamless transition into SMM review.

---

## Decisions Made
| Decision | Rationale | Alternatives Considered |
|:---|:---|:---|
| **Transactional Outbox Pattern** | Guarantees local database consistency with published messages. If the DB commits, the handoff event is safely queued. If it fails, no phantom queue message is sent. Avoids complex and fragile 2PC protocols. | Direct queue publishing inside the main transaction. (High risk of data desynchronization if the queue is briefly unreachable). |
| **References-Only Payload Pattern** | Enforces zero data leakage in transit and minimizes payload overhead. Message only carries UUIDs; the Policy Engine reloads copy securely using RLS-scoped Postgres queries. | Full payload serialization including variant body and hashtags. (Violates token log masking conventions and bloats queue). |
| **Non-Blocking Airtable Sync Fallback** | Postgres Ledger is the operational source of truth. SMM visual layer (Airtable) network delays/rate limits shouldn't bottleneck rule evaluation. Metadata flag `airtable_sync_pending_at_policy_handoff` preserves full audit visibility. | Blocking policy evaluate request until Airtable update succeeds. (Causes high processing latency and cascading bottlenecks). |
| **Active Variant Version UPSERT** | Aligns with the Airtable Control Plane where each Post record has a single draft slot. Appending multiple active variant rows in the ledger would cause sync degradation. Historical records are preserved in `ai_generation_runs` instead. | Appending new rows in `content_variants` for every prompt run. (Requires complex coordination and risk of Airtable desync). |
| **Dedicated Policy Exchange Only** | Prevents a policy handoff event from being accidentally routed into any publish-oriented queue. | Reusing a publish exchange naming example. Rejected because it weakens the no-publish boundary. |

---

## Verification
- [x] Spec updated and committed in [US-003-policy-handoff-boundary.md](file:///d:/Muti-Media%20Management/docs/plans/US-003/US-003-policy-handoff-boundary.md)
- [x] Event payload schema verifies zero secrets or user text copy is exposed.
- [x] RLS partitioning and composite index parameters are verified.
- [x] All US-003 Epic Acceptance Criteria and Business Rules mapped out.
- [x] No secrets exposed in any written code, SQL, or logs.
- [x] Outbox schema now includes the idempotency key used by the documented dedupe formula.

---

## Open Items / Next Steps
- Verify queue and exchange binding topology in RabbitMQ infrastructure definitions.
- Establish worker prefetch count limits for the downstream US-004 worker to handle high volumes of parallel policy evaluation requests.
