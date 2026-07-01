# AI-SDLC Retrofit Header for US-005

## AI-SDLC Completion Gate

| Gate | Evidence | Verdict |
|:---|:---|:---|
| Spec approved | docs/specs/SPEC-US-005.md | Pass |
| Plan approved | docs/plans/US-005/ | Pass |
| Red test evidence | docs/testing/US-005/RED-US-005.md | Partial |
| AC-001 trace | Spec, plan, RED, and report mention AC-001 | Pass |
| AC-002 trace | Spec, plan, RED, and report mention AC-002 | Pass |
| AC-003 trace | Spec, plan, RED, and report mention AC-003 | Pass |
| AC-004 trace | Spec, plan, RED, and report mention AC-004 | Pass |
| Build/lint/test evidence | Run `npm run ai-sdlc:validate -- US-005` after retrofit | Pending |
| Runtime smoke | Not run as part of documentation retrofit | Partial |

Retrofit note: this section records compatibility with the new AI-SDLC gate. It does not claim complete historical TDD or production readiness.

# Report: US-005 MediaOps Facebook Publish Validate MCP Tool

**Date:** 2026-06-01
**Agent(s) Used:** @[backend-specialist]
**Related User Story:** US-005
**Status:** Completed

## Summary
Implemented the MCP server for Facebook validation (`facebook-mcp-server`) and the integration with Orchestrator via `mcpValidateWorker`. Validates posts locally and checks the token rate limit status via an `EnvSecretStore`, ensuring no tokens are ever leaked, in compliance with the Composability architecture.

## What Was Done
- [x] Defined shared contracts (MCP I/O schemas, RabbitMQ validation event schemas).
- [x] Set up new package `facebook-mcp-server` using `@modelcontextprotocol/sdk`.
- [x] Implemented `SecretStore` with fail-closed logic (`EnvSecretStore`).
- [x] Implemented local `validatePost` and `getRateLimitStatus` tools in the MCP server.
- [x] Updated Orchestrator database schema to track MCP validation state in `publish_jobs`.
- [x] Implemented `FacebookMcpClient` in Orchestrator using Stdio transport.
- [x] Implemented `McpValidateWorker` to consume `publish.facebook.requested`, invoke MCP tools, and dispatch `publish.facebook.validated` to RabbitMQ.
- [x] Wrote unit tests for all implemented modules and successfully integrated tests into `run-tests.mjs`.

## How It Was Done
### Approach
1. Defined strict schema validation layers in `shared-contracts` blocking field exposure (e.g. `access_token`).
2. Separated logic for MCP tools to ensure the MCP Server acts purely as a stateless processor of valid requests.
3. Hooked Stdio integration for the server dynamically resolving path based on `NODE_ENV`.
4. Constructed a robust `McpValidateWorker` in Orchestrator following the standard database transaction pattern locking the `content_variants` and `publish_jobs` table to avoid race conditions. Emitted standard Slack alerts on failures.

### Tools & Skills Used
| Tool/Skill | Purpose |
|:---|:---|
| mcp-builder | Used for designing MCP tools and Stdio integration |
| clean-code | To ensure simple patterns, avoiding over-abstractions in workers |
| queue-workers (spawner) | Structured RabbitMQ message handling and DLQ management |

### Files Changed
| File | Action | Description |
|:---|:---|:---|
| `packages/shared-contracts/...` | Modified | Added MCP inputs and Validation Events schemas |
| `apps/facebook-mcp-server/...` | Created | Set up new MCP server package with tools and unit tests |
| `apps/orchestrator/src/mcp/...` | Created | Created client for calling MCP via Node Stdio |
| `apps/orchestrator/src/workers/mcpValidateWorker.ts` | Created | Implemented consumer worker logic |
| `apps/orchestrator/src/ledger/mcpValidateWorkerRepository.ts` | Created | Ledger repository for atomic state and event publishing |
| `apps/orchestrator/src/server.ts` | Modified | Wired up new consumer and client into lifecycle |
| `db/migrations/0005_us005_mcp_validate_enqueue.sql` | Created | Added new state and idempotency tracking columns |

## Impact & Purpose
Validates posts immediately prior to transmission to Facebook without sending any payload out. Prepares the system for a fully decoupled AI-to-platform transmission flow (US-006). Ensures token rotation support by referencing tokens instead of shipping them via messages.

## Decisions Made
| Decision | Rationale | Alternatives Considered |
|:---|:---|:---|
| Environment Secret Store | MVP requires only loading tokens from env variables. Hard-coded to fail if `vault://` format is seen | Implement AWS Secrets Manager/Vault immediately (Deferred per instructions) |
| Local Text Length Evaluation | Checks max length and hashtag count locally rather than hitting the Graph API early | Calling Facebook Graph `debug` endpoint (Slower, requires quota usage) |
| Stdio MCP Transport | The server runs in the same environment and is highly privileged. | HTTP/SSE (Unnecessary overhead) |

## Verification
- [x] Tests passed
- [x] Docs updated
- [x] No secrets exposed
- [x] Acceptance criteria met: Token handling, strict schema filtering, valid post validation.

## Open Items / Next Steps
- T-018: Full E2E Worker Integration testing
- Proceed with US-006 to implement actual platform publishing using the fully validated results.
