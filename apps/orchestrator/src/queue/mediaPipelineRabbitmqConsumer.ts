import amqp from "amqplib";
import {
  MediaAssetIngestRequestedEventSchema,
  MediaAssetOptimizeRequestedEventSchema
} from "@mediaops/shared-contracts";
import type { Logger } from "../lib/logger.js";
import type { MediaAssetIngestWorker, MediaAssetOptimizeWorker } from "../workers/mediaPipelineWorker.js";

export interface MediaConsumerChannel {
  assertExchange(exchange: string, type: string, options: { durable: boolean }): Promise<unknown>;
  assertQueue(queue: string, options: {
    durable: boolean;
    deadLetterExchange?: string;
    deadLetterRoutingKey?: string;
    messageTtl?: number;
  }): Promise<unknown>;
  bindQueue(queue: string, exchange: string, routingKey: string): Promise<unknown>;
  prefetch(count: number): Promise<unknown>;
  consume(queue: string, handler: (msg: amqp.ConsumeMessage | null) => Promise<void>): Promise<unknown>;
  sendToQueue(queue: string, content: Buffer, options: Record<string, unknown>): boolean;
  waitForConfirms(): Promise<void>;
  ack(msg: amqp.Message): void;
  nack(msg: amqp.Message, allUpTo?: boolean, requeue?: boolean): void;
  close(): Promise<void>;
}

export interface MediaConnection {
  createConfirmChannel(): Promise<MediaConsumerChannel>;
  close(): Promise<void>;
}

