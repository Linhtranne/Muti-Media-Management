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

interface CommandEvent {
  id: string;
  target_post_id: string;
  slack_user_id: string;
  action: string;
  reason?: string | null;
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
      this.logger.error("Slack command message workspace mismatch", { messageId, message_workspace_id: message.workspace_id, worker_workspace_id: this.workspaceId });
      return { action: "nack_dlq", status: "workspace_mismatch" };
    }

    const loadResult = await this.loadCommandEvent(message.command_event_id, messageId);
    if ("status" in loadResult && !("id" in loadResult)) return loadResult as SlackPostApprovalWorkerResult;
    const commandEvent = loadResult as CommandEvent;

    if (commandEvent.status === "succeeded" || commandEvent.status === "failed") {
      this.logger.info("Slack command already processed", { messageId, status: commandEvent.status });
      return { action: "ack", status: "already_processed" };
    }

    if (commandEvent.action !== "approve" && commandEvent.action !== "reject") {
      this.logger.error("Invalid action in slack command event", { messageId, action: commandEvent.action });
      await this.markFailed(commandEvent.id, "INVALID_ACTION", `Action ${commandEvent.action} is not supported`, message.correlation_id, commandEvent.slack_user_id);
      return { action: "ack", status: "invalid_command" };
    }

    const validateResult = await this.validateAirtableState(commandEvent, messageId, message.correlation_id);
    if (validateResult) return validateResult;

    const updateResult = await this.updateAirtable(commandEvent, messageId);
    if (updateResult) return updateResult;

    await this.updateWorkflowRuns(commandEvent, messageId);

    return await this.commitSuccess(commandEvent, messageId, message.correlation_id);
  }

  private async loadCommandEvent(commandEventId: string, messageId: string) {
    try {
      const event = await this.database.transaction(this.workspaceId, async (client) => {
        return await this.repository.getEventById(client, this.workspaceId, commandEventId);
      });
      if (!event) {
        this.logger.error("Slack command event not found in DB", { messageId, commandEventId });
        return { action: "nack_dlq", status: "event_not_found" };
      }
      return event;
    } catch (error) {
      this.logger.error("Slack command worker failed to load event state", { messageId, error: String(redact(String(error))) });
      return { action: "nack_requeue", status: "db_error" };
    }
  }

  private async validateAirtableState(commandEvent: CommandEvent, messageId: string, correlationId: string): Promise<SlackPostApprovalWorkerResult | null> {
    let recordStatus: string;
    try {
      const record = await this.airtableClient.getPostRecord(commandEvent.target_post_id);
      recordStatus = (record.fields as { status?: string }).status ?? "";
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "AirtableRecordNotFoundError") {
        await this.markFailed(commandEvent.id, "UNKNOWN_POST", "Post not found in Airtable", correlationId, commandEvent.slack_user_id);
        return { action: "ack", status: "unknown_post" };
      }
      this.logger.error("Slack command worker failed to read from Airtable", { messageId, error: String(redact(String(error))) });
      return { action: "nack_requeue", status: "airtable_read_error" };
    }

    if (recordStatus !== "Review" && recordStatus !== "Draft" && recordStatus !== "Needs Review") {
      await this.markFailed(commandEvent.id, "POST_NOT_REVIEWABLE", `Post is in ${recordStatus} state and cannot be approved/rejected via Slack`, correlationId, commandEvent.slack_user_id);
      return { action: "ack", status: "post_not_reviewable" };
    }
    return null;
  }

  private async updateAirtable(commandEvent: CommandEvent, messageId: string): Promise<SlackPostApprovalWorkerResult | null> {
    try {
      if (commandEvent.action === "approve") {
        await this.airtableClient.updateRecordStatus(this.workspaceId, commandEvent.target_post_id, "Approved");
      } else {
        if (!this.airtableClient.updatePostApprovalStatus) {
          throw new Error("Airtable updatePostApprovalStatus is not configured");
        }
        await this.airtableClient.updatePostApprovalStatus(commandEvent.target_post_id, "Review", commandEvent.reason || null, this.rejectReasonField);
      }
      return null;
    } catch (error: unknown) {
      this.logger.error("Slack command worker failed to update Airtable", { messageId, error: String(redact(String(error))) });
      return { action: "nack_requeue", status: "airtable_update_error" };
    }
  }

  private async updateWorkflowRuns(commandEvent: CommandEvent, messageId: string): Promise<void> {
    try {
      await this.database.transaction(this.workspaceId, async (client) => {
        const wfStatus = commandEvent.action === "approve" ? "completed" : "cancelled";
        await client.query(
          `UPDATE workflow_runs SET status = $1, updated_at = NOW() WHERE workspace_id = $2 AND id = (SELECT workflow_run_id FROM content_variants WHERE post_id = $3 OR airtable_record_id = $3 LIMIT 1) AND status NOT IN ('completed', 'failed', 'cancelled')`,
          [wfStatus, this.workspaceId, commandEvent.target_post_id]
        );
      });
    } catch (error) {
      this.logger.error("Slack command worker failed to update workflow_runs", { messageId, error: String(redact(String(error))) });
    }
  }

  private async commitSuccess(commandEvent: CommandEvent, messageId: string, correlationId: string): Promise<SlackPostApprovalWorkerResult> {
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
          correlationId
        });
      });
      return { action: "ack", status: "succeeded" };
    } catch (error) {
      this.logger.error("Slack command worker failed to commit success to Ledger", { messageId, error: String(redact(String(error))) });
      const compensationRecorded = await this.markAirtableAppliedButLedgerCommitFailed(commandEvent.id, correlationId, commandEvent.slack_user_id, error);
      if (compensationRecorded) return { action: "ack", status: "airtable_applied_ledger_compensated" };
      return { action: "nack_requeue", status: "db_commit_error" };
    }
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

  private async markAirtableAppliedButLedgerCommitFailed(
    eventId: string,
    correlationId: string,
    slackUserId: string,
    error: unknown
  ): Promise<boolean> {
    try {
      await this.database.transaction(this.workspaceId, async (client) => {
        await this.repository.markAirtableSyncRetryNeeded(client, eventId);
        await this.repository.updateEventStatus(
          client,
          eventId,
          "failed",
          "LEDGER_COMMIT_AFTER_AIRTABLE_FAILED",
          "Airtable update was applied but final Ledger commit failed"
        );
        await this.repository.insertAuditLog(client, {
          workspaceId: this.workspaceId,
          eventType: "SLACK_COMMAND_COMPENSATION_RECORDED",
          entityType: "slack_command",
          entityId: eventId,
          actorId: slackUserId,
          metadata: {
            errorCode: "LEDGER_COMMIT_AFTER_AIRTABLE_FAILED",
            error: String(redact(String(error)))
          },
          correlationId
        });
      });
      return true;
    } catch (compensationError) {
      this.logger.error("Slack command worker failed to record Airtable/Ledger compensation", {
        eventId,
        error: String(redact(String(compensationError)))
      });
      return false;
    }
  }
}

