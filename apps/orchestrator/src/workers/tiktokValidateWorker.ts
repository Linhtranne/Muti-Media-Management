import { TiktokValidateWorkerRepository } from "../ledger/tiktokValidateWorkerRepository.js";
import { type TiktokMcpClient } from "../mcp/tiktokMcpClient.js";
import type { AirtableClient } from "../airtable/airtableClient.js";
import type { Database } from "../ledger/postgres.js";
import type { Logger } from "../lib/logger.js";
import type { QueuePublisher } from "../queue/rabbitmqPublisher.js";
import type { PublishTiktokRequestedEvent, ValidatePostResult } from "@mediaops/shared-contracts";
import { redact } from "../lib/redact.js";

export interface TiktokValidateWorkerResult {
  action: "ack" | "nack_requeue" | "nack_dlq";
  status: string;
}

function cleanUrlQuery(urlStr: string): string {
  try {
    const url = new URL(urlStr);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return urlStr;
  }
}

const TIKTOK_VIDEO_MAX_LENGTH = 2200;
const TIKTOK_PHOTO_MAX_LENGTH = 4000;

export class TiktokValidateWorker {
  private readonly repository = new TiktokValidateWorkerRepository();

  constructor(
    private readonly database: Database,
    private readonly mcpClient: TiktokMcpClient,
    private readonly logger: Logger,
    private readonly workspaceId: string,
    private readonly queuePublisher?: Pick<QueuePublisher, "publishTiktokValidated" | "publishSlackAlert">,
    private readonly airtableClient?: AirtableClient
  ) {}

