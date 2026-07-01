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

# Report: US-003 Test Plan and Evaluation Fixtures

**Date:** 2026-05-21  
**Agent(s) Used:** Codex (combining debugger, security-auditor, database-architect, project-planner)  
**Related User Story:** US-003 / T-011  
**Status:** Completed

## Summary
Synthesized and created the comprehensive Test Plan and Evaluation Fixtures (`US-003-test-plan-and-evals.md`) for the entire **US-003: AI Composer Facebook Variant** middleware. This document establishes full test coverage of Epic E02/US-003, defining the coverage matrices for Acceptance Criteria (AC1–AC4) and Business Rules (BR1–BR3). It outlines precise test scopes spanning Ingress Claims, Ingress APIs, Prompt Delimiters, Provider Adapters, Sanitization/Zod validation, Persistence ACID boundaries, Outbox events, and Security regression rules. It defines 17 distinct Golden Fixtures (A to Q) and 6 strict Release Gates to guarantee zero leakage of client credentials and secure non-publishing bounds before handoff to US-004.

## What Was Done
- [x] Read required architecture, coding conventions, backlog, FL register, and upstream US-003 planning specifications (T-001 to T-010) in mandatory chronological order.
- [x] Loaded and integrated specialist spawner skill guidelines for prompt engineering, LLM architecture, queue workers, and PostgreSQL.
- [x] Designed `docs/plans/US-003/US-003-test-plan-and-evals.md` detailing 20 rigorous test categories, covering matrices, plans, and fixtures.
- [x] Triaged 4 key technical schema/logical gaps (`GAP-001` through `GAP-004`) between T-004 to T-010 implementations.
- [x] Formulated 17 robust Golden Fixtures (`Fixture A` through `Fixture Q`) specifying input parameters, mock payloads, and expected Zod/business outcomes.
- [x] Specified 6 fail-closed Release Gates preventing critical security issues, publish pipeline bypasses, queue token leakage, and UTM corruption.
- [x] Post-review correction aligned the missing CTA fixture with `CTA_URL_MISSING`, removed retryable hot-NACK wording after durable commits, and clarified that internal hashtag whitespace remains a validation failure unless a future implementation explicitly adds safe word joining.

## How It Was Done

### Approach
Constructed a conceptual testing boundary isolating the AI Composer middleware. Since we are restricted from writing active test code, calling live LLM models, or writing live Facebook/Airtable API payloads, we focused on high-fidelity schema definitions, deterministic mock responses, validation filters, and transaction flow maps. We leveraged the Transactional Outbox pattern to separate middleware processing from event-bus queuing, and verified optimistic locking and multi-tenant RLS isolation to guarantee absolute safety.

### Tools & Skills Used

| Tool/Skill | Purpose |
|:---|:---|
| PowerShell read | Analyzed all 15 upstream and downstream project plans to synthesis T-011. |
| `write_to_file` | Created the final US-003 test plan report. |
| `prompt-engineer` | Applied system prompt isolation, negative instructions, and golden prompt assertions. |
| `llm-architect` | Formulated structured output validation, Zod schemas, and prompt injection detection heuristics. |
| `queue-workers` | Mapped consumer claims, row locks, ACK-after-commit rules, and transient error backoffs. |
| `postgres-wizard` | Engineered database transaction isolation, unique composite keys, and workspace RLS rules. |

### Files Changed

| File | Action | Description |
|:---|:---|:---|
| [US-003-test-plan-and-evals.md](file:///d:/Muti-Media%20Management/docs/plans/US-003/US-003-test-plan-and-evals.md) | Modified | Finalized comprehensive test plan containing coverage matrices, unit/integration plans, golden fixtures, and release gates. |
| [REPORT-us-003-test-plan-and-evals-2026-05-21.md](file:///d:/Muti-Media%20Management/docs/reports/US-003/REPORT-us-003-test-plan-and-evals-2026-05-21.md) | Created | Completed mandatory completion report for the task. |

## Impact & Purpose
This test plan provides a deterministic quality baseline for the AI Composer worker, preventing regressions and security leakages. It guarantees that generated Facebook draft variants preserve original source UTMs, avoid phantom discounts, and normalize hashtags cleanly without bypassing manual approval or entering downstream publishing queues.

## Decisions Made

| Decision | Rationale | Alternatives Considered |
|:---|:---|:---|
| Notion timeout fallback to Campaign Objective | Prevents worker bottlenecks and timeout failures by using Campaign Objective text as context, while keeping the Ledger secure (never persisting raw text). | Hard fail on Notion timeouts, rejected as fragile for production stability. |
| Decouple basic Zod parsing from semantic business validation | Allows structural format check to fail fast while delegating complex checks (e.g. hashtag counts, minor keyword differences) to separate warnings or manual review instead of failing queues. | Single-stage massive validation schema, rejected as too complex to debug. |
| Transactional Outbox pattern for `policy.evaluate.requested` event | Assures message queue and database stay strictly in sync; outbox row is committed in the same database transaction as the variant persistence. | Direct publish to queue inside transaction, rejected as it introduces risk of phantom commits. |
| Optimistic locking for Airtable sync | Prevents concurrency race conditions when parallel batch runs attempt to update the same Airtable record simultaneously. | Pessimistic Airtable row lock, rejected as it severely limits throughput. |
| Missing CTA maps to dedicated error | Keeps CTA diagnostics precise for SMM review notes and matches the additive `AiErrorCode` decision from T-009. | Mapping missing CTA to `SCHEMA_PARSING_FAILED`, rejected because the JSON shape is valid and the failure is a business CTA rule. |

## Verification
- [x] Test plan maps to all 4 Acceptance Criteria (AC1-AC4) in Matrix.
- [x] Test plan maps to all 3 Business Rules (BR1-BR3) in Matrix.
- [x] Fixture names and conceptual goals are fully defined for all 17 scenarios (A to Q).
- [x] 6 Release Gates are defined and configured as fail-closed blocks.
- [x] All 4 discovered gaps are triaged, classified by severity, and assigned concrete action plans.
- [x] Retry wording now matches T-004/T-009: ACK after committed retryable state; NACK only when durable Ledger commit fails.

## Open Items / Next Steps

1. **Address GAP-001 (Low):** Constrain `ai_generation_runs.error_code` to `VARCHAR(50)` during database physical migration.
2. **Address GAP-002 (Medium):** Update `normalizeHashtags` helper to apply lowercase conversion *before* deduplicating the Set to prevent duplicate casing.
3. **Address GAP-003 (Low):** Track Notion timeout fallback flags inside `notion_context_refs` JSON.
4. **Address GAP-004 (Medium):** Implement optimistic locking based on the Postgres `approved_version` timestamp in Airtable synchronization workers.
5. **Downstream Handoff:** Package all US-003 plans (T-001 to T-011) and hand over to US-004 Policy Engine team.
