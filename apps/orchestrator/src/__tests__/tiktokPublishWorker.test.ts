import { describe, it } from "node:test";
import assert from "node:assert";
import { TiktokPublishWorker } from "../workers/tiktokPublishWorker.js";
import { Database } from "../ledger/postgres.js";
import { Logger } from "../lib/logger.js";
import { TiktokMcpClient } from "../mcp/tiktokMcpClient.js";
import { AirtableClient } from "../airtable/airtableClient.js";
import type { PublishTiktokExecuteEvent } from "@mediaops/shared-contracts";

describe("TiktokPublishWorker", () => {
  it("should nack_dlq if workspace mismatch", async () => {
    const mockDb = {} as Database;
    const mockClient = {} as TiktokMcpClient;
    const mockAirtable = {} as AirtableClient;
    const mockLogger = { error: () => {} } as unknown as Logger;
    const worker = new TiktokPublishWorker(mockDb, mockClient, mockAirtable, mockLogger, "ws-1");

    const msg: PublishTiktokExecuteEvent = {
      event_id: "evt-1",
      event_type: "publish.tiktok.execute",
      event_version: 1,
      workspace_id: "ws-other",
      correlation_id: "corr-1",
      workflow_run_id: "wf-1",
      job_id: "job-1",
      variant_id: "var-1",
      channel_account_id: "chan-1",
      scheduled_at: new Date().toISOString(),
      idempotency_key: "idem-1",
      created_at: new Date().toISOString()
    };

    const res = await worker.processQueueMessage(msg, "msg-1");
    assert.strictEqual(res.action, "nack_dlq");
    assert.strictEqual(res.status, "workspace_mismatch");
  });

  it("should skip API call and reuse request ID if job already has tiktok_request_id", async () => {
    let callToolCount = 0;
    const mockDb = {
      transaction: async (ws: string, cb: (client: any) => Promise<any>) => cb({})
    } as unknown as Database;
    const mockClient = {
      publishTiktokPhoto: async () => {
        callToolCount++;
        return { passed: true, tiktokRequestId: "new-request-id" };
      }
    } as unknown as TiktokMcpClient;
    const mockAirtable = {
      getPostRecord: async () => ({ fields: { tiktok_post_type: "photo" } })
    } as unknown as AirtableClient;
    const mockLogger = {
      info: () => {},
      error: () => {}
    } as unknown as Logger;

    const worker = new TiktokPublishWorker(mockDb, mockClient, mockAirtable, mockLogger, "ws-1");

    const mockRepo = {
      loadAndLockContext: async () => ({
        job: { id: "job-1", workspace_id: "ws-1", status: "publishing", tiktok_request_id: "existing-req-id" },
        variant: { id: "var-1", post_id: "post-1", body: "hello", hashtags: [], airtable_record_id: "rec-1" },
        channelAccount: { id: "chan-1", external_account_id: "ext-1", secret_ref: "secret-1" },
        mediaDerivatives: [{ public_url: "http://example.com/image.jpg", derivative_kind: "tiktok_photo" }]
      }),
      persistPendingStatus: async () => {}
    };
    (worker as any).repository = mockRepo;

    const msg: PublishTiktokExecuteEvent = {
      event_id: "evt-1",
      event_type: "publish.tiktok.execute",
      event_version: 1,
      workspace_id: "ws-1",
      correlation_id: "corr-1",
      workflow_run_id: "wf-1",
      job_id: "job-1",
      variant_id: "var-1",
      channel_account_id: "chan-1",
      scheduled_at: new Date().toISOString(),
      idempotency_key: "idem-1",
      created_at: new Date().toISOString()
    };

    const res = await worker.processQueueMessage(msg, "msg-1");
    assert.strictEqual(res.action, "ack");
    assert.strictEqual(res.status, "published_pending_status");
    assert.strictEqual(callToolCount, 0); // MCP publish must NOT be called
  });

  it("should reset job status to validated on transient publish error", async () => {
    let resetCount = 0;
    const mockDb = {
      transaction: async (ws: string, cb: (client: any) => Promise<any>) => cb({})
    } as unknown as Database;
    const mockClient = {
      publishTiktokPhoto: async () => {
        throw new Error("Transient connection timeout");
      }
    } as unknown as TiktokMcpClient;
    const mockAirtable = {
      getPostRecord: async () => ({ fields: { tiktok_post_type: "photo" } })
    } as unknown as AirtableClient;
    const mockLogger = {
      info: () => {},
      warn: () => {},
      error: () => {}
    } as unknown as Logger;

    const worker = new TiktokPublishWorker(mockDb, mockClient, mockAirtable, mockLogger, "ws-1");

    const mockRepo = {
      loadAndLockContext: async () => ({
        job: { id: "job-1", workspace_id: "ws-1", status: "publishing", tiktok_request_id: null },
        variant: { id: "var-1", post_id: "post-1", body: "hello", hashtags: [], airtable_record_id: "rec-1" },
        channelAccount: { id: "chan-1", external_account_id: "ext-1", secret_ref: "secret-1" },
        mediaDerivatives: [{ public_url: "http://example.com/image.jpg", derivative_kind: "tiktok_photo" }]
      }),
      persistTransientFailure: async () => {
        resetCount++;
      }
    };
    (worker as any).repository = mockRepo;

    const msg: PublishTiktokExecuteEvent = {
      event_id: "evt-1",
      event_type: "publish.tiktok.execute",
      event_version: 1,
      workspace_id: "ws-1",
      correlation_id: "corr-1",
      workflow_run_id: "wf-1",
      job_id: "job-1",
      variant_id: "var-1",
      channel_account_id: "chan-1",
      scheduled_at: new Date().toISOString(),
      idempotency_key: "idem-1",
      created_at: new Date().toISOString()
    };

    const res = await worker.processQueueMessage(msg, "msg-1");
    assert.strictEqual(res.action, "nack_requeue");
    assert.strictEqual(res.status, "transient_failure");
    assert.strictEqual(resetCount, 1); // Should reset status back to validated
  });

  it("should persist permanent failure for TikTok file format rejection", async () => {
    let permanentFailure: { errorCode: string; errorMessage: string } | null = null;
    let transientFailureCount = 0;
    const mockDb = {
      transaction: async (ws: string, cb: (client: any) => Promise<any>) => cb({})
    } as unknown as Database;
    const mockClient = {
      publishTiktokPhoto: async () => ({
        passed: false,
        errors: [{ code: "file_format_check_failed", detail: "TikTok rejected the image format" }]
      })
    } as unknown as TiktokMcpClient;
    const mockAirtable = {
      getPostRecord: async () => ({ fields: { tiktok_post_type: "photo" } })
    } as unknown as AirtableClient;
    const mockLogger = {
      info: () => {},
      warn: () => {},
      error: () => {}
    } as unknown as Logger;
    const mockQueuePublisher = {
      publishSlackAlert: async () => {},
      publishTiktokStatusCheck: async () => {}
    };

    const worker = new TiktokPublishWorker(mockDb, mockClient, mockAirtable, mockLogger, "ws-1", mockQueuePublisher);

    const mockRepo = {
      loadAndLockContext: async () => ({
        job: { id: "job-1", workspace_id: "ws-1", status: "publishing", tiktok_request_id: null },
        variant: { id: "var-1", post_id: "post-1", body: "hello", hashtags: [], airtable_record_id: "rec-1" },
        channelAccount: { id: "chan-1", external_account_id: "ext-1", secret_ref: "secret-1" },
        mediaDerivatives: [{ public_url: "https://cdn.example.com/image.jpg", derivative_kind: "tiktok_photo" }]
      }),
      persistPermanentFailure: async (
        _client: unknown,
        _workspaceId: string,
        _jobId: string,
        _correlationId: string,
        errorCode: string,
        errorMessage: string
      ) => {
        permanentFailure = { errorCode, errorMessage };
      },
      persistTransientFailure: async () => {
        transientFailureCount++;
      }
    };
    (worker as any).repository = mockRepo;

    const msg: PublishTiktokExecuteEvent = {
      event_id: "evt-1",
      event_type: "publish.tiktok.execute",
      event_version: 1,
      workspace_id: "ws-1",
      correlation_id: "corr-1",
      workflow_run_id: "wf-1",
      job_id: "job-1",
      variant_id: "var-1",
      channel_account_id: "chan-1",
      scheduled_at: new Date().toISOString(),
      idempotency_key: "idem-1",
      created_at: new Date().toISOString()
    };

    const res = await worker.processQueueMessage(msg, "msg-1");
    assert.strictEqual(res.action, "ack");
    assert.strictEqual(res.status, "permanent_failure");
    assert.deepStrictEqual(permanentFailure, {
      errorCode: "file_format_check_failed",
      errorMessage: "TikTok rejected the image format"
    });
    assert.strictEqual(transientFailureCount, 0);
  });
});
