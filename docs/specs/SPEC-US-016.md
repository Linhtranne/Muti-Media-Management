# SPEC-US-016: Shared Media Asset Storage and Optimization Pipeline

status: approved

**Related Epic:** Multi-Platform Publishing Expansion  
**Related Stories:** US-003, US-006, US-017  
**Owner:** Backend / Media Pipeline / DevOps  
**Planning Date:** 2026-07-01

## Goal

Create a shared production-oriented media asset pipeline that ingests Airtable attachments or public URLs, optimizes images and videos, stores publish-ready derivatives in Cloudflare R2, and exposes reference-only media assets for Facebook, TikTok, and future platforms.

## Users / Roles

- Content creator: uploads media assets to Airtable and chooses target channels.
- Social media manager: reviews AI-generated platform copy and media readiness.
- Backend worker: ingests, optimizes, stores, and marks media assets ready.
- Platform publish workers: consume optimized media references only.
- Admin / operator: configures Cloudflare R2 credentials and monitors failed media jobs.

## In Scope

- Ingest media from Airtable Attachment arrays and public URL fields.
- Download media using bounded streaming with timeout, size guard, and MIME validation.
- Store original media metadata in Postgres Ledger without storing binary content.
- Optimize images and videos before publishing.
- Upload optimized derivatives to Cloudflare R2 using public-read object URLs with hard-to-guess object keys.
- Persist `media_assets`, `media_asset_derivatives`, and `post_media_assets` rows with workspace-level RLS.
- Produce platform eligibility metadata for Facebook, TikTok, Instagram, Zalo, and future channels.
- Use FFmpeg and FFprobe for video metadata and transcoding.
- Use an image optimization library such as Sharp for image resizing and compression.
- Keep RabbitMQ payloads reference-only.

## Out of Scope

- Calling TikTok, Facebook, Instagram, or Zalo platform APIs.
- Generating social copy or captions.
- Human approval UI redesign in Airtable.
- Permanent archive storage for raw creative assets.
- DRM, watermarking, or creative rights management.
- Native CDN invalidation automation.

## Current Context and Constraints

- Airtable `asset_links` already exists in shared contracts and can contain text URLs or Attachment objects.
- `content_variants.asset_links` exists as a JSONB column from migration `0019_us003_asset_links_for_facebook_publish.sql`.
- Current Facebook publish can use media URLs, but direct usage of Airtable attachment URLs is not production-safe because URL accessibility and lifetime are not controlled by this system.
- Architecture rules require platform APIs to stay in MCP servers, not orchestrator.
- RabbitMQ messages must not contain raw binaries, raw tokens, signed URL query secrets, or large payloads.
- Workers must ACK only after Ledger state is updated.

## Data Model / Fields

### Airtable Inputs

- `asset_links`: Attachment field or public URL text field.
- `target_channels`: multi-select containing `Facebook`, `TikTok`, and future platforms.
- `post_id`: stable post reference.
- `campaign_id`: optional campaign reference.
- `tiktok_post_type`: optional single select, values `video` or `photo`; used by US-017.

### Ledger Tables

#### `media_assets`

- `id`: UUID primary key.
- `workspace_id`: tenant key.
- `post_id`: source post identifier.
- `airtable_record_id`: source Airtable record.
- `source_type`: `airtable_attachment` or `public_url`.
- `source_url_hash`: hash of source URL for dedupe, not the raw URL if it contains query params.
- `original_filename`: sanitized display filename.
- `original_mime_type`: detected MIME type.
- `original_size_bytes`: source size.
- `sha256`: checksum when available.
- `status`: `received`, `downloading`, `optimizing`, `ready`, `failed`.
- `error_code`: sanitized error code.
- `created_at`, `updated_at`.

#### `media_asset_derivatives`

- `id`: UUID primary key.
- `workspace_id`: tenant key.
- `media_asset_id`: FK to `media_assets`.
- `derivative_kind`: `optimized_original`, `tiktok_video`, `tiktok_photo`, `facebook_image`, `facebook_link_preview`.
- `storage_provider`: `cloudflare_r2`.
- `storage_bucket`: bucket name.
- `storage_key`: hard-to-guess object key.
- `public_url`: public R2 URL without signed query secrets.
- `mime_type`: derivative MIME type.
- `size_bytes`: derivative size.
- `width`, `height`, `duration_seconds`: nullable media metadata.
- `status`: `ready` or `failed`.
- `created_at`.

#### `post_media_assets`

- `id`: UUID primary key.
- `workspace_id`: tenant key.
- `post_id`: source post identifier.
- `content_variant_id`: nullable FK when available.
- `media_asset_id`: FK to `media_assets`.
- `sort_order`: stable order from Airtable.
- `platform_eligibility`: JSONB map such as `{ "facebook": "eligible", "tiktok": "eligible" }`.
- `created_at`.

## API / Contract

### Queue: `media.asset.ingest.requested`

Reference-only event:

```json
{
  "event_id": "uuid",
  "event_type": "media.asset.ingest.requested",
  "event_version": 1,
  "workspace_id": "ws_staging",
  "post_id": "post_123",
  "airtable_record_id": "rec123",
  "content_variant_id": "uuid-or-null",
  "idempotency_key": "media.ingest:workspace:post:asset-hash",
  "correlation_id": "uuid"
}
```

Forbidden fields: raw binary, raw token, access token, secret reference, signed URL query secrets, raw provider response.

### Queue: `media.asset.optimize.requested`

Reference-only event:

