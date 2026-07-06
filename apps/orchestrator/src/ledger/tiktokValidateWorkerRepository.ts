import { randomUUID } from "node:crypto";
import type pg from "pg";
import type {
  PublishTiktokRequestedEvent,
  PublishTiktokValidatedEvent,
  ValidateTiktokPostInput,
  ValidatePostResult
} from "@mediaops/shared-contracts";
import { AuditLogRepository } from "./auditLogRepository.js";

export interface TiktokValidateContext {
  job: {
    id: string;
    workspace_id: string;
    status: string;
  };
  variant: {
    id: string;
    airtable_record_id: string;
    post_id: string;
    body: string;
    hashtags: string[];
    cta_url: string | null;
  };
  mediaDerivatives: { public_url: string; derivative_kind: string }[];
  input: ValidateTiktokPostInput;
}

export interface PersistTiktokValidationResult {
  status: "duplicate" | "ineligible" | "persisted";
  passed?: boolean;
  publishEvent?: PublishTiktokValidatedEvent;
}

export class TiktokValidateWorkerRepository {
  async getExistingResult(
    client: pg.PoolClient,
    workspaceId: string,
    idempotencyKey: string
  ): Promise<{ id: string } | null> {
    const result = await client.query<{ id: string }>(
      `SELECT id FROM mcp_validation_events
       WHERE workspace_id = $1 AND idempotency_key = $2
       LIMIT 1`,
      [workspaceId, idempotencyKey]
    );
    return result.rows[0] ?? null;
  }

  async loadAndLockContext(
    client: pg.PoolClient,
    workspaceId: string,
    message: PublishTiktokRequestedEvent
  ): Promise<TiktokValidateContext | null> {
    // Lock variant to prevent concurrent updates to the same post publishing flow
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
      [workspaceId, message.variant_id]
    );

    const jobResult = await client.query<{ id: string; workspace_id: string; status: string }>(
      `SELECT id, workspace_id, status FROM publish_jobs
       WHERE id = $1 AND workspace_id = $2
       FOR UPDATE`,
      [message.job_id, workspaceId]
    );

    const job = jobResult.rows[0];
    if (job?.status !== "queued") {
      return null;
    }

    const variantResult = await client.query<{ id: string; airtable_record_id: string; post_id: string; body: string; hashtags: string[]; cta_url: string | null; asset_links: unknown }>(
      `SELECT id, airtable_record_id, post_id, body, hashtags, cta_url, asset_links FROM content_variants
       WHERE id = $1 AND workspace_id = $2`,
      [message.variant_id, workspaceId]
    );
    
    const variant = variantResult.rows[0];
    if (!variant) return null;

    const accountResult = await client.query<{ id: string }>(
      `SELECT id FROM channel_accounts
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
    const mediaDerivatives = derivativesResult.rows;

    // Update job status
    await client.query(
      `UPDATE publish_jobs SET status = 'mcp_validating'
       WHERE id = $1 AND workspace_id = $2`,
      [job.id, workspaceId]
    );

    const hashtags = Array.isArray(variant.hashtags) ? variant.hashtags : [];
    const assetLinks = Array.isArray(variant.asset_links) ? variant.asset_links : [];
    const hasMedia = assetLinks.length > 0 || mediaDerivatives.length > 0;
    
    const input = {
      variantRef: {
        variantId: variant.id,
        bodyLength: variant.body.length,
        hashtagCount: hashtags.length,
        hasMedia,
        ...(variant.cta_url ? { ctaUrl: variant.cta_url } : {})
      },
      channelAccountId: account.id,
      workspaceId
    };

    const variantData = {
      id: variant.id,
      airtable_record_id: variant.airtable_record_id,
      post_id: variant.post_id,
      body: variant.body,
      hashtags,
      cta_url: variant.cta_url
    };

    return { job, variant: variantData, mediaDerivatives, input };
  }

  async persistValidation(
    client: pg.PoolClient,
    workspaceId: string,
    message: PublishTiktokRequestedEvent,
    context: TiktokValidateContext,
    result: ValidatePostResult
  ): Promise<PersistTiktokValidationResult> {
    const newStatus = result.passed ? "validated" : "validation_failed";

    await client.query(
      `UPDATE publish_jobs
       SET status = $3,
           mcp_validation_idempotency_key = $4,
           mcp_validation_result = $5::jsonb,
           validated_at = NOW()
       WHERE id = $1 AND workspace_id = $2`,
      [context.job.id, workspaceId, newStatus, message.idempotency_key, JSON.stringify(result)]
    );

    const auditRepo = new AuditLogRepository();
    await auditRepo.insertAuditLog(client, {
      workspaceId,
      eventType: 'mcp_validation_completed',
      entityType: 'publish_job',
      entityId: context.job.id,
      actorType: 'system',
      actorId: 'tiktok_validate_worker',
      metadata: { passed: result.passed, correlation_id: message.correlation_id }
    });

    if (!result.passed) {
      return { status: "persisted", passed: false };
    }

    const eventId = randomUUID();
    const validatedIdempotencyKey = `publish.tiktok.validated:${workspaceId}:${context.job.id}`;
    
    await client.query(
      `INSERT INTO mcp_validation_events (
        id, event_id, event_type, event_version, workspace_id, correlation_id, workflow_run_id,
        job_id, variant_id, channel_account_id, scheduled_at, idempotency_key, status, validated_at
       ) VALUES ($1, $2, 'publish.tiktok.validated', 1, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', NOW())
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        randomUUID(),
        eventId,
        workspaceId,
        message.correlation_id,
        message.workflow_run_id,
        context.job.id,
        message.variant_id,
        message.channel_account_id,
        message.scheduled_at,
        validatedIdempotencyKey
      ]
    );

    return {
      status: "persisted",
      passed: true,
      publishEvent: {
        event_id: eventId,
        event_type: "publish.tiktok.validated",
        event_version: 1,
        workspace_id: workspaceId,
        correlation_id: message.correlation_id,
        workflow_run_id: message.workflow_run_id,
        job_id: context.job.id,
        variant_id: message.variant_id,
        channel_account_id: message.channel_account_id,
        scheduled_at: message.scheduled_at,
        idempotency_key: validatedIdempotencyKey,
        created_at: new Date().toISOString()
      }
    };
  }

  async markIneligible(
    client: pg.PoolClient,
    workspaceId: string,
    message: PublishTiktokRequestedEvent,
    reason: string
  ): Promise<void> {
    const auditRepo = new AuditLogRepository();
    await auditRepo.insertAuditLog(client, {
      workspaceId,
      eventType: 'validation_ineligible',
      entityType: 'publish_job',
      entityId: message.job_id,
      actorType: 'system',
      actorId: 'tiktok_validate_worker',
      metadata: { reason, correlation_id: message.correlation_id }
    });
  }
}
