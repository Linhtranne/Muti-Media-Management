import amqp from "amqplib";
import type { ChannelModel, ConfirmChannel } from "amqplib";
import {
  AirtableApprovedQueueMessageSchema,
  type AirtableApprovedQueueMessage
} from "@mediaops/shared-contracts";
import type { ApprovedPostWorker, WorkerResult } from "../workers/approvedPostWorker.js";
import type { Logger } from "../lib/logger.js";
import type { Database } from "../ledger/postgres.js";
import {
  auditQueueConsumed,
  auditQueueRetried,
  auditQueueDlq
} from "./queueAuditHelper.js";
import {
  checkIdempotency,
  markIdempotencySucceeded,
  markIdempotencyFailed
} from "./idempotencyGuard.js";

type SafeConsumeMessage = Omit<amqp.ConsumeMessage, "fields" | "properties"> & {
  fields: {
    exchange: string;
    routingKey: string;
  };
  properties: {
    messageId?: string;
    correlationId?: string;
  };
};

export interface QueueConsumer {
  start(): Promise<void>;
  stop(): Promise<void>;
}

interface DlqMetadata {
  workspaceId: string;
  eventId: string;
  eventType: string;
  correlationId?: string;
}

function getStringPropertyOptional(
  obj: Record<string, unknown> | undefined,
  snakeKey: string,
  camelKey: string,
  fallback?: string
): string | undefined {
  if (!obj) return fallback;
  const val = obj[snakeKey] ?? obj[camelKey];
  return typeof val === "string" ? val : fallback;
}

function getStringProperty(
  obj: Record<string, unknown> | undefined,
  snakeKey: string,
  camelKey: string,
  fallback: string
): string {
  return getStringPropertyOptional(obj, snakeKey, camelKey, fallback) ?? fallback;
}

function extractDlqMetadata(
  safeMsg: SafeConsumeMessage,
  parsedPayload?: unknown
): DlqMetadata {
  const payloadObj = parsedPayload && typeof parsedPayload === "object"
    ? (parsedPayload as Record<string, unknown>)
    : undefined;

  const messageId = safeMsg.properties.messageId ?? "unknown-msg-id";

  const workspaceId = getStringProperty(payloadObj, "workspace_id", "workspaceId", "system");
  const eventId = getStringProperty(payloadObj, "event_id", "eventId", messageId);
  const eventType = getStringProperty(payloadObj, "event_type", "eventType", safeMsg.fields.routingKey || "unknown");
  const correlationId = getStringPropertyOptional(payloadObj, "correlation_id", "correlationId", safeMsg.properties.correlationId || undefined);

  return {
    workspaceId,
    eventId,
    eventType,
    correlationId
  };
}

export async function moveToDlq(
  channel: ConfirmChannel,
  msg: amqp.Message,
  errorCode: string,
  errorMessage: string,
  logger: Logger,
  database?: Database,
  parsedPayload?: unknown
): Promise<void> {
  const safeMsg = msg as SafeConsumeMessage;
  const messageId = safeMsg.properties.messageId ?? "unknown-msg-id";
  const queue = "airtable.webhook.approved";
  const dlqQueue = "airtable.webhook.approved.dlq";

  logger.warn("Moving message to DLQ", { messageId, errorCode, errorMessage });

  try {
    const originalContent = safeMsg.content.toString();
    const dlqPayload = {
      original_message_id: messageId,
      correlation_id: safeMsg.properties.correlationId,
      routing_key: safeMsg.fields.routingKey,
      error_code: errorCode,
      error_message: errorMessage,
      moved_at: new Date().toISOString(),
      payload: originalContent
    };

    // Publish to the DLQ queue
    channel.sendToQueue(dlqQueue, Buffer.from(JSON.stringify(dlqPayload)), {
      messageId,
      contentType: "application/json",
      deliveryMode: 2,
      headers: {
        x_original_exchange: safeMsg.fields.exchange,
        x_original_routing_key: safeMsg.fields.routingKey,
        x_dlq_error_code: errorCode,
        x_dlq_error_message: errorMessage
      }
    });

    // Wait for confirms since we are using a confirm channel
    await channel.waitForConfirms();

    // Acknowledge original message once safely published in DLQ
    channel.ack(msg);
    logger.info("Message safely enqueued to DLQ and acknowledged from main queue", { messageId });

    if (database) {
      const { workspaceId, eventId, eventType, correlationId } = extractDlqMetadata(safeMsg, parsedPayload);

      await auditQueueDlq(
        database.getPool(),
        {
          workspaceId,
          queueName: queue,
          eventId,
          eventType,
          correlationId,
          messageId,
          errorCode,
          errorMessage
        },
        logger
      ).catch((err) => {
        logger.warn("Failed to write QUEUE_EVENT_DLQ audit", { error: String(err) });
      });
    }
  } catch (err) {
    logger.error("Failed to write to DLQ queue! Requeuing message as fallback.", {
      messageId,
      error: String(err)
    });
    // If DLQ write fails, we must NOT lose the message. Requeue to try again.
    channel.nack(msg, false, true);
  }
}

