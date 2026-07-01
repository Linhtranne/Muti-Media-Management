# AI-SDLC Retrofit Header for US-006

## AI-SDLC Completion Gate

| Gate | Evidence | Verdict |
|:---|:---|:---|
| Spec approved | docs/specs/SPEC-US-006.md | Pass |
| Plan approved | docs/plans/US-006/ | Pass |
| Red test evidence | docs/testing/US-006/RED-US-006.md | Partial |
| AC-001 trace | Spec, plan, RED, and report mention AC-001 | Pass |
| AC-002 trace | Spec, plan, RED, and report mention AC-002 | Pass |
| AC-003 trace | Spec, plan, RED, and report mention AC-003 | Pass |
| AC-004 trace | Spec, plan, RED, and report mention AC-004 | Pass |
| Build/lint/test evidence | Run `npm run ai-sdlc:validate -- US-006` after retrofit | Pending |
| Runtime smoke | Not run as part of documentation retrofit | Partial |

Retrofit note: this section records compatibility with the new AI-SDLC gate. It does not claim complete historical TDD or production readiness.

# Report: US-006 Facebook MCP Publish Post

**Date:** 2026-06-01
**Agent(s) Used:** Antigravity (backend-specialist)
**Related User Story:** US-006
**Status:** Completed

## Summary
Successfully implemented the execution logic for publishing Facebook posts via the MCP server architecture. The implementation handles the decoupling of validation and execution by using a scheduler to pull due jobs, queuing execution events via RabbitMQ, executing the publishing through an MCP tool call to isolate the Graph API logic, and updating local Ledger and remote Airtable states safely.

## What Was Done
- [x] Implemented `publishPost` MCP tool in Facebook MCP Server.
- [x] Added `publish_execution_events` to Ledger for idempotency.
- [x] Implemented `McpPublishScheduler` to scan for due `validated` jobs.
- [x] Implemented `McpPublishWorker` and RabbitMQ consumer to process execution events.
- [x] Integrated `FacebookMcpClient` to call `publishPost`.
- [x] Integrated `AirtableClient` to update status to "Published" or "Failed" as appropriate.
- [x] Added unit tests for contracts, MCP tool, and Orchestrator worker.
- [x] Updated required documentation (Function logic, decisions, security gate).

## How It Was Done
### Approach
A standard Poller + Queue + Worker architecture:
1. `McpPublishScheduler` runs every minute (controlled by `US006_EXECUTION_ENABLED`).
2. Scheduler queries jobs where `status='validated'` and `scheduled_at <= NOW()`.
3. An outbox table `publish_execution_events` ensures idempotency when pushing to `publish.facebook.execute` queue.
4. `McpPublishWorker` handles the queue message, locks the job in DB to `publishing`.
5. Worker delegates token resolution and API call to Facebook MCP Server to maintain isolation.
6. Ledger state is transitioned to `published` (or `failed`), then Airtable is patched synchronously.
7. Compensating transactions are flagged (`airtable_sync_retry_needed`) if Airtable API fails but Ledger succeeds.

### Tools & Skills Used
| Tool/Skill | Purpose |
|:---|:---|
| Backend Architecture | Clean queue worker structure |
| Postgres RDBMS | Row-level locking (`FOR UPDATE`) and outbox pattern |
| MCP Client/Server | Tool invocation and sandboxed credential handling |
| Vitest | Unit testing the execution flows |

### Files Changed
| File | Action | Description |
|:---|:---|:---|
| `packages/shared-contracts/src/mcp/publishPost.ts` | Created | Definitions for MCP input/result |
| `packages/shared-contracts/src/mcp/publishFacebookExecute.ts` | Created | RabbitMQ Event schemas |
| `db/migrations/0006_us006_facebook_publish_execution.sql` | Created | Ledger migration |
| `apps/facebook-mcp-server/src/tools/publishPost.ts` | Created | Tool logic mapping to Graph API |
| `apps/orchestrator/src/ledger/mcpPublishSchedulerRepository.ts` | Created | Scheduler DB queries |
| `apps/orchestrator/src/workers/mcpPublishScheduler.ts` | Created | Scheduler poller loop |
| `apps/orchestrator/src/ledger/mcpPublishWorkerRepository.ts` | Created | Worker state transition queries |
| `apps/orchestrator/src/workers/mcpPublishWorker.ts` | Created | Execute worker logic |
| `apps/orchestrator/src/queue/mcpPublishRabbitmqConsumer.ts` | Created | RabbitMQ consumer setup |
| `apps/orchestrator/src/mcp/facebookMcpClient.ts` | Modified | Added publishPost wrapper |
| `apps/orchestrator/src/server.ts` | Modified | Hooked up worker/consumer/scheduler |
| `apps/orchestrator/src/config/env.ts` | Modified | Added US006 toggle and slack channels |

## Impact & Purpose
The Orchestrator can now successfully publish validated posts to Facebook exactly when they are scheduled without handling any raw access tokens directly. This maintains our Zero-Trust MCP boundary.

## Decisions Made
| Decision | Rationale | Alternatives Considered |
|:---|:---|:---|
| Poller + RabbitMQ over Delayed Messages | Postgres is easier to query and manage for future cancellation of scheduled posts than a RabbitMQ delayed exchange plugin. | RabbitMQ x-delayed-message plugin |
| Airtable Compensating transaction | If Ledger commits but Airtable network request fails, we do NOT rollback Ledger since Facebook has already published the post. | Rollback Ledger (Risks zombie posts) |

## Verification
- [x] Tests passed (`npm run build` and `npm run test` both pass cleanly)
- [x] Docs updated
- [x] No secrets exposed
- [x] Acceptance criteria met: Validated jobs are picked up, published via MCP, and states are updated.

## Open Items / Next Steps
- Setup E2E Sandbox test against a real Facebook test page.
- Add AirTable re-sync job for `airtable_sync_retry_needed = true` (Future user story).

## Documentation Note
The documentation updates prescribed in the plan were reviewed and successfully executed as part of this implementation phase. This implementation report supersedes any separate documentation-only report for US-006.
