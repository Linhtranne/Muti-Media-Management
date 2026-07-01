import amqp from "amqplib";
import type {
  AirtableApprovedQueueMessage,
  AiComposerQueueMessage,
  PolicyEvaluateRequestedEvent,
  PublishFacebookExecuteEvent,
  PublishFacebookRequestedEvent,
  PublishFacebookValidatedEvent,
  SlackCommandActionEvent,
  SlackCommentActionEvent,
  CommentSyncRequestedEvent,
  CommentIngestEvent,
  CanonicalEventEnvelope,
  DirectMessageIngestEvent,
  DirectMessageReplyRequestedEvent
} from "@mediaops/shared-contracts";
import { assertNoForbiddenFields } from "@mediaops/shared-contracts";
import { CANONICAL_TOPIC_EXCHANGE } from "./topologyConfig.js";
import type { Database } from "../ledger/postgres.js";
import type { Logger } from "../lib/logger.js";
import { auditQueuePublished } from "./queueAuditHelper.js";

const SYSTEM_WORKSPACE_ID = "system";
const UNKNOWN_EVENT_TYPE = "unknown";
const JSON_CONTENT_TYPE = "application/json";
const PERSISTENT_DELIVERY_MODE = 2;
const UNIX_MS_PER_SECOND = 1000;

function getStringField(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") {
      return value;
    }
  }
  return undefined;
}

function currentUnixTimestampSeconds(): number {
  return Math.floor(Date.now() / UNIX_MS_PER_SECOND);
}

export interface QueuePublisher {
  publishApprovedPost(message: AirtableApprovedQueueMessage, messageId: string): Promise<void>;
  publishAiComposerRequest(message: AiComposerQueueMessage, messageId: string): Promise<void>;
  publishPolicyEvaluateRequest(message: PolicyEvaluateRequestedEvent, messageId: string): Promise<void>;
  publishFacebookRequest(message: PublishFacebookRequestedEvent, messageId: string): Promise<void>;
  publishFacebookValidated(message: PublishFacebookValidatedEvent, messageId: string): Promise<void>;
  publishFacebookExecute(message: PublishFacebookExecuteEvent, messageId: string): Promise<void>;
  publishSlackAlert(message: Record<string, unknown>, messageId: string, correlationId?: string): Promise<void>;
  publishSlackCommandAction(message: SlackCommandActionEvent, messageId: string): Promise<void>;
  publishSlackCommentAction(message: SlackCommentActionEvent, messageId: string): Promise<void>;
  publishCommentSyncRequest(message: CommentSyncRequestedEvent, messageId: string): Promise<void>;
  publishCommentIngest(message: CommentIngestEvent, messageId: string): Promise<void>;
  publishDirectMessageIngest(message: DirectMessageIngestEvent, messageId: string): Promise<void>;
  publishDirectMessageReplyRequested(message: DirectMessageReplyRequestedEvent, messageId: string): Promise<void>;
  /** US-014: Publish a canonical event to the mediaops.events.topic exchange */
  publishCanonicalEvent(envelope: CanonicalEventEnvelope, routingKey: string): Promise<void>;
}

