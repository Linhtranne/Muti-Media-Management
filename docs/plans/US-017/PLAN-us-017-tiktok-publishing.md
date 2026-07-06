# PLAN-US-017: TikTok Publishing Pipeline

status: partial

## Goal
Implement TikTok publishing using the US-016 shared media pipeline. Introduce a new TikTok MCP Server to handle TikTok API boundaries, OAuth, and asynchronous publish polling.

## Current State Scan
- US-016 provides optimized media in Cloudflare R2.
- Facebook publish pipeline exists and proves the MCP + Queue + Ledger model.
- No TikTok MCP or TikTok integration currently exists.

## Architecture Decision
- Use a dedicated `tiktok-mcp-server` app. Given the composability architecture, a separate MCP server for TikTok (e.g. `apps/tiktok-mcp-server`) fits well to isolate TikTok dependencies and API rate limits.
- Implement an async polling loop in the orchestrator: publish worker -> `pending_platform_status` -> schedule `publish.tiktok.status_check` -> status worker -> MCP check status -> `published` or `failed`.

## Implementation Phases
1. **Bootstrap TikTok MCP Server:** Create `apps/tiktok-mcp-server`, setup SecretStore, and implement basic tools (Auth, RateLimit).
2. **TikTok Shared Contracts & Ledger:** Update `shared-contracts` and `policy-engine` with TikTok-specific rules. Add DB migrations if needed for async job states.
3. **Queue Topology & Workers:** Add TikTok queues (`publish.tiktok.requested`, `execute`, `status_check`) and implement Orchestrator workers.
4. **Validation & Publish Tools:** Implement `validate_tiktok_post`, `publish_tiktok_post`, and `get_tiktok_publish_status` in TikTok MCP.
5. **Testing & Integration:** Wire everything up, run unit/integration tests, and perform local smoke tests using TikTok's sandbox/mock.
6. **Real Smoke Test:** Execute a real TikTok publish on a staging account.

## Tasks
- AC-001: Create `apps/tiktok-mcp-server` with `index.ts` and tool registry.
- AC-002: Add TikTok events to `shared-contracts`.
- AC-003: Update `publish_jobs` status enum to support `pending_platform_status`.
- AC-004: Implement TikTok rules in `packages/policy-engine`.
- AC-005: Create `TiktokValidationWorker`, `TiktokPublishWorker`, and `TiktokStatusWorker` in Orchestrator.
- AC-006: Add `tiktok_auth_tools`, `publish_tiktok_post`, `get_tiktok_publish_status` to TikTok MCP.
- AC-007: Wire TikTok queues in `topologyConfig.ts`.
- AC-008: Add integration tests and update `run-tests.mjs`.

## Data/Migration Plan
- Create `db/migrations/0021_us017_tiktok_publishing.sql`.
- Add `tiktok` to platform enums.
- Add `pending_platform_status` to `publish_job_status` enum.
- Add `tiktok_request_id` to `publish_jobs` to track async TikTok API responses.

## Shared Contract Plan
- Add `PublishTiktokRequestedEvent`, `PublishTiktokExecuteEvent`, `PublishTiktokStatusCheckEvent`.
- Define MCP schemas for TikTok validation, publish, and status tools.

## MCP Tool Plan
- `get_tiktok_rate_limit_status`: Checks TikTok API quota.
- `validate_tiktok_post`: Ensures media derivatives are R2 links, text meets limits.
- `publish_tiktok_post`: POST to TikTok `/v2/post/publish/video/init/` or equivalent. Returns request ID.
- `get_tiktok_publish_status`: POST to TikTok `/v2/post/publish/status/fetch/` using `publish_id`.
- `tiktok_auth_tools`: For OAuth token generation.

## Orchestrator Worker Plan
- `TiktokValidationWorker`: Calls MCP to validate. Transitions job to `validated`.
- `TiktokPublishWorker`: Calls MCP to publish. Transitions job to `pending_platform_status` and emits `status_check` delayed message.
- `TiktokStatusWorker`: Checks status. Requeues if processing, updates to `published` or `failed` when done.

## Queue Topology Plan
- `publish.tiktok.requested` -> `TiktokValidationWorker`
- `publish.tiktok.execute` -> `TiktokPublishWorker`
- `publish.tiktok.status_check` -> `TiktokStatusWorker` (using delayed delivery or retry TTL mechanics to wait 1-2 minutes between checks).
- DLQs for all.

## Policy Integration Plan
- Update `packages/policy-engine` to handle TikTok length (max 2200 chars), hashtag limits, and media count (1 video OR 1-35 images).

## Test Matrix
- Unit: TikTok policy rules.
- Contract: TikTok MCP tool schemas.
- Worker: Validation, execution, and status polling loop (with mock MCP).
- Queue: Requeue logic for pending status checks.

## Runtime Smoke Plan
- Use `TIKTOK_MOCK_MODE=true` for local development.
- Staging smoke: Turn off mock mode, connect a real TikTok account, push a short R2 video, observe Ledger transition to `published`, verify on TikTok app.

## Done When
- TikTok publishing integration boundary is implemented via MCP.
- Queue payloads remain reference-only.
- Orchestrator handles async TikTok status polling correctly against mock/sandboxed APIs.
- *Open Item:* Real-world live API publishing is verified once production credentials are provided.

## Open Items
- Real TikTok runtime smoke remains pending until a TikTok developer app has Content Posting API enabled, `video.publish` approved for the environment, and the media URL domain or prefix verified by TikTok.
- If TikTok returns `PUBLISH_COMPLETE` without `publicaly_available_post_id` for private or unaudited posts, Ledger stores a `publish_id:<publish_id>` reference until a public post ID becomes available.