  async processQueueMessage(message: PublishTiktokRequestedEvent, messageId: string): Promise<TiktokValidateWorkerResult> {
    if (message.workspace_id !== this.workspaceId) {
      this.logger.error("TikTok Validate workspace mismatch", {
        messageId,
        message_workspace_id: message.workspace_id,
        worker_workspace_id: this.workspaceId
      });
      return { action: "nack_dlq", status: "workspace_mismatch" };
    }

    let persisted;
    try {
      persisted = await this.database.transaction(this.workspaceId, async (client) => {
        const existing = await this.repository.getExistingResult(client, this.workspaceId, message.idempotency_key);
        if (existing) {
          return { status: "duplicate" as const };
        }

        const context = await this.repository.loadAndLockContext(client, this.workspaceId, message);
        if (!context) {
          await this.repository.markIneligible(client, this.workspaceId, message, "job_not_queued_or_context_missing");
          return { status: "ineligible" as const };
        }

        // Fetch post type and privacy level from Airtable if client is available
        let postType: string;
        let privacyLevel: "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "FOLLOWER_OF_CREATOR" | "SELF_ONLY" | undefined = undefined;

        if (this.airtableClient) {
          try {
            const airtableRecord = await this.airtableClient.getPostRecord(context.variant.airtable_record_id);
            const postTypeField = airtableRecord.fields.tiktok_post_type as string | undefined;
            postType = postTypeField || (context.mediaDerivatives.some(d => d.derivative_kind === 'tiktok_photo') ? 'photo' : 'video');
            privacyLevel = airtableRecord.fields.tiktok_privacy_level as "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "FOLLOWER_OF_CREATOR" | "SELF_ONLY" | undefined;
          } catch (airtableError) {
            this.logger.warn("Failed to fetch Airtable post details for validation, using fallbacks", {
              variantId: context.variant.id,
              error: String(airtableError)
            });
            postType = context.mediaDerivatives.some(d => d.derivative_kind === 'tiktok_photo') ? 'photo' : 'video';
          }
        } else {
          postType = context.mediaDerivatives.some(d => d.derivative_kind === 'tiktok_photo') ? 'photo' : 'video';
        }

        // Call MCP client to validate
        let validationResult: ValidatePostResult;
        try {
          validationResult = await this.mcpClient.validatePost({
            ...context.input,
            privacyLevel
          });
        } catch (error) {
          validationResult = {
            passed: false,
            violations: [{ code: "PLATFORM_TOKEN_INVALID", detail: `MCP validation failed: ${String(redact(String(error)))}` }],
            warnings: [],
            checkedAt: new Date().toISOString()
          };
        }

        // --- Database & Orchestrator Level Validations (US-016 / US-017 Alignment) ---

        // 1. Verify that the required media derivative is ready in DB
        if (postType === "video") {
          const hasVideoDerivative = context.mediaDerivatives.some(d => d.derivative_kind === "tiktok_video");
          if (!hasVideoDerivative) {
            validationResult.passed = false;
            validationResult.violations.push({
              code: "PLATFORM_MEDIA_UNSUPPORTED",
              detail: "No TikTok optimized video found for video post"
            });
          }
        } else if (postType === "photo") {
          const hasPhotoDerivative = context.mediaDerivatives.some(d => d.derivative_kind === "tiktok_photo");
          if (!hasPhotoDerivative) {
            validationResult.passed = false;
            validationResult.violations.push({
              code: "PLATFORM_MEDIA_UNSUPPORTED",
              detail: "No TikTok optimized photos found for photo post"
            });
          }
        }

        // 2. Verify that public URLs do not contain query parameters/secrets (AWS S3 / R2 presigned parameters are forbidden)
        for (const d of context.mediaDerivatives) {
          try {
            const url = new URL(d.public_url);
            if (url.search !== "") {
              validationResult.passed = false;
              validationResult.violations.push({
                code: "PLATFORM_MEDIA_UNSUPPORTED",
                detail: `Public URL for derivative of kind '${d.derivative_kind}' contains query parameters or secrets: ${cleanUrlQuery(d.public_url)}`
              });
            }
          } catch {
            validationResult.passed = false;
            validationResult.violations.push({
              code: "PLATFORM_MEDIA_UNSUPPORTED",
              detail: `Public URL for derivative of kind '${d.derivative_kind}' is invalid: ${cleanUrlQuery(d.public_url)}`
            });
          }
        }

        // 3. Double-check copy length limits to prevent silent truncation
        if (postType === "video" && context.variant.body.length > TIKTOK_VIDEO_MAX_LENGTH) {
          validationResult.passed = false;
          validationResult.violations.push({
            code: "PLATFORM_TEXT_TOO_LONG",
            detail: `Body length ${context.variant.body.length} exceeds TikTok maximum of 2200 characters for video.`
          });
        } else if (postType === "photo" && context.variant.body.length > TIKTOK_PHOTO_MAX_LENGTH) {
          validationResult.passed = false;
          validationResult.violations.push({
            code: "PLATFORM_TEXT_TOO_LONG",
            detail: `Body length ${context.variant.body.length} exceeds TikTok maximum of 4000 characters for photo.`
          });
        }

        return this.repository.persistValidation(client, this.workspaceId, message, context, validationResult);
      });
    } catch (error) {
      this.logger.error("TikTok validate worker failed during transaction", {
        messageId,
        error: String(redact(String(error)))
      });
      return { action: "nack_requeue", status: "persistence_failed" };
    }

    if (persisted.status === "duplicate" || persisted.status === "ineligible") {
      return { action: "ack", status: persisted.status };
    }

    // Publish event if valid
    if (persisted.publishEvent && this.queuePublisher) {
      await this.queuePublisher.publishTiktokValidated(persisted.publishEvent, persisted.publishEvent.event_id);
    }

    // Slack alert if validation failed
    if (persisted.passed === false && this.queuePublisher) {
      const channelId = process.env.VALIDATE_FAIL_SLACK_CHANNEL_ID;
      const alert = {
        event_id: `mcp_validation_fail_${message.job_id}`,
        event_type: "alerts.slack.send",
        event_version: 1,
        workspace_id: message.workspace_id,
        correlation_id: message.correlation_id,
        channel_id: channelId ?? null,
        alert_type: channelId ? "mcp_validation_fail" : "alert_pending_config",
        severity: "error",
        entity_type: "publish_job",
        entity_id: message.job_id,
        created_at: new Date().toISOString()
      };
      await this.queuePublisher.publishSlackAlert(alert, String(alert.event_id), message.correlation_id);
    }

    return { action: "ack", status: persisted.passed ? "validated" : "validation_failed" };
  }
}