export async function createRabbitMqPublisher(
  rabbitmqUrl: string,
  database?: Database,
  logger?: Logger
): Promise<QueuePublisher> {
  const connection = await amqp.connect(rabbitmqUrl);
  const channel = await connection.createConfirmChannel();

  const exchange = "airtable.webhooks";
  const queue = "airtable.webhook.approved";
  const routingKey = "airtable.post.approved.ingress";
  const aiExchange = "ai.workflows";
  const aiQueue = "ai.compose.facebook.requested";
  const aiRoutingKey = "ai.compose.facebook.requested";
  const policyExchange = "policy.workflows";
  const policyQueue = "policy.evaluate.requested";
  const policyRoutingKey = "policy.evaluate.requested";
  const publishExchange = "publish.workflows";
  const publishQueue = "publish.facebook.requested";
  const publishRoutingKey = "publish.facebook.requested";
  const alertsExchange = "alerts";
  const slackAlertQueue = "alerts.slack.send";
  const slackAlertRoutingKey = "alerts.slack.send";
  const slackExchange = "slack.workflows";
  const slackDlxExchange = "dlx";
  const slackCommandQueue = "slack.post_approval.requested";
  const slackCommandRoutingKey = "slack.post_approval.requested";

  await channel.assertExchange(exchange, "topic", { durable: true });
  await channel.assertQueue(queue, { durable: true });
  await channel.bindQueue(queue, exchange, routingKey);
  await channel.assertExchange(aiExchange, "topic", { durable: true });
  await channel.assertQueue(aiQueue, { durable: true });
  await channel.bindQueue(aiQueue, aiExchange, aiRoutingKey);
  await channel.assertExchange(policyExchange, "topic", { durable: true });
  await channel.assertQueue(policyQueue, { durable: true });
  await channel.bindQueue(policyQueue, policyExchange, policyRoutingKey);
  await channel.assertExchange(publishExchange, "topic", { durable: true });
  await channel.assertQueue(publishQueue, { durable: true });
  await channel.bindQueue(publishQueue, publishExchange, publishRoutingKey);
  await channel.assertExchange(alertsExchange, "topic", { durable: true });
  await channel.assertQueue(slackAlertQueue, { durable: true });
  await channel.bindQueue(slackAlertQueue, alertsExchange, slackAlertRoutingKey);
  await channel.assertExchange(slackExchange, "topic", { durable: true });
  await channel.assertExchange(slackDlxExchange, "topic", { durable: true });
  await channel.assertQueue("slack.post_approval.requested.dlq", { durable: true });
  await channel.bindQueue("slack.post_approval.requested.dlq", slackDlxExchange, slackCommandQueue);
  await channel.assertQueue(slackCommandQueue, {
    durable: true,
    deadLetterExchange: slackDlxExchange,
    deadLetterRoutingKey: slackCommandQueue
  });
  await channel.bindQueue(slackCommandQueue, slackExchange, slackCommandRoutingKey);

  const slackCommentActionQueue = "slack.comment_action.requested";
  const slackCommentActionRoutingKey = "slack.comment_action.requested";
  await channel.assertQueue("slack.comment_action.requested.dlq", { durable: true });
  await channel.bindQueue("slack.comment_action.requested.dlq", slackDlxExchange, slackCommentActionQueue);
  await channel.assertQueue(slackCommentActionQueue, {
    durable: true,
    deadLetterExchange: slackDlxExchange,
    deadLetterRoutingKey: slackCommentActionQueue
  });
  await channel.bindQueue(slackCommentActionQueue, slackExchange, slackCommentActionRoutingKey);

  await channel.assertExchange("comments.workflows", "topic", { durable: true });

  // US-014: Assert canonical topic exchange (additive — does not break legacy)
  await channel.assertExchange(CANONICAL_TOPIC_EXCHANGE, "topic", { durable: true });

  async function trackPublish(
    message: unknown,
    messageId: string,
    fallbackQueueOrExchange: string,
    fallbackCorrelationId?: string
  ): Promise<void> {
    if (database && logger) {
      const messageRecord = typeof message === "object" && message !== null
        ? message as Record<string, unknown>
        : {};
      const workspaceId = getStringField(messageRecord, "workspace_id", "workspaceId") ?? SYSTEM_WORKSPACE_ID;
      const eventId = getStringField(messageRecord, "event_id", "eventId") ?? messageId;
      const eventType = getStringField(messageRecord, "event_type", "eventType") ?? UNKNOWN_EVENT_TYPE;
      const correlationId = getStringField(messageRecord, "correlation_id", "correlationId") ?? fallbackCorrelationId ?? messageId;

      await auditQueuePublished(
        database.getPool(),
        {
          workspaceId,
          queueName: fallbackQueueOrExchange,
          eventId,
          eventType,
          correlationId,
          messageId
        },
        logger
      ).catch((err) => {
        logger.warn("Failed to write QUEUE_EVENT_PUBLISHED audit in publisher", { error: String(err) });
      });
    }
  }

  return {
    async publishApprovedPost(message: AirtableApprovedQueueMessage, messageId: string): Promise<void> {
      assertNoForbiddenFields(message, "publishApprovedPost");
      const body = Buffer.from(JSON.stringify(message));
      const ok = channel.publish(exchange, routingKey, body, {
        contentType: JSON_CONTENT_TYPE,
        deliveryMode: PERSISTENT_DELIVERY_MODE,
        messageId,
        correlationId: message.correlation_id,
        type: message.event_type,
        timestamp: currentUnixTimestampSeconds()
      });

      if (!ok) {
        await new Promise((resolve) => channel.once("drain", resolve));
      }

      await channel.waitForConfirms();
      await trackPublish(message, messageId, routingKey);
    },

    async publishAiComposerRequest(message: AiComposerQueueMessage, messageId: string): Promise<void> {
      assertNoForbiddenFields(message, "publishAiComposerRequest");
      const body = Buffer.from(JSON.stringify(message));
      const ok = channel.publish(aiExchange, aiRoutingKey, body, {
        contentType: JSON_CONTENT_TYPE,
        deliveryMode: PERSISTENT_DELIVERY_MODE,
        messageId,
        correlationId: message.correlation_id,
        type: message.event_type,
        timestamp: currentUnixTimestampSeconds()
      });

      if (!ok) {
        await new Promise((resolve) => channel.once("drain", resolve));
      }

      await channel.waitForConfirms();
      await trackPublish(message, messageId, aiRoutingKey);
    },

    async publishPolicyEvaluateRequest(message: PolicyEvaluateRequestedEvent, messageId: string): Promise<void> {
      assertNoForbiddenFields(message, "publishPolicyEvaluateRequest");
      const body = Buffer.from(JSON.stringify(message));
      const ok = channel.publish(policyExchange, policyRoutingKey, body, {
        contentType: JSON_CONTENT_TYPE,
        deliveryMode: PERSISTENT_DELIVERY_MODE,
        messageId,
        correlationId: message.correlation_id,
        type: message.event_type,
        timestamp: currentUnixTimestampSeconds()
      });

      if (!ok) {
        await new Promise((resolve) => channel.once("drain", resolve));
      }

      await channel.waitForConfirms();
      await trackPublish(message, messageId, policyRoutingKey);
    },

    async publishFacebookRequest(message: PublishFacebookRequestedEvent, messageId: string): Promise<void> {
      assertNoForbiddenFields(message, "publishFacebookRequest");
      const body = Buffer.from(JSON.stringify(message));
      const ok = channel.publish(publishExchange, publishRoutingKey, body, {
        contentType: JSON_CONTENT_TYPE,
        deliveryMode: PERSISTENT_DELIVERY_MODE,
        messageId,
        correlationId: message.correlation_id,
        type: message.event_type,
        timestamp: currentUnixTimestampSeconds()
      });

      if (!ok) {
        await new Promise((resolve) => channel.once("drain", resolve));
      }

      await channel.waitForConfirms();
      await trackPublish(message, messageId, publishRoutingKey);
    },

    async publishSlackAlert(message: Record<string, unknown>, messageId: string, correlationId?: string): Promise<void> {
      assertNoForbiddenFields(message, "publishSlackAlert");
      const body = Buffer.from(JSON.stringify(message));
      const ok = channel.publish(alertsExchange, slackAlertRoutingKey, body, {
        contentType: JSON_CONTENT_TYPE,
        deliveryMode: PERSISTENT_DELIVERY_MODE,
        messageId,
        correlationId,
        type: "alerts.slack.send",
        timestamp: currentUnixTimestampSeconds()
      });

      if (!ok) {
        await new Promise((resolve) => channel.once("drain", resolve));
      }

      await channel.waitForConfirms();
      await trackPublish(message, messageId, slackAlertRoutingKey, correlationId);
    },

    async publishFacebookValidated(message: PublishFacebookValidatedEvent, messageId: string): Promise<void> {
      assertNoForbiddenFields(message, "publishFacebookValidated");
      const body = Buffer.from(JSON.stringify(message));
      const ok = channel.publish(publishExchange, "publish.facebook.validated", body, {
        contentType: JSON_CONTENT_TYPE,
        deliveryMode: PERSISTENT_DELIVERY_MODE,
        messageId,
        correlationId: message.correlation_id,
        type: message.event_type,
        timestamp: currentUnixTimestampSeconds()
      });

      if (!ok) {
        await new Promise((resolve) => channel.once("drain", resolve));
      }

      await channel.waitForConfirms();
      await trackPublish(message, messageId, "publish.facebook.validated");
    },

    async publishFacebookExecute(message: PublishFacebookExecuteEvent, messageId: string): Promise<void> {
      assertNoForbiddenFields(message, "publishFacebookExecute");
      const body = Buffer.from(JSON.stringify(message));
      const ok = channel.publish(publishExchange, "publish.facebook.execute", body, {
        contentType: JSON_CONTENT_TYPE,
        deliveryMode: PERSISTENT_DELIVERY_MODE,
        messageId,
        correlationId: message.correlationId,
        type: message.eventType,
        timestamp: currentUnixTimestampSeconds()
      });

      if (!ok) {
        await new Promise((resolve) => channel.once("drain", resolve));
      }

      await channel.waitForConfirms();
      await trackPublish(message, messageId, "publish.facebook.execute");
    },

    async publishSlackCommandAction(message: SlackCommandActionEvent, messageId: string): Promise<void> {
      assertNoForbiddenFields(message, "publishSlackCommandAction");
      const body = Buffer.from(JSON.stringify(message));
      const ok = channel.publish(slackExchange, slackCommandRoutingKey, body, {
        contentType: JSON_CONTENT_TYPE,
        deliveryMode: PERSISTENT_DELIVERY_MODE,
        messageId,
        correlationId: message.correlation_id,
        type: message.event_type,
        timestamp: currentUnixTimestampSeconds()
      });

      if (!ok) {
        await new Promise((resolve) => channel.once("drain", resolve));
      }

      await channel.waitForConfirms();
      await trackPublish(message, messageId, slackCommandRoutingKey);
    },

    async publishSlackCommentAction(message: SlackCommentActionEvent, messageId: string): Promise<void> {
      assertNoForbiddenFields(message, "publishSlackCommentAction");
      const body = Buffer.from(JSON.stringify(message));
      const ok = channel.publish(slackExchange, slackCommentActionRoutingKey, body, {
        contentType: JSON_CONTENT_TYPE,
        deliveryMode: PERSISTENT_DELIVERY_MODE,
        messageId,
        correlationId: message.correlation_id,
        type: message.event_type,
        timestamp: currentUnixTimestampSeconds()
      });

      if (!ok) {
        await new Promise((resolve) => channel.once("drain", resolve));
      }

      await channel.waitForConfirms();
      await trackPublish(message, messageId, slackCommentActionRoutingKey);
    },

    async publishCommentSyncRequest(message: CommentSyncRequestedEvent, messageId: string): Promise<void> {
      assertNoForbiddenFields(message, "publishCommentSyncRequest");
      const body = Buffer.from(JSON.stringify(message));
      // Ensure comments exchange exists. Our consumers will assert it, but publisher should just publish.
      const commentsExchange = "comments.workflows";
      const commentsRoutingKey = "comments.facebook.sync.requested";
      
      const ok = channel.publish(commentsExchange, commentsRoutingKey, body, {
        contentType: JSON_CONTENT_TYPE,
        deliveryMode: PERSISTENT_DELIVERY_MODE,
        messageId,
        correlationId: message.correlation_id,
        type: message.event_type,
        timestamp: currentUnixTimestampSeconds()
      });

      if (!ok) {
        await new Promise((resolve) => channel.once("drain", resolve));
      }

      await channel.waitForConfirms();
      await trackPublish(message, messageId, commentsRoutingKey);
    },

    async publishCommentIngest(message: CommentIngestEvent, messageId: string): Promise<void> {
      assertNoForbiddenFields(message, "publishCommentIngest");
      const body = Buffer.from(JSON.stringify(message));
      const commentsExchange = "comments.workflows";
      const commentsRoutingKey = "comments.facebook.ingest";
      
      const ok = channel.publish(commentsExchange, commentsRoutingKey, body, {
        contentType: JSON_CONTENT_TYPE,
        deliveryMode: PERSISTENT_DELIVERY_MODE,
        messageId,
        correlationId: message.correlation_id,
        type: message.event_type,
        timestamp: currentUnixTimestampSeconds()
      });

      if (!ok) {
        await new Promise((resolve) => channel.once("drain", resolve));
      }

      await channel.waitForConfirms();
      await trackPublish(message, messageId, commentsRoutingKey);
    },

    // ── US-014: Canonical Event Publisher ───────────────────────────────────
    async publishCanonicalEvent(envelope: CanonicalEventEnvelope, routingKey: string): Promise<void> {
      // Security guard: reject any message containing forbidden fields
      assertNoForbiddenFields(envelope, "canonical_envelope");
      assertNoForbiddenFields(envelope.payload, "canonical_envelope.payload");

      const body = Buffer.from(JSON.stringify(envelope));
      const ok = channel.publish(CANONICAL_TOPIC_EXCHANGE, routingKey, body, {
        contentType: JSON_CONTENT_TYPE,
        deliveryMode: PERSISTENT_DELIVERY_MODE,
        messageId: envelope.event_id,
        correlationId: envelope.correlation_id,
        type: envelope.event_type,
        timestamp: currentUnixTimestampSeconds()
      });

      if (!ok) {
        await new Promise((resolve) => channel.once("drain", resolve));
      }

      await channel.waitForConfirms();
      await trackPublish(envelope, envelope.event_id, routingKey);
    },

    async publishDirectMessageIngest(message: DirectMessageIngestEvent, messageId: string): Promise<void> {
      assertNoForbiddenFields(message, "publishDirectMessageIngest");
      assertNoForbiddenFields(message.payload, "publishDirectMessageIngest.payload");
      const body = Buffer.from(JSON.stringify(message));
      const ok = channel.publish(CANONICAL_TOPIC_EXCHANGE, message.event_type, body, {
        contentType: JSON_CONTENT_TYPE,
        deliveryMode: PERSISTENT_DELIVERY_MODE,
        messageId,
        correlationId: message.correlation_id,
        type: message.event_type,
        timestamp: currentUnixTimestampSeconds()
      });

      if (!ok) {
        await new Promise((resolve) => channel.once("drain", resolve));
      }

      await channel.waitForConfirms();
      await trackPublish(message, messageId, message.event_type);
    },

    async publishDirectMessageReplyRequested(message: DirectMessageReplyRequestedEvent, messageId: string): Promise<void> {
      assertNoForbiddenFields(message, "publishDirectMessageReplyRequested");
      assertNoForbiddenFields(message.payload, "publishDirectMessageReplyRequested.payload");
      const body = Buffer.from(JSON.stringify(message));
      const ok = channel.publish(CANONICAL_TOPIC_EXCHANGE, message.event_type, body, {
        contentType: JSON_CONTENT_TYPE,
        deliveryMode: PERSISTENT_DELIVERY_MODE,
        messageId,
        correlationId: message.correlation_id,
        type: message.event_type,
        timestamp: currentUnixTimestampSeconds()
      });

      if (!ok) {
        await new Promise((resolve) => channel.once("drain", resolve));
      }

      await channel.waitForConfirms();
      await trackPublish(message, messageId, message.event_type);
    }
  };
}
