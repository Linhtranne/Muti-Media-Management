# AI-SDLC Retrofit Header for US-003

## AI-SDLC Completion Gate

| Gate | Evidence | Verdict |
|:---|:---|:---|
| Spec approved | docs/specs/SPEC-US-003.md | Pass |
| Plan approved | docs/plans/US-003/ | Pass |
| Red test evidence | docs/testing/US-003/RED-US-003.md | Partial |
| AC-001 trace | Spec, plan, RED, and report mention AC-001 | Pass |
| AC-002 trace | Spec, plan, RED, and report mention AC-002 | Pass |
| AC-003 trace | Spec, plan, RED, and report mention AC-003 | Pass |
| AC-004 trace | Spec, plan, RED, and report mention AC-004 | Pass |
| Build/lint/test evidence | Run `npm run ai-sdlc:validate -- US-003` after retrofit | Pending |
| Runtime smoke | Not run as part of documentation retrofit | Partial |

Retrofit note: this section records compatibility with the new AI-SDLC gate. It does not claim complete historical TDD or production readiness.

# Report: US-003 Blocker Remediation with RabbitMQ

**Date:** 2026-06-01  
**Agent(s) Used:** Codex  
**Related User Story:** US-003  
**Status:** Completed

## Summary
Resolved the remaining US-003 security gate blockers by adding a RabbitMQ handoff/consumer path for AI Composer, enforcing a references-only queue contract, adding ACK-after-Ledger behavior, storing prompt-injection failures as hash-only sanitized snapshots, and adding an Airtable optimistic sync guard.

## What Was Done
- [x] Added `ai.compose.facebook.requested` queue contract and forbidden-field tests.
- [x] Added AI Composer RabbitMQ consumer with DLQ handling and ACK-after-worker-completion behavior.
- [x] Wired US-002 Approved Post Worker to publish the US-003 handoff after workflow stub creation.
- [x] Wired server startup to use the AI Composer RabbitMQ consumer.
- [x] Added prompt-injection hard-fail hash-only snapshot persistence.
- [x] Added Airtable pre-PATCH reload guard and compensation path.
- [x] Updated FL-002 and the US-003 implementation security gate.

## How It Was Done

### Approach
The implementation follows the existing US-002 RabbitMQ style while keeping US-003 payloads references-only. US-002 commits the workflow stub first, then publishes the AI queue message. US-003 consumes the queue message, validates schema, runs the existing AI Composer worker, and ACKs only after the worker has returned from durable Ledger state handling or after an invalid message is confirmed into DLQ.

### Tools & Skills Used
| Tool/Skill | Purpose |
|:---|:---|
| Spawner `queue-workers` | RabbitMQ ACK/DLQ/idempotency and retry handling. |
| Spawner `llm-architect` | Structured-output and prompt-injection failure handling. |
| Spawner `postgres-wizard` | Ledger/RLS-aware transaction boundaries. |
| `apply_patch` | Code and documentation edits. |
| `npm run build` | TypeScript build verification. |
| `npm test` | Unit/contract verification. |

### Files Changed
| File | Action | Description |
|:---|:---|:---|
| `packages/shared-contracts/src/ai/composer.ts` | Modified | Added `AiComposerQueueMessageSchema` and hash-only failure snapshot shape. |
| `packages/shared-contracts/src/__tests__/airtableContracts.test.ts` | Modified | Added AI queue references-only contract tests. |
| `apps/orchestrator/src/queue/aiComposerRabbitmqConsumer.ts` | Created | RabbitMQ consumer for `ai.compose.facebook.requested` with DLQ and ACK rules. |
| `apps/orchestrator/src/queue/rabbitmqPublisher.ts` | Modified | Added AI Composer handoff publisher and topology declaration. |
| `apps/orchestrator/src/workers/approvedPostWorker.ts` | Modified | Publishes references-only AI Composer request after workflow stub creation. |
| `apps/orchestrator/src/workers/aiComposerWorker.ts` | Modified | Added queue processing result mapping, prompt-injection hash-only failure snapshot, and Airtable pre-PATCH guard. |
| `apps/orchestrator/src/ledger/aiWorkerRepository.ts` | Modified | Allows sanitized failure `output_snapshot` for hard security failures. |
| `apps/orchestrator/src/server.ts` | Modified | Starts the AI Composer RabbitMQ consumer instead of polling worker. |
| `apps/orchestrator/src/__tests__/aiComposerRabbitmqConsumer.test.ts` | Created | Tests ACK order, DLQ confirm-before-ACK, and retry NACK behavior. |
| `apps/orchestrator/src/__tests__/aiComposerWorker.test.ts` | Modified | Tests prompt-injection hash-only persistence and Airtable optimistic guard compensation. |
| `apps/orchestrator/src/__tests__/approvedPostWorker.test.ts` | Modified | Tests US-002 to US-003 references-only queue handoff. |
| `run-tests.mjs` | Modified | Includes AI Composer RabbitMQ consumer tests. |
| `docs/plans/US-003/US-003-implementation-security-gate.md` | Modified | Updated SEC-004, SEC-005, SEC-008, SEC-016, and SEC-018 to pass. |
| `docs/requirements/05_Function_Flow_Logic_Register.md` | Modified | Updated FL-002 for RabbitMQ handoff, hash-only hard failures, ACK/DLQ, and Airtable sync guard. |

## Impact & Purpose
US-003 now has an asynchronous RabbitMQ execution path aligned with the architecture. The AI Composer queue contract prevents raw content or secrets from entering RabbitMQ, hard prompt-injection failures avoid persisting malicious output, and Airtable sync is guarded against stale state changes after Ledger success.

## Decisions Made
| Decision | Rationale | Alternatives Considered |
|:---|:---|:---|
| Publish US-003 queue message after US-002 workflow stub commit | Prevents AI work from starting without durable Ledger handoff. | Polling `workflow_runs` only, rejected because user requested RabbitMQ. |
| Keep US-003 queue payload references-only | Matches architecture and prevents prompt/content leakage through RabbitMQ. | Include source copy or CTA in message, rejected by security rules. |
| ACK committed provider retry states instead of hot NACK loops | Retry state is durable in Ledger and avoids immediate redelivery loops. | NACK provider rate limits back to RabbitMQ, rejected due hot-loop risk. |
| Use hash-only snapshot for prompt injection | Supports forensic correlation without storing raw malicious output. | Store raw provider output, rejected by SEC-008. |

## Verification
- [x] Tests passed: `npm test` passed with 112 tests.
- [x] Build passed: `npm run build`.
- [x] Docs updated.
- [x] No secrets exposed.
- [x] Acceptance criteria met for remediated blockers: SEC-004, SEC-005, SEC-008, SEC-016, SEC-018.

## Open Items / Next Steps
- Add real DB-backed RLS fail-closed tests for SEC-001 and SEC-003.
- Add provider credential serialization regression tests for SEC-010.
- Expand Notion SSRF tests for private/metadata IP and redirect behavior.
- Add malformed-output and US-003 no-secret regression tests for remaining partial gates.