export interface MediaQueueConsumer {
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

const MAX_RETRIES = 5;
const RETRY_BASE_DELAY_MS = 1000;
const exchange = "mediaops.events.topic";
const ingestQueue = "media.asset.ingest.requested";
const ingestRoutingKey = "media.asset.ingest.requested";
const ingestDlq = "media.asset.ingest.requested.dlq";

const optimizeQueue = "media.asset.optimize.requested";
const optimizeRoutingKey = "media.asset.optimize.requested";
const optimizeDlq = "media.asset.optimize.requested.dlq";

const connectRabbitMq = amqp.connect as (url: string) => Promise<MediaConnection>;

function retryCountFromHeaders(headers: Record<string, unknown> | undefined): number {
  const value = headers?.["x-retries"];
  return typeof value === "number" ? value : 0;
}

async function moveToRetryQueue(input: {
  channel: MediaConsumerChannel;
  msg: amqp.ConsumeMessage;
  queue: string;
  retryQueuePrefix: string;
  retryCount: number;
}): Promise<void> {
  const backoffMs = (2 ** input.retryCount) * RETRY_BASE_DELAY_MS;
  const retryQueue = `${input.retryQueuePrefix}.${backoffMs}`;
  const safeMsg = input.msg as SafeConsumeMessage;
  const nextHeaders = {
    ...safeMsg.properties.headers,
    "x-retries": input.retryCount + 1
  };

  await input.channel.assertQueue(retryQueue, {
    durable: true,
    deadLetterExchange: "",
    deadLetterRoutingKey: input.queue,
    messageTtl: backoffMs
  });
  input.channel.sendToQueue(retryQueue, input.msg.content, {
    ...safeMsg.properties,
    headers: nextHeaders
  });
  await input.channel.waitForConfirms();
  input.channel.ack(input.msg);
}

export async function handleIngestQueueMessage(
  channel: MediaConsumerChannel,
  worker: MediaAssetIngestWorker,
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
  const retryCount = retryCountFromHeaders(safeMsg.properties.headers);
  const contentStr = safeMsg.content.toString();

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

    channel.sendToQueue(ingestDlq, Buffer.from(JSON.stringify(dlqPayload)), {
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

    const validation = MediaAssetIngestRequestedEventSchema.safeParse(rawPayload);
    if (!validation.success) {
      await moveToDlq("VALIDATION_FAILED", JSON.stringify(validation.error.flatten()));
      return;
    }

    const result = await worker.processQueueMessage(validation.data, messageId);
    if (result.action === "ack") {
      channel.ack(msg);
      return;
    }

    if (result.action === "nack_requeue") {
      if (retryCount >= MAX_RETRIES) {
        logger.error("Media ingest max retries exceeded, routing to DLQ", { messageId, status: result.status });
        await moveToDlq(`MAX_RETRIES_${result.status.toUpperCase()}`, `Max retries exceeded: ${result.status}`);
        return;
      }

      logger.warn("Media ingest worker requested retry", { messageId, status: result.status, retryCount: retryCount + 1 });
      await moveToRetryQueue({
        channel,
        msg,
        queue: ingestQueue,
        retryQueuePrefix: "media.asset.ingest.retry",
        retryCount
      });
      return;
    }

    await moveToDlq(`WORKER_NACK_DLQ_${result.status.toUpperCase()}`, `Worker requested DLQ: ${result.status}`);
  } catch (error) {
    logger.error("Unhandled exception in Media Ingest consumer loop", {
      messageId,
      error: error instanceof Error ? error.message : String(error)
    });
    if (retryCount >= MAX_RETRIES) {
      await moveToDlq("UNHANDLED_EXCEPTION", error instanceof Error ? error.message : String(error));
      return;
    }
    await moveToRetryQueue({
      channel,
      msg,
      queue: ingestQueue,
      retryQueuePrefix: "media.asset.ingest.retry",
      retryCount
    });
  }
}

export async function handleOptimizeQueueMessage(
  channel: MediaConsumerChannel,
  worker: MediaAssetOptimizeWorker,
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
  const retryCount = retryCountFromHeaders(safeMsg.properties.headers);
  const contentStr = safeMsg.content.toString();

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

    channel.sendToQueue(optimizeDlq, Buffer.from(JSON.stringify(dlqPayload)), {
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

    const validation = MediaAssetOptimizeRequestedEventSchema.safeParse(rawPayload);
    if (!validation.success) {
      await moveToDlq("VALIDATION_FAILED", JSON.stringify(validation.error.flatten()));
      return;
    }

    const result = await worker.processQueueMessage(validation.data, messageId);
    if (result.action === "ack") {
      channel.ack(msg);
      return;
    }

    if (result.action === "nack_requeue") {
      if (retryCount >= MAX_RETRIES) {
        logger.error("Media optimize max retries exceeded, routing to DLQ", { messageId, status: result.status });
        await moveToDlq(`MAX_RETRIES_${result.status.toUpperCase()}`, `Max retries exceeded: ${result.status}`);
        return;
      }

      logger.warn("Media optimize worker requested retry", { messageId, status: result.status, retryCount: retryCount + 1 });
      await moveToRetryQueue({
        channel,
        msg,
        queue: optimizeQueue,
        retryQueuePrefix: "media.asset.optimize.retry",
        retryCount
      });
      return;
    }

    await moveToDlq(`WORKER_NACK_DLQ_${result.status.toUpperCase()}`, `Worker requested DLQ: ${result.status}`);
  } catch (error) {
    logger.error("Unhandled exception in Media Optimize consumer loop", {
      messageId,
      error: error instanceof Error ? error.message : String(error)
    });
    if (retryCount >= MAX_RETRIES) {
      await moveToDlq("UNHANDLED_EXCEPTION", error instanceof Error ? error.message : String(error));
      return;
    }
    await moveToRetryQueue({
      channel,
      msg,
      queue: optimizeQueue,
      retryQueuePrefix: "media.asset.optimize.retry",
      retryCount
    });
  }
}

export async function createMediaPipelineRabbitmqConsumer(
  rabbitmqUrl: string,
  ingestWorker: MediaAssetIngestWorker,
  optimizeWorker: MediaAssetOptimizeWorker,
  logger: Logger
): Promise<MediaQueueConsumer> {
  let connection: MediaConnection | null = null;
  let channel: MediaConsumerChannel | null = null;
  let isStopping = false;

  return {
    async start(): Promise<void> {
      logger.info("Initializing Media Ingestion & Optimization RabbitMQ consumers...");
      connection = await connectRabbitMq(rabbitmqUrl);
      channel = await connection.createConfirmChannel();

      await channel.assertExchange(exchange, "topic", { durable: true });

      // Ingest Queue
      await channel.assertQueue(ingestQueue, { durable: true });
      await channel.bindQueue(ingestQueue, exchange, ingestRoutingKey);
      await channel.assertQueue(ingestDlq, { durable: true });

      // Optimize Queue
      await channel.assertQueue(optimizeQueue, { durable: true });
      await channel.bindQueue(optimizeQueue, exchange, optimizeRoutingKey);
      await channel.assertQueue(optimizeDlq, { durable: true });

      await channel.prefetch(1);

      await channel.consume(ingestQueue, async (msg: amqp.ConsumeMessage | null) => {
        if (!msg || !channel) return;
        await handleIngestQueueMessage(channel, ingestWorker, logger, msg, () => isStopping);
      });

      await channel.consume(optimizeQueue, async (msg: amqp.ConsumeMessage | null) => {
        if (!msg || !channel) return;
        await handleOptimizeQueueMessage(channel, optimizeWorker, logger, msg, () => isStopping);
      });
    },

    async stop(): Promise<void> {
      if (isStopping) return;
      isStopping = true;
      logger.info("Stopping Media Ingestion & Optimization RabbitMQ consumers...");

      if (channel) {
        await channel.close().catch((error) => {
          logger.error("Error closing Media RabbitMQ channel", { error: String(error) });
        });
      }
      if (connection) {
        await connection.close().catch((error) => {
          logger.error("Error closing Media RabbitMQ connection", { error: String(error) });
        });
      }
    }
  };
}
