import { describe, it } from "node:test";
import assert from "node:assert";
import { McpValidateWorker } from "../workers/mcpValidateWorker.js";
import { Database } from "../ledger/postgres.js";
import { Logger } from "../lib/logger.js";
import { FacebookMcpClient } from "../mcp/facebookMcpClient.js";
import type { PublishFacebookRequestedEvent } from "@mediaops/shared-contracts";

describe("McpValidateWorker", () => {
  it("should nack_dlq if workspace mismatch", async () => {
    // We only need mock structures for this test
    const mockDb = {} as Database;
    const mockClient = {} as FacebookMcpClient;
    const mockLogger = { error: () => {} } as unknown as Logger;
    const worker = new McpValidateWorker(mockDb, mockClient, mockLogger, "ws-1");

    const msg: PublishFacebookRequestedEvent = {
      event_id: "evt-1",
      event_type: "publish.facebook.requested",
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
});
