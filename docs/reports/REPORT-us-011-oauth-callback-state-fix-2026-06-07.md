# Report: Facebook OAuth Callback State Fix

**Date:** 2026-06-07
**Agent(s) Used:** Codex
**Related User Story:** US-011
**Status:** Completed

## Summary
Fixed the Facebook browser OAuth callback, which previously returned 403 because it required an `x-user-id` header and accepted POST only.

## What Was Done
- [x] Added one-time, expiring OAuth state persistence with workspace RLS.
- [x] Added OAuth `state` to the generated Facebook authorization URL.
- [x] Changed the callback to the standard GET `code` and `state` flow.
- [x] Exempted only the callback from the admin header guard and attributed it through the consumed state.
- [x] Updated Facebook admin route tests.
- [x] Hardened MCP connection cleanup, concurrent connect handling, and one-time reconnect after a dropped connection.

## How It Was Done
### Approach
The authenticated admin start endpoint creates a random state tied to the workspace and actor. The callback atomically consumes that state before exchanging the authorization code.

### Tools & Skills Used
| Tool/Skill | Purpose |
|:---|:---|
| Codex | Route, MCP tool, migration, and test changes |

### Files Changed
| File | Action | Description |
|:---|:---|:---|
| `apps/orchestrator/src/routes/facebookAdmin.ts` | Modified | Added GET callback and one-time state validation |
| `apps/facebook-mcp-server/src/index.ts` | Modified | Added state to generated OAuth URL |
| `apps/orchestrator/src/__tests__/facebookAdminRoute.test.ts` | Modified | Covered browser callback flow |
| `apps/orchestrator/src/mcp/facebookMcpClient.ts` | Modified | Prevented stale disconnected clients and added one reconnect attempt |
| `db/migrations/0016_us011_facebook_oauth_state.sql` | Created | Added RLS-protected OAuth state table |

## Impact & Purpose
Meta can complete the browser redirect without a custom header while preserving admin attribution and CSRF/replay protection.

## Decisions Made
| Decision | Rationale | Alternatives Considered |
|:---|:---|:---|
| Persist one-time OAuth state | Supports browser callbacks, multiple replicas, expiry, and replay prevention | Header-based callback authorization; unsigned state |

## Verification
- [x] Build passed
- [x] Lint passed
- [x] Facebook admin route tests passed: 7/7
- [x] No raw tokens added to URLs, logs, or state rows
- [x] Acceptance criteria met: standard GET callback and secure actor attribution

## Open Items / Next Steps
- Apply migration `0016_us011_facebook_oauth_state.sql` to the staging database.
- Run the real Meta OAuth flow against the current ngrok callback URL.
