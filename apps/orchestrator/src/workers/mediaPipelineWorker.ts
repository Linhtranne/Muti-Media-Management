import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type pg from "pg";
import type { Database } from "../ledger/postgres.js";
import type { MediaRepository } from "../ledger/mediaRepository.js";
import type { AuditLogRepository } from "../ledger/auditLogRepository.js";
import type { AirtableClient } from "../airtable/airtableClient.js";
import type { R2StorageService } from "../services/r2Storage.js";
import type { MediaDownloader } from "../services/mediaDownloader.js";
import type { ImageOptimizer, VideoOptimizer } from "../services/mediaOptimizer.js";
import type { Logger } from "../lib/logger.js";
import type { QueuePublisher } from "../queue/rabbitmqPublisher.js";
import {
  type MediaAssetIngestRequestedEvent,
  type MediaAssetOptimizeRequestedEvent
} from "@mediaops/shared-contracts";

const FIRST_ITEM_INDEX = 0;
const URL_HASH_PREFIX_LENGTH = 8;

const REASON_SOME_ASSETS_FAILED = "Some media assets failed to process.";
const REASON_OPTIMIZATION_IN_PROGRESS = "Media optimization is still in progress.";
const REASON_TIKTOK_MIXED_MEDIA = "TikTok does not support mixing images and videos, or exceeds image count limits.";
const REASON_FACEBOOK_NO_ASSETS = "No media assets linked to post.";

const TIKTOK_MAX_IMAGE_COUNT = 35;

export interface MediaWorkerResult {
  action: "ack" | "nack_requeue" | "nack_dlq";
  status: string;
}

function parseAssetLinks(assetLinks: unknown): { url: string; filename: string; mimeType: string }[] {
  if (!assetLinks) return [];
  const results: { url: string; filename: string; mimeType: string }[] = [];

  if (Array.isArray(assetLinks)) {
    for (const item of assetLinks) {
      if (typeof item === "string" && item.trim().startsWith("http")) {
        results.push({
          url: item.trim(),
          filename: "unnamed_asset",
          mimeType: "application/octet-stream"
        });
      } else if (typeof item === "object" && item !== null) {
        const obj = item as Record<string, unknown>;
        if (typeof obj.url === "string" && obj.url.trim().startsWith("http")) {
          results.push({
            url: obj.url.trim(),
            filename: typeof obj.filename === "string" ? obj.filename : "unnamed_asset",
            mimeType: typeof obj.type === "string" ? obj.type : "application/octet-stream"
          });
        }
      }
    }
  } else if (typeof assetLinks === "string") {
    const trimmed = assetLinks.trim();
    if (trimmed.startsWith("http")) {
      results.push({
        url: trimmed,
        filename: "unnamed_asset",
        mimeType: "application/octet-stream"
      });
    }
  }

  return results;
}

export class MediaAssetIngestWorker {
  constructor(
    private readonly database: Database,
    private readonly airtableClient: AirtableClient,
    private readonly mediaRepository: MediaRepository,
    private readonly auditLogRepository: AuditLogRepository,
    private readonly queuePublisher: QueuePublisher,
    private readonly logger: Logger
  ) {}

