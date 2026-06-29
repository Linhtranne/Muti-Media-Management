import amqp from "amqplib";
import { AiComposerQueueMessageSchema } from "@mediaops/shared-contracts";
import type { Logger } from "../lib/logger.js";
import type { AiComposerWorker } from "../workers/ai-composer-worker.js";

export interface AiQueueConsumerChannel {
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

export interface AiQueueConnection {
  createConfirmChannel(): Promise<AiQueueConsumerChannel>;
  close(): Promise<void>;
}

export interface AiQueueConsumer {
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
  };
};

const exchange = "ai.workflows";
const queue = "ai.compose.facebook.requested";
const routingKey = "ai.compose.facebook.requested";
const dlqQueue = "ai.compose.facebook.requested.dlq";
const connectRabbitMq = amqp.connect as (url: string) => Promise<AiQueueConnection>;

export async function handleAiComposerQueueMessage(
  channel: AiQueueConsumerChannel,
  worker: Pick<AiComposerWorker, "processQueueMessage">,
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

    const validation = AiComposerQueueMessageSchema.safeParse(rawPayload);
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
      logger.warn("AI Composer worker requested requeue", { messageId, status: result.status });
      channel.nack(msg, false, true);
      return;
    }

    await moveToDlq(`WORKER_NACK_DLQ_${result.status.toUpperCase()}`, `Worker requested DLQ: ${result.status}`);
  } catch (error) {
    logger.error("Unhandled exception in AI Composer consumer loop, requeuing message", {
      messageId,
      error: error instanceof Error ? error.message : String(error)
    });
    channel.nack(msg, false, true);
  }
}

export async function createAiComposerRabbitMqConsumer(
  rabbitmqUrl: string,
  worker: AiComposerWorker,
  logger: Logger
): Promise<AiQueueConsumer> {
  let connection: AiQueueConnection | null = null;
  let channel: AiQueueConsumerChannel | null = null;
  let isStopping = false;

  return {
    async start(): Promise<void> {
      logger.info("Initializing AI Composer RabbitMQ consumer...");
      connection = await connectRabbitMq(rabbitmqUrl);
      channel = await connection.createConfirmChannel();

      await channel.assertExchange(exchange, "topic", { durable: true });
      await channel.assertQueue(queue, { durable: true });
      await channel.bindQueue(queue, exchange, routingKey);
      await channel.assertQueue(dlqQueue, { durable: true });
      await channel.prefetch(1);

      await channel.consume(queue, async (msg: amqp.ConsumeMessage | null) => {
        if (!msg || !channel) return;
        await handleAiComposerQueueMessage(channel, worker, logger, msg, () => isStopping);
      });
    },

    async stop(): Promise<void> {
      if (isStopping) return;
      isStopping = true;
      logger.info("Stopping AI Composer RabbitMQ consumer...");

      if (channel) {
        await channel.close().catch((error) => { logger.error("Error closing AI Composer RabbitMQ channel", { error: String(error) }); });
      }
      if (connection) {
        await connection.close().catch((error) => { logger.error("Error closing AI Composer RabbitMQ connection", { error: String(error) }); });
      }
    }
  };
}
