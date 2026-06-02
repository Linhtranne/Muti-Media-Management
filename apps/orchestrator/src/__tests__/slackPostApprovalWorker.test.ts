import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { SlackPostApprovalWorker } from "../workers/slackPostApprovalWorker.js";

describe("SlackPostApprovalWorker", () => {
  let database: any;
  let repository: any;
  let airtableClient: any;
  let logger: any;
  let worker: SlackPostApprovalWorker;

  beforeEach(() => {
    database = {
      transaction: mock.fn(async (wsId: any, callback: any) => {
        const client = { query: mock.fn() };
        return await callback(client);
      })
    };
    repository = {
      getEventById: mock.fn(),
      updateEventStatus: mock.fn(),
      insertAuditLog: mock.fn(),
    };
    airtableClient = {
      getPostRecord: mock.fn(),
      updateRecordStatus: mock.fn(),
      updatePostApprovalStatus: mock.fn(),
    };
    logger = { info: mock.fn(), error: mock.fn(), warn: mock.fn() };

    worker = new SlackPostApprovalWorker(
      database,
      repository,
      airtableClient,
      logger,
      "ws-1"
    );
  });

  it("WKR-001: should process approve command and update Airtable", async () => {
    const message = {
      event_id: "evt-1",
      event_type: "slack.post_approval.requested" as const,
      event_version: 1,
      workspace_id: "ws-1",
      command_event_id: "cmd-1",
      action: "approve" as const,
      target_post_id: "POST-123",
      idempotency_key: "idemp",
      correlation_id: "corr",
      created_at: new Date().toISOString()
    };

    (repository.getEventById as any).mock.mockImplementation(async () => ({
      id: "cmd-1",
      action: "approve",
      target_post_id: "POST-123",
      status: "queued",
      slack_user_id: "U1"
    }));

    (airtableClient.getPostRecord as any).mock.mockImplementation(async () => ({ fields: { status: "Review" } }));

    const result = await worker.processQueueMessage(message, "msg-1");

    assert.deepEqual(result, { action: "ack", status: "succeeded" });
    assert.strictEqual((airtableClient.updateRecordStatus as any).mock.calls.length, 1);
  });

  it("WKR-002: should process reject command and update Airtable with reason", async () => {
    const message = {
      event_id: "evt-1",
      event_type: "slack.post_approval.requested" as const,
      event_version: 1,
      workspace_id: "ws-1",
      command_event_id: "cmd-1",
      action: "reject" as const,
      target_post_id: "POST-123",
      idempotency_key: "idemp",
      correlation_id: "corr",
      created_at: new Date().toISOString()
    };

    (repository.getEventById as any).mock.mockImplementation(async () => ({
      id: "cmd-1",
      action: "reject",
      target_post_id: "POST-123",
      reason: "Bad post",
      status: "queued",
      slack_user_id: "U1"
    }));

    (airtableClient.getPostRecord as any).mock.mockImplementation(async () => ({ fields: { status: "Review" } }));

    const result = await worker.processQueueMessage(message, "msg-1");

    assert.deepEqual(result, { action: "ack", status: "succeeded" });
  });

  it("WKR-005: should ACK immediately if already processed", async () => {
    const message = {
      event_id: "evt-1",
      event_type: "slack.post_approval.requested" as const,
      event_version: 1,
      workspace_id: "ws-1",
      command_event_id: "cmd-1",
      action: "approve" as const,
      target_post_id: "POST-123",
      idempotency_key: "idemp",
      correlation_id: "corr",
      created_at: new Date().toISOString()
    };

    (repository.getEventById as any).mock.mockImplementation(async () => ({
      id: "cmd-1",
      status: "succeeded" // Already processed
    }));

    const result = await worker.processQueueMessage(message, "msg-1");

    assert.deepEqual(result, { action: "ack", status: "already_processed" });
  });

  it("WKR-008: should mark failed and ACK if unknown post", async () => {
    const message = {
      event_id: "evt-1",
      event_type: "slack.post_approval.requested" as const,
      event_version: 1,
      workspace_id: "ws-1",
      command_event_id: "cmd-1",
      action: "approve" as const,
      target_post_id: "POST-123",
      idempotency_key: "idemp",
      correlation_id: "corr",
      created_at: new Date().toISOString()
    };

    (repository.getEventById as any).mock.mockImplementation(async () => ({
      id: "cmd-1",
      action: "approve",
      target_post_id: "POST-123",
      status: "queued",
      slack_user_id: "U1"
    }));

    const err = new Error("Not found");
    err.name = "AirtableRecordNotFoundError";
    (airtableClient.getPostRecord as any).mock.mockImplementation(async () => Promise.reject(err));

    const result = await worker.processQueueMessage(message, "msg-1");

    assert.deepEqual(result, { action: "ack", status: "unknown_post" });
  });
});
