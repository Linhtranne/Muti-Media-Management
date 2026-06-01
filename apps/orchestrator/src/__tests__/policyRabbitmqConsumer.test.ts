import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handlePolicyQueueMessage, type PolicyQueueConsumerChannel } from "../queue/policyRabbitmqConsumer.js";

function validMessage() {
  return {
    event_id: "11111111-1111-4111-8111-111111111111",
    event_type: "policy.evaluate.requested",
    event_version: 1,
    workspace_id: "ws_test_123",
    correlation_id: "corr-1",
    workflow_run_id: "22222222-2222-4222-8222-222222222222",
    ai_generation_run_id: "33333333-3333-4333-8333-333333333333",
    content_variant_id: "44444444-4444-4444-8444-444444444444",
    airtable_record_id: "recPost123",
    platform: "facebook",
    prompt_version: "fb_composer_v1.0.0",
    approved_version: 1,
    idempotency_key: "policy.evaluate.requested:ws_test_123:44444444-4444-4444-8444-444444444444:policy-facebook-v1",
    created_at: "2026-06-01T00:00:00.000Z"
  };
}

function makeAmqpMessage(payload: unknown) {
  return {
    content: Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload)),
    properties: { messageId: "msg-1", correlationId: "corr-1" },
    fields: { routingKey: "policy.evaluate.requested", exchange: "policy.workflows" }
  } as any;
}

function makeChannel(events: string[]): PolicyQueueConsumerChannel {
  return {
    assertExchange: async () => undefined,
    assertQueue: async () => undefined,
    bindQueue: async () => undefined,
    prefetch: async () => undefined,
    consume: async () => undefined,
    sendToQueue: () => {
      events.push("send_dlq");
      return true;
    },
    waitForConfirms: async () => {
      events.push("confirm_dlq");
    },
    ack: () => {
      events.push("ack");
    },
    nack: (_msg, _all, requeue) => {
      events.push(requeue ? "nack_requeue" : "nack");
    },
    close: async () => undefined
  };
}

const logger = {
  info() {},
  warn() {},
  error() {},
  debug() {}
} as any;

describe("Policy RabbitMQ consumer", () => {
  it("ACKs only after worker processing completes", async () => {
    const events: string[] = [];
    const worker = {
      async processQueueMessage() {
        events.push("worker_start");
        await Promise.resolve();
        events.push("worker_done");
        return { action: "ack", status: "policy_approved" };
      }
    };

    await handlePolicyQueueMessage(makeChannel(events), worker as any, logger, makeAmqpMessage(validMessage()), () => false);

    assert.deepEqual(events, ["worker_start", "worker_done", "ack"]);
  });

  it("routes invalid schema messages to DLQ and ACKs original after confirm", async () => {
    const events: string[] = [];
    await handlePolicyQueueMessage(makeChannel(events), { processQueueMessage: async () => ({ action: "ack", status: "unused" }) }, logger, makeAmqpMessage({ ...validMessage(), body: "raw content" }), () => false);

    assert.deepEqual(events, ["send_dlq", "confirm_dlq", "ack"]);
  });

  it("NACKs with requeue when worker returns retryable persistence failure", async () => {
    const events: string[] = [];
    const worker = {
      async processQueueMessage() {
        return { action: "nack_requeue", status: "persistence_failed" };
      }
    };

    await handlePolicyQueueMessage(makeChannel(events), worker as any, logger, makeAmqpMessage(validMessage()), () => false);

    assert.deepEqual(events, ["nack_requeue"]);
  });
});

