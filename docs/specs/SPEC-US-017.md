# SPEC-US-017: TikTok Publishing Pipeline

status: approved

**Related Epic:** Multi-Platform Publishing Expansion
**Related Stories:** US-016
**Owner:** Backend / MCP / DevOps
**Planning Date:** 2026-07-01

## Goal
Enable publishing approved content to TikTok from the same Airtable/AI/Policy/RabbitMQ pipeline, using media derivatives created by US-016. Ensure a production-oriented design with separate channel-based paths.

## Users / Roles
- Content creator: selects TikTok as a target channel in Airtable.
- Social media manager: approves the TikTok content variant.
- Backend worker: validates, enqueues, and monitors TikTok publish jobs.
- Admin / operator: configures TikTok Developer App credentials and manages OAuth tokens.

## Current Context
- US-016 is complete and provides shared media assets in R2 (optimized video/photo).
- The system supports a channel-based publishing model (Facebook currently exists).
- Orchestrator owns the workflow, Ledger, RabbitMQ, policy engine, and audit log.
- TikTok API interactions, OAuth, and status polling must live exclusively within the TikTok MCP Server.

## In Scope
- TikTok publishing via the official TikTok Content Posting API.
- Support for TikTok video posts.
- Support for TikTok photo posts/carousels (if supported by current TikTok API).
- Channel-specific media eligibility rules and validations.
- TikTok MCP server with tools for OAuth, validation, execution, and status polling.
- Orchestrator workers and schedulers to interact with TikTok MCP.
- Polling mechanism to handle asynchronous TikTok publish statuses.
- Audit logging, retry, and DLQ behavior specific to TikTok publish jobs.

## Out of Scope
- Direct calling of TikTok API from the orchestrator.
- Handling raw binary media, tokens, or signed URL secrets in RabbitMQ payloads.
- Mixed generic platform publish logic (Facebook and TikTok are decoupled).
- Automated AI video generation or editing beyond US-016 optimizations.

## Assumptions
- TikTok API permits automated publishing for registered developer apps.
- Cloudflare R2 public URLs are accessible by TikTok's media ingestion servers.
- TikTok requires asynchronous status checks after requesting a post.
- TikTok MCP will handle credential resolution internally via a secret store.

## Open Questions
- None. (All resolved: OQ-017-1 resolved to support photo carousels via Content Posting API; OQ-017-2 resolved to 1 min polling interval with 15 mins timeout; OQ-017-3 resolved to rely on polling for status check MVP).

## Data Model
### Ledger Table Additions / Updates
- `channel_account`: platform enum now supports `tiktok`.
- `content_variants`: platform enum supports `tiktok`.
- `publish_jobs`: platform enum supports `tiktok`, status enum needs to handle async states (`queued`, `mcp_validating`, `validated`, `publishing`, `pending_platform_status`, `published`, `failed`).
- `publish_jobs`: add `tiktok_request_id` to track async TikTok API responses.

## Airtable Fields / Inputs
- `target_channels`: includes `TikTok`.
- `tiktok_post_type`: single select (`video`, `photo`).

## Shared Contracts
- Event: `publish.tiktok.requested`
- Event: `publish.tiktok.validated`
- Event: `publish.tiktok.execute`
- Event: `publish.tiktok.status_check`
- Payloads must contain reference IDs only (`job_id`, `variant_id`, `channel_account_id`). No raw text/tokens.

## RabbitMQ Events
- `publish.tiktok.requested`: trigger for MCP validation.
- `publish.tiktok.validated`: trigger for scheduling execution.
- `publish.tiktok.execute`: trigger to call TikTok MCP publish.
- `publish.tiktok.status_check`: delayed event/polling trigger to check async publish status.
- DLQs for each queue.

## TikTok MCP Tools
- `get_tiktok_rate_limit_status`: returns current quota for TikTok API.
- `validate_tiktok_post`: validates rules based on TikTok restrictions.
- `publish_tiktok_post`: initiates publish via TikTok API, returns an initial request ID or status.
- `get_tiktok_publish_status`: polls TikTok API using the request ID to check if publishing is completed.
- `tiktok_auth_tools`: for generating OAuth URLs and exchanging tokens.

