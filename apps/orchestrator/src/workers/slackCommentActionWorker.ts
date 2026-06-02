import type { Database } from "../ledger/postgres.js";
import type { CommentActionRepository } from "../ledger/commentActionRepository.js";
import type { Logger } from "../lib/logger.js";
import { redact } from "../lib/redact.js";
import type { SlackCommentActionEvent } from "@mediaops/shared-contracts";
import type { FacebookMcpClient } from "../mcp/facebookMcpClient.js";
import type { QueuePublisher } from "../queue/rabbitmqPublisher.js";

export interface SlackCommentActionWorkerResult {
  action: "ack" | "nack_requeue" | "nack_dlq";
  status: string;
}

export class SlackCommentActionWorker {
  constructor(
    private readonly database: Database,
    private readonly repository: CommentActionRepository,
    private readonly facebookMcpClient: FacebookMcpClient,
    private readonly queuePublisher: QueuePublisher,
    private readonly logger: Logger,
    private readonly workspaceId: string
  ) {}

  async processQueueMessage(message: SlackCommentActionEvent, messageId: string): Promise<SlackCommentActionWorkerResult> {
    if (message.workspace_id !== this.workspaceId) {
      this.logger.error("Slack comment action message workspace mismatch", {
        messageId,
        message_workspace_id: message.workspace_id,
        worker_workspace_id: this.workspaceId
      });
      return { action: "nack_dlq", status: "workspace_mismatch" };
    }

    // 1. Load Event from DB
    let commandEvent;
    try {
      commandEvent = await this.database.transaction(this.workspaceId, async (client) => {
        return await this.repository.getEventById(client, this.workspaceId, message.action_event_id);
      });
    } catch (error) {
      this.logger.error("Slack comment action worker failed to load event state", {
        messageId,
        error: String(redact(String(error)))
      });
      return { action: "nack_requeue", status: "db_error" };
    }

    if (!commandEvent) {
      this.logger.error("Slack comment action event not found in DB", { messageId, actionEventId: message.action_event_id });
      return { action: "nack_dlq", status: "event_not_found" };
    }

    if (commandEvent.status === "succeeded" || commandEvent.status === "failed") {
      this.logger.info("Slack comment action already processed", { messageId, status: commandEvent.status });
      return { action: "ack", status: "already_processed" };
    }

    // 2. Load Interaction
    let interaction;
    try {
      interaction = await this.database.transaction(this.workspaceId, async (client) => {
        return await this.repository.getInteractionById(client, this.workspaceId, commandEvent.interaction_id);
      });
    } catch (error) {
      this.logger.error("Slack comment action worker failed to load interaction", {
        messageId,
        error: String(redact(String(error)))
      });
      return { action: "nack_requeue", status: "db_error" };
    }

    if (!interaction) {
      await this.markFailed(commandEvent.id, "UNKNOWN_INTERACTION", "Interaction not found", message.correlation_id, commandEvent.slack_user_id);
      return { action: "ack", status: "unknown_interaction" };
    }

    // Check interaction status (only 'new' or 'acknowledged' can be replied to or escalated)
    if (interaction.status === "resolved" || interaction.status === "escalated") {
      await this.markFailed(commandEvent.id, "INTERACTION_ALREADY_PROCESSED", `Interaction is already ${interaction.status}`, message.correlation_id, commandEvent.slack_user_id);
      return { action: "ack", status: "already_processed" };
    }

    // Get channel account ref (Assuming Facebook for MVP)
    // To call MCP, we need channelAccountId only; MCP resolves token internally.
    // For Facebook, channelAccountId can be derived from interaction external_id (page_id_post_id).
    // Or we need to fetch channelAccount based on workspace?
    // Let's assume there's one primary Facebook channel account for the workspace for MVP.
    let channelAccountId = "unknown";
    try {
      await this.database.transaction(this.workspaceId, async (client) => {
        const res = await client.query<{ id: string }>(
          `SELECT id FROM channel_accounts WHERE workspace_id = $1 AND platform = 'facebook' AND status = 'active' LIMIT 1`,
          [this.workspaceId]
        );
        if (res.rows.length > 0) {
          channelAccountId = res.rows[0].id;
        }
      });
    } catch (error) {
      this.logger.error("Failed to load channel account", { error: String(error) });
      return { action: "nack_requeue", status: "db_error" };
    }

    if (channelAccountId === "unknown") {
      await this.markFailed(commandEvent.id, "NO_ACTIVE_CHANNEL", "No active Facebook channel account found", message.correlation_id, commandEvent.slack_user_id);
      return { action: "ack", status: "no_active_channel" };
    }

    let newInteractionStatus = interaction.status;
    let externalReplyId = null;

    if (commandEvent.action === "reply") {
      if (!commandEvent.message) {
        await this.markFailed(commandEvent.id, "MISSING_MESSAGE", "Reply message is required", message.correlation_id, commandEvent.slack_user_id);
        return { action: "ack", status: "missing_message" };
      }

      // 3. MCP Call to Facebook
      try {
        const mcpResult = await this.facebookMcpClient.replyComment({
          external_comment_id: interaction.external_id,
          message: commandEvent.message,
          channelAccountId
        });

        if (!mcpResult.success) {
          await this.markFailed(commandEvent.id, "MCP_ERROR", mcpResult.error || "Unknown MCP Error", message.correlation_id, commandEvent.slack_user_id);
          return { action: "ack", status: "mcp_error" };
        }

        externalReplyId = mcpResult.external_reply_id;
        newInteractionStatus = "resolved";

      } catch (error: unknown) {
        this.logger.error("Slack comment action worker MCP call failed", {
          messageId,
          error: String(redact(String(error)))
        });
        return { action: "nack_requeue", status: "mcp_call_error" };
      }
    } else if (commandEvent.action === "escalate") {
      // For escalate, we just update status and alert Slack
      newInteractionStatus = "escalated";
      
      try {
        await this.queuePublisher.publishSlackAlert({
          text: `⚠️ *Interaction Escalated*\nInteraction ID: \`${interaction.id}\`\nReason: ${commandEvent.reason || "No reason provided"}\nEscalated by: <@${commandEvent.slack_user_id}>`
        }, `${commandEvent.id}-alert`, message.correlation_id);
      } catch (error: unknown) {
        this.logger.error("Failed to publish slack alert for escalation", {
          messageId,
          error: String(redact(String(error)))
        });
        return { action: "nack_requeue", status: "publish_alert_error" };
      }
    }

    // 4. Update DB
    try {
      await this.database.transaction(this.workspaceId, async (client) => {
        // Update interaction
        await this.repository.updateInteractionStatus(client, this.workspaceId, interaction.id, newInteractionStatus);
        
        // Update action event
        await this.repository.updateEventStatus(client, commandEvent.id, "succeeded", null, null, null, externalReplyId);
        
        // Audit
        await this.repository.insertAuditLog(client, {
          workspaceId: this.workspaceId,
          eventType: "SLACK_COMMENT_ACTION_SUCCEEDED",
          entityType: "slack_comment_action",
          entityId: commandEvent.id,
          actorId: commandEvent.slack_user_id,
          metadata: { action: commandEvent.action, interactionId: interaction.id, newStatus: newInteractionStatus },
          correlationId: message.correlation_id
        });
      });
    } catch (error) {
      this.logger.error("Slack comment action worker failed to commit success to Ledger", {
        messageId,
        error: String(redact(String(error)))
      });
      return { action: "nack_requeue", status: "db_commit_error" };
    }

    return { action: "ack", status: "succeeded" };
  }

  private async markFailed(eventId: string, errorCode: string, message: string, correlationId: string, slackUserId: string) {
    try {
      await this.database.transaction(this.workspaceId, async (client) => {
        await this.repository.updateEventStatus(client, eventId, "failed", errorCode, message);
        await this.repository.insertAuditLog(client, {
          workspaceId: this.workspaceId,
          eventType: "SLACK_COMMENT_ACTION_FAILED",
          entityType: "slack_comment_action",
          entityId: eventId,
          actorId: slackUserId,
          metadata: { errorCode, message },
          correlationId
        });
      });
    } catch (e) {
      this.logger.error("Slack comment action worker failed to write failure status to DB", {
        eventId,
        error: String(redact(String(e)))
      });
    }
  }
}
