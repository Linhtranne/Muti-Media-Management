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

# Report: US-003 Scope Lock and Handoff Baseline

**Date:** 2026-05-21  
**Agent(s) Used:** Codex (PM / Backend Lead role)  
**Related User Story:** US-003  
**Status:** Completed

## Summary
Completed US-003 T-001 by locking the AI Composer scope and defining the baseline handoff from US-002. The document establishes what US-003 consumes, produces, validates, stores, and explicitly refuses to do.

## What Was Done
- [x] Read US-003 master plan, US-001 final notes, US-002 final notes, and FL-002 draft.
- [x] Applied LLM, prompt-engineering, event architecture, and project-planning guidance.
- [x] Created `docs/plans/US-003/US-003-scope-lock.md`.
- [x] Mapped US-003 AC1-AC4 and BR1-BR3 to concrete design verification points.
- [x] Defined in-scope/out-of-scope boundaries, source context, output baseline, statuses, idempotency, security guardrails, and open questions.
- [x] Post-review correction: fixed `hashtags` output typing, removed premature concrete model selection, and resolved duplicate open-question ID.

## How It Was Done

### Approach
Started from the durable US-002 handoff (`workflow_runs.pending_ai_generation`) and treated US-003 as a strictly bounded AI draft-generation workflow. The scope deliberately excludes publish jobs, Facebook Graph API, MCP publish tools, Slack command implementation, and policy execution so the AI Composer cannot bypass downstream governance.

### Tools & Skills Used

| Tool/Skill | Purpose |
|:---|:---|
| PowerShell read/search | Reviewed existing US-001/US-002/US-003 context. |
| `apply_patch` | Created the scope lock and report documents. |
| `llm-architect` | Applied structured output, prompt-injection, and provider reliability constraints. |
| `prompt-engineer` | Applied prompt versioning and prompt-as-code requirements. |
| `event-architect` | Applied idempotency, immutable handoff, and correlation discipline. |
| `project-planner` | Structured scope, AC/BR mapping, acceptance gate, and task handoff. |

### Files Changed

| File | Action | Description |
|:---|:---|:---|
| `docs/plans/US-003/US-003-scope-lock.md` | Created | T-001 scope lock and handoff baseline. |
| `docs/reports/US-003/REPORT-us-003-scope-lock-2026-05-21.md` | Created | Mandatory completion report for T-001. |

## Impact & Purpose
This gives future US-003 task agents a stable source of truth before schema, contracts, worker flow, prompt design, and validation are designed. It prevents scope creep into publishing, policy decisions, Slack operations, and token handling.

## Decisions Made

| Decision | Rationale | Alternatives Considered |
|:---|:---|:---|
| US-003 starts only from `workflow_runs.pending_ai_generation` | Keeps US-002 as the sole webhook/workflow-stub authority. | Re-reading webhook events, rejected. |
| Canonical AI idempotency key uses `workflow_run_id` and `prompt_version` | Supports safe retries and controlled re-generation under a new prompt version. | Keying only by Airtable record, rejected because re-approval/versioning matters. |
| Notion context is untrusted prompt data | Prevents prompt-injection through external brief/guideline content. | Treating Notion as trusted instructions, rejected. |
| Slack alert delivery is out of scope | US-003 can record alert-needed state but should not implement Slack delivery. | Direct Slack API call from AI Composer, rejected. |

## Verification
- [x] Scope document exists.
- [x] Report document exists.
- [x] AC1-AC4 and BR1-BR3 are mapped.
- [x] US-002 handoff requirements are explicit.
- [x] Out-of-scope excludes Graph API, MCP publish tools, publish jobs, Slack commands, and Policy Engine execution.
- [x] Security baseline includes no token leakage, workspace scoping, and prompt-injection mitigation.
- [x] Open questions use unique IDs and defer concrete model choice to T-008.

## Open Items / Next Steps
- Continue to US-003 T-002: AI Ledger Schema and Idempotency.
- Resolve provider/model default in T-008.
- Decide Airtable variant update fields in T-009 after schema/contracts are locked.
