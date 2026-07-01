# SPEC-US-017: TikTok Direct Posting MCP

status: approved

**Related Epic:** Multi-Platform Publishing Expansion  
**Depends On:** US-016 Shared Media Asset Storage and Optimization Pipeline  
**Owner:** Backend / MCP / Platform Integrations  
**Planning Date:** 2026-07-01

## Goal

Add a TikTok MCP integration that can publish approved TikTok video and photo posts through TikTok Direct Post APIs while preserving per-channel publishing, token isolation, media references, and Ledger-backed auditability.

## Users / Roles

- Content creator: enters campaign brief and uploads media in Airtable.
- Social media manager: reviews `tiktok_caption`, hashtags, post type, and media readiness.
- Admin: connects TikTok account through OAuth or manual staging seed fallback.
- TikTok MCP server: owns all TikTok API calls and token resolution.
- Orchestrator workers: create and process TikTok publish jobs without raw platform tokens.

## In Scope

- Add TikTok as a target platform in the existing multi-platform publish pipeline.
- Support TikTok Direct Post for both video and photo posts.
- Generate and persist platform-specific AI output fields: `tiktok_caption`, `tiktok_hashtags`, and `tiktok_post_type`.
- Support per-channel publish jobs so Facebook and TikTok can succeed or fail independently.
- Use ready media derivatives from US-016 only.
- Add TikTok OAuth production design with manual seed fallback for staging and demo.
- Add TikTok MCP tools for creator info, publish init, upload or source URL handoff, and status polling.
- Persist TikTok publish status, external post id, and sanitized platform response summaries.

## Out of Scope

- Building a TikTok user-facing admin UI beyond backend routes and scripts.
- Publishing TikTok comments or direct messages.
- TikTok analytics ingestion.
- Instagram, Zalo, YouTube Shorts, or Threads publishing.
- Bypassing TikTok app review, scope approval, or platform restrictions.
- Reusing Facebook body as TikTok content without platform-specific generation.

## Current Context and Constraints

- Existing architecture isolates platform APIs inside MCP servers.
- Existing Facebook publish pipeline uses `publish_jobs`, RabbitMQ, Postgres Ledger, and MCP tool calls.
- US-016 will provide R2 media derivatives and media eligibility metadata.
- TikTok Direct Post requires approved access and OAuth scopes. Runtime may be blocked by platform review even if code is correct.
- TikTok creator restrictions must be queried before publishing.
- A single TikTok post must not mix video and photo assets.

## Data Model / Fields

### Airtable Fields

- `target_channels`: includes `TikTok`.
- `tiktok_caption`: AI-generated and human-reviewable.
- `tiktok_hashtags`: AI-generated and human-reviewable.
- `tiktok_post_type`: `video` or `photo`; may be inferred if media is unambiguous.
- `tiktok_publish_status`: `not_started`, `blocked`, `queued`, `publishing`, `published`, `failed`.
- `tiktok_external_post_id`: sanitized external TikTok post id or share id when available.
- `overall_publish_status`: `not_started`, `partially_published`, `published`, `failed`.

### Ledger Changes

- Extend `channel_accounts.provider` to include `tiktok` if not already supported.
- Extend `publish_jobs.platform` or equivalent platform metadata to include `tiktok`.
- Store TikTok publish attempts in existing `publish_jobs` where possible.
- Add `tiktok_publish_events` only if existing publish event tables cannot represent TikTok safely.
- Store `creator_info_snapshot` as sanitized JSON in Ledger or publish job metadata.

## API / Contract

### MCP Tools

#### `generate_tiktok_oauth_url`

Input:

```json
{
  "workspaceId": "ws_staging",
  "redirectUri": "https://example.com/api/v1/admin/tiktok/auth/callback",
  "state": "opaque-state"
}
```

Output:

```json
{
  "authorizationUrl": "https://www.tiktok.com/v2/auth/authorize/..."
}
```

#### `exchange_tiktok_code`

Input: `workspaceId`, `code`, `redirectUri`, and `state`.  
Output: opaque secret reference and sanitized TikTok account metadata.

#### `query_tiktok_creator_info`

Input: `channelAccountId` or account reference.  
Output: sanitized creator constraints including privacy options and feature availability.

#### `publish_tiktok_post`

Input:

```json
{
  "jobRef": { "jobId": "uuid" },
  "channelAccountId": "tiktok-account-id",
  "secretRef": "opaque-secret-ref",
  "postType": "video",
  "caption": "Approved TikTok caption",
  "hashtags": ["mediaops"],
  "media": [
    {
      "type": "video",
      "url": "https://r2-public.example.com/workspaces/ws/posts/post/video.mp4",
      "mimeType": "video/mp4"
    }
  ],
  "privacyLevel": "SELF_ONLY"
}
```

Output:

```json
{
  "success": true,
  "externalPostId": "tiktok-publish-id",
  "status": "processing",
  "platformResponseSummary": {
    "provider": "tiktok",
    "post_type": "video"
  }
}
```

### Queue

- `publish.tiktok.requested`
- `publish.tiktok.validated`
- `publish.tiktok.execute`
- `publish.tiktok.status_check`

