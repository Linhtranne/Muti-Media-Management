import amqp from "amqplib";
import { AirtableApprovedQueueMessageSchema, type AirtableApprovedQueueMessage } from "@mediaops/shared-contracts";
import type { ApprovedPostWorker } from "../workers/approvedPostWorker.js";
import type { Logger } from "../lib/logger.js";

export type QueueConsumer = {
  start(): Promise<void>;
  stop(): Promise<void>;
};

export async function createRabbitMqConsumer(
  rabbitmqUrl: string,
  worker: ApprovedPostWorker,
  logger: Logger
): Promise<QueueConsumer> {
  let connection: any = null;
  let channel: any = null;
  let isStopping = false;

  const exchange = "airtable.webhooks";
  const queue = "airtable.webhook.approved";
  const routingKey = "airtable.post.approved.ingress";
  const dlqQueue = "airtable.webhook.approved.dlq";

  async function moveToDlq(msg: amqp.Message, errorCode: string, errorMessage: string): Promise<void> {
    if (!channel) return;

    const messageId = msg.properties.messageId || "unknown-msg-id";
    logger.warn("Moving message to DLQ", { messageId, errorCode, errorMessage });

    try {
      const originalContent = msg.content.toString();
      const dlqPayload = {
        original_message_id: messageId,
        correlation_id: msg.properties.correlationId,
        routing_key: msg.fields.routingKey,
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
          x_original_exchange: msg.fields.exchange,
          x_original_routing_key: msg.fields.routingKey,
          x_dlq_error_code: errorCode,
          x_dlq_error_message: errorMessage
        }
      });

      // Wait for confirms since we are using a confirm channel
      await channel.waitForConfirms();

      // Acknowledge original message once safely published in DLQ
      channel.ack(msg);
      logger.info("Message safely enqueued to DLQ and acknowledged from main queue", { messageId });
    } catch (err) {
      logger.error("Failed to write to DLQ queue! Requeuing message as fallback.", {
        messageId,
        error: String(err)
      });
      // If DLQ write fails, we must NOT lose the message. Requeue to try again.
      channel.nack(msg, false, true);
    }
  }

  return {
    async start(): Promise<void> {
      logger.info("Initializing RabbitMQ consumer...");
      connection = await amqp.connect(rabbitmqUrl);
      channel = await connection.createConfirmChannel();

      // Assert main topology
      await channel.assertExchange(exchange, "topic", { durable: true });
      await channel.assertQueue(queue, { durable: true });
      await channel.bindQueue(queue, exchange, routingKey);

      // Assert DLQ queue
      await channel.assertQueue(dlqQueue, { durable: true });

      // Concurrency control: prefetch 1 message at a time to enforce fair dispatch
      await channel.prefetch(1);

      logger.info("RabbitMQ topology declared. Starting message ingestion...", { queue });

      await channel.consume(queue, async (msg: amqp.ConsumeMessage | null) => {
        if (!msg) {
          logger.warn("Received empty consumer message (null)");
          return;
        }

        if (isStopping) {
          logger.warn("Consumer is stopping, rejecting message for requeue", { messageId: msg.properties.messageId });
          channel.nack(msg, false, true);
          return;
        }

        const messageId = msg.properties.messageId || "unknown-msg-id";
        const contentStr = msg.content.toString();

        try {
          // Parse and validate payload with strict Zod contracts
          let rawPayload: unknown;
          try {
            rawPayload = JSON.parse(contentStr);
          } catch (parseError) {
            logger.error("Malformed JSON in queue message body, routing to DLQ", {
              messageId,
              content: contentStr,
              error: parseError instanceof Error ? parseError.message : String(parseError)
            });
            await moveToDlq(msg, "MALFORMED_JSON", "Invalid JSON format");
            return;
          }

          const validation = AirtableApprovedQueueMessageSchema.safeParse(rawPayload);
          if (!validation.success) {
            logger.error("Zod schema validation failed for queue message, routing to DLQ", {
              messageId,
              errors: validation.error.flatten(),
              payload: rawPayload
            });
            await moveToDlq(msg, "VALIDATION_FAILED", JSON.stringify(validation.error.flatten()));
            return;
          }

          const validatedMessage = validation.data;

          // Delegate to ApprovedPostWorker
          const result = await worker.process(validatedMessage, messageId);

          if (result.action === "ack") {
            channel.ack(msg);
          } else if (result.action === "nack_requeue") {
            logger.warn("Worker returned nack_requeue, sleeping briefly to avoid hot loops", {
              messageId,
              status: result.status
            });
            // Brief 1s delay to protect CPU/logs from a fast hot loop
            await new Promise((resolve) => setTimeout(resolve, 1000));
            channel.nack(msg, false, true);
          } else if (result.action === "nack_dlq") {
            logger.error("Worker returned nack_dlq, routing to DLQ", {
              messageId,
              status: result.status
            });
            await moveToDlq(msg, `WORKER_NACK_DLQ_${result.status.toUpperCase()}`, `Worker requested DLQ: ${result.status}`);
          }
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
      });
    },

    async stop(): Promise<void> {
      if (isStopping) return;
      isStopping = true;
      logger.info("Stopping RabbitMQ consumer (graceful shutdown)...");

      // We close the channel and connection
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
