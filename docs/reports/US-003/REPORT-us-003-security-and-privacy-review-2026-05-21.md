# Report: Security and Privacy Review for AI Composer Facebook Variant

**Date:** 2026-05-21  
**Agent(s) Used:** `security-auditor` (Antigravity AI)  
**Related User Story:** US-003 (T-012)  
**Status:** Completed (Conditional Approval)

---

## Summary
Accomplished the formal Security and Privacy Review (**T-012**) for the **AI Composer Facebook Variant** design. The review represents a rigorous design-level audit spanning 21 architectural sections and evaluating the seven critical security dimensions. The review has concluded with a **Conditional Approval** release decision and established four mandatory remediation controls to be executed during the development phase.

---

## What Was Done
- [x] Audited all 11 intermediate design blueprints (`PLAN-us-003`, `US-003-scope-lock`, `US-003-ai-ledger-schema-and-idempotency`, `US-003-shared-ai-contracts`, `US-003-ai-composer-worker-flow`, `US-003-context-loading-boundary`, `US-003-prompt-template-and-versioning`, `US-003-structured-output-validation`, `US-003-ai-provider-adapter-and-retry`, `US-003-variant-persistence-and-airtable-update`, and `US-003-test-plan-and-evals`).
- [x] Completed a comprehensive Threat Modeling analysis and mapped out the attack surface boundaries.
- [x] Evaluated the seven platform security dimensions: publish boundaries, token leakage, prompt injection overrides, Ledger multi-tenant isolation, queue transit privacy, Airtable/Notion context loading limits, and provider API egress boundaries.
- [x] Resolved critical security ambiguities around:
  - Mandatory session-local `SET LOCAL app.current_workspace_id` scoping inside database transactions.
  - Strict official Notion domain allowlisting, non-redirect policies, and post-resolve IP validation checks (SSRF mitigation).
  - Robust failure segregation separating **Soft Fail-Closed** states (e.g. `INTENT_DRIFT`, `CTA_UTM_MUTATED`, `SCHEMA_PARSING_FAILED` -> `needs_manual_review` status, no active variant draft) from **Hard Fail-Closed** states (e.g. `PROMPT_INJECTION_DETECTED`, dangerous system bypass overrides -> `failed` status, no active variant draft, redact raw malicious outputs, record `rawOutputHash`).
- [x] Authored the formal 21-section security review document at `docs/plans/US-003/US-003-security-and-privacy-review.md`.
- [x] Post-review correction: aligned the document metadata and severity model with the final Conditional Approval decision.
- [x] Compiled this post-work report mapping files changed, tools/skills used, and implementation verification steps.

---

## How It Was Done

### Approach
The review was conducted as a threat-informed design audit using the OWASP Top 10:2025 risk framework and zero-trust security principles. 
1. **Asset Identification:** We mapped out all sensitive elements, primarily multi-tenant variant data, campaign brief contexts, and provider/platform credentials.
2. **Boundary Analysis:** We traced individual data flow paths from third-party networks (Notion, AI Provider APIs) and untrusted human ingress interfaces (Airtable fields).
3. **Control Selection:** We formulated defensive controls at all system boundaries (such as SQL session variables, IP target lookup filters, standard URL parsers, and XML delimiters).
4. **Resiliency & Fault Tolerance:** We mapped out a fail-closed error handling matrix, ensuring that validation and parsing failures transition gracefully into manual review slots rather than halting async workers or silently bypassing security policies.

### Tools & Skills Used
| Tool/Skill | Purpose |
| :--- | :--- |
| `security-auditor` Agent | Elite cybersecurity expert persona enforcing Assume Breach, Zero Trust, and Fail Secure philosophies. |
| `~/.spawner/skills/ai/llm-architect/` | Verified prompt delimiters and sanitization structures for dynamic snapshot storage. |
| `~/.spawner/skills/data/postgres-wizard/` | Structured composite unique indexes and session-local row-level security policies. |
| `~/.spawner/skills/backend/api-design/` | Defined HTTP maxRedirect filters and DNS-level IP resolving blocks (SSRF). |
| `~/.spawner/skills/backend/queue-workers/` | Enforced references-only queue messages and worker ACK-after-commit lifecycles. |
| `view_file` & `write_to_file` | Read the US-003 design documents and wrote the final review and report files. |

