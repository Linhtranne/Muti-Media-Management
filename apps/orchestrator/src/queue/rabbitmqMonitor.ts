import amqp from "amqplib";
import type { ChannelModel } from "amqplib";
import type { Logger } from "../lib/logger.js";

const MAX_RETRIES = 5;

const connectRabbitMq = amqp.connect as (url: string) => Promise<ChannelModel>;

export interface RabbitMqMonitor {
  start(intervalMs?: number): Promise<void>;
  stop(): Promise<void>;
}

export function createRabbitMqMonitor(
  rabbitmqUrl: string,
  logger: Logger
): RabbitMqMonitor {
  let connection: ChannelModel | null = null;
  let intervalId: NodeJS.Timeout | null = null;

  const getBaseQueues = () => [
    "airtable.webhook.approved",
    "ai.compose.facebook.requested",
    "publish.facebook.requested",
    "alerts.slack.send",
    "slack.post_approval.requested",
    "slack.comment_action.requested",
    "policy.evaluate.requested",
    "publish.facebook.execute"
  ];

  const getDelayedQueues = () => {
    const delayedQueues: string[] = [];
    const baseQueuesWithRetries = [
      "slack.post_approval",
      "slack.comment_action"
    ];
    
    // We know the backoff is 2^retryCount * 1000, up to MAX_RETRIES (5)
    for (const base of baseQueuesWithRetries) {
      for (let i = 0; i < MAX_RETRIES; i++) {
        const backoffMs = (2 ** i) * 1000;
        delayedQueues.push(`${base}.retry.${backoffMs}`);
      }
    }
    return delayedQueues;
  };

  const getDlqs = () => [
    "airtable.webhook.approved.dlq",
    "slack.post_approval.requested.dlq",
    "slack.comment_action.requested.dlq",
    "policy.evaluate.requested.dlq",
    "publish.facebook.execute.dlq"
  ];

  return {
    async start(intervalMs = 30000) {
      connection = await connectRabbitMq(rabbitmqUrl);
      
      logger.info(`Started RabbitMQ Monitor (interval: ${intervalMs}ms)`);

      intervalId = setInterval(() => {
        void (async () => {
          if (!connection) return;

          const queuesToCheck = [
            ...getBaseQueues(),
            ...getDelayedQueues(),
            ...getDlqs()
          ];

          for (const q of queuesToCheck) {
            await checkQueueMetric(connection, q, logger);
          }
        })().catch((error) => {
          logger.warn("RabbitMQ monitor cycle failed", {
            error: error instanceof Error ? error.message : String(error)
          });
        });
      }, intervalMs);
    },

    async stop() {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      if (connection) await connection.close();
      logger.info("Stopped RabbitMQ Monitor");
    }
  };
}

async function checkQueueMetric(connection: ChannelModel, q: string, logger: Logger): Promise<void> {
  let checkChannel: Awaited<ReturnType<ChannelModel["createConfirmChannel"]>> | null = null;
  try {
    checkChannel = await connection.createConfirmChannel();
    checkChannel.on("error", () => {
      // checkQueue is passive: RabbitMQ closes this temporary channel when
      // an optional retry queue does not exist yet.
    });
    const stats = await checkChannel.checkQueue(q);
    
    if (stats.messageCount > 0) {
      const isDelayed = q.includes(".retry.");
      const logLvl = isDelayed ? "warn" : "info";
      
      logger[logLvl]("RabbitMQ Queue Metrics", {
        queue: q,
        messageCount: stats.messageCount,
        consumerCount: stats.consumerCount,
        type: isDelayed ? "delayed" : (q.endsWith(".dlq") ? "dlq" : "active")
      });
    }
  } catch {
    // Missing dynamic retry queues are expected before the first retry.
  } finally {
    if (checkChannel) {
      await checkChannel.close().catch(() => undefined);
    }
  }
}
