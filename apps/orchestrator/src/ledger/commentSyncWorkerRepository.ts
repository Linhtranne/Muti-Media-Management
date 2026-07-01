import type pg from "pg";

export class CommentSyncWorkerRepository {
  /**
   * Upserts an interaction and returns its ID and current status.
   */
  async upsertInteraction(
    client: pg.PoolClient,
    workspaceId: string,
    platform: string,
    externalId: string,
    data: {
      publish_job_id: string;
      airtable_record_id?: string | null;
      external_post_id: string;
      author_ref: Record<string, unknown>;
      interaction_type: string;
      risk_code: string;
      created_at_platform: string;
    }
  ): Promise<{ id: string; status: string }> {
    const res = await client.query<{ id: string; status: string }>(
      `
      INSERT INTO interactions (
        workspace_id, platform, external_id,
        publish_job_id, airtable_record_id, external_post_id,
        author_ref, interaction_type, risk_code,
        created_at_platform, created_at, updated_at, campaign_id
      )
      SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW(), campaign_id
      FROM publish_jobs WHERE id = $4
      ON CONFLICT (workspace_id, platform, external_id) DO UPDATE SET
        author_ref = EXCLUDED.author_ref,
        risk_code = EXCLUDED.risk_code,
        updated_at = NOW()
      RETURNING id, status
      `,
      [
        workspaceId,
        platform,
        externalId,
        data.publish_job_id,
        data.airtable_record_id ?? null,
        data.external_post_id,
        data.author_ref,
        data.interaction_type,
        data.risk_code,
        data.created_at_platform
      ]
    );

    const row = res.rows[0];
    if (!row) throw new Error("Failed to upsert interaction");
    return row;
  }

  /**
   * Upserts the comment content.
   */
  async upsertComment(
    client: pg.PoolClient,
    interactionId: string,
    workspaceId: string,
    data: {
      body?: string;
      body_preview?: string;
      permalink?: string;
    }
  ): Promise<void> {
    await client.query(
      `
      INSERT INTO comments (
        interaction_id, workspace_id, body, body_preview, permalink, created_at
      ) VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (interaction_id) DO UPDATE SET
        body = COALESCE(EXCLUDED.body, comments.body),
        body_preview = COALESCE(EXCLUDED.body_preview, comments.body_preview),
        permalink = COALESCE(EXCLUDED.permalink, comments.permalink)
      `,
      [
        interactionId,
        workspaceId,
        data.body ?? null,
        data.body_preview ?? null,
        data.permalink ?? null
      ]
    );
  }

  /**
   * Records a Slack alert dispatch, ensuring idempotency.
   * Returns true if it was inserted, false if an alert already exists.
   */
  async recordSlackAlert(
    client: pg.PoolClient,
    interactionId: string,
    workspaceId: string,
    channelId: string | null,
    channelType: "crisis" | "inbox",
    alertType: "comment_risk" | "comment_normal",
    status: "pending" | "pending_config" | "sent" | "failed" = "pending"
  ): Promise<boolean> {
    const res = await client.query(
      `
      INSERT INTO slack_comment_alerts (
        interaction_id, workspace_id, channel_id, channel_type, alert_type, status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (interaction_id) DO NOTHING
      RETURNING id
      `,
      [interactionId, workspaceId, channelId, channelType, alertType, status]
    );

    return (res.rowCount ?? 0) > 0;
  }

  async updateSlackAlertStatus(
    client: pg.PoolClient,
    interactionId: string,
    workspaceId: string,
    status: "sent" | "failed"
  ): Promise<void> {
    await client.query(
      `
      UPDATE slack_comment_alerts
      SET status = $3
      WHERE interaction_id = $1 AND workspace_id = $2
      `,
      [interactionId, workspaceId, status]
    );
  }

  /**
   * Updates the last_comment_sync_at timestamp for a publish job.
   */
  async markJobSyncTime(
    client: pg.PoolClient,
    jobId: string,
    timestamp: string
  ): Promise<void> {
    await client.query(
      `
      UPDATE publish_jobs
      SET last_comment_sync_at = $2, updated_at = NOW()
      WHERE id = $1
      `,
      [jobId, timestamp]
    );
  }

  /**
   * Verifies idempotency for Comment Ingest Queue.
   */
  async checkIngestIdempotency(
    client: pg.PoolClient,
    idempotencyKey: string
  ): Promise<boolean> {
    const res = await client.query(
      `SELECT 1 FROM comment_sync_events WHERE idempotency_key = $1`,
      [idempotencyKey]
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Records the ingest idempotency key.
   */
  async recordIngestIdempotency(
    client: pg.PoolClient,
    eventId: string,
    eventType: string,
    workspaceId: string,
    jobId: string,
    idempotencyKey: string
  ): Promise<void> {
    await client.query(
      `
      INSERT INTO comment_sync_events (
        event_id, event_type, workspace_id, job_id, idempotency_key, status, created_at
      ) VALUES ($1, $2, $3, $4, $5, 'completed', NOW())
      ON CONFLICT (idempotency_key) DO NOTHING
      `,
      [eventId, eventType, workspaceId, jobId, idempotencyKey]
    );
  }
}