All payloads must be reference-only and must not contain raw token, raw platform response, binary media, or signed URL query secrets.

## Happy Path

1. User creates an Airtable record with `target_channels = Facebook, TikTok`.
2. User uploads media assets and sets or allows inference of `tiktok_post_type`.
3. AI Composer generates `facebook_body` and `tiktok_caption` separately.
4. User reviews platform-specific fields.
5. User sets `status = Approved for Publish`.
6. Policy creates separate publish jobs for Facebook and TikTok.
7. TikTok worker reloads TikTok job, channel account, creator info, and US-016 media derivatives.
8. Worker calls TikTok MCP `query_tiktok_creator_info`.
9. Worker calls TikTok MCP `publish_tiktok_post`.
10. Ledger stores sanitized result and marks TikTok job `published` or `publishing`.
11. Status checker confirms final post status when TikTok requires asynchronous processing.
12. Airtable reflects per-channel status.

## Error Cases

- `TIKTOK_ACCOUNT_NOT_CONNECTED`: no active TikTok `channel_accounts` row.
- `TIKTOK_TOKEN_INVALID`: token health check or publish fails auth.
- `TIKTOK_SCOPE_MISSING`: app/token lacks required publish scope.
- `TIKTOK_CREATOR_RESTRICTED`: creator info disallows requested post settings.
- `TIKTOK_MEDIA_NOT_READY`: US-016 derivative missing or failed.
- `TIKTOK_MIXED_MEDIA`: TikTok post contains both video and photo assets.
- `TIKTOK_TOO_MANY_PHOTOS`: photo post exceeds 35 images.
- `TIKTOK_PLATFORM_TRANSIENT`: API timeout or 5xx.
- `TIKTOK_PLATFORM_REJECTED`: platform rejects content or privacy settings.

## Edge Cases

- Facebook succeeds but TikTok fails.
- TikTok OAuth is not approved but manual seed fallback exists for staging.
- TikTok post remains in processing state for longer than expected.
- Creator privacy options do not include requested privacy level.
- R2 URL is public but TikTok cannot pull it due DNS or content-type mismatch.
- User changes Airtable media after media derivatives were generated.

## Security and Permission Rules

- Orchestrator never calls TikTok APIs directly.
- Raw TikTok tokens are resolved only inside TikTok MCP server.
- Manual seed fallback is staging/demo only and must be documented in reports.
- No raw platform response in audit metadata.
- No token, secret reference, or signed media URL query in RabbitMQ.
- TikTok publish jobs are tenant-scoped by `workspace_id`.
- Per-channel failure must not roll back successful Facebook jobs.

## Platform Rules

### TikTok Video

- Post type: `video`.
- Exactly one ready video derivative.
- Output generated by US-016.
- Max output size: 1 GB for MVP policy.

### TikTok Photo

- Post type: `photo`.
- 1 to 35 ready image derivatives.
- Max output size per image: 50 MB.
- Images and videos cannot be mixed in a single TikTok post.

## Acceptance Criteria

**AC-001: TikTok can be selected with Facebook in the same record**  
Given an Airtable record has `target_channels = Facebook, TikTok`  
When the publish pipeline runs  
Then separate publish jobs are created per channel  
And each channel can succeed, fail, or block independently.

**AC-002: TikTok publish uses MCP only**  
Given a TikTok publish job is ready  
When the worker executes the job  
Then it calls TikTok MCP tools only  
And orchestrator code does not call TikTok APIs directly.

**AC-003: TikTok media rules are enforced**  
Given a TikTok post contains mixed video and photo media  
When policy evaluates TikTok eligibility  
Then TikTok publish is blocked with `TIKTOK_MIXED_MEDIA`  
And Facebook eligibility remains independent.

**AC-004: TikTok OAuth production path and fallback are documented**  
Given TikTok API approval is unavailable during staging  
When admin setup runs  
Then manual seed fallback can create a staging TikTok channel account  
And the report records the platform approval blocker without claiming production-ready OAuth.

**AC-005: TikTok Direct Post runtime status is tracked**  
Given TikTok accepts a Direct Post request asynchronously  
When status polling runs  
Then Ledger and Airtable eventually show `published`, `failed`, or `publishing` with sanitized error details.

## Test Plan

- Contract tests for TikTok MCP tool input and output.
- Boundary test proving no TikTok API calls outside `apps/tiktok-mcp-server`.
- Policy tests for video, photo, mixed media, too many photos, missing media, and missing account.
- Worker tests for publish success, transient retry, permanent failure, and status polling.
- OAuth route tests for state, callback, and manual seed fallback.
- Security tests for no raw token in queue, audit, Slack, Airtable, or report.
- Runtime smoke: R2 media derivative to TikTok Direct Post to status check.

## Open Questions

- OQ-017-1: TikTok app approval and Direct Post scope availability must be verified during implementation.
- OQ-017-2: Default TikTok privacy level should be chosen after `query_creator_info` is available.
- OQ-017-3: TikTok photo post support may depend on app approval and should be smoke-tested separately from video.
