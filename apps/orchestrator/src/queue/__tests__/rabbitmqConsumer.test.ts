import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import amqp from "amqplib";
import { createRabbitMqConsumer } from "../rabbitmqConsumer.js";

let consumeCallback: ((msg: amqp.ConsumeMessage | null) => void) | null = null;

// Mock amqp.connect at module level
mock.method(amqp, "connect", async () => {
  return {
    createConfirmChannel: async () => mockChannel,
    close: async () => undefined
  };
});

const mockChannel = {
  assertExchange: mock.fn(async () => undefined),
  assertQueue: mock.fn(async () => undefined),
  bindQueue: mock.fn(async () => undefined),
  prefetch: mock.fn(async () => undefined),
  consume: mock.fn(async (queueName, cb) => {
    consumeCallback = cb;
  }),
  ack: mock.fn(),
  nack: mock.fn(),
  sendToQueue: mock.fn(() => true),
  waitForConfirms: mock.fn(async () => undefined),
  close: mock.fn(async () => undefined)
} as any;

const mockWorker = {
  process: mock.fn(async () => ({ action: "ack", status: "workflow_stub_created" }))
} as any;

const mockPool = {
  query: mock.fn(async (sql: string) => {
    if (sql.includes("SELECT * FROM event_bus_messages")) {
      return { rows: [{ status: "processing" }] };
    }
    return { rows: [] };
  })
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

describe("RabbitMQ Consumer Hardening & Auditing", () => {
  beforeEach(() => {
    consumeCallback = null;
    mockChannel.ack.mock.resetCalls();
    mockChannel.nack.mock.resetCalls();
    mockChannel.sendToQueue.mock.resetCalls();
    mockChannel.consume.mock.resetCalls();
    mockWorker.process.mock.resetCalls();
    mockPool.query = mock.fn(async (sql: string) => {
      if (sql.includes("SELECT * FROM event_bus_messages")) {
        return { rows: [{ status: "processing" }] };
      }
      return { rows: [] };
    });
  });

  const validPayload = {
    event_id: "550e8400-e29b-41d4-a716-446655440000",
    event_type: "airtable.post.approved.ingress",
    event_version: 1,
    source: "airtable.webhook_receiver",
    workspace_id: "ws-1",
    record_ref: "rec-1",
    approval_ref: new Date().toISOString(),
    idempotency_key: "ik-1",
    correlation_id: "corr-1",
    causation_id: "caus-1"
  };

  it("registers consume callback on start", async () => {
    const consumer = await createRabbitMqConsumer("amqp://localhost", mockWorker, mockLogger, mockDatabase);
    await consumer.start();

    assert.equal(mockChannel.consume.mock.calls.length, 1);
    assert.ok(consumeCallback !== null);
  });

  it("successfully processes message, calls ack, and logs QUEUE_EVENT_CONSUMED", async () => {
    const consumer = await createRabbitMqConsumer("amqp://localhost", mockWorker, mockLogger, mockDatabase);
    await consumer.start();

    mockWorker.process = mock.fn(async () => ({ action: "ack", status: "workflow_stub_created" }));

    const msg = {
      content: Buffer.from(JSON.stringify(validPayload)),
      properties: { messageId: "msg-1", correlationId: "corr-1" },
      fields: { routingKey: "airtable.post.approved.ingress", exchange: "airtable.webhooks" }
    } as any;

    // Simulate consumer loop triggering
    if (consumeCallback) {
      consumeCallback(msg);
    }

    // Wait a brief tick for async handler to run
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Assert acked
    assert.equal(mockChannel.ack.mock.calls.length, 1);
    assert.equal(mockChannel.nack.mock.calls.length, 0);

    // Assert audit consumed log query executed
    const auditCall = mockPool.query.mock.calls.find((c: any) =>
      c.arguments[0].includes("INSERT INTO audit_logs")
    );
    assert.ok(auditCall, "Expected audit log query to be executed");
    assert.ok(auditCall.arguments[1].includes("QUEUE_EVENT_CONSUMED"));
    assert.ok(auditCall.arguments[1].includes("ws-1"));
  });

  it("handles transient failure, calls nack with requeue, and logs QUEUE_EVENT_RETRIED", async () => {
    const consumer = await createRabbitMqConsumer("amqp://localhost", mockWorker, mockLogger, mockDatabase);
    await consumer.start();

    mockWorker.process = mock.fn(async () => ({ action: "nack_requeue", status: "retryable_failed" }));

    const msg = {
      content: Buffer.from(JSON.stringify(validPayload)),
      properties: { messageId: "msg-1", correlationId: "corr-1" },
      fields: { routingKey: "airtable.post.approved.ingress", exchange: "airtable.webhooks" }
    } as any;

    if (consumeCallback) {
      consumeCallback(msg);
    }

    // Wait a brief tick for async handler (must exceed the setTimeout of 1s in nack_requeue or we mock setTimeout)
    // Wait, the code sleeps for 1000ms. We can wait 1100ms in the test.
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // Assert nacked with requeue
    assert.equal(mockChannel.nack.mock.calls.length, 1);
    assert.equal(mockChannel.nack.mock.calls[0].arguments[2], true); // requeue = true

    // Assert audit retried log query executed
    const auditCall = mockPool.query.mock.calls.find((c: any) =>
      c.arguments[0].includes("INSERT INTO audit_logs")
    );
    assert.ok(auditCall, "Expected audit log query to be executed");
    assert.ok(auditCall.arguments[1].includes("QUEUE_EVENT_RETRIED"));
  });

  it("handles validation failure, routes to DLQ, and logs QUEUE_EVENT_DLQ", async () => {
    const consumer = await createRabbitMqConsumer("amqp://localhost", mockWorker, mockLogger, mockDatabase);
    await consumer.start();

    const invalidPayload = {
      event_type: "airtable.post.approved.ingress"
      // Missing required fields
    };

    const msg = {
      content: Buffer.from(JSON.stringify(invalidPayload)),
      properties: { messageId: "msg-1", correlationId: "corr-1" },
      fields: { routingKey: "airtable.post.approved.ingress", exchange: "airtable.webhooks" }
    } as any;

    if (consumeCallback) {
      consumeCallback(msg);
    }

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Assert routed to DLQ (sendToQueue called)
    assert.equal(mockChannel.sendToQueue.mock.calls.length, 1);
    assert.equal(mockChannel.ack.mock.calls.length, 1); // Acks original message after routing to DLQ

    // Assert audit DLQ log query executed
    const auditCall = mockPool.query.mock.calls.find((c: any) =>
      c.arguments[0].includes("INSERT INTO audit_logs")
    );
    assert.ok(auditCall, "Expected audit log query to be executed");
    assert.ok(auditCall.arguments[1].includes("QUEUE_EVENT_DLQ"));
  });

  it("skips worker processing and immediately acks duplicate messages", async () => {
    const consumer = await createRabbitMqConsumer("amqp://localhost", mockWorker, mockLogger, mockDatabase);
    await consumer.start();

    // Mock DB query to return 'succeeded' status for idempotency check
    mockPool.query = mock.fn(async (sql: string) => {
      if (sql.includes("SELECT * FROM event_bus_messages")) {
        return { rows: [{ status: "succeeded" }] };
      }
      return { rows: [] };
    });

    const msg = {
      content: Buffer.from(JSON.stringify(validPayload)),
      properties: { messageId: "msg-dup", correlationId: "corr-dup" },
      fields: { routingKey: "airtable.post.approved.ingress", exchange: "airtable.webhooks" }
    } as any;

    if (consumeCallback) {
      consumeCallback(msg);
    }

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Assert ack was called, but worker process was NOT called
    assert.equal(mockChannel.ack.mock.calls.length, 1);
    assert.equal(mockWorker.process.mock.calls.length, 0);
  });

  it("marks idempotency succeeded when worker returns ack", async () => {
    const consumer = await createRabbitMqConsumer("amqp://localhost", mockWorker, mockLogger, mockDatabase);
    await consumer.start();

    mockWorker.process = mock.fn(async () => ({ action: "ack", status: "workflow_stub_created" }));

    const msg = {
      content: Buffer.from(JSON.stringify(validPayload)),
      properties: { messageId: "msg-ok", correlationId: "corr-ok" },
      fields: { routingKey: "airtable.post.approved.ingress", exchange: "airtable.webhooks" }
    } as any;

    if (consumeCallback) {
      consumeCallback(msg);
    }

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Assert worker process was called
    assert.equal(mockWorker.process.mock.calls.length, 1);
    assert.equal(mockChannel.ack.mock.calls.length, 1);

    // Verify idempotency was marked succeeded (UPDATE query)
    const updateCall = mockPool.query.mock.calls.find((c: any) =>
      c.arguments[0].includes("UPDATE event_bus_messages") &&
      c.arguments[0].includes("succeeded")
    );
    assert.ok(updateCall, "Expected an UPDATE query marking idempotency succeeded");
  });

  it("marks idempotency failed when worker returns nack_dlq", async () => {
    const consumer = await createRabbitMqConsumer("amqp://localhost", mockWorker, mockLogger, mockDatabase);
    await consumer.start();

    mockWorker.process = mock.fn(async () => ({ action: "nack_dlq", status: "permanent_failed" }));

    const msg = {
      content: Buffer.from(JSON.stringify(validPayload)),
      properties: { messageId: "msg-fail", correlationId: "corr-fail" },
      fields: { routingKey: "airtable.post.approved.ingress", exchange: "airtable.webhooks" }
    } as any;

    if (consumeCallback) {
      consumeCallback(msg);
    }

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Assert worker process was called
    assert.equal(mockWorker.process.mock.calls.length, 1);
    assert.equal(mockChannel.sendToQueue.mock.calls.length, 1); // moved to DLQ

    // Verify idempotency was marked failed (UPDATE query)
    const updateCall = mockPool.query.mock.calls.find((c: any) =>
      c.arguments[0].includes("UPDATE event_bus_messages") &&
      c.arguments[0].includes("failed")
    );
    assert.ok(updateCall, "Expected an UPDATE query marking idempotency failed");
  });
});
