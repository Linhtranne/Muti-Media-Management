import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleAiComposerQueueMessage, type AiQueueConsumerChannel } from "../queue/aiComposerRabbitmqConsumer.js";
import { Logger } from "../lib/logger.js";

const logger = new Logger("error");

function createMessage(payload: unknown): any {
  return {
    content: Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload)),
    properties: {
      messageId: "msg_ai_001",
      correlationId: "corr_001"
    },
    fields: {
      exchange: "ai.workflows",
      routingKey: "ai.compose.facebook.requested"
    }
  };
}

function createChannel() {
  const calls: string[] = [];
  const channel: AiQueueConsumerChannel = {
    async assertExchange() {},
    async assertQueue() {},
    async bindQueue() {},
    async prefetch() {},
    async consume() {},
    sendToQueue() {
      calls.push("sendToQueue");
      return true;
    },
    async waitForConfirms() {
      calls.push("waitForConfirms");
    },
    ack() {
      calls.push("ack");
    },
    nack(_msg, _allUpTo, requeue) {
      calls.push(requeue ? "nack_requeue" : "nack_drop");
    },
    async close() {}
  };
  return { channel, calls };
}

const validPayload = {
  event_id: "evt_ai_001",
  event_type: "ai.compose.facebook.requested",
  event_version: 1,
  source: "orchestrator.workflow_runs",
  workspace_id: "ws_test_composer",
  workflow_run_id: "wf_run_123",
  prompt_version: "fb_composer_v1.0.0",
  idempotency_key: "ai.compose.facebook:ws_test_composer:wf_run_123:fb_composer_v1.0.0",
  correlation_id: "corr_001",
  causation_id: "wf_run_123"
};

describe("AI Composer RabbitMQ consumer", () => {
  it("ACKs only after worker processing completes", async () => {
    const { channel, calls } = createChannel();
    const worker = {
      async processQueueMessage() {
        calls.push("worker_start");
        await Promise.resolve();
        calls.push("worker_done");
        return { action: "ack" as const, status: "completed" };
      }
    };

    await handleAiComposerQueueMessage(channel, worker, logger, createMessage(validPayload), () => false);

    assert.deepEqual(calls, ["worker_start", "worker_done", "ack"]);
  });

  it("routes invalid schema messages to DLQ and ACKs original only after confirm", async () => {
    const { channel, calls } = createChannel();
    const worker = {
      async processQueueMessage() {
        throw new Error("worker should not be called for invalid schema");
      }
    };

    await handleAiComposerQueueMessage(
      channel,
      worker,
      logger,
      createMessage({ ...validPayload, master_copy: "forbidden raw content" }),
      () => false
    );

    assert.deepEqual(calls, ["sendToQueue", "waitForConfirms", "ack"]);
  });

  it("NACKs with requeue when worker returns retryable infrastructure failure", async () => {
    const { channel, calls } = createChannel();
    const worker = {
      async processQueueMessage() {
        calls.push("worker_done");
        return { action: "nack_requeue" as const, status: "persistence_failed" };
      }
    };

    await handleAiComposerQueueMessage(channel, worker, logger, createMessage(validPayload), () => false);

    assert.deepEqual(calls, ["worker_done", "nack_requeue"]);
  });
});
