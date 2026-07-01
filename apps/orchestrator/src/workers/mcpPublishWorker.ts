import { McpPublishWorkerRepository, type McpPublishContext } from "../ledger/mcpPublishWorkerRepository.js";
import { type FacebookMcpClient } from "../mcp/facebookMcpClient.js";
import type { Database } from "../ledger/postgres.js";
import type { Logger } from "../lib/logger.js";
import type { QueuePublisher } from "../queue/rabbitmqPublisher.js";
import type { PublishFacebookExecuteEvent, PublishPostResult } from "@mediaops/shared-contracts";
import type { AirtableClient } from "../airtable/airtableClient.js";
import { redact } from "../lib/redact.js";

export interface McpPublishWorkerResult {
  action: "ack" | "nack_requeue" | "nack_dlq";
  status: string;
}

export class McpPublishWorker {
  private readonly repository = new McpPublishWorkerRepository();

  constructor(
    private readonly database: Database,
    private readonly mcpClient: FacebookMcpClient,
    private readonly airtableClient: AirtableClient,
    private readonly logger: Logger,
    private readonly workspaceId: string,
    private readonly queuePublisher?: Pick<QueuePublisher, "publishSlackAlert">
  ) {}

  async processQueueMessage(message: PublishFacebookExecuteEvent, messageId: string): Promise<McpPublishWorkerResult> {
    if (message.workspaceId !== this.workspaceId) {
      this.logger.error("MCP Publish workspace mismatch", { messageId, messageWorkspaceId: message.workspaceId, workerWorkspaceId: this.workspaceId });
      return { action: "nack_dlq", status: "workspace_mismatch" };
    }

    const contextResult = await this.loadContext(message, messageId);
    if (!contextResult) return { action: "ack", status: "ineligible" };
    if ("action" in contextResult) return contextResult as McpPublishWorkerResult;
    const context = contextResult;
    if (!context.input) return { action: "ack", status: "already_finished" };

    let publishResult: PublishPostResult;
    try {
      publishResult = await this.mcpClient.publishPost(context.input);
    } catch (error: unknown) {
      return await this.handleMcpCallFailure(message, messageId, error);
    }

    if (publishResult.passed) {
      return await this.handlePublishSuccess(message, messageId, context, publishResult);
    } else {
      return await this.handlePublishFailure(message, messageId, context, publishResult);
    }
  }

  private async loadContext(message: PublishFacebookExecuteEvent, messageId: string) {
    try {
      return await this.database.transaction(this.workspaceId, async (client) => {
        return await this.repository.loadAndLockContext(client, this.workspaceId, message);
      });
    } catch (error) {
      this.logger.error("MCP publish worker failed to load context", { messageId, error: String(redact(String(error))) });
      return { action: "nack_requeue", status: "context_load_failed" };
    }
  }

  private async handleMcpCallFailure(message: PublishFacebookExecuteEvent, messageId: string, error: unknown): Promise<McpPublishWorkerResult> {
    this.logger.error("MCP publish call failed completely", { messageId, error: String(redact(String(error))) });
    try {
      await this.database.transaction(this.workspaceId, async (client) => {
        await this.repository.persistTransientFailure(client, this.workspaceId, message.jobId);
      });
    } catch (dbError) {
      this.logger.error("Failed to persist MCP publish transient failure", { messageId, error: String(redact(String(dbError))) });
    }
    return { action: "nack_requeue", status: "mcp_call_failed" };
  }

  private async handlePublishSuccess(message: PublishFacebookExecuteEvent, messageId: string, context: McpPublishContext, publishResult: PublishPostResult): Promise<McpPublishWorkerResult> {
    try {
      await this.database.transaction(this.workspaceId, async (client) => {
        await this.repository.persistSuccess(client, this.workspaceId, message.jobId, message.correlationId, publishResult);
      });
    } catch {
      this.logger.error("Failed to persist publish success", { messageId });
      return { action: "nack_requeue", status: "persist_success_failed" };
    }

    await this.syncAirtableSuccess(message, messageId, context);
    await this.publishSlackAlertSafe(message, messageId, publishResult.externalPostId || null, null, "mcp_publish_success", process.env.PUBLISH_SUCCESS_SLACK_CHANNEL_ID, "info");

    return { action: "ack", status: "published" };
  }

