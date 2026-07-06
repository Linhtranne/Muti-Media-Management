import amqp from "amqplib";
import { PublishTiktokStatusCheckEventSchema } from "@mediaops/shared-contracts";
import type { Logger } from "../lib/logger.js";
import type { TiktokStatusCheckWorker } from "../workers/tiktokStatusCheckWorker.js";

export interface TiktokStatusCheckQueueConsumerChannel {
  assertExchange(exchange: string, type: string, options: { durable: boolean }): Promise<unknown>;
  assertQueue(queue: string, options: { durable: boolean; deadLetterExchange?: string; deadLetterRoutingKey?: string; messageTtl?: number }): Promise<unknown>;
  bindQueue(queue: string, exchange: string, routingKey: string): Promise<unknown>;
  prefetch(count: number): Promise<unknown>;
  consume(queue: string, handler: (msg: amqp.ConsumeMessage | null) => Promise<void>): Promise<unknown>;
  sendToQueue(queue: string, content: Buffer, options: Record<string, unknown>): boolean;
  waitForConfirms(): Promise<void>;
  ack(msg: amqp.Message): void;
  nack(msg: amqp.Message, allUpTo?: boolean, requeue?: boolean): void;
  close(): Promise<void>;
}

export interface TiktokStatusCheckQueueConnection {
  createConfirmChannel(): Promise<TiktokStatusCheckQueueConsumerChannel>;
  close(): Promise<void>;
}

export interface TiktokStatusCheckQueueConsumer {
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

const exchange = "publish.workflows";
const queue = "publish.tiktok.status_check";
const routingKey = "publish.tiktok.status_check";
const dlqQueue = "publish.tiktok.status_check.dlq";
const connectRabbitMq = amqp.connect as (url: string) => Promise<TiktokStatusCheckQueueConnection>;

const MAX_RETRIES = 5;

function retryCountFromHeaders(headers: Record<string, unknown> | undefined): number {
  const value = headers?.["x-retry-count"];
  return typeof value === "number" ? value : 0;
}

export async function handleTiktokStatusCheckQueueMessage(
  channel: TiktokStatusCheckQueueConsumerChannel,
  worker: Pick<TiktokStatusCheckWorker, "processQueueMessage">,
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
  const retryCount = retryCountFromHeaders(safeMsg.properties.headers);

  async function moveToDlq(errorCode: string, errorMessage: string): Promise<void> {
    let safePayloadRefs: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(contentStr) as Record<string, unknown>;
      safePayloadRefs = {
        job_id: parsed.job_id || parsed.jobId,
        variant_id: parsed.variant_id || parsed.variantId,
        workspace_id: parsed.workspace_id || parsed.workspaceId,
        event_id: parsed.event_id || parsed.eventId,
        event_type: parsed.event_type || parsed.eventType
      };
    } catch {
      // Ignore parse failure, keep refs empty
    }

    const dlqPayload = {
      original_message_id: messageId,
      correlation_id: safeMsg.properties.correlationId,
      routing_key: safeMsg.fields.routingKey,
      error_code: errorCode,
      error_message: errorMessage,
      moved_at: new Date().toISOString(),
      payload_refs: safePayloadRefs
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

    const validation = PublishTiktokStatusCheckEventSchema.safeParse(rawPayload);
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
        logger.error("TikTok Status Check worker requested requeue, but max retries exceeded, routing to DLQ", { messageId, status: result.status });
        await moveToDlq("MAX_RETRIES_EXCEEDED", `Max retries ${String(MAX_RETRIES)} exceeded: worker status ${result.status}`);
      } else {
        const backoffMs = (2 ** retryCount) * 1000;
        logger.warn("Requeueing TikTok Status Check message with backoff", {
          messageId,
          retryCount: retryCount + 1,
          backoffMs,
          status: result.status
        });
        
        const newHeaders = { ...safeMsg.properties.headers, "x-retry-count": retryCount + 1 };
        const retryQueueName = `${queue}.retry.${String(backoffMs)}`;
        
        await channel.assertQueue(retryQueueName, {
          durable: true,
          deadLetterExchange: "",
          deadLetterRoutingKey: queue,
          messageTtl: backoffMs
        });
        
        channel.sendToQueue(retryQueueName, msg.content, {
          ...safeMsg.properties,
          headers: newHeaders
        });
        await channel.waitForConfirms();
        channel.ack(msg);
      }
      return;
    }

    await moveToDlq(`WORKER_NACK_DLQ_${result.status.toUpperCase()}`, `Worker requested DLQ: ${result.status}`);
  } catch (error) {
    logger.error("Unhandled exception in TikTok Status Check consumer loop", {
      messageId,
      error: error instanceof Error ? error.message : String(error)
    });
    if (retryCount >= MAX_RETRIES) {
      logger.error("TikTok Status Check max retries exceeded on unhandled exception, routing to DLQ", { messageId });
      await moveToDlq("UNHANDLED_EXCEPTION_MAX_RETRIES", error instanceof Error ? error.message : String(error));
    } else {
      const backoffMs = (2 ** retryCount) * 1000;
      const newHeaders = { ...safeMsg.properties.headers, "x-retry-count": retryCount + 1 };
      const retryQueueName = `${queue}.retry.${String(backoffMs)}`;
      
      await channel.assertQueue(retryQueueName, {
        durable: true,
        deadLetterExchange: "",
        deadLetterRoutingKey: queue,
        messageTtl: backoffMs
      });
      
      channel.sendToQueue(retryQueueName, msg.content, {
        ...safeMsg.properties,
        headers: newHeaders
      });
      await channel.waitForConfirms();
      channel.ack(msg);
    }
  }
}

export async function createTiktokStatusCheckRabbitMqConsumer(
  rabbitmqUrl: string,
  worker: TiktokStatusCheckWorker,
  logger: Logger
): Promise<TiktokStatusCheckQueueConsumer> {
  let connection: TiktokStatusCheckQueueConnection | null = null;
  let channel: TiktokStatusCheckQueueConsumerChannel | null = null;
  let isStopping = false;

  return {
    async start(): Promise<void> {
      logger.info("Initializing TikTok Status Check RabbitMQ consumer...");
      connection = await connectRabbitMq(rabbitmqUrl);
      channel = await connection.createConfirmChannel();

      await channel.assertExchange(exchange, "topic", { durable: true });
      await channel.assertQueue(queue, { durable: true });
      await channel.bindQueue(queue, exchange, routingKey);
      await channel.assertQueue(dlqQueue, { durable: true });
      await channel.prefetch(1);

      await channel.consume(queue, async (msg: amqp.ConsumeMessage | null) => {
        if (!msg || !channel) return;
        await handleTiktokStatusCheckQueueMessage(channel, worker, logger, msg, () => isStopping);
      });
    },

    async stop(): Promise<void> {
      if (isStopping) return;
      isStopping = true;
      logger.info("Stopping TikTok Status Check RabbitMQ consumer...");

      if (channel) {
        await channel.close().catch((error) => { logger.error("Error closing TikTok Status Check RabbitMQ channel", { error: String(error) }); });
      }
      if (connection) {
        await connection.close().catch((error) => { logger.error("Error closing TikTok Status Check RabbitMQ connection", { error: String(error) }); });
      }
    }
  };
}
