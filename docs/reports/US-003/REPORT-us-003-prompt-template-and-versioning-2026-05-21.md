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

# Report: US-003 / T-006: Prompt Template and Versioning

**Date:** 2026-05-21
**Agent(s) Used:** Antigravity (applying backend-specialist and prompt-engineer persona)
**Related User Story:** US-003
**Status:** Completed

## Summary
Designed the comprehensive prompt templates, variables, versioning contract, injection boundaries, rollback strategy, and evaluation hooks for the AI Composer Facebook Variant in the MediaOps Composability platform.

---

## What Was Done
- [x] Read and analyzed all 10 mandatory project documents in required order.
- [x] Loaded Spawner developer skills: `prompt-engineer`, `llm-architect`, and `content-strategy` (including core patterns, anti-patterns, and sharp edges).
- [x] Established strict Prompt Input and Output Contracts aligning with the `AiInputSnapshot` and `StructuredComposerOutput` shapes.
- [x] Designed the System and User Prompt templates, enforcing clear section hierarchies (Role, Context, Instructions, Constraints, Examples).
- [x] Formulated an injection-resistant XML sandboxing strategy (`<notion_campaign_brief>`) for untrusted Notion contexts.
- [x] Locked down rules for 100% exact CTA URL and UTM parameters preservation.
- [x] Enforced narrative intent preservation, prohibiting phantom discount claims, pricing announcements, or deadline fabrications.
- [x] Created the Prompt Versioning and Registry architecture mapping semantic template naming (`fb_composer_v1.0.0`) to database metadata columns.
- [x] Connected active prompt versions to composite database ledger uniqueness and idempotency key generation.
- [x] Defined six high-fidelity Golden Fixtures representing standard flows, injections, fallbacks, and validation metrics.
- [x] Documented all security, logs sanitization, and connection isolation policies.
- [x] Post-review correction aligned nullable `campaign.objective` with T-005, changed missing CTA fixture output to omit `cta_url`, and refined Notion instructions so brand voice can be extracted while commands/overrides are ignored.

---

## How It Was Done

### Approach
The task was approached by establishing a robust, model-agnostic, and secure prompt template contract. The system instructions are designed as programming specifications—highly structured and guarded with explicit negative constraints to eliminate model variability. To defend against prompt injection from untrusted Notion campaign briefs, retrieved strings are wrapped within isolated XML delimiter tags accompanied by strict instruction override overrides. 

From a versioning perspective, the prompt version is fully integrated into the Postgres idempotency key composite to trigger cache-busting retries on template updates. Lastly, the rollback strategy avoids modifying historical ledger runs by deploying a pointer redirection model, preserving transactional audit integrity.

### Tools & Skills Used
| Tool/Skill | Purpose |
|:---|:---|
| `prompt-engineer` | Guided the construction of system instructions, few-shot structures, and negative prompt boundaries to guarantee formatting compliance. |
| `llm-architect` | Established strict JSON schema contracts and decoupled basic structural parsing from semantic validations. |
| `content-strategy` | Guided rules for brand voice adaptation, Facebook spacing, scannability, and UTM/CTA preservation. |
| `view_file` | Read the mandatory architecture, conventions, backlog, flow logic, and preceding design documents to ensure seamless context alignment. |
| `write_to_file` | Created the physical T-006 design blueprint and this completion report. |

### Files Changed
| File | Action | Description |
|:---|:---|:---|
| `docs/plans/US-003/US-003-prompt-template-and-versioning.md` | Created | Physical design specification for System/User prompt templates, XML delimitations, versioning registries, and golden fixtures. |
| `docs/reports/US-003/REPORT-us-003-prompt-template-and-versioning-2026-05-21.md` | Created | Operational post-work execution report capturing details of the prompt design task. |

---

## Impact & Purpose
This design guarantees that when the worker initiates an LLM call to draft a Facebook post, it does so using a secure, optimized, and completely reproducible prompt structure. The prompt-injection defenses ensure the orchestrator remains resilient against malicious overrides in Notion contexts. In addition, by integrating the prompt version into the idempotency ledger, we prevent costly duplicate billing while ensuring template iterations are propagated safely throughout active tenant workspaces.

---

## Decisions Made
| Decision | Rationale | Alternatives Considered |
|:---|:---|:---|
| **JSON Schema Output Enforcement** | Require the LLM to output a raw JSON object matching the required schema to facilitate automated parsing. | Returning natural language copy and relying on complex regex to extract tags and links (too fragile). |
| **XML Boundary for Notion Briefs** | Treat Notion contexts as untrusted and wrap them in `<notion_campaign_brief>` sandboxes to isolate overrides. | Direct string concatenation without boundaries (creates a high risk of prompt injection). |
| **Pointer Redirection for Rollbacks** | Updates registry flags (`active`, `rolled_back`) instead of mutating historical `ai_generation_runs` ledger records. | Overwriting `prompt_version` in older database rows (destroys historical audit trails). |
| **Notion as reference data, not executable instruction** | Allows the composer to use brand voice and audience context from Notion while rejecting embedded commands, schema changes, and bypass requests. | Ignoring all Notion guideline text entirely. Rejected because it would waste approved campaign context. |

---

## Verification
- [x] All 10 mandatory project docs read
- [x] Spawner developer skills loaded and applied
- [x] No credentials or secret keys exposed in prompts or logs
- [x] Input snapshot variables (`post.master_copy`, `post.cta_url`, etc.) mapped exactly
- [x] System/User prompt templates defined
- [x] Structured output contract defined matching Zod targets
- [x] Prompt injection XML delimiters sandboxed
- [x] Prompt versioning registry and rollback strategy established
- [x] Golden Fixtures drafted
- [x] Missing CTA fixture omits `cta_url` instead of setting it to `null`, matching T-003 optional output contract.
- [x] Acceptance criteria met: BR2 (Intent Preservation), BR3 (UTM Preservation), AC1 (Variant structure), and AC3 (Audit snap)

---

## Open Items / Next Steps
- **Add Loader-Local Error Codes:** The loader-local exceptions defined in `T-005` (`AIRTABLE_CONTEXT_UNREACHABLE`, `AIRTABLE_CONTEXT_INVALID`, `STALE_SOURCE_STATUS_CHANGED`) must be added additively to the shared error taxonomy (`AiErrorCode`) before implementation starts. This must be done without extending the scope of subsequent tasks.
- **Handoff to Validation (T-007):** Downstream task `T-007` must implement the physical Zod parse checks and the specific helper utilities for UTM parameters and hashtag normalizations.
- **Handoff to Adapter (T-008):** Downstream task `T-008` must build the modular provider client and map rate-limit retries based on the standardized retryable codes.