  public async processQueueMessage(
    message: MediaAssetIngestRequestedEvent,
    messageId: string
  ): Promise<MediaWorkerResult> {
    const { workspace_id, post_id, airtable_record_id, content_variant_id } = message;

    this.logger.info("Media ingest requested", { messageId, post_id, airtable_record_id });

    let postRecord;
    try {
      postRecord = await this.airtableClient.getPostRecord(airtable_record_id);
    } catch (err: unknown) {
      this.logger.error("Failed to load post record from Airtable", {
        messageId,
        airtable_record_id,
        error: err instanceof Error ? err.message : String(err)
      });
      return { action: "nack_requeue", status: "airtable_reload_failed" };
    }

    const attachments = parseAssetLinks(postRecord.fields.asset_links);
    if (attachments.length === 0) {
      this.logger.info("No attachments found for post record, complete ingest", { post_id });
      return { action: "ack", status: "no_attachments" };
    }

    const optimizeEventsToPublish: MediaAssetOptimizeRequestedEvent[] = [];

    try {
      await this.database.transaction(workspace_id, async (client) => {
        let index = FIRST_ITEM_INDEX;
        for (const attachment of attachments) {
          const hash = crypto.createHash("sha256").update(attachment.url).digest("hex");

          const asset = await this.mediaRepository.insertMediaAsset(client, {
            workspace_id,
            post_id,
            airtable_record_id,
            source_type: "airtable_attachment",
            source_url_hash: hash,
            original_filename: attachment.filename,
            original_mime_type: attachment.mimeType,
            original_size_bytes: 0,
            status: "received"
          });

          await this.mediaRepository.insertPostMediaAsset(client, {
            workspace_id,
            post_id,
            content_variant_id,
            media_asset_id: asset.id,
            sort_order: index
          });

          if (asset.status !== "ready") {
            optimizeEventsToPublish.push({
              event_id: crypto.randomUUID(),
              event_type: "media.asset.optimize.requested",
              event_version: 1,
              workspace_id,
              media_asset_id: asset.id,
              post_id,
              idempotency_key: `media.optimize:${workspace_id}:${asset.id}:${hash.substring(0, URL_HASH_PREFIX_LENGTH)}`,
              correlation_id: message.correlation_id,
              causation_id: message.event_id
            });
          }
          index++;
        }

        await this.auditLogRepository.insertAuditLog(client, {
          workspaceId: workspace_id,
          eventType: "MEDIA_INGEST_SUCCEEDED",
          entityType: "media_assets",
          entityId: post_id,
          metadata: { count: attachments.length },
          correlationId: message.correlation_id
        });
      });

      for (const optEvent of optimizeEventsToPublish) {
        await this.queuePublisher.publishMediaAssetOptimizeRequested(optEvent, optEvent.event_id);
      }

      return { action: "ack", status: "succeeded" };
    } catch (err: unknown) {
      this.logger.error("Ledger transaction failed in MediaAssetIngestWorker", {
        messageId,
        error: err instanceof Error ? err.message : String(err)
      });
      return { action: "nack_requeue", status: "database_transaction_failed" };
    }
  }
}

export class MediaAssetOptimizeWorker {
  constructor(
    private readonly database: Database,
    private readonly airtableClient: AirtableClient,
    private readonly mediaRepository: MediaRepository,
    private readonly auditLogRepository: AuditLogRepository,
    private readonly r2StorageService: R2StorageService,
    private readonly mediaDownloader: MediaDownloader,
    private readonly imageOptimizer: ImageOptimizer,
    private readonly videoOptimizer: VideoOptimizer,
    private readonly logger: Logger,
    private readonly config: { R2_BUCKET: string; MEDIA_TEMP_DIR: string }
  ) {}

