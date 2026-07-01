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

# Report: Shared AI Contracts

**Date:** 2026-05-21  
**Agent(s) Used:** Backend Specialist & LLM Architect (Gemini)  
**Related User Story:** US-003 / T-003  
**Status:** Completed  

## Summary
Designed the comprehensive, frozen TypeScript contracts and validation utility rules for the AI Composer in the MediaOps Composability platform. This document acts as a stable design spec for implementing `packages/shared-contracts` and downstream workers.

## What Was Done
- [x] Read and extracted architectural constraints from 10 priority documents.
- [x] Announce active agent knowledge (`backend-specialist` & `llm-architect`) and passed the mandatory Socratic Gate.
- [x] Designed compile-time and runtime TypeScript interfaces for:
  - Custom statuses and enums for AI generation runs and content variants.
  - Workflow run claim inputs and outputs.
  - Source context snapshots (`AiInputSnapshot`).
  - Notion guideline context references (`NotionContextRef`) with custom status tracking.
  - Structured output schemas from the LLM adapter (`StructuredComposerOutput`).
  - Persistent content variant entities (`ContentVariant`).
  - Error Taxonomy codes (`AiErrorCode`).
- [x] Formulated Zod structural validation boundaries and decoupled business validation rules.
- [x] Designed the permissive `normalizeHashtags` contract for resilient tag formatting.
- [x] Designed the exact `validateCtaUtmMatch` contract for UTM preservation and drift protection.
- [x] Defined Zero-Token credential leakage guards (compile-time Omit and runtime scan rules).
- [x] Outlined Schema Evolution guidelines for forward-compatibility.
- [x] Verified full coverage against Epic E02 (AI Orchestration) AC1–AC4 and BR1–BR3.
- [x] Prepared the task report mapping achievements and handoff details.
- [x] Post-review correction aligned `SafeChannelAccountRef` with the US-002 workflow stub contract and removed misleading webhook terminology from the AI claim section.

## How It Was Done
### Approach
The task was performed using a document-first contract design methodology. By defining TypeScript typings, enums, Zod structural shape boundaries, decoupled business utilities, and security guards in markdown, the development team can proceed to coding without needing to invent statuses, schema shapes, or error codes.

Three strategic decisions resolved through Socratic interaction with the user were integrated:
1. **UTM Decoupling:** Decoupled business parameter validations from basic Zod shape checking to allow workers to emit specific `CTA_UTM_MUTATED` errors.
2. **Permissive Normalization:** Implemented a hashtag normalization layer to prepend missing `#` symbols, trim spaces, and deduplicate tags rather than failing jobs.
3. **Notion Fallback Trace:** Configured `NotionContextRef` to store audit-trail metadata when falls back to campaign objectives, avoiding silent fallbacks while ensuring zero raw body text storage.

### Tools & Skills Used
| Tool/Skill | Purpose |
|:---|:---|
| `view_file` | Used to inspect scope lock, backlog, and US-002 shared contracts to ensure strict architectural compliance. |
| `write_to_file` | Used to create the contract design document and this report. |
| `llm-architect` (Vibeship Spawner) | Applied structured output patterns, context preservation limits, and prompt-injection mitigations. |
| `backend-specialist` | Configured type-safe RLS-compliant workspace partitioning and zero-token logging. |

### Files Changed
| File | Action | Description |
|:---|:---|:---|
| [US-003-shared-ai-contracts.md](file:///d:/Muti-Media%20Management/docs/plans/US-003/US-003-shared-ai-contracts.md) | Created | Completed contract design specification covering typings, enums, Zod shapes, normalizers, validators, security controls, and handoffs. |
| [REPORT-us-003-shared-ai-contracts-2026-05-21.md](file:///d:/Muti-Media%20Management/docs/reports/US-003/REPORT-us-003-shared-ai-contracts-2026-05-21.md) | Created | Mandatory report documenting what was done, how it was done, decisions, verification, and next steps. |

## Impact & Purpose
This design provides a unified, locked contract specification that bridges US-002 and downstream US-003 tasks. It guarantees exactly-once processing, strict data partitioning, high observability through error taxonomy, zero secret leakage, and robust, resilient content validation.

## Decisions Made
| Decision | Rationale | Alternatives Considered |
|:---|:---|:---|
| **Decoupling UTM validation** | Keeping Zod schemas simple for shape validation; using a dedicated utility `validateCtaUtmMatch` for UTM parameters to return specific `CTA_UTM_MUTATED` codes. | Doing all checks inside Zod. Rejected because Zod error messages on custom refinements are noisy and lack specific taxonomic codes. |
| **Permissive tag normalization** | Prepends missing `#`, trims spacing, and deduplicates to avoid failing the workflow due to minor LLM whitespace/symbol errors. | Strict hashtag checking (fails the run if any tag lacks a `#`). Rejected as it creates excessive and unnecessary manual review overhead. |
| **Notion audit-trail fallback** | Notion refs store loading outcomes, error codes, and fallback flags without storing raw body text. | Silent fallback without ledger records or storing raw body text in the ledger. Both rejected (one lacks observability, the other leaks tokens/space). |
| **Omission of "approved" status** | Enforces the system-level rule that AI composer cannot auto-approve content (remains locked as `needs_review` draft variant). | Allowing AI to set approval status. Rejected to prevent bypassing human or programmatic review guardrails. |
| **Reuse US-002 channel account refs** | Prevents downstream type drift by inheriting `platform`, `channel_account_id`, `airtable_channel_account_record_id`, `external_account_id`, and `token_status` exactly from the workflow stub. | Defining a US-003-only account ref shape. Rejected because it would create adapter ambiguity between workflow creation and AI claim. |

## Verification
- [x] Typings strictly align with Postgres T-002 ledger schemas.
- [x] No secrets, tokens, or credentials are exposed in prompt scopes or snap interfaces.
- [x] All structures enforce the mandatory `workspace_id` tenant boundary.
- [x] Hashtags are strictly represented as a `string[]` arrays.
- [x] The `approved` status is excluded from enums to block accidental publishing.
- [x] Document contains sufficient detail for T-004 worker flow, T-005 loading, and T-007 validation.
- [x] `SafeChannelAccountRef` matches the US-002 workflow stub handoff contract.

## Open Items / Next Steps
- **Handoff to T-004 (Worker Flow):** Build the claim logic using Transaction B locks and update status transitions.
- **Handoff to T-005 (Context Loading):** Implement the secure Airtable + Notion loaders and format refs.
- **Handoff to T-007 (Validation):** Translate the Zod schema and normalization/preservation functions into real packages/shared-contracts code.