interface WorkerResultContext {
  channel: ConfirmChannel;
  msg: amqp.ConsumeMessage;
  validatedMessage: AirtableApprovedQueueMessage;
  queue: string;
  database?: Database;
  logger?: Logger;
}

async function handleWorkerAck(
  context: WorkerResultContext
): Promise<void> {
  const { channel, msg, validatedMessage, queue, database, logger } = context;
  const safeMsg = msg as SafeConsumeMessage;
  const messageId = safeMsg.properties.messageId ?? "unknown-msg-id";

  if (database && logger) {
    // Mark idempotency as succeeded since worker successfully processed the event
    await markIdempotencySucceeded(
      database.getPool(),
      validatedMessage.workspace_id,
      validatedMessage.idempotency_key,
      logger
    ).catch((err) => {
      logger.warn("Failed to mark idempotency succeeded", { error: String(err) });
    });

    await auditQueueConsumed(
      database.getPool(),
      {
        workspaceId: validatedMessage.workspace_id,
        queueName: queue,
        eventId: validatedMessage.event_id,
        eventType: validatedMessage.event_type,
        correlationId: validatedMessage.correlation_id,
        messageId
      },
      logger
    ).catch((err) => {
      logger.warn("Failed to write QUEUE_EVENT_CONSUMED audit", { error: String(err) });
    });
  }

  // Acknowledge original message once ledger commit & idempotency status are written
  channel.ack(msg);
}

async function handleWorkerNackRequeue(
  context: WorkerResultContext,
  result: WorkerResult
): Promise<void> {
  const { channel, msg, validatedMessage, queue, database, logger } = context;
  const safeMsg = msg as SafeConsumeMessage;
  const messageId = safeMsg.properties.messageId ?? "unknown-msg-id";

  if (logger) {
    logger.warn("Worker returned nack_requeue, sleeping briefly to avoid hot loops", {
      messageId,
      status: result.status
    });
  }
  // Brief 1s delay to protect CPU/logs from a fast hot loop
  await new Promise((resolve) => setTimeout(resolve, 1000));
  channel.nack(msg, false, true);

  if (database && logger) {
    await auditQueueRetried(
      database.getPool(),
      {
        workspaceId: validatedMessage.workspace_id,
        queueName: queue,
        eventId: validatedMessage.event_id,
        eventType: validatedMessage.event_type,
        correlationId: validatedMessage.correlation_id,
        messageId,
        errorMessage: `Worker status: ${result.status}`
      },
      logger
    ).catch((err) => {
      logger.warn("Failed to write QUEUE_EVENT_RETRIED audit", { error: String(err) });
    });
  }
}

async function handleWorkerNackDlq(
  context: WorkerResultContext,
  result: WorkerResult
): Promise<void> {
  const { channel, msg, validatedMessage, database, logger } = context;
  const safeMsg = msg as SafeConsumeMessage;
  const messageId = safeMsg.properties.messageId ?? "unknown-msg-id";

  if (logger) {
    logger.error("Worker returned nack_dlq, routing to DLQ", {
      messageId,
      status: result.status
    });
  }

  if (database && logger) {
    // Mark idempotency as failed in the database since the message will be routed to DLQ
    await markIdempotencyFailed(
      database.getPool(),
      validatedMessage.workspace_id,
      validatedMessage.idempotency_key,
      `Worker status: ${result.status}`,
      logger
    ).catch((err) => {
      logger.warn("Failed to mark idempotency failed", { error: String(err) });
    });
  }

  await moveToDlq(channel, msg, `WORKER_NACK_DLQ_${result.status.toUpperCase()}`, `Worker requested DLQ: ${result.status}`, logger!, database, validatedMessage);
}

export async function handleWorkerResult(
  channel: ConfirmChannel,
  msg: amqp.ConsumeMessage,
  result: WorkerResult,
  validatedMessage: AirtableApprovedQueueMessage,
  queue: string,
  database?: Database,
  logger?: Logger
): Promise<void> {
  const context: WorkerResultContext = {
    channel,
    msg,
    validatedMessage,
    queue,
    database,
    logger
  };

  if (result.action === "ack") {
    await handleWorkerAck(context);
  } else if (result.action === "nack_requeue") {
    await handleWorkerNackRequeue(context, result);
  } else if (result.action === "nack_dlq") {
    await handleWorkerNackDlq(context, result);
  }
}