  public async processQueueMessage(
    message: MediaAssetOptimizeRequestedEvent,
    messageId: string
  ): Promise<MediaWorkerResult> {
    const { workspace_id, media_asset_id, post_id } = message;

    this.logger.info("Media optimization requested", { messageId, media_asset_id, post_id });

    const asset = await this.database.transaction(workspace_id, async (client) => {
      return this.mediaRepository.getMediaAssetById(client, workspace_id, media_asset_id);
    });

    if (!asset) {
      this.logger.error("Media asset not found in database", { media_asset_id });
      return { action: "nack_dlq", status: "asset_not_found" };
    }

    if (asset.status === "ready") {
      this.logger.info("Media asset already ready, skip processing", { media_asset_id });
      return { action: "ack", status: "already_ready" };
    }

    let postRecord;
    try {
      postRecord = await this.airtableClient.getPostRecord(asset.airtable_record_id);
    } catch (err: unknown) {
      this.logger.error("Failed to reload Airtable post record", {
        airtable_record_id: asset.airtable_record_id,
        error: err instanceof Error ? err.message : String(err)
      });
      return { action: "nack_requeue", status: "airtable_reload_failed" };
    }

    const attachments = parseAssetLinks(postRecord.fields.asset_links);
    let matchedUrl: string | null = null;
    for (const attachment of attachments) {
      const hash = crypto.createHash("sha256").update(attachment.url).digest("hex");
      if (hash === asset.source_url_hash) {
        matchedUrl = attachment.url;
        break;
      }
    }

    if (!matchedUrl) {
      this.logger.error("Could not find matching source URL for asset hash", {
        source_url_hash: asset.source_url_hash
      });
      await this.database.transaction(workspace_id, async (client) => {
        await this.mediaRepository.updateMediaAssetStatus(client, workspace_id, media_asset_id, "failed", "MEDIA_SOURCE_UNREACHABLE");
        await this.evaluateEligibility(client, workspace_id, post_id);
      });
      return { action: "ack", status: "source_url_not_found" };
    }

    await this.database.transaction(workspace_id, async (client) => {
      await this.mediaRepository.updateMediaAssetStatus(client, workspace_id, media_asset_id, "downloading");
    });

    const tempDownloadPath = path.join(this.config.MEDIA_TEMP_DIR, `download-${crypto.randomUUID()}`);
    let downloadResult;
    try {
      downloadResult = await this.mediaDownloader.download(matchedUrl);
      await fs.mkdir(this.config.MEDIA_TEMP_DIR, { recursive: true });
      await fs.writeFile(tempDownloadPath, downloadResult.buffer);
    } catch (err: unknown) {
      const mediaErr = err instanceof Error ? err : new Error(String(err));
      const code = (mediaErr as NodeJS.ErrnoException).code ?? "MEDIA_SOURCE_UNREACHABLE";
      this.logger.error("Media downloader failed", { media_asset_id, code, error: mediaErr.message });
      await this.database.transaction(workspace_id, async (client) => {
        await this.mediaRepository.updateMediaAssetStatus(client, workspace_id, media_asset_id, "failed", code);
        await this.evaluateEligibility(client, workspace_id, post_id);
      });
      return { action: "ack", status: "download_failed" };
    }

    await this.database.transaction(workspace_id, async (client) => {
      await this.mediaRepository.updateMediaAssetStatus(
        client,
        workspace_id,
        media_asset_id,
        "optimizing",
        null,
        downloadResult.sha256,
        downloadResult.sizeBytes
      );
    });

    const isVideo = downloadResult.mimeType.startsWith("video/");
    const isImage = downloadResult.mimeType.startsWith("image/");

    if (!isVideo && !isImage) {
      this.logger.error("Unsupported file type downloaded", { mimeType: downloadResult.mimeType });
      await fs.rm(tempDownloadPath, { force: true });
      await this.database.transaction(workspace_id, async (client) => {
        await this.mediaRepository.updateMediaAssetStatus(client, workspace_id, media_asset_id, "failed", "MEDIA_UNSUPPORTED_TYPE");
        await this.evaluateEligibility(client, workspace_id, post_id);
      });
      return { action: "ack", status: "unsupported_mime" };
    }

    try {
      if (isImage) {
        const buffer = await fs.readFile(tempDownloadPath);
        const optResult = await this.imageOptimizer.optimize(buffer, downloadResult.mimeType);

        const upload = await this.r2StorageService.uploadBuffer({
          workspaceId: workspace_id,
          postId: post_id,
          data: optResult.buffer,
          mimeType: optResult.mimeType,
          extension: downloadResult.extension,
          sha256: downloadResult.sha256
        });

        await this.database.transaction(workspace_id, async (client) => {
          await this.mediaRepository.insertMediaAssetDerivative(client, {
            workspace_id,
            media_asset_id,
            derivative_kind: "optimized_original",
            storage_bucket: this.config.R2_BUCKET,
            storage_key: upload.storageKey,
            public_url: upload.publicUrl,
            mime_type: optResult.mimeType,
            size_bytes: optResult.buffer.length,
            width: optResult.width,
            height: optResult.height
          });

          await this.mediaRepository.updateMediaAssetStatus(client, workspace_id, media_asset_id, "ready");
          await this.evaluateEligibility(client, workspace_id, post_id);
          
          await this.auditLogRepository.insertAuditLog(client, {
            workspaceId: workspace_id,
            eventType: "MEDIA_OPTIMIZE_SUCCEEDED",
            entityType: "media_assets",
            entityId: media_asset_id,
            metadata: { kind: "image", size: optResult.buffer.length },
            correlationId: message.correlation_id
          });
        });
      } else {
        const tempTranscodePath = path.join(this.config.MEDIA_TEMP_DIR, `transcode-${crypto.randomUUID()}.mp4`);
        try {
          const metadata = await this.videoOptimizer.probe(tempDownloadPath);
          const optResult = await this.videoOptimizer.optimize(tempDownloadPath, tempTranscodePath);
          const transcodeBuffer = await fs.readFile(tempTranscodePath);

          const upload = await this.r2StorageService.uploadBuffer({
            workspaceId: workspace_id,
            postId: post_id,
            data: transcodeBuffer,
            mimeType: optResult.mimeType,
            extension: "mp4",
            sha256: downloadResult.sha256
          });

          await this.database.transaction(workspace_id, async (client) => {
            await this.mediaRepository.insertMediaAssetDerivative(client, {
              workspace_id,
              media_asset_id,
              derivative_kind: "tiktok_video",
              storage_bucket: this.config.R2_BUCKET,
              storage_key: upload.storageKey,
              public_url: upload.publicUrl,
              mime_type: optResult.mimeType,
              size_bytes: optResult.sizeBytes,
              width: metadata.width || null,
              height: metadata.height || null,
              duration_seconds: metadata.durationSeconds || null
            });

            await this.mediaRepository.updateMediaAssetStatus(client, workspace_id, media_asset_id, "ready");
            await this.evaluateEligibility(client, workspace_id, post_id);

            await this.auditLogRepository.insertAuditLog(client, {
              workspaceId: workspace_id,
              eventType: "MEDIA_OPTIMIZE_SUCCEEDED",
              entityType: "media_assets",
              entityId: media_asset_id,
              metadata: { kind: "video", size: optResult.sizeBytes },
              correlationId: message.correlation_id
            });
          });
        } finally {
          await fs.rm(tempTranscodePath, { force: true });
        }
      }

      return { action: "ack", status: "succeeded" };
    } catch (err: unknown) {
      const mediaErr = err instanceof Error ? err : new Error(String(err));
      const code = (mediaErr as NodeJS.ErrnoException).code ?? "MEDIA_OPTIMIZATION_FAILED";
      this.logger.error("Media optimization/upload failed", { media_asset_id, code, error: mediaErr.message });
      await this.database.transaction(workspace_id, async (client) => {
        await this.mediaRepository.updateMediaAssetStatus(client, workspace_id, media_asset_id, "failed", code);
        await this.evaluateEligibility(client, workspace_id, post_id);
      });
      return { action: "ack", status: "optimize_failed" };
    } finally {
      await fs.rm(tempDownloadPath, { force: true });
    }
  }

