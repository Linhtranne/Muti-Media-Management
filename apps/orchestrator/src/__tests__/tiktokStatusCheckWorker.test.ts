import { describe, it } from "node:test";
import assert from "node:assert";
import { TiktokStatusCheckWorker } from "../workers/tiktokStatusCheckWorker.js";
import { Database } from "../ledger/postgres.js";
import { Logger } from "../lib/logger.js";
import { TiktokMcpClient } from "../mcp/tiktokMcpClient.js";
import type { PublishTiktokStatusCheckEvent } from "@mediaops/shared-contracts";

describe("TiktokStatusCheckWorker", () => {
  it("should nack_dlq if workspace mismatch", async () => {
    const mockDb = {} as Database;
    const mockClient = {} as TiktokMcpClient;
    const mockLogger = { error: () => {} } as unknown as Logger;
    const worker = new TiktokStatusCheckWorker(mockDb, mockClient, mockLogger, "ws-1");

    const msg: PublishTiktokStatusCheckEvent = {
      event_id: "evt-1",
      event_type: "publish.tiktok.status_check",
      event_version: 1,
      workspace_id: "ws-other",
      correlation_id: "corr-1",
      workflow_run_id: "wf-1",
      job_id: "job-1",
      variant_id: "var-1",
      channel_account_id: "chan-1",
      scheduled_at: new Date().toISOString(),
      idempotency_key: "idem-1",
      tiktok_request_id: "req-1",
      check_attempt_count: 0,
      created_at: new Date().toISOString()
    };

    const res = await worker.processQueueMessage(msg, "msg-1");
    assert.strictEqual(res.action, "nack_dlq");
    assert.strictEqual(res.status, "workspace_mismatch");
  });

  it("should persist permanent failure if status is PUBLISHED but externalPostId is missing", async () => {
    let failedCount = 0;
    const mockDb = {
      transaction: async (ws: string, cb: (client: any) => Promise<any>) => cb({})
    } as unknown as Database;
    const mockClient = {
      getTiktokPublishStatus: async () => {
        return { status: "PUBLISHED", externalPostId: undefined, passed: true };
      }
    } as unknown as TiktokMcpClient;
    const mockLogger = {
      info: () => {},
      error: () => {},
      warn: () => {}
    } as unknown as Logger;

    const worker = new TiktokStatusCheckWorker(mockDb, mockClient, mockLogger, "ws-1");

    const mockRepo = {
      loadAndLockContext: async () => ({
        job: { id: "job-1", workspace_id: "ws-1", status: "pending_platform_status", tiktok_request_id: "req-1" },
        channelAccount: { id: "chan-1", external_account_id: "ext-1", secret_ref: "secret-1" }
      }),
      persistFailure: async (client: any, ws: string, jobId: string, corrId: string, errorCode: string, errorMessage: string) => {
        failedCount++;
        assert.strictEqual(errorCode, "PLATFORM_ERROR");
        assert.ok(errorMessage.includes("lacked externalPostId"));
      }
    };
    (worker as any).repository = mockRepo;

    const msg: PublishTiktokStatusCheckEvent = {
      event_id: "evt-1",
      event_type: "publish.tiktok.status_check",
      event_version: 1,
      workspace_id: "ws-1",
      correlation_id: "corr-1",
      workflow_run_id: "wf-1",
      job_id: "job-1",
      variant_id: "var-1",
      channel_account_id: "chan-1",
      scheduled_at: new Date().toISOString(),
      idempotency_key: "idem-1",
      tiktok_request_id: "req-1",
      check_attempt_count: 0,
      created_at: new Date().toISOString()
    };

    const res = await worker.processQueueMessage(msg, "msg-1");
    // Since it throws a permanent PLATFORM_ERROR, it is caught, logged, and marked as failed (returning ack)
    assert.strictEqual(res.action, "ack");
    assert.strictEqual(res.status, "failed");
    assert.strictEqual(failedCount, 1);
  });
});
