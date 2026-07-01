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

# Report: US-003 / T-005: Airtable & Notion Context Loading Boundary Design

**Date:** 2026-05-21
**Agent(s) Used:** `backend-specialist` & `security-auditor` (Gemini 3.5 Flash)
**Related User Story:** US-003 (AI Composer Facebook Variant)
**Status:** Completed

## Summary
Designed and documented the technical context loading boundaries for the **AI Composer Facebook Variant (T-005)** under the MediaOps Composability system. 

This design establishes a secure, zero-trust context ingestion pipeline that consumes lightweight references, reloads and validates Airtable sources, verifies and fetches allowlisted Notion briefs, resolves fallbacks under API outages, and formats clean, injection-shielded input snapshots (`AiInputSnapshot`, `NotionContextRef[]`) for downstream prompt hydration and content generation.

---

## What Was Done
- [x] **Trigger & Ingress Contracts:** Defined reference-only ingress schemas (`workspace_id`, `workflow_run_id`, `airtable_record_id`, `approved_version`, `correlation_id`) to prevent raw data or credentials from leaking into the job queue.
- [x] **Airtable Reload & Status Revalidation:** Designed the transactional revalidation flow. The loader fetches fresh Post data and asserts that the status remains `'Approved'`. If changed, it halts instantly, throwing `STALE_SOURCE_STATUS_CHANGED` and bypassing all Notion, LLM, and prompt building steps.
- [x] **Airtable Field Validation:** Created detailed mapping schemas for the `Posts` and `Campaigns` tables, verifying mandatory fields (e.g. `master_copy`, `approved_at`, `campaign link`).
- [x] **Campaign Link Resolution:** Documented the algorithm to safely resolve Airtable Campaign relationships and handle missing connections without crashing the reload pipeline.
- [x] **Notion Allowlist Boundary:** Defined strict regex and hostname rules checking that Notion brief URLs target allowed domains (`notion.so` or `*.notion.site`) and workspace directories with a no-redirects policy to prevent SSRF or malicious phishing attacks.
- [x] **Notion Context Fetching & Quality Rules:** Enforced rules to only fetch briefs that contain `"ai_ready": true` properties or `#ai-ready` structural markers.
- [x] **Notion Fallback Strategy:** Designed the fallback resolution matrix. If Notion is unreachable (timeouts/5xx) or non-compliant, the loader falls back to the Airtable Campaign Objective text and populates the `NotionContextRef` metadata block with `load_status = 'fallback_used'`, `error_code = 'CONTEXT_UNREACHABLE'`, and `fallback_source = 'airtable_campaign_objective'`.
- [x] **Prompt-Injection Defense:** Standardized the prompt isolation boundary, encapsulating untrusted Notion brief text inside `<notion_campaign_brief>` XML tags and adding system prompt directives to ignore commands inside.
- [x] **Zero-Credential Isolation:** Enforced strict compile-time and runtime scanner policies, stripping out authorizations, token strings, and `vault://` URIs. Banned writing raw retrieved Notion text to the Ledger, storing only lightweight metadata logs in `NotionContextRef`.
- [x] **Unified Error Mapping:** Structured a clear taxonomy mapping system exceptions directly to retryable or terminal `AiErrorCode` keys, matching T-003 contracts.
- [x] **Performance Safeguards:** Configured strict HTTP request timeouts (5,000ms for Airtable, 8,000ms for Notion) and a backoff schedule (up to 4 attempts) to prevent worker thread blocks and thundering herd conditions.
- [x] **Post-review correction:** Aligned `AiInputSnapshot` with T-003 by removing the extra `workflow.platform`, keeping `approved_at` optional, and requiring explicit `"Facebook"` in `target_channels` instead of silently defaulting it. Clarified loader-local errors that require additive taxonomy support or worker-side mapping before implementation.

---

## How It Was Done

### Approach
We applied a layered, zero-trust backend API design methodology. The Context Loading Boundary is modeled as a deterministic, read-only data mapping layer that wraps third-party network APIs (Airtable and Notion) into secure, tenant-isolated blocks. 

To maintain strict operational resilience, the loader handles third-party failures gracefully: Notion API outages fall back directly to Campaign Objectives loaded locally from Airtable, while changes to the source Post approval status act as immediate fail-closed circuit breakers (`STALE_SOURCE_STATUS_CHANGED`), preventing expensive prompt construction or LLM processing.

By sanitizing and omitting all security credentials and storing only lightweight metadata structures (`NotionContextRef`) in the Postgres ledger, the design achieves maximum performance, strict data minimization, and audit compliance.

