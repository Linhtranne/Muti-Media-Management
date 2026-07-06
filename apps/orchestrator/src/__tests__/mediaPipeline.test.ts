/**
 * Integration tests for US-016 Media Pipeline workers.
 *
 * Covers:
 *   - MediaAssetIngestWorker happy path (creates assets + enqueues optimize events)
 *   - MediaAssetIngestWorker duplicate idempotency (ON CONFLICT → reuse asset, skip enqueue if ready)
 *   - MediaAssetOptimizeWorker happy path image (mock download + optimizer + R2 → ready)
 *   - MediaAssetOptimizeWorker happy path video (mock optimizer + R2 → ready)
 *   - MediaAssetOptimizeWorker download failure → asset marked failed
 *   - MediaAssetOptimizeWorker already-ready asset → immediate ack
 *   - MediaAssetOptimizeWorker source URL not found in Airtable → failed
 */

import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import os from "node:os";
import fs from "node:fs/promises";

import { MediaAssetIngestWorker, MediaAssetOptimizeWorker } from "../workers/mediaPipelineWorker.js";
import { MediaRepository } from "../ledger/mediaRepository.js";
import { handleIngestQueueMessage } from "../queue/mediaPipelineRabbitmqConsumer.js";
import type { MediaAssetIngestRequestedEvent, MediaAssetOptimizeRequestedEvent } from "@mediaops/shared-contracts";
import type { MediaAssetDbRow, PostMediaAssetDbRow } from "../ledger/mediaRepository.js";

// ---------------------------------------------------------------------------
// Helper builders
// ---------------------------------------------------------------------------

function makeIngestEvent(overrides: Partial<MediaAssetIngestRequestedEvent> = {}): MediaAssetIngestRequestedEvent {
  return {
    event_id: crypto.randomUUID(),
    event_type: "media.asset.ingest.requested",
    event_version: 1,
    workspace_id: "ws-test",
    post_id: "post-abc",
    airtable_record_id: "recTest123",
    content_variant_id: "cv-1",
    idempotency_key: "ingest:ws-test:post-abc",
    correlation_id: "corr-1",
    causation_id: "cause-1",
    ...overrides
  };
}

function makeOptimizeEvent(mediaAssetId: string, overrides: Partial<MediaAssetOptimizeRequestedEvent> = {}): MediaAssetOptimizeRequestedEvent {
  return {
    event_id: crypto.randomUUID(),
    event_type: "media.asset.optimize.requested",
    event_version: 1,
    workspace_id: "ws-test",
    media_asset_id: mediaAssetId,
    post_id: "post-abc",
    idempotency_key: `optimize:ws-test:${mediaAssetId}`,
    correlation_id: "corr-1",
    causation_id: "cause-1",
    ...overrides
  };
}

function makeAssetRow(overrides: Partial<MediaAssetDbRow> = {}): MediaAssetDbRow {
  return {
    id: "asset-1",
    workspace_id: "ws-test",
    post_id: "post-abc",
    airtable_record_id: "recTest123",
    source_type: "airtable_attachment",
    source_url_hash: crypto.createHash("sha256").update("https://example.com/image.jpg").digest("hex"),
    original_filename: "image.jpg",
    original_mime_type: "image/jpeg",
    original_size_bytes: "102400",
    sha256: null,
    status: "received",
    error_code: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides
  };
}

function makePostAssetJoinedRow(assetId: string, mimeType: string, status: string) {
  return {
    id: "pma-1",
    workspace_id: "ws-test",
    post_id: "post-abc",
    content_variant_id: "cv-1",
    media_asset_id: assetId,
    sort_order: 0,
    platform_eligibility: {},
    created_at: new Date(),
    original_mime_type: mimeType,
    status,
    sha256: null
  } as PostMediaAssetDbRow & { original_mime_type: string; status: string; sha256: string | null };
}

// ---------------------------------------------------------------------------
// Shared mock factories
// ---------------------------------------------------------------------------

function makeDb(transactionImpl: (workspaceId: string, fn: (client: unknown) => Promise<unknown>) => Promise<unknown>) {
  return {
    transaction: transactionImpl,
    query: mock.fn(async () => ({ rows: [], rowCount: 0 })),
    getPool: mock.fn(() => ({ query: mock.fn() }))
  };
}

