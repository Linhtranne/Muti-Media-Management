import { McpValidateWorkerRepository } from "../ledger/mcpValidateWorkerRepository.js";
import { FacebookMcpClient } from "../mcp/facebookMcpClient.js";
import type { Database } from "../ledger/postgres.js";
import type { Logger } from "../lib/logger.js";
import type { QueuePublisher } from "../queue/rabbitmqPublisher.js";
import type { PublishFacebookRequestedEvent } from "@mediaops/shared-contracts";
import { redact } from "../lib/redact.js";

export type McpValidateWorkerResult = {
  action: "ack" | "nack_requeue" | "nack_dlq";
  status: string;
};

export class McpValidateWorker {
  private readonly repository = new McpValidateWorkerRepository();

  constructor(
    private readonly database: Database,
    private readonly mcpClient: FacebookMcpClient,
    private readonly logger: Logger,
    private readonly workspaceId: string,
    private readonly queuePublisher?: Pick<QueuePublisher, "publishFacebookValidated" | "publishSlackAlert">
  ) {}

  async processQueueMessage(message: PublishFacebookRequestedEvent, messageId: string): Promise<McpValidateWorkerResult> {
    if (message.workspace_id !== this.workspaceId) {
      this.logger.error("MCP Validate workspace mismatch", {
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

        // Call MCP client to validate
        let validationResult;
        try {
          validationResult = await this.mcpClient.validatePost(context.input);
        } catch (error) {
          validationResult = {
            passed: false,
            violations: [{ code: "INVALID_CREDENTIALS", detail: `MCP validation failed: ${String(redact(String(error)))}` }],
            warnings: [],
            checkedAt: new Date().toISOString()
          };
        }

        return this.repository.persistValidation(client, this.workspaceId, message, context, validationResult as any);
      });
    } catch (error) {
      this.logger.error("MCP validate worker failed during transaction", {
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
      await this.queuePublisher.publishFacebookValidated(persisted.publishEvent, persisted.publishEvent.event_id);
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
