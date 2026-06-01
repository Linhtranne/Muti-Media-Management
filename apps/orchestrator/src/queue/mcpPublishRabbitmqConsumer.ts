import amqp from "amqplib";
import { PublishFacebookExecuteEventSchema } from "@mediaops/shared-contracts";
import type { Logger } from "../lib/logger.js";
import type { McpPublishWorker } from "../workers/mcpPublishWorker.js";

export type McpPublishQueueConsumerChannel = {
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
};

export type McpPublishQueueConnection = {
  createConfirmChannel(): Promise<McpPublishQueueConsumerChannel>;
  close(): Promise<void>;
};

export type McpPublishQueueConsumer = {
  start(): Promise<void>;
  stop(): Promise<void>;
};

const exchange = "publish.workflows";
const queue = "publish.facebook.execute";
const routingKey = "publish.facebook.execute";
const dlqQueue = "publish.facebook.execute.dlq";

export async function handleMcpPublishQueueMessage(
  channel: McpPublishQueueConsumerChannel,
  worker: Pick<McpPublishWorker, "processQueueMessage">,
  logger: Logger,
  msg: amqp.ConsumeMessage,
  isStopping: () => boolean
): Promise<void> {
  if (isStopping()) {
    channel.nack(msg, false, true);
    return;
  }

  const messageId = msg.properties.messageId || "unknown-msg-id";
  const contentStr = msg.content.toString();

  async function moveToDlq(errorCode: string, errorMessage: string): Promise<void> {
    const dlqPayload = {
      original_message_id: messageId,
      correlation_id: msg.properties.correlationId,
      routing_key: msg.fields.routingKey,
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
        x_original_exchange: msg.fields.exchange,
        x_original_routing_key: msg.fields.routingKey,
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

    const validation = PublishFacebookExecuteEventSchema.safeParse(rawPayload);
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
      logger.warn("MCP Publish worker requested requeue", { messageId, status: result.status });
      channel.nack(msg, false, true);
      return;
    }

    await moveToDlq(`WORKER_NACK_DLQ_${result.status.toUpperCase()}`, `Worker requested DLQ: ${result.status}`);
  } catch (error) {
    logger.error("Unhandled exception in MCP Publish consumer loop, requeuing message", {
      messageId,
      error: error instanceof Error ? error.message : String(error)
    });
    channel.nack(msg, false, true);
  }
}

export async function createMcpPublishRabbitMqConsumer(
  rabbitmqUrl: string,
  worker: McpPublishWorker,
  logger: Logger
): Promise<McpPublishQueueConsumer> {
  let connection: McpPublishQueueConnection | null = null;
  let channel: McpPublishQueueConsumerChannel | null = null;
  let isStopping = false;

  return {
    async start(): Promise<void> {
      logger.info("Initializing MCP Publish RabbitMQ consumer...");
      connection = await amqp.connect(rabbitmqUrl) as unknown as McpPublishQueueConnection;
      channel = await connection.createConfirmChannel();

      await channel.assertExchange(exchange, "topic", { durable: true });
      await channel.assertQueue(queue, { durable: true });
      await channel.bindQueue(queue, exchange, routingKey);
      await channel.assertQueue(dlqQueue, { durable: true });
      await channel.prefetch(1);

      await channel.consume(queue, async (msg: amqp.ConsumeMessage | null) => {
        if (!msg || !channel) return;
        await handleMcpPublishQueueMessage(channel, worker, logger, msg, () => isStopping);
      });
    },

    async stop(): Promise<void> {
      if (isStopping) return;
      isStopping = true;
      logger.info("Stopping MCP Publish RabbitMQ consumer...");

      if (channel) {
        await channel.close().catch((error) => logger.error("Error closing MCP Publish RabbitMQ channel", { error: String(error) }));
      }
      if (connection) {
        await connection.close().catch((error) => logger.error("Error closing MCP Publish RabbitMQ connection", { error: String(error) }));
      }
    }
  };
}
