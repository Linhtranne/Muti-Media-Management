import {
  type AirtableApprovedQueueMessage,
  type WebhookEventStatus,
  createAiIdempotencyKey
} from "@mediaops/shared-contracts";
import type { AirtableClient } from "../airtable/airtableClient.js";
import {
  AirtableRateLimitError,
  AirtableServiceError,
  AirtableRecordNotFoundError,
  AirtableNetworkError
} from "../airtable/airtableClient.js";
import type { Database } from "../ledger/postgres.js";
import { WorkerRepository } from "../ledger/workerRepository.js";
import { ChannelAccountResolver } from "../services/channelAccountResolver.js";
import type { Logger } from "../lib/logger.js";
import type { QueuePublisher } from "../queue/rabbitmqPublisher.js";

export interface WorkerResult {
  action: "ack" | "nack_requeue" | "nack_dlq";
  status: WebhookEventStatus;
  approvedVersion?: number;
}

export class ApprovedPostWorker {
  private readonly repository = new WorkerRepository();
  private readonly resolver: ChannelAccountResolver;

  constructor(
    private readonly database: Database,
    private readonly airtableClient: AirtableClient,
    private readonly logger: Logger,
    private readonly workspaceId: string,
    private readonly queuePublisher?: Pick<QueuePublisher, "publishAiComposerRequest">,
    private readonly promptVersion = "fb_composer_v1.0.0"
  ) {
    this.resolver = new ChannelAccountResolver(this.logger);
  }

