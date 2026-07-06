import { randomUUID } from "node:crypto";
import { TiktokStatusCheckWorkerRepository } from "../ledger/tiktokStatusCheckWorkerRepository.js";
import { type TiktokMcpClient } from "../mcp/tiktokMcpClient.js";
import type { Database } from "../ledger/postgres.js";
import type { Logger } from "../lib/logger.js";
import type { QueuePublisher } from "../queue/rabbitmqPublisher.js";
import type { PublishTiktokStatusCheckEvent } from "@mediaops/shared-contracts";
import { redact } from "../lib/redact.js";

export interface TiktokStatusCheckWorkerResult {
  action: "ack" | "nack_requeue" | "nack_dlq";
  status: string;
}

const MAX_POLLING_ATTEMPTS = 15;
const POLLING_DELAY_MS = 60000; // 1 minute
const DEFAULT_REJECT_REASON = "TikTok rejected the publish request";
const TIMEOUT_ERROR_MESSAGE = "TikTok publishing timed out after 15 minutes";

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

export class TiktokStatusCheckWorker {
  private readonly repository = new TiktokStatusCheckWorkerRepository();

  constructor(
    private readonly database: Database,
    private readonly mcpClient: TiktokMcpClient,
    private readonly logger: Logger,
    private readonly workspaceId: string,
    private readonly queuePublisher?: Pick<QueuePublisher, "publishTiktokStatusCheck" | "publishSlackAlert">
  ) {}

  async processQueueMessage(message: PublishTiktokStatusCheckEvent, messageId: string): Promise<TiktokStatusCheckWorkerResult> {
    if (message.workspace_id !== this.workspaceId) {
      this.logger.error("TikTok Status Check workspace mismatch", {
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
      this.logger.info("Calling TikTok MCP getTikTokPublishStatus tool", { jobId: message.job_id, tiktokRequestId: message.tiktok_request_id, attempt: message.check_attempt_count });
      
      const result = await this.mcpClient.getTiktokPublishStatus({
        channelAccountId: context.channelAccount.external_account_id,
        workspaceId: this.workspaceId,
        tiktokRequestId: message.tiktok_request_id
      });

      if (result.status === "PUBLISHED") {
        const externalPostId = result.externalPostId;
        if (!externalPostId) {
          throw new Error("PLATFORM_ERROR: TikTok publish succeeded but platform response lacked externalPostId.");
        }
        this.logger.info("TikTok publish job succeeded", { jobId: message.job_id, externalPostId });
        await this.database.transaction(this.workspaceId, async (client) => {
          await this.repository.persistSuccess(
            client,
            this.workspaceId,
            message.job_id,
            message.correlation_id,
            externalPostId,
            { tiktokRequestId: message.tiktok_request_id }
          );
        });
        return { action: "ack", status: "succeeded" };
      }

      if (result.status === "FAILED") {
        const firstError = result.errors?.[0];
        const errorCode = firstError?.code || "PLATFORM_REJECTED";
        const errorMessage = cleanUrlSecretsFromText(String(redact(firstError?.detail || DEFAULT_REJECT_REASON)));
        
        this.logger.error("TikTok publish job failed", { jobId: message.job_id, errorCode, errorMessage });
        
        await this.database.transaction(this.workspaceId, async (client) => {
          await this.repository.persistFailure(
            client,
            this.workspaceId,
            message.job_id,
            message.correlation_id,
            errorCode,
            errorMessage
          );
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

        return { action: "ack", status: "failed" };
      }

      // If still processing or pending
      const nextAttempt = message.check_attempt_count + 1;
      if (nextAttempt >= MAX_POLLING_ATTEMPTS) {
        const errorCode = "TIMEOUT";
        const errorMessage = TIMEOUT_ERROR_MESSAGE;
        
        this.logger.error("TikTok publish job timeout", { jobId: message.job_id });

        await this.database.transaction(this.workspaceId, async (client) => {
          await this.repository.persistFailure(
            client,
            this.workspaceId,
            message.job_id,
            message.correlation_id,
            errorCode,
            errorMessage
          );
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

        return { action: "ack", status: "timeout" };
      }

      // Schedule next status check with 1 minute delay
      if (this.queuePublisher) {
        const nextStatusCheckEvent: PublishTiktokStatusCheckEvent = {
          event_id: randomUUID(),
          event_type: "publish.tiktok.status_check",
          event_version: 1,
          workspace_id: message.workspace_id,
          correlation_id: message.correlation_id,
          workflow_run_id: message.workflow_run_id,
          job_id: message.job_id,
          variant_id: message.variant_id,
          channel_account_id: message.channel_account_id,
          scheduled_at: new Date(Date.now() + POLLING_DELAY_MS).toISOString(),
          idempotency_key: `publish.tiktok.status_check:${message.workspace_id}:${message.job_id}:${nextAttempt}`,
          tiktok_request_id: message.tiktok_request_id,
          check_attempt_count: nextAttempt,
          created_at: new Date().toISOString()
        };
        
        this.logger.info("TikTok publish job still processing, enqueuing next check with delay", { jobId: message.job_id, nextAttempt });
        await this.queuePublisher.publishTiktokStatusCheck(nextStatusCheckEvent, nextStatusCheckEvent.event_id, POLLING_DELAY_MS);
      }

      return { action: "ack", status: "requeued_with_delay" };

    } catch (error: unknown) {
      const errorStr = cleanUrlSecretsFromText(String(redact(String(error))));
      const isPermanent = errorStr.includes("PLATFORM_MEDIA_UNSUPPORTED") ||
                          errorStr.includes("PLATFORM_TOKEN_INVALID") ||
                          errorStr.includes("PLATFORM_TOKEN_EXPIRED") ||
                          errorStr.includes("PLATFORM_ERROR") ||
                          errorStr.includes("PLATFORM_REJECTED") ||
                          errorStr.includes("SECRET_UNAVAILABLE") ||
                          errorStr.includes("API_UNCONFIGURED");

      if (isPermanent) {
        this.logger.error("TikTok status check permanent failure", { jobId: message.job_id, error: errorStr });
        await this.database.transaction(this.workspaceId, async (client) => {
          await this.repository.persistFailure(
            client,
            this.workspaceId,
            message.job_id,
            message.correlation_id,
            "PLATFORM_ERROR",
            errorStr
          );
        });
        return { action: "ack", status: "failed" };
      }

      this.logger.warn("TikTok status check transient error, requeuing message", { jobId: message.job_id, error: errorStr });
      return { action: "nack_requeue", status: "transient_failure" };
    }
  }
}
