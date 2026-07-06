import type pg from "pg";
import type { PublishTiktokExecuteEvent } from "@mediaops/shared-contracts";
import { AuditLogRepository } from "./auditLogRepository.js";

export interface TiktokPublishContext {
  job: {
    id: string;
    workspace_id: string;
    status: string;
    tiktok_request_id: string | null;
  };
  variant: {
    id: string;
    post_id: string;
    body: string;
    hashtags: string[];
    airtable_record_id: string;
  };
  channelAccount: {
    id: string;
    external_account_id: string;
    secret_ref: string;
  };
  mediaDerivatives: Array<{
    public_url: string;
    derivative_kind: string;
  }>;
}

export class TiktokPublishWorkerRepository {
  async loadAndLockContext(
    client: pg.PoolClient,
    workspaceId: string,
    message: PublishTiktokExecuteEvent
  ): Promise<TiktokPublishContext | null> {
    // Lock job for update
    const jobResult = await client.query<{ id: string; workspace_id: string; status: string; publish_idempotency_key: string | null; tiktok_request_id: string | null }>(
      `SELECT id, workspace_id, status, publish_idempotency_key, tiktok_request_id FROM publish_jobs
       WHERE id = $1 AND workspace_id = $2
       FOR UPDATE`,
      [message.job_id, workspaceId]
    );

    const job = jobResult.rows[0];
    if (!job) return null;

    if (job.status === "published" || job.status === "failed") {
      return null;
    }

    if (job.status !== "validated" && job.status !== "publishing") {
      return null;
    }

    if (job.status === "publishing" && job.publish_idempotency_key !== message.idempotency_key) {
      return null;
    }

    const variantResult = await client.query<{ id: string; post_id: string; body: string; hashtags: string[]; airtable_record_id: string }>(
      `SELECT id, post_id, body, hashtags, airtable_record_id FROM content_variants
       WHERE id = $1 AND workspace_id = $2`,
      [message.variant_id, workspaceId]
    );
    
    const variant = variantResult.rows[0];
    if (!variant) return null;

    const accountResult = await client.query<{ id: string; external_account_id: string; secret_ref: string }>(
      `SELECT id, external_account_id, secret_ref FROM channel_accounts
       WHERE id = $1 AND workspace_id = $2 AND lower(platform) = 'tiktok' AND status = 'active' AND token_status = 'valid'`,
      [message.channel_account_id, workspaceId]
    );

    const account = accountResult.rows[0];
    if (!account) return null;

    // Load ready media derivatives of kind tiktok_video or tiktok_photo
    const derivativesResult = await client.query<{ public_url: string; derivative_kind: string }>(
      `SELECT mad.public_url, mad.derivative_kind
       FROM post_media_assets pma
       JOIN media_asset_derivatives mad
         ON mad.media_asset_id = pma.media_asset_id
        AND mad.workspace_id = pma.workspace_id
       WHERE pma.workspace_id = $1
         AND pma.post_id = $2
         AND mad.derivative_kind IN ('tiktok_video', 'tiktok_photo')
         AND mad.status = 'ready'
       ORDER BY pma.sort_order ASC`,
      [workspaceId, variant.post_id]
    );

    // Transition to publishing
    await client.query(
      `UPDATE publish_jobs 
       SET status = 'publishing', 
           publish_started_at = COALESCE(publish_started_at, NOW()),
           publish_idempotency_key = $3
       WHERE id = $1 AND workspace_id = $2`,
      [job.id, workspaceId, message.idempotency_key]
    );
    job.status = 'publishing';

    return {
      job,
      variant,
      channelAccount: account,
      mediaDerivatives: derivativesResult.rows
    };
  }

  async persistPendingStatus(
    client: pg.PoolClient,
    workspaceId: string,
    jobId: string,
    correlationId: string,
    tiktokRequestId: string
  ): Promise<void> {
    await client.query(
      `UPDATE publish_jobs
       SET status = 'pending_platform_status',
           tiktok_request_id = $3,
           publish_attempt_count = publish_attempt_count + 1
       WHERE id = $1 AND workspace_id = $2`,
      [jobId, workspaceId, tiktokRequestId]
    );

    const auditRepo = new AuditLogRepository();
    await auditRepo.insertAuditLog(client, {
      workspaceId,
      eventType: 'TIKTOK_PUBLISH_STATUS_PENDING',
      entityType: 'publish_job',
      entityId: jobId,
      actorType: 'system',
      actorId: 'tiktok_publish_worker',
      metadata: { tiktok_request_id: tiktokRequestId, correlation_id: correlationId }
    });
  }

  async persistTransientFailure(
    client: pg.PoolClient,
    workspaceId: string,
    jobId: string
  ): Promise<void> {
    await client.query(
      `UPDATE publish_jobs
       SET status = 'validated',
           publish_attempt_count = publish_attempt_count + 1
       WHERE id = $1 AND workspace_id = $2`,
      [jobId, workspaceId]
    );
  }

  async persistPermanentFailure(
    client: pg.PoolClient,
    workspaceId: string,
    jobId: string,
    correlationId: string,
    errorCode: string,
    errorMessage: string
  ): Promise<void> {
    const auditRepo = new AuditLogRepository();

    await client.query(
      `UPDATE publish_jobs
       SET status = 'failed',
           last_error_code = $3,
           last_error = $4,
           publish_attempt_count = publish_attempt_count + 1
       WHERE id = $1 AND workspace_id = $2`,
      [jobId, workspaceId, errorCode, errorMessage]
    );

    try {
      await client.query(
        `UPDATE workflow_runs SET status = 'mcp_publish_failed' 
         WHERE id = (
           SELECT cv.workflow_run_id
           FROM publish_jobs pj
           JOIN content_variants cv
             ON cv.id = pj.variant_id
            AND cv.workspace_id = pj.workspace_id
           WHERE pj.id = $1
         )`,
        [jobId]
      );
    } catch (error) {
      await auditRepo.insertAuditLog(client, {
        workspaceId,
        eventType: 'workflow_status_update_skipped',
        entityType: 'publish_job',
        entityId: jobId,
        actorType: 'system',
        actorId: 'tiktok_publish_worker',
        severity: 'warn',
        metadata: { target_status: 'mcp_publish_failed', error: String(error) }
      });
    }

    await auditRepo.insertAuditLog(client, {
      workspaceId,
      eventType: 'TIKTOK_PUBLISH_FAILED',
      entityType: 'publish_job',
      entityId: jobId,
      actorType: 'system',
      actorId: 'tiktok_publish_worker',
      metadata: { error_code: errorCode, error_message: errorMessage, correlation_id: correlationId }
    });
  }
}
