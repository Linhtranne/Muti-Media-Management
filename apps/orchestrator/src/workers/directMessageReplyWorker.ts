import { type DirectMessageReplyRequestedEvent } from "@mediaops/shared-contracts";
import { type DirectMessageRepository } from "../ledger/directMessageRepository.js";
import { type FacebookMcpClient } from "../mcp/facebookMcpClient.js";
import { type Database } from "../ledger/postgres.js";
import { type QueuePublisher } from "../queue/rabbitmqPublisher.js";
import { type Logger } from "../lib/logger.js";
import { redact } from "../lib/redact.js";

export interface ReplyWorkerResult {
  action: "ack" | "nack_requeue" | "nack_dlq";
  status: string;
  error?: string;
}

export class DirectMessageReplyWorker {
  constructor(
    private readonly database: Database,
    private readonly dmRepo: DirectMessageRepository,
    private readonly publisher: QueuePublisher,
    private readonly mcpClient: FacebookMcpClient,
    private readonly logger: Logger,
    private readonly workspaceId: string,
    private readonly slackChannels: { inboxChannelId?: string } = {}
  ) {}

  async processQueueMessage(message: DirectMessageReplyRequestedEvent, messageId: string): Promise<ReplyWorkerResult> {
    if (message.workspace_id !== this.workspaceId) {
      this.logger.error("Workspace mismatch in DM Reply worker", {
        messageId,
        messageWorkspaceId: message.workspace_id,
        workerWorkspaceId: this.workspaceId
      });
      return { action: "nack_dlq", status: "workspace_mismatch" };
    }

    const replyJobId = message.payload.reply_job_id;

    // 1. Load and claim job atomically — Bug #3 fix: WHERE status IN ('received','queued')
    let replyJob: import("../ledger/directMessageRepository.js").ReplyJob | null = null;
    let jobNotFound = false;
    try {
      const result = await this.database.transaction(this.workspaceId, async (client) => {
        const claimed = await this.dmRepo.claimReplyJob(client, this.workspaceId, replyJobId);
        if (claimed) return claimed;

        // Claim returned null: check why
        const existing = await this.dmRepo.getReplyJobById(client, this.workspaceId, replyJobId);
        return existing; // null if not found
      });
      if (result === null) {
        jobNotFound = true;
      } else {
        replyJob = result;
      }
    } catch (err: any) {
      this.logger.error("Failed to load/claim DM reply job in worker", { messageId, jobId: replyJobId, error: err.message });
      return { action: "nack_requeue", status: "db_error", error: err.message };
    }

    if (jobNotFound) {
      this.logger.error("DM reply job not found", { messageId, jobId: replyJobId });
      return { action: "nack_dlq", status: "job_not_found" };
    }

    // Bug #3 fix: if job already terminal, ACK (idempotent)
    if (replyJob!.status === "succeeded" || replyJob!.status === "failed") {
      this.logger.info("DM reply job already processed", { messageId, jobId: replyJob!.id, status: replyJob!.status });
      return { action: "ack", status: "already_processed" };
    }

    // Bug #3 fix: if claim returned null and job is still 'processing' by another consumer, nack_requeue
    if (replyJob!.status === "processing") {
      this.logger.warn("DM reply job already being processed by another consumer, requeueing", { messageId, jobId: replyJob!.id });
      return { action: "nack_requeue", status: "already_processing" };
    }

    // After all early returns, replyJob is guaranteed non-null and claimable
    const job = replyJob!;

    // 2. Load conversation (Bug #2 fix: reply_body comes from Ledger job, not queue message)
    let conversation;
    try {
      conversation = await this.database.transaction(this.workspaceId, async (client) => {
        return await this.dmRepo.getConversationById(client, this.workspaceId, job.conversation_id);
      });
    } catch (err: any) {
      this.logger.error("Failed to load conversation for DM reply job", { messageId, conversationId: job.conversation_id });
      return { action: "nack_requeue", status: "db_error", error: err.message };
    }

    if (!conversation) {
      this.logger.error("Conversation not found for DM reply job", { messageId, conversationId: job.conversation_id });
      await this.markJobFailed(job.id, "CONVERSATION_NOT_FOUND", "Conversation not found", message.correlation_id, job.actor_id);
      return { action: "ack", status: "conversation_not_found" };
    }

    // 3. Load secret_ref for the channel account (Bug #1 fix: use dbsecret ref, not env-based)
    let secretRef: string | null = null;
    try {
      const channelAccountRow = await this.database.getPool().query<{ secret_ref: string | null }>(
        `SELECT secret_ref FROM channel_accounts WHERE id = $1 AND workspace_id = $2 LIMIT 1`,
        [conversation.channel_account_id, this.workspaceId]
      );
      secretRef = channelAccountRow.rows[0]?.secret_ref ?? null;
    } catch (err: any) {
      this.logger.error("Failed to load secret_ref for DM reply", { messageId, conversationId: conversation.id });
      return { action: "nack_requeue", status: "db_error", error: err.message };
    }

    if (!secretRef) {
      const errMsg = "Channel account has no secret_ref configured";
      this.logger.error(errMsg, { messageId, channelAccountId: conversation.channel_account_id });
      await this.markJobFailed(job.id, "MISSING_SECRET_REF", errMsg, message.correlation_id, job.actor_id);
      return { action: "ack", status: "missing_secret_ref", error: errMsg };
    }

    // 4. Call MCP send_direct_message (Bug #2 fix: reply_body comes from replyJob loaded from Ledger, not queue payload)
    let mcpResult;
    try {
      mcpResult = await this.mcpClient.sendDirectMessage({
        channel_account_id: conversation.channel_account_id,
        external_thread_id: conversation.external_thread_id,
        reply_body: job.reply_body,
        idempotency_key: job.idempotency_key,
        secret_ref: secretRef
      });
    } catch (mcpError: any) {
      this.logger.error("MCP sendDirectMessage call failed", { messageId, error: mcpError.message });
      
      const errorMsg = String(redact(mcpError.message));
      const isTerminal = errorMsg.toLowerCase().includes("auth") ||
                         errorMsg.toLowerCase().includes("permission") ||
                         errorMsg.toLowerCase().includes("token") ||
                         errorMsg.toLowerCase().includes("not found");

      if (isTerminal) {
        await this.markJobFailed(job.id, "MCP_TERMINAL_ERROR", errorMsg, message.correlation_id, job.actor_id);
        await this.sendFailureSlackAlert(job.id, conversation.id, errorMsg, message.correlation_id);
        return { action: "ack", status: "mcp_terminal_error", error: errorMsg };
      }

      return { action: "nack_requeue", status: "mcp_transient_error", error: errorMsg };
    }

    if (!mcpResult.success) {
      const errorMsg = String(redact(mcpResult.error || "Unknown MCP send error"));
      await this.markJobFailed(job.id, "MCP_ERROR", errorMsg, message.correlation_id, job.actor_id);
      await this.sendFailureSlackAlert(job.id, conversation.id, errorMsg, message.correlation_id);
      return { action: "ack", status: "mcp_failed", error: errorMsg };
    }

    // 5. MCP success -> mark job succeeded, insert outbound message, update status to waiting
    try {
      await this.database.transaction(this.workspaceId, async (client) => {
        const { redactDmBodyForSlack } = await import("../lib/dmRedactor.js");
        const bodyRedacted = redactDmBodyForSlack(job.reply_body);
        const externalMsgId = mcpResult.external_message_id || `reply-msg-${job.idempotency_key}`;

        // Insert outbound message idempotently
        let insertedMsg = await this.dmRepo.insertMessageIdempotently(client, this.workspaceId, {
          conversationId: conversation.id,
          externalMessageId: externalMsgId,
          direction: "outbound",
          senderType: "agent",
          body: job.reply_body,
          bodyRedacted: bodyRedacted,
          attachmentsRef: [],
          createdAtPlatform: new Date()
        });

        // Bug #4 fix: if conflict (ON CONFLICT DO NOTHING), fetch existing message
        if (!insertedMsg) {
          const existing = await this.dmRepo.getMessageByExternalId(client, this.workspaceId, conversation.id, externalMsgId);
          insertedMsg = existing;
        }

        const messageId = insertedMsg?.id ?? null;

        // Mark job succeeded — only pass valid conversation_messages.id
        await this.dmRepo.markReplyJobSucceeded(
          client,
          this.workspaceId,
          job.id,
          messageId,
          { external_message_id: mcpResult.external_message_id }
        );

        // Update conversation status to waiting
        await this.dmRepo.updateConversationStatus(client, this.workspaceId, conversation.id, "waiting");

        // Audit success
        await this.dmRepo.insertAuditLog(client, {
          workspaceId: this.workspaceId,
          eventType: "DM_REPLY_SUCCEEDED",
          entityId: job.id,
          metadata: { conversationId: conversation.id, messageId },
          correlationId: message.correlation_id,
          actorId: job.actor_id
        });
      });
    } catch (err: any) {
      this.logger.error("Failed to commit successful DM reply state to Ledger", { messageId, error: err.message });
      return { action: "nack_requeue", status: "db_commit_error", error: err.message };
    }

    return { action: "ack", status: "succeeded" };
  }

