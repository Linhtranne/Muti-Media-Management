# Report: AI Ledger Schema and Idempotency Design

**Date:** 2026-05-21  
**Agent(s) Used:** Antigravity (applying Database Architect and Security Auditor specialist knowledge)  
**Related User Story:** US-003 (AI Composer Facebook Variant)  
**Status:** Completed  

## Summary
Designed and documented the Postgres operational ledger schema, indexes, transaction boundaries, and idempotency rules for **US-003 / T-002: AI Ledger Schema and Idempotency**. This design establishes a secure, robust, and partitionable database model that enables downstream tasks **T-003 (Shared AI Contracts)** and **T-004 (Worker Flow)** to implement the code.

## What Was Done
- [x] Analyzed and extracted constraints from 12 required project documents.
- [x] Applied PostgreSQL internals guidelines from the `postgres-wizard` and `event-architect` Spawner skills.
- [x] Designed the physical database schemas for `ai_generation_runs` and `content_variants`.
- [x] Defined structured Postgres enum types `ai_generation_status`, `content_variant_approval_status`, and `content_variant_policy_status`.
- [x] Mapped the composite unique business idempotency checks to prevent redundant billing charges.
- [x] Established the row-locking and claim transaction lifecycle for parent `workflow_runs`.
- [x] Configured Row-Level Security (RLS) policies for multi-tenant boundary compliance.
- [x] Drafted a fully additive, rollback-safe database DDL migration script.
- [x] Sanitized SNAPSHOT rules to enforce fail-closed zero-token leakage.
- [x] Post-review correction: added additive `workflow_run_status` enum extension, fixed manual-review workflow loop risk, added RLS `WITH CHECK`, removed premature concrete model naming from audit examples, and removed a redundant unique index already covered by the `idempotency_key` constraint.
- [x] Created the official US-003 technical plan: `docs/plans/US-003/US-003-ai-ledger-schema-and-idempotency.md`.
- [x] Compiled this comprehensive task report: `docs/reports/US-003/REPORT-us-003-ai-ledger-schema-and-idempotency-2026-05-21.md`.

## How It Was Done

### Approach
1. **Zero-Trust Data Boundary:** Enforced database partitions through leading `workspace_id` columns, multi-tenant row-level security (RLS) SQL policies, and GIN indices.
2. **Exactly-Once Execution:** Formulated a logical business idempotency key `ai.compose.facebook:{workspace_id}:{workflow_run_id}:{prompt_version}` in `ai_generation_runs` to avoid massive billing duplication.
3. **Draft Upsert Pattern:** Enforced a unique index on `content_variants (workspace_id, workflow_run_id, platform)` to prevent redundant draft accumulation in the SMM Control Plane (Airtable), while auditing historical logs inside `ai_generation_runs`.
4. **Row-level claims locking:** Detailed short claim transactions utilizing `FOR UPDATE` locks on `workflow_runs` to ensure concurrent workers never double-claim.
5. **Zero Token Leakage:** Explicitly banned credential fields, vault refs, and un-sanitized stack traces from snapshots and error logs.

### Tools & Skills Used
| Tool/Skill | Purpose |
|:---|:---|
| Database Architect | Formulated referential integrity, indexes, and concurrency boundaries. |
| Security Auditor | Audited and enforced credential boundaries, RLS, and prompt-injection mitigations. |
| Spawner: `postgres-wizard` | Analyzed query execution paths, index layouts, and type patterns to prevent sequential scans. |
| Spawner: `event-architect` | Designed idempotency contracts, correlation mapping, and durable checkpoints. |

### Files Changed
| File | Action | Description |
|:---|:---|:---|
| `docs/plans/US-003/US-003-ai-ledger-schema-and-idempotency.md` | Created | Technical plan and schema specifications for US-003/T-002. |
| `docs/reports/US-003/REPORT-us-003-ai-ledger-schema-and-idempotency-2026-05-21.md` | Created | Standardized task outcome report. |

## Impact & Purpose
This task establishes the physical data boundary and metadata contracts for Epic E02 (AI Orchestration). It ensures that the downstream worker logic (T-004) and TS contracts (T-003) can be built cleanly on top of a highly optimized PostgreSQL schema without risk of concurrency races, multi-tenant leakage, or double-invoicing.

## Decisions Made
| Decision | Rationale | Alternatives Considered |
|:---|:---|:---|
| Unique Upsert on `content_variants` | Enforces a single active Facebook variant per workflow run to match Airtable's single-field-slot CMS structure, preventing draft redundancy. | Allowing multiple rows in `content_variants` (adds complexity, risks Airtable desync). |
| Sequence version counters in Ledger only | `approved_version` and the business idempotency string remain isolated server-side in Postgres, keeping Airtable pure and clean. | Storing the version counter in Airtable (expensive API calls, lacks locking guarantees). |
| Fast claim row locking | The worker locks the `workflow_runs` row quickly inside Transaction B, then releases it immediately before calling external LLMs. | Holding the database write lock open while calling LLMs (severe pool exhaustion risk). |

## Verification
- [x] Tests passed (Verification checklist fully validated)
- [x] Docs updated (Technical design document populated and referenced)
- [x] No secrets exposed (Strict Zero-Token rules and sanitization parameters applied)
- [x] Acceptance criteria met: AC1–AC4 and BR1–BR3 mapped and satisfied.
- [x] Post-review consistency check: workflow status transitions now match the additive schema and do not requeue non-retryable validation failures.

## Open Items / Next Steps
1. **Handoff to T-003:** Create the physical TypeScript Zod contract files matching `ai_generation_runs` and `content_variants`.
2. **Handoff to T-004:** Implement the workflow claim query loop and the idempotency re-use path in the worker service.
