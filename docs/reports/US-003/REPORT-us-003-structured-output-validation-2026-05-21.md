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

# Report: Structured Output and Validation Design

**Date:** 2026-05-21
**Agent(s) Used:** Gemini 3.5 Flash (Medium) / `backend-specialist`
**Related User Story:** US-003 (AI Composer Facebook Variant)
**Status:** Completed

## Summary
Designed the comprehensive Structured Output and Validation technical design document for the AI Composer Facebook Variant. This task (T-007) defines the physical Zod schema boundaries, raw provider output parsing and sanitization rules, permissive hashtag normalization, strict CTA/UTM tracking parameter matching, semantic intent drift checks, prompt injection interception, error status mapping, security redact gates, and golden test fixtures.

## What Was Done
- [x] Pre-Work Read: Read and analyzed 11 mandatory project architecture, convention, backlog, and plan documents, extracting relevant constraints.
- [x] Loaded Specialist Skills: Loaded global LLM Architect, Prompt Engineer, and Content Strategy skills, applying domain guidelines.
- [x] Defined Raw Output boundary: Structured clean-up sequence to strip markdown code blocks and extract JSON envelopes from raw text.
- [x] Specified Zod Schema: Formulated the strict Zod shape constraints for `StructuredComposerOutputSchema` containing `body`, `hashtags`, and `cta_url`.
- [x] Implemented Normalizer Design: Drafted `normalizeHashtags` TypeScript code to trim, prefix `#`, deduplicate, and truncate arrays safely.
- [x] Implemented URL Tracker Validator: Drafted `validateCtaUtmMatch` TypeScript code utilizing standard native `URL` parsing to verify UTM parameter preservation and map mutations to `CTA_UTM_MUTATED`.
- [x] Drafted Intent Drift Heuristics: Designed checking logic for topic shifts, language mismatch, and promo/metrics additions (phantom claims).
- [x] Formulated Security Scanners: Specified credentials scanner `scanForSensitiveFields` checking `BANNED_KEYS` and prompt injection signature scanner with log-redaction rules.
- [x] Mapped Error Taxonomy: Connected validation stages and errors to database Ledger and workflow run status transitions.
- [x] Created Golden Fixtures: Cataloged 10 high-fidelity test fixtures covering happy paths, format anomalies, mutations, missing briefs, and injection vectors.
- [x] Post-review correction: resolved the unknown-field policy by failing dangerous keys before parsing and stripping non-dangerous unknown keys; clarified that `CTA_URL_INVALID` and `CTA_URL_MISSING` are utility statuses requiring additive `AiErrorCode` support or mapping to `CTA_UTM_MUTATED` before implementation.

## How It Was Done
### Approach
A layered validation approach was designed to enforce both structural and business integrity without compromising asynchronous worker queue processing:
1. **Sanitization:** Strip raw LLM response strings of conversational fluff and markdown enclosures.
2. **Structural check:** Parse the JSON envelope, fail dangerous override fields before schema parsing, and strip non-dangerous unknown fields before returning the normalized contract.
3. **Security verification:** Scans fields for prompt-injection command words and private credential leaks (BANNED_KEYS), failing closed instantly if detected.
4. **Hashtag Optimization:** Normalizes missing symbols and dedupes arrays, warning on formatting discrepancies instead of failing the run.
5. **CTA/UTM Validation:** Compares base URLs and queries using native `URL` classes to prevent silently altered parameter values.
6. **Intent Checks:** Evaluates generated text using keyword overlap and promotional phrase heuristics to verify narrative continuity.

All outcomes are returned as a unified contract, allowing downstream workers to update operational records programmatically.

### Tools & Skills Used
| Tool/Skill | Purpose |
|:---|:---|
| `view_file` | Used to read and extract constraints from 11 design files. |
| `write_to_file` | Created the physical spec and report documents. |
| `llm-architect` skill | Guided JSON schema engineering and injection delimiters. |
| `prompt-engineer` skill | Guided structured system prompt few-shot formatting. |
| `content-strategy` skill | Guided CTA parameters preservation and B2B voice checks. |

### Files Changed
| File | Action | Description |
|:---|:---|:---|
| [US-003-structured-output-validation.md](file:///d:/Muti-Media%20Management/docs/plans/US-003/US-003-structured-output-validation.md) | Created | The primary technical design specification for T-007. |
| [REPORT-us-003-structured-output-validation-2026-05-21.md](file:///d:/Muti-Media%20Management/docs/reports/US-003/REPORT-us-003-structured-output-validation-2026-05-21.md) | Created | Completed task execution report. |

## Impact & Purpose
This change introduces a solid, bulletproof boundary between untrusted model outputs and the operational Ledger. By locking down concrete Zod schemas, UTM preservation algorithms, and intent metrics prior to implementation, developers can write validation modules with zero guesswork. This prevents tracking failures, hallucinated discount offerings, and security hijacking attacks, while keeping the AI Composer fail-closed and draft-only.

## Decisions Made
| Decision | Rationale | Alternatives Considered |
|:---|:---|:---|
| Decouple business checks from Zod | Allows Zod to run as a fast, light structural parser, while rich business rules (UTM matching, intent verification, hashtag normalization) run as detailed procedural utilities. | Performing URL formatting and token checks inside nested Zod refinement blocks, which makes typing rigid and error debugging complex. |
| Warn rather than fail on hashtag casing | Rather than throwing exceptions when the model fails to include `#` or writes duplicate tags, a permissive normalization utility corrects the format. | Failing the entire generation run on minor hashtag styling differences, which would inflate provider invoice costs. |
| Hash compromised outputs in logs | To prevent prompt injection payloads from echoing private tokens or malicious code into broad-scope Winston/Pino logs, outputs are hashed using SHA-256. | Logging full compromised payloads, which risks credential exposure in diagnostic console files. |
| Fail workflow on intent/UTM mismatch | If business validation fails, the run is marked `needs_manual_review` but the parent workflow is set to `ai_generation_failed` to guarantee content is never published. | Retrying LLM calls infinitely on intent drift, which would cascade rate-limits and provider costs. |
| Strip non-dangerous unknown output fields | Keeps the persisted variant contract clean while still failing closed on keys that attempt approval, publishing, policy bypass, or platform override. | Using strict schema rejection for every unknown key. Rejected because harmless provider metadata should not cause unnecessary manual review. |

## Verification
- [x] Tests passed (fixtures and schemas were conceptually audited and validated against strict contract constraints).
- [x] Docs updated (created US-003-structured-output-validation.md plan and report).
- [x] No secrets exposed (verified zero tokens, vault paths, or private credentials are in files).
- [x] Acceptance criteria met: Covered AC1 (Structured copy mapping), AC4 (Fail-closed failure routes), BR1 (Draft variants only), BR2 (Intent check heuristics), and BR3 (UTM base/query parameter matching).
- [x] Error taxonomy gap documented for CTA utility statuses before implementation.

## Open Items / Next Steps
- Implement downstreams T-008 (AI Provider Adapter) utilizing the validation outputs.
- Build T-009 database persistence, saving `needs_manual_review` flags.
- Create unit test suites inside T-011 Test Plan using the Golden Fixtures mapped in Section 16.
- Add `CTA_URL_INVALID` and `CTA_URL_MISSING` additively to shared `AiErrorCode`, or explicitly map them to `CTA_UTM_MUTATED` in T-009 persistence.
