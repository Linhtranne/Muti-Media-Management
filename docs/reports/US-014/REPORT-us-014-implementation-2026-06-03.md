# Report: US-014 RabbitMQ Event Bus Hardening — Implementation

**Date:** 2026-06-03
**Agent(s) Used:** backend-specialist + event-architect + security-auditor (AG Kit)
**Related User Story:** US-014
**Status:** Completed

---

## Summary

Hardened the MediaOps RabbitMQ event bus by implementing:
- A canonical `CanonicalEventEnvelope` Zod schema with recursive forbidden-field enforcement (now fully scanning arrays recursively and checking `camelCase`/`PascalCase` variations).
- A centralised `topologyConfig.ts` registry for all 11 production queues with per-queue DLQ and retry TTL policy.
- `publishCanonicalEvent()` and all 10 legacy publishing methods with pre-publish security guards to deny secrets/tokens system-wide.
- Postgres-based `IdempotencyGuard` with fail-open graceful degradation and workspace-isolation scoping.
- Full consumer runtime integration: consumer now automatically executes `checkIdempotency()` before processing, immediately `ack`s duplicate messages, and logs database success/failure states.
- Hardened database migration for `event_bus_messages` table: UNIQUE constraint is scoped to `(workspace_id, idempotency_key)` and RLS policy enforces `WITH CHECK`.
- Standardised `QUEUE_EVENT_PUBLISHED/CONSUMED/RETRIED/DLQ` audit events fully wired into runtime publisher and consumer helpers.
- 80 new tests (covering envelope schema, camelCase checks, topology config, publisher/consumer mock audits, and consumer idempotency flows) — total suite: **377 passing, 0 failing**.

---

## What Was Done

- [x] Create `packages/shared-contracts/src/events/envelope.ts` — Zod envelope schema with forbidden-field guard (recursive, nested object/array safe, camelCase variation support)
- [x] Export envelope from `packages/shared-contracts/src/index.ts`
- [x] Create `apps/orchestrator/src/queue/topologyConfig.ts` — full topology registry (11 queues, canonical exchange, per-queue DLQ, retry TTL, prefetch)
- [x] Update `apps/orchestrator/src/queue/rabbitmqPublisher.ts` — add `publishCanonicalEvent()`, assert canonical exchange, assert no forbidden fields on all legacy & canonical methods, and wire `auditQueuePublished` logs
- [x] Create `apps/orchestrator/src/queue/idempotencyGuard.ts` — Postgres-based check/mark with fail-open on missing table, updated conflict target to include workspace_id
- [x] Create `apps/orchestrator/src/queue/queueAuditHelper.ts` — `auditQueuePublished/Consumed/Retried/Dlq()` helpers supporting pg.Pool/pg.PoolClient
- [x] Update `apps/orchestrator/src/queue/rabbitmqConsumer.ts` — wire `auditQueueConsumed/Retried/Dlq` logs, wire `checkIdempotency()` check on approved posts (acks and drops duplicates early), and wire `markIdempotencySucceeded/Failed()` outcomes
- [x] Update `apps/orchestrator/src/server.ts` — wire DB and logger dependencies into publisher/consumer instantiation
- [x] Create/Harden `db/migrations/0014_us014_event_bus_messages.sql` — additive idempotency table with RLS (composite UNIQUE constraint on `(workspace_id, idempotency_key)` and RLS `WITH CHECK` policy)
- [x] Create `packages/shared-contracts/src/__tests__/envelope.test.ts` — Zod and helper tests covering nested objects, arrays, and camelCase forbidden fields
- [x] Create `apps/orchestrator/src/queue/__tests__/topologyConfig.test.ts` — 18 topology tests
- [x] Create `apps/orchestrator/src/queue/__tests__/rabbitmqPublisher.test.ts` — mock publisher tests for security guards and audit logs
- [x] Create `apps/orchestrator/src/queue/__tests__/rabbitmqConsumer.test.ts` — mock consumer tests for consumed/retried/DLQ audit logging and early duplicate ack/outcome markings
- [x] Register new tests in `run-tests.mjs`
- [x] `npm run build` — passes
- [x] `npm test` — 377 pass, 0 fail

---

## How It Was Done

### Approach

**Additive, backward-compatible hardening.**

- No existing queues, exchanges, or routing keys were renamed or removed.
- The `mediaops.events.topic` canonical exchange is asserted alongside existing exchanges on publisher init.
- `topologyConfig.ts` is a reference registry — it does not replace existing consumer `assertQueue()` calls. Consumers can migrate incrementally.
- `idempotencyGuard.ts` uses `ON CONFLICT DO NOTHING` for atomic deduplication and fails open if the migration hasn't been applied.
- All idempotency select/update queries are strictly scoped using both `workspace_id` and `idempotency_key` to match composite uniqueness constraints.
- All forbidden-field checks use the `FORBIDDEN_FIELDS` constant from `envelope.ts` as single source of truth.
- `rabbitmqPublisher.ts` and `rabbitmqConsumer.ts` get the pg database pool injected to perform secure audit logging.
- `rabbitmqConsumer.ts` connects dynamically using `amqp.connect` at start time to facilitate connection mock hooks.

### Architecture Decisions

