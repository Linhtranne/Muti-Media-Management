import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import amqp from "amqplib";
import { createRabbitMqPublisher } from "../rabbitmqPublisher.js";

// Mock amqp.connect at module level
mock.method(amqp, "connect", async () => {
  return {
    createConfirmChannel: async () => mockChannel
  };
});

const mockChannel = {
  assertExchange: mock.fn(async () => undefined),
  assertQueue: mock.fn(async () => undefined),
  bindQueue: mock.fn(async () => undefined),
  publish: mock.fn(() => true),
  waitForConfirms: mock.fn(async () => undefined),
  once: mock.fn()
} as any;

const mockPool = {
  query: mock.fn(async () => undefined)
} as any;

const mockDatabase = {
  getPool: () => mockPool,
  transaction: async () => undefined,
  query: async () => undefined
} as any;

const mockLogger = {
  info: mock.fn(),
  warn: mock.fn(),
  error: mock.fn()
} as any;

describe("RabbitMQ Publisher Hardening & Auditing", () => {
  beforeEach(() => {
    mockChannel.publish.mock.resetCalls();
    mockChannel.waitForConfirms.mock.resetCalls();
    mockPool.query.mock.resetCalls();
  });

  it("successfully publishes clean canonical event and logs to audit repo", async () => {
    const publisher = await createRabbitMqPublisher("amqp://localhost", mockDatabase, mockLogger);

    const validEnvelope = {
      event_id: "550e8400-e29b-41d4-a716-446655440000",
      event_type: "publish.facebook.execute",
      event_version: 1,
      workspace_id: "ws-1",
      idempotency_key: "ik-1",
      correlation_id: "corr-1",
      payload: {
        job_id: "job-1",
        meta: {
          clean_ref: "ref-123"
        }
      }
    };

    await publisher.publishCanonicalEvent(validEnvelope, "publish.facebook.execute");

    // Verify it was published
    assert.equal(mockChannel.publish.mock.calls.length, 1);
    
    // Verify audit log query was executed
    assert.equal(mockPool.query.mock.calls.length, 1);
    const queryCall = mockPool.query.mock.calls[0];
    assert.ok(queryCall.arguments[0].includes("INSERT INTO audit_logs"));
    assert.ok(queryCall.arguments[1].includes("QUEUE_EVENT_PUBLISHED"));
    assert.ok(queryCall.arguments[1].includes("ws-1"));
  });

  it("rejects canonical event containing forbidden field in payload", async () => {
    const publisher = await createRabbitMqPublisher("amqp://localhost", mockDatabase, mockLogger);

    const invalidEnvelope = {
      event_id: "550e8400-e29b-41d4-a716-446655440000",
      event_type: "publish.facebook.execute",
      event_version: 1,
      workspace_id: "ws-1",
      idempotency_key: "ik-1",
      correlation_id: "corr-1",
      payload: {
        job_id: "job-1",
        access_token: "leaked-token"
      }
    };

    await assert.rejects(
      async () => {
        await publisher.publishCanonicalEvent(invalidEnvelope, "publish.facebook.execute");
      },
      /security violation/i
    );

    // Verify it was NOT published and audit log was NOT created
    assert.equal(mockChannel.publish.mock.calls.length, 0);
    assert.equal(mockPool.query.mock.calls.length, 0);
  });

  it("rejects legacy publishApprovedPost containing forbidden field inside array", async () => {
    const publisher = await createRabbitMqPublisher("amqp://localhost", mockDatabase, mockLogger);

    const invalidApprovedMessage = {
      event_id: "550e8400-e29b-41d4-a716-446655440000",
      event_type: "airtable.post.approved.ingress",
      workspace_id: "ws-1",
      correlation_id: "corr-1",
      record_ref: "rec-1",
      approval_ref: "ref-1",
      items: [
        { clean_ref: "123" },
        { secret: "leaked-secret" } // Forbidden field inside array!
      ]
    } as any;

    await assert.rejects(
      async () => {
        await publisher.publishApprovedPost(invalidApprovedMessage, "msg-1");
      },
      /security violation/i
    );

    assert.equal(mockChannel.publish.mock.calls.length, 0);
  });

  it("successfully publishes legacy slack alert and logs to audit", async () => {
    const publisher = await createRabbitMqPublisher("amqp://localhost", mockDatabase, mockLogger);

    const validAlert = {
      workspace_id: "ws-1",
      message: "Build succeeded",
      recipient: "Slack Channel"
    };

    await publisher.publishSlackAlert(validAlert, "msg-2", "corr-2");

    assert.equal(mockChannel.publish.mock.calls.length, 1);
    assert.equal(mockPool.query.mock.calls.length, 1);
    const queryCall = mockPool.query.mock.calls[0];
    assert.ok(queryCall.arguments[1].includes("QUEUE_EVENT_PUBLISHED"));
    assert.ok(queryCall.arguments[1].includes("ws-1"));
  });

  it("rejects legacy slack alert containing token", async () => {
    const publisher = await createRabbitMqPublisher("amqp://localhost", mockDatabase, mockLogger);

    const invalidAlert = {
      workspace_id: "ws-1",
      message: "Secret info",
      token: "secret-token-xyz"
    };

    await assert.rejects(
      async () => {
        await publisher.publishSlackAlert(invalidAlert, "msg-3", "corr-3");
      },
      /security violation/i
    );

    assert.equal(mockChannel.publish.mock.calls.length, 0);
  });
});
