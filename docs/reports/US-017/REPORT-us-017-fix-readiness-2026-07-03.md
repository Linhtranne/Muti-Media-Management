# Report: TikTok Publishing Fixed Readiness (US-017)

**Date:** 2026-07-03
**Agent(s) Used:** Antigravity (Gemini 3.1 Pro)
**Related User Story:** US-017
**Status:** Partial - staging gates passed, live TikTok photo smoke passed; broader production rollout pending

## Summary
Implemented the TikTok Content Posting API request flow (creator info query, video init, photo content init, and status fetch) using native `fetch` within the MCP tools. The orchestrator dynamically queries Airtable, validates media asset derivatives, rejects presigned URL query secrets, enforces title/description length limits, and scrubs query secrets from logs/DLQ-facing errors. Code gates pass locally. On 2026-07-06, a live TikTok sandbox photo smoke passed after R2 URL ownership verification and replacement of an invalid 107-byte placeholder image with a valid JPEG derivative.

## What Was Done
- [x] Implemented real TikTok Content Posting API v2 endpoints (`/v2/post/publish/creator_info/query/`, `/v2/post/publish/video/init/`, `/v2/post/publish/content/init/`, `/v2/post/publish/status/fetch/`) inside `apps/tiktok-mcp-server`.
- [x] Added the `queryTikTokCreatorInfo` tool to the TikTok MCP server.
- [x] Refactored `TiktokValidateWorker` to fetch the post type and privacy settings from Airtable and execute strict database-level checks (ensuring `tiktok_video` or `tiktok_photo` derivative kind exist, and the public URL contains no presigned query parameters/secrets).
- [x] Enforced strict title and description limits (max 2200 runes for video title, max 90 runes for photo title, max 4000 runes for photo description) to block silent copy truncation.
- [x] Implemented robust query/token parameter scrubbing from error messages and log outputs in `TiktokPublishWorker` and `TiktokValidateWorker` to avoid exposing secrets to DLQs, logs, or Slack.
- [x] Restructured Zod schemas in `packages/shared-contracts` to enforce official limits, valid privacy level enums, and exclude raw credential fields.
- [x] Added explicit TikTok brand content and brand organic toggles to MCP publish contracts and API request bodies.
- [x] Corrected status polling to use official TikTok statuses (`PROCESSING_UPLOAD`, `PROCESSING_DOWNLOAD`, `SEND_TO_USER_INBOX`, `PUBLISH_COMPLETE`, `FAILED`) and `/v2/post/publish/status/fetch/`.
- [x] Replaced restrictive database migration checks in `0021_us017_tiktok_publishing.sql` with defensive `DO` blocks to allow future multi-channel expansion.
- [x] Verified full compliance with unit test suites, eslint checks, and compiler tasks.
- [x] Added permanent error classification for TikTok platform rejections such as `file_format_check_failed` and `url_ownership_unverified`, preventing bad media/domain configuration from being retried indefinitely.
- [x] Completed live TikTok sandbox photo smoke with a valid R2-hosted JPEG derivative; the resulting publish job reached `published`.

## How It Was Done
### Approach
To align with the official API reference, native `fetch` requests were introduced in `tiktokPublishTools.ts` utilizing Bearer authorization. During post validation, the creator's allowed privacy levels are first queried from the TikTok API before verifying that the post's privacy level is supported. 
Database-level checks verify that optimized media asset derivatives match the required post type and inspect public URLs for the presence of query parameters, rejecting them if found. Text length validation was updated to fail validation explicitly if limits are exceeded.
A URL-scrubbing helper cleans query parameters from error strings before logging. 
Finally, the DB check constraints in the migration file were wrapped in defensive `DO` blocks to dynamically drop and expand allowed platform values.

### Tools & Skills Used
| Tool/Skill | Purpose |
|:---|:---|
| Code Edits | Implementing API endpoints, validating media derivatives, fixing DB constraints, and securing logs. |
| Command Execution | Running tests, database migration scripts, linting checks, and compiler tools. |

