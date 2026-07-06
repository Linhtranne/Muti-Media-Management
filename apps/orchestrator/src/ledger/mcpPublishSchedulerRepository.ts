import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { PublishFacebookExecuteEvent, PublishTiktokExecuteEvent } from "@mediaops/shared-contracts";

export interface ScheduledJob {
  id: string;
  workspace_id: string;
  variant_id: string;
  channel_account_id: string;
  scheduled_at: string;
  workflow_run_id: string;
  platform: "facebook" | "tiktok";
}

export class McpPublishSchedulerRepository {
  async findDueJobs(client: pg.PoolClient, limit = 100): Promise<ScheduledJob[]> {
    // This query executes within a workspace-specific transaction context.
    // The transaction wrapper ensures RLS policies apply appropriately using the provided workspaceId.
    const result = await client.query<ScheduledJob>(
      `SELECT
         pj.id,
         pj.workspace_id,
         pj.variant_id,
         pj.channel_account_id,
         pj.scheduled_at,
         cv.workflow_run_id,
         cv.platform
       FROM publish_jobs pj
       JOIN content_variants cv
         ON cv.id = pj.variant_id
        AND cv.workspace_id = pj.workspace_id
       WHERE pj.status = 'validated'
         AND pj.scheduled_at <= NOW()
       LIMIT $1`,
      [limit]
    );
    return result.rows;
  }

  async enqueueExecuteEvent(
    client: pg.PoolClient,
    job: ScheduledJob
  ): Promise<PublishFacebookExecuteEvent | PublishTiktokExecuteEvent | null> {
    const platform = job.platform;
    const idempotencyKey = `publish.${platform}.execute:${job.workspace_id}:${job.id}`;
    const eventId = randomUUID();
    const correlationId = randomUUID(); // New correlation for the execution phase

    // We use an outbox pattern table to ensure we only emit this once per job
    const insertResult = await client.query(
      `INSERT INTO publish_execution_events (
        id, event_id, event_type, workspace_id, job_id, idempotency_key, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [randomUUID(), eventId, `publish.${platform}.execute`, job.workspace_id, job.id, idempotencyKey]
    );

    if ((insertResult.rowCount ?? 0) === 0) {
      return null; // Already enqueued
    }

    if (platform === "tiktok") {
      return {
        event_id: eventId,
        event_type: "publish.tiktok.execute",
        event_version: 1,
        workspace_id: job.workspace_id,
        correlation_id: correlationId,
        workflow_run_id: job.workflow_run_id,
        job_id: job.id,
        variant_id: job.variant_id,
        channel_account_id: job.channel_account_id,
        scheduled_at: new Date(job.scheduled_at).toISOString(),
        idempotency_key: idempotencyKey,
        created_at: new Date().toISOString()
      };
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