## Orchestrator Flow
1. **Policy Evaluation:** Policy engine approves TikTok variant -> enqueues `publish.tiktok.requested`.
2. **Validation Worker:** Consumes event -> calls MCP `validate_tiktok_post` -> updates job to `validated` -> enqueues `publish.tiktok.validated`.
3. **Execution Scheduler:** Scheduled job emits `publish.tiktok.execute`.
4. **Publish Worker:** Consumes event -> calls MCP `publish_tiktok_post` -> updates job to `pending_platform_status` -> schedules a `publish.tiktok.status_check` event.
5. **Status Check Worker:** Consumes event -> calls MCP `get_tiktok_publish_status`. If still processing, requeue status check with delay. If success, mark `published`. If failed, mark `failed` and alert Slack.

## Policy / Validation Rules
- TikTok media must come from R2 derivatives marked as `tiktok_video` or `tiktok_photo` generated in US-016.
- Text length restrictions specific to TikTok.
- Exactly one optimized video for a video post.
- 1 to 35 optimized images for a photo post (pending OQ-017-1).
- Missing TikTok OAuth token blocks publishing.

## Media Eligibility Rules
- Managed via `post_media_assets.platform_eligibility` set by US-016. TikTok publisher must check `eligibility->'tiktok' == 'eligible'`.

## OAuth / Token Boundary
- TikTok access/refresh tokens stored securely.
- Orchestrator only holds a reference.
- MCP Server resolves token internally before hitting TikTok API.

## Error Handling
- Transient errors (network, timeout): TTL retry and backoff in RabbitMQ.
- Permanent errors (auth failure, validation): Fail closed, move to DLQ, alert via Slack.
- TikTok API rejection: Mark job as `failed`, parse and record sanitized error in Ledger, send Slack alert.

## Retry / DLQ Behavior
- RabbitMQ handles retries using TTL queues.
- `*.dlq` used for poison messages.
- ACK only after Ledger commit or confirmed DLQ write.

## Audit Logging
- Audit events: `TIKTOK_VALIDATION_COMPLETED`, `TIKTOK_PUBLISH_STARTED`, `TIKTOK_PUBLISH_STATUS_PENDING`, `TIKTOK_PUBLISH_SUCCEEDED`, `TIKTOK_PUBLISH_FAILED`.
- Scoped by `workspace_id`. No raw tokens or full HTTP responses in logs.

## Security Rules
- No TikTok API calls from orchestrator.
- Token never exposed to Airtable, Slack, or RabbitMQ.
- `workspace_id` scoping for all DB queries.

## Acceptance Criteria
- **AC-001:** TikTok publish job is decoupled from Facebook publish job.
- **AC-002:** TikTok publish uses media derivatives from US-016.
- **AC-003:** TikTok MCP tool `publish_tiktok_post` initiates the publish.
- **AC-004:** Orchestrator polls TikTok MCP for async status until success or failure.
- **AC-005:** No tokens or binary media in RabbitMQ payloads.
- **AC-006:** Slack alert triggered on publish failure with sanitized reason.

## Test Plan
- Unit tests for TikTok policy rules.
- Contract tests for TikTok MCP tools and RabbitMQ events.
- Integration tests for Orchestrator TikTok Workers (validation, publish, status check).
- Mock TikTok MCP server tests.

## Runtime Smoke Plan
- Connect a test TikTok account via OAuth.
- Push an approved Airtable post targeted at TikTok.
- Monitor logs for Validation -> Publish -> Status Check.
- Verify video/photo appears on test TikTok account.

## Production Readiness Checklist
- [ ] TikTok App approved for Content Posting API.
- [ ] Secure token store configured for TikTok MCP.
- [ ] End-to-end smoke test passed with a real TikTok account.
- [ ] **Staging / Production Credentials:** Resolve missing credentials to enable live API publish. (Status: Partial / Mock-ready).
