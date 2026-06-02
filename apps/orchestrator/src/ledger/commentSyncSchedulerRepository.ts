import type pg from "pg";

export interface SyncJobTarget {
  id: string;
  workspace_id: string;
  channel_account_id: string;
  external_post_id: string;
}

export class CommentSyncSchedulerRepository {
  /**
   * Finds published Facebook jobs that need comment syncing.
   * Criteria:
   * - published_at is not null
   * - published_at >= NOW() - 3 days
   * - platform is 'facebook'
   * - external_post_id is not null
   * - last_comment_sync_at is NULL OR last_comment_sync_at <= NOW() - 5 minutes
   */
  async findJobsToSync(client: pg.PoolClient, limit: number = 50): Promise<SyncJobTarget[]> {
    const res = await client.query<SyncJobTarget>(
      `
      SELECT id, workspace_id, channel_account_id, external_post_id
      FROM publish_jobs
      WHERE status = 'published'
        AND platform = 'facebook'
        AND external_post_id IS NOT NULL
        AND published_at >= NOW() - INTERVAL '3 days'
        AND (last_comment_sync_at IS NULL OR last_comment_sync_at <= NOW() - INTERVAL '5 minutes')
      ORDER BY last_comment_sync_at ASC NULLS FIRST
      LIMIT $1
      `,
      [limit]
    );

    return res.rows;
  }

  /**
   * Updates last_comment_sync_at to prevent immediate re-queueing.
   */
  async markSyncEnqueued(client: pg.PoolClient, jobIds: string[]): Promise<void> {
    if (jobIds.length === 0) return;
    
    await client.query(
      `
      UPDATE publish_jobs
      SET last_comment_sync_at = NOW(), updated_at = NOW()
      WHERE id = ANY($1)
      `,
      [jobIds]
    );
  }
}
