/**
 * US-014: Queue Audit Helper
 *
 * Wraps AuditLogRepository to provide standardized audit events for
 * RabbitMQ queue operations (publish, consume, retry, DLQ).
 *
 * Audit event types per FL-008:
 * - QUEUE_EVENT_PUBLISHED
 * - QUEUE_EVENT_CONSUMED
 * - QUEUE_EVENT_RETRIED
 * - QUEUE_EVENT_DLQ
 *
 * All metadata is redacted/reference-only. No tokens or raw payloads logged.
 */

import type pg from "pg";
import type { Logger } from "../lib/logger.js";
import { AuditLogRepository } from "../ledger/auditLogRepository.js";

const auditRepo = new AuditLogRepository();

export interface QueueAuditInput {
  workspaceId: string;
  queueName: string;
  eventId: string;
  eventType: string;
  correlationId?: string;
  messageId?: string;
  errorCode?: string;
  errorMessage?: string;
  retryCount?: number;
}

/**
 * Audit: message published to queue (producer side).
 */
export async function auditQueuePublished(
  client: pg.PoolClient,
  input: QueueAuditInput,
  logger: Logger
): Promise<void> {
  try {
    await auditRepo.insertAuditLog(client, {
      workspaceId: input.workspaceId,
      eventType: "QUEUE_EVENT_PUBLISHED",
      entityType: "queue_message",
      entityId: input.eventId,
      actorType: "system",
      actorId: "rabbitmq_publisher",
      correlationId: input.correlationId,
      severity: "info",
      metadata: {
        queue_name: input.queueName,
        event_type: input.eventType,
        message_id: input.messageId
      }
    });
  } catch (err) {
    logger.warn("Failed to write QUEUE_EVENT_PUBLISHED audit", {
      eventId: input.eventId,
      error: err instanceof Error ? err.message : String(err)
    });
  }
}

/**
 * Audit: message consumed successfully by worker.
 */
export async function auditQueueConsumed(
  client: pg.PoolClient,
  input: QueueAuditInput,
  logger: Logger
): Promise<void> {
  try {
    await auditRepo.insertAuditLog(client, {
      workspaceId: input.workspaceId,
      eventType: "QUEUE_EVENT_CONSUMED",
      entityType: "queue_message",
      entityId: input.eventId,
      actorType: "system",
      actorId: "rabbitmq_consumer",
      correlationId: input.correlationId,
      severity: "info",
      metadata: {
        queue_name: input.queueName,
        event_type: input.eventType,
        message_id: input.messageId
      }
    });
  } catch (err) {
    logger.warn("Failed to write QUEUE_EVENT_CONSUMED audit", {
      eventId: input.eventId,
      error: err instanceof Error ? err.message : String(err)
    });
  }
}

/**
 * Audit: message published to retry queue after transient error.
 */
export async function auditQueueRetried(
  client: pg.PoolClient,
  input: QueueAuditInput,
  logger: Logger
): Promise<void> {
  try {
    await auditRepo.insertAuditLog(client, {
      workspaceId: input.workspaceId,
      eventType: "QUEUE_EVENT_RETRIED",
      entityType: "queue_message",
      entityId: input.eventId,
      actorType: "system",
      actorId: "rabbitmq_consumer",
      correlationId: input.correlationId,
      severity: "warn",
      metadata: {
        queue_name: input.queueName,
        event_type: input.eventType,
        message_id: input.messageId,
        retry_count: input.retryCount ?? 0,
        error_code: input.errorCode,
        // Truncate error message — no raw tokens or large payloads
        error_message: input.errorMessage?.slice(0, 500)
      }
    });
  } catch (err) {
    logger.warn("Failed to write QUEUE_EVENT_RETRIED audit", {
      eventId: input.eventId,
      error: err instanceof Error ? err.message : String(err)
    });
  }
}

/**
 * Audit: message moved to DLQ after permanent failure or exhausted retries.
 */
export async function auditQueueDlq(
  client: pg.PoolClient,
  input: QueueAuditInput,
  logger: Logger
): Promise<void> {
  try {
    await auditRepo.insertAuditLog(client, {
      workspaceId: input.workspaceId,
      eventType: "QUEUE_EVENT_DLQ",
      entityType: "queue_message",
      entityId: input.eventId,
      actorType: "system",
      actorId: "rabbitmq_consumer",
      correlationId: input.correlationId,
      severity: "error",
      metadata: {
        queue_name: input.queueName,
        dlq_name: `${input.queueName}.dlq`,
        event_type: input.eventType,
        message_id: input.messageId,
        error_code: input.errorCode,
        // Truncate error message — no raw tokens or large payloads
        error_message: input.errorMessage?.slice(0, 500)
      }
    });
  } catch (err) {
    logger.warn("Failed to write QUEUE_EVENT_DLQ audit", {
      eventId: input.eventId,
      error: err instanceof Error ? err.message : String(err)
    });
  }
}
