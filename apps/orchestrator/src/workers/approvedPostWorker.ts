import {
  type AirtableApprovedQueueMessage,
  type WebhookEventStatus,
  type AirtableReloadedRecord,
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

    this.logger.info("Worker processing message", { event_id, record_ref, message_id: messageId });

    const fastPass = await this.database.transaction(workspace_id, async (client) => {
      return this.repository.fastPassCheck(client, event_id);
    });

    if (fastPass.isFinalized && fastPass.webhookEventId) {
      this.logger.info("Fast-pass: event already finalized, redelivery ACK", { event_id, current_status: fastPass.currentStatus });
      await this.database.transaction(workspace_id, async (client) => {
        await this.repository.markRedeliveryAcked(client, fastPass.webhookEventId!, messageId, workspace_id);
      });
      return { action: "ack", status: fastPass.currentStatus! };
    }

    const txA = await this.database.transaction(workspace_id, async (client) => {
      return this.repository.markProcessing(client, event_id, messageId, workspace_id);
    });

    const { webhookEventId } = txA;

    const { reloadedRecord, errorResult } = await this.handleAirtableReload(record_ref, webhookEventId, messageId, workspace_id, event_id);
    if (errorResult || !reloadedRecord) return errorResult!;

    const statusError = await this.verifyStatusAndValidity(reloadedRecord.fields, approval_ref, webhookEventId, messageId, workspace_id, event_id);
    if (statusError) return statusError;

    const resolverError = await this.resolveChannelAccountSafe(reloadedRecord.fields, webhookEventId, messageId, workspace_id, event_id);
    if (resolverError) return resolverError;

    return await this.allocateAndPublish(message, webhookEventId, messageId);
  }

  private async handleAirtableReload(recordRef: string, webhookEventId: string, messageId: string, workspaceId: string, eventId: string): Promise<{ reloadedRecord?: AirtableReloadedRecord, errorResult?: WorkerResult }> {
    try {
      const reloadedRecord = await this.airtableClient.getPostRecord(recordRef);
      return { reloadedRecord };
    } catch (error: unknown) {
      if (error instanceof AirtableRecordNotFoundError) {
        await this.database.transaction(workspaceId, async (client) => {
          await this.repository.markIgnored(client, webhookEventId, "failed", messageId, workspaceId, "ERR_RECORD_NOT_FOUND", `Record ${recordRef} not found in Airtable (HTTP 404)`);
        });
        this.logger.warn("Airtable record not found, marking failed", { event_id: eventId, record_ref: recordRef });
        return { errorResult: { action: "nack_dlq", status: "failed" } };
      }

      if (error instanceof AirtableRateLimitError || error instanceof AirtableServiceError || error instanceof AirtableNetworkError) {
        await this.database.transaction(workspaceId, async (client) => {
          await this.repository.markRetryableFailed(client, webhookEventId, messageId, workspaceId, `ERR_AIRTABLE_${error.name.toUpperCase()}`, error.message);
        });
        this.logger.warn("Airtable transient error, marking retryable", { event_id: eventId, error_name: (error as Error).name });
        return { errorResult: { action: "nack_requeue", status: "retryable_failed" } };
      }

      await this.database.transaction(workspaceId, async (client) => {
        await this.repository.markRetryableFailed(client, webhookEventId, messageId, workspaceId, "ERR_AIRTABLE_UNKNOWN", "Unknown Airtable error");
      });
      return { errorResult: { action: "nack_requeue", status: "retryable_failed" } };
    }
  }

  private async verifyStatusAndValidity(fields: AirtableReloadedRecord["fields"], approvalRef: string, webhookEventId: string, messageId: string, workspaceId: string, eventId: string): Promise<WorkerResult | null> {
    const reloadedStatus = fields.status ?? "";

    if (reloadedStatus === "Scheduled" || reloadedStatus === "Published") {
      return this.classifyAndAck(webhookEventId, "already_advanced_ignored", messageId, workspaceId, eventId, "STATUS_ALREADY_ADVANCED", `Record status is '${reloadedStatus}', already past Approved`);
    }

    if (reloadedStatus === "Draft" || reloadedStatus === "Review" || reloadedStatus === "Failed") {
      return this.classifyAndAck(webhookEventId, "state_changed_ignored", messageId, workspaceId, eventId, "STATUS_STATE_CHANGED", `Record status reverted to '${reloadedStatus}'`);
    }

    if (reloadedStatus !== "Approved") {
      return this.classifyAndAck(webhookEventId, "unknown_status_ignored", messageId, workspaceId, eventId, "STATUS_UNKNOWN", `Record has unknown status '${reloadedStatus}'`);
    }

    if (fields.is_valid_for_approval !== 1) {
      return this.classifyAndAck(webhookEventId, "invalid_after_reload_ignored", messageId, workspaceId, eventId, "INVALID_FOR_APPROVAL", `is_valid_for_approval = ${fields.is_valid_for_approval ?? "null"}`);
    }

    if (fields.scheduled_at) {
      const scheduledTime = new Date(fields.scheduled_at);
      if (scheduledTime <= new Date()) {
        return this.classifyAndAck(webhookEventId, "invalid_after_reload_ignored", messageId, workspaceId, eventId, "SCHEDULED_IN_PAST", "scheduled_at is in the past");
      }
    }

    if (!fields.master_copy) {
      return this.classifyAndAck(webhookEventId, "invalid_after_reload_ignored", messageId, workspaceId, eventId, "MASTER_COPY_EMPTY", "master_copy field is empty or missing");
    }

    if (fields.approved_at !== approvalRef) {
      return this.classifyAndAck(webhookEventId, "approval_version_mismatch_ignored", messageId, workspaceId, eventId, "APPROVAL_REF_MISMATCH", `Reloaded approved_at does not match ingress approval_ref`);
    }

    return null;
  }

  private async resolveChannelAccountSafe(fields: AirtableReloadedRecord["fields"], webhookEventId: string, messageId: string, workspaceId: string, eventId: string): Promise<WorkerResult | null> {
    const resolverResult = await this.database.transaction(workspaceId, async (client) => {
      const stubs = (fields.connected_channel_accounts ?? []).map((recId: string) => ({
        airtable_channel_account_record_id: recId,
        platform: "Facebook",
        display_name: "Unknown",
        status: "Connected"
      }));

      return this.resolver.resolve(client, workspaceId, fields.target_channels, fields.connected_channel_accounts, stubs);
    });

    if (resolverResult.outcome !== "success") {
      const resolverStatus = resolverResult.outcome as WebhookEventStatus;

      if (resolverStatus === "channel_account_unresolved") {
        await this.database.transaction(workspaceId, async (client) => {
          await this.repository.markIgnored(client, webhookEventId, resolverStatus, messageId, workspaceId, "ERR_CHANNEL_UNRESOLVED", resolverResult.reason);
        });
        this.logger.warn("Channel account unresolved, routing to DLQ", { event_id: eventId });
        return { action: "nack_dlq", status: resolverStatus };
      }

      return this.classifyAndAck(webhookEventId, resolverStatus, messageId, workspaceId, eventId, `ERR_${resolverStatus.toUpperCase()}`, resolverResult.reason);
    }
    return null;
  }

  private async allocateAndPublish(message: AirtableApprovedQueueMessage, webhookEventId: string, messageId: string): Promise<WorkerResult> {
    const { event_id: eventId, record_ref: recordRef, workspace_id: workspaceId } = message;
    const txB = await this.database.transaction(workspaceId, async (client) => {
      return this.repository.allocateVersionAndCreateWorkflow(client, {
        workspaceId: workspaceId,
        recordRef: recordRef,
        webhookEventId,
        messageId
      });
    });

    if (txB.duplicate) {
      this.logger.info("Duplicate version allocation detected, ACK", { event_id: eventId, approved_version: txB.approvedVersion });
      await this.database.transaction(workspaceId, async (client) => {
        await this.repository.markIgnored(client, webhookEventId, "duplicate_ignored", messageId, workspaceId, "DUPLICATE_VERSION", `Version ${txB.approvedVersion} already allocated`);
      });
      return { action: "ack", status: "duplicate_ignored" };
    }

    this.logger.info("Workflow stub created successfully", { event_id: eventId, record_ref: recordRef, approved_version: txB.approvedVersion, workflow_run_id: txB.workflowRunId });

    if (this.queuePublisher && txB.workflowRunId) {
      const aiMessage = {
        event_id: `evt_ai_${txB.workflowRunId}`,
        event_type: "ai.compose.facebook.requested" as const,
        event_version: 1 as const,
        source: "orchestrator.workflow_runs" as const,
        workspace_id: workspaceId,
        workflow_run_id: txB.workflowRunId,
        prompt_version: this.promptVersion,
        idempotency_key: createAiIdempotencyKey({ workspaceId: workspaceId, workflowRunId: txB.workflowRunId, promptVersion: this.promptVersion }),
        correlation_id: "corr_" + eventId,
        causation_id: eventId
      };

      await this.queuePublisher.publishAiComposerRequest(aiMessage, aiMessage.event_id);
    }

    return { action: "ack", status: "workflow_stub_created", approvedVersion: txB.approvedVersion };
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
