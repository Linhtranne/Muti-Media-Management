import amqp from "amqplib";
import type { AirtableApprovedQueueMessage, AiComposerQueueMessage, PublishFacebookRequestedEvent } from "@mediaops/shared-contracts";

export type QueuePublisher = {
  publishApprovedPost(message: AirtableApprovedQueueMessage, messageId: string): Promise<void>;
  publishAiComposerRequest(message: AiComposerQueueMessage, messageId: string): Promise<void>;
  publishFacebookRequest(message: PublishFacebookRequestedEvent, messageId: string): Promise<void>;
  publishFacebookValidated(message: import("@mediaops/shared-contracts").PublishFacebookValidatedEvent, messageId: string): Promise<void>;
  publishFacebookExecute(message: import("@mediaops/shared-contracts").PublishFacebookExecuteEvent, messageId: string): Promise<void>;
  publishSlackAlert(message: Record<string, unknown>, messageId: string, correlationId?: string): Promise<void>;
};

export async function createRabbitMqPublisher(rabbitmqUrl: string): Promise<QueuePublisher> {
  const connection = await amqp.connect(rabbitmqUrl);
  const channel = await connection.createConfirmChannel();

  const exchange = "airtable.webhooks";
  const queue = "airtable.webhook.approved";
  const routingKey = "airtable.post.approved.ingress";
  const aiExchange = "ai.workflows";
  const aiQueue = "ai.compose.facebook.requested";
  const aiRoutingKey = "ai.compose.facebook.requested";
  const publishExchange = "publish.workflows";
  const publishQueue = "publish.facebook.requested";
  const publishRoutingKey = "publish.facebook.requested";
  const alertsExchange = "alerts";
  const slackAlertQueue = "alerts.slack.send";
  const slackAlertRoutingKey = "alerts.slack.send";

  await channel.assertExchange(exchange, "topic", { durable: true });
  await channel.assertQueue(queue, { durable: true });
  await channel.bindQueue(queue, exchange, routingKey);
  await channel.assertExchange(aiExchange, "topic", { durable: true });
  await channel.assertQueue(aiQueue, { durable: true });
  await channel.bindQueue(aiQueue, aiExchange, aiRoutingKey);
  await channel.assertExchange(publishExchange, "topic", { durable: true });
  await channel.assertQueue(publishQueue, { durable: true });
  await channel.bindQueue(publishQueue, publishExchange, publishRoutingKey);
  await channel.assertExchange(alertsExchange, "topic", { durable: true });
  await channel.assertQueue(slackAlertQueue, { durable: true });
  await channel.bindQueue(slackAlertQueue, alertsExchange, slackAlertRoutingKey);

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
    },

    async publishAiComposerRequest(message: AiComposerQueueMessage, messageId: string): Promise<void> {
      const body = Buffer.from(JSON.stringify(message));
      const ok = channel.publish(aiExchange, aiRoutingKey, body, {
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
    },

    async publishFacebookRequest(message: PublishFacebookRequestedEvent, messageId: string): Promise<void> {
      const body = Buffer.from(JSON.stringify(message));
      const ok = channel.publish(publishExchange, publishRoutingKey, body, {
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
    },

    async publishSlackAlert(message: Record<string, unknown>, messageId: string, correlationId?: string): Promise<void> {
      const body = Buffer.from(JSON.stringify(message));
      const ok = channel.publish(alertsExchange, slackAlertRoutingKey, body, {
        contentType: "application/json",
        deliveryMode: 2,
        messageId,
        correlationId,
        type: "alerts.slack.send",
        timestamp: Math.floor(Date.now() / 1000)
      });

      if (!ok) {
        await new Promise((resolve) => channel.once("drain", resolve));
      }

      await channel.waitForConfirms();
    },

    async publishFacebookValidated(message: import("@mediaops/shared-contracts").PublishFacebookValidatedEvent, messageId: string): Promise<void> {
      const body = Buffer.from(JSON.stringify(message));
      const ok = channel.publish(publishExchange, "publish.facebook.validated", body, {
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
    },

    async publishFacebookExecute(message: import("@mediaops/shared-contracts").PublishFacebookExecuteEvent, messageId: string): Promise<void> {
      const body = Buffer.from(JSON.stringify(message));
      const ok = channel.publish(publishExchange, "publish.facebook.execute", body, {
        contentType: "application/json",
        deliveryMode: 2,
        messageId,
        correlationId: message.correlationId,
        type: message.eventType,
        timestamp: Math.floor(Date.now() / 1000)
      });

      if (!ok) {
        await new Promise((resolve) => channel.once("drain", resolve));
      }

      await channel.waitForConfirms();
    }
  };
}
