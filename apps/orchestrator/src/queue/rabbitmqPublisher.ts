import amqp from "amqplib";
import type { AirtableApprovedQueueMessage } from "@mediaops/shared-contracts";

export type QueuePublisher = {
  publishApprovedPost(message: AirtableApprovedQueueMessage, messageId: string): Promise<void>;
};

export async function createRabbitMqPublisher(rabbitmqUrl: string): Promise<QueuePublisher> {
  const connection = await amqp.connect(rabbitmqUrl);
  const channel = await connection.createConfirmChannel();

  const exchange = "airtable.webhooks";
  const queue = "airtable.webhook.approved";
  const routingKey = "airtable.post.approved.ingress";

  await channel.assertExchange(exchange, "topic", { durable: true });
  await channel.assertQueue(queue, { durable: true });
  await channel.bindQueue(queue, exchange, routingKey);

  return {
    async publishApprovedPost(message: AirtableApprovedQueueMessage, messageId: string): Promise<void> {
      const body = Buffer.from(JSON.stringify(message));
      const ok = channel.publish(exchange, routingKey, body, {
        contentType: "application/json",
        deliveryMode: 2,
        messageId,
        correlationId: message.correlation_id,
        type: message.event_type,
        timestamp: Math.floor(Date.now() / 1000)
      });

      if (!ok) {
        await new Promise((resolve) => channel.once("drain", resolve));
      }

      await channel.waitForConfirms();
    }
  };
}

