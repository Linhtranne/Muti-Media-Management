# Report: Implementation of Notion Knowledge & Brief Plane (US-013)

**Date:** 2026-06-03
**Agent(s) Used:** backend-specialist, security-auditor
**Related User Story:** US-013
**Status:** Completed

## Summary
Successfully hardened the Notion Knowledge & Brief Plane integration according to US-013. Replaced loosely typed `z.any()` schema with a strict validation schema for `notion_context_refs`, secured the LLM prompt against Notion prompt injection with explicit boundary tags, and hardened the worker logic to explicitly hard-fail on SSRF attempts without falling back to objective metadata. All tests pass successfully.

## What Was Done
- [x] Eliminated `z.array(z.any())` for `notion_context_refs` and implemented `NotionContextRefSchema` with `.strict()` parsing to reject any unlisted fields (such as tokens, secrets, or raw responses).
- [x] Defined max 255 chars for `error_message` within the Notion context array to prevent DB overflow/OOM from raw stack traces.
- [x] Wrapped Notion content in `<notion_context>` XML boundaries within `fb_composer_v1.0.0` prompt template.
- [x] Added system prompt instructions declaring Notion content as reference material that cannot override core constraints.
- [x] Hardened `AiComposerWorker` to trap `NotionSsrfError` and mark the AI Run Status as `failed` (Hard Fail) without executing fallback to `campaign_objective`.
- [x] Verified missing variables in `run-tests.mjs` and ensured the newly added tests ran completely. All 297 tests passed.

## How It Was Done
### Approach
1. **Schema Hardening**: Created a rigorous `NotionContextRefSchema` that strictly permits specific fields (`notion_brief_url`, `load_status`, `ai_ready`, `error_code`, `error_message`). Used `.strict()` and rejected any hidden tokens/secrets.
2. **Worker Logic**: Modified `processCampaignBrief` and `loadNotionContext` in `aiComposerWorker.ts` to examine errors. If it's `NotionSsrfError`, immediately re-throw and set status to `failed` (`ai_generation_failed`). Fallback is only allowed for standard `CONTEXT_UNREACHABLE` errors.
3. **Prompt Hardening**: Modified `promptRegistry.ts` to wrap the dynamic brief into `<notion_context> ... </notion_context>` to act as a jail boundary, ensuring the LLM doesn't confuse untrusted brief material with system directives.
4. **Testing**: Modified imports to `node:test` due to native node runner and fixed validation logic in mock tests (e.g. `cta_url` enforcement in `SC-10`). Passed all unit and integration tests.

### Tools & Skills Used
| Tool/Skill | Purpose |
|:---|:---|
| multi_replace_file_content | Precise modification of schemas and templates |
| run_command | Test execution via native `node run-tests.mjs` and validation |
| security-auditor rules | SSRF and Prompt Injection boundary protection |

### Files Changed
| File | Action | Description |
|:---|:---|:---|
| `packages/shared-contracts/src/ai/composer.ts` | Modified | Hardened `notion_context_refs` schema from `any` to strict definitions. |
| `apps/orchestrator/src/workers/aiComposerWorker.ts` | Modified | Eliminated silent fallback for SSRF via explicit `NotionSsrfError` checks. |
| `apps/orchestrator/src/ai/promptRegistry.ts` | Modified | Implemented `<notion_context>` boundary tags in LLM prompts. |
| `packages/shared-contracts/src/__tests__/composer.test.ts` | Created | Added unit tests to ensure schema explicitly rejects forbidden fields and long messages. |
| `apps/orchestrator/src/__tests__/promptRegistry.test.ts` | Created | Asserted prompt tags. |
| `apps/orchestrator/src/__tests__/aiComposerWorker.test.ts` | Modified | Added `SC-09` (SSRF hard fail) and `SC-10` (Fallback success) tests. |
| `docs/requirements/05_Function_Flow_Logic_Register.md` | Modified | Updated FL register as reported in previous iteration. |

## Impact & Purpose
The integration with Notion is now considered Production Ready for MVP. By sandboxing the Notion input (both at the execution level and the LLM comprehension level), we mitigate the risk of prompt injections from external editors. The schema validation ensures that any accidental internal token leakage during Notion HTTP calls will be rejected before being persisted to the Ledger, fulfilling strict NFR requirements.

## Decisions Made
| Decision | Rationale | Alternatives Considered |
|:---|:---|:---|
| Using `.strict()` on `NotionContextRefSchema` | By strictly blocking unspecified keys, any accidentally returned internal IDs or tokens will cause an early validation error, acting as a foolproof safety net against leakage. | Using `.omit()` or filtering fields manually (more error-prone). |
| Failing SSRF but Falling Back on 404 | SSRF represents an active security attack or fatal misconfiguration, which shouldn't be patched over. A 404 is an operational missing link, which is valid to bypass for MVP resilience. | Failing on all errors (too brittle for production operations). |

## Verification
- [x] Tests passed (`npm run test` -> 297/297 passed)
- [x] Docs updated
- [x] No secrets exposed
- [x] Acceptance criteria met: Security schema rules implemented, prompt injection boundary created, SSRF hard-fail verified.

## Open Items / Next Steps
- Production monitoring of `NOTION_NOT_ALLOWLISTED` metrics for abuse detection.