| Decision | Rationale |
|:---|:---|
| Recursive forbidden field search in arrays | Payload arrays can contain nested objects (e.g. `items[0].access_token`). Scanning array items recursively guarantees zero-leak. |
| Fail-open idempotency guard | Table may not exist in all envs. Queue must not block. |
| Workspace-scoped idempotency query | Multi-tenant isolation requires that key uniqueness and select/update statements are strictly scoped under `workspace_id`. |
| Acknowledgment ordering | `channel.ack(msg)` runs strictly after `markIdempotencySucceeded()` to prevent message loss in the event of a worker/process crash. |
| Additive canonical exchange | Legacy flows keep their exchanges. New flows use `mediaops.events.topic`. |
| Audit via `AuditLogRepository` | Reuses existing `ON CONFLICT DO NOTHING` audit pattern. No secrets in metadata. |
| Per-queue TTL retry policy in topology | Allows each worker to tune backoff without code changes. |
| Generic runtime audit wiring | publisher and consumer helpers directly write to audit trail using PG pool queries when they execute queue actions. |

### Tools & Skills Used

| Tool/Skill | Purpose |
|:---|:---|
| `backend-specialist` | Architecture, Postgres, TypeScript patterns |
| `event-architect` | Event envelope design, correlation/causation IDs |
| `security-auditor` | Forbidden field enforcement, audit trail |
| `queue-workers` (Spawner) | DLQ patterns, idempotency, retry strategies |

| File | Action | Description |
|:---|:---|:---|
| `packages/shared-contracts/src/events/envelope.ts` | Modified | Added `normalizeKey` helper and `isForbiddenKey` logic to support camelCase, PascalCase and UPPER_CASE variations. |
| `packages/shared-contracts/src/__tests__/envelope.test.ts` | Modified | Added 18 unit tests for camelCase & PascalCase fields, wrapped void arrow functions in braces. |
| `apps/orchestrator/src/queue/rabbitmqConsumer.ts` | Modified | Wired `checkIdempotency()` check into consumer runtime and `markIdempotencySucceeded/Failed()` status transitions. Refactored `moveToDlq` and worker outcome handlers to reduce Cognitive Complexity and parameter counts to satisfy SonarLint rules. |
| `apps/orchestrator/src/queue/__tests__/rabbitmqConsumer.test.ts` | Modified | Added tests verifying early skip/ack on duplicate events and update calls on worker outcomes. |
| `db/migrations/0014_us014_event_bus_messages.sql` | Modified | Hardened uniqueness constraint to `(workspace_id, idempotency_key)` and RLS policy to include `WITH CHECK`. |
| `apps/orchestrator/src/queue/idempotencyGuard.ts` | Modified | Updated database queries conflict target to `(workspace_id, idempotency_key)`. |
| `apps/orchestrator/src/queue/topologyConfig.ts` | Created | Full topology configuration registry. |
| `apps/orchestrator/src/queue/rabbitmqPublisher.ts` | Modified | Guarded legacy publishers, asserted canonical exchange, wired audit logs. |
| `apps/orchestrator/src/queue/queueAuditHelper.ts` | Modified | Updated pg client types to support pg.Pool. |
| `apps/orchestrator/src/ledger/auditLogRepository.ts` | Modified | Supported pg.Pool for transactions. |
| `apps/orchestrator/src/server.ts` | Modified | Injected database pool into publisher/consumer. |
| `apps/orchestrator/src/queue/__tests__/topologyConfig.test.ts` | Created | Topology configuration unit tests. |
| `apps/orchestrator/src/queue/__tests__/rabbitmqPublisher.test.ts` | Created | Publisher unit tests. |
| `.agent/skills/testing-patterns/scripts/test_runner.py` | Modified | Normalized commands on Windows to use npm.cmd/npx.cmd to prevent FileNotFoundError in unified checklist run. |
| `run-tests.mjs` | Modified | Registered new test files. |

---

## Impact & Purpose

- **Security**: No raw token, secret, or large payload can reach RabbitMQ via any publisher method. Forbidden fields are checked recursively in both nested objects/arrays and in all casing variations (`camelCase`, `PascalCase`, `UPPER_CASE`, `snake_case`).
- **Observability**: Every queue operation (published/consumed/retried/DLQ) emits a structured audit log entry with redacted metadata.
- **Idempotency**: Consumer runtime executes database-backed idempotency guards, dropping duplicates early while continuing to fail open gracefully if the table is unavailable.
- **Maintainability**: `topologyConfig.ts` is the single source of truth for all queue names, DLQ names, and retry policies.
- **Compatibility**: All existing consumers continue working unchanged.

---

## Verification

- [x] `npm run build` passes (tsc -b, no errors)
- [x] `npm test` passes: **377 tests, 0 failures**
- [x] No secrets exposed in code, logs, or metadata
- [x] No existing queue/exchange renamed
- [x] Additive canonical exchange only
- [x] Idempotency guard fails open (no queue block on missing migration)
- [x] Acceptance criteria FL-008 addressed: canonical envelope, DLQ per queue, audit events, forbidden field guard, idempotency

## Open Items / Next Steps

- **Apply migration**: Run `0014_us014_event_bus_messages.sql` in staging/production to enable hardened workspace-isolated idempotency tracking.
- **Incremental adoption**: Future worker queues can adopt the idempotency checks by passing the database dependency.
- **Monitor canonical exchange**: Route future events through `mediaops.events.topic` to consolidate topology.
