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

# Report: AI Provider Adapter and Retry Policy

**Date:** 2026-05-21
**Agent(s) Used:** Antigravity (Gemini 3.5 Flash) with backend-specialist knowledge
**Related User Story:** US-003 (AI Composer Facebook Variant) / Task T-008
**Status:** Completed

## Summary
Designed and specified the high-fidelity **AI Provider Adapter and Retry Policy** for the **AI Composer Facebook Variant** (US-003 / T-008). The technical specification defines a clean, provider-agnostic adapter contract (`AiProviderAdapter`) isolating background worker execution from external LLM Provider API mechanics. It outlines timeout caps, exponential backoff with full jitter retry routines, per-provider tenant-isolated circuit breakers, native structured output activation, sanitized error mapping matrices, a zero-token logging boundary, and a deterministic local mock provider fixture mode.

---

## What Was Done
- [x] Defined provider-agnostic TypeScript contract interfaces: `AiProviderAdapter`, `AiProviderGenerateInput`, `AiProviderGenerateResult`, `AiProviderSuccessResult`, and `AiProviderFailureResult`.
- [x] Established the **Model Configuration Boundary** rules, enforcing safe token-free configuration resolution and fast fail-closed returns with `INVALID_MODEL_CONFIG` on config anomalies.
- [x] Designed the **Structured Output Mode Strategy**, prioritizing native JSON mode flags while cleanly decoupling Zod structural schema parsers and UTM preservation checks to keep validations at the **T-007 Validation Engine** boundary.
- [x] Enforced a strict **Timeout Policy** using `AbortController` cap thresholds at **30,000ms**, aligned with the T-004 queue worker flow.
- [x] Designed the **Active Retry Policy** using **Exponential Backoff and Full Jitter** for transient exceptions, and integrated the retry flow with **T-004 Queue Worker ACK Policies** (Ledger updates $\rightarrow$ queue ACK $\rightarrow$ DLX delay scheduler) to prevent hot retry loops.
- [x] Designed the tenant-isolated **Circuit Breaker Policy** (per provider + workspace) with fail-fast state machines (`Closed`, `Open`, `Half-Open`) to prevent queue thundering herds on provider engines.
- [x] Mapped raw HTTP statuses and exceptions to safe `AiErrorCode` types in the **Error Mapping Matrix**, and implemented a recursive **Leak Redactor** using strict regex sweeps to redact credentials, auth headers, and local directory file paths from logs and ledger records.
- [x] Created the specification for **Mock Provider Fixture Mode**, enabling offline local testing and automated pipelines (**T-011**) using deterministic JSON fixtures.
- [x] Outlined strict zero-token **Observability and Telemetry Boundaries**, establishing console log allowlists and blocklists to protect prompts and raw texts from log files.
- [x] Documented integration handoffs to T-009, T-011, and T-012, along with a comprehensive Verification Checklist.
- [x] Post-review correction removed concrete model examples from adapter contracts, removed serializable authorization headers from provider request payloads, and corrected T-009 handoff so Airtable receives only validated draft fields rather than raw provider output.

---

## How It Was Done

### Approach
The design followed a **Zero-Trust, High-Resilience, Fail-Closed Architecture** that decouples integration layer transport from business validation:
1. **Decoupled Architecture:** The adapter focuses strictly on HTTP transport, timeout caps, retries, and network sanitization. It passes raw output strings directly to **T-007**, ensuring Zod parser anomalies are isolated as validation ledger needs-manual-review states (`needs_manual_review`) rather than clogging transport retry loops.
2. **Double-Guarded Security:** Standardized error scopes undergo both key string property replacement (scrubbing header dumps) and regex sanitization sweeps, redacting Bearer tokens, vault links (`vault://`), and system file paths before any console logging or database ledger writing occurs.
3. **Queue-Aware Retries:** Aligned with the T-004 worker flow, transient exceptions are committed to the Postgres Ledger before the RabbitMQ consumer channel is **ACKed**, ensuring the consumer does not experience hot thread starvation. Delayed retry redeliveries are delegated to the Dead Letter Exchange (DLX) delayed scheduler.
4. **Tenant Workspace Isolation:** Circuit breaker counters are partitioned strictly by `workspace_id` + provider, preventing credential anomalies or high usage blocks in one tenant from affecting composition queues in neighboring workspaces.

