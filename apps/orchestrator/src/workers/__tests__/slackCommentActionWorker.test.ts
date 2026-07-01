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
      insertAuditLog: mock.fn(),
      resolveFacebookChannelAccountForInteraction: mock.fn()
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

    repository.getEventById.mock.mockImplementation(async () => ({
      id: "cmd-evt-1",
      status: "queued",
      action: "reply",
      interaction_id: "int-1",
      message: "Here is a reply",
      slack_user_id: "U123"
    }));

    repository.getInteractionById.mock.mockImplementation(async () => ({
      id: "int-1",
      status: "new",
      external_id: "ext-123"
    }));

    repository.resolveFacebookChannelAccountForInteraction.mock.mockImplementation(async () => "chan-1");

    facebookMcpClient.replyComment.mock.mockImplementation(async () => ({
      success: true,
      external_reply_id: "reply-123"
    }));

    const result = await worker.processQueueMessage(message, "msg-1");

    assert.strictEqual(result.action, "ack");
    assert.strictEqual(result.status, "succeeded");
    assert.strictEqual(facebookMcpClient.replyComment.mock.calls.length, 1);
    
    const mcpArgs = facebookMcpClient.replyComment.mock.calls[0].arguments[0];
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

    repository.getEventById.mock.mockImplementation(async () => ({
      id: "cmd-evt-1",
      status: "queued",
      action: "escalate",
      interaction_id: "int-1",
      reason: "Needs help",
      slack_user_id: "U123"
    }));

    repository.getInteractionById.mock.mockImplementation(async () => ({
      id: "int-1",
      status: "new",
      external_id: "ext-123"
    }));

    repository.resolveFacebookChannelAccountForInteraction.mock.mockImplementation(async () => "chan-1");

    const result = await worker.processQueueMessage(message, "msg-1");

    assert.strictEqual(result.action, "ack");
    assert.strictEqual(result.status, "succeeded");
    assert.strictEqual(queuePublisher.publishSlackAlert.mock.calls.length, 1);
  });

  it("should return channel_account_unresolved when channel account cannot be resolved", async () => {
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

    repository.getEventById.mock.mockImplementation(async () => ({
      id: "cmd-evt-1",
      status: "queued",
      action: "reply",
      interaction_id: "int-1",
      message: "Here is a reply",
      slack_user_id: "U123"
    }));

    repository.getInteractionById.mock.mockImplementation(async () => ({
      id: "int-1",
      status: "new",
      external_id: "ext-123"
    }));

    repository.resolveFacebookChannelAccountForInteraction.mock.mockImplementation(async () => null);

    const result = await worker.processQueueMessage(message, "msg-1");

    assert.strictEqual(result.action, "ack");
    assert.strictEqual(result.status, "channel_account_unresolved");
  });

  it("should return mcp_error when MCP call fails and not mark resolved", async () => {
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

    repository.getEventById.mock.mockImplementation(async () => ({
      id: "cmd-evt-1",
      status: "queued",
      action: "reply",
      interaction_id: "int-1",
      message: "Here is a reply",
      slack_user_id: "U123"
    }));

    repository.getInteractionById.mock.mockImplementation(async () => ({
      id: "int-1",
      status: "new",
      external_id: "ext-123"
    }));

    repository.resolveFacebookChannelAccountForInteraction.mock.mockImplementation(async () => "chan-1");

    facebookMcpClient.replyComment.mock.mockImplementation(async () => ({
      success: false,
      error: "Some MCP Error"
    }));

    const result = await worker.processQueueMessage(message, "msg-1");

    assert.strictEqual(result.action, "ack");
    assert.strictEqual(result.status, "mcp_error");
    assert.strictEqual(repository.updateInteractionStatus.mock.calls.length, 0);
  });

  it("should commit Ledger before publishing alert, and still ACK if alert fails", async () => {
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

    repository.getEventById.mock.mockImplementation(async () => ({
      id: "cmd-evt-1",
      status: "queued",
      action: "escalate",
      interaction_id: "int-1",
      reason: "Needs help",
      slack_user_id: "U123"
    }));

    repository.getInteractionById.mock.mockImplementation(async () => ({
      id: "int-1",
      status: "new",
      external_id: "ext-123"
    }));

    repository.resolveFacebookChannelAccountForInteraction.mock.mockImplementation(async () => "chan-1");

    let ledgerCommitted = false;
    
    database.transaction = mock.fn(async (ws: string, cb: any) => {
      const result = await cb({});
      ledgerCommitted = true;
      return result;
    });

    queuePublisher.publishSlackAlert.mock.mockImplementation(async () => {
      assert.strictEqual(ledgerCommitted, true, "Ledger must be committed before Slack alert is published");
      throw new Error("Slack Alert Failed");
    });

    const result = await worker.processQueueMessage(message, "msg-1");

    assert.strictEqual(result.action, "ack");
    assert.strictEqual(result.status, "succeeded");
    
    // 1 for success audit log, 1 for failure fallback audit log
    assert.strictEqual(repository.insertAuditLog.mock.calls.length, 2); 
    
    const lastAuditCall = repository.insertAuditLog.mock.calls[1].arguments[1];
    assert.strictEqual(lastAuditCall.eventType, "SLACK_COMMENT_ESCALATION_ALERT_FAILED");
  });
});
