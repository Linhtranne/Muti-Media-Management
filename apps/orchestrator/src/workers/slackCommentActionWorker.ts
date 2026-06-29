import type { Database } from "../ledger/postgres.js";
import type { CommentActionRepository, CommentActionEvent, Interaction } from "../ledger/commentActionRepository.js";
import type { Logger } from "../lib/logger.js";
import { redact } from "../lib/redact.js";
import type { SlackCommentActionEvent } from "@mediaops/shared-contracts";
import type { FacebookMcpClient } from "../mcp/facebookMcpClient.js";
import type { QueuePublisher } from "../queue/rabbitmqPublisher.js";

const UNKNOWN_MCP_ERROR = "Unknown MCP Error";
const NO_ESCALATION_REASON_PROVIDED = "No reason provided";

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
      this.logger.error("Slack comment action message workspace mismatch", { messageId, message_workspace_id: message.workspace_id, worker_workspace_id: this.workspaceId });
      return { action: "nack_dlq", status: "workspace_mismatch" };
    }

    const { event: commandEvent, errorResult: eventErr } = await this.fetchAndValidateEvent(message.action_event_id, messageId);
    if (eventErr || !commandEvent) return eventErr!;

    const { interaction, errorResult: intErr } = await this.fetchAndValidateInteraction(commandEvent, message.correlation_id, messageId);
    if (intErr || !interaction) return intErr!;

    const { channelAccountId, errorResult: chanErr } = await this.getValidChannelAccount(interaction.id, commandEvent, message.correlation_id, messageId);
    if (chanErr || !channelAccountId) return chanErr!;

    const { newInteractionStatus, externalReplyId, errorResult: actionErr } = await this.processAction(commandEvent, interaction, channelAccountId, message.correlation_id, messageId);
    if (actionErr) return actionErr;

    const commitSuccess = await this.commitSuccessState(commandEvent, interaction, newInteractionStatus, externalReplyId, message.correlation_id, messageId);
    if (!commitSuccess) return { action: "nack_requeue", status: "db_commit_error" };

    if (commandEvent.action === "escalate") {
      await this.handleEscalateAlert(commandEvent, interaction, message.correlation_id, messageId);
    }

    return { action: "ack", status: "succeeded" };
  }

  private async fetchAndValidateEvent(actionEventId: string, messageId: string): Promise<{ event?: CommentActionEvent, errorResult?: SlackCommentActionWorkerResult }> {
    const commandEvent = await this.loadEvent(actionEventId, messageId);
    if (!commandEvent) return { errorResult: { action: "nack_requeue", status: "db_error" } };
    if (commandEvent === "not_found") return { errorResult: { action: "nack_dlq", status: "event_not_found" } };
    if (commandEvent.status === "succeeded" || commandEvent.status === "failed") {
      this.logger.info("Slack comment action already processed", { messageId, status: commandEvent.status });
      return { errorResult: { action: "ack", status: "already_processed" } };
    }
    return { event: commandEvent };
  }

  private async fetchAndValidateInteraction(commandEvent: CommentActionEvent, correlationId: string, messageId: string): Promise<{ interaction?: Interaction, errorResult?: SlackCommentActionWorkerResult }> {
    const interaction = await this.loadInteraction(commandEvent.interaction_id, messageId);
    if (!interaction) return { errorResult: { action: "nack_requeue", status: "db_error" } };
    if (interaction === "not_found") {
      await this.markFailed(commandEvent.id, "UNKNOWN_INTERACTION", "Interaction not found", correlationId, commandEvent.slack_user_id);
      return { errorResult: { action: "ack", status: "unknown_interaction" } };
    }

    if (interaction.status === "resolved" || interaction.status === "escalated") {
      await this.markFailed(commandEvent.id, "INTERACTION_ALREADY_PROCESSED", `Interaction is already ${interaction.status}`, correlationId, commandEvent.slack_user_id);
      return { errorResult: { action: "ack", status: "already_processed" } };
    }
    return { interaction: interaction };
  }

  private async getValidChannelAccount(interactionId: string, commandEvent: CommentActionEvent, correlationId: string, messageId: string): Promise<{ channelAccountId?: string, errorResult?: SlackCommentActionWorkerResult }> {
    const channelAccountId = await this.resolveChannelAccount(interactionId, messageId);
    if (!channelAccountId) return { errorResult: { action: "nack_requeue", status: "db_error" } };
    if (channelAccountId === "unknown") {
      await this.markFailed(commandEvent.id, "CHANNEL_ACCOUNT_UNRESOLVED", "No active Facebook channel account could be resolved for this interaction", correlationId, commandEvent.slack_user_id);
      return { errorResult: { action: "ack", status: "channel_account_unresolved" } };
    }
    return { channelAccountId };
  }

  private async processAction(commandEvent: CommentActionEvent, interaction: Interaction, channelAccountId: string, correlationId: string, messageId: string): Promise<{ newInteractionStatus: string, externalReplyId: string | null, errorResult?: SlackCommentActionWorkerResult }> {
    if (commandEvent.action === "reply") {
      if (!commandEvent.message) {
        await this.markFailed(commandEvent.id, "MISSING_MESSAGE", "Reply message is required", correlationId, commandEvent.slack_user_id);
        return { newInteractionStatus: "", externalReplyId: null, errorResult: { action: "ack", status: "missing_message" } };
      }
      const replyResult = await this.handleReplyCommand(commandEvent, interaction, channelAccountId, correlationId, messageId);
      if (!replyResult.success) return { newInteractionStatus: "", externalReplyId: null, errorResult: replyResult.errorReturn };
      
      return { newInteractionStatus: "resolved", externalReplyId: replyResult.externalReplyId || null };
    }
    
    return { newInteractionStatus: "escalated", externalReplyId: null };
  }

  private async loadEvent(actionEventId: string, messageId: string) {
    try {
      const event = await this.database.transaction(this.workspaceId, async (client) => {
        return await this.repository.getEventById(client, this.workspaceId, actionEventId);
      });
      return event || "not_found";
    } catch (error) {
      this.logger.error("Slack comment action worker failed to load event state", { messageId, error: String(redact(String(error))) });
      return null;
    }
  }

  private async loadInteraction(interactionId: string, messageId: string) {
    try {
      const interaction = await this.database.transaction(this.workspaceId, async (client) => {
        return await this.repository.getInteractionById(client, this.workspaceId, interactionId);
      });
      return interaction || "not_found";
    } catch (error) {
      this.logger.error("Slack comment action worker failed to load interaction", { messageId, error: String(redact(String(error))) });
      return null;
    }
  }

  private async resolveChannelAccount(interactionId: string, messageId: string) {
    try {
      let channelAccountId = "unknown";
      await this.database.transaction(this.workspaceId, async (client) => {
        const resolvedId = await this.repository.resolveFacebookChannelAccountForInteraction(client, this.workspaceId, interactionId);
        if (resolvedId) channelAccountId = resolvedId;
      });
      return channelAccountId;
    } catch (error) {
      this.logger.error("Failed to load channel account", { messageId, error: String(redact(String(error))) });
      return null;
    }
  }

  private async handleReplyCommand(commandEvent: CommentActionEvent, interaction: Interaction, channelAccountId: string, correlationId: string, messageId: string): Promise<{ success: boolean; externalReplyId?: string; errorReturn?: SlackCommentActionWorkerResult }> {
    try {
      const mcpResult = await this.facebookMcpClient.replyComment({
        external_comment_id: interaction.external_id,
        message: commandEvent.message!,
        channelAccountId
      });

      if (!mcpResult.success) {
        await this.markFailed(commandEvent.id, "MCP_ERROR", mcpResult.error || UNKNOWN_MCP_ERROR, correlationId, commandEvent.slack_user_id);
        return { success: false, errorReturn: { action: "ack", status: "mcp_error" } };
      }

      return { success: true, externalReplyId: mcpResult.external_reply_id };
    } catch (error: unknown) {
      this.logger.error("Slack comment action worker MCP call failed", { messageId, error: String(redact(String(error))) });
      return { success: false, errorReturn: { action: "nack_requeue", status: "mcp_call_error" } };
    }
  }

  private async commitSuccessState(commandEvent: CommentActionEvent, interaction: Interaction, newStatus: string, externalReplyId: string | null, correlationId: string, messageId: string) {
    try {
      await this.database.transaction(this.workspaceId, async (client) => {
        await this.repository.updateInteractionStatus(client, this.workspaceId, interaction.id, newStatus);
        await this.repository.updateEventStatus(client, commandEvent.id, "succeeded", null, null, null, externalReplyId);
        await this.repository.insertAuditLog(client, {
          workspaceId: this.workspaceId,
          eventType: "SLACK_COMMENT_ACTION_SUCCEEDED",
          entityType: "slack_comment_action",
          entityId: commandEvent.id,
          actorId: commandEvent.slack_user_id,
          metadata: { action: commandEvent.action, interactionId: interaction.id, newStatus },
          correlationId
        });
      });
      return true;
    } catch (error) {
      this.logger.error("Slack comment action worker failed to commit success to Ledger", { messageId, error: String(redact(String(error))) });
      return false;
    }
  }

  private async handleEscalateAlert(commandEvent: CommentActionEvent, interaction: Interaction, correlationId: string, messageId: string) {
    const alertText = `⚠️ *Interaction Escalated*\nInteraction ID: \`${interaction.id}\`\nReason: ${commandEvent.reason || NO_ESCALATION_REASON_PROVIDED}\nEscalated by: <@${commandEvent.slack_user_id}>`;
    try {
      await this.queuePublisher.publishSlackAlert({ text: alertText }, `${commandEvent.id}-alert`, correlationId);
    } catch (error: unknown) {
      this.logger.error("Failed to publish slack alert for escalation", { messageId, error: String(redact(String(error))) });
      try {
        await this.database.transaction(this.workspaceId, async (client) => {
          await this.repository.insertAuditLog(client, {
            workspaceId: this.workspaceId,
            eventType: "SLACK_COMMENT_ESCALATION_ALERT_FAILED",
            entityType: "slack_comment_action",
            entityId: commandEvent.id,
            actorId: commandEvent.slack_user_id,
            metadata: { error: String(redact(String(error))) },
            correlationId
          });
        });
      } catch (auditErr) {
        this.logger.error("Failed to write audit log for failed slack alert", { error: String(redact(String(auditErr))) });
      }
    }
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
