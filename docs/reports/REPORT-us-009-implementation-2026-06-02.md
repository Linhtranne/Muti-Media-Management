# Report: Implement US-009 Slack Slash Command Reply/Escalate Comment

**Date:** 2026-06-02
**Agent(s) Used:** orchestrator, backend-specialist
**Related User Story:** US-009
**Status:** Completed

## Summary
Successfully implemented US-009 to handle `/reply_comment` and `/escalate` slash commands via Slack. The feature involves DB schema migration, shared contracts, Slack command parsing and routing in the orchestrator, RabbitMQ publishing/consuming, and delegating the actual reply execution to the Facebook MCP server. 

Hardened for production readiness (2026-06-03):
- Replaced insecure token resolution with deterministic env var mapping inside the MCP server.
- Fixed duplicate escalation risk by moving Slack alerts post-Ledger commit.
- Corrected channel account resolution logic to be deterministic based on interaction relationships instead of using a `LIMIT 1` approach.

## What Was Done
- [x] Item 1: Implemented DB migration `0009_us009_slack_reply_escalate_comment.sql` extending enum `interactions_status` and adding `comment_action_events` table with RLS.
- [x] Item 2: Created/updated MCP shared contracts in `packages/shared-contracts` for `replyComment`.
- [x] Item 3: Expanded `SlackCommandParser` and `slackCommands` route to parse and handle `/reply_comment` and `/escalate` commands.
- [x] Item 4: Created `CommentActionRepository` to manage ledger state for comment actions.
- [x] Item 5: Implemented RabbitMQ publisher `publishSlackCommentAction` and consumer `slackCommentActionRabbitmqConsumer.ts`.
- [x] Item 6: Implemented `replyComment` tool in `facebook-mcp-server` to actually post comments via Facebook API.
- [x] Item 7: Implemented `SlackCommentActionWorker` orchestrator worker to execute the end-to-end flow.
- [x] Item 8: Added FL-010 to `05_Function_Flow_Logic_Register.md`.
- [x] Item 9: Fixed TypeScript and typing errors.
- [x] Item 10: Fixed `slackCommandsRoute.test.ts` and successfully ran `npm test` verifying 230 tests.
- [x] Item 11: Hardened `replyComment.ts` (Facebook MCP) to deterministically resolve credentials internally (`FACEBOOK_CHANNEL_<SANITIZED_ID>_TOKEN`).
- [x] Item 12: Hardened `SlackCommentActionWorker` to ensure Slack alerts happen *after* successful Ledger commit, mitigating duplicate state risks.
- [x] Item 13: Implemented deterministic `channel_account_id` resolution in `CommentActionRepository` by querying `publish_jobs` and parsing `external_post_id`.
## How It Was Done
### Approach
We extended the existing Slack command architecture to support the new commands. By sharing the parsing and API routing flow, we could effectively branch into a separate repository (`CommentActionRepository`) and event loop (`slackCommentActionRabbitmqConsumer` -> `SlackCommentActionWorker`) specifically tailored for interaction management. We resolved type issues with a unified parser interface using union types and successfully ran all tests to ensure regressions weren't introduced.

### Tools & Skills Used
| Tool/Skill | Purpose |
|:---|:---|
| `write_to_file` / `multi_replace_file_content` | Implement code and tests |
| `run_command` (tsc, npm test) | Verify correctness and tests |
| `backend-specialist` | Build out MCP and orchestrator worker logic |

### Files Changed
| File | Action | Description |
|:---|:---|:---|
| `db/migrations/0009_us009_slack_reply_escalate_comment.sql` | Created | Ledger schema for tracking US-009 actions. |
| `packages/shared-contracts/src/mcp/replyComment.ts` | Created | Tool contract. |
| `packages/shared-contracts/src/slack/slackCommandAction.ts` | Modified | Added queue schemas. |
| `apps/orchestrator/src/services/slackCommandParser.ts` | Modified | Parsing support for new commands. |
| `apps/orchestrator/src/routes/slackCommands.ts` | Modified | API Route support. |
| `apps/orchestrator/src/ledger/commentActionRepository.ts` | Created | Postgres operations. |
| `apps/orchestrator/src/queue/rabbitmqPublisher.ts` | Modified | Publisher support. |
| `apps/orchestrator/src/queue/slackCommentActionRabbitmqConsumer.ts` | Created | Consumer subscription. |
| `apps/orchestrator/src/workers/slackCommentActionWorker.ts` | Created | Main logic. |
| `apps/facebook-mcp-server/src/tools/replyComment.ts` | Created | MCP Server integration. |
| `apps/facebook-mcp-server/src/index.ts` | Modified | Tool registration. |
| `docs/requirements/05_Function_Flow_Logic_Register.md` | Modified | Added FL-010. |
| `apps/orchestrator/src/__tests__/slackCommandsRoute.test.ts` | Modified | Fixed type checking and adjusted test expectations. |

## Impact & Purpose
This allows managers and support staff to reply to and escalate Facebook comments directly from Slack without leaving the communication plane, executing directly on the Facebook platform through the MCP bridge.

## Decisions Made
| Decision | Rationale | Alternatives Considered |
|:---|:---|:---|
| Union type in parser | Cleanly distinguish `/approve_post` args (`postId`) vs `/reply_comment` args (`interactionId`). | Keep fields optional and unstructured, rejected due to poor typing. |
| Separate `commentActionRepository` | `slackCommandRepository` was heavily tailored for Posts. | Refactoring `slackCommandRepository` to handle interactions, rejected due to risk of regression. |
| Deterministic Channel Resolution | Using interaction relationships avoids posting comments on behalf of the wrong page in a multi-page setup. | Relying on `LIMIT 1` active channel, rejected due to production blocker/wrong page risks. |
| Post-Commit Slack Alerting | Prevents duplicate alerts and inconsistent state if Ledger commit fails. | Pre-commit alerting, rejected because it caused duplicate state risks. |

## Verification
- [x] Tests passed: 266/266 tests passing (including root workspace `npm test`).
- [x] Compilation: `npm run build` succeeds cleanly.
- [x] Linting: `npm run lint` / `npm run lint:eslint` pass.
- [x] Docs updated
- [x] No secrets exposed
- [x] Acceptance criteria met: All Edge Cases & Hardening ACs for US-009
- [x] Acceptance criteria met: Reply and Escalate commands function, queue topology followed, RLS implemented.

## Open Items / Next Steps
- Monitor RabbitMQ metrics for delayed queues to ensure TTL limits are effective.
