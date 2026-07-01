import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FacebookCommentSyncWorker } from "../workers/facebookCommentSyncWorker.js";
import { CommentSyncWorkerRepository } from "../ledger/commentSyncWorkerRepository.js";
import type { QueuePublisher } from "../queue/rabbitmqPublisher.js";
import type pg from "pg";
import type { CommentIngestEvent } from "@mediaops/shared-contracts";

describe("FacebookCommentSyncWorker", () => {
  function createEvent(overrides: Partial<CommentIngestEvent> = {}): CommentIngestEvent {
    return {
      event_id: "123e4567-e89b-12d3-a456-426614174000",
      event_type: "comments.facebook.ingest",
      event_version: 1,
      workspace_id: "ws-1",
      job_id: "123e4567-e89b-12d3-a456-426614174001",
      external_post_id: "post-1",
      external_comment_id: "comment-1",
      author_ref: { name: "Test" },
      comment_preview: "Good job",
      risk_code: "NORMAL",
      permalink: "https://facebook.com/1",
      created_at_platform: new Date().toISOString(),
      correlation_id: "123e4567-e89b-12d3-a456-426614174002",
      causation_id: "123e4567-e89b-12d3-a456-426614174003",
      created_at: new Date().toISOString(),
      ...overrides
    };
  }

  it("commits Ledger before publishing Slack alert and marks alert sent", async () => {
    const calls: string[] = [];
    
    const mockClient = {
      query: async (text: string, _params?: unknown[]) => {
        if (text === "COMMIT") calls.push("commit");
        if (text.startsWith("SET LOCAL")) calls.push("set-local");
      },
      release: () => {}
    } as unknown as pg.PoolClient;

    const mockPool = {
      connect: async () => mockClient
    } as unknown as pg.Pool;

    const mockRepo = new CommentSyncWorkerRepository();
    mockRepo.checkIngestIdempotency = async () => false;
    mockRepo.upsertInteraction = async () => ({ id: "int-1", status: "new" });
    mockRepo.upsertComment = async () => {};
    mockRepo.recordSlackAlert = async () => true; // newly inserted
    mockRepo.recordIngestIdempotency = async () => {};
    mockRepo.updateSlackAlertStatus = async (_client, _interactionId, _workspaceId, status) => {
      calls.push(`alert-${status}`);
    };

    const mockPublisher = {
      publishSlackAlert: async (message: Record<string, unknown>) => {
        calls.push("publish");
        assert.equal(message.channel_id, "C-INBOX");
      }
    } as unknown as QueuePublisher;

    const worker = new FacebookCommentSyncWorker(mockPool, mockRepo, mockPublisher, {
      inboxChannelId: "C-INBOX",
      crisisChannelId: "C-CRISIS"
    });

    await worker.processIngestEvent(createEvent());

    assert.equal(calls.includes("set-local"), true);
    assert.deepEqual(calls, ["set-local", "commit", "publish", "set-local", "alert-sent", "commit"]);
  });

  it("should skip processing if already ingested", async () => {
    let transactionRolledBack = false;

    const mockClient = {
      query: async (text: string) => {
        if (text === "ROLLBACK") transactionRolledBack = true;
      },
      release: () => {}
    } as unknown as pg.PoolClient;

    const mockPool = {
      connect: async () => mockClient
    } as unknown as pg.Pool;

    const mockRepo = new CommentSyncWorkerRepository();
    mockRepo.checkIngestIdempotency = async () => true;

    const worker = new FacebookCommentSyncWorker(mockPool, mockRepo, {} as QueuePublisher);

    await worker.processIngestEvent(createEvent());

    assert.equal(transactionRolledBack, true);
  });

  it("records pending_config and does not publish when target Slack channel is missing", async () => {
    let alertStatus: string | null = null;
    let publishedAlert = false;

    const mockClient = {
      query: async () => {},
      release: () => {}
    } as unknown as pg.PoolClient;
    const mockPool = { connect: async () => mockClient } as unknown as pg.Pool;
    const mockRepo = new CommentSyncWorkerRepository();
    mockRepo.checkIngestIdempotency = async () => false;
    mockRepo.upsertInteraction = async () => ({ id: "int-1", status: "new" });
    mockRepo.upsertComment = async () => {};
    mockRepo.recordSlackAlert = async (_client, _interactionId, _workspaceId, channelId, channelType, alertType, status) => {
      assert.equal(channelId, null);
      assert.equal(channelType, "crisis");
      assert.equal(alertType, "comment_risk");
      alertStatus = status ?? null;
      return true;
    };
    mockRepo.recordIngestIdempotency = async () => {};

    const worker = new FacebookCommentSyncWorker(
      mockPool,
      mockRepo,
      { publishSlackAlert: async () => { publishedAlert = true; } } as unknown as QueuePublisher,
      { inboxChannelId: "C-INBOX" }
    );

    await worker.processIngestEvent(createEvent({ risk_code: "CRISIS" }));

    assert.equal(alertStatus, "pending_config");
    assert.equal(publishedAlert, false);
  });

  it("marks alert failed without throwing when Slack publish fails after commit", async () => {
    const statuses: string[] = [];
    const mockClient = {
      query: async () => {},
      release: () => {}
    } as unknown as pg.PoolClient;
    const mockPool = { connect: async () => mockClient } as unknown as pg.Pool;
    const mockRepo = new CommentSyncWorkerRepository();
    mockRepo.checkIngestIdempotency = async () => false;
    mockRepo.upsertInteraction = async () => ({ id: "int-1", status: "new" });
    mockRepo.upsertComment = async () => {};
    mockRepo.recordSlackAlert = async () => true;
    mockRepo.recordIngestIdempotency = async () => {};
    mockRepo.updateSlackAlertStatus = async (_client, _interactionId, _workspaceId, status) => {
      statuses.push(status);
    };

    const worker = new FacebookCommentSyncWorker(
      mockPool,
      mockRepo,
      { publishSlackAlert: async () => { throw new Error("rabbit down"); } } as unknown as QueuePublisher,
      { inboxChannelId: "C-INBOX" }
    );

    await worker.processIngestEvent(createEvent());

    assert.deepEqual(statuses, ["failed"]);
  });
});
