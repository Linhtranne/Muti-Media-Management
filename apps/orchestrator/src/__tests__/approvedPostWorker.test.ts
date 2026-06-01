import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ApprovedPostWorker } from "../workers/approvedPostWorker.js";
import { Logger } from "../lib/logger.js";
import {
  AirtableRecordNotFoundError,
  AirtableRateLimitError
} from "../airtable/airtableClient.js";
import type { Database } from "../ledger/postgres.js";
import type { AirtableClient } from "../airtable/airtableClient.js";
import type { AirtableApprovedQueueMessage } from "@mediaops/shared-contracts";

describe("ApprovedPostWorker", () => {
  const logger = new Logger("warn");
  const workspaceId = "ws_test_123";

  const defaultMessage: AirtableApprovedQueueMessage = {
    event_id: "evt_approved_001",
    event_type: "airtable.post.approved.ingress",
    event_version: 1,
    source: "airtable.webhook_receiver",
    workspace_id: workspaceId,
    record_ref: "recPost123",
    approval_ref: "2026-05-27T08:00:00.000Z",
    idempotency_key: "airtable.webhook.ingress:evt_approved_001",
    correlation_id: "corr_123",
    causation_id: "evt_approved_001"
  };

  const createMockAirtableClient = (record: any): AirtableClient => {
    return {
      async updateRecordStatus() {},
      async getPostRecord() {
        return record;
      },
      async fetchCampaignRecord() {
        return {};
      },
      async updateVariantDraft() {
        return;
      }
    };
  };

  it("TS-01 Happy Path: processes valid Approved post, creates workflow stub", async () => {
    const mockAirtable = createMockAirtableClient({
      id: "recPost123",
      fields: {
        status: "Approved",
        is_valid_for_approval: 1,
        scheduled_at: "2026-06-01T12:00:00.000Z",
        master_copy: "Valid content copy",
        approved_at: "2026-05-27T08:00:00.000Z",
        target_channels: ["Facebook"],
        connected_channel_accounts: ["recAcc123"]
      }
    });

    let markProcessingCalled = false;
    let allocateCalled = false;
    let aiMessage: any = null;

    const mockDb: Database = {
      async transaction(wsId, fn) {
        const client = {
          query: async (text: string, values?: any[]) => {
            // Fast-pass check: not finalized
            if (text.includes("FROM webhook_events WHERE event_id =")) {
              return { rows: [{ status: "processing", is_finalized: false, id: "uuid-evt-123" }] };
            }
            // Mark processing
            if (text.includes("UPDATE webhook_events")) {
              markProcessingCalled = true;
              return { rows: [{ id: "uuid-evt-123" }] };
            }
            // Channel account resolution
            if (text.includes("FROM channel_accounts")) {
              return {
                rows: [
                  {
                    id: "uuid-chan-123",
                    platform: "Facebook",
                    airtable_channel_account_record_id: "recAcc123",
                    external_account_id: "ext-fb-456",
                    display_name: "Active FB",
                    status: "active",
                    token_status: "valid"
                  }
                ]
              };
            }
            // Version allocation + Workflow creation (Transaction B)
            if (text.includes("INSERT INTO approval_versions") || text.includes("INSERT INTO workflow_runs")) {
              allocateCalled = true;
              return { rows: [{ current_version: 1, id: "uuid-wf-123" }] };
            }
            // Fallback for advisory lock
            if (text.includes("pg_advisory_xact_lock")) {
              return { rows: [] };
            }
            return { rows: [] };
          }
        } as any;
        return fn(client);
      },
      async query() {
        return { rows: [] } as any;
      },
      getPool() {
        return {} as any;
      }
    };

    const publisher = {
      async publishAiComposerRequest(message: any) {
        aiMessage = message;
      }
    };
    const worker = new ApprovedPostWorker(mockDb, mockAirtable, logger, workspaceId, publisher);
    const result = await worker.process(defaultMessage, "msg-id-123");

    assert.deepEqual(result, {
      action: "ack",
      status: "workflow_stub_created",
      approvedVersion: 1
    });
    assert.ok(markProcessingCalled);
    assert.ok(allocateCalled);
    assert.equal(aiMessage?.event_type, "ai.compose.facebook.requested");
    assert.equal(aiMessage?.workspace_id, workspaceId);
    assert.equal(typeof aiMessage?.workflow_run_id, "string");
    assert.match(aiMessage?.idempotency_key, /^ai\.compose\.facebook:ws_test_123:[^:]+:fb_composer_v1\.0\.0$/);
    assert.equal(Object.prototype.hasOwnProperty.call(aiMessage, "master_copy"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(aiMessage, "cta_url"), false);
  });

  it("TS-02 Fast-Pass: event already finalized returns immediate ACK", async () => {
    const mockAirtable = createMockAirtableClient({});
    const mockDb: Database = {
      async transaction(wsId, fn) {
        const client = {
          query: async (text: string, values?: any[]) => {
            if (text.includes("FROM webhook_events WHERE event_id =")) {
              return { rows: [{ status: "workflow_stub_created", is_finalized: true, id: "uuid-evt-123" }] };
            }
            if (text.includes("INSERT INTO audit_logs")) {
              return { rows: [] };
            }
            return { rows: [] };
          }
        } as any;
        return fn(client);
      },
      async query() {
        return { rows: [] } as any;
      },
      getPool() {
        return {} as any;
      }
    };

    const worker = new ApprovedPostWorker(mockDb, mockAirtable, logger, workspaceId);
    const result = await worker.process(defaultMessage, "msg-id-123");

    assert.deepEqual(result, {
      action: "ack",
      status: "workflow_stub_created"
    });
  });

  it("TS-05 Stale Status: reloaded status is Draft, ignores and ACKs", async () => {
    const mockAirtable = createMockAirtableClient({
      id: "recPost123",
      fields: {
        status: "Draft"
      }
    });

    let ignoredStatus: string | null = null;

    const mockDb: Database = {
      async transaction(wsId, fn) {
        const client = {
          query: async (text: string, values?: any[]) => {
            if (text.includes("FROM webhook_events WHERE event_id =")) {
              return { rows: [{ status: "received", is_finalized: false, id: "uuid-evt-123" }] };
            }
            if (text.includes("UPDATE webhook_events")) {
              if (values && values.includes("state_changed_ignored")) {
                ignoredStatus = "state_changed_ignored";
              }
              return { rows: [{ id: "uuid-evt-123" }] };
            }
            return { rows: [] };
          }
        } as any;
        return fn(client);
      },
      async query() {
        return { rows: [] } as any;
      },
      getPool() {
        return {} as any;
      }
    };

    const worker = new ApprovedPostWorker(mockDb, mockAirtable, logger, workspaceId);
    const result = await worker.process(defaultMessage, "msg-id-123");

    assert.deepEqual(result, {
      action: "ack",
      status: "state_changed_ignored"
    });
    assert.equal(ignoredStatus, "state_changed_ignored");
  });

  it("TS-06 Advanced Status: reloaded status is Scheduled, ignores and ACKs", async () => {
    const mockAirtable = createMockAirtableClient({
      id: "recPost123",
      fields: {
        status: "Scheduled"
      }
    });

    let ignoredStatus: string | null = null;

    const mockDb: Database = {
      async transaction(wsId, fn) {
        const client = {
          query: async (text: string, values?: any[]) => {
            if (text.includes("FROM webhook_events WHERE event_id =")) {
              return { rows: [{ status: "received", is_finalized: false, id: "uuid-evt-123" }] };
            }
            if (text.includes("UPDATE webhook_events")) {
              if (values && values.includes("already_advanced_ignored")) {
                ignoredStatus = "already_advanced_ignored";
              }
              return { rows: [{ id: "uuid-evt-123" }] };
            }
            return { rows: [] };
          }
        } as any;
        return fn(client);
      },
      async query() {
        return { rows: [] } as any;
      },
      getPool() {
        return {} as any;
      }
    };

    const worker = new ApprovedPostWorker(mockDb, mockAirtable, logger, workspaceId);
    const result = await worker.process(defaultMessage, "msg-id-123");

    assert.deepEqual(result, {
      action: "ack",
      status: "already_advanced_ignored"
    });
    assert.equal(ignoredStatus, "already_advanced_ignored");
  });

  it("TS-07 Invalid reload logic formula: ignores and ACKs", async () => {
    const mockAirtable = createMockAirtableClient({
      id: "recPost123",
      fields: {
        status: "Approved",
        is_valid_for_approval: 0,
        master_copy: "Valid content"
      }
    });

    const mockDb: Database = {
      async transaction(wsId, fn) {
        const client = {
          query: async (text: string, values?: any[]) => {
            if (text.includes("FROM webhook_events WHERE event_id =")) {
              return { rows: [{ status: "received", is_finalized: false, id: "uuid-evt-123" }] };
            }
            if (text.includes("UPDATE webhook_events")) {
              return { rows: [{ id: "uuid-evt-123" }] };
            }
            return { rows: [] };
          }
        } as any;
        return fn(client);
      },
      async query() {
        return { rows: [] } as any;
      },
      getPool() {
        return {} as any;
      }
    };

    const worker = new ApprovedPostWorker(mockDb, mockAirtable, logger, workspaceId);
    const result = await worker.process(defaultMessage, "msg-id-123");

    assert.deepEqual(result, {
      action: "ack",
      status: "invalid_after_reload_ignored"
    });
  });

  it("TS-08 Missing channel accounts: ignores and ACKs", async () => {
    const mockAirtable = createMockAirtableClient({
      id: "recPost123",
      fields: {
        status: "Approved",
        is_valid_for_approval: 1,
        master_copy: "Valid content",
        approved_at: "2026-05-27T08:00:00.000Z",
        target_channels: ["Facebook"],
        connected_channel_accounts: []
      }
    });

    const mockDb: Database = {
      async transaction(wsId, fn) {
        const client = {
          query: async (text: string, values?: any[]) => {
            if (text.includes("FROM webhook_events WHERE event_id =")) {
              return { rows: [{ status: "received", is_finalized: false, id: "uuid-evt-123" }] };
            }
            if (text.includes("UPDATE webhook_events")) {
              return { rows: [{ id: "uuid-evt-123" }] };
            }
            return { rows: [] };
          }
        } as any;
        return fn(client);
      },
      async query() {
        return { rows: [] } as any;
      },
      getPool() {
        return {} as any;
      }
    };

    const worker = new ApprovedPostWorker(mockDb, mockAirtable, logger, workspaceId);
    const result = await worker.process(defaultMessage, "msg-id-123");

    assert.deepEqual(result, {
      action: "ack",
      status: "channel_account_missing"
    });
  });

  it("TS-10 Unresolved channel account: routes to DLQ and returns nack_dlq", async () => {
    const mockAirtable = createMockAirtableClient({
      id: "recPost123",
      fields: {
        status: "Approved",
        is_valid_for_approval: 1,
        master_copy: "Valid content",
        approved_at: "2026-05-27T08:00:00.000Z",
        target_channels: ["Facebook"],
        connected_channel_accounts: ["recAcc123"]
      }
    });

    const mockDb: Database = {
      async transaction(wsId, fn) {
        const client = {
          query: async (text: string, values?: any[]) => {
            if (text.includes("FROM webhook_events WHERE event_id =")) {
              return { rows: [{ status: "received", is_finalized: false, id: "uuid-evt-123" }] };
            }
            if (text.includes("UPDATE webhook_events")) {
              return { rows: [{ id: "uuid-evt-123" }] };
            }
            // Database query returns no rows for channel account resolution
            if (text.includes("FROM channel_accounts")) {
              return { rows: [] };
            }
            return { rows: [] };
          }
        } as any;
        return fn(client);
      },
      async query() {
        return { rows: [] } as any;
      },
      getPool() {
        return {} as any;
      }
    };

    const worker = new ApprovedPostWorker(mockDb, mockAirtable, logger, workspaceId);
    const result = await worker.process(defaultMessage, "msg-id-123");

    assert.deepEqual(result, {
      action: "nack_dlq",
      status: "channel_account_unresolved"
    });
  });

  it("TS-11 Transient Airtable Error: returns nack_requeue", async () => {
    const mockAirtable: AirtableClient = {
      async updateRecordStatus() {},
      async getPostRecord() {
        throw new AirtableRateLimitError("Rate limit");
      },
      async fetchCampaignRecord() {
        throw new Error("Not implemented in mock");
      },
      async updateVariantDraft() {
        return;
      }
    };

    const mockDb: Database = {
      async transaction(wsId, fn) {
        const client = {
          query: async (text: string, values?: any[]) => {
            if (text.includes("FROM webhook_events WHERE event_id =")) {
              return { rows: [{ status: "received", is_finalized: false, id: "uuid-evt-123" }] };
            }
            if (text.includes("UPDATE webhook_events")) {
              return { rows: [{ id: "uuid-evt-123" }] };
            }
            return { rows: [] };
          }
        } as any;
        return fn(client);
      },
      async query() {
        return { rows: [] } as any;
      },
      getPool() {
        return {} as any;
      }
    };

    const worker = new ApprovedPostWorker(mockDb, mockAirtable, logger, workspaceId);
    const result = await worker.process(defaultMessage, "msg-id-123");

    assert.deepEqual(result, {
      action: "nack_requeue",
      status: "retryable_failed"
    });
  });

  it("TS-11 Terminal Airtable RecordNotFound Error: returns nack_dlq", async () => {
    const mockAirtable: AirtableClient = {
      async updateRecordStatus() {},
      async getPostRecord() {
        throw new AirtableRecordNotFoundError("recPost123");
      },
      async fetchCampaignRecord() {
        throw new Error("Not implemented in mock");
      },
      async updateVariantDraft() {
        return;
      }
    };

    const mockDb: Database = {
      async transaction(wsId, fn) {
        const client = {
          query: async (text: string, values?: any[]) => {
            if (text.includes("FROM webhook_events WHERE event_id =")) {
              return { rows: [{ status: "received", is_finalized: false, id: "uuid-evt-123" }] };
            }
            if (text.includes("UPDATE webhook_events")) {
              return { rows: [{ id: "uuid-evt-123" }] };
            }
            return { rows: [] };
          }
        } as any;
        return fn(client);
      },
      async query() {
        return { rows: [] } as any;
      },
      getPool() {
        return {} as any;
      }
    };

    const worker = new ApprovedPostWorker(mockDb, mockAirtable, logger, workspaceId);
    const result = await worker.process(defaultMessage, "msg-id-123");

    assert.deepEqual(result, {
      action: "nack_dlq",
      status: "failed"
    });
  });

  it("TS-14 Race Condition: detects duplicate allocation and ignores successfully", async () => {
    const mockAirtable = createMockAirtableClient({
      id: "recPost123",
      fields: {
        status: "Approved",
        is_valid_for_approval: 1,
        scheduled_at: "2026-06-01T12:00:00.000Z",
        master_copy: "Valid content copy",
        approved_at: "2026-05-27T08:00:00.000Z",
        target_channels: ["Facebook"],
        connected_channel_accounts: ["recAcc123"]
      }
    });

    const mockDb: Database = {
      async transaction(wsId, fn) {
        const client = {
          query: async (text: string, values?: any[]) => {
            if (text.includes("FROM webhook_events WHERE event_id =")) {
              return { rows: [{ status: "received", is_finalized: false, id: "uuid-evt-123" }] };
            }
            if (text.includes("UPDATE webhook_events")) {
              return { rows: [{ id: "uuid-evt-123" }] };
            }
            if (text.includes("FROM channel_accounts")) {
              return {
                rows: [
                  {
                    id: "uuid-chan-123",
                    platform: "Facebook",
                    airtable_channel_account_record_id: "recAcc123",
                    external_account_id: "ext-fb-456",
                    display_name: "Active FB",
                    status: "active",
                    token_status: "valid"
                  }
                ]
              };
            }
            // Version allocation: mock unique violation on workflow runs insert
            if (text.includes("INSERT INTO workflow_runs")) {
              const err = new Error("duplicate key value violates unique constraint");
              (err as any).code = "23505";
              throw err;
            }
            if (text.includes("INSERT INTO approval_versions")) {
              return { rows: [{ current_version: 1 }] };
            }
            return { rows: [] };
          }
        } as any;
        return fn(client);
      },
      async query() {
        return { rows: [] } as any;
      },
      getPool() {
        return {} as any;
      }
    };

    const worker = new ApprovedPostWorker(mockDb, mockAirtable, logger, workspaceId);
    const result = await worker.process(defaultMessage, "msg-id-123");

    assert.deepEqual(result, {
      action: "ack",
      status: "duplicate_ignored"
    });
  });
});