export async function handleAirtableApprovedMessage(
  channel: ConfirmChannel,
  worker: ApprovedPostWorker,
  logger: Logger,
  msg: amqp.ConsumeMessage,
  isStopping: () => boolean,
  database?: Database
): Promise<void> {
  if (isStopping()) {
    channel.nack(msg, false, true);
    return;
  }

  const safeMsg = msg as SafeConsumeMessage;
  const messageId = safeMsg.properties.messageId ?? "unknown-msg-id";
  const contentStr = msg.content.toString();
  const queue = "airtable.webhook.approved";

  try {
    // Parse and validate payload with strict Zod contracts
    let rawPayload: unknown;
    try {
      rawPayload = JSON.parse(contentStr) as unknown;
    } catch (parseError) {
      logger.error("Malformed JSON in queue message body, routing to DLQ", {
        messageId,
        content: contentStr,
        error: parseError instanceof Error ? parseError.message : String(parseError)
      });
      await moveToDlq(channel, msg, "MALFORMED_JSON", "Invalid JSON format", logger, database);
      return;
    }

    const validation = AirtableApprovedQueueMessageSchema.safeParse(rawPayload);
    if (!validation.success) {
      logger.error("Zod schema validation failed for queue message, routing to DLQ", {
        messageId,
        errors: validation.error.flatten(),
        payload: rawPayload
      });
      await moveToDlq(channel, msg, "VALIDATION_FAILED", JSON.stringify(validation.error.flatten()), logger, database, rawPayload);
      return;
    }

    const validatedMessage = validation.data;

    // Check idempotency if database is available
    if (database) {
      const checkResult = await checkIdempotency(
        database.getPool(),
        {
          eventId: validatedMessage.event_id,
          idempotencyKey: validatedMessage.idempotency_key,
          workspaceId: validatedMessage.workspace_id,
          eventType: validatedMessage.event_type,
          queueName: queue
        },
        logger
      );

      if (checkResult.isDuplicate) {
        logger.warn("Skipping duplicate message due to idempotency", {
          messageId,
          idempotencyKey: validatedMessage.idempotency_key
        });
        channel.ack(msg);
        return;
      }
    }

    // Delegate to ApprovedPostWorker
    const result = await worker.process(validatedMessage, messageId);

    // Call the outcome helper
    await handleWorkerResult(channel, msg, result, validatedMessage, queue, database, logger);
  } catch (error: unknown) {
    logger.error("Unhandled exception in consumer loop, requeuing message", {
      messageId,
      error: error instanceof Error ? error.message : String(error)
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      channel.nack(msg, false, true);
    } catch (nackError) {
      logger.error("Failed to NACK message after unhandled exception", { messageId, error: String(nackError) });
    }
  }
}

export async function createRabbitMqConsumer(
  rabbitmqUrl: string,
  worker: ApprovedPostWorker,
  logger: Logger,
  database?: Database
): Promise<QueueConsumer> {
  let connection: ChannelModel | null = null;
  let channel: ConfirmChannel | null = null;
  let isStopping = false;

  const exchange = "airtable.webhooks";
  const queue = "airtable.webhook.approved";
  const routingKey = "airtable.post.approved.ingress";
  const dlqQueue = "airtable.webhook.approved.dlq";

  return {
    async start(): Promise<void> {
      logger.info("Initializing RabbitMQ consumer...");
      const conn = await (amqp.connect as unknown as (url: string) => Promise<ChannelModel>)(rabbitmqUrl);
      if (!conn) {
        throw new Error("Failed to connect to RabbitMQ: connection is null");
      }
      connection = conn;
      const ch = await conn.createConfirmChannel();
      if (!ch) {
        throw new Error("Failed to create RabbitMQ channel: channel is null");
      }
      channel = ch;

      // Assert main topology
      await ch.assertExchange(exchange, "topic", { durable: true });
      await ch.assertQueue(queue, { durable: true });
      await ch.bindQueue(queue, exchange, routingKey);

      // Assert DLQ queue
      await ch.assertQueue(dlqQueue, { durable: true });

      // Concurrency control: prefetch 1 message at a time to enforce fair dispatch
      await ch.prefetch(1);

      logger.info("RabbitMQ topology declared. Starting message ingestion...", { queue });

      await ch.consume(queue, (msg: amqp.ConsumeMessage | null) => {
        if (!msg) {
          logger.warn("Received empty consumer message (null)");
          return;
        }
        handleAirtableApprovedMessage(ch, worker, logger, msg, () => isStopping, database).catch((err) => {
          logger.error("Unhandled exception in consume callback", { error: String(err) });
        });
      });
    },

    async stop(): Promise<void> {
      if (isStopping) return;
      isStopping = true;
      logger.info("Stopping RabbitMQ consumer (graceful shutdown)...");

      if (channel) {
        try {
          await channel.close();
        } catch (err) {
          logger.error("Error closing RabbitMQ channel", { error: String(err) });
        }
      }
      if (connection) {
        try {
          await connection.close();
        } catch (err) {
          logger.error("Error closing RabbitMQ connection", { error: String(err) });
        }
      }
      logger.info("RabbitMQ consumer stopped successfully.");
    }
  };
}
