# AI-SDLC Source-of-Truth Header for US-008

## AI-SDLC AC Traceability (Retrofit Audit)

- AC1: Pass
- AC2: Pass
- AC3: Pass
- AC4: Pass


## AI-SDLC Completion Gate

| Gate | Evidence | Verdict |
|:---|:---|:---|
| Spec approved | docs/specs/SPEC-US-008.md | Pass |
| Plan approved | docs/plans/US-008/ | Pass |
| Red test evidence | docs/testing/US-008/RED-US-008.md | Partial |
| AC-001 trace | Spec, plan, RED, and report mention AC-001 | Pass |
| AC-002 trace | Spec, plan, RED, and report mention AC-002 | Pass |
| AC-003 trace | Spec, plan, RED, and report mention AC-003 | Pass |
| AC-004 trace | Spec, plan, RED, and report mention AC-004 | Pass |
| Build/lint/test evidence | `npm run ai-sdlc:validate -- US-008` passed with 442 tests, 107 suites, 0 failures | Pass |
| Runtime smoke | Not run as part of documentation retrofit | Partial |

Retrofit note: US-008 is a historical story that predates the current AI-SDLC gate. RED evidence is Partial because original implementation-time RED output was not captured. This section records compatibility with the new AI-SDLC gate; it does not claim complete historical TDD or production readiness.

## Current Implementation Snapshot

- AC-001: Pass - invalid commands and malformed arguments are covered by `slackCommandParser.test.ts` and `slackCommandsRoute.test.ts`.
- AC-002: Pass - non-manager/admin rejection is covered by Slack route authorization tests and `workspace_members` role mapping.
- AC-003: Pass - approve/reject Airtable updates are implemented in `SlackPostApprovalWorker` and covered by worker tests.
- AC-004: Pass - command lifecycle persistence and audit behavior are implemented through `slack_command_events` and audit log paths.

# Report: US-008 Slack Approve/Reject Post — Implementation Plan Creation

**Date:** 2026-06-02  
**Agent(s) Used:** Antigravity (Claude Sonnet 4.6 Thinking) + @backend-specialist  
**Related User Story:** US-008 — Slack slash command duyệt/reject post  
**Status:** Historical plan setup report; implementation now exists in codebase; retrofitted for AI-SDLC gate

---

## Summary

Created the full implementation plan `docs/plans/US-008/PLAN-us-008-slack-approve-reject-post.md` for the Slack slash command approve/reject post feature. The plan was derived by reading all required project docs, scanning the current codebase (orchestrator, shared contracts, migrations), and applying specialist knowledge from Spawner skills for Slack bot building and queue workers.

This original report covered plan creation only. It has now been retrofitted with a current implementation snapshot and AI-SDLC gate evidence; production code was not changed by this retrofit.

---

## What Was Done

- [x] Read all P0/P1/P2 project docs and extracted constraints.
- [x] Read Spawner specialist skills: `slack-bot-builder/skill.yaml`, `slack-bot-builder/sharp-edges.yaml`, `queue-workers/skill.yaml`.
- [x] Scanned existing orchestrator codebase: `server.ts`, all routes, queue consumers, workers, ledger repositories, `env.ts`, `redact.ts`.
- [x] Scanned `packages/shared-contracts/src/` for existing event contract patterns.
- [x] Scanned `db/migrations/` (0001–0006) to confirm no `members` / `workspace_members` / `slack_command_events` tables exist yet.
- [x] Identified missing migration number: next slot is `0008` (need to verify `0007` for US-007 before creating).
- [x] Wrote `PLAN-us-008-slack-approve-reject-post.md` with all required sections.
- [x] Wrote this report.

---

## How It Was Done

### Approach

1. **Doc extraction first** — Read architecture, coding convention, backlog, function flow register, risk log, and SRS. Extracted hard constraints before any design decisions.
2. **Codebase scan** — Examined the existing Express server structure, all consumer/worker/repository patterns, env schema, and shared contracts index to ensure the plan aligns with implementation reality.
3. **Specialist skill application** — Applied `slack-bot-builder/sharp-edges.yaml` (3-second timeout → async queue; signature verification with raw body; no token in logs) and `queue-workers/skill.yaml` (idempotency, DLQ, ACK after commit, exponential backoff).
4. **Gap identification** — Identified that `workspace_members` (role mapping) and `slack_command_events` tables do not exist. Planned both as new migration `0008`.
5. **Plan writing** — Followed the standard plan structure matching prior US-003/US-004/US-007 plans.

### Tools & Skills Used

