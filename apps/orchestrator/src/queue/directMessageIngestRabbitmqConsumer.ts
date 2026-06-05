import amqp from "amqplib";
import type { ChannelModel, ConfirmChannel } from "amqplib";
import { DirectMessageIngestEventSchema } from "@mediaops/shared-contracts";
import type { Logger } from "../lib/logger.js";
import type { DirectMessageIngestWorker } from "../workers/directMessageIngestWorker.js";
import { CANONICAL_TOPIC_EXCHANGE } from "./topologyConfig.js";

export interface DirectMessageIngestQueueConsumer {
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

const queue = "dm.facebook.ingest";
const dlqQueue = "dm.facebook.ingest.dlq";
const connectRabbitMq = amqp.connect as (url: string) => Promise<any>;

const MAX_RETRIES = 5;

export async function handleDirectMessageIngestQueueMessage(
  channel: ConfirmChannel,
  worker: DirectMessageIngestWorker,
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

    const validation = DirectMessageIngestEventSchema.safeParse(rawPayload);
    if (!validation.success) {
      await moveToDlq("VALIDATION_FAILED", JSON.stringify(validation.error.flatten()));
      return;
    }

    const event = validation.data;

    if (event.workspace_id !== workspaceId) {
      logger.warn("Ignoring direct message ingest for different workspace", {
        messageId,
        messageWorkspaceId: event.workspace_id,
        workerWorkspaceId: workspaceId
      });
      channel.ack(msg);
      return;
    }

    const result = await worker.processIngestEvent(event, messageId);

    if (result.action === "ack") {
      channel.ack(msg);
    } else if (result.action === "nack_requeue") {
      await handleRequeue({
        channel,
        msg,
        queue,
        messageId,
        retryCount,
        headers,
        status: result.status,
        logger,
        moveToDlq
      });
    } else {
      logger.error("Direct Message Ingest worker failed terminally, routing to DLQ", { messageId, status: result.status });
      await moveToDlq("WORKER_NACK_DLQ", `Worker status: ${result.status}`);
    }
  } catch (error) {
    logger.error("Failed to parse or process Direct Message Ingest queue message", {
      messageId,
      error: error instanceof Error ? error.message : String(error)
    });
    await moveToDlq("UNHANDLED_EXCEPTION", error instanceof Error ? error.message : String(error));
  }
}

async function handleRequeue(params: {
  channel: ConfirmChannel;
  msg: amqp.ConsumeMessage;
  queue: string;
  messageId: string;
  retryCount: number;
  headers: Record<string, unknown>;
  status: string;
  logger: Logger;
  moveToDlq: (code: string, errorMsg: string) => Promise<void>;
}): Promise<void> {
  const {
    channel,
    msg,
    queue,
    messageId,
    retryCount,
    headers,
    status,
    logger,
    moveToDlq
  } = params;

  if (retryCount >= MAX_RETRIES) {
    logger.error("Direct Message Ingest max retries exceeded, routing to DLQ", { messageId, status });
    await moveToDlq("MAX_RETRIES_EXCEEDED", `Worker status: ${status}`);
    return;
  }

  const backoffMs = (2 ** retryCount) * 1000;
  logger.warn("Requeueing direct message ingest message with backoff", {
    messageId,
    retryCount: retryCount + 1,
    backoffMs,
    status
  });

  const newHeaders = { ...headers, "x-retries": retryCount + 1 };
  const retryQueueName = `dm.facebook.ingest.retry.${backoffMs}`;

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

export async function createDirectMessageIngestRabbitmqConsumer(
  rabbitmqUrl: string,
  worker: DirectMessageIngestWorker,
  logger: Logger,
  workspaceId: string
): Promise<DirectMessageIngestQueueConsumer> {
  let connection: ChannelModel | null = null;
  let channel: ConfirmChannel | null = null;
  let isStopping = false;

  return {
    async start(): Promise<void> {
      logger.info("Initializing Facebook Direct Message Ingest RabbitMQ consumer...");
      connection = await connectRabbitMq(rabbitmqUrl);
      channel = await connection!.createConfirmChannel();

      await channel.assertExchange(CANONICAL_TOPIC_EXCHANGE, "topic", { durable: true });
      await channel.assertQueue(queue, { durable: true });
      await channel.bindQueue(queue, CANONICAL_TOPIC_EXCHANGE, "dm.facebook.ingest");
      await channel.assertQueue(dlqQueue, { durable: true });
      await channel.prefetch(5);

      await channel.consume(queue, async (msg: amqp.ConsumeMessage | null) => {
        if (!msg || !channel) return;
        await handleDirectMessageIngestQueueMessage(channel, worker, logger, msg, () => isStopping, workspaceId);
      });

      logger.info(`Started Direct Message Ingest consumer for workspace ${workspaceId} on queue ${queue}`);
    },

    async stop(): Promise<void> {
      if (isStopping) return;
      isStopping = true;
      logger.info("Stopping Facebook Direct Message Ingest consumer...");

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
