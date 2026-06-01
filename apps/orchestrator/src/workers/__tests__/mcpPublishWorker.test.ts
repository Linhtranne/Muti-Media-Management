import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { McpPublishWorker } from "../mcpPublishWorker.js";

const mockDatabase = {
  transaction: mock.fn(async (workspaceId: string, callback: any) => {
    return callback({});
  })
} as any;

const mockMcpClient = {
  publishPost: mock.fn()
} as any;

const mockAirtableClient = {
  updateRecordStatus: mock.fn()
} as any;

const mockLogger = {
  info: mock.fn(),
  error: mock.fn(),
  warn: mock.fn()
} as any;

const mockQueuePublisher = {
  publishSlackAlert: mock.fn()
} as any;

describe("McpPublishWorker", () => {
  let worker: McpPublishWorker;

  beforeEach(() => {
    mockDatabase.transaction.mock.resetCalls();
    mockMcpClient.publishPost.mock.resetCalls();
    mockAirtableClient.updateRecordStatus.mock.resetCalls();
    mockLogger.info.mock.resetCalls();
    mockLogger.error.mock.resetCalls();
    mockLogger.warn.mock.resetCalls();
    mockQueuePublisher.publishSlackAlert.mock.resetCalls();
    
    worker = new McpPublishWorker(
      mockDatabase,
      mockMcpClient,
      mockAirtableClient,
      mockLogger,
      "ws-1",
      mockQueuePublisher
    );

    // Override internal repository
    (worker as any).repository = {
      loadAndLockContext: mock.fn(async () => ({
        job: { id: "job-1", workspace_id: "ws-1", status: "validated" },
        airtable_record_id: "rec-1",
        input: {
          jobRef: { jobId: "job-1" },
          channelAccountId: "acc-1",
          secretRef: "sec-1",
          content: { body: "test" }
        }
      })),
      persistSuccess: mock.fn(async () => undefined),
      persistTransientFailure: mock.fn(async () => undefined),
      persistPermanentFailure: mock.fn(async () => undefined),
      persistAirtableCompensation: mock.fn(async () => undefined)
    };
  });

  it("processes successful publish", async () => {
    mockMcpClient.publishPost = mock.fn(async () => ({
      passed: true,
      externalPostId: "ext-1",
      platformResponseSummary: {},
      publishedAt: new Date().toISOString()
    }));

    const msg = {
      eventId: "e-1",
      eventType: "publish.facebook.execute" as const,
      eventVersion: "1",
      workspaceId: "ws-1",
      jobId: "job-1",
      variantId: "var-1",
      channelAccountId: "acc-1",
      scheduledAt: new Date().toISOString(),
      idempotencyKey: "idem-1",
      correlationId: "corr-1",
      createdAt: new Date().toISOString()
    };

    const result = await worker.processQueueMessage(msg, "msg-1");
    
    assert.equal(result.action, "ack");
    assert.equal(result.status, "published");
    assert.equal(mockAirtableClient.updateRecordStatus.mock.calls.length, 1);
    assert.deepEqual(mockAirtableClient.updateRecordStatus.mock.calls[0].arguments, ["ws-1", "rec-1", "Published"]);
    assert.equal(mockQueuePublisher.publishSlackAlert.mock.calls.length, 1);
  });

  it("handles transient failure", async () => {
    mockMcpClient.publishPost = mock.fn(async () => ({
      passed: false,
      errors: [{ code: "PLATFORM_TRANSIENT_ERROR", detail: "timeout" }]
    }));

    const msg = {
      eventId: "e-1",
      eventType: "publish.facebook.execute" as const,
      eventVersion: "1",
      workspaceId: "ws-1",
      jobId: "job-1",
      variantId: "var-1",
      channelAccountId: "acc-1",
      scheduledAt: new Date().toISOString(),
      idempotencyKey: "idem-1",
      correlationId: "corr-1",
      createdAt: new Date().toISOString()
    };

    const result = await worker.processQueueMessage(msg, "msg-1");
    
    assert.equal(result.action, "nack_requeue");
    assert.equal(result.status, "transient_failure");
    assert.equal(mockAirtableClient.updateRecordStatus.mock.calls.length, 0);
  });

  it("handles permanent failure", async () => {
    mockMcpClient.publishPost = mock.fn(async () => ({
      passed: false,
      errors: [{ code: "PLATFORM_API_ERROR", detail: "invalid token" }]
    }));

    const msg = {
      eventId: "e-1",
      eventType: "publish.facebook.execute" as const,
      eventVersion: "1",
      workspaceId: "ws-1",
      jobId: "job-1",
      variantId: "var-1",
      channelAccountId: "acc-1",
      scheduledAt: new Date().toISOString(),
      idempotencyKey: "idem-1",
      correlationId: "corr-1",
      createdAt: new Date().toISOString()
    };

    const result = await worker.processQueueMessage(msg, "msg-1");
    
    assert.equal(result.action, "ack");
    assert.equal(result.status, "permanent_failure");
    assert.equal(mockAirtableClient.updateRecordStatus.mock.calls.length, 1);
    assert.deepEqual(mockAirtableClient.updateRecordStatus.mock.calls[0].arguments, ["ws-1", "rec-1", "Failed"]);
    assert.equal(mockQueuePublisher.publishSlackAlert.mock.calls.length, 1);
  });
});