  private async evaluateEligibility(
    client: pg.PoolClient,
    workspaceId: string,
    postId: string
  ): Promise<void> {
    const postAssets = await this.mediaRepository.getPostMediaAssetsJoined(client, workspaceId, postId);
    if (postAssets.length === 0) return;

    const allReady = postAssets.every((a) => a.status === "ready");
    const anyFailed = postAssets.some((a) => a.status === "failed");

    const videoCount = postAssets.filter((a) => a.original_mime_type.startsWith("video/")).length;
    const imageCount = postAssets.filter((a) => a.original_mime_type.startsWith("image/")).length;

    let tiktokStatus: "eligible" | "ineligible" | "pending" | "failed";
    let tiktokReason: string;
    let facebookStatus: "eligible" | "ineligible" | "pending" | "failed";
    let facebookReason: string;

    if (anyFailed) {
      tiktokStatus = "failed";
      tiktokReason = REASON_SOME_ASSETS_FAILED;
      facebookStatus = "failed";
      facebookReason = REASON_SOME_ASSETS_FAILED;
    } else if (!allReady) {
      tiktokStatus = "pending";
      tiktokReason = REASON_OPTIMIZATION_IN_PROGRESS;
      facebookStatus = "pending";
      facebookReason = REASON_OPTIMIZATION_IN_PROGRESS;
    } else {
      if (videoCount === 1 && imageCount === 0) {
        tiktokStatus = "eligible";
        tiktokReason = "";
      } else if (imageCount >= 1 && imageCount <= TIKTOK_MAX_IMAGE_COUNT && videoCount === 0) {
        tiktokStatus = "eligible";
        tiktokReason = "";
      } else {
        tiktokStatus = "ineligible";
        tiktokReason = REASON_TIKTOK_MIXED_MEDIA;
      }

      if (imageCount > 0 || videoCount > 0) {
        facebookStatus = "eligible";
        facebookReason = "";
      } else {
        facebookStatus = "ineligible";
        facebookReason = REASON_FACEBOOK_NO_ASSETS;
      }
    }

    const eligibility = {
      tiktok: { status: tiktokStatus, reason: tiktokReason },
      facebook: { status: facebookStatus, reason: facebookReason }
    };

    await this.mediaRepository.updatePostMediaEligibility(client, workspaceId, postId, eligibility);
  }
}