  async process(message: AirtableApprovedQueueMessage, messageId: string): Promise<WorkerResult> {
    const { event_id, record_ref, approval_ref, workspace_id } = message;

    this.logger.info("Worker processing message", {
      event_id,
      record_ref,
      message_id: messageId
    });

    // ──────────────────────────────────────────────
    // 1. Fast-Pass Check
    // ──────────────────────────────────────────────
    const fastPass = await this.database.transaction(workspace_id, async (client) => {
      return this.repository.fastPassCheck(client, event_id);
    });

    if (fastPass.isFinalized && fastPass.webhookEventId) {
      this.logger.info("Fast-pass: event already finalized, redelivery ACK", {
        event_id,
        current_status: fastPass.currentStatus
      });

      await this.database.transaction(workspace_id, async (client) => {
        await this.repository.markRedeliveryAcked(client, fastPass.webhookEventId!, messageId, workspace_id);
      });

      return { action: "ack", status: fastPass.currentStatus! };
    }

    // ──────────────────────────────────────────────
    // 2. Transaction A: Mark Processing
    // ──────────────────────────────────────────────
    const txA = await this.database.transaction(workspace_id, async (client) => {
      return this.repository.markProcessing(client, event_id, messageId, workspace_id);
    });

    const { webhookEventId } = txA;

    // ──────────────────────────────────────────────
    // 3. Airtable Reload (Zero-Trust Pull)
    // ──────────────────────────────────────────────
    let reloadedRecord;
    try {
      reloadedRecord = await this.airtableClient.getPostRecord(record_ref);
    } catch (error: unknown) {
      if (error instanceof AirtableRecordNotFoundError) {
        // Terminal: record deleted in Airtable
        await this.database.transaction(workspace_id, async (client) => {
          await this.repository.markIgnored(
            client, webhookEventId, "failed", messageId, workspace_id,
            "ERR_RECORD_NOT_FOUND", `Record ${record_ref} not found in Airtable (HTTP 404)`
          );
        });
        this.logger.warn("Airtable record not found, marking failed", { event_id, record_ref });
        return { action: "nack_dlq", status: "failed" as WebhookEventStatus };
      }

      if (
        error instanceof AirtableRateLimitError ||
        error instanceof AirtableServiceError ||
        error instanceof AirtableNetworkError
      ) {
        // Transient: eligible for retry
        await this.database.transaction(workspace_id, async (client) => {
          await this.repository.markRetryableFailed(
            client, webhookEventId, messageId, workspace_id,
            `ERR_AIRTABLE_${error.name.toUpperCase()}`,
            error.message
          );
        });
        this.logger.warn("Airtable transient error, marking retryable", { event_id, error_name: (error as Error).name });
        return { action: "nack_requeue", status: "retryable_failed" as WebhookEventStatus };
      }

      // Unknown error: treat as retryable
      await this.database.transaction(workspace_id, async (client) => {
        await this.repository.markRetryableFailed(
          client, webhookEventId, messageId, workspace_id,
          "ERR_AIRTABLE_UNKNOWN", "Unknown Airtable error"
        );
      });
      return { action: "nack_requeue", status: "retryable_failed" as WebhookEventStatus };
    }

    const fields = reloadedRecord.fields;
    const reloadedStatus = fields.status ?? "";

    // ──────────────────────────────────────────────
    // 4. Status Reverification
    // ──────────────────────────────────────────────
    if (reloadedStatus === "Scheduled" || reloadedStatus === "Published") {
      return this.classifyAndAck(
        webhookEventId, "already_advanced_ignored", messageId, workspace_id, event_id,
        "STATUS_ALREADY_ADVANCED", `Record status is '${reloadedStatus}', already past Approved`
      );
    }

    if (reloadedStatus === "Draft" || reloadedStatus === "Review" || reloadedStatus === "Failed") {
      return this.classifyAndAck(
        webhookEventId, "state_changed_ignored", messageId, workspace_id, event_id,
        "STATUS_STATE_CHANGED", `Record status reverted to '${reloadedStatus}'`
      );
    }

    if (reloadedStatus !== "Approved") {
      return this.classifyAndAck(
        webhookEventId, "unknown_status_ignored", messageId, workspace_id, event_id,
        "STATUS_UNKNOWN", `Record has unknown status '${reloadedStatus}'`
      );
    }

    // ──────────────────────────────────────────────
    // 5. Approval Validity Checks
    // ──────────────────────────────────────────────

    // 5a. is_valid_for_approval
    if (fields.is_valid_for_approval !== 1) {
      return this.classifyAndAck(
        webhookEventId, "invalid_after_reload_ignored", messageId, workspace_id, event_id,
        "INVALID_FOR_APPROVAL", `is_valid_for_approval = ${fields.is_valid_for_approval ?? "null"}`
      );
    }

    // 5b. scheduled_at must be in the future
    if (fields.scheduled_at) {
      const scheduledTime = new Date(fields.scheduled_at);
      if (scheduledTime <= new Date()) {
        return this.classifyAndAck(
          webhookEventId, "invalid_after_reload_ignored", messageId, workspace_id, event_id,
          "SCHEDULED_IN_PAST", "scheduled_at is in the past"
        );
      }
    }

    // 5c. master_copy must exist (existence check only, value NEVER logged)
    if (!fields.master_copy) {
      return this.classifyAndAck(
        webhookEventId, "invalid_after_reload_ignored", messageId, workspace_id, event_id,
        "MASTER_COPY_EMPTY", "master_copy field is empty or missing"
      );
    }

    // ──────────────────────────────────────────────
    // 6. Approval Reference Check (Out-of-Order Protection)
    // ──────────────────────────────────────────────
    if (fields.approved_at !== approval_ref) {
      return this.classifyAndAck(
        webhookEventId, "approval_version_mismatch_ignored", messageId, workspace_id, event_id,
        "APPROVAL_REF_MISMATCH",
        `Reloaded approved_at does not match ingress approval_ref`
      );
    }

    // ──────────────────────────────────────────────
    // 7. Channel Account Resolution (T-008)
    // ──────────────────────────────────────────────
    const resolverResult = await this.database.transaction(workspace_id, async (client) => {
      // Parse account stubs from connected_channel_accounts (record IDs only from reload)
      const stubs = (fields.connected_channel_accounts ?? []).map(recId => ({
        airtable_channel_account_record_id: recId,
        platform: "Facebook",
        display_name: "Unknown",
        status: "Connected"
      }));

      return this.resolver.resolve(
        client,
        workspace_id,
        fields.target_channels,
        fields.connected_channel_accounts,
        stubs
      );
    });

    if (resolverResult.outcome !== "success") {
      const resolverStatus = resolverResult.outcome as WebhookEventStatus;

      if (resolverStatus === "channel_account_unresolved") {
        await this.database.transaction(workspace_id, async (client) => {
          await this.repository.markIgnored(
            client, webhookEventId, resolverStatus, messageId, workspace_id,
            "ERR_CHANNEL_UNRESOLVED", resolverResult.reason
          );
        });
        this.logger.warn("Channel account unresolved, routing to DLQ", { event_id });
        return { action: "nack_dlq", status: resolverStatus };
      }

      // channel_account_missing or channel_account_inactive → ACK
      return this.classifyAndAck(
        webhookEventId, resolverStatus, messageId, workspace_id, event_id,
        `ERR_${resolverStatus.toUpperCase()}`, resolverResult.reason
      );
    }

    // ──────────────────────────────────────────────
    // 8. Transaction B: Version Allocation + Workflow Stub
    // ──────────────────────────────────────────────
    const txB = await this.database.transaction(workspace_id, async (client) => {
      return this.repository.allocateVersionAndCreateWorkflow(client, {
        workspaceId: workspace_id,
        recordRef: record_ref,
        webhookEventId,
        messageId
      });
    });

    if (txB.duplicate) {
      this.logger.info("Duplicate version allocation detected, ACK", {
        event_id,
        approved_version: txB.approvedVersion
      });

      await this.database.transaction(workspace_id, async (client) => {
        await this.repository.markIgnored(
          client, webhookEventId, "duplicate_ignored", messageId, workspace_id,
          "DUPLICATE_VERSION", `Version ${txB.approvedVersion} already allocated`
        );
      });

      return { action: "ack", status: "duplicate_ignored" as WebhookEventStatus };
    }

    this.logger.info("Workflow stub created successfully", {
      event_id,
      record_ref,
      approved_version: txB.approvedVersion,
      workflow_run_id: txB.workflowRunId
    });

    if (this.queuePublisher && txB.workflowRunId) {
      const aiMessage = {
        event_id: `evt_ai_${txB.workflowRunId}`,
        event_type: "ai.compose.facebook.requested" as const,
        event_version: 1 as const,
        source: "orchestrator.workflow_runs" as const,
        workspace_id,
        workflow_run_id: txB.workflowRunId,
        prompt_version: this.promptVersion,
        idempotency_key: createAiIdempotencyKey({
          workspaceId: workspace_id,
          workflowRunId: txB.workflowRunId,
          promptVersion: this.promptVersion
        }),
        correlation_id: message.correlation_id,
        causation_id: event_id
      };

      await this.queuePublisher.publishAiComposerRequest(aiMessage, aiMessage.event_id);
    }

    return {
      action: "ack",
      status: "workflow_stub_created" as WebhookEventStatus,
      approvedVersion: txB.approvedVersion
    };
  }

  /**
   * Helper: classify event as ignored/terminal, write to Ledger, and return ACK.
   */
  private async classifyAndAck(
    webhookEventId: string,
    status: WebhookEventStatus,
    messageId: string,
    workspaceId: string,
    eventId: string,
    errorCode: string,
    errorMessage: string
  ): Promise<WorkerResult> {
    await this.database.transaction(workspaceId, async (client) => {
      await this.repository.markIgnored(
        client, webhookEventId, status, messageId, workspaceId,
        errorCode, errorMessage
      );
    });

    this.logger.info("Event classified and ACKed", {
      event_id: eventId,
      status,
      error_code: errorCode
    });

    return { action: "ack", status };
  }
}