function makeLogger() {
  return {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn()
  };
}

// ---------------------------------------------------------------------------
// MediaAssetIngestWorker tests
// ---------------------------------------------------------------------------

describe("MediaAssetIngestWorker", () => {
  it("repository upsert preserves ready status on duplicate ingest", async () => {
    const capturedQueries: string[] = [];
    const client = {
      query: mock.fn(async (sql: string) => {
        capturedQueries.push(sql);
        return { rows: [makeAssetRow({ status: "ready" })] };
      })
    };
    const repository = new MediaRepository();

    await repository.insertMediaAsset(client as any, {
      workspace_id: "ws-test",
      post_id: "post-abc",
      airtable_record_id: "recTest123",
      source_type: "airtable_attachment",
      source_url_hash: "hash",
      original_filename: "image.jpg",
      original_mime_type: "image/jpeg",
      original_size_bytes: 0,
      status: "received"
    });

    assert.match(capturedQueries[0], /WHEN media_assets\.status = 'ready' THEN media_assets\.status/);
    assert.doesNotMatch(capturedQueries[0], /status = EXCLUDED\.status,\s+updated_at/s);
  });

  it("happy path: creates assets, inserts post links, and enqueues optimize events for non-ready assets", async () => {
    const insertedAssets: unknown[] = [];
    const insertedPostAssets: unknown[] = [];
    const insertedAuditLogs: unknown[] = [];
    const publishedEvents: unknown[] = [];

    const assetRow = makeAssetRow({ status: "received" });

    const mediaRepository = {
      insertMediaAsset: mock.fn(async (_client: unknown, input: unknown) => {
        insertedAssets.push(input);
        return assetRow;
      }),
      insertPostMediaAsset: mock.fn(async (_client: unknown, input: unknown) => {
        insertedPostAssets.push(input);
        return {};
      }),
      getMediaAssetById: mock.fn(),
      getMediaAssetBySourceHash: mock.fn(),
      updateMediaAssetStatus: mock.fn(),
      insertMediaAssetDerivative: mock.fn(),
      updatePostMediaEligibility: mock.fn(),
      getPostMediaAssetsJoined: mock.fn(async () => [])
    };

    const auditLogRepository = {
      insertAuditLog: mock.fn(async (_client: unknown, log: unknown) => {
        insertedAuditLogs.push(log);
      })
    };

    const airtableClient = {
      getPostRecord: mock.fn(async () => ({
        id: "recTest123",
        fields: {
          asset_links: [{ url: "https://example.com/image.jpg", filename: "image.jpg", type: "image/jpeg" }]
        }
      }))
    };

    const queuePublisher = {
      publishMediaAssetOptimizeRequested: mock.fn(async (event: unknown) => {
        publishedEvents.push(event);
      })
    };

    const db = makeDb(async (_workspaceId, fn) => fn({}));
    const logger = makeLogger();

    const worker = new MediaAssetIngestWorker(
      db as any,
      airtableClient as any,
      mediaRepository as any,
      auditLogRepository as any,
      queuePublisher as any,
      logger as any
    );

    const result = await worker.processQueueMessage(makeIngestEvent(), "msg-1");

    assert.equal(result.action, "ack");
    assert.equal(result.status, "succeeded");
    assert.equal(insertedAssets.length, 1, "should insert 1 media asset");
    assert.equal(insertedPostAssets.length, 1, "should insert 1 post media asset link");
    assert.equal(insertedAuditLogs.length, 1, "should insert 1 audit log");
    assert.equal(publishedEvents.length, 1, "should publish 1 optimize event");
  });

  it("skips enqueue when asset is already ready (idempotency)", async () => {
    const publishedEvents: unknown[] = [];
    const assetRow = makeAssetRow({ status: "ready" });

    const mediaRepository = {
      insertMediaAsset: mock.fn(async () => assetRow),
      insertPostMediaAsset: mock.fn(async () => ({})),
      getMediaAssetById: mock.fn(),
      getMediaAssetBySourceHash: mock.fn(),
      updateMediaAssetStatus: mock.fn(),
      insertMediaAssetDerivative: mock.fn(),
      updatePostMediaEligibility: mock.fn(),
      getPostMediaAssetsJoined: mock.fn(async () => [])
    };

    const auditLogRepository = { insertAuditLog: mock.fn(async () => {}) };

    const airtableClient = {
      getPostRecord: mock.fn(async () => ({
        id: "recTest123",
        fields: {
          asset_links: [{ url: "https://example.com/image.jpg", filename: "image.jpg", type: "image/jpeg" }]
        }
      }))
    };

    const queuePublisher = {
      publishMediaAssetOptimizeRequested: mock.fn(async (event: unknown) => {
        publishedEvents.push(event);
      })
    };

    const db = makeDb(async (_workspaceId, fn) => fn({}));
    const logger = makeLogger();

    const worker = new MediaAssetIngestWorker(
      db as any,
      airtableClient as any,
      mediaRepository as any,
      auditLogRepository as any,
      queuePublisher as any,
      logger as any
    );

    const result = await worker.processQueueMessage(makeIngestEvent(), "msg-dup");

    assert.equal(result.action, "ack");
    assert.equal(publishedEvents.length, 0, "should NOT enqueue optimize for already-ready asset");
  });

  it("returns no_attachments when post record has no asset_links", async () => {
    const airtableClient = {
      getPostRecord: mock.fn(async () => ({ id: "recTest123", fields: {} }))
    };

    const mediaRepository = { insertMediaAsset: mock.fn() };
    const auditLogRepository = { insertAuditLog: mock.fn() };
    const queuePublisher = { publishMediaAssetOptimizeRequested: mock.fn() };
    const db = makeDb(async (_wid, fn) => fn({}));
    const logger = makeLogger();

    const worker = new MediaAssetIngestWorker(
      db as any,
      airtableClient as any,
      mediaRepository as any,
      auditLogRepository as any,
      queuePublisher as any,
      logger as any
    );

    const result = await worker.processQueueMessage(makeIngestEvent(), "msg-empty");
    assert.equal(result.action, "ack");
    assert.equal(result.status, "no_attachments");
  });

  it("nack_requeue when Airtable getPostRecord fails", async () => {
    const airtableClient = {
      getPostRecord: mock.fn(async () => { throw new Error("Airtable 500"); })
    };

    const mediaRepository = { insertMediaAsset: mock.fn() };
    const auditLogRepository = { insertAuditLog: mock.fn() };
    const queuePublisher = { publishMediaAssetOptimizeRequested: mock.fn() };
    const db = makeDb(async (_wid, fn) => fn({}));
    const logger = makeLogger();

    const worker = new MediaAssetIngestWorker(
      db as any,
      airtableClient as any,
      mediaRepository as any,
      auditLogRepository as any,
      queuePublisher as any,
      logger as any
    );

    const result = await worker.processQueueMessage(makeIngestEvent(), "msg-airtable-fail");
    assert.equal(result.action, "nack_requeue");
    assert.equal(result.status, "airtable_reload_failed");
  });
});

