# Report: US-016 Phase 5 — Wire Full Media Pipeline

**Date:** 2026-07-01
**Agent(s) Used:** Antigravity (Claude Sonnet 4.6 Thinking)
**Related User Story:** US-016
**Status:** Completed

---

## Summary

Phase 5 completes the US-016 media asset pipeline by wiring all previously built
components into a running, end-to-end system. The pipeline now runs in the
orchestrator process: Airtable asset references are ingested via RabbitMQ,
downloaded, optimized, uploaded to R2, and platform eligibility is computed
independently for TikTok and Facebook.

---

## What Was Done

- [x] **Queue topology** — declared `media.asset.ingest.requested` and
  `media.asset.optimize.requested` queues with dedicated DLQs in
  `topologyConfig.ts` and matching publisher functions in `rabbitmqPublisher.ts`
- [x] **MediaRepository** — created `ledger/mediaRepository.ts` with RLS-scoped
  methods: insert/upsert asset, update status, insert derivative, insert
  post-media-asset link, joined post-asset query, update eligibility JSONB
- [x] **MediaAssetIngestWorker** — loads Airtable attachment list, hashes source
  URLs for idempotency, creates `media_assets` + `post_media_assets`, then enqueues
  optimize events (skipping already-ready assets)
- [x] **MediaAssetOptimizeWorker** — claims asset, re-resolves URL from Airtable,
  downloads via `MediaDownloader`, writes to temp dir (mkdir recursive), optimises
  image (Sharp) or video (ffprobe + ffmpeg), uploads buffer to R2, inserts
  `media_asset_derivatives`, marks asset ready, evaluates TikTok/Facebook eligibility
- [x] **ACK ordering** — all DB transactions committed before queue ACK/DLQ move
- [x] **MediaPipelineRabbitmqConsumer** — asserts queues, binds routing keys,
  prefetch 1, routes messages to workers, moves poison messages to DLQ via
  confirm-channel, validates payloads with Zod schemas
- [x] **server.ts integration** — consumer and workers instantiated on boot behind
  `MEDIA_PIPELINE_ENABLED=true` flag, graceful stop on SIGTERM/SIGINT
- [x] **Integration tests** — `mediaPipeline.test.ts` covering 11 cases:
  - Ingest: happy path, idempotency (ready asset skip), no attachments, Airtable failure
  - Optimize: happy path image, happy path video, download failure, already-ready, asset not found, source URL missing, optimizer failure

---

## How It Was Done

### Approach

Followed the architecture established in Phases 1–4:
- All platform API calls go through the MCP server; orchestrator handles queue → ledger → R2
- No raw tokens or URLs in queue payloads — only IDs and hashes
- All workers implement the standard `{ action, status }` return protocol for
  ACK / requeue / DLQ routing
- `evaluateEligibility` runs inside the same transaction as status update to keep
  ledger consistent

### Security Controls Applied

| Control | Implementation |
|:---|:---|
| SSRF guard | `MediaDownloader` validates DNS + IP ranges before fetch |
| HTTPS-only | HTTP URLs rejected with `UNSUPPORTED_PROTOCOL` |
| Redirect disabled | `fetch({ redirect: "manual" })` |
| URL sanitisation | Query strings redacted from logs and error messages |
| No raw media in queue | Only `media_asset_id` references are queued |
| No token/secret in logs | Logger scrubs credentials before emit |
| Temp file cleanup | `finally` block with `fs.rm({ force: true })` on both success and failure |
| Mkdir before write | `fs.mkdir(MEDIA_TEMP_DIR, { recursive: true })` prevents ENOENT |

### Tools & Skills Used

| Tool/Skill | Purpose |
|:---|:---|
| TypeScript + node:fs/promises | Worker implementation |
| `sharp` | Image resizing + compression |
| `ffprobe` / `ffmpeg` (spawn) | Video probe + transcode |
| `@aws-sdk/client-s3` via R2StorageService | R2 upload |
| `amqplib` confirm channel | DLQ routing with publisher confirms |
| Zod | Runtime payload validation before passing to workers |
| Node.js built-in test runner + `mock.fn` | Integration tests |

### Files Changed

| File | Action | Description |
|:---|:---|:---|
| `apps/orchestrator/src/queue/mediaPipelineRabbitmqConsumer.ts` | Created | Ingest + optimize queue consumer with DLQ routing |
| `apps/orchestrator/src/workers/mediaPipelineWorker.ts` | Created | `MediaAssetIngestWorker` + `MediaAssetOptimizeWorker` |
| `apps/orchestrator/src/ledger/mediaRepository.ts` | Created | All media ledger DB methods |
| `apps/orchestrator/src/server.ts` | Modified | Boot/stop wiring behind `MEDIA_PIPELINE_ENABLED` flag |
| `apps/orchestrator/src/__tests__/mediaPipeline.test.ts` | Created | 11 integration tests |
| `run-tests.mjs` | Modified | Registered `mediaPipeline.test.js` |

---

## Impact & Purpose

US-016 is now end-to-end functional. Airtable attachment URLs flow through:

```
Airtable attachment ref
  └─► media.asset.ingest.requested (RabbitMQ)
        └─► MediaAssetIngestWorker
              ├─► media_assets (INSERT ON CONFLICT)
              ├─► post_media_assets (link)
              └─► media.asset.optimize.requested (enqueue)
                    └─► MediaAssetOptimizeWorker
                          ├─► MediaDownloader (SSRF guard)
                          ├─► ImageOptimizer (Sharp) or VideoOptimizer (ffmpeg)
                          ├─► R2StorageService (upload)
                          ├─► media_asset_derivatives (INSERT)
                          ├─► media_assets.status = ready
                          └─► post_media_assets.platform_eligibility (TikTok + Facebook)
```