### Files Changed
| File | Action | Description |
| :--- | :--- | :--- |
| `docs/plans/US-003/US-003-security-and-privacy-review.md` | **Created / Modified** | The formal, 21-section Security and Privacy Review baseline containing findings, remediation rules, gate decision, and aligned Conditional Approval metadata. |
| `docs/reports/US-003/REPORT-us-003-security-and-privacy-review-2026-05-21.md` | **Created / Modified** | This mandatory post-work report matching the AGENTS.md template conventions and recording post-review corrections. |

---

## Impact & Purpose
This security review functions as the mandatory architectural gatekeeper (T-012) for the AI Composer. By locking down multi-tenant RLS, strict SSRF validations, zero-token logging policies, and failure segregation boundaries at the design level, the development team is provided with strict implementation specs. This prevents critical vulnerabilities (cross-tenant data leaks, server SSRF compromises, prompt injections auto-approving content, or API key exposures in stack traces) from entering the codebase, protecting the platform before the first line of runtime code is written.

---

## Decisions Made

| Decision | Rationale | Alternatives Considered |
| :--- | :--- | :--- |
| **Mandatory SQL `SET LOCAL` transaction wrapper** | Setting the local workspace context (`SET LOCAL app.current_workspace_id = :workspace_id`) creates a fail-closed partition boundary. If a developer omits the key in queries, Postgres immediately crashes instead of leaking multi-tenant rows. | Relying on developer discipline to always append `WHERE workspace_id = :workspace_id` (Rejected: high risk of human error leading to broken access control). |
| **Banning service role connections for normal workers** | Bypassing RLS introduces severe risk in worker consumer threads. Isolation must be enforced on every transaction processing tenant data. | Allowing service bypass and handling partition logic purely in application code (Rejected: violates Defense in Depth). |
| **Official Notion Domains Only & Block Redirects** | Restricting the loader to official hosts (`api.notion.com`, `notion.so`), disabling redirects (`maxRedirects = 0`), and checking target DNS resolutions prevents SSRF attacks targeting local metadata interfaces (e.g. AWS `169.254.169.254`). | Supporting custom public workspaces (`*.notion.site`) by default (Rejected: deferred to a tenant allowlist to minimize open network attack surface). |
| **Distinct Soft Fail vs. Hard Fail Handling** | Separating quality issues (`INTENT_DRIFT`, `CTA_UTM_MUTATED` -> soft review status) from security threats (`PROMPT_INJECTION` -> hard failure status) preserves system telemetry, prevents database snapshot poisoning, and safeguards SMM users. | Treating all validation errors as terminal failed states (Rejected: would halt worker threads unnecessarily and limit diagnostic capabilities). |
| **No Variant Draft Persistence on Failures** | Blocking upserts to active drafts (`content_variants`) on soft or hard failures prevents SMM operators from seeing and accidentally publishing corrupted copies in Airtable. | Creating a variant flagged as `requires_manual_audit` (Rejected: confusing to operators and risks publishing incomplete drafts). |

---

## Verification
- [x] Completed full design-level verification of all 7 security dimensions.
- [x] Created `docs/plans/US-003/US-003-security-and-privacy-review.md` covering all 21 architectural sections.
- [x] Verified zero credentials/tokens are committed in reports or review plans.
- [x] Completed post-work report matching the AGENTS.md template.
- [x] Enforced Zero-Bypass publish rules ensuring AI never bypasses human review gates.
- [x] Checked off and aligned all requirements for T-012 before T-013 handoff.
- [x] Re-checked that the final release status is consistently recorded as Conditional Approval.

---

## Open Items / Next Steps
- **Proceed to T-013 (Final Task):** Hand off the approved review to compile the final US-003 Implementation Notes.
- **Update FL-002 (Logic Register):** Adjust the Logic Register (`docs/requirements/05_Function_Flow_Logic_Register.md`) to reflect the refined soft vs. hard fail statuses (`needs_manual_review`, `failed`, `ai_generation_failed`) and isolation policies.
- **Development Phase Hand-Off:** Provide the implementation team with the RLS `SET LOCAL` pattern and SSRF DNS target lookup specs to prepare for Sprint 2.