  private async syncAirtableSuccess(message: PublishFacebookExecuteEvent, messageId: string, context: McpPublishContext) {
    try {
      await this.airtableClient.updateRecordStatus(this.workspaceId, context.airtable_record_id, "Published");
    } catch (error: unknown) {
      this.logger.warn("Failed to sync Airtable Published status, flagging for compensation", { messageId });
      try {
        await this.database.transaction(this.workspaceId, async (client) => {
          await this.repository.persistAirtableCompensation(client, this.workspaceId, message.jobId, String(redact(String(error))));
        });
      } catch (dbError) {
        this.logger.error("Failed to persist Airtable compensation", { messageId, error: String(redact(String(dbError))) });
      }
    }
  }

  private async handlePublishFailure(message: PublishFacebookExecuteEvent, messageId: string, context: McpPublishContext, publishResult: PublishPostResult): Promise<McpPublishWorkerResult> {
    const isTransient = publishResult.errors?.some(e => e.code === "PLATFORM_TRANSIENT_ERROR");

    if (isTransient) {
      try {
        await this.database.transaction(this.workspaceId, async (client) => {
          await this.repository.persistTransientFailure(client, this.workspaceId, message.jobId);
        });
      } catch (dbError) {
        this.logger.error("Failed to persist transient publish failure", { messageId, error: String(redact(String(dbError))) });
      }
      return { action: "nack_requeue", status: "transient_failure" };
    }

    const errCode = publishResult.errors?.[0]?.code || "UNKNOWN_ERROR";
    const errMsg = publishResult.errors?.map(e => e.detail).join('; ') || "Unknown failure";

    try {
      await this.database.transaction(this.workspaceId, async (client) => {
        await this.repository.persistPermanentFailure(client, this.workspaceId, message.jobId, message.correlationId, errCode, errMsg);
      });
    } catch (error) {
      this.logger.error("Failed to persist permanent failure", { messageId, error: String(redact(String(error))) });
      return { action: "nack_requeue", status: "persist_failure_failed" };
    }

    try {
      await this.airtableClient.updateRecordStatus(this.workspaceId, context.airtable_record_id, "Failed");
    } catch (error) {
      this.logger.warn("Failed to sync Airtable failed status", { messageId, error: String(redact(String(error))) });
    }

    await this.publishSlackAlertSafe(message, messageId, null, errCode, "mcp_publish_fail", process.env.VALIDATE_FAIL_SLACK_CHANNEL_ID || process.env.PUBLISH_FAIL_SLACK_CHANNEL_ID, "error");

    return { action: "ack", status: "permanent_failure" };
  }

  private async publishSlackAlertSafe(message: PublishFacebookExecuteEvent, messageId: string, externalPostId: string | null, errorCode: string | null, alertPrefix: string, channelId: string | undefined, severity: "info" | "error" | "warning") {
    if (!this.queuePublisher) return;
    try {
      await this.queuePublisher.publishSlackAlert({
        event_id: `${alertPrefix}_${message.jobId}`,
        workspace_id: this.workspaceId,
        correlation_id: message.correlationId,
        channel_id: channelId ?? null,
        alert_type: channelId ? (alertPrefix) : "alert_pending_config",
        severity,
        entity_type: "publish_job",
        entity_id: message.jobId,
        metadata: externalPostId ? { external_post_id: externalPostId } : { error_code: errorCode || "UNKNOWN" },
        created_at: new Date().toISOString()
      }, messageId, message.correlationId);
    } catch (error) {
      this.logger.error("Failed to publish slack alert", { messageId, error: String(redact(String(error))) });
    }
  }
}