```json
{
  "event_id": "uuid",
  "event_type": "media.asset.optimize.requested",
  "event_version": 1,
  "workspace_id": "ws_staging",
  "media_asset_id": "uuid",
  "post_id": "post_123",
  "idempotency_key": "media.optimize:workspace:asset",
  "correlation_id": "uuid"
}
```

### Storage Contract

Cloudflare R2 object key:

```text
workspaces/{workspace_id}/posts/{post_id}/{uuid}-{sha256_prefix}.{ext}
```

Public URL must be stable enough for platform pull-based publishing and must not include access tokens or signed query secrets.

## Happy Path

1. Airtable record is approved and contains `asset_links`.
2. AI Composer reloads Airtable context and stores source media references in Ledger.
3. Media ingest event is published.
4. Media worker downloads each asset using streaming guards.
5. Worker validates MIME type, size, and declared target channels.
6. Image assets are resized or recompressed when needed.
7. Video assets are inspected with FFprobe and transcoded with FFmpeg when needed.
8. Optimized derivative is uploaded to Cloudflare R2.
9. Ledger marks derivative `ready`.
10. Policy and publish workers use only `media_asset_derivatives.public_url`.

## Error Cases

- `MEDIA_SOURCE_UNREACHABLE`: source URL cannot be fetched.
- `MEDIA_DOWNLOAD_TIMEOUT`: download exceeds configured timeout.
- `MEDIA_TOO_LARGE`: source or derivative exceeds configured limit.
- `MEDIA_UNSUPPORTED_TYPE`: MIME type is not supported.
- `MEDIA_OPTIMIZATION_FAILED`: Sharp or FFmpeg returns non-zero exit.
- `MEDIA_STORAGE_UPLOAD_FAILED`: R2 upload failed.
- `MEDIA_TEMP_CLEANUP_FAILED`: cleanup warning recorded, job still fails or completes based on main status.

## Edge Cases

- Duplicate Airtable attachment appears on the same post.
- Attachment filename is unsafe or contains path separators.
- MIME header conflicts with magic bytes.
- URL has query params or expires quickly.
- Worker crashes after R2 upload but before Ledger commit.
- Optimized output is larger than input.
- Mixed image and video assets for a TikTok target.
- Large video requires long processing and hits worker timeout.

## Security and Permission Rules

- No raw binary content in Postgres or RabbitMQ.
- No signed URL query secret in logs, audit metadata, Slack, or Airtable.
- R2 object keys must be generated and hard to guess.
- R2 public assets must have lifecycle cleanup, default 90 days.
- Every media table must enforce workspace RLS.
- FFmpeg must run with bounded input, timeout, isolated temp directory, and cleanup.
- Downloaders must block localhost, private IP ranges, and non-HTTP protocols.
- Audit metadata may include MIME type, size, checksum prefix, and error code only.

## Media Policy

### TikTok Video

- Exactly one optimized video for a TikTok video post.
- Supported output container: MP4.
- Video codec: H.264.
- Audio codec: AAC.
- Max output size: 1 GB for MVP.
- Preserve duration; no auto-trimming in MVP.

### TikTok Photo

- 1 to 35 optimized images.
- Supported output MIME: `image/jpeg`, `image/png`, `image/webp`.
- Max output size per image: 50 MB.
- Images and videos must not be mixed for a single TikTok post.

### Facebook

- Image assets may publish as photo posts.
- Document assets may publish as feed links.
- Facebook eligibility must not depend on TikTok readiness.

## Acceptance Criteria

**AC-001: Media ingestion is reference-only**  
Given an Airtable record with attachments  
When the media ingest event is created  
Then RabbitMQ payload contains only workspace, post, record, and asset reference identifiers  
And no raw binary or credential data is present.

**AC-002: Assets are optimized and stored in R2**  
Given a valid image or video source  
When the media pipeline completes  
Then an optimized derivative is uploaded to Cloudflare R2  
And Ledger stores public URL, storage key, MIME type, size, checksum, and readiness status.

**AC-003: TikTok eligibility is computed independently**  
Given a post targeting Facebook and TikTok  
When media contains unsupported TikTok mix of image and video  
Then TikTok eligibility is failed with a sanitized error  
And Facebook eligibility remains independently evaluated.

**AC-004: FFmpeg and temp resources are bounded**  
Given a large video source  
When optimization runs  
Then worker enforces timeout, max concurrency, temp directory cleanup, and max output size  
And failure routes to DLQ after Ledger state is updated.

**AC-005: Security constraints prevent leaks**  
Given source media URL includes query parameters  
When metadata is logged or audited  
Then raw query secrets are not written to logs, Slack, Airtable, RabbitMQ, or audit metadata.

## Test Plan

- Contract tests for media ingest and optimize events rejecting forbidden fields.
- Repository tests for `media_assets`, `media_asset_derivatives`, RLS workspace filters, and idempotency keys.
- Worker tests for image ingest, video ingest, duplicate asset handling, and R2 upload.
- FFmpeg wrapper tests for timeout, non-zero exit, and sanitized error handling.
- Security tests for SSRF prevention and signed URL redaction.
- Integration smoke: Airtable attachment to R2 derivative to Ledger ready status.

## Open Questions

- OQ-016-1: Exact Cloudflare R2 bucket name and public base URL will be supplied at implementation time.
- OQ-016-2: Docker/runtime installation path for FFmpeg will be selected during implementation.
- OQ-016-3: Lifecycle cleanup automation may be configured in Cloudflare R2 console or documented as an operational deployment task.
