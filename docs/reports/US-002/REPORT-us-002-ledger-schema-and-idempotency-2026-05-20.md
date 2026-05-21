# Report: US-002 Ledger Schema and Idempotency Design

**Date:** 2026-05-20
**Agent(s) Used:** Hermes (gpt-5.3-codex)
**Related User Story:** US-002
**Status:** Completed

## Summary
Designed Operational Ledger v1 schema for US-002 with four core tables, production idempotency model (`record_id + approved_version`), transaction boundaries for "write Ledger before ACK", and retry/DLQ + append-only audit rules.

## What Was Done
- [x] Read all required architecture, requirements, plan, and scope-lock docs in strict order.
- [x] Applied postgres-wizard, event-architect, and database-architect specialist guidance.
- [x] Produced `docs/plans/US-002/US-002-ledger-schema-and-idempotency.md` with all required 15 sections.
- [x] Defined schema for `webhook_events`, `queue_events`, `workflow_runs`, `audit_logs`.
- [x] Defined required constraints, indexes, FK relationships, and UUID-based ID strategy.
- [x] Defined status enums including all mandatory taxonomy states.
- [x] Defined approved_version server-side allocation model and additive migration strategy.
- [x] Post-review correction: clarified that production `approved_version` is allocated only after worker reload/reverify confirms a fresh valid Approved state.
- [x] Post-T-009 schema sync: added token-free `workflow_runs.channel_account_refs` JSONB to the canonical Ledger schema.

## How It Was Done
### Approach
Started from architecture and coding boundaries, then converted US-002 AC/BR + FL-001 flow into durable Postgres schema contracts. Prioritized at-least-once safety through strict idempotency keys, immutable/append-only audit behavior, and transactional ACK ordering.

### Tools & Skills Used
| Tool/Skill | Purpose |
|:---|:---|
| `execute_code` | Read source docs/skills and write/verify output files in this environment. |
| `postgres-wizard` + sharp-edges | Applied Postgres schema/index/constraint/migration and anti-breaking-change patterns. |
| `event-architect` + sharp-edges | Applied event immutability, idempotency, correlation, and at-least-once handling constraints. |
| `.agent/agents/database-architect.md` | Applied migration discipline, schema reliability, and data-model quality guardrails. |

### Files Changed
| File | Action | Description |
|:---|:---|:---|
| `docs/plans/US-002/US-002-ledger-schema-and-idempotency.md` | Created | Ledger schema + idempotency design for US-002 T-002. |
| `docs/reports/US-002/REPORT-us-002-ledger-schema-and-idempotency-2026-05-20.md` | Created | Mandatory completion report for task T-002. |

## Impact & Purpose
This design establishes a safe and auditable data foundation before implementation, preventing duplicate workflows, preserving event traceability, and enforcing strict security boundaries (references-only payloads, no secret/content leakage).

## Decisions Made
| Decision | Rationale | Alternatives Considered |
|:---|:---|:---|
| Use UUID PK for all ledger tables | Avoid sequential ID exposure in logs/API and reduce enumeration risk | BIGSERIAL public IDs (rejected) |
| Enforce dual idempotency uniqueness (composite + key string) | Strong guard for business dedupe and cross-service tracing | Event ID only (rejected) |
| Server-side `approved_version` allocator table | Deterministic, transaction-safe versioning independent from Airtable | Adding version to Airtable (rejected) |
| Allocate `approved_version` after fresh valid reload | Prevents stale/duplicate webhook deliveries from consuming approval versions before the worker verifies current Airtable state | Allocating version immediately in webhook receiver (rejected after review) |
| Store `channel_account_refs` on `workflow_runs` as token-free JSONB | Keeps the US-003 handoff stable after T-008 resolves safe account metadata and prevents Airtable stub drift from changing an already-approved workflow input | Forcing downstream services to re-resolve Airtable account stubs later (rejected due to drift risk) |
| Append-only `audit_logs` | Preserves forensic and compliance trail integrity | Mutable audit rows (rejected) |
| Additive migration strategy only | Minimize production risk and avoid breaking changes | In-place destructive schema edits (rejected) |

## Verification
- [x] File `docs/plans/US-002/US-002-ledger-schema-and-idempotency.md` exists.
- [x] File `docs/reports/US-002/REPORT-us-002-ledger-schema-and-idempotency-2026-05-20.md` exists.
- [x] Contains 4 required tables.
- [x] Contains unique constraint for `event_id`.
- [x] Contains unique constraint for production idempotency (`record_id + approved_version` equivalent).
- [x] Defines transaction rule: Ledger update before ACK.
- [x] Contains no raw token/content schema fields.
- [x] `workflow_runs.channel_account_refs` is documented as safe metadata only, with no tokens, vault references, content, or asset payloads.
- [x] Keeps `approved_version` out of Airtable.
- [x] Includes retry/DLQ metadata design.
- [x] Includes append-only audit model rule.

## Open Items / Next Steps
- Validate SQL type choices (`TEXT` vs stricter domains) with implementation team.
- Confirm exact retry/DLQ policies per environment before migration coding.
- Align enum naming with code constants in shared contracts package.
