import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DirectMessageRepository } from "../ledger/directMessageRepository.js";
import type pg from "pg";

describe("DirectMessageRepository", () => {
  const repo = new DirectMessageRepository();

  it("should construct correct SQL and parameters for upsertConversation", async () => {
    let capturedSql = "";
    let capturedParams: any[] = [];
    const mockClient = {
      query: async (sql: string, params: any[]) => {
        capturedSql = sql;
        capturedParams = params;
        return { rows: [{ id: "conv-1" }] };
      }
    } as unknown as pg.PoolClient;

    const data = {
      platform: "facebook" as const,
      channelAccountId: "550e8400-e29b-41d4-a716-446655440001",
      externalThreadId: "thread-123",
      customerRef: { name: "John Doe" },
      customerDisplayName: "John Doe",
      status: "new" as const,
      assignedToMemberId: "550e8400-e29b-41d4-a716-446655440002",
      assignedSlackUserId: "U12345",
      lastMessageAt: new Date("2026-06-03T10:00:00.000Z"),
      slaDueAt: new Date("2026-06-03T12:00:00.000Z")
    };

    const result = await repo.upsertConversation(mockClient, "ws-1", data);

    assert.strictEqual(result.id, "conv-1");
    assert.ok(capturedSql.includes("INSERT INTO conversations"));
    assert.ok(capturedSql.includes("ON CONFLICT (workspace_id, platform, external_thread_id) DO UPDATE SET"));
    assert.strictEqual(capturedParams[0], "ws-1");
    assert.strictEqual(capturedParams[1], "facebook");
    assert.strictEqual(capturedParams[2], "550e8400-e29b-41d4-a716-446655440001");
    assert.strictEqual(capturedParams[3], "thread-123");
    assert.deepEqual(capturedParams[4], { name: "John Doe" });
  });

  it("should construct correct SQL and parameters for insertMessageIdempotently", async () => {
    let capturedSql = "";
    let capturedParams: any[] = [];
    const mockClient = {
      query: async (sql: string, params: any[]) => {
        capturedSql = sql;
        capturedParams = params;
        return { rows: [{ id: "msg-1" }] };
      }
    } as unknown as pg.PoolClient;

    const data = {
      conversationId: "550e8400-e29b-41d4-a716-446655440003",
      externalMessageId: "ext-msg-123",
      direction: "inbound" as const,
      senderType: "customer" as const,
      body: "Hello!",
      bodyRedacted: "Hello!",
      attachmentsRef: [],
      createdAtPlatform: new Date("2026-06-03T10:00:00.000Z")
    };

    const result = await repo.insertMessageIdempotently(mockClient, "ws-1", data);

    assert.strictEqual(result?.id, "msg-1");
    assert.ok(capturedSql.includes("INSERT INTO conversation_messages"));
    assert.ok(capturedSql.includes("ON CONFLICT (workspace_id, conversation_id, external_message_id) DO NOTHING"));
    assert.strictEqual(capturedParams[0], "ws-1");
    assert.strictEqual(capturedParams[1], "550e8400-e29b-41d4-a716-446655440003");
    assert.strictEqual(capturedParams[2], "ext-msg-123");
    assert.strictEqual(capturedParams[3], "inbound");
    assert.strictEqual(capturedParams[5], "Hello!");
  });

  it("should construct correct SQL and parameters for createReplyJobIdempotently", async () => {
    let capturedSql = "";
    let capturedParams: any[] = [];
    const mockClient = {
      query: async (sql: string, params: any[]) => {
        capturedSql = sql;
        capturedParams = params;
        return { rows: [{ id: "job-1" }] };
      }
    } as unknown as pg.PoolClient;

    const result = await repo.createReplyJobIdempotently(mockClient, "ws-1", {
      conversationId: "550e8400-e29b-41d4-a716-446655440003",
      actorId: "550e8400-e29b-41d4-a716-446655440004",
      replyBody: "Hello",
      idempotencyKey: "ik-1"
    });

    assert.strictEqual(result?.id, "job-1");
    assert.ok(capturedSql.includes("INSERT INTO direct_message_reply_jobs"));
    assert.ok(capturedSql.includes("ON CONFLICT (workspace_id, idempotency_key) DO NOTHING"));
    assert.strictEqual(capturedParams[0], "ws-1");
    assert.strictEqual(capturedParams[1], "550e8400-e29b-41d4-a716-446655440003");
    assert.strictEqual(capturedParams[2], "550e8400-e29b-41d4-a716-446655440004");
    assert.strictEqual(capturedParams[3], "Hello");
    assert.strictEqual(capturedParams[4], "ik-1");
  });

  it("should construct correct SQL and parameters for claimReplyJob", async () => {
    let capturedSql = "";
    let capturedParams: any[] = [];
    const mockClient = {
      query: async (sql: string, params: any[]) => {
        capturedSql = sql;
        capturedParams = params;
        return { rows: [{ id: "job-1", status: "processing" }] };
      }
    } as unknown as pg.PoolClient;

    const result = await repo.claimReplyJob(mockClient, "ws-1", "job-1");

    assert.strictEqual(result?.status, "processing");
    assert.ok(capturedSql.includes("UPDATE direct_message_reply_jobs"));
    assert.ok(capturedSql.includes("status = 'processing'"));
    // Bug #3 fix: claim accepts both 'received' and 'queued' status
    assert.ok(capturedSql.includes("IN ('received', 'queued')"));
    assert.strictEqual(capturedParams[0], "ws-1");
    assert.strictEqual(capturedParams[1], "job-1");
  });

  it("should validate workspace member", async () => {
    let capturedSql = "";
    let capturedParams: any[] = [];
    const mockClient = {
      query: async (sql: string, params: any[]) => {
        capturedSql = sql;
        capturedParams = params;
        return { rows: [{ id: "member-1" }] };
      }
    } as unknown as pg.PoolClient;

    const isValid = await repo.validateWorkspaceMember(mockClient, "member-1", "ws-1");

    assert.strictEqual(isValid, true);
    assert.ok(capturedSql.includes("SELECT id FROM workspace_members"));
    assert.ok(capturedSql.includes("id = $1 AND workspace_id = $2"));
    assert.strictEqual(capturedParams[0], "member-1");
    assert.strictEqual(capturedParams[1], "ws-1");
  });

  it("should lookup role and id by slack user ID", async () => {
    let capturedSql = "";
    let capturedParams: any[] = [];
    const mockClient = {
      query: async (sql: string, params: any[]) => {
        capturedSql = sql;
        capturedParams = params;
        return { rows: [{ id: "member-1", role: "support" }] };
      }
    } as unknown as pg.PoolClient;

    const member = await repo.getWorkspaceMemberBySlackUser(mockClient, "ws-1", "U123");

    assert.strictEqual(member?.id, "member-1");
    assert.strictEqual(member?.role, "support");
    assert.ok(capturedSql.includes("SELECT id, role FROM workspace_members"));
    assert.ok(capturedSql.includes("workspace_id = $1 AND slack_user_id = $2"));
    assert.strictEqual(capturedParams[0], "ws-1");
    assert.strictEqual(capturedParams[1], "U123");
  });
});
