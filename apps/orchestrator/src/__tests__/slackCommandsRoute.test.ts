import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import express from "express";
import { createSlackCommandsRouter } from "../routes/slackCommands.js";

describe("SlackCommandsRoute", () => {
  let verifier: any;
  let parser: any;
  let repository: any;
  let publisher: any;
  let database: any;
  let logger: any;
  let app: express.Application;

  beforeEach(() => {
    verifier = { verify: mock.fn() };
    parser = { parse: mock.fn() };
    repository = {
      getEventByIdempotencyKey: mock.fn(),
      insertReceivedEvent: mock.fn(),
      getWorkspaceRole: mock.fn(),
      updateEventStatus: mock.fn(),
      insertAuditLog: mock.fn(),
    };
    const commentActionRepository = {
      getEventByIdempotencyKey: mock.fn(),
      insertReceivedEvent: mock.fn(),
      getWorkspaceRole: mock.fn(),
      updateEventStatus: mock.fn(),
      insertAuditLog: mock.fn(),
    };
    publisher = { publishSlackCommandAction: mock.fn(), publishSlackCommentAction: mock.fn() };
    logger = { info: mock.fn(), warn: mock.fn(), error: mock.fn() };
    
    database = {
      transaction: mock.fn(async (wsId: any, callback: any) => {
        const client = {};
        return await callback(client);
      })
    };

    const router = createSlackCommandsRouter({
      verifier,
      parser,
      repository,
      commentActionRepository: commentActionRepository as any,
      publisher,
      database,
      logger,
      workspaceId: "ws-1",
      slackCommandsEnabled: true
    });

    app = express();
    app.use("/api/v1", router);
  });

  it("CMD-001: should return ephemeral error on invalid signature", async () => {
    (verifier.verify as any).mock.mockImplementation(() => ({ valid: false, errorCode: "SIGNATURE_MISMATCH", message: "Mismatch" }));

    const response = await request(app)
      .post("/api/v1/slack/commands")
      .set("x-slack-signature", "bad")
      .set("x-slack-request-timestamp", "123")
      .send("command=/approve_post&text=POST-123");

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.text, "Command verification failed. Please try again.");
    assert.strictEqual((database.transaction as any).mock.calls.length, 1);
  });

  it("CMD-005: should return ephemeral error on malformed command", async () => {
    (verifier.verify as any).mock.mockImplementation(() => ({ valid: true }));
    (parser.parse as any).mock.mockImplementation(() => ({ error: true, errorCode: "MISSING_POST_ID", message: "Post ID missing" }));
    (repository.insertReceivedEvent as any).mock.mockImplementation(async () => ({ id: "event-1" }));

    const response = await request(app)
      .post("/api/v1/slack/commands")
      .send("command=/approve_post&text=");

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.text, "Post ID missing");
  });

  it("CMD-009: should return ephemeral error on unauthorized role", async () => {
    (verifier.verify as any).mock.mockImplementation(() => ({ valid: true }));
    (parser.parse as any).mock.mockImplementation(() => ({ action: "approve", postId: "POST-123", reason: null }));
    (repository.insertReceivedEvent as any).mock.mockImplementation(async () => ({ id: "event-1" }));
    (repository.getWorkspaceRole as any).mock.mockImplementation(async () => "viewer");

    const response = await request(app)
      .post("/api/v1/slack/commands")
      .send("command=/approve_post&text=POST-123");

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.text, "You are not authorized to approve or reject posts.");
  });

  it("CMD-011: should enqueue valid command and return processing", async () => {
    (verifier.verify as any).mock.mockImplementation(() => ({ valid: true }));
    (parser.parse as any).mock.mockImplementation(() => ({ action: "approve", postId: "POST-123", reason: null }));
    (repository.insertReceivedEvent as any).mock.mockImplementation(async () => ({ id: "event-1" }));
    (repository.getWorkspaceRole as any).mock.mockImplementation(async () => "manager");
    (publisher.publishSlackCommandAction as any).mock.mockImplementation(async () => undefined);

    const response = await request(app)
      .post("/api/v1/slack/commands")
      .send("command=/approve_post&text=POST-123");

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.text, "Processing your request...");
    assert.strictEqual((publisher.publishSlackCommandAction as any).mock.calls.length, 1);
  });
});
