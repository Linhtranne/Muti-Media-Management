# Report: US-017 TikTok Direct Posting MCP - Plan Setup

**Date:** 2026-07-01  
**Agent(s) Used:** Codex GPT-5, project-planner, backend-specialist  
**Related User Story:** US-017  
**Status:** Completed for planning artifacts only

## AI-SDLC Completion Gate

| Gate | Evidence | Verdict |
|:---|:---|:---|
| Spec approved | `docs/specs/SPEC-US-017.md` | Pass |
| Plan approved | `docs/plans/US-017/PLAN-US-017-TikTok-Direct-Posting-MCP.md` | Pass |
| Red test evidence | `docs/testing/US-017/RED-US-017.md` | Pass |
| AC-001 trace | Spec, plan, RED, and report mention AC-001 | Pass |
| AC-002 trace | Spec, plan, RED, and report mention AC-002 | Pass |
| AC-003 trace | Spec, plan, RED, and report mention AC-003 | Pass |
| AC-004 trace | Spec, plan, RED, and report mention AC-004 | Pass |
| AC-005 trace | Spec, plan, RED, and report mention AC-005 | Pass |
| Build/lint/test evidence | Documentation-only planning step, no production code changed | Pass |
| Runtime smoke | Not run because implementation has not started | Partial |

Planning note: this report does not claim implementation completion or production readiness.

## Summary

Created Native-level AI-SDLC planning artifacts for US-017, defining TikTok Direct Post integration through a dedicated MCP boundary with video and photo support, per-channel publish jobs, OAuth production design, and staging manual seed fallback.

## What Was Done

- [x] Defined TikTok as a real MCP-backed platform integration.
- [x] Required both TikTok video and TikTok photo Direct Post support.
- [x] Preserved per-channel publishing with Facebook and TikTok independent outcomes.
- [x] Defined TikTok OAuth production path and manual seed fallback.
- [x] Defined TikTok media, policy, queue, worker, and status polling requirements.
- [x] Created RED placeholder with required failing tests.

## How It Was Done

### Approach

The design reuses the existing MediaOps queue, Ledger, Airtable approval, and MCP boundaries. TikTok publishing is isolated in a dedicated MCP server while orchestrator workers handle scheduling, policy, and Ledger transitions.

### Tools & Skills Used

| Tool/Skill | Purpose |
|:---|:---|
| `project-planner` | Story scope, dependency, rollout, and gate planning |
| `backend-specialist` | MCP, worker, Ledger, and queue design |
| `spec-driven-development` | Approved spec and acceptance criteria |
| `brownfield-maintenance` | Alignment with existing Facebook publish architecture |

### Files Changed

| File | Action | Description |
|:---|:---|:---|
| `docs/specs/SPEC-US-017.md` | Created | Approved spec for TikTok Direct Posting MCP. |
| `docs/plans/US-017/PLAN-US-017-TikTok-Direct-Posting-MCP.md` | Created | Implementation plan for TikTok MCP and per-channel publish flow. |
| `docs/testing/US-017/RED-US-017.md` | Created | RED placeholder and required failing test list. |
| `docs/reports/US-017/REPORT-US-017-plan-setup-2026-07-01.md` | Created | Planning setup report with AI-SDLC gate trace. |

## Impact & Purpose

US-017 defines how MediaOps expands from Facebook-only publishing to true multi-platform publishing with TikTok while keeping platform APIs, credentials, media assets, and per-channel failures properly isolated.

## Decisions Made

| Decision | Rationale | Alternatives Considered |
|:---|:---|:---|
| Use TikTok Direct Post | Matches required user flow where approval in Airtable can trigger publish. | Upload draft flow |
| Support video and photo | MVP must match real TikTok post types and user expectation. | Video-only MVP |
| Per-channel publishing | Facebook should not roll back because TikTok fails. | All-or-nothing publishing |
| Dedicated TikTok MCP server | Keeps platform API complexity outside orchestrator. | Put TikTok tools in Facebook MCP server |
| Manual seed fallback | TikTok app review may block OAuth runtime despite correct code. | OAuth-only implementation |

## Verification

- [x] Documentation artifacts created.
- [x] Acceptance criteria are traceable across spec, plan, RED, and report.
- [x] No production code changed in this planning step.
- [x] No secrets exposed.

## Open Items / Next Steps

- Implement US-016 first or provide ready media derivative fixtures.
- Write real RED tests before production code.
- Verify TikTok app access, OAuth scopes, and Direct Post approval.
- Run TikTok runtime smoke before claiming production readiness.
