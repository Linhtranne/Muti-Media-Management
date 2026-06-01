import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { handleMcpPublishQueueMessage } from "../mcpPublishRabbitmqConsumer.js";

const mockChannel = {
  ack: mock.fn(),
  nack: mock.fn(),
  sendToQueue: mock.fn(),
  waitForConfirms: mock.fn(async () => undefined)
} as any;

const mockWorker = {
  processQueueMessage: mock.fn(async () => undefined)
} as any;

const mockLogger = {
  info: mock.fn(),
  warn: mock.fn(),
  error: mock.fn()
} as any;

describe("McpPublishRabbitmqConsumer", () => {
  beforeEach(() => {
    mockChannel.ack.mock.resetCalls();
    mockChannel.nack.mock.resetCalls();
    mockChannel.sendToQueue.mock.resetCalls();
    mockWorker.processQueueMessage.mock.resetCalls();
  });

  it("acks message on successful worker execution", async () => {
    mockWorker.processQueueMessage = mock.fn(async () => ({ action: "ack", status: "published" }));
    
    const msg = {
      content: Buffer.from(JSON.stringify({
        eventId: "00000000-0000-0000-0000-000000000000",
        eventType: "publish.facebook.execute",
        eventVersion: "1",
        workspaceId: "ws-1",
        jobId: "00000000-0000-0000-0000-000000000000",
        variantId: "00000000-0000-0000-0000-000000000000",
        channelAccountId: "c-1",
        scheduledAt: new Date().toISOString(),
        idempotencyKey: "i-1",
        correlationId: "00000000-0000-0000-0000-000000000000",
        createdAt: new Date().toISOString()
      })),
      properties: { messageId: "msg-1" },
      fields: { routingKey: "test", exchange: "test" }
    } as any;

    await handleMcpPublishQueueMessage(mockChannel, mockWorker, mockLogger, msg, () => false);

    assert.equal(mockChannel.ack.mock.calls.length, 1);
    assert.equal(mockChannel.ack.mock.calls[0].arguments[0], msg);
  });

  it("nacks and requeues on transient failure", async () => {
    mockWorker.processQueueMessage = mock.fn(async () => ({ action: "nack_requeue", status: "transient_failure" }));
    
    const msg = {
      content: Buffer.from(JSON.stringify({
        eventId: "00000000-0000-0000-0000-000000000000",
        eventType: "publish.facebook.execute",
        eventVersion: "1",
        workspaceId: "ws-1",
        jobId: "00000000-0000-0000-0000-000000000000",
        variantId: "00000000-0000-0000-0000-000000000000",
        channelAccountId: "c-1",
        scheduledAt: new Date().toISOString(),
        idempotencyKey: "i-1",
        correlationId: "00000000-0000-0000-0000-000000000000",
        createdAt: new Date().toISOString()
      })),
      properties: { messageId: "msg-1" },
      fields: { routingKey: "test", exchange: "test" }
    } as any;

    await handleMcpPublishQueueMessage(mockChannel, mockWorker, mockLogger, msg, () => false);

    assert.equal(mockChannel.nack.mock.calls.length, 1);
    assert.equal(mockChannel.nack.mock.calls[0].arguments[0], msg);
    assert.equal(mockChannel.nack.mock.calls[0].arguments[1], false);
    assert.equal(mockChannel.nack.mock.calls[0].arguments[2], true);
  });

  it("routes to dlq on invalid schema", async () => {
    const msg = {
      content: Buffer.from(JSON.stringify({
        eventType: "publish.facebook.execute",
        body: "forbidden field"
      })),
      properties: { messageId: "msg-1" },
      fields: { routingKey: "test", exchange: "test" }
    } as any;

    await handleMcpPublishQueueMessage(mockChannel, mockWorker, mockLogger, msg, () => false);

    assert.equal(mockChannel.sendToQueue.mock.calls.length, 1);
    assert.equal(mockChannel.ack.mock.calls.length, 1);
    assert.equal(mockChannel.ack.mock.calls[0].arguments[0], msg);
  });
});