describe("MediaPipelineRabbitmqConsumer retry handling", () => {
  function makeChannel() {
    const calls: string[] = [];
    const sentToQueues: string[] = [];
    const channel = {
      assertExchange: mock.fn(async () => undefined),
      assertQueue: mock.fn(async (queue: string) => {
        calls.push(`assertQueue:${queue}`);
        return undefined;
      }),
      bindQueue: mock.fn(async () => undefined),
      prefetch: mock.fn(async () => undefined),
      consume: mock.fn(async () => undefined),
      sendToQueue: mock.fn((queue: string) => {
        calls.push(`sendToQueue:${queue}`);
        sentToQueues.push(queue);
        return true;
      }),
      waitForConfirms: mock.fn(async () => {
        calls.push("waitForConfirms");
      }),
      ack: mock.fn(() => {
        calls.push("ack");
      }),
      nack: mock.fn(() => {
        calls.push("nack");
      }),
      close: mock.fn(async () => undefined)
    };
    return { channel, calls, sentToQueues };
  }

  function makeMessage(headers: Record<string, unknown> = {}) {
    const event = makeIngestEvent({
      event_id: crypto.randomUUID(),
      correlation_id: crypto.randomUUID(),
      causation_id: crypto.randomUUID(),
      content_variant_id: crypto.randomUUID()
    });
    return {
      content: Buffer.from(JSON.stringify(event)),
      fields: {
        exchange: "mediaops.events.topic",
        routingKey: "media.asset.ingest.requested"
      },
      properties: {
        messageId: "msg-retry",
        correlationId: event.correlation_id,
        headers
      }
    };
  }

  it("publishes nack_requeue messages to a TTL retry queue then ACKs original", async () => {
    const { channel, calls, sentToQueues } = makeChannel();
    const worker = {
      processQueueMessage: mock.fn(async () => ({ action: "nack_requeue" as const, status: "airtable_reload_failed" }))
    };

    await handleIngestQueueMessage(
      channel as any,
      worker as any,
      makeLogger() as any,
      makeMessage() as any,
      () => false
    );

    assert.deepEqual(sentToQueues, ["media.asset.ingest.retry.1000"]);
    assert.ok(calls.includes("waitForConfirms"), "retry publish must wait for confirms");
    assert.ok(calls.includes("ack"), "original message must be acked after retry publish confirms");
    assert.equal(channel.nack.mock.calls.length, 0, "should not nack requeue directly");
  });

  it("routes nack_requeue messages to DLQ after max retries", async () => {
    const { channel, sentToQueues } = makeChannel();
    const worker = {
      processQueueMessage: mock.fn(async () => ({ action: "nack_requeue" as const, status: "airtable_reload_failed" }))
    };

    await handleIngestQueueMessage(
      channel as any,
      worker as any,
      makeLogger() as any,
      makeMessage({ "x-retries": 5 }) as any,
      () => false
    );

    assert.deepEqual(sentToQueues, ["media.asset.ingest.requested.dlq"]);
    assert.equal(channel.nack.mock.calls.length, 0, "DLQ move should publish-confirm then ack, not requeue");
    assert.equal(channel.ack.mock.calls.length, 1);
  });
});

