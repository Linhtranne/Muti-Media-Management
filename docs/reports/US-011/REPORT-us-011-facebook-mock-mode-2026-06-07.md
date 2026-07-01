# Report: Facebook Mock Mode

**Date:** 2026-06-07
**Agent(s) Used:** Codex
**Related User Story:** US-011
**Status:** Completed

## Summary
Added an explicit staging-only Facebook mock mode so the complete Page connection and MCP execution flow can run while Meta Pages API access remains externally blocked.

## What Was Done
- [x] Added deterministic mock OAuth, Page listing, Page connection, and token health behavior.
- [x] Added mock publish, comment reply/sync, and direct-message behavior.
- [x] Kept encrypted database secret storage and Ledger persistence active.
- [x] Blocked mock mode when `NODE_ENV=production`.
- [x] Fixed PostgreSQL RLS context setup in `DatabaseSecretStore`.

## How It Was Done
### Approach
`FACEBOOK_MOCK_MODE=true` replaces only calls to Meta. Orchestrator routes, OAuth state, database transactions, encrypted secret references, channel account persistence, and worker boundaries remain real.

### Tools & Skills Used
| Tool/Skill | Purpose |
|:---|:---|
| Codex | Implementation, runtime smoke test, build, lint, and tests |
| MCP tool-builder guidance | Preserve strict tool boundaries and sanitized results |

### Files Changed
| File | Action | Description |
|:---|:---|:---|
| `apps/facebook-mcp-server/src/index.ts` | Modified | Mock OAuth URL and production guard |
| `apps/facebook-mcp-server/src/tools/facebookAuthTools.ts` | Modified | Mock exchange, connect, and health check |
| `apps/facebook-mcp-server/src/tools/publishPost.ts` | Modified | Deterministic mock publishing |
| `apps/facebook-mcp-server/src/tools/replyComment.ts` | Modified | Deterministic mock replies |
| `apps/facebook-mcp-server/src/tools/syncComments.ts` | Modified | Deterministic mock sync |
| `apps/facebook-mcp-server/src/tools/getDirectMessage.ts` | Modified | Explicit mock-mode support |
| `apps/facebook-mcp-server/src/tools/sendDirectMessage.ts` | Modified | Explicit mock-mode support |
| `apps/facebook-mcp-server/src/lib/databaseSecretStore.ts` | Modified | Parameter-safe RLS workspace context |
| `apps/orchestrator/src/mcp/facebookMcpClient.ts` | Modified | Forward mock flag to MCP subprocess |
| `apps/orchestrator/src/config/env.ts` | Modified | Validate mock flag |
| `.env.local` | Modified | Enable local staging mock mode |

## Impact & Purpose
The local staging environment no longer depends on unavailable Meta Page permissions, while retaining realistic internal security and persistence behavior.

## Decisions Made
| Decision | Rationale | Alternatives Considered |
|:---|:---|:---|
| Mock only the Meta boundary | Exercises the real application architecture | Mock the whole route or bypass Ledger |
| Keep database secret provider | Validates encryption and RLS behavior | Volatile in-memory secrets |
| Reject mock mode in production | Prevent accidental fake platform execution | Rely on operator discipline |

## Verification
- [x] Build passed
- [x] Lint passed
- [x] MCP targeted tests passed: 19/19
- [x] OAuth start, callback, and Page connect smoke-tested against staging database
- [x] No raw tokens exposed
- [x] Acceptance criteria met for staging mock execution

## Open Items / Next Steps
- Full suite currently has a pre-existing Slack route expectation mismatch caused by immediate command acknowledgement behavior.
- Disable `FACEBOOK_MOCK_MODE` only after Meta grants the required Page permissions.
