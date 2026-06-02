import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { SlackCommentActionWorker } from "../slackCommentActionWorker.js";

describe("SlackCommentActionWorker", () => {
  let database: any;
  let repository: any;
  let facebookMcpClient: any;
  let queuePublisher: any;
  let logger: any;
  let worker: SlackCommentActionWorker;

  beforeEach(() => {
    database = {
      transaction: mock.fn(async (ws: string, cb: any) => cb({}))
    };
    repository = {
      getEventById: mock.fn(),
      getInteractionById: mock.fn(),
      updateInteractionStatus: mock.fn(),
      updateEventStatus: mock.fn(),
      insertAuditLog: mock.fn()
    };
    facebookMcpClient = {
      replyComment: mock.fn()
    };
    queuePublisher = {
      publishSlackAlert: mock.fn()
    };
    logger = { info: mock.fn(), warn: mock.fn(), error: mock.fn() };
    
    worker = new SlackCommentActionWorker(
      database,
      repository,
      facebookMcpClient,
      queuePublisher,
      logger,
      "ws-1"
    );
  });

  it("should process reply comment successfully", async () => {
    const message = {
      event_id: "evt-1",
      event_type: "slack.comment_action.requested" as const,
      event_version: 1,
      workspace_id: "ws-1",
      action_event_id: "cmd-evt-1",
      action: "reply" as const,
      idempotency_key: "idemp-1",
      correlation_id: "corr-1",
      created_at: new Date().toISOString()
    };

    (repository.getEventById as any).mock.mockImplementation(async () => ({
      id: "cmd-evt-1",
      status: "queued",
      action: "reply",
      interaction_id: "int-1",
      message: "Here is a reply",
      slack_user_id: "U123"
    }));

    (repository.getInteractionById as any).mock.mockImplementation(async () => ({
      id: "int-1",
      status: "new",
      external_id: "ext-123"
    }));

    // Mock channel_accounts query
    database.transaction = mock.fn(async (ws: string, cb: any) => {
      const client = {
        query: mock.fn(async () => ({ rows: [{ id: "chan-1" }] }))
      };
      return cb(client);
    });

    (facebookMcpClient.replyComment as any).mock.mockImplementation(async () => ({
      success: true,
      external_reply_id: "reply-123"
    }));

    const result = await worker.processQueueMessage(message, "msg-1");

    assert.strictEqual(result.action, "ack");
    assert.strictEqual(result.status, "succeeded");
    assert.strictEqual((facebookMcpClient.replyComment as any).mock.calls.length, 1);
    
    const mcpArgs = (facebookMcpClient.replyComment as any).mock.calls[0].arguments[0];
    assert.strictEqual(mcpArgs.external_comment_id, "ext-123");
    assert.strictEqual(mcpArgs.message, "Here is a reply");
    assert.strictEqual(mcpArgs.channelAccountId, "chan-1");
    // Ensure secretRef is not passed
    assert.strictEqual(mcpArgs.secretRef, undefined);
  });

  it("should process escalate successfully", async () => {
    const message = {
      event_id: "evt-1",
      event_type: "slack.comment_action.requested" as const,
      event_version: 1,
      workspace_id: "ws-1",
      action_event_id: "cmd-evt-1",
      action: "escalate" as const,
      idempotency_key: "idemp-1",
      correlation_id: "corr-1",
      created_at: new Date().toISOString()
    };

    (repository.getEventById as any).mock.mockImplementation(async () => ({
      id: "cmd-evt-1",
      status: "queued",
      action: "escalate",
      interaction_id: "int-1",
      reason: "Needs help",
      slack_user_id: "U123"
    }));

    (repository.getInteractionById as any).mock.mockImplementation(async () => ({
      id: "int-1",
      status: "new",
      external_id: "ext-123"
    }));

    database.transaction = mock.fn(async (ws: string, cb: any) => {
      const client = {
        query: mock.fn(async () => ({ rows: [{ id: "chan-1" }] }))
      };
      return cb(client);
    });

    const result = await worker.processQueueMessage(message, "msg-1");

    assert.strictEqual(result.action, "ack");
    assert.strictEqual(result.status, "succeeded");
    assert.strictEqual((queuePublisher.publishSlackAlert as any).mock.calls.length, 1);
  });
});
