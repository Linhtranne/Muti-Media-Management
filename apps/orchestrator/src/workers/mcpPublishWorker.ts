import { McpPublishWorkerRepository } from "../ledger/mcpPublishWorkerRepository.js";
import { FacebookMcpClient } from "../mcp/facebookMcpClient.js";
import type { Database } from "../ledger/postgres.js";
import type { Logger } from "../lib/logger.js";
import type { QueuePublisher } from "../queue/rabbitmqPublisher.js";
import type { PublishFacebookExecuteEvent } from "@mediaops/shared-contracts";
import type { AirtableClient } from "../airtable/airtableClient.js";
import { redact } from "../lib/redact.js";

export type McpPublishWorkerResult = {
  action: "ack" | "nack_requeue" | "nack_dlq";
  status: string;
};

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
      this.logger.error("MCP Publish workspace mismatch", {
        messageId,
        messageWorkspaceId: message.workspaceId,
        workerWorkspaceId: this.workspaceId
      });
      return { action: "nack_dlq", status: "workspace_mismatch" };
    }

    let context;
    try {
      context = await this.database.transaction(this.workspaceId, async (client) => {
        return await this.repository.loadAndLockContext(client, this.workspaceId, message);
      });
    } catch (error) {
      this.logger.error("MCP publish worker failed to load context", {
        messageId,
        error: String(redact(String(error)))
      });
      return { action: "nack_requeue", status: "context_load_failed" };
    }

    if (!context) {
      // Not validated or publishing, or missing variant/account.
      return { action: "ack", status: "ineligible" };
    }

    if (!context.input) {
      // Already published or failed
      return { action: "ack", status: "already_finished" };
    }

    // Call MCP tool
    let publishResult;
    try {
      publishResult = await this.mcpClient.publishPost(context.input);
    } catch (error: any) {
      // Network failure talking to MCP or MCP crashed
      this.logger.error("MCP publish call failed completely", {
        messageId,
        error: String(redact(String(error)))
      });
      
      try {
        await this.database.transaction(this.workspaceId, async (client) => {
          await this.repository.persistTransientFailure(client, this.workspaceId, message.jobId);
        });
      } catch (dbError) {}

      return { action: "nack_requeue", status: "mcp_call_failed" };
    }

    if (publishResult.passed) {
      // Success path
      try {
        await this.database.transaction(this.workspaceId, async (client) => {
          await this.repository.persistSuccess(client, this.workspaceId, message.jobId, message.correlationId, publishResult);
        });
      } catch (error) {
        this.logger.error("Failed to persist publish success", { messageId });
        return { action: "nack_requeue", status: "persist_success_failed" };
      }

      // Airtable Sync (Best effort, non-rollback)
      try {
        await this.airtableClient.updateRecordStatus(this.workspaceId, context.airtable_record_id, "Published");
      } catch (error: any) {
        this.logger.warn("Failed to sync Airtable Published status, flagging for compensation", { messageId });
        try {
          await this.database.transaction(this.workspaceId, async (client) => {
            await this.repository.persistAirtableCompensation(client, this.workspaceId, message.jobId, String(redact(String(error))));
          });
        } catch (dbError) {}
      }

      // Slack Alert
      if (this.queuePublisher) {
        const channelId = process.env.PUBLISH_SUCCESS_SLACK_CHANNEL_ID;
        await this.queuePublisher.publishSlackAlert({
          event_id: `mcp_publish_success_${message.jobId}`,
          workspace_id: this.workspaceId,
          correlation_id: message.correlationId,
          channel_id: channelId ?? null,
          alert_type: channelId ? "mcp_publish_success" : "alert_pending_config",
          severity: "info",
          entity_type: "publish_job",
          entity_id: message.jobId,
          metadata: { external_post_id: publishResult.externalPostId },
          created_at: new Date().toISOString()
        }, messageId, message.correlationId);
      }

      return { action: "ack", status: "published" };
    } else {
      // Failure path
      // Determine if permanent or transient
      // MCP publish tool maps 5xx and network timeouts to PLATFORM_TRANSIENT_ERROR
      const isTransient = publishResult.errors?.some(e => e.code === "PLATFORM_TRANSIENT_ERROR");

      if (isTransient) {
        try {
          await this.database.transaction(this.workspaceId, async (client) => {
            await this.repository.persistTransientFailure(client, this.workspaceId, message.jobId);
          });
        } catch (dbError) {}
        return { action: "nack_requeue", status: "transient_failure" };
      } else {
        // Permanent failure
        const errCode = publishResult.errors?.[0]?.code || "UNKNOWN_ERROR";
        const errMsg = publishResult.errors?.map(e => e.detail).join('; ') || "Unknown failure";

        try {
          await this.database.transaction(this.workspaceId, async (client) => {
            await this.repository.persistPermanentFailure(client, this.workspaceId, message.jobId, message.correlationId, errCode, errMsg);
          });
        } catch (error) {
          this.logger.error("Failed to persist permanent failure", { messageId });
          return { action: "nack_requeue", status: "persist_failure_failed" };
        }

        // Airtable Sync (Best effort)
        try {
          // If we want to set failed on Airtable, we can. The exact Airtable fields depend on schema.
          // Assuming updateRecordStatus supports "Failed".
          await this.airtableClient.updateRecordStatus(this.workspaceId, context.airtable_record_id, "Failed");
        } catch (error: any) {}

        // Slack Alert
        if (this.queuePublisher) {
          const channelId = process.env.VALIDATE_FAIL_SLACK_CHANNEL_ID; // or PUBLISH_FAIL_SLACK_CHANNEL_ID
          await this.queuePublisher.publishSlackAlert({
            event_id: `mcp_publish_fail_${message.jobId}`,
            workspace_id: this.workspaceId,
            correlation_id: message.correlationId,
            channel_id: channelId ?? null,
            alert_type: channelId ? "mcp_publish_fail" : "alert_pending_config",
            severity: "error",
            entity_type: "publish_job",
            entity_id: message.jobId,
            metadata: { error_code: errCode },
            created_at: new Date().toISOString()
          }, messageId, message.correlationId);
        }

        return { action: "ack", status: "permanent_failure" };
      }
    }
  }
}
