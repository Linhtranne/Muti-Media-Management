# Report: US-004 Implementation

**Date:** 2026-06-01
**Agent(s) Used:** Codex
**Related User Story:** US-004
**Status:** Completed

## Summary
Implemented US-004 Policy Engine Publish Guardrail: policy rule package, references-only contracts, Postgres Ledger migration, policy worker, RabbitMQ consumer, publish/slack queue handoff, Airtable block sync, compensation path, and release-gate tests.

## What Was Done
- [x] Added `@mediaops/policy-engine` with pure rule functions and `POLICY_VERSION`.
- [x] Added `policy.evaluate.requested` and `publish.facebook.requested` contracts with forbidden-field rejection.
- [x] Added US-004 migration for `publish_rule_results`, `publish_jobs`, and `publish_handoff_events` with RLS.
- [x] Implemented PolicyWorker, repository, RabbitMQ consumer, and publisher wiring.
- [x] Added unit, contract, worker, queue, and security gate tests.
- [x] Updated Function Flow Logic Register and US-004 security gate.

## How It Was Done
### Approach
Followed the existing US-003 patterns: references-only RabbitMQ messages, Zod contract validation before worker calls, Postgres transaction wrapper for workspace RLS context, idempotency keys in Ledger, transactional outbox rows for publish handoff, and post-commit Airtable/Slack side effects with compensation.

### Tools & Skills Used
| Tool/Skill | Purpose |
|:---|:---|
| Queue worker guidance | ACK-after-commit, DLQ, idempotency, retry behavior. |
| Event architecture guidance | References-only events, correlation IDs, at-least-once delivery. |
| Postgres guidance | RLS, transaction boundaries, indexes, migration structure. |
| Security guidance | No secrets in queue/log/audit; fail closed for publish. |

### Files Changed
| File | Action | Description |
|:---|:---|:---|
| `packages/policy-engine/` | Created | Policy version, forbidden terms seed, pure rule checks, evaluator, tests. |
| `packages/shared-contracts/src/policy/policyEvaluate.ts` | Created | US-004 input/output queue schemas. |
| `db/migrations/0004_us004_policy_publish_guardrail.sql` | Created | Policy results, publish jobs, publish outbox, RLS policies. |
| `apps/orchestrator/src/ledger/policyWorkerRepository.ts` | Created | Ledger context reload, policy result persistence, publish job/outbox, compensation. |
| `apps/orchestrator/src/workers/policyWorker.ts` | Created | US-004 worker orchestration and side effects. |
| `apps/orchestrator/src/queue/policyRabbitmqConsumer.ts` | Created | RabbitMQ consumer with validation, DLQ, ACK/NACK handling. |
| `apps/orchestrator/src/queue/rabbitmqPublisher.ts` | Modified | Added publish and Slack alert queue publishers. |
| `apps/orchestrator/src/airtable/airtableClient.ts` | Modified | Added Airtable Needs Review policy sync method. |
| `apps/orchestrator/src/server.ts` | Modified | Registered PolicyWorker and consumer. |
| `apps/orchestrator/src/config/env.ts` | Modified | Added US-004 policy config toggles. |
| `run-tests.mjs` | Modified | Added US-004 test files. |
| `docs/plans/US-004/US-004-security-release-gate.md` | Modified | Marked P0/P1 gates as Pass with evidence. |
| `docs/requirements/05_Function_Flow_Logic_Register.md` | Modified | Marked FL-003 implemented and added change history. |

## Impact & Purpose
US-004 now blocks unsafe publish attempts before MCP execution. Passing policy evaluations create a durable publish job stub and references-only publish handoff; blocked evaluations persist rule results, update Airtable to `Needs Review`, and send sanitized Slack alert events.

## Decisions Made
| Decision | Rationale | Alternatives Considered |
|:---|:---|:---|
| Create `publish_jobs` minimal schema in US-004 | US-004 AC requires creating a publish job when policy passes. | Wait for US-005 migration. |
| Keep Policy Engine as pure package | Maintains platform boundary and simple unit testing. | Put rules directly in orchestrator worker. |
| Use fail-closed auto-publish defaults | Missing config must not publish. | Default auto-publish to enabled. |

## Verification
- [x] Tests passed: `npm test` passed with 154 tests.
- [x] Build passed: `npm run build`.
- [x] Docs updated.
- [x] No secrets exposed.
- [x] Acceptance criteria met: AC1-AC4 and implementation-plan AC5-AC12 covered by contracts, worker logic, migration, and tests.

## Open Items / Next Steps
- Apply migration and run smoke tests against real Postgres/RabbitMQ/Airtable/Slack sandbox before production traffic.
- US-005 should extend `publish_jobs` as needed for MCP validation/enqueue/publish execution.
