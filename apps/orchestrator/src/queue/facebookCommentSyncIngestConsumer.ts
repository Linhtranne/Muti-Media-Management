import amqp from "amqplib";
import { CommentIngestEventSchema } from "@mediaops/shared-contracts";
import type { Logger } from "../lib/logger.js";
import type { FacebookCommentSyncWorker } from "../workers/facebookCommentSyncWorker.js";

export interface IngestQueueConsumerChannel {
  assertExchange(exchange: string, type: string, options: { durable: boolean }): Promise<unknown>;
  assertQueue(queue: string, options: { durable: boolean }): Promise<unknown>;
  bindQueue(queue: string, exchange: string, routingKey: string): Promise<unknown>;
  prefetch(count: number): Promise<unknown>;
  consume(queue: string, handler: (msg: amqp.ConsumeMessage | null) => Promise<void>): Promise<unknown>;
  sendToQueue(queue: string, content: Buffer, options: Record<string, unknown>): boolean;
  waitForConfirms(): Promise<void>;
  ack(msg: amqp.Message): void;
  nack(msg: amqp.Message, allUpTo?: boolean, requeue?: boolean): void;
  close(): Promise<void>;
}

export interface IngestQueueConnection {
  createConfirmChannel(): Promise<IngestQueueConsumerChannel>;
  close(): Promise<void>;
}

export interface IngestQueueConsumer {
  start(): Promise<void>;
  stop(): Promise<void>;
}

type SafeConsumeMessage = Omit<amqp.ConsumeMessage, "fields" | "properties"> & {
  fields: {
    exchange: string;
    routingKey: string;
  };
  properties: {
    messageId?: string;
    correlationId?: string;
    headers?: Record<string, unknown>;
  };
};

const exchange = "comments.workflows";
const queue = "comments.facebook.ingest";
const routingKey = "comments.facebook.ingest";
const dlqQueue = "comments.facebook.ingest.dlq";
const connectRabbitMq = amqp.connect as (url: string) => Promise<IngestQueueConnection>;

const MAX_RETRIES = 5;

export async function handleIngestQueueMessage(
  channel: IngestQueueConsumerChannel,
  worker: Pick<FacebookCommentSyncWorker, "processIngestEvent">,
  logger: Logger,
  msg: amqp.ConsumeMessage,
  isStopping: () => boolean
): Promise<void> {
  if (isStopping()) {
    channel.nack(msg, false, true);
    return;
  }

  const safeMsg = msg as SafeConsumeMessage;
  const messageId = safeMsg.properties.messageId ?? "unknown-msg-id";
  const contentStr = safeMsg.content.toString();
  const headers = safeMsg.properties.headers || {};
  const retryCount = typeof headers["x-retries"] === "number" ? headers["x-retries"] : 0;

  async function moveToDlq(errorCode: string, errorMessage: string): Promise<void> {
    const dlqPayload = {
      original_message_id: messageId,
      correlation_id: safeMsg.properties.correlationId,
      routing_key: safeMsg.fields.routingKey,
      error_code: errorCode,
      error_message: errorMessage,
      moved_at: new Date().toISOString(),
      payload: contentStr
    };

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
    await channel.waitForConfirms();
    channel.ack(msg);
  }

  try {
    let rawPayload: unknown;
    try {
      rawPayload = JSON.parse(contentStr);
    } catch {
      await moveToDlq("MALFORMED_JSON", "Invalid JSON format");
      return;
    }

    const validation = CommentIngestEventSchema.safeParse(rawPayload);
    if (!validation.success) {
      await moveToDlq("VALIDATION_FAILED", JSON.stringify(validation.error.flatten()));
      return;
    }

    await worker.processIngestEvent(validation.data);
    channel.ack(msg);
  } catch (error) {
    if (retryCount >= MAX_RETRIES) {
      logger.error("Max retries exceeded for comment ingest", { messageId });
      await moveToDlq("MAX_RETRIES_EXCEEDED", String(error));
      return;
    }

    logger.warn("Worker error, requeuing message", {
      messageId,
      retryCount: retryCount + 1,
      error: error instanceof Error ? error.message : String(error)
    });

    // Re-publish with incremented retry count
    channel.sendToQueue(queue, safeMsg.content, {
      messageId,
      contentType: "application/json",
      deliveryMode: 2,
      correlationId: safeMsg.properties.correlationId,
      headers: {
        ...headers,
        "x-retries": retryCount + 1
      }
    });
    await channel.waitForConfirms();
    channel.ack(msg);
  }
}

export async function createFacebookCommentSyncIngestConsumer(
  rabbitmqUrl: string,
  worker: FacebookCommentSyncWorker,
  logger: Logger
): Promise<IngestQueueConsumer> {
  let connection: IngestQueueConnection | null = null;
  let channel: IngestQueueConsumerChannel | null = null;
  let isStopping = false;

  return {
    async start(): Promise<void> {
      logger.info("Initializing Facebook Comment Ingest RabbitMQ consumer...");
      connection = await connectRabbitMq(rabbitmqUrl);
      channel = await connection.createConfirmChannel();

      await channel.assertExchange(exchange, "topic", { durable: true });
      await channel.assertQueue(queue, { durable: true });
      await channel.bindQueue(queue, exchange, routingKey);
      await channel.assertQueue(dlqQueue, { durable: true });
      await channel.prefetch(5); // Process up to 5 comments concurrently

      await channel.consume(queue, async (msg: amqp.ConsumeMessage | null) => {
        if (!msg || !channel) return;
        await handleIngestQueueMessage(channel, worker, logger, msg, () => isStopping);
      });
    },

    async stop(): Promise<void> {
      if (isStopping) return;
      isStopping = true;
      logger.info("Stopping Facebook Comment Ingest RabbitMQ consumer...");

      if (channel) {
        await channel.close().catch((error) => { logger.error("Error closing channel", { error: String(error) }); });
      }
      if (connection) {
        await connection.close().catch((error) => { logger.error("Error closing connection", { error: String(error) }); });
      }
    }
  };
}
