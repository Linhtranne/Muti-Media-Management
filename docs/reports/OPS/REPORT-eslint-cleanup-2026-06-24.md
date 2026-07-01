# Report: ESLint Cleanup

**Date:** 2026-06-24
**Agent(s) Used:** Codex
**Related User Story:** Repository maintenance
**Status:** Completed

## Summary
Cleaned the repository ESLint signal so `npm run lint:eslint` completes with no errors or warnings while keeping strict checks for `any`, unsafe access, magic numbers, and hardcoded user-facing text active.

## What Was Done
- [x] Restored strict lint rules for `no-explicit-any`, `no-unsafe-*`, `no-magic-numbers`, and `clean-code/no-hardcoded-text`.
- [x] Fixed `any` and unsafe access by adding explicit contracts, type guards, typed JSON parsing, and `unknown` error handling.
- [x] Replaced magic numbers with named constants for retry TTLs, timeouts, schema limits, HTTP codes, preview lengths, and OAuth/session durations.
- [x] Moved remaining display/fallback text into constants and refined the custom hardcoded-text rule to ignore backend operational strings such as logger messages, error constructors, schema metadata, and non-display control fields.
- [x] Verified TypeScript build still passes.

## How It Was Done
### Approach
The cleanup avoided mass renames or unrelated rewrites. The custom hardcoded-text rule was corrected so its implementation matches its intent: flag user-facing/display text, not operational logger/error/schema/control strings. Code-level findings were fixed with typed parsers, explicit interfaces, constants, and safer error handling.

### Tools & Skills Used
| Tool/Skill | Purpose |
|:---|:---|
| ESLint | Identify remaining lint failures and warnings |
| TypeScript build | Verify compile correctness after cleanup |
| Systematic debugging | Reduce the noisy lint output to actionable root causes |

### Files Changed
| File | Action | Description |
|:---|:---|:---|
| `eslint.config.mjs` | Modified | Kept strict rules enabled and refined hardcoded-text false-positive handling |
| `packages/shared-contracts/src/events/directMessage.ts` | Modified | Added explicit DM interfaces and named preview limit |
| `packages/shared-contracts/src/events/facebookCommentSync.ts` | Modified | Added named comment schema limits |
| `packages/shared-contracts/src/ai/composer.ts` | Modified | Added named Notion context error length limit |
| `packages/shared-contracts/src/mcp/replyComment.ts` | Modified | Added named reply message length limit |
| `packages/shared-contracts/src/mcp/syncComments.ts` | Modified | Added named comment author length limit |
| `apps/facebook-mcp-server/src/tools/getDirectMessage.ts` | Modified | Added typed Graph response parsing and named fallback constants |
| `apps/facebook-mcp-server/src/tools/sendDirectMessage.ts` | Modified | Added typed Graph response parsing and named fallback constants |
| `apps/facebook-mcp-server/src/tools/publishPost.ts` | Modified | Added named credential fallback text |
| `apps/facebook-mcp-server/src/tools/syncComments.ts` | Modified | Added named Meta Graph error-code constants |
| `apps/facebook-mcp-server/src/lib/databaseSecretStore.ts` | Modified | Added named AES key and IV sizes |
| `apps/orchestrator/src/queue/topologyConfig.ts` | Modified | Replaced retry TTL magic arrays with named retry profiles |
| `apps/orchestrator/src/queue/rabbitmqPublisher.ts` | Modified | Removed `any` audit extraction and named publish properties |
| `apps/orchestrator/src/queue/directMessageIngestRabbitmqConsumer.ts` | Modified | Added typed RabbitMQ connection and schema-validated event typing |
| `apps/orchestrator/src/queue/directMessageReplyRabbitmqConsumer.ts` | Modified | Added typed RabbitMQ connection and schema-validated event typing |
| `apps/orchestrator/src/workers/directMessageIngestWorker.ts` | Modified | Replaced `catch any` and named SLA time conversion constants |
| `apps/orchestrator/src/workers/directMessageReplyWorker.ts` | Modified | Replaced `catch any` and named MCP fallback text |
| `apps/orchestrator/src/workers/ai-composer-worker.ts` | Modified | Moved fallback/display text and AI limits into constants |
| `apps/orchestrator/src/workers/slackCommentActionWorker.ts` | Modified | Moved MCP/escalation fallback text into constants |
| `apps/orchestrator/src/routes/slackCommands.ts` | Modified | Moved Slack command responses/failure messages into constants |
| `apps/orchestrator/src/routes/facebookAdmin.ts` | Modified | Added named OAuth TTL constants |
| `apps/orchestrator/src/routes/airtableWebhook.ts` | Modified | Added named HTTP accepted status |
| `apps/orchestrator/src/airtable/airtableClient.ts` | Modified | Added named service status and Airtable field constants |
| `apps/orchestrator/src/ai/llmAdapter.ts` | Modified | Added named LLM timeout and service status constants |
| `apps/orchestrator/src/ai/prompt-registry.ts` | Modified | Moved prompt fallback text into constants |
| `apps/orchestrator/src/config/env.ts` | Modified | Added named default port |
| `apps/orchestrator/src/lib/dmRedactor.ts` | Modified | Added named Slack preview limit |
| `apps/orchestrator/src/scheduler/commentSyncScheduler.ts` | Modified | Added named interval, batch size, and idempotency window constants |
| `apps/orchestrator/src/services/slackCommandParser.ts` | Modified | Added named Slack message length limit |
| `apps/orchestrator/src/queue/facebookCommentSyncRequestConsumer.ts` | Modified | Added named comment preview limit |

## Impact & Purpose
This makes lint usable as a strict quality gate again. The project now blocks unsafe `any`, unsafe member access, magic numbers, hardcoded display text, unused imports, layer boundary violations, restricted syntax, and hardcoded colors.

## Decisions Made
| Decision | Rationale | Alternatives Considered |
|:---|:---|:---|
| Keep strict `any`, unsafe, magic-number, and hardcoded-text rules active | Matches the requested lint standard and keeps ESLint meaningful | Disable or downgrade the rules |
| Refine custom hardcoded-text rule semantics | The original rule flagged logs, errors, schemas, and control fields as user-facing copy | Move every operational string into constants or suppress per file |
| Use explicit DM interfaces instead of relying on `z.infer` through refined schemas | Prevents type erasure from leaking `any` into workers | Local casts in each worker |

## Verification
- [x] `npm run lint:eslint` passed with no reported problems.
- [x] `npm run build` passed.
- [x] No secrets exposed.
- [x] Acceptance criteria met: ESLint errors and warnings cleaned for the current repo state.

## Open Items / Next Steps
- Full test suite was not required for this lint cleanup and was not run in this pass.