---

## Decisions Made

| Decision | Rationale | Alternatives Considered |
|:---|:---|:---|
| `mkdir recursive` before `writeFile` | Prevents ENOENT in fresh environments / tests | Require pre-created dirs (brittle) |
| `fs.readFile` after mock `videoOptimizer.optimize` writes stub file | Real `VideoOptimizer` writes via ffmpeg; mock must honour the same contract | Refactor worker to buffer-only (larger change) |
| `MediaQueueConsumer` interface typed in server.ts | Eliminates `any` lint errors; consumer.start/stop are type-safe | Keep `any` (rejected — violates lint rules) |
| Reason strings extracted to named constants | Satisfies `clean-code/no-hardcoded-text` lint rule | Inline strings (lint violation) |
| `MEDIA_PIPELINE_ENABLED` flag gates all workers | Zero-cost when disabled; safe to deploy before infra is ready | Always instantiate workers (would fail at boot without R2 creds) |

---

## Verification

- [x] `npm run build` — clean (0 errors)
- [x] `npm run lint` — clean (0 errors, 0 warnings)
- [x] `npm test` — **71/71 test files passed** (including 11 new mediaPipeline tests)
- [x] No secrets exposed — all URL queries redacted in logs; R2 creds only in env
- [x] ACK ordering preserved — DB commit + audit before queue ACK in all paths

### AC Coverage

| AC | Status | Evidence |
|:---|:---|:---|
| AC-001: Media ingestion is reference-only | ✅ Pass | Queue payloads contain only IDs/hashes; no raw URLs or buffers |
| AC-002: Assets optimized and stored in R2 | ✅ Pass | `happy path image` + `happy path video` tests; derivative row inserted |
| AC-003: TikTok eligibility computed independently | ✅ Pass | `evaluateEligibility` runs per-post after every status change |
| AC-004: FFmpeg and temp resources are bounded | ✅ Pass | timeout + `fs.rm` in `finally`; mkdir before write |
| AC-005: Security constraints prevent leaks | ✅ Pass | SSRF guard, HTTPS-only, redirect disabled, URL redaction |

---

## Open Items / Next Steps

- Wire `MEDIA_PIPELINE_ENABLED=true` in staging `.env` when R2 bucket is provisioned
- Add E2E smoke test with a real Airtable record (out of scope for this phase)
- Consider pinned-DNS HTTP client to harden against DNS-rebinding (documented risk
  in Phase 3 plan; deferred to future hardening phase)

## Hardening Update: 2026-07-01

- [x] Preserved existing `ready` media asset status on duplicate ingest upsert.
  This prevents repeated Airtable webhook events from resetting optimized assets
  back to `received` and re-enqueueing unnecessary optimization work.
- [x] Replaced direct infinite `nack(..., requeue=true)` behavior for media
  ingest/optimize transient failures with TTL retry queues and max-retry DLQ
  routing.
- [x] Added tests for repository SQL upsert behavior, TTL retry queue publish,
  and max-retry DLQ routing.
- [x] Refactored SSRF IP classification in `mediaDownloader.ts` and
  `notionClient.ts` from scattered literal checks into named security constants
  and helpers. IPv4-mapped IPv6 is now handled fail-closed to avoid representation
  bypasses.
- [x] Re-ran verification:
  - `npm run build` passed.
  - `npm run lint` passed.
  - `npm test` passed with all 71 test files.
  - `npm run ai-sdlc:check -- US-016` passed.
- [x] Runtime smoke on 2026-07-01:
  - DB migration tables exist: `media_assets`, `media_asset_derivatives`,
    `post_media_assets`.
  - R2 upload smoke succeeded for a small text object under
    `workspaces/ws_staging/posts/smoke-us016/...`.
  - R2 public GET smoke returned HTTP 200 for the uploaded object.
  - RabbitMQ media topology startup/stop succeeded for
    `media.asset.ingest.requested` and `media.asset.optimize.requested`.
  - `ffmpeg` and `ffprobe` binaries resolved and returned version successfully.
  - Orchestrator booted with `MEDIA_PIPELINE_ENABLED=true` override on port 3016
    and `/health` returned `{"status":"ok"}`.
  - Airtable live smoke succeeded using record `recBwtD56dDWXN0ay`:
    `media.asset.ingest.requested` reloaded the Airtable `asset_links` URL,
    downloaded an R2-hosted PNG, optimized it with Sharp, uploaded the derivative
    to R2, and wrote `media_assets.status = ready` plus one
    `media_asset_derivatives` row.
  - Follow-up hardening after smoke: `ApprovedPostWorker` now publishes
    `media.asset.ingest.requested` automatically when `MEDIA_PIPELINE_ENABLED=true`
    and the reloaded Airtable record contains `asset_links`.
  - Added regression test coverage in `approvedPostWorker.test.ts` proving the
    Approved webhook path queues the media ingest event without putting raw media
    URLs in RabbitMQ.
  - Re-ran verification after the integration fix:
    - `npm run build` passed.
    - `node --test apps/orchestrator/dist/__tests__/approvedPostWorker.test.js`
      passed.
    - `npm run lint` passed.
    - `npm test` passed with all 71 test files.
    - `npm run ai-sdlc:check -- US-016` passed.
