import type pg from "pg";
import type { QueuePublisher } from "../queue/rabbitmqPublisher.js";
import type { CommentSyncSchedulerRepository } from "../ledger/commentSyncSchedulerRepository.js";
import type { Logger } from "../lib/logger.js";
import { randomUUID } from "node:crypto";
import type { CommentSyncRequestedEvent } from "@mediaops/shared-contracts";

const DEFAULT_POLL_INTERVAL_MINUTES = 5;
const SECONDS_PER_MINUTE = 60;
const MILLISECONDS_PER_SECOND = 1000;
const DEFAULT_POLL_INTERVAL_MS = DEFAULT_POLL_INTERVAL_MINUTES * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND;
const DEFAULT_SYNC_BATCH_SIZE = 50;
const HOURLY_IDEMPOTENCY_TIMESTAMP_LENGTH = 13;

export class CommentSyncScheduler {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly dbPool: pg.Pool,
    private readonly repo: CommentSyncSchedulerRepository,
    private readonly publisher: QueuePublisher,
    private readonly logger: Logger,
    private readonly pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS
  ) {}

  start() {
    if (this.timer) return;
    this.logger.info("Starting CommentSyncScheduler polling", { intervalMs: this.pollIntervalMs });
    
    // Initial run immediately, then recurring
    this.runCycle().catch(err => {
      this.logger.error("Error in initial CommentSyncScheduler cycle", { error: String(err) });
    });

    this.timer = setInterval(() => {
      this.runCycle().catch(err => {
        this.logger.error("Error in CommentSyncScheduler cycle", { error: String(err) });
      });
    }, this.pollIntervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger.info("Stopped CommentSyncScheduler polling");
    }
  }

  async runCycle() {
    const client = await this.dbPool.connect();

    try {
      await client.query("BEGIN");
      
      const targets = await this.repo.findJobsToSync(client, DEFAULT_SYNC_BATCH_SIZE);
      if (targets.length === 0) {
        await client.query("ROLLBACK");
        return;
      }

      const jobIds = targets.map(t => t.id);

      // Enqueue sync requests
      for (const target of targets) {
        const eventId = randomUUID();
        const correlationId = randomUUID();
        
        const event: CommentSyncRequestedEvent = {
          event_id: eventId,
          event_type: "comments.facebook.sync.requested",
          event_version: 1,
          workspace_id: target.workspace_id,
          job_id: target.id,
          channel_account_id: target.channel_account_id,
          external_post_id: target.external_post_id,
          idempotency_key: `sync:${target.id}:${new Date().toISOString().substring(0, HOURLY_IDEMPOTENCY_TIMESTAMP_LENGTH)}`,
          correlation_id: correlationId,
          created_at: new Date().toISOString()
        };

        await this.publisher.publishCommentSyncRequest(event, eventId);
      }

      // Mark jobs as enqueued to prevent duplicate scheduling
      await this.repo.markSyncEnqueued(client, jobIds);

      await client.query("COMMIT");
      
      this.logger.info("Enqueued comment sync requests", { count: targets.length, jobIds });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}
