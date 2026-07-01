import amqp from "amqplib";
import type { ChannelModel, ConfirmChannel } from "amqplib";
import { SlackCommentActionEventSchema } from "@mediaops/shared-contracts";
import type { Logger } from "../lib/logger.js";
import type { SlackCommentActionWorker } from "../workers/slackCommentActionWorker.js";

const MAX_RETRIES = 5;
const connectRabbitMq = amqp.connect as (url: string) => Promise<ChannelModel>;

type SafeConsumeMessage = Omit<amqp.ConsumeMessage, "properties"> & {
  properties: {
    messageId?: string;
    headers?: Record<string, unknown>;
  };
};

function retryCountFromHeaders(headers: Record<string, unknown> | undefined): number {
  const value = headers?.["x-retry-count"];
  return typeof value === "number" ? value : 0;
}

export interface SlackCommentActionQueueConsumer {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createSlackCommentActionRabbitmqConsumer(
  rabbitmqUrl: string,
  worker: SlackCommentActionWorker,
  logger: Logger,
  workspaceId: string
): SlackCommentActionQueueConsumer {
  const queue = "slack.comment_action.requested";
  const dlq = "slack.comment_action.requested.dlq";
  
  let connection: ChannelModel | null = null;
  let channel: ConfirmChannel | null = null;

  return {
    async start() {
      connection = await connectRabbitMq(rabbitmqUrl);
      channel = await connection.createConfirmChannel();
      const activeChannel = channel;
      
      // Setup DLQ
      await activeChannel.assertExchange("dlx", "topic", { durable: true });
      await activeChannel.assertQueue(dlq, { durable: true });
      await activeChannel.bindQueue(dlq, "dlx", queue);

      await activeChannel.assertQueue(queue, {
        durable: true,
        deadLetterExchange: "dlx",
        deadLetterRoutingKey: queue
      });

      await activeChannel.prefetch(1);

      await activeChannel.consume(queue, (msg: amqp.ConsumeMessage | null) => {
        void (async () => {
        if (!msg) return;

        const safeMsg = msg as SafeConsumeMessage;
        const messageId = safeMsg.properties.messageId ?? "unknown";
        const retryCount = retryCountFromHeaders(safeMsg.properties.headers);

        try {
          const bodyStr = msg.content.toString("utf8");
          const parsedBody = JSON.parse(bodyStr) as unknown;
          const validatedEvent = SlackCommentActionEventSchema.parse(parsedBody);

          if (validatedEvent.workspace_id !== workspaceId) {
            logger.warn("Ignoring Slack comment action message for different workspace", {
              messageId,
              messageWorkspaceId: validatedEvent.workspace_id,
              workerWorkspaceId: workspaceId
            });
            activeChannel.ack(msg);
            return;
          }

          const result = await worker.processQueueMessage(validatedEvent, messageId);

          if (result.action === "ack") {
            activeChannel.ack(msg);
          } else if (result.action === "nack_requeue") {
            if (retryCount >= MAX_RETRIES) {
              logger.error("Slack comment action max retries exceeded, routing to DLQ", { messageId, status: result.status });
              activeChannel.nack(msg, false, false);
            } else {
              const backoffMs = (2 ** retryCount) * 1000;
              logger.warn("Requeueing Slack comment action message with backoff", {
                messageId,
                retryCount: retryCount + 1,
                backoffMs,
                status: result.status
              });
              
              const newHeaders = { ...msg.properties.headers, "x-retry-count": retryCount + 1 };
              const retryQueueName = `slack.comment_action.retry.${backoffMs}`;
              
              // Publish to a temporary queue with TTL that dead-letters back to the main queue
              await activeChannel.assertQueue(retryQueueName, {
                durable: true,
                deadLetterExchange: "",
                deadLetterRoutingKey: queue,
                messageTtl: backoffMs
              });
              
              activeChannel.sendToQueue(retryQueueName, msg.content, {
                ...msg.properties,
                headers: newHeaders
              });
              await activeChannel.waitForConfirms();
              activeChannel.ack(msg);
            }
          } else {
            logger.error("Slack comment action routing to DLQ", { messageId, status: result.status });
            activeChannel.nack(msg, false, false);
          }
        } catch (error) {
          logger.error("Failed to parse Slack comment action queue message", {
            messageId,
            error: error instanceof Error ? error.message : String(error)
          });
          // Unparseable messages go directly to DLQ
          activeChannel.nack(msg, false, false);
        }
        })();
      });

      logger.info(`Started Slack comment action consumer for workspace ${workspaceId} on queue ${queue}`);
    },

    async stop() {
      if (channel) await channel.close();
      if (connection) await connection.close();
      logger.info(`Stopped Slack comment action consumer on queue ${queue}`);
    }
  };
}
