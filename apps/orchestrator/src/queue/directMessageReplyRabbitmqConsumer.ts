import amqp from "amqplib";
import type { ChannelModel, ConfirmChannel } from "amqplib";
import { DirectMessageReplyRequestedEventSchema } from "@mediaops/shared-contracts";
import type { Logger } from "../lib/logger.js";
import type { DirectMessageReplyWorker } from "../workers/directMessageReplyWorker.js";
import { CANONICAL_TOPIC_EXCHANGE } from "./topologyConfig.js";

export interface DirectMessageReplyQueueConsumer {
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

const queue = "dm.reply.requested";
const dlqQueue = "dm.reply.requested.dlq";
const connectRabbitMq = amqp.connect as (url: string) => Promise<any>;

const MAX_RETRIES = 5;

async function moveToDlq(
  channel: ConfirmChannel,
  msg: amqp.ConsumeMessage,
  messageId: string,
  contentStr: string,
  errorCode: string,
  errorMessage: string
): Promise<void> {
  const safeMsg = msg as SafeConsumeMessage;
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

interface ProcessMessageParams {
  channel: ConfirmChannel;
  worker: DirectMessageReplyWorker;
  logger: Logger;
  msg: amqp.ConsumeMessage;
  workspaceId: string;
  messageId: string;
  contentStr: string;
  headers: Record<string, unknown>;
  retryCount: number;
}

async function processMessage({
  channel,
  worker,
  logger,
  msg,
  workspaceId,
  messageId,
  contentStr,
  headers,
  retryCount
}: ProcessMessageParams): Promise<void> {
  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(contentStr);
  } catch {
    await moveToDlq(channel, msg, messageId, contentStr, "MALFORMED_JSON", "Invalid JSON format");
    return;
  }

  const validation = DirectMessageReplyRequestedEventSchema.safeParse(rawPayload);
  if (!validation.success) {
    await moveToDlq(channel, msg, messageId, contentStr, "VALIDATION_FAILED", JSON.stringify(validation.error.flatten()));
    return;
  }

  const event = validation.data;

  if (event.workspace_id !== workspaceId) {
    logger.warn("Ignoring direct message reply for different workspace", {
      messageId,
      messageWorkspaceId: event.workspace_id,
      workerWorkspaceId: workspaceId
    });
    channel.ack(msg);
    return;
  }

  const result = await worker.processQueueMessage(event, messageId);

  if (result.action === "ack") {
    channel.ack(msg);
  } else if (result.action === "nack_requeue") {
    if (retryCount >= MAX_RETRIES) {
      logger.error("Direct Message Reply max retries exceeded, routing to DLQ", { messageId, status: result.status });
      await moveToDlq(channel, msg, messageId, contentStr, "MAX_RETRIES_EXCEEDED", `Worker status: ${result.status}`);
    } else {
      const backoffMs = (2 ** retryCount) * 1000;
      logger.warn("Requeueing direct message reply message with backoff", {
        messageId,
        retryCount: retryCount + 1,
        backoffMs,
        status: result.status
      });

      const newHeaders = { ...headers, "x-retries": retryCount + 1 };
      const retryQueueName = `dm.reply.requested.retry.${backoffMs}`;

      await channel.assertQueue(retryQueueName, {
        durable: true,
        deadLetterExchange: "",
        deadLetterRoutingKey: queue,
        messageTtl: backoffMs
      });

      channel.sendToQueue(retryQueueName, msg.content, {
        ...msg.properties,
        headers: newHeaders
      });
      await channel.waitForConfirms();
      channel.ack(msg);
    }
  } else {
    logger.error("Direct Message Reply worker failed terminally, routing to DLQ", { messageId, status: result.status });
    await moveToDlq(channel, msg, messageId, contentStr, "WORKER_NACK_DLQ", `Worker status: ${result.status}`);
  }
}

export async function handleDirectMessageReplyQueueMessage(
  channel: ConfirmChannel,
  worker: DirectMessageReplyWorker,
  logger: Logger,
  msg: amqp.ConsumeMessage,
  isStopping: () => boolean,
  workspaceId: string
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

  try {
    await processMessage({
      channel,
      worker,
      logger,
      msg,
      workspaceId,
      messageId,
      contentStr,
      headers,
      retryCount
    });
  } catch (error) {
    logger.error("Failed to parse or process Direct Message Reply queue message", {
      messageId,
      error: error instanceof Error ? error.message : String(error)
    });
    await moveToDlq(channel, msg, messageId, contentStr, "UNHANDLED_EXCEPTION", error instanceof Error ? error.message : String(error));
  }
}

export async function createDirectMessageReplyRabbitmqConsumer(
  rabbitmqUrl: string,
  worker: DirectMessageReplyWorker,
  logger: Logger,
  workspaceId: string
): Promise<DirectMessageReplyQueueConsumer> {
  let connection: ChannelModel | null = null;
  let channel: ConfirmChannel | null = null;
  let isStopping = false;

  return {
    async start(): Promise<void> {
      logger.info("Initializing Facebook Direct Message Reply RabbitMQ consumer...");
      connection = await connectRabbitMq(rabbitmqUrl);
      if (!connection) throw new Error("Failed to connect to RabbitMQ");
      channel = await connection.createConfirmChannel();

      await channel.assertExchange(CANONICAL_TOPIC_EXCHANGE, "topic", { durable: true });
      await channel.assertQueue(queue, { durable: true });
      await channel.bindQueue(queue, CANONICAL_TOPIC_EXCHANGE, "dm.reply.requested");
      await channel.assertQueue(dlqQueue, { durable: true });
      await channel.prefetch(1);

      await channel.consume(queue, async (msg: amqp.ConsumeMessage | null) => {
        if (!msg || !channel) return;
        await handleDirectMessageReplyQueueMessage(channel, worker, logger, msg, () => isStopping, workspaceId);
      });

      logger.info(`Started Direct Message Reply consumer for workspace ${workspaceId} on queue ${queue}`);
    },

    async stop(): Promise<void> {
      if (isStopping) return;
      isStopping = true;
      logger.info("Stopping Facebook Direct Message Reply consumer...");

      const ch = channel;
      if (ch) {
        await ch.close().catch((error) => { logger.error("Error closing channel", { error: String(error) }); });
      }
      const conn = connection;
      if (conn) {
        await conn.close().catch((error) => { logger.error("Error closing connection", { error: String(error) }); });
      }
    }
  };
}