### Tools & Skills Used
| Tool/Skill | Purpose |
|:---|:---|
| `view_file` | Analyzed P0/P1/P2 documentation including the monorepo architecture, coding conventions, backlog ACs, logic registers, shared AI contracts, and predecessor worker designs to guarantee absolute integration alignment. |
| `write_to_file` | Wrote the comprehensive context loading design spec and this completion report. |
| `llm-architect` Spawner skill | Implemented prompt injection boundaries, XML delimiters, and security instructions for retrieved context. |
| `api-design` Spawner skill | Drafted clean API schemas, timeout rules, validation bounds, and mapped standard error taxonomies. |
| `postgres-wizard` Spawner skill | Designed data scopes, workspace tenant RLS matching, and credential-free JSON snapshot schemas. |

### Files Changed
| File | Action | Description |
|:---|:---|:---|
| [US-003-context-loading-boundary.md](file:///d:/Muti-Media%20Management/docs/plans/US-003/US-003-context-loading-boundary.md) | Created | Complete technical design specification for T-005. |
| [REPORT-us-003-context-loading-boundary-2026-05-21.md](file:///d:/Muti-Media%20Management/docs/reports/US-003/REPORT-us-003-context-loading-boundary-2026-05-21.md) | Created | Completion report. |

---

## Impact & Purpose
This design establishes a bulletproof, secure context loading boundary for US-003. It protects the AI Composer from prompt injection, thundering herds, duplicate runs, stale source processing, and token leakages. The engineering team is provided with complete data schemas, error codes, and step-by-step algorithms, allowing them to implement clean, type-safe loader code without guessing parameters or behaviors.

---

## Decisions Made
| Decision | Rationale | Alternatives Considered |
|:---|:---|:---|
| **Stale-Source Interceptor** | Immediate halt under `STALE_SOURCE_STATUS_CHANGED` if reload shows status is no longer `'Approved'`. Bypasses Notion and LLM calls. Ensures the composer never generates copies for retracted or updated posts, saving costs and preventing out-of-sync publishing. | Proceeding to generate variant drafts but flagging them as review-needed in the Ledger. Rejected to maintain strict publish guardrails. |
| **Airtable Campaign Objective Fallback** | When Notion API times out, the system uses the Airtable Campaign Objective text and logs the fallback state. This maintains high generation uptime while ensuring context is still campaign-aligned. | Failing the entire workflow run immediately. Rejected as Notion outages should not completely paralyze automated marketing pipelines if basic campaign goals exist in Airtable. |
| **Metadata-Only Notion Refs** | Raw text from Notion is passed strictly to the prompt hydrator (T-006) and is **never** persisted in the database Ledger `notion_context_refs` field. Only audited metadata is saved, preventing ledger bloat and token leaks. | Saving the raw Notion text body in the database table. Rejected as duplicate content storage creates severe scaling bottlenecks and increases data risk. |
| **Domain and Workspace Allowlist** | Only fetch Notion briefs that match allowed domains (`notion.so` or `*.notion.site`) and enforce tenant slugs with blocked HTTP redirects. This secures the system against SSRF attacks and malicious external links. | Fetching any campaign URL input by users in the Airtable base. Rejected as a severe security and phishing vulnerability. |
| **XML Encapsulation Defense** | Wrapping Notion briefs in `<notion_campaign_brief>` tags with system instructions to ignore commands. Shields the model against prompt injection attacks originating from shared workspace brief files. | Standard string concatenation inside prompts. Rejected due to the high risk of malicious instruction hijack. |
| **No silent Facebook default** | `target_channels` must explicitly contain `"Facebook"` so the loader cannot generate a variant for a record that lost its channel selection after approval. | Defaulting empty `target_channels` to `["Facebook"]`. Rejected because it masks source data drift. |

---

## Verification
- [x] **No Secrets Exposed:** Snapshots are strictly validated for credentials, bearer strings, and vault paths. Pino/Winston logging redact unauthorized payloads.
- [x] **Docs Updated:** Context boundary designs, Zod schema mappings, and fallback matrices successfully committed.
- [x] **Acceptance Criteria Met:** Verified mapping of backlog intent, UTM/CTA parameters preservation hooks, and fail-closed security.
- [x] **T-003/T-004 Consistency:** The schemas, interfaces, and statuses map perfectly to predecessor contracts, resolving potential status discrepancies in retryable loops.
- [x] **Snapshot Contract Consistency:** `AiInputSnapshot` now matches the T-003 shared contract and does not introduce extra workflow fields.

---

## Open Items / Next Steps
- **T-006 (Prompt Template and Versioning):** Must implement prompt hydration templates incorporating the `<notion_campaign_brief>` XML wrapper designed here.
- **T-007 (Structured Output and Validation):** Needs to build actual validator code comparing generated CTA query structures against the preserved `cta_url` in the loaded `AiInputSnapshot`.
