import { randomUUID } from "node:crypto";
import {
  AirtableApprovedQueueMessageSchema,
  AirtableApprovedWebhookSchema,
  createIngressIdempotencyKey,
  type AirtableApprovedQueueMessage
} from "@mediaops/shared-contracts";
import type { Database } from "../ledger/postgres.js";
import { WebhookEventRepository } from "../ledger/webhookEventRepository.js";
import type { QueuePublisher } from "../queue/rabbitmqPublisher.js";
import type { Logger } from "../lib/logger.js";

export type IngestResult =
  | { status: "queued"; eventId: string; messageId: string }
  | { status: "duplicate_ignored"; eventId: string };

export class AirtableWebhookIngestor {
  private readonly repository = new WebhookEventRepository();

  constructor(
    private readonly database: Database,
    private readonly queuePublisher: QueuePublisher,
    private readonly logger: Logger,
    private readonly workspaceId: string
  ) {}

  async ingest(rawBody: unknown): Promise<IngestResult> {
    const webhook = AirtableApprovedWebhookSchema.parse(rawBody);
    const correlationId = randomUUID();
    const causationId = webhook.event_id;

    const messageId = randomUUID();
    const queueMessage: AirtableApprovedQueueMessage = AirtableApprovedQueueMessageSchema.parse({
      event_id: webhook.event_id,
      event_type: "airtable.post.approved.ingress",
      event_version: 1,
      source: "airtable.webhook_receiver",
      workspace_id: this.workspaceId,
      record_ref: webhook.record_id,
      approval_ref: webhook.approved_at,
      idempotency_key: createIngressIdempotencyKey(webhook.event_id),
      correlation_id: correlationId,
      causation_id: causationId
    });

    const ledgerResult = await this.database.transaction(this.workspaceId, async (client) => {
      const event = await this.repository.insertReceived(client, {
        eventId: webhook.event_id,
        workspaceId: this.workspaceId,
        airtableRecordId: webhook.record_id,
        approvalRef: webhook.approved_at,
        correlationId,
        causationId
      });

      if (event.duplicate) {
        return { duplicate: true as const, eventId: event.eventId };
      }

      await this.repository.markQueued(client, event.id, queueMessage, messageId);
      return { duplicate: false as const, eventId: event.eventId };
    });

    if (ledgerResult.duplicate) {
      this.logger.info("Duplicate Airtable webhook ignored", { event_id: ledgerResult.eventId });
      return { status: "duplicate_ignored", eventId: ledgerResult.eventId };
    }

    await this.queuePublisher.publishApprovedPost(queueMessage, messageId);
    this.logger.info("Airtable webhook queued", {
      event_id: ledgerResult.eventId,
      message_id: messageId,
      record_ref: queueMessage.record_ref
    });

    return { status: "queued", eventId: ledgerResult.eventId, messageId };
  }
}
