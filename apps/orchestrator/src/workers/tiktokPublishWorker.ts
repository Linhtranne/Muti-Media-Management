import { randomUUID } from "node:crypto";
import { TiktokPublishWorkerRepository } from "../ledger/tiktokPublishWorkerRepository.js";
import { type TiktokMcpClient } from "../mcp/tiktokMcpClient.js";
import type { AirtableClient } from "../airtable/airtableClient.js";
import type { Database } from "../ledger/postgres.js";
import type { Logger } from "../lib/logger.js";
import type { QueuePublisher } from "../queue/rabbitmqPublisher.js";
import type { PublishTiktokExecuteEvent, PublishTiktokStatusCheckEvent } from "@mediaops/shared-contracts";
import { redact } from "../lib/redact.js";

export interface TiktokPublishWorkerResult {
  action: "ack" | "nack_requeue" | "nack_dlq";
  status: string;
}

const TIKTOK_PHOTO_TITLE_MAX = 90;
const PERMANENT_TIKTOK_ERROR_CODES = new Set([
  "PLATFORM_MEDIA_UNSUPPORTED",
  "PLATFORM_TOKEN_INVALID",
  "PLATFORM_TOKEN_EXPIRED",
  "file_format_check_failed",
  "url_ownership_unverified"
]);

function cleanUrlSecretsFromText(text: string): string {
  const urlRegex = /https?:\/\/[^\s]+/gi;
  return text.replace(urlRegex, (match) => {
    try {
      const url = new URL(match);
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch {
      return match;
    }
  });
}

function readBooleanField(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "yes" || normalized === "1";
  }
  return false;
}

function getErrorCode(errorText: string): string {
  return errorText.split(":")[0]?.trim() || "PLATFORM_REJECTED";
}

export class TiktokPublishWorker {
  private readonly repository = new TiktokPublishWorkerRepository();

  constructor(
    private readonly database: Database,
    private readonly mcpClient: TiktokMcpClient,
    private readonly airtableClient: AirtableClient,
    private readonly logger: Logger,
    private readonly workspaceId: string,
    private readonly queuePublisher?: Pick<QueuePublisher, "publishTiktokStatusCheck" | "publishSlackAlert">
  ) {}