// ---------------------------------------------------------------------------
// MediaAssetOptimizeWorker tests
// ---------------------------------------------------------------------------

describe("MediaAssetOptimizeWorker", () => {
  const sourceUrl = "https://cdn.example.com/image.jpg";
  const sourceHash = crypto.createHash("sha256").update(sourceUrl).digest("hex");

  function makeOptimizeWorker(overrides: {
    assetRow?: Partial<MediaAssetDbRow> | null;
    airtableAssetLinks?: unknown[];
    downloadResult?: unknown;
    downloadError?: Error;
    imageOptResult?: unknown;
    imageOptError?: Error;
    videoProbeResult?: unknown;
    videoOptResult?: unknown;
    videoOptError?: Error;
    postAssets?: unknown[];
  } = {}) {
    const assetRow = overrides.assetRow === null
      ? null
      : makeAssetRow({ source_url_hash: sourceHash, ...overrides.assetRow });

    const mediaRepository = {
      getMediaAssetById: mock.fn(async () => assetRow),
      getMediaAssetBySourceHash: mock.fn(async () => assetRow),
      updateMediaAssetStatus: mock.fn(async () => assetRow),
      insertMediaAssetDerivative: mock.fn(async () => {}),
      insertMediaAsset: mock.fn(),
      insertPostMediaAsset: mock.fn(),
      getPostMediaAssetsJoined: mock.fn(async () => overrides.postAssets ?? [
        makePostAssetJoinedRow("asset-1", "image/jpeg", "ready")
      ]),
      updatePostMediaEligibility: mock.fn(async () => {})
    };

    const auditLogRepository = { insertAuditLog: mock.fn(async () => {}) };

    const airtableClient = {
      getPostRecord: mock.fn(async () => ({
        id: "recTest123",
        fields: {
          asset_links: overrides.airtableAssetLinks ?? [
            { url: sourceUrl, filename: "image.jpg", type: "image/jpeg" }
          ]
        }
      }))
    };

    const r2Storage = {
      uploadBuffer: mock.fn(async () => ({
        storageKey: "media/ws-test/post-abc/abc123.jpg",
        publicUrl: "https://pub.r2.dev/abc123.jpg"
      }))
    };

    const dlErr: Error = overrides.downloadError ?? new Error("download error");
    const mediaDownloader = {
      download: overrides.downloadError
        ? mock.fn(async () => { throw dlErr; })
        : mock.fn(async () => overrides.downloadResult ?? {
            buffer: Buffer.from("fake-image-data"),
            mimeType: "image/jpeg",
            sizeBytes: 12345,
            sha256: "abc123sha256",
            extension: "jpg"
          })
    };

    const imgErr: Error = overrides.imageOptError ?? new Error("image optimizer error");
    const imageOptimizer = {
      optimize: overrides.imageOptError
        ? mock.fn(async () => { throw imgErr; })
        : mock.fn(async () => overrides.imageOptResult ?? {
            buffer: Buffer.from("optimized-data"),
            mimeType: "image/jpeg",
            width: 1280,
            height: 720
          })
    };

    const vidErr: Error = overrides.videoOptError ?? new Error("video optimizer error");
    const videoOptimizer = {
      probe: mock.fn(async () => overrides.videoProbeResult ?? {
        width: 1920, height: 1080, durationSeconds: 30, codec: "h264"
      }),
      // The real VideoOptimizer.optimize writes to outputPath via ffmpeg.
      // Our mock must write a stub file so the worker's fs.readFile(tempTranscodePath) succeeds.
      optimize: overrides.videoOptError
        ? mock.fn(async () => { throw vidErr; })
        : mock.fn(async (_inputPath: string, outputPath: string) => {
            await fs.writeFile(outputPath, Buffer.from("stub-mp4-data"));
            return overrides.videoOptResult ?? { mimeType: "video/mp4", sizeBytes: 5_000_000 };
          })
    };

    const db = makeDb(async (_workspaceId, fn) => fn({}));
    const logger = makeLogger();

    const worker = new MediaAssetOptimizeWorker(
      db as any,
      airtableClient as any,
      mediaRepository as any,
      auditLogRepository as any,
      r2Storage as any,
      mediaDownloader as any,
      imageOptimizer as any,
      videoOptimizer as any,
      logger as any,
      { R2_BUCKET: "test-bucket", MEDIA_TEMP_DIR: os.tmpdir() }
    );

    return { worker, mediaRepository, auditLogRepository, r2Storage, mediaDownloader, imageOptimizer, videoOptimizer, logger };
  }

  it("happy path image: download → optimize → R2 upload → marked ready → eligibility evaluated", async () => {
    const { worker, mediaRepository, r2Storage, imageOptimizer, auditLogRepository } = makeOptimizeWorker();

    const result = await worker.processQueueMessage(
      makeOptimizeEvent("asset-1"),
      "msg-opt-img"
    );

    assert.equal(result.action, "ack");
    assert.equal(result.status, "succeeded");
    assert.equal(imageOptimizer.optimize.mock.calls.length, 1, "imageOptimizer.optimize called once");
    assert.equal(r2Storage.uploadBuffer.mock.calls.length, 1, "r2Storage.uploadBuffer called once");
    assert.equal(mediaRepository.insertMediaAssetDerivative.mock.calls.length, 1, "derivative inserted");
    assert.equal(mediaRepository.updateMediaAssetStatus.mock.calls.length, 3, "status updated 3x: downloading, optimizing, ready");
    assert.equal(mediaRepository.updatePostMediaEligibility.mock.calls.length, 1, "eligibility evaluated");
    assert.equal(auditLogRepository.insertAuditLog.mock.calls.length, 1, "audit log written");
  });

  it("happy path video: download → probe + transcode → R2 upload → marked ready", async () => {
    const { worker, mediaRepository, r2Storage, videoOptimizer } = makeOptimizeWorker({
      downloadResult: {
        buffer: Buffer.from("fake-video-data"),
        mimeType: "video/mp4",
        sizeBytes: 1_000_000,
        sha256: "vid-sha256",
        extension: "mp4"
      },
      assetRow: { original_mime_type: "video/mp4" },
      postAssets: [makePostAssetJoinedRow("asset-1", "video/mp4", "ready")]
    });

    const result = await worker.processQueueMessage(
      makeOptimizeEvent("asset-1"),
      "msg-opt-vid"
    );

    assert.equal(result.action, "ack");
    assert.equal(result.status, "succeeded");
    assert.equal(videoOptimizer.probe.mock.calls.length, 1, "ffprobe called once");
    assert.equal(videoOptimizer.optimize.mock.calls.length, 1, "ffmpeg called once");
    assert.equal(r2Storage.uploadBuffer.mock.calls.length, 1, "R2 upload called once");
    assert.equal(mediaRepository.insertMediaAssetDerivative.mock.calls.length, 1, "derivative inserted");
  });

  it("download failure → asset marked failed, ack (not requeue)", async () => {
    const downloadError = new Error("SSRF_BLOCKED: private IP");
    (downloadError as NodeJS.ErrnoException).code = "SSRF_BLOCKED";

    const { worker, mediaRepository } = makeOptimizeWorker({ downloadError });

    const result = await worker.processQueueMessage(
      makeOptimizeEvent("asset-1"),
      "msg-dl-fail"
    );

    assert.equal(result.action, "ack");
    assert.equal(result.status, "download_failed");

    const statusCalls = mediaRepository.updateMediaAssetStatus.mock.calls;
    const failCall = statusCalls.find((c: { arguments: unknown[] }) => c.arguments[3] === "failed");
    assert.ok(failCall, "asset should be marked failed");
    assert.equal((failCall.arguments as unknown[])[4], "SSRF_BLOCKED", "error_code should be SSRF_BLOCKED");
  });

  it("already-ready asset → immediate ack without processing", async () => {
    const { worker, mediaDownloader } = makeOptimizeWorker({
      assetRow: { status: "ready" }
    });

    const result = await worker.processQueueMessage(
      makeOptimizeEvent("asset-1"),
      "msg-already-ready"
    );

    assert.equal(result.action, "ack");
    assert.equal(result.status, "already_ready");
    assert.equal(mediaDownloader.download.mock.calls.length, 0, "should not download if already ready");
  });

  it("asset not found in DB → nack_dlq", async () => {
    const { worker } = makeOptimizeWorker({ assetRow: null });

    const result = await worker.processQueueMessage(
      makeOptimizeEvent("asset-ghost"),
      "msg-not-found"
    );

    assert.equal(result.action, "nack_dlq");
    assert.equal(result.status, "asset_not_found");
  });

  it("source URL not found in Airtable attachments → marked failed, ack", async () => {
    const { worker, mediaRepository } = makeOptimizeWorker({
      airtableAssetLinks: [
        { url: "https://example.com/other-image.jpg", filename: "other.jpg", type: "image/jpeg" }
      ]
    });

    const result = await worker.processQueueMessage(
      makeOptimizeEvent("asset-1"),
      "msg-url-not-found"
    );

    assert.equal(result.action, "ack");
    assert.equal(result.status, "source_url_not_found");

    const statusCalls = mediaRepository.updateMediaAssetStatus.mock.calls;
    const failCall = statusCalls.find((c: { arguments: unknown[] }) => c.arguments[3] === "failed");
    assert.ok(failCall, "asset should be marked failed");
    assert.equal((failCall.arguments as unknown[])[4], "MEDIA_SOURCE_UNREACHABLE");
  });

  it("optimizer failure → asset marked failed, ack", async () => {
    const imageOptError = new Error("sharp: image too large");
    (imageOptError as NodeJS.ErrnoException).code = "MEDIA_TOO_LARGE";

    const { worker, mediaRepository } = makeOptimizeWorker({ imageOptError });

    const result = await worker.processQueueMessage(
      makeOptimizeEvent("asset-1"),
      "msg-opt-fail"
    );

    assert.equal(result.action, "ack");
    assert.equal(result.status, "optimize_failed");

    const statusCalls = mediaRepository.updateMediaAssetStatus.mock.calls;
    const failCall = statusCalls.find((c: { arguments: unknown[] }) => c.arguments[3] === "failed");
    assert.ok(failCall, "asset should be marked failed after optimizer error");
  });
});