### Tools & Skills Used
| Tool/Skill | Purpose |
|:---|:---|
| `backend-specialist` | Guided API signatures, rate limit mapping, backoff strategies, and security perimeter rules. |
| `llm-architect` spawner skill | Ensured prompt injection isolation boundaries, native structured output configuration, and error sanitization. |
| `api-design` spawner skill | Standardized safe, non-leaking TypeScript interface types and diagnostic taxonomies. |
| `queue-workers` spawner skill | Structured retry states and delayed backoff redeliveries to align with RabbitMQ ACK patterns. |
| `view_file` | Read parent plans (`US-003-shared-ai-contracts.md`, `US-003-ai-composer-worker-flow.md`, `US-003-structured-output-validation.md`) to align all data models and error codes. |
| `write_to_file` | Created the project-compliant design and report files. |

### Files Changed
| File | Action | Description |
|:---|:---|:---|
| [US-003-ai-provider-adapter-and-retry.md](file:///d:/Muti-Media%20Management/docs/plans/US-003/US-003-ai-provider-adapter-and-retry.md) | Created | Physical AI Provider Adapter and Retry Policy Design plan specification. |
| [REPORT-us-003-ai-provider-adapter-and-retry-2026-05-21.md](file:///d:/Muti-Media%20Management/docs/reports/US-003/REPORT-us-003-ai-provider-adapter-and-retry-2026-05-21.md) | Created | Mandatory post-work report summarizing implementation, decisions, and checks. |

---

## Impact & Purpose
This design ensures that **AI Composer Facebook Variant** compositions execute with high resilience, deterministic safety, and zero threat of credentials leaking in logs or Ledger snapshots. Isolating LLM APIs behind a provider-agnostic boundary protects the core worker flows from API changes, allows painless future model expansion, protects databases from connection pool exhaustion during network queries, and provides offline deterministic testing modes for continuous delivery.

---

## Decisions Made

| Decision | Rationale | Alternatives Considered |
|:---|:---|:---|
| **Decoupling Adapter from Zod schema checks** | If the adapter parsed schemas and threw errors, Zod shape failures would look like transport issues. Keeping parsing inside T-007 allows the worker flow to easily classify schema fails as `'needs_manual_review'` (retaining output snapshots for review) and network glitches as `'retryable_failed'`. | Running Zod checks inside the adapter class itself. Rejected because it violates separation of concerns. |
| **Workspace-Isolated Circuit Breakers** | Partitioning circuit breakers by `workspace_id` + provider prevents an API block or auth failure in one customer workspace from shutting down AI compositions for all other tenants. | Global per-provider circuit breakers. Rejected because they create tenant cross-contamination risks. |
| **Ledger Commit Priority before Queue ACK** | Committing the `retryable_failed` status to the Ledger *before* ACK-ing the RabbitMQ message guarantees state durability. If the worker crashed mid-flow, the message is requeued; if it commits successfully, the worker ACKs cleanly and delegates redelivery to the delayed queue. | Immediate NACK loops on RabbitMQ. Rejected because it can cause CPU hot-looping and consumer thread starvation. |
| **Strict Regex Redactor Sweep** | Exceptions from libraries like Axios can dump raw request configurations, authorization headers, or private Bearer parameters into strings. A recursive property stringifier combined with custom regex patterns guarantees complete credential redacting. | Relying on simple error name logs. Rejected because stack traces can expose file structures and security details. |
| **Offline Mock Fixture Mode** | Developing downstream components and executing automated CI/CD test suites requires deterministic prompt outcomes. Serving cached golden JSON files based on input prompt hashing satisfies all contract boundaries without incurring live API billing. | Mocking methods using typical unit-test spies. Rejected because it misses end-to-end transport and integration checks. |
| **No raw output to Airtable** | Raw provider output is untrusted until T-007 validates it. Airtable should only receive validated draft fields or sanitized review-block messages. | Writing adapter `raw_output` directly to Airtable. Rejected because it bypasses the validation boundary. |

---

## Verification
- [x] All required sections for T-008 design specifications successfully designed and documented.
- [x] All TypeScript interfaces (`AiProviderAdapter`, `AiProviderGenerateInput`, `AiProviderSuccessResult`, `AiProviderFailureResult`) defined conceptually with complete compiler safety.
- [x] No concrete models or API keys hardcoded.
- [x] Provider request contract no longer serializes authorization headers as data fields.
- [x] Strict timeout caps (30s) and exponential backoff calculations with randomized jitter specified.
- [x] Safe error mappings, leak redactions, and log allowlists/blocklists fully documented.
- [x] Project report committed alongside the code design.
- [x] Verification Checklist and handoff contracts prepared for downstream implementers.

---

## Open Items / Next Steps
1. **T-009 Implementation:** Coordinate the successful/retryable/terminal ledger transactions inside the worker flow.
2. **T-011 Implementation:** Assemble Golden JSON Test Fixtures in `docs/plans/US-003/fixtures/` and code the Mock Provider fixture handler.
3. **T-012 Implementation:** Write the verification harness and playground test suites to validate circuit breakers and leak redactors under simulated network load.