| Tool/Skill | Purpose |
|:---|:---|
| `view_file` | Read 20+ source files across docs, orchestrator, shared-contracts, migrations |
| `list_dir` | Enumerate existing routes, workers, queue consumers, ledger repos, tests |
| `grep_search` | Confirm absence of `members` table in existing migrations |
| `spawner/integrations/slack-bot-builder/skill.yaml` | Slack HTTP mode patterns, 3-second ack pattern |
| `spawner/integrations/slack-bot-builder/sharp-edges.yaml` | Critical: signature verification with raw body, constant-time comparison, token exposure prevention |
| `spawner/backend/queue-workers/skill.yaml` | Idempotent processing, DLQ pattern, ACK-after-commit |
| `@backend-specialist` agent | Architecture boundary decisions, RabbitMQ payload design, security constraints |

### Files Changed

| File | Action | Description |
|:---|:---|:---|
| `docs/plans/US-008/PLAN-us-008-slack-approve-reject-post.md` | **Created** | Full implementation plan for US-008 |
| `docs/reports/US-008/REPORT-us-008-plan-setup-2026-06-02.md` | **Created** | This report |

---

## Impact & Purpose

The plan provides a complete, implementation-ready specification for the US-008 Slack slash command feature. It:

- Maps all 4 acceptance criteria and 3 business rules to specific implementation evidence and tests.
- Defines the `slack_command_events` Ledger table schema and a `workspace_members` stub for role mapping.
- Specifies queue contracts that are references-only (no tokens, no large payloads) in compliance with architecture rules.
- Provides a 12-task breakdown with dependency graph, enabling parallel execution after initial setup tasks.
- Surfaces 5 open questions that must be resolved at the Approval Gate before coding begins.

The feature fits into Sprint 4 (Comment sync + Slack alerts/commands) of the architecture deployment plan.

---

## Decisions Made

| Decision | Rationale | Alternatives Considered |
|:---|:---|:---|
| Async queue for Airtable update | Slack requires HTTP response within 3 seconds; Airtable API can take longer. Queue decouples timing. | Synchronous update in HTTP handler — rejected (timing risk per sharp-edges.yaml) |
| Immediate ephemeral ack only (OQ-008-2 open) | MVP simplicity; delayed response via `response_url` requires SLACK_BOT_TOKEN and extra API call. Left as open question. | Delayed response via `response_url` — possible if product requires it |
| `workspace_members` as a new stub table | No existing role-mapping table found in migrations 0001–0006. New minimal table is cleanest approach. | Hardcode roles in env config — rejected (not scalable, not per-workspace) |
| Idempotency key: `sha256(workspace_id + slack_user_id + command + args + slack_request_ts)` | Slack retries same command with same payload; this key uniquely identifies the request without repeating the action. | Using Slack's built-in message ID — not consistently available for slash commands in all versions |
| Migration slot `0008` | Current highest migration is `0006`; `0007` is expected for US-007. Need to verify US-007 migration exists first. | Any other number — must be sequential |
| Queue payload references-only (no reason text) | Architecture rule: RabbitMQ messages contain references only. Worker reloads `reason` from `slack_command_events` by `command_event_id`. | Include reason in payload — rejected (architecture violation, potential PII leakage in logs) |

---

## Verification

- [x] Plan covers all US-008 acceptance criteria (AC1–AC4)
- [x] Plan covers all business rules (BR1–BR3)
- [x] Plan covers all mandatory constraints from architecture and coding convention docs
- [x] Plan follows existing codebase patterns (consumer, worker, repository, redact)
- [x] No secrets or tokens in plan content
- [x] Open questions documented at Approval Gate
- [x] Tests passed — `npm run ai-sdlc:validate -- US-008` passed with 442 tests, 107 suites, 0 failures during AI-SDLC retrofit
- [x] FL Register updated — US-008 is documented as implemented in the Function Flow Logic Register; duplicate historical block was removed during retrofit cleanup

### Acceptance Criteria Coverage

| AC | Covered in Plan? |
|:---|:---|
| AC1: Invalid command rejected | ✅ Error matrix + CMD-003 to CMD-008 tests |
| AC2: Role guard (manager/admin only) | ✅ Role lookup from `workspace_members` + CMD-009 |
| AC3: Approve/reject updates Airtable | ✅ Worker step 9f + WKR-001, WKR-002 |
| AC4: Every command has audit log | ✅ All error matrix entries include audit event + WKR-003 |

---

## Open Items / Next Steps

1. **Resolve OQ-008-1 to OQ-008-5** (Open Questions in plan) before implementation begins.
2. **Confirm `0007` migration** for US-007 exists or is planned — determines if `0008` is the correct slot for US-008.
3. **Implement in order:** T-001 → T-002/T-003 (parallel) → T-004/T-005/T-006/T-007 (parallel) → T-008 → T-009 → T-010 → T-011 → T-012.
4. **US-007 plan cleanup note** (as requested): Review `docs/plans/US-007/PLAN-us-007-facebook-comment-sync.md` — the "Docs Read" section for the FL register entry should be cleaned up for consistency before US-007 is signed off.