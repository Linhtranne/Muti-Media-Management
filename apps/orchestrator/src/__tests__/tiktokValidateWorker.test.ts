import { describe, it } from "node:test";
import assert from "node:assert";
import { TiktokValidateWorker } from "../workers/tiktokValidateWorker.js";
import { Database } from "../ledger/postgres.js";
import { Logger } from "../lib/logger.js";
import { TiktokMcpClient } from "../mcp/tiktokMcpClient.js";
import { AirtableClient } from "../airtable/airtableClient.js";
import type { PublishTiktokRequestedEvent } from "@mediaops/shared-contracts";

describe("TiktokValidateWorker", () => {
  it("should nack_dlq if workspace mismatch", async () => {
    const mockDb = {} as Database;
    const mockClient = {} as TiktokMcpClient;
    const mockLogger = { error: () => {} } as unknown as Logger;
    const worker = new TiktokValidateWorker(mockDb, mockClient, mockLogger, "ws-1");

    const msg: PublishTiktokRequestedEvent = {
      event_id: "evt-1",
      event_type: "publish.tiktok.requested",
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

  it("should fail validation if video post has no tiktok_video derivative", async () => {
    let persistCall = null;
    const mockDb = {
      transaction: async (ws: string, cb: (client: any) => Promise<any>) => cb({})
    } as unknown as Database;
    const mockClient = {
      validatePost: async () => ({ passed: true, violations: [], warnings: [], checkedAt: new Date().toISOString() })
    } as unknown as TiktokMcpClient;
    const mockAirtable = {
      getPostRecord: async () => ({ fields: { tiktok_post_type: "video" } })
    } as unknown as AirtableClient;
    const mockLogger = {
      info: () => {},
      warn: () => {},
      error: () => {}
    } as unknown as Logger;

    const worker = new TiktokValidateWorker(mockDb, mockClient, mockLogger, "ws-1", undefined, mockAirtable);

    const mockRepo = {
      getExistingResult: async () => null,
      loadAndLockContext: async () => ({
        job: { id: "job-1", workspace_id: "ws-1", status: "queued" },
        variant: { id: "var-1", post_id: "post-1", body: "hello video", hashtags: [], airtable_record_id: "rec-1" },
        mediaDerivatives: [{ public_url: "http://example.com/image.jpg", derivative_kind: "tiktok_photo" }],
        input: { variantRef: { variantId: "var-1", bodyLength: 11, hashtagCount: 0, hasMedia: true }, channelAccountId: "chan-1", workspaceId: "ws-1" }
      }),
      persistValidation: async (client: any, ws: string, msg: any, ctx: any, result: any) => {
        persistCall = result;
        return { status: "persisted" as const, passed: result.passed };
      }
    };
    (worker as any).repository = mockRepo;

    const msg: PublishTiktokRequestedEvent = {
      event_id: "evt-1",
      event_type: "publish.tiktok.requested",
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
    assert.strictEqual(res.status, "validation_failed");
    assert.ok(persistCall);
    assert.strictEqual((persistCall as any).passed, false);
    assert.ok((persistCall as any).violations.some((v: any) => v.code === "PLATFORM_MEDIA_UNSUPPORTED"));
  });

  it("should fail validation if public URL contains presigned query parameter secrets", async () => {
    let persistCall = null;
    const mockDb = {
      transaction: async (ws: string, cb: (client: any) => Promise<any>) => cb({})
    } as unknown as Database;
    const mockClient = {
      validatePost: async () => ({ passed: true, violations: [], warnings: [], checkedAt: new Date().toISOString() })
    } as unknown as TiktokMcpClient;
    const mockAirtable = {
      getPostRecord: async () => ({ fields: { tiktok_post_type: "video" } })
    } as unknown as AirtableClient;
    const mockLogger = {
      info: () => {},
      warn: () => {},
      error: () => {}
    } as unknown as Logger;

    const worker = new TiktokValidateWorker(mockDb, mockClient, mockLogger, "ws-1", undefined, mockAirtable);

    const mockRepo = {
      getExistingResult: async () => null,
      loadAndLockContext: async () => ({
        job: { id: "job-1", workspace_id: "ws-1", status: "queued" },
        variant: { id: "var-1", post_id: "post-1", body: "hello video", hashtags: [], airtable_record_id: "rec-1" },
        mediaDerivatives: [{ public_url: "http://example.com/video.mp4?AWSAccessKeyId=AKIAIOSFODNN7EXAMPLE&Signature=vjbyPxybdZaNmGa%2ByT272YEAiv4%3D&Expires=1170068400", derivative_kind: "tiktok_video" }],
        input: { variantRef: { variantId: "var-1", bodyLength: 11, hashtagCount: 0, hasMedia: true }, channelAccountId: "chan-1", workspaceId: "ws-1" }
      }),
      persistValidation: async (client: any, ws: string, msg: any, ctx: any, result: any) => {
        persistCall = result;
        return { status: "persisted" as const, passed: result.passed };
      }
    };
    (worker as any).repository = mockRepo;

    const msg: PublishTiktokRequestedEvent = {
      event_id: "evt-1",
      event_type: "publish.tiktok.requested",
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
    assert.strictEqual(res.status, "validation_failed");
    assert.ok(persistCall);
    assert.strictEqual((persistCall as any).passed, false);
    assert.ok((persistCall as any).violations.some((v: any) => v.code === "PLATFORM_MEDIA_UNSUPPORTED"));
    // Ensure detail is redacted
    const violation = (persistCall as any).violations.find((v: any) => v.code === "PLATFORM_MEDIA_UNSUPPORTED");
    assert.ok(!violation.detail.includes("AWSAccessKeyId"));
  });

  it("should fail validation if copy exceeds maximum limits", async () => {
    let persistCall = null;
    const mockDb = {
      transaction: async (ws: string, cb: (client: any) => Promise<any>) => cb({})
    } as unknown as Database;
    const mockClient = {
      validatePost: async () => ({ passed: true, violations: [], warnings: [], checkedAt: new Date().toISOString() })
    } as unknown as TiktokMcpClient;
    const mockAirtable = {
      getPostRecord: async () => ({ fields: { tiktok_post_type: "video" } })
    } as unknown as AirtableClient;
    const mockLogger = {
      info: () => {},
      warn: () => {},
      error: () => {}
    } as unknown as Logger;

    const worker = new TiktokValidateWorker(mockDb, mockClient, mockLogger, "ws-1", undefined, mockAirtable);

    const mockRepo = {
      getExistingResult: async () => null,
      loadAndLockContext: async () => ({
        job: { id: "job-1", workspace_id: "ws-1", status: "queued" },
        variant: { id: "var-1", post_id: "post-1", body: "A".repeat(2201), hashtags: [], airtable_record_id: "rec-1" },
        mediaDerivatives: [{ public_url: "http://example.com/video.mp4", derivative_kind: "tiktok_video" }],
        input: { variantRef: { variantId: "var-1", bodyLength: 2201, hashtagCount: 0, hasMedia: true }, channelAccountId: "chan-1", workspaceId: "ws-1" }
      }),
      persistValidation: async (client: any, ws: string, msg: any, ctx: any, result: any) => {
        persistCall = result;
        return { status: "persisted" as const, passed: result.passed };
      }
    };
    (worker as any).repository = mockRepo;

    const msg: PublishTiktokRequestedEvent = {
      event_id: "evt-1",
      event_type: "publish.tiktok.requested",
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
    assert.strictEqual(res.status, "validation_failed");
    assert.ok(persistCall);
    assert.strictEqual((persistCall as any).passed, false);
    assert.ok((persistCall as any).violations.some((v: any) => v.code === "PLATFORM_TEXT_TOO_LONG"));
  });
});
