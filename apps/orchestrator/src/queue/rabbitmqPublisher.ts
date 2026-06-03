import amqp from "amqplib";
import type {
  AirtableApprovedQueueMessage,
  AiComposerQueueMessage,
  PublishFacebookExecuteEvent,
  PublishFacebookRequestedEvent,
  PublishFacebookValidatedEvent,
  SlackCommandActionEvent,
  SlackCommentActionEvent,
  CommentSyncRequestedEvent,
  CommentIngestEvent,
  CanonicalEventEnvelope
} from "@mediaops/shared-contracts";
import { assertNoForbiddenFields } from "@mediaops/shared-contracts";
import { CANONICAL_TOPIC_EXCHANGE } from "./topologyConfig.js";

export interface QueuePublisher {
  publishApprovedPost(message: AirtableApprovedQueueMessage, messageId: string): Promise<void>;
  publishAiComposerRequest(message: AiComposerQueueMessage, messageId: string): Promise<void>;
  publishFacebookRequest(message: PublishFacebookRequestedEvent, messageId: string): Promise<void>;
  publishFacebookValidated(message: PublishFacebookValidatedEvent, messageId: string): Promise<void>;
  publishFacebookExecute(message: PublishFacebookExecuteEvent, messageId: string): Promise<void>;
  publishSlackAlert(message: Record<string, unknown>, messageId: string, correlationId?: string): Promise<void>;
  publishSlackCommandAction(message: SlackCommandActionEvent, messageId: string): Promise<void>;
  publishSlackCommentAction(message: SlackCommentActionEvent, messageId: string): Promise<void>;
  publishCommentSyncRequest(message: CommentSyncRequestedEvent, messageId: string): Promise<void>;
  publishCommentIngest(message: CommentIngestEvent, messageId: string): Promise<void>;
  /** US-014: Publish a canonical event to the mediaops.events.topic exchange */
  publishCanonicalEvent(envelope: CanonicalEventEnvelope, routingKey: string): Promise<void>;
}

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
  const slackExchange = "slack.workflows";
  const slackCommandQueue = "slack.post_approval.requested";
  const slackCommandRoutingKey = "slack.post_approval.requested";

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
  await channel.assertExchange(slackExchange, "topic", { durable: true });
  await channel.assertQueue(slackCommandQueue, { durable: true });
  await channel.bindQueue(slackCommandQueue, slackExchange, slackCommandRoutingKey);

  const slackCommentActionQueue = "slack.comment_action.requested";
  const slackCommentActionRoutingKey = "slack.comment_action.requested";
  await channel.assertQueue(slackCommentActionQueue, { durable: true });
  await channel.bindQueue(slackCommentActionQueue, slackExchange, slackCommentActionRoutingKey);

  await channel.assertExchange("comments.workflows", "topic", { durable: true });

  // US-014: Assert canonical topic exchange (additive — does not break legacy)
  await channel.assertExchange(CANONICAL_TOPIC_EXCHANGE, "topic", { durable: true });

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

    async publishFacebookValidated(message: PublishFacebookValidatedEvent, messageId: string): Promise<void> {
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

    async publishFacebookExecute(message: PublishFacebookExecuteEvent, messageId: string): Promise<void> {
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
    },

    async publishSlackCommandAction(message: SlackCommandActionEvent, messageId: string): Promise<void> {
      const body = Buffer.from(JSON.stringify(message));
      const ok = channel.publish(slackExchange, slackCommandRoutingKey, body, {
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

    async publishSlackCommentAction(message: SlackCommentActionEvent, messageId: string): Promise<void> {
      const body = Buffer.from(JSON.stringify(message));
      const ok = channel.publish(slackExchange, slackCommentActionRoutingKey, body, {
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

    async publishCommentSyncRequest(message: CommentSyncRequestedEvent, messageId: string): Promise<void> {
      const body = Buffer.from(JSON.stringify(message));
      // Ensure comments exchange exists. Our consumers will assert it, but publisher should just publish.
      const commentsExchange = "comments.workflows";
      const commentsRoutingKey = "comments.facebook.sync.requested";
      
      const ok = channel.publish(commentsExchange, commentsRoutingKey, body, {
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

    async publishCommentIngest(message: CommentIngestEvent, messageId: string): Promise<void> {
      const body = Buffer.from(JSON.stringify(message));
      const commentsExchange = "comments.workflows";
      const commentsRoutingKey = "comments.facebook.ingest";
      
      const ok = channel.publish(commentsExchange, commentsRoutingKey, body, {
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

    // ── US-014: Canonical Event Publisher ───────────────────────────────────
    async publishCanonicalEvent(envelope: CanonicalEventEnvelope, routingKey: string): Promise<void> {
      // Security guard: reject any message containing forbidden fields
      assertNoForbiddenFields(envelope, "canonical_envelope");
      assertNoForbiddenFields(envelope.payload, "canonical_envelope.payload");

      const body = Buffer.from(JSON.stringify(envelope));
      const ok = channel.publish(CANONICAL_TOPIC_EXCHANGE, routingKey, body, {
        contentType: "application/json",
        deliveryMode: 2,
        messageId: envelope.event_id,
        correlationId: envelope.correlation_id,
        type: envelope.event_type,
        timestamp: Math.floor(Date.now() / 1000)
      });

      if (!ok) {
        await new Promise((resolve) => channel.once("drain", resolve));
      }

      await channel.waitForConfirms();
    }
  };
}