  private async markJobFailed(jobId: string, errorCode: string, errorMessage: string, correlationId: string, actorId: string) {
    try {
      await this.database.transaction(this.workspaceId, async (client) => {
        await this.dmRepo.markReplyJobFailed(client, this.workspaceId, jobId, errorCode, errorMessage);
        await this.dmRepo.insertAuditLog(client, {
          workspaceId: this.workspaceId,
          eventType: "DM_REPLY_FAILED",
          entityId: jobId,
          metadata: { errorCode, errorMessage },
          correlationId,
          actorId
        });
      });
    } catch (err: any) {
      this.logger.error("Failed to mark DM reply job as failed in DB", { jobId, error: err.message });
    }
  }

  private async sendFailureSlackAlert(jobId: string, conversationId: string, errorMsg: string, correlationId: string) {
    if (!this.slackChannels.inboxChannelId) return;
    try {
      const text = `❌ *Direct Message Reply Failed*\n` +
                   `Job ID: \`${jobId}\`\n` +
                   `Conversation ID: \`${conversationId}\`\n` +
                   `Reason: \`${errorMsg.slice(0, 100)}\``;
      
      await this.publisher.publishSlackAlert(
        {
          event_id: `slack_alert_fail_${jobId}`,
          event_type: "alerts.slack.send",
          event_version: 1,
          workspace_id: this.workspaceId,
          channel_id: this.slackChannels.inboxChannelId,
          alert_type: "dm_reply_fail",
          severity: "error",
          entity_type: "dm_reply_job",
          entity_id: jobId,
          metadata: { jobId, conversationId, error: errorMsg },
          idempotency_key: `slack_alert:dm_fail:${jobId}`,
          correlation_id: correlationId
        },
        `slack_alert_fail_${jobId}`,
        correlationId
      );
    } catch (err: any) {
      this.logger.warn("Failed to publish DM reply failure Slack alert", { jobId, error: err.message });
    }
  }
}