### Files Changed
| File | Action | Description |
|:---|:---|:---|
| [tiktok.ts](file:///d:/Muti-Media%20Management/packages/shared-contracts/src/mcp/tiktok.ts) | Modified | Updated video/photo limits, privacy enums, and added creator info schema. |
| [tiktokContracts.test.ts](file:///d:/Muti-Media%20Management/packages/shared-contracts/src/__tests__/tiktokContracts.test.ts) | Modified | Updated contract validation tests to cover the new length and enum rules. |
| [reloadedRecord.ts](file:///d:/Muti-Media%20Management/packages/shared-contracts/src/airtable/reloadedRecord.ts) | Modified | Added `tiktok_privacy_level` to `AirtablePostFieldsSchema`. |
| [index.ts](file:///d:/Muti-Media%20Management/apps/tiktok-mcp-server/src/index.ts) | Modified | Registered `queryTikTokCreatorInfo` tool. |
| [tiktokPublishTools.ts](file:///d:/Muti-Media%20Management/apps/tiktok-mcp-server/src/tools/tiktokPublishTools.ts) | Modified | Implemented native fetch API requests and structured interfaces. |
| [tiktokValidateWorker.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/workers/tiktokValidateWorker.ts) | Modified | Refactored validation rules, post type discovery, and presigned URL checks. |
| [tiktokPublishWorker.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/workers/tiktokPublishWorker.ts) | Modified | Mapped photo/video fields to match schemas and scrubbed secrets from error strings. |
| [tiktokPublishWorker.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/tiktokPublishWorker.test.ts) | Modified | Added regression coverage for permanent TikTok platform rejection handling. |
| [tiktokValidateWorkerRepository.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/ledger/tiktokValidateWorkerRepository.ts) | Modified | Queried and returned ready media derivatives for validation context. |
| [tiktokValidateWorker.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/tiktokValidateWorker.test.ts) | Modified | Added tests verifying derivative checks, presigned URL rejection, and copy limits. |
| [0021_us017_tiktok_publishing.sql](file:///d:/Muti-Media%20Management/db/migrations/0021_us017_tiktok_publishing.sql) | Modified | Re-coded to use defensive DO blocks and broad platform check list. |
| [server.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/server.ts) | Modified | Passed `airtableClient` to `TiktokValidateWorker`. |

## Impact & Purpose
The TikTok Publishing pipeline is type-safe, covered by local tests, and aligned with the official Content Posting API request shapes used by the implementation. The system prevents accidental leaks of pre-signed media URLs to logs or DLQ-facing errors while ensuring only properly formatted posts are sent to TikTok. Production readiness still requires live runtime smoke with real TikTok credentials and verified media URL/domain configuration.

## Decisions Made
| Decision | Rationale | Alternatives Considered |
|:---|:---|:---|
| Strict API Response Types | Eliminates explicit `any` casting in the MCP tools and satisfies strict `typescript-eslint` rules. | Disabling specific lint rules locally (rejected). |
| Preserve Copy in Description | For photo posts, variant copy is mapped to `description`; `title` is omitted when copy exceeds TikTok's 90-character title limit, avoiding silent truncation. | Truncating copy (rejected). |
| Defensive DO Blocks in Migrations | Ensures compatibility with future channels and avoids dropping constraints destructively. | Broadening constraint to wildcards (rejected). |
| Treat non-retriable TikTok platform validation failures as permanent | `file_format_check_failed` and `url_ownership_unverified` require data/config correction, not RabbitMQ retry loops. | Retrying as transient (rejected after runtime smoke evidence). |

## Verification
- [x] All test suites passed successfully.
- [x] Linting rules passed with 0 errors and 0 warnings.
- [x] Build compilation and typechecking succeeded.
- [x] Tracing verified and passed via `npm run ai-sdlc:check -- US-017`.
- [x] Live TikTok photo runtime smoke completed in sandbox (`publish_jobs.status = published`).

## AI-SDLC Completion Gate
- AC-001: Pass - Implemented the real TikTok creator info query endpoint.
- AC-002: Pass - Added the queryTikTokCreatorInfo MCP tool to the server.
- AC-003: Pass - Validation worker verifies media derivatives, post type mapping, and rejects presigned URLs containing query secrets.
- AC-004: Pass - Enforced video title limit (2200 runes) and photo title/description limits (90/4000 runes) to prevent silent truncation.
- AC-005: Pass - Scrubbed AWS S3/R2 presigned URL query secrets from logs and DLQ payloads.
- AC-006: Pass - Configured feature flags and unified error handling; live TikTok sandbox photo smoke completed with verified R2 URL ownership.

## Open Items / Next Steps
- Execute separate live video smoke verification when a valid TikTok-ready video derivative is available.
- Confirm whether brand content / organic flags should be Airtable-managed fields per channel policy, or default false for non-sponsored posts.
