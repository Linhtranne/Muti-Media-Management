import type pg from "pg";
import type { AirtableApprovedQueueMessage } from "@mediaops/shared-contracts";
import type { WebhookEventStatus } from "@mediaops/shared-contracts";

export type InsertWebhookEventInput = {
  eventId: string;
  workspaceId: string;
  airtableRecordId: string;
  approvalRef: string;
  correlationId: string;
  causationId: string;
  metadata?: Record<string, unknown>;
};

export type WebhookEventRow = {
  id: string;
  eventId: string;
  status: WebhookEventStatus;
  duplicate: boolean;
};

export class WebhookEventRepository {
  async insertReceived(client: pg.PoolClient, input: InsertWebhookEventInput): Promise<WebhookEventRow> {
    const result = await client.query<{
      id: string;
      event_id: string;
      status: WebhookEventStatus;
      inserted: boolean;
    }>(
      `
      WITH inserted AS (
        INSERT INTO webhook_events (
          event_id,
          source,
          event_type,
          event_version,
          workspace_id,
          airtable_record_id,
          airtable_table_name,
          approval_ref,
          correlation_id,
          causation_id,
          status,
          metadata
        )
        VALUES ($1, 'airtable', 'airtable.post.approved', 1, $2, $3, 'Posts', $4, $5, $6, 'received', $7::jsonb)
        ON CONFLICT (event_id) DO NOTHING
        RETURNING id, event_id, status, true AS inserted
      )
      SELECT id, event_id, status, inserted FROM inserted
      UNION ALL
      SELECT id, event_id, status, false AS inserted
      FROM webhook_events
      WHERE event_id = $1
      LIMIT 1
      `,
      [
        input.eventId,
        input.workspaceId,
        input.airtableRecordId,
        input.approvalRef,
        input.correlationId,
        input.causationId,
        JSON.stringify(input.metadata ?? {})
      ]
    );

    const row = result.rows[0];
    return {
      id: row.id,
      eventId: row.event_id,
      status: row.status,
      duplicate: !row.inserted
    };
  }

  async markQueued(
    client: pg.PoolClient,
    id: string,
    message: AirtableApprovedQueueMessage,
    messageId: string
  ): Promise<void> {
    await client.query(
      `
      UPDATE webhook_events
      SET status = 'queued', idempotency_key = $2, processed_at = NOW()
      WHERE id = $1
      `,
      [id, message.idempotency_key]
    );

    await client.query(
      `
      INSERT INTO queue_events (
        webhook_event_id,
        workspace_id,
        queue_name,
        routing_key,
        message_id,
        idempotency_key,
        status
      )
      VALUES ($1, $2, 'airtable.webhook.approved', 'airtable.post.approved.ingress', $3, $4, 'queued')
      ON CONFLICT (message_id) DO NOTHING
      `,
      [id, message.workspace_id, messageId, message.idempotency_key]
    );
  }

  async markFailed(client: pg.PoolClient, id: string, code: string, message: string): Promise<void> {
    await client.query(
      `
      UPDATE webhook_events
      SET status = 'failed', error_code = $2, error_message = $3, processed_at = NOW()
      WHERE id = $1
      `,
      [id, code, message]
    );
  }
}
