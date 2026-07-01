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

# Report: US-003 / T-009: Variant Persistence and Airtable Update Design

**Date:** 2026-05-21  
**Agent(s) Used:** Backend Specialist & Database Architect  
**Related User Story:** US-003 (AI Composer Facebook Variant)  
**Status:** Completed  

## Summary

This report documents the completion of the technical design specification for **US-003 / T-009: Variant Persistence and Airtable Update** for the *AI Composer Facebook Variant*. The task defines the exact transaction boundaries in Postgres, updates the operational statuses, persists the active drafts in `content_variants` with a new self-healing background synchronization retry flag, performs soft-mapped Airtable draft syncs, implements compensation strategies when Airtable fails, and records audit logs—all while adhering to multi-tenant workspace isolation and strict token redaction boundaries.

This is a **document-based contract design specification**; no active runtime JavaScript code or SQL migrations were executed. It establishes a complete, frozen design blueprint that guarantees consistency across the Orchestration & AI Middleware layer.

## What Was Done

- [x] Evaluated 13 referenced system documents in chronological order to extract key architectural boundaries, coding conventions, and product backlog acceptance criteria.
- [x] Designed Postgres transaction lifecycles covering all execution paths: Happy Path (Success), Validation / Quality Failure, Security Block, Provider Retryable Failure, and Terminal Config Failure.
- [x] Structured the **Airtable Mapping Schema Config Block** (`AirtableVariantFieldMapping`) interface to soft-map physical Airtable columns, preventing schema hardcoding.
- [x] Formulated the **Airtable Failure Compensation** mechanism using an additive database flag (`sync_retry_needed`) and a tenant-scoped partial index to handle post-commit writeout errors.
- [x] Documented exactly-once idempotency deduplication checks and cached output reuse paths.
- [x] Established the **Audit Events Taxonomy** with precise structural metadata schemas.
- [x] Mapped additive extensions to `AiErrorCode` for validation chẩn đoán (`CTA_URL_INVALID`, `CTA_URL_MISSING`).
- [x] Specified strict multi-tenant Row-Level Security (RLS) constraints and log redaction filters.
- [x] Created `docs/plans/US-003/US-003-variant-persistence-and-airtable-update.md` to serve as the physical design specification.
- [x] Post-review correction fixed the T-004 document link, removed concrete provider/model examples from input contracts and audit metadata, added missing success writes for `input_snapshot`, `notion_context_refs`, `provider`, `model`, and `prompt_version`, and realigned downstream handoffs with T-010/T-011/T-012 in the US-003 plan.

## How It Was Done

### Approach
The specification was built using a **Database-First Commit Boundary**. To avoid database connection starvation, all external API integrations (Airtable writebacks) are strictly isolated from Postgres transaction blocks and occur post-commit. If the post-commit sync fails, we use a database-driven self-healing retry flag (`sync_retry_needed`) rather than rolling back committed transactions, ensuring consistent state representation. High-performance tenant-scoped partial indexing optimizes the background retry process.

### Tools & Skills Used
| Tool/Skill | Purpose |
|:---|:---|
| Postgres Wizard Skill | Designing row locking, indexing, multi-tenant RLS, and transactional boundaries. |
| API Design Skill | Structuring soft-mapping interfaces, error mapping, and boundary controls. |
| Event Architect Skill | Designing idempotency keys, duplicate handling, and exactly-once event lifecycle transitions. |
| View File Tool | Reviewing upstream plans and dependencies for complete alignment. |
| Write to File Tool | Creating the final specification and report files. |

### Files Changed
| File | Action | Description |
|:---|:---|:---|
| [US-003-variant-persistence-and-airtable-update.md](file:///d:/Muti-Media%20Management/docs/plans/US-003/US-003-variant-persistence-and-airtable-update.md) | Created | The detailed technical design specification for Task T-009. |
| [REPORT-us-003-variant-persistence-and-airtable-update-2026-05-21.md](file:///d:/Muti-Media%20Management/docs/reports/US-003/REPORT-us-003-variant-persistence-and-airtable-update-2026-05-21.md) | Created | The mandatory completion report for US-003 / T-009. |

## Impact & Purpose

This design bridges the gap between raw LLM generation/validation outcomes and external representation in the SMM Control Plane (Airtable). By providing clear transactional flows and decoupling Airtable schemas via mapping configurations, it ensures high system resiliency, protects against database thread locks during API outages, maintains strict multi-tenant privacy boundaries, and provides a clear pathway for developers to implement the downstream integration code.

## Decisions Made

| Decision | Rationale | Alternatives Considered |
|:---|:---|:---|
| **Post-Commit Airtable Sync** | Network I/O to external APIs must never block active Postgres transactions to prevent connection pool exhaustion. | Running the Airtable API calls inside the active Postgres transaction (Rejected due to database starvation risks). |
| **`sync_retry_needed` Flag and Partial Index** | Setting an additive BOOLEAN flag post-commit failure enables background workers to scan and retry syncs efficiently. | Scanning audit logs to detect failed syncs (Rejected due to high performance costs and keeping audit logs append-only). |
| **Additive `AiErrorCode` Extension** | Bypassing CTA_UTM_MUTATED grouping for `CTA_URL_INVALID` and `CTA_URL_MISSING` provides precise diagnostic info in Airtable review notes. | Mapping all CTA issues directly to `CTA_UTM_MUTATED` (Rejected due to poor reviewer user experience). |
| **Airtable Soft-Mapping Config** | Standardizing semantic keys internally and mapping them via a configuration block prevents tight coupling to Airtable schema changes. | Hardcoding physical Airtable column names in the source code (Rejected due to high maintenance overhead). |
| **Draft-Only Bypasses** | Enforcing `needs_review` and `pending_policy` on upserts ensures the AI Composer remains strictly a draft creation engine. | Allowing LLM output variables to trigger automated `Approved` status mutations (Rejected to maintain strict fail-closed review rules). |
| **Persist validated snapshots only** | Success writes store validated output, input snapshot, Notion refs, and safe provider metadata. Validation failures may store only sanitized partial structured output or hashes, never raw provider output. | Persisting raw unvalidated provider output directly. Rejected because it bypasses the T-007 validation boundary. |

## Verification

- [x] Checked specification against US-002 workflow claiming hooks to ensure compatibility.
- [x] Asserted that all Postgres SQL statements are partitioned strictly by `workspace_id`.
- [x] Verified that enums match T-002 designs.
- [x] Confirmed zero cryptographic keys, bearer tokens, or secrets are referenced or stored.
- [x] Ensured Notion references are reference-only and raw markdown dumps are barred.
- [x] Created the complete technical verification checklist inside the specification.
- [x] Confirmed downstream handoff labels now match the US-003 task plan: T-010 Policy Handoff, T-011 Test Plan, T-012 Security Review.

## Open Items / Next Steps

1. **Airtable Field Name Finalization:**
   * *Open Item:* The physical field names on Airtable (e.g. `facebook_variant_draft`) must be formally confirmed from US-001/US-002 implementations before coding. Core logic must strictly utilize semantic keys, and the mapping block will resolve them to physical names.
2. **packages/shared-contracts Update:**
   * *Next Step:* Implement the additive changes in `AiErrorCode` to include `CTA_URL_INVALID` and `CTA_URL_MISSING` in `packages/shared-contracts/src/ai/errors.ts` during the coding phase.
3. **Database Migration Scripting:**
   * *Next Step:* Create the additive migration script adding the `sync_retry_needed` column and `idx_content_variants_sync_retry` index during the implementation phase.
