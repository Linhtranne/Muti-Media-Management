import type { AirtableClient } from "../airtable/airtableClient.js";
import type { Database } from "../ledger/postgres.js";
import type { SlackCommandRepository } from "../ledger/slackCommandRepository.js";
import type { Logger } from "../lib/logger.js";
import { redact } from "../lib/redact.js";
import type { SlackCommandActionEvent } from "@mediaops/shared-contracts";

export interface SlackPostApprovalWorkerResult {
  action: "ack" | "nack_requeue" | "nack_dlq";
  status: string;
}

export class SlackPostApprovalWorker {
  constructor(
    private readonly database: Database,
    private readonly repository: SlackCommandRepository,
    private readonly airtableClient: AirtableClient,
    private readonly logger: Logger,
    private readonly workspaceId: string,
    private readonly rejectReasonField = "rejection_reason"
  ) {}

  async processQueueMessage(message: SlackCommandActionEvent, messageId: string): Promise<SlackPostApprovalWorkerResult> {
    if (message.workspace_id !== this.workspaceId) {
      this.logger.error("Slack command message workspace mismatch", {
        messageId,
        message_workspace_id: message.workspace_id,
        worker_workspace_id: this.workspaceId
      });
      return { action: "nack_dlq", status: "workspace_mismatch" };
    }

    // 1. Idempotency & DB State check
    let commandEvent;
    try {
      commandEvent = await this.database.transaction(this.workspaceId, async (client) => {
        return await this.repository.getEventById(client, this.workspaceId, message.command_event_id);
      });
    } catch (error) {
      this.logger.error("Slack command worker failed to load event state", {
        messageId,
        error: String(redact(String(error)))
      });
      return { action: "nack_requeue", status: "db_error" };
    }

    if (!commandEvent) {
      this.logger.error("Slack command event not found in DB", { messageId, commandEventId: message.command_event_id });
      return { action: "nack_dlq", status: "event_not_found" };
    }

    if (commandEvent.status === "succeeded" || commandEvent.status === "failed") {
      this.logger.info("Slack command already processed", { messageId, status: commandEvent.status });
      return { action: "ack", status: "already_processed" };
    }

    // 2. Validate state in Airtable
    let recordStatus: string;
    try {
      const record = await this.airtableClient.getPostRecord(commandEvent.target_post_id);
      recordStatus = record.fields.status ?? "";
    } catch (error: unknown) {
      const isNotFound = error instanceof Error && error.name === "AirtableRecordNotFoundError";
      if (isNotFound) {
        await this.markFailed(commandEvent.id, "UNKNOWN_POST", "Post not found in Airtable", message.correlation_id, commandEvent.slack_user_id);
        return { action: "ack", status: "unknown_post" };
      }
      
      this.logger.error("Slack command worker failed to read from Airtable", {
        messageId,
        error: String(redact(String(error)))
      });
      return { action: "nack_requeue", status: "airtable_read_error" };
    }

    // For MVP, we only allow approve/reject if status is Review or Draft.
    if (recordStatus !== "Review" && recordStatus !== "Draft" && recordStatus !== "Needs Review") {
      await this.markFailed(commandEvent.id, "POST_NOT_REVIEWABLE", `Post is in ${recordStatus} state and cannot be approved/rejected via Slack`, message.correlation_id, commandEvent.slack_user_id);
      return { action: "ack", status: "post_not_reviewable" };
    }

    // 3. Perform the Airtable Update
    const rejectionReason = commandEvent.action === "reject" ? commandEvent.reason : null;

    try {
      if (commandEvent.action === "approve") {
        await this.airtableClient.updateRecordStatus(this.workspaceId, commandEvent.target_post_id, "Approved");
      } else {
        if (!this.airtableClient.updatePostApprovalStatus) {
          throw new Error("Airtable updatePostApprovalStatus is not configured");
        }
        await this.airtableClient.updatePostApprovalStatus(
          commandEvent.target_post_id,
          "Review", // Revert to Review or keep it in Review
          rejectionReason,
          this.rejectReasonField
        );
      }
    } catch (error: unknown) {
      this.logger.error("Slack command worker failed to update Airtable", {
        messageId,
        error: String(redact(String(error)))
      });
      return { action: "nack_requeue", status: "airtable_update_error" };
    }

    // 4. Update workflow_runs if possible (OQ-008-4)
    // We update the workflow_run to 'completed' or 'cancelled' if we can find one.
    // For MVP, this is done by a simple update query. We just ignore if not found.
    try {
      await this.database.transaction(this.workspaceId, async (client) => {
        const wfStatus = commandEvent.action === "approve" ? "completed" : "cancelled";
        await client.query(
          `UPDATE workflow_runs 
           SET status = $1, updated_at = NOW() 
           WHERE workspace_id = $2 AND id = (
             SELECT workflow_run_id FROM content_variants WHERE post_id = $3 OR airtable_record_id = $3 LIMIT 1
           ) AND status NOT IN ('completed', 'failed', 'cancelled')`,
          [wfStatus, this.workspaceId, commandEvent.target_post_id]
        );
      });
    } catch (error) {
      this.logger.error("Slack command worker failed to update workflow_runs", {
        messageId,
        error: String(redact(String(error)))
      });
      // We don't fail the message if workflow_runs update fails, just log it.
    }

    // 5. Final Commit to Ledger (Success)
    try {
      await this.database.transaction(this.workspaceId, async (client) => {
        await this.repository.updateEventStatus(client, commandEvent.id, "succeeded");
        await this.repository.insertAuditLog(client, {
          workspaceId: this.workspaceId,
          eventType: "SLACK_COMMAND_SUCCEEDED",
          entityType: "slack_command",
          entityId: commandEvent.id,
          actorId: commandEvent.slack_user_id,
          metadata: { action: commandEvent.action, targetPostId: commandEvent.target_post_id },
          correlationId: message.correlation_id
        });
      });
    } catch (error) {
      this.logger.error("Slack command worker failed to commit success to Ledger", {
        messageId,
        error: String(redact(String(error)))
      });
      
      // If DB commit fails after Airtable update, we have a consistency issue.
      // We will requeue, but idempotency check might try to update Airtable again.
      // That's acceptable since Airtable update is idempotent.
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
          eventType: "SLACK_COMMAND_FAILED",
          entityType: "slack_command",
          entityId: eventId,
          actorId: slackUserId,
          metadata: { errorCode, message },
          correlationId
        });
      });
    } catch (e) {
      this.logger.error("Slack command worker failed to write failure status to DB", {
        eventId,
        error: String(redact(String(e)))
      });
    }
  }
}
