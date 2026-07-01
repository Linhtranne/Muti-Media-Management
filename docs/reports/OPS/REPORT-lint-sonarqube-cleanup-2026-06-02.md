# Report: Lint and SonarQube Cleanup

**Date:** 2026-06-02
**Agent(s) Used:** GPT-5 Codex
**Related User Story:** Cross-cutting quality task
**Status:** Completed

## Summary
Added an ESLint quality gate, cleaned the SonarLint issues reported in the IDE screenshots, and kept the project build and test suite green.

## What Was Done
- [x] Added root ESLint scripts and flat config.
- [x] Fixed TypeScript/lint errors and warnings in MCP tools, Orchestrator routes, audit logging, queue consumers, workers, and Airtable/Notion clients.
- [x] Fixed the `replyComment` token fallback behavior so empty `MOCK_ACCESS_TOKEN` falls back to the secret store.
- [x] Preserved build and test compatibility after type tightening.
- [x] Cleaned remaining SonarLint issues around `node:crypto`, `Object.hasOwn`, `readonly` members, nested ternaries, duplicate imports, Express version disclosure, and method parameter counts.
- [x] Refactored Slack command routing and AI worker repository calls to reduce complexity and long parameter lists without changing behavior.

## How It Was Done
### Approach
Focused first on errors that block CI and production safety: explicit `any`, unsafe Express async callbacks, untyped MCP responses, untyped audit metadata, empty catch blocks, and queue/channel typing. Then addressed the remaining SonarLint findings from the IDE by applying scoped refactors that preserved the existing route, worker, repository, and contract behavior.

### Tools & Skills Used
| Tool/Skill | Purpose |
|:---|:---|
| PowerShell | Run build, tests, and ESLint |
| apply_patch | Make scoped code changes |
| ESLint | Identify lint and Sonar-like issues |
| TypeScript build | Verify type correctness |

### Files Changed
| File | Action | Description |
|:---|:---|:---|
| `eslint.config.mjs` | Created/Modified | Added strict flat ESLint config and scoped overrides |
| `package.json` | Modified | Added lint scripts and ESLint dev dependencies |
| `apps/facebook-mcp-server/src/tools/replyComment.ts` | Modified | Fixed empty env token fallback |
| `apps/facebook-mcp-server/src/tools/publishPost.ts` | Modified | Used `replaceAll` for token sanitization |
| `apps/orchestrator/src/routes/facebookAdmin.ts` | Modified | Typed MCP responses and async route callbacks |
| `apps/orchestrator/src/routes/slackCommands.ts` | Modified | Typed transaction result and async route callback |
| `apps/orchestrator/src/ledger/slackCommandRepository.ts` | Modified | Replaced long insert/audit parameter lists with object inputs |
| `apps/orchestrator/src/ledger/commentActionRepository.ts` | Modified | Replaced long insert/audit parameter lists with object inputs |
| `apps/orchestrator/src/ledger/aiWorkerRepository.ts` | Modified | Replaced long completion/failure parameter lists with object inputs |
| `apps/orchestrator/src/workers/aiComposerWorker.ts` | Modified | Updated AI repository call sites for object inputs |
| `apps/orchestrator/src/workers/slackPostApprovalWorker.ts` | Modified | Updated Slack audit call sites for object inputs |
| `apps/orchestrator/src/workers/slackCommentActionWorker.ts` | Modified | Updated comment action audit call sites for object inputs |
| `apps/orchestrator/src/ai/llmAdapter.ts` | Modified | Reduced adapter complexity and marked stable members readonly |
| `apps/orchestrator/src/ai/structuredValidator.ts` | Modified | Replaced `hasOwnProperty.call` with `Object.hasOwn` |
| `packages/shared-contracts/src/ai/composer.ts` | Modified | Replaced `hasOwnProperty.call` with `Object.hasOwn` |
| `packages/shared-contracts/src/events/airtablePostApproved.ts` | Modified | Replaced `hasOwnProperty.call` with `Object.hasOwn` |
| `packages/shared-contracts/src/policy/policyEvaluate.ts` | Modified | Replaced `hasOwnProperty.call` with `Object.hasOwn` |
| `packages/shared-contracts/src/mcp/publishFacebookValidated.ts` | Modified | Replaced `hasOwnProperty.call` with `Object.hasOwn` |
| `apps/facebook-mcp-server/src/lib/secretStore.ts` | Modified | Marked in-memory store readonly and used `replaceAll` |
| `apps/facebook-mcp-server/src/tools/facebookAuthTools.ts` | Modified | Replaced repeated scope lookup with `Set.has` |
| `apps/orchestrator/src/__tests__/approvedPostWorker.test.ts` | Modified | Replaced test assertions with `Object.hasOwn` |
| `apps/orchestrator/src/server.ts` | Modified | Disabled Express `x-powered-by` and removed unnecessary awaits |
| `apps/orchestrator/src/ledger/channelAccountAdminRepository.ts` | Modified | Removed nested token-status ternaries and marked audit repo readonly |
| `apps/orchestrator/src/ledger/mcpValidateWorkerRepository.ts` | Modified | Merged duplicate shared-contract imports |
| `apps/orchestrator/src/ledger/webhookEventRepository.ts` | Modified | Merged duplicate shared-contract imports |
| `apps/orchestrator/src/lib/auditRedactor.ts` | Modified | Replaced audit metadata `any` with `unknown` |
| `apps/orchestrator/src/ledger/auditLogRepository.ts` | Modified | Typed audit metadata |
| `apps/orchestrator/src/queue/*` | Modified | Typed RabbitMQ consumers/publisher and async callbacks |
| `apps/orchestrator/src/workers/*` | Modified | Removed blocking lint errors in worker code |
| `apps/orchestrator/src/airtable/airtableClient.ts` | Modified | Typed dynamic Airtable fields and response parsing |
| `apps/orchestrator/src/services/notionClient.ts` | Modified | Typed Notion response mapping |

## Impact & Purpose
The repository now has an ESLint quality gate that can run successfully with zero reported problems. The SonarLint findings shown for Slack routes, AI adapter, repositories, MCP auth/secret handling, shared contracts, and server startup were addressed with scoped refactors.

## Decisions Made
| Decision | Rationale | Alternatives Considered |
|:---|:---|:---|
| Keep `no-unsafe-*` as warnings | Third-party SDK boundaries still emit many unsafe warnings; blocking on all of them now would require larger wrappers | Disable rules entirely |
| Wrap Express/RabbitMQ async callbacks with `void` | Satisfies `no-misused-promises` without changing behavior | Disable rule for routes/queues |
| Use `unknown` for audit metadata | Safer than `any` and matches redaction boundary | Keep permissive metadata typing |

## Verification
- [x] `npm run build` passed
- [x] `npm test` passed: 247 tests, 58 suites
- [x] `npm run lint:eslint` passed with 0 reported problems
- [x] No secrets exposed
- [x] Acceptance criteria met: blocking lint errors removed and test/build remain green

## Open Items / Next Steps
- ESLint prints a `boundaries` plugin migration notice for legacy selector syntax in the config; it is not reported as a lint problem.
