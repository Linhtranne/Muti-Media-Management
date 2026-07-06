import type pg from "pg";
import type { PublishTiktokStatusCheckEvent } from "@mediaops/shared-contracts";
import { AuditLogRepository } from "./auditLogRepository.js";

export interface TiktokStatusCheckContext {
  job: {
    id: string;
    workspace_id: string;
    status: string;
    tiktok_request_id: string;
  };
  channelAccount: {
    id: string;
    external_account_id: string;
    secret_ref: string;
  };
}

export class TiktokStatusCheckWorkerRepository {
  async loadAndLockContext(
    client: pg.PoolClient,
    workspaceId: string,
    message: PublishTiktokStatusCheckEvent
  ): Promise<TiktokStatusCheckContext | null> {
    const jobResult = await client.query<{ id: string; workspace_id: string; status: string; tiktok_request_id: string | null }>(
      `SELECT id, workspace_id, status, tiktok_request_id FROM publish_jobs
       WHERE id = $1 AND workspace_id = $2
       FOR UPDATE`,
      [message.job_id, workspaceId]
    );

    const job = jobResult.rows[0];
    if (job?.status !== "pending_platform_status" || !job?.tiktok_request_id) {
      return null;
    }

    const accountResult = await client.query<{ id: string; external_account_id: string; secret_ref: string }>(
      `SELECT id, external_account_id, secret_ref FROM channel_accounts
       WHERE id = $1 AND workspace_id = $2 AND lower(platform) = 'tiktok' AND status = 'active' AND token_status = 'valid'`,
      [message.channel_account_id, workspaceId]
    );

    const account = accountResult.rows[0];
    if (!account) return null;

    return {
      job: {
        id: job.id,
        workspace_id: job.workspace_id,
        status: job.status,
        tiktok_request_id: job.tiktok_request_id
      },
      channelAccount: account
    };
  }

  async persistSuccess(
    client: pg.PoolClient,
    workspaceId: string,
    jobId: string,
    correlationId: string,
    externalPostId: string,
    platformResponseSummary: Record<string, unknown>
  ): Promise<void> {
    const auditRepo = new AuditLogRepository();

    await client.query(
      `UPDATE publish_jobs
       SET status = 'published',
           external_post_id = $3,
           platform_response_summary = $4::jsonb,
           published_at = NOW()
       WHERE id = $1 AND workspace_id = $2`,
      [jobId, workspaceId, externalPostId, JSON.stringify(platformResponseSummary)]
    );

    try {
      await client.query(
        `UPDATE workflow_runs SET status = 'mcp_publish_completed' 
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
        actorId: 'tiktok_status_check_worker',
        severity: 'warn',
        metadata: { target_status: 'mcp_publish_completed', error: String(error) }
      });
    }

    await auditRepo.insertAuditLog(client, {
      workspaceId,
      eventType: 'TIKTOK_PUBLISH_SUCCEEDED',
      entityType: 'publish_job',
      entityId: jobId,
      actorType: 'system',
      actorId: 'tiktok_status_check_worker',
      metadata: { external_post_id: externalPostId, correlation_id: correlationId }
    });
  }

  async persistFailure(
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
           last_error = $4
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
        actorId: 'tiktok_status_check_worker',
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
      actorId: 'tiktok_status_check_worker',
      metadata: { error_code: errorCode, error_message: errorMessage, correlation_id: correlationId }
    });
  }
}
