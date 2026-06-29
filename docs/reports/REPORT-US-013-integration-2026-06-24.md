# Report: US-013 Notion Context Loader Integration into AI Composer

**Date:** 2026-06-24
**Agent(s) Used:** Antigravity (orchestrator / backend-specialist)
**Related User Story:** US-013
**Status:** Completed

## Summary
Integrated the successfully completed `NotionContextLoader` pilot into the main `AIComposerWorker`. This replaced the legacy/insecure `NotionClient` with the new module that has robust SSRF prevention, request limits, and timeouts. Adjusted the `AiComposerWorker` and `PromptRegistry` to handle raw block text inputs instead of extracting structured properties from Notion pages.

## What Was Done
- [x] Replaced `NotionClient.fetchNotionBrief` with `loadNotionContext` in `aiComposerWorker.ts`.
- [x] Updated `PromptContext` interface to ingest raw `notionContext` instead of structured fields (`brief_summary`, `brand_voice`, etc).
- [x] Updated Prompt templates to inject `<notion_context>` directly into the prompt.
- [x] Mapped loader errors (like SSRF blocks or timeout) to standard `AiErrorCode`s (like `NOTION_NOT_ALLOWLISTED` and `CONTEXT_UNREACHABLE`).
- [x] Updated all integration tests in `aiComposerWorker.test.ts` to mock the new dependency properly.
- [x] Renamed files in `apps/orchestrator` to strictly follow `kebab-case` based on `unicorn/filename-case` ESLint rule failures.

## How It Was Done
### Approach
1. **Dependency Injection**: Modified `AiComposerWorker` constructor to optionally accept `loadNotionFn` to allow test mocking.
2. **Error Translation**: Added logic in `loadNotionContext` wrapper to convert loader-specific errors into standardized workflow `errorStatus` with appropriate `errorCode`s.
3. **Lint Fixes**: Renamed `aiComposerWorker.ts` and `promptRegistry.ts` along with test files to kebab-case, fixing over 4 ESLint errors.

### Tools & Skills Used
| Tool/Skill | Purpose |
|:---|:---|
| File Replacement | Updating complex worker logic efficiently |
| Node.js Test Runner | Ensuring no regressions in the 10 existing Integration Scenarios |
| Powershell | Renaming files rapidly to satisfy CI lint rules |

### Files Changed
| File | Action | Description |
|:---|:---|:---|
| `aiComposerWorker.ts` -> `ai-composer-worker.ts` | Modified/Renamed | Integrated new Notion loader |
| `promptRegistry.ts` -> `prompt-registry.ts` | Modified/Renamed | Changed context interface |
| `aiComposerWorker.test.ts` -> `ai-composer-worker.test.ts` | Modified/Renamed | Mocked new dependency, fixed assertions |
| `promptRegistry.test.ts` -> `prompt-registry.test.ts` | Modified/Renamed | Updated to match new interface |
| `run-tests.mjs` | Modified | Updated test file paths |
| `server.ts` | Modified | Updated import paths |

## Impact & Purpose
The AI Composer now securely fetches campaign briefs from Notion using an allowlist approach, defending against SSRF. Furthermore, feeding the raw block content to the LLM (instead of properties) allows for richer, longer-form context without strict column-mapping constraints in Notion.

## Decisions Made
| Decision | Rationale | Alternatives Considered |
|:---|:---|:---|
| Use raw text for prompt context | `loadNotionContext` returns a single string of block text; simpler than parsing properties | Trying to parse properties out of the raw text in the worker |
| Inject `loadNotionFn` in worker | Simplest way to mock the module in tests without complex ES Module mocking loaders | Using `mock.module` which requires latest node features and sometimes breaks |

## Verification
- [x] Tests passed (All 158 tests across the workspace, including 10 AI Composer integration tests)
- [x] Docs updated (Implementation Plan created and approved)
- [x] No secrets exposed (Redaction confirmed passing in tests)
- [x] Acceptance criteria met: N/A (Integration portion of US-013)

## Open Items / Next Steps
- Implement dynamic secret resolution for `NOTION_TOKEN` using `apps/facebook-mcp-server/src/services/databaseSecretStore.ts` or a new Orchestrator secret store. (Currently using `process.env.NOTION_TOKEN`).