  async processQueueMessage(message: PublishTiktokExecuteEvent, messageId: string): Promise<TiktokPublishWorkerResult> {
    if (message.workspace_id !== this.workspaceId) {
      this.logger.error("TikTok Publish workspace mismatch", {
        messageId,
        message_workspace_id: message.workspace_id,
        worker_workspace_id: this.workspaceId
      });
      return { action: "nack_dlq", status: "workspace_mismatch" };
    }

    const context = await this.database.transaction(this.workspaceId, async (client) => {
      return this.repository.loadAndLockContext(client, this.workspaceId, message);
    });

    if (!context) {
      return { action: "ack", status: "ineligible_or_already_completed" };
    }

    try {
      // 1. Fetch Airtable post to determine post type (video or photo) and privacy settings
      const airtableRecord = await this.airtableClient.getPostRecord(context.variant.airtable_record_id);
      const postTypeField = airtableRecord.fields.tiktok_post_type as string | undefined;
      const postType = postTypeField || (context.mediaDerivatives.some(d => d.derivative_kind === 'tiktok_photo') ? 'photo' : 'video');
      const privacyLevelField = airtableRecord.fields.tiktok_privacy_level as string | undefined;
      const privacyLevel = (privacyLevelField || undefined) as "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "FOLLOWER_OF_CREATOR" | "SELF_ONLY" | undefined;
      const brandContentToggle = readBooleanField(airtableRecord.fields.tiktok_brand_content_toggle);
      const brandOrganicToggle = readBooleanField(airtableRecord.fields.tiktok_brand_organic_toggle);

      let tiktokRequestId = "";

      if (context.job.tiktok_request_id) {
        this.logger.info("TikTok publish job already has request ID, skipping API call", {
          jobId: message.job_id,
          tiktokRequestId: context.job.tiktok_request_id
        });
        tiktokRequestId = context.job.tiktok_request_id;
      } else {
        if (postType === "photo") {
          const photos = context.mediaDerivatives.filter(d => d.derivative_kind === "tiktok_photo");
          if (photos.length === 0) {
            throw new Error("PLATFORM_MEDIA_UNSUPPORTED: No TikTok optimized photos found for photo post");
          }

          const title = context.variant.body.length <= TIKTOK_PHOTO_TITLE_MAX ? context.variant.body : undefined;
          const description = context.variant.body;

          this.logger.info("Calling TikTok MCP publishTikTokPhoto tool", { jobId: message.job_id, photosCount: photos.length });
          const result = await this.mcpClient.publishTiktokPhoto({
            jobRef: { jobId: message.job_id },
            channelAccountId: context.channelAccount.external_account_id,
            workspaceId: this.workspaceId,
            content: {
              ...(title ? { title } : {}),
              description,
              imageUrls: photos.map(p => p.public_url),
              ...(privacyLevel ? { privacyLevel } : {}),
              brandContentToggle,
              brandOrganicToggle
            }
          });
          if (!result.passed || !result.tiktokRequestId) {
            const firstErr = result.errors?.[0];
            throw new Error(`${firstErr?.code || "PLATFORM_REJECTED"}: ${firstErr?.detail || "TikTok photo publishing failed"}`);
          }
          tiktokRequestId = result.tiktokRequestId;
        } else {
          const video = context.mediaDerivatives.find(d => d.derivative_kind === "tiktok_video");
          if (!video) {
            throw new Error("PLATFORM_MEDIA_UNSUPPORTED: No TikTok optimized video found for video post");
          }
          this.logger.info("Calling TikTok MCP publishTikTokVideo tool", { jobId: message.job_id, videoUrl: cleanUrlSecretsFromText(video.public_url) });
          const result = await this.mcpClient.publishTiktokVideo({
            jobRef: { jobId: message.job_id },
            channelAccountId: context.channelAccount.external_account_id,
            workspaceId: this.workspaceId,
            content: {
              title: context.variant.body,
              videoUrl: video.public_url,
              ...(privacyLevel ? { privacyLevel } : {}),
              brandContentToggle,
              brandOrganicToggle
            }
          });
          if (!result.passed || !result.tiktokRequestId) {
            const firstErr = result.errors?.[0];
            throw new Error(`${firstErr?.code || "PLATFORM_REJECTED"}: ${firstErr?.detail || "TikTok video publishing failed"}`);
          }
          tiktokRequestId = result.tiktokRequestId;
        }
      }

      // 2. Persist success status
      await this.database.transaction(this.workspaceId, async (client) => {
        await this.repository.persistPendingStatus(client, this.workspaceId, message.job_id, message.correlation_id, tiktokRequestId);
      });

      // 3. Enqueue status check polling event
      if (this.queuePublisher) {
        const statusCheckEvent: PublishTiktokStatusCheckEvent = {
          event_id: randomUUID(),
          event_type: "publish.tiktok.status_check",
          event_version: 1,
          workspace_id: message.workspace_id,
          correlation_id: message.correlation_id,
          workflow_run_id: message.workflow_run_id,
          job_id: message.job_id,
          variant_id: message.variant_id,
          channel_account_id: message.channel_account_id,
          scheduled_at: new Date().toISOString(),
          idempotency_key: `publish.tiktok.status_check:${message.workspace_id}:${message.job_id}:0`,
          tiktok_request_id: tiktokRequestId,
          check_attempt_count: 0,
          created_at: new Date().toISOString()
        };
        await this.queuePublisher.publishTiktokStatusCheck(statusCheckEvent, statusCheckEvent.event_id);
      }

      return { action: "ack", status: "published_pending_status" };

    } catch (error: unknown) {
      const errorStr = error instanceof Error ? error.message : String(error);
      const platformErrorCode = getErrorCode(errorStr);
      const isPermanent = PERMANENT_TIKTOK_ERROR_CODES.has(platformErrorCode);
      const errorCode = isPermanent ? platformErrorCode : "TRANSIENT_ERROR";
      const rawErrorMessage = errorStr.replace(`${errorCode}:`, "").trim();
      const errorMessage = cleanUrlSecretsFromText(String(redact(rawErrorMessage)));

      if (isPermanent) {
        this.logger.error("TikTok publish failed permanently", { jobId: message.job_id, errorCode, errorMessage });
        await this.database.transaction(this.workspaceId, async (client) => {
          await this.repository.persistPermanentFailure(client, this.workspaceId, message.job_id, message.correlation_id, errorCode, errorMessage);
        });

        // Trigger Slack Alert
        if (this.queuePublisher) {
          const channelId = process.env.PUBLISH_FAIL_SLACK_CHANNEL_ID;
          const alert = {
            event_id: `mcp_publish_fail_${message.job_id}`,
            event_type: "alerts.slack.send",
            event_version: 1,
            workspace_id: message.workspace_id,
            correlation_id: message.correlation_id,
            channel_id: channelId ?? null,
            alert_type: channelId ? "mcp_publish_fail" : "alert_pending_config",
            severity: "error",
            entity_type: "publish_job",
            entity_id: message.job_id,
            created_at: new Date().toISOString(),
            metadata: {
              error_code: errorCode,
              error_message: errorMessage
            }
          };
          await this.queuePublisher.publishSlackAlert(alert, String(alert.event_id), message.correlation_id);
        }

        return { action: "ack", status: "permanent_failure" };
      } else {
        const cleanErrStr = cleanUrlSecretsFromText(errorStr);
        this.logger.warn("TikTok publish failed with transient error, requeuing", { jobId: message.job_id, errorStr: cleanErrStr });
        await this.database.transaction(this.workspaceId, async (client) => {
          await this.repository.persistTransientFailure(client, this.workspaceId, message.job_id);
        });
        return { action: "nack_requeue", status: "transient_failure" };
      }
    }
  }
}
