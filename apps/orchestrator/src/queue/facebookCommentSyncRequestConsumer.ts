import amqp from "amqplib";
import { CommentSyncRequestedEventSchema, type CommentIngestEvent, type CommentSyncRequestedEvent } from "@mediaops/shared-contracts";
import type { Logger } from "../lib/logger.js";
import type { FacebookMcpClient } from "../mcp/facebookMcpClient.js";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { ChannelAccountAdminRepository } from "../ledger/channelAccountAdminRepository.js";
import type { QueuePublisher } from "../queue/rabbitmqPublisher.js";
import type { CommentRiskClassifier } from "../services/commentRiskClassifier.js";

const COMMENT_PREVIEW_MAX_LENGTH = 80;

export interface SyncRequestQueueConsumerChannel {
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

export interface SyncRequestQueueConnection {
  createConfirmChannel(): Promise<SyncRequestQueueConsumerChannel>;
  close(): Promise<void>;
}

export interface SyncRequestQueueConsumer {
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

const exchange = "comments.workflows";
const queue = "comments.facebook.sync.requested";
const routingKey = "comments.facebook.sync.requested";
const dlqQueue = "comments.facebook.sync.requested.dlq";

const ingestQueue = "comments.facebook.ingest";
const ingestRoutingKey = "comments.facebook.ingest";

const connectRabbitMq = amqp.connect as (url: string) => Promise<SyncRequestQueueConnection>;

const MAX_RETRIES = 5;

export interface SyncRequestConsumerDependencies {
  channel: SyncRequestQueueConsumerChannel;
  mcpClient: FacebookMcpClient;
  dbPool: pg.Pool;
  channelAccountRepo: ChannelAccountAdminRepository;
  publisher: QueuePublisher;
  riskClassifier: CommentRiskClassifier;
  logger: Logger;
}

async function moveToDlq(
  deps: SyncRequestConsumerDependencies,
  safeMsg: SafeConsumeMessage,
  errorCode: string,
  errorMessage: string
): Promise<void> {
  const messageId = safeMsg.properties.messageId ?? "unknown-msg-id";
  const contentStr = safeMsg.content.toString();
  
  const dlqPayload = {
    original_message_id: messageId,
    correlation_id: safeMsg.properties.correlationId,
    routing_key: safeMsg.fields.routingKey,
    error_code: errorCode,
    error_message: errorMessage,
    moved_at: new Date().toISOString(),
    payload: contentStr
  };

  deps.channel.sendToQueue(dlqQueue, Buffer.from(JSON.stringify(dlqPayload)), {
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
  await deps.channel.waitForConfirms();
}

async function getSecretRef(deps: SyncRequestConsumerDependencies, workspaceId: string, channelAccountId: string): Promise<string | null> {
  const dbClient = await deps.dbPool.connect();
  try {
    const channelAccount = await deps.channelAccountRepo.getChannelAccount(
      dbClient,
      workspaceId,
      channelAccountId
    );
    return channelAccount ? channelAccount.secret_ref : null;
  } finally {
    dbClient.release();
  }
}

interface McpSyncedComment {
  externalId: string;
  externalPostId?: string;
  authorName: string;
  externalUserId?: string;
  body: string;
  permalink: string;
  createdAtPlatform: string;
}

async function publishIngestEvents(
  deps: SyncRequestConsumerDependencies,
  event: CommentSyncRequestedEvent,
  comments: McpSyncedComment[]
) {
  for (const comment of comments) {
    const riskCode = deps.riskClassifier.classify(comment.body);
    const ingestEvent: CommentIngestEvent = {
      event_id: randomUUID(),
      event_type: "comments.facebook.ingest",
      event_version: 1,
      workspace_id: event.workspace_id,
      job_id: event.job_id,
      external_post_id: event.external_post_id,
      external_comment_id: comment.externalId,
      author_ref: {
        name: comment.authorName,
        external_user_id: comment.externalUserId
      },
      comment_preview: comment.body.substring(0, COMMENT_PREVIEW_MAX_LENGTH),
      risk_code: riskCode,
      permalink: comment.permalink,
      created_at_platform: comment.createdAtPlatform,
      correlation_id: event.correlation_id,
      causation_id: event.event_id,
      created_at: new Date().toISOString()
    };

    await deps.publisher.publishCommentIngest(ingestEvent, ingestEvent.event_id);
  }
}

async function processSyncRequest(
  deps: SyncRequestConsumerDependencies,
  safeMsg: SafeConsumeMessage,
  retryCount: number
): Promise<void> {
  const contentStr = safeMsg.content.toString();
  
  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(contentStr);
  } catch {
    await moveToDlq(deps, safeMsg, "MALFORMED_JSON", "Invalid JSON format");
    return;
  }

  const validation = CommentSyncRequestedEventSchema.safeParse(rawPayload);
  if (!validation.success) {
    await moveToDlq(deps, safeMsg, "VALIDATION_FAILED", JSON.stringify(validation.error.flatten()));
    return;
  }

  const event = validation.data;

  const secretRef = await getSecretRef(deps, event.workspace_id, event.channel_account_id);
  if (!secretRef) {
    await moveToDlq(deps, safeMsg, "CHANNEL_ACCOUNT_NOT_FOUND", "Channel account not found");
    return;
  }

  const result = await deps.mcpClient.syncComments({
    channelAccountId: event.channel_account_id,
    secretRef,
    externalPostId: event.external_post_id,
    postRef: { jobId: event.job_id }
  });

  if (!result.passed) {
    const isTransient = result.errors?.some(e => e.code === "PLATFORM_TRANSIENT_ERROR" || e.code === "PLATFORM_RATE_LIMIT");
    if (isTransient && retryCount < MAX_RETRIES) {
      throw new Error(`Transient error fetching comments: ${JSON.stringify(result.errors)}`);
    }
    await moveToDlq(deps, safeMsg, "SYNC_FAILED", JSON.stringify(result.errors));
    return;
  }

  if (result.comments && result.comments.length > 0) {
    await publishIngestEvents(deps, event, result.comments);
  }
}

export async function handleSyncRequestQueueMessage(
  deps: SyncRequestConsumerDependencies,
  msg: amqp.ConsumeMessage,
  isStopping: () => boolean
): Promise<void> {
  if (isStopping()) {
    deps.channel.nack(msg, false, true);
    return;
  }

  const safeMsg = msg as SafeConsumeMessage;
  const messageId = safeMsg.properties.messageId ?? "unknown-msg-id";
  const headers = safeMsg.properties.headers || {};
  const retryCount = typeof headers["x-retries"] === "number" ? headers["x-retries"] : 0;

  try {
    await processSyncRequest(deps, safeMsg, retryCount);
    deps.channel.ack(msg);
  } catch (error) {
    if (retryCount >= MAX_RETRIES) {
      deps.logger.error("Max retries exceeded for comment sync request", { messageId });
      await moveToDlq(deps, safeMsg, "MAX_RETRIES_EXCEEDED", String(error));
      deps.channel.ack(msg);
      return;
    }

    deps.logger.warn("Transient error, requeuing message", {
      messageId,
      retryCount: retryCount + 1,
      error: error instanceof Error ? error.message : String(error)
    });

    deps.channel.sendToQueue(queue, safeMsg.content, {
      messageId,
      contentType: "application/json",
      deliveryMode: 2,
      correlationId: safeMsg.properties.correlationId,
      headers: {
        ...headers,
        "x-retries": retryCount + 1
      }
    });
    await deps.channel.waitForConfirms();
    deps.channel.ack(msg);
  }
}

export async function createFacebookCommentSyncRequestConsumer(
  rabbitmqUrl: string,
  mcpClient: FacebookMcpClient,
  dbPool: pg.Pool,
  channelAccountRepo: ChannelAccountAdminRepository,
  publisher: QueuePublisher,
  riskClassifier: CommentRiskClassifier,
  logger: Logger
): Promise<SyncRequestQueueConsumer> {
  let connection: SyncRequestQueueConnection | null = null;
  let channel: SyncRequestQueueConsumerChannel | null = null;
  let isStopping = false;

  return {
    async start(): Promise<void> {
      logger.info("Initializing Facebook Comment Sync Request RabbitMQ consumer...");
      connection = await connectRabbitMq(rabbitmqUrl);
      channel = await connection.createConfirmChannel();

      await channel.assertExchange(exchange, "topic", { durable: true });
      
      // Ensure sync queue
      await channel.assertQueue(queue, { durable: true });
      await channel.bindQueue(queue, exchange, routingKey);
      await channel.assertQueue(dlqQueue, { durable: true });
      
      // Ensure ingest queue exists so we can publish to it
      await channel.assertQueue(ingestQueue, { durable: true });
      await channel.bindQueue(ingestQueue, exchange, ingestRoutingKey);

      await channel.prefetch(2); // Keep concurrency low since it calls Graph API

      await channel.consume(queue, async (msg: amqp.ConsumeMessage | null) => {
        if (!msg || !channel) return;
        const deps: SyncRequestConsumerDependencies = {
          channel,
          mcpClient,
          dbPool,
          channelAccountRepo,
          publisher,
          riskClassifier,
          logger
        };
        await handleSyncRequestQueueMessage(deps, msg, () => isStopping);
      });
    },

    async stop(): Promise<void> {
      if (isStopping) return;
      isStopping = true;
      logger.info("Stopping Facebook Comment Sync Request RabbitMQ consumer...");

      if (channel) {
        await channel.close().catch((error) => { logger.error("Error closing channel", { error: String(error) }); });
      }
      if (connection) {
        await connection.close().catch((error) => { logger.error("Error closing connection", { error: String(error) }); });
      }
    }
  };
}
