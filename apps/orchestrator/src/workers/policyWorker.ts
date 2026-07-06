import { evaluateFacebookPolicy, evaluateTiktokPolicy, POLICY_VERSION } from "@mediaops/policy-engine";
import type { PolicyEvaluateRequestedEvent, PublishFacebookRequestedEvent, PublishTiktokRequestedEvent } from "@mediaops/shared-contracts";
import type { AirtableClient } from "../airtable/airtableClient.js";
import type { Database } from "../ledger/postgres.js";
import { PolicyWorkerRepository } from "../ledger/policyWorkerRepository.js";
import type { Logger } from "../lib/logger.js";
import { redact } from "../lib/redact.js";
import type { QueuePublisher } from "../queue/rabbitmqPublisher.js";

export interface PolicyQueueWorkerResult {
  action: "ack" | "nack_requeue" | "nack_dlq";
  status: string;
  errorCode?: string;
}

export class PolicyWorker {
  private readonly repository = new PolicyWorkerRepository();

  constructor(
    private readonly database: Database,
    private readonly airtableClient: AirtableClient,
    private readonly logger: Logger,
    private readonly workspaceId: string,
    private readonly queuePublisher?: Pick<QueuePublisher, "publishFacebookRequest" | "publishTiktokRequest" | "publishSlackAlert">
  ) {}

  async processQueueMessage(message: PolicyEvaluateRequestedEvent, messageId: string): Promise<PolicyQueueWorkerResult> {
    if (message.workspace_id !== this.workspaceId) {
      this.logger.error("Policy queue message workspace mismatch", {
        messageId,
        message_workspace_id: message.workspace_id,
        worker_workspace_id: this.workspaceId
      });
      return { action: "nack_dlq", status: "workspace_mismatch" };
    }

    if (!message.idempotency_key.endsWith(POLICY_VERSION)) {
      this.logger.warn("Policy queue message idempotency key does not include current policy version", {
        messageId,
        policy_version: POLICY_VERSION
      });
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
          await this.repository.markIneligible(client, this.workspaceId, message, "variant_or_workflow_not_pending_policy");
          return { status: "ineligible" as const };
        }

        const evaluateFn = message.platform === "tiktok" ? evaluateTiktokPolicy : evaluateFacebookPolicy;
        const evaluation = evaluateFn({
          variant: {
            approvalStatus: context.variant.approval_status,
            body: context.variant.body,
            hashtags: context.variant.hashtags,
            ctaUrl: context.variant.cta_url,
            sourceCtaUrl: context.variant.cta_url
          },
          channelAccount: context.channelAccount ? { status: context.channelAccount.status } : null,
          tokenReference: context.channelAccount ? { tokenStatus: context.channelAccount.token_status } : null,
          workspaceConfig: {
            autoPublishEnabled: context.workspaceConfig.autoPublishEnabled,
            autoApproveEnabled: context.workspaceConfig.autoApproveEnabled,
            utmWarnOnly: context.workspaceConfig.utmWarnOnly,
            forbiddenTerms: context.workspaceConfig.forbiddenTerms
          }
        });

        return this.repository.persistEvaluation(client, this.workspaceId, message, context, evaluation);
      });
    } catch (error) {
      this.logger.error("Policy worker failed before durable commit", {
        messageId,
        error: String(redact(String(error)))
      });
      return { action: "nack_requeue", status: "persistence_failed" };
    }

    if (persisted.status === "duplicate" || persisted.status === "ineligible") {
      return { action: "ack", status: persisted.status };
    }

    if (persisted.publishEvent && this.queuePublisher) {
      if (message.platform === "tiktok") {
        const tiktokEvent = persisted.publishEvent as PublishTiktokRequestedEvent;
        await this.queuePublisher.publishTiktokRequest(tiktokEvent, tiktokEvent.event_id);
      } else {
        const facebookEvent = persisted.publishEvent as PublishFacebookRequestedEvent;
        await this.queuePublisher.publishFacebookRequest(facebookEvent, facebookEvent.event_id);
      }
    }

    if (persisted.allowed === false) {
      await this.handleBlockedSideEffects(message, persisted, messageId);
    }

    return { action: "ack", status: persisted.allowed ? "policy_approved" : "policy_rejected" };
  }

  private async handleBlockedSideEffects(
    message: PolicyEvaluateRequestedEvent,
    persisted: {
      resultId?: string;
      blockers?: { code: string; detail: string }[];
      warnings?: { code: string; detail: string }[];
    },
    messageId: string
  ): Promise<void> {
    const blockerCodes = (persisted.blockers ?? []).map((blocker) => blocker.code);
    const warningCodes = (persisted.warnings ?? []).map((warning) => warning.code);

    try {
      if (!this.airtableClient.updatePolicyNeedsReview) {
        throw new Error("Airtable policy sync method is not configured");
      }

      await this.airtableClient.updatePolicyNeedsReview(message.airtable_record_id, {
        policy_status: "Needs Review",
        policy_blockers: blockerCodes,
        policy_warnings: warningCodes
      });
    } catch (error) {
      this.logger.error("Policy Airtable sync failed after Ledger commit", {
        messageId,
        error: String(redact(String(error)))
      });

      if (persisted.resultId) {
        await this.database.transaction(this.workspaceId, async (client) => {
          await this.repository.markAirtableSyncRetryNeeded(
            client,
            this.workspaceId,
            persisted.resultId!,
            String(redact(String(error)))
          );
        });
      }
    }

    if (!this.queuePublisher) return;

    const channelId = process.env.POLICY_BLOCK_SLACK_CHANNEL_ID;
    const alert = {
      event_id: `policy_block_${message.content_variant_id}`,
      event_type: "alerts.slack.send",
      event_version: 1,
      workspace_id: message.workspace_id,
      correlation_id: message.correlation_id,
      channel_id: channelId ?? null,
      alert_type: channelId ? "policy_block" : "alert_pending_config",
      severity: "warning",
      entity_type: "content_variant",
      entity_id: message.content_variant_id,
      blocker_codes: blockerCodes,
      warning_codes: warningCodes,
      created_at: new Date().toISOString()
    };

    await this.queuePublisher.publishSlackAlert(alert, String(alert.event_id), message.correlation_id);
  }
}
