# Report: US-013 - Notion Campaign Brief Context Loader

**Date:** 2026-06-24
**Agent(s) Used:** GPT-5 Codex / AI Orchestrator
**Related User Story:** US-013
**Status:** Implemented - local validation passed, runtime smoke not performed

## Summary
Implemented the `NotionContextLoader` utility to securely fetch campaign guidelines/briefs from the Notion API. The module normalizes output for the AI Composer and enforces strict boundary and security checks, such as validating Page IDs and imposing payload size limits.

## What Was Done
- [x] Drafted and refined the detailed specification (`docs/specs/SPEC-US-013-Notion-Context-Loader.md`) including all security rules.
- [x] Defined data interfaces `NotionLoaderInput`, `NotionLoaderConfig`, and `NotionContextResult`.
- [x] Created the mock-based unit tests asserting 7 different edge cases (L2 Validation).
- [x] Implemented `loadNotionContext` to fetch blocks from `api.notion.com` via HTTPS with an abort signal timeout and streaming size limit.

## How It Was Done
### Approach
We adopted a Test-Driven Development (TDD) workflow (Red-Green-Refactor). First, a stub and failing tests were written. After encountering failing tests, the actual implementation was coded, which uses `fetch` with a `ReadableStream` to strictly enforce `maxResponseBytes` without downloading oversized malicious payloads. 

### Tools & Skills Used
| Tool/Skill | Purpose |
|:---|:---|
| TDD Workflow | Ensures code meets specs before merging. |
| Node.js native test runner | Executing the test suite. |
| Node.js fetch & streams | Reading chunked body for memory-safe size limiting. |

### Files Changed
| File | Action | Description |
|:---|:---|:---|
| `docs/specs/SPEC-US-013-Notion-Context-Loader.md` | Created | Specification detailing SSRF rules and acceptance criteria. |
| `docs/plans/US-013/PLAN-US-013-Notion-Loader.md` | Modified | Updated plan to map exactly to the approved Spec. |
| `apps/orchestrator/src/__tests__/notion-context-loader.test.ts` | Created | Unit tests for L2 validation. |
| `apps/orchestrator/src/ai/notion-context-loader.ts` | Created | The implementation of the loader. |

## Impact & Purpose
This provides a safe mechanism for the orchestrator to fetch external context. By rigidly validating the Notion Page ID and using a hardcoded `api.notion.com` base URL, we eliminate the risk of SSRF. Streaming chunk limits protect the orchestrator from Denial of Service (DoS) attacks via oversized payloads.

## Decisions Made
| Decision | Rationale | Alternatives Considered |
|:---|:---|:---|
| Hardcode `api.notion.com` base URL | Eliminates the risk of SSRF via custom domain/IP resolving. Allows us to drop the custom DNS validation. | Accepting full Notion URLs, which would require a complex SSRF filter. |
| Stream response body | Enables aborting the fetch mid-flight if the body size exceeds the configured `maxResponseBytes`. | Fetching the full string and then checking `string.length`, which risks out-of-memory errors on massive payloads. |

## Verification
- [x] Tests passed locally via full `npm test` on 2026-06-29: 412 tests, 0 failures.
- [x] Docs updated (Spec, Plan, Report).
- [x] No secrets exposed (Code resolves `secretRef` via injected `tokenResolver` and does not log or manipulate raw tokens improperly).
- [x] Acceptance criteria met: AC1 to AC5 verified via unit tests.

## Open Items / Next Steps
- Integrate the `NotionContextLoader` into the main AI Composer Worker (`FL-002`) to load campaign guidelines when a Notion URL is attached to an Airtable post.
- Runtime smoke test with a real or mocked Notion integration is still required before claiming production readiness.
