import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { McpPublishWorker } from "../mcpPublishWorker.js";
import { McpPublishWorkerRepository } from "../../ledger/mcpPublishWorkerRepository.js";

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

  it("updates workflow status through content_variants instead of publish_jobs.workflow_run_id", async () => {
    const repository = new McpPublishWorkerRepository();
    const queries: string[] = [];
    const client = {
      query: mock.fn(async (sql: string) => {
        queries.push(sql);
        return { rows: [], rowCount: 1 };
      })
    };

    await repository.persistSuccess(client as any, "ws-1", "job-1", "corr-1", {
      passed: true,
      externalPostId: "post-1",
      platformResponseSummary: {},
      publishedAt: new Date().toISOString()
    });

    const workflowUpdate = queries.find((sql) => sql.includes("UPDATE workflow_runs"));
    assert.ok(workflowUpdate);
    assert.match(workflowUpdate, /JOIN content_variants cv/i);
    assert.match(workflowUpdate, /cv\.workflow_run_id/i);
    assert.doesNotMatch(workflowUpdate, /SELECT workflow_run_id FROM publish_jobs/i);
  });

  it("passes the external platform page id to MCP publish input", async () => {
    const repository = new McpPublishWorkerRepository();
    const client = {
      query: mock.fn(async (sql: string) => {
        if (sql.includes("FROM publish_jobs") && sql.includes("FOR UPDATE")) {
          return { rows: [{ id: "job-1", workspace_id: "ws-1", status: "validated" }] };
        }
        if (sql.includes("FROM content_variants")) {
          return {
            rows: [{
              id: "var-1",
              body: "hello",
              hashtags: [],
              cta_url: null,
              airtable_record_id: "rec-1"
            }]
          };
        }
        if (sql.includes("FROM channel_accounts")) {
          return {
            rows: [{
              id: "93417ba5-4290-4923-888a-cb94f38a0d69",
              external_account_id: "1148572968338785",
              secret_ref: "dbsecret:ws-1:secret-1"
            }]
          };
        }
        return { rows: [], rowCount: 1 };
      })
    };

    const context = await repository.loadAndLockContext(client as any, "ws-1", {
      eventId: "11111111-1111-4111-8111-111111111111",
      eventType: "publish.facebook.execute",
      eventVersion: "1",
      workspaceId: "ws-1",
      jobId: "job-1",
      variantId: "var-1",
      channelAccountId: "93417ba5-4290-4923-888a-cb94f38a0d69",
      scheduledAt: new Date().toISOString(),
      idempotencyKey: "idem-1",
      correlationId: "corr-1",
      createdAt: new Date().toISOString()
    });

    assert.equal(context?.input?.channelAccountId, "1148572968338785");
  });

  it("passes Airtable asset links from Ledger as publish media references", async () => {
    const repository = new McpPublishWorkerRepository();
    const client = {
      query: mock.fn(async (sql: string) => {
        if (sql.includes("FROM publish_jobs") && sql.includes("FOR UPDATE")) {
          return { rows: [{ id: "job-1", workspace_id: "ws-1", status: "validated" }] };
        }
        if (sql.includes("FROM content_variants")) {
          return {
            rows: [{
              id: "var-1",
              body: "hello",
              hashtags: ["#demo"],
              cta_url: null,
              asset_links: ["https://cdn.example.com/demo.jpg", "https://cdn.example.com/brief.pdf"],
              airtable_record_id: "rec-1"
            }]
          };
        }
        if (sql.includes("FROM channel_accounts")) {
          return {
            rows: [{
              id: "93417ba5-4290-4923-888a-cb94f38a0d69",
              external_account_id: "1148572968338785",
              secret_ref: "dbsecret:ws-1:secret-1"
            }]
          };
        }
        return { rows: [], rowCount: 1 };
      })
    };

    const context = await repository.loadAndLockContext(client as any, "ws-1", {
      eventId: "11111111-1111-4111-8111-111111111111",
      eventType: "publish.facebook.execute",
      eventVersion: "1",
      workspaceId: "ws-1",
      jobId: "job-1",
      variantId: "var-1",
      channelAccountId: "93417ba5-4290-4923-888a-cb94f38a0d69",
      scheduledAt: new Date().toISOString(),
      idempotencyKey: "idem-1",
      correlationId: "corr-1",
      createdAt: new Date().toISOString()
    });

    assert.deepEqual(context?.input?.content.media, [
      { type: "image", url: "https://cdn.example.com/demo.jpg" },
      { type: "document", url: "https://cdn.example.com/brief.pdf" }
    ]);
    assert.equal(context?.input?.content.link, "https://cdn.example.com/brief.pdf");
  });

  it("classifies Airtable attachment objects by MIME type for media publish", async () => {
    const repository = new McpPublishWorkerRepository();
    const client = {
      query: mock.fn(async (sql: string) => {
        if (sql.includes("FROM publish_jobs") && sql.includes("FOR UPDATE")) {
          return { rows: [{ id: "job-1", workspace_id: "ws-1", status: "validated" }] };
        }
        if (sql.includes("FROM content_variants")) {
          return {
            rows: [{
              id: "var-1",
              body: "hello",
              hashtags: [],
              cta_url: null,
              asset_links: [
                { url: "https://airtable.example.com/opaque-image-url", filename: "cover", mimeType: "image/png" },
                { url: "https://airtable.example.com/opaque-doc-url", filename: "brief", mimeType: "application/pdf" }
              ],
              airtable_record_id: "rec-1"
            }]
          };
        }
        if (sql.includes("FROM channel_accounts")) {
          return {
            rows: [{
              id: "93417ba5-4290-4923-888a-cb94f38a0d69",
              external_account_id: "1148572968338785",
              secret_ref: "dbsecret:ws-1:secret-1"
            }]
          };
        }
        return { rows: [], rowCount: 1 };
      })
    };

    const context = await repository.loadAndLockContext(client as any, "ws-1", {
      eventId: "11111111-1111-4111-8111-111111111111",
      eventType: "publish.facebook.execute",
      eventVersion: "1",
      workspaceId: "ws-1",
      jobId: "job-1",
      variantId: "var-1",
      channelAccountId: "93417ba5-4290-4923-888a-cb94f38a0d69",
      scheduledAt: new Date().toISOString(),
      idempotencyKey: "idem-1",
      correlationId: "corr-1",
      createdAt: new Date().toISOString()
    });

    assert.deepEqual(context?.input?.content.media, [
      { type: "image", url: "https://airtable.example.com/opaque-image-url" },
      { type: "document", url: "https://airtable.example.com/opaque-doc-url" }
    ]);
  });
});
