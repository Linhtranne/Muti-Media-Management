import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FacebookCommentSyncWorker } from "../workers/facebookCommentSyncWorker.js";
import { CommentSyncWorkerRepository } from "../ledger/commentSyncWorkerRepository.js";
import { CommentRiskClassifier } from "../services/commentRiskClassifier.js";
import type { QueuePublisher } from "../queue/rabbitmqPublisher.js";
import type pg from "pg";

describe("FacebookCommentSyncWorker", () => {
  it("should process ingest event successfully and publish alert if new", async () => {
    let transactionCommitted = false;
    let publishedAlert = false;
    
    const mockClient = {
      query: async (text: string) => {
        if (text === "COMMIT") transactionCommitted = true;
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

    const mockRiskClassifier = new CommentRiskClassifier();

    const mockPublisher = {
      publishSlackAlert: async () => { publishedAlert = true; }
    } as unknown as QueuePublisher;

    const worker = new FacebookCommentSyncWorker(mockPool, mockRepo, mockRiskClassifier, mockPublisher);

    await worker.processIngestEvent({
      event_id: "evt-123",
      event_type: "comments.facebook.ingest",
      event_version: 1,
      workspace_id: "ws-1",
      job_id: "job-1",
      external_post_id: "post-1",
      external_comment_id: "comment-1",
      author_ref: { name: "Test" },
      comment_preview: "Good job",
      permalink: "https://facebook.com/1",
      created_at_platform: new Date().toISOString(),
      correlation_id: "corr-1",
      causation_id: "cause-1",
      created_at: new Date().toISOString()
    });

    assert.equal(transactionCommitted, true);
    assert.equal(publishedAlert, true);
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

    const worker = new FacebookCommentSyncWorker(mockPool, mockRepo, new CommentRiskClassifier(), {} as QueuePublisher);

    await worker.processIngestEvent({
      event_id: "evt-123",
      event_type: "comments.facebook.ingest",
      event_version: 1,
      workspace_id: "ws-1",
      job_id: "job-1",
      external_post_id: "post-1",
      external_comment_id: "comment-1",
      author_ref: { name: "Test" },
      comment_preview: "Good job",
      permalink: "https://facebook.com/1",
      created_at_platform: new Date().toISOString(),
      correlation_id: "corr-1",
      causation_id: "cause-1",
      created_at: new Date().toISOString()
    });

    assert.equal(transactionRolledBack, true);
  });
});
