import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { PublishFacebookExecuteEvent } from "@mediaops/shared-contracts";

export interface ScheduledJob {
  id: string;
  workspace_id: string;
  variant_id: string;
  channel_account_id: string;
  scheduled_at: string;
  workflow_run_id: string;
}

export class McpPublishSchedulerRepository {
  async findDueJobs(client: pg.PoolClient, limit = 100): Promise<ScheduledJob[]> {
    // This query executes within a workspace-specific transaction context.
    // The transaction wrapper ensures RLS policies apply appropriately using the provided workspaceId.
    const result = await client.query<ScheduledJob>(
      `SELECT id, workspace_id, variant_id, channel_account_id, scheduled_at, workflow_run_id 
       FROM publish_jobs
       WHERE status = 'validated' 
         AND scheduled_at <= NOW()
       LIMIT $1`,
      [limit]
    );
    return result.rows;
  }

  async enqueueExecuteEvent(
    client: pg.PoolClient,
    job: ScheduledJob
  ): Promise<PublishFacebookExecuteEvent | null> {
    const idempotencyKey = `publish.facebook.execute:${job.workspace_id}:${job.id}`;
    const eventId = randomUUID();
    const correlationId = randomUUID(); // New correlation for the execution phase

    // We use an outbox pattern table to ensure we only emit this once per job
    const insertResult = await client.query(
      `INSERT INTO publish_execution_events (
        id, event_id, event_type, workspace_id, job_id, idempotency_key, created_at
       ) VALUES ($1, $2, 'publish.facebook.execute', $3, $4, $5, NOW())
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [randomUUID(), eventId, job.workspace_id, job.id, idempotencyKey]
    );

    if ((insertResult.rowCount ?? 0) === 0) {
      return null; // Already enqueued
    }

    return {
      eventId,
      eventType: "publish.facebook.execute",
      eventVersion: "1",
      workspaceId: job.workspace_id,
      jobId: job.id,
      variantId: job.variant_id,
      channelAccountId: job.channel_account_id,
      scheduledAt: job.scheduled_at,
      idempotencyKey,
      correlationId,
      createdAt: new Date().toISOString()
    };
  }
}
