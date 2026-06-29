import { type DirectMessageIngestEvent } from "@mediaops/shared-contracts";
import { type DirectMessageRepository } from "../ledger/directMessageRepository.js";
import { type QueuePublisher } from "../queue/rabbitmqPublisher.js";
import { type FacebookMcpClient } from "../mcp/facebookMcpClient.js";
import { type Database } from "../ledger/postgres.js";
import { checkIdempotency, markIdempotencySucceeded } from "../queue/idempotencyGuard.js";
import { type Logger } from "../lib/logger.js";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const MILLISECONDS_PER_SECOND = 1000;

export interface IngestWorkerResult {
  action: "ack" | "nack_requeue" | "nack_dlq";
  status: string;
  error?: string;
}

export class DirectMessageIngestWorker {
  constructor(
    private readonly database: Database,
    private readonly dmRepo: DirectMessageRepository,
    private readonly publisher: QueuePublisher,
    private readonly mcpClient: FacebookMcpClient,
    private readonly logger: Logger,
    private readonly workspaceId: string,
    private readonly slackChannels: { inboxChannelId?: string } = {},
    private readonly config: { dmSlaHours?: number } = {}
  ) {}

  async processIngestEvent(event: DirectMessageIngestEvent, messageId: string): Promise<IngestWorkerResult> {
    if (event.workspace_id !== this.workspaceId) {
      this.logger.error("Workspace mismatch in DM Ingest", {
        messageId,
        messageWorkspaceId: event.workspace_id,
        workerWorkspaceId: this.workspaceId
      });
      return { action: "nack_dlq", status: "workspace_mismatch" };
    }

    // 1. Idempotency Check (using pool)
    const check = await checkIdempotency(
      this.database.getPool(),
      {
        eventId: event.event_id,
        idempotencyKey: event.idempotency_key,
        workspaceId: event.workspace_id,
        eventType: event.event_type,
        queueName: "dm.facebook.ingest"
      },
      this.logger
    );

    if (check.isDuplicate) {
      // Duplicate succeeded -> audit DM_DUPLICATE_IGNORED, ACK
      await this.dmRepo.insertAuditLog(this.database.getPool(), {
        workspaceId: event.workspace_id,
        eventType: "DM_DUPLICATE_IGNORED",
        entityId: event.payload.external_message_id,
        metadata: { reason: "Idempotency check duplicate", idempotencyKey: event.idempotency_key },
        correlationId: event.correlation_id
      });
      return { action: "ack", status: "duplicate_ignored" };
    }

    // 2. Load channel_account secret_ref from Ledger, then call MCP get_direct_message
    let mcpResult;
    try {
      // Lookup secret_ref for the channel account
      const channelAccountRow = await this.database.getPool().query<{ secret_ref: string | null }>(
        `SELECT secret_ref FROM channel_accounts WHERE id = $1 AND workspace_id = $2 LIMIT 1`,
        [event.payload.channel_account_id, event.workspace_id]
      );
      const secretRef = channelAccountRow.rows[0]?.secret_ref;
      if (!secretRef) {
        this.logger.error("No secret_ref found for channel_account in DM Ingest", {
          messageId,
          channelAccountId: event.payload.channel_account_id
        });
        return { action: "nack_dlq", status: "missing_secret_ref", error: "Channel account has no secret_ref" };
      }

      mcpResult = await this.mcpClient.getDirectMessage({
        channel_account_id: event.payload.channel_account_id,
        external_thread_id: event.payload.external_thread_id,
        external_message_id: event.payload.external_message_id,
        secret_ref: secretRef
      });
    } catch (mcpError: unknown) {
      const errorMessage = getErrorMessage(mcpError);
      this.logger.error("MCP get_direct_message call failed in DM Ingest worker", {
        messageId,
        error: errorMessage
      });

      // Audit DM_INGEST_FAILED
      await this.dmRepo.insertAuditLog(this.database.getPool(), {
        workspaceId: event.workspace_id,
        eventType: "DM_INGEST_FAILED",
        entityId: event.payload.external_message_id,
        metadata: { reason: "MCP get_direct_message call failed", error: errorMessage },
        correlationId: event.correlation_id
      });

      const isTerminal = errorMessage.includes("not found") || errorMessage.includes("validation");
      return {
        action: isTerminal ? "nack_dlq" : "nack_requeue",
        status: "mcp_failed",
        error: errorMessage
      };
    }

    // 3. Begin DB transaction, set workspace context, upsert conversation, and insert message
    let isNewMessage = false;
    try {
      await this.database.transaction(event.workspace_id, async (client) => {
        // Compute sla_due_at (fallback 2 hours)
        const slaHours = this.config.dmSlaHours ?? 2;
        const slaDueAt = new Date(Date.now() + slaHours * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND);

        // Upsert conversation
        const conversation = await this.dmRepo.upsertConversation(client, event.workspace_id, {
          platform: event.payload.platform,
          channelAccountId: event.payload.channel_account_id,
          externalThreadId: event.payload.external_thread_id,
          customerRef: event.payload.customer_ref,
          customerDisplayName: event.payload.customer_ref.name,
          status: "new",
          lastMessageAt: new Date(event.payload.created_at_platform),
          slaDueAt: slaDueAt
        });

        // Insert message
        const insertedMsg = await this.dmRepo.insertMessageIdempotently(client, event.workspace_id, {
          conversationId: conversation.id,
          externalMessageId: event.payload.external_message_id,
          direction: "inbound",
          senderType: "customer",
          body: mcpResult.body,
          bodyRedacted: mcpResult.body_redacted,
          attachmentsRef: mcpResult.attachments_ref,
          createdAtPlatform: new Date(mcpResult.created_at_platform)
        });

        if (insertedMsg) {
          isNewMessage = true;
          // Audit DM_RECEIVED and DM_INGESTED
          await this.dmRepo.insertAuditLog(client, {
            workspaceId: event.workspace_id,
            eventType: "DM_RECEIVED",
            entityId: event.payload.external_message_id,
            metadata: { platform: event.payload.platform, externalThreadId: event.payload.external_thread_id },
            correlationId: event.correlation_id
          });
          await this.dmRepo.insertAuditLog(client, {
            workspaceId: event.workspace_id,
            eventType: "DM_INGESTED",
            entityId: event.payload.external_message_id,
            metadata: { messageId: insertedMsg.id, conversationId: conversation.id },
            correlationId: event.correlation_id
          });
        }
      });
    } catch (dbError: unknown) {
      const errorMessage = getErrorMessage(dbError);
      this.logger.error("Database transaction failed in DM Ingest worker", {
        messageId,
        error: errorMessage
      });
      return {
        action: "nack_requeue",
        status: "db_transaction_failed",
        error: errorMessage
      };
    }

    // 4. Slack Inbox Alert if new message
    if (isNewMessage && this.slackChannels.inboxChannelId) {
      try {
        const { redactDmBodyForSlack } = await import("../lib/dmRedactor.js");
        const bodyRedacted = redactDmBodyForSlack(mcpResult.body_redacted);
        await this.publisher.publishSlackAlert(
          {
            event_id: `slack_alert_${event.event_id}`,
            event_type: "alerts.slack.send",
            event_version: 1,
            workspace_id: event.workspace_id,
            channel_id: this.slackChannels.inboxChannelId,
            alert_type: "dm_inbound",
            severity: "info",
            entity_type: "direct_message",
            entity_id: event.payload.external_message_id,
            metadata: {
              platform: event.payload.platform,
              body_preview: bodyRedacted,
              customer_name: event.payload.customer_ref.name,
              external_thread_id: event.payload.external_thread_id
            },
            idempotency_key: `slack_alert:dm:${event.payload.external_message_id}`,
            correlation_id: event.correlation_id,
            causation_id: event.event_id
          },
          `slack_alert_${event.event_id}`,
          event.correlation_id
        );
      } catch (slackError: unknown) {
        this.logger.warn("Failed to publish Slack inbox alert in DM Ingest worker", {
          messageId,
          error: getErrorMessage(slackError)
        });
      }
    }

    // 5. Mark idempotency as succeeded
    await markIdempotencySucceeded(
      this.database.getPool(),
      event.workspace_id,
      event.idempotency_key,
      this.logger
    ).catch((err) => {
      this.logger.warn("Failed to mark idempotency succeeded in DM Ingest worker", { error: String(err) });
    });

    return { action: "ack", status: "ingested" };
  }
}
