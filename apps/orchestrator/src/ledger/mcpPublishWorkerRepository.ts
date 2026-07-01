import type pg from "pg";
import type { PublishFacebookExecuteEvent, PublishPostInput, PublishPostResult } from "@mediaops/shared-contracts";
import { AuditLogRepository } from "./auditLogRepository.js";

export interface McpPublishContext {
  job: {
    id: string;
    workspace_id: string;
    status: string;
  };
  airtable_record_id: string;
  input: PublishPostInput | null;
}

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
const DOCUMENT_EXTENSIONS = [".pdf"];

interface AssetLinkRef {
  url: string;
  filename?: string;
  mimeType?: string;
}

function classifyAssetLink(asset: AssetLinkRef): "image" | "document" | "link" {
  const normalizedUrl = asset.url.toLowerCase();
  const normalizedFilename = asset.filename?.toLowerCase() ?? "";
  const searchableAssetText = `${normalizedUrl} ${normalizedFilename}`;
  if (asset.mimeType?.toLowerCase().startsWith("image/")) {
    return "image";
  }
  if (IMAGE_EXTENSIONS.some((extension) => searchableAssetText.includes(extension))) {
    return "image";
  }
  if (asset.mimeType?.toLowerCase() === "application/pdf") {
    return "document";
  }
  if (DOCUMENT_EXTENSIONS.some((extension) => searchableAssetText.includes(extension))) {
    return "document";
  }
  return "link";
}

function isAssetLinkRef(value: unknown): value is AssetLinkRef {
  return typeof value === "object" && value !== null && "url" in value && typeof (value as { url?: unknown }).url === "string";
}

function normalizeAssetLinks(value: unknown): AssetLinkRef[] {
  if (!Array.isArray(value)) return [];
  const rawAssetLinks: unknown[] = value;
  return rawAssetLinks
    .map((item) => typeof item === "string" ? { url: item } : item)
    .filter(isAssetLinkRef);
}

export class McpPublishWorkerRepository {
  async loadAndLockContext(
    client: pg.PoolClient,
    workspaceId: string,
    message: PublishFacebookExecuteEvent
  ): Promise<McpPublishContext | null> {
    // Lock job for update
    const jobResult = await client.query<{ id: string; workspace_id: string; status: string }>(
      `SELECT id, workspace_id, status FROM publish_jobs
       WHERE id = $1 AND workspace_id = $2
       FOR UPDATE`,
      [message.jobId, workspaceId]
    );

    const job = jobResult.rows[0];
    if (!job) return null;

    if (job.status === "published" || job.status === "failed") {
      // Already finished, no-op
      return { job, airtable_record_id: "", input: null };
    }

    if (job.status !== "validated") {
      // Only validated can be published. 
      // If it's already 'publishing', the worker crashed midway. We do not retry to avoid double publish.
      return null;
    }

    const variantResult = await client.query<{ id: string; body: string; hashtags: string[]; cta_url: string | null; asset_links: unknown; airtable_record_id: string }>(
      `SELECT id, body, hashtags, cta_url, asset_links, airtable_record_id FROM content_variants
       WHERE id = $1 AND workspace_id = $2`,
      [message.variantId, workspaceId]
    );
    
    const variant = variantResult.rows[0];
    if (!variant) return null;

    const accountResult = await client.query<{ id: string; external_account_id: string; secret_ref: string }>(
      `SELECT id, external_account_id, secret_ref FROM channel_accounts
       WHERE id = $1 AND workspace_id = $2`,
      [message.channelAccountId, workspaceId]
    );

    const account = accountResult.rows[0];
    if (!account) return null;

    // Transition to publishing
    const idempotencyKey = message.idempotencyKey;
    await client.query(
      `UPDATE publish_jobs 
       SET status = 'publishing', 
           publish_started_at = COALESCE(publish_started_at, NOW()),
           publish_idempotency_key = $3
       WHERE id = $1 AND workspace_id = $2`,
      [job.id, workspaceId, idempotencyKey]
    );
    job.status = 'publishing';

    const hashtags = Array.isArray(variant.hashtags) ? variant.hashtags : [];
    const assetLinks = normalizeAssetLinks(variant.asset_links);
    const media = assetLinks.map((asset) => ({
      type: classifyAssetLink(asset),
      url: asset.url
    }));
    const fallbackLink = variant.cta_url ?? media.find((item) => item.type !== "image")?.url;

    const input: PublishPostInput = {
      jobRef: { jobId: job.id },
      channelAccountId: account.external_account_id,
      secretRef: account.secret_ref,
      content: {
        body: variant.body,
        ...(hashtags.length > 0 ? { hashtags } : {}),
        ...(fallbackLink ? { link: fallbackLink } : {}),
        ...(media.length > 0 ? { media } : {})
      }
    };

    return { job, airtable_record_id: variant.airtable_record_id, input };
  }

  async persistSuccess(
    client: pg.PoolClient,
    workspaceId: string,
    jobId: string,
    correlationId: string,
    result: PublishPostResult
  ): Promise<void> {
    const auditRepo = new AuditLogRepository();

    await client.query(
      `UPDATE publish_jobs
       SET status = 'published',
           external_post_id = $3,
           platform_response_summary = $4::jsonb,
           published_at = $5,
           publish_attempt_count = publish_attempt_count + 1
       WHERE id = $1 AND workspace_id = $2`,
      [jobId, workspaceId, result.externalPostId, JSON.stringify(result.platformResponseSummary || {}), result.publishedAt || new Date().toISOString()]
    );

    // Update workflow run if schema supports it, we'll try it safely (in MVP, usually there's a trigger or we update directly)
    // Assuming `workflow_runs.status` might have an enum type, if it fails, it's safer to catch or ignore, but user instruction said:
    // "update `workflow_runs.status='mcp_publish_completed'` if enum/table supports it"
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
        actorId: 'mcp_publish_worker',
        severity: 'warn',
        metadata: { target_status: 'mcp_publish_completed', error: String(error) }
      });
    }

    await auditRepo.insertAuditLog(client, {
      workspaceId,
      eventType: 'mcp_publish_completed',
      entityType: 'publish_job',
      entityId: jobId,
      actorType: 'system',
      actorId: 'mcp_publish_worker',
      metadata: { external_post_id: result.externalPostId, correlation_id: correlationId }
    });
  }

  async persistTransientFailure(
    client: pg.PoolClient,
    workspaceId: string,
    jobId: string
  ): Promise<void> {
    await client.query(
      `UPDATE publish_jobs
       SET publish_attempt_count = publish_attempt_count + 1
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
        actorId: 'mcp_publish_worker',
        severity: 'warn',
        metadata: { target_status: 'mcp_publish_failed', error: String(error) }
      });
    }

    await auditRepo.insertAuditLog(client, {
      workspaceId,
      eventType: 'mcp_publish_failed',
      entityType: 'publish_job',
      entityId: jobId,
      actorType: 'system',
      actorId: 'mcp_publish_worker',
      metadata: { error_code: errorCode, correlation_id: correlationId }
    });
  }

  async persistAirtableCompensation(
    client: pg.PoolClient,
    workspaceId: string,
    jobId: string,
    errorMsg: string
  ): Promise<void> {
    await client.query(
      `UPDATE publish_jobs
       SET airtable_sync_retry_needed = true,
           airtable_sync_error = $3
       WHERE id = $1 AND workspace_id = $2`,
      [jobId, workspaceId, errorMsg]
    );

    const auditRepo = new AuditLogRepository();
    await auditRepo.insertAuditLog(client, {
      workspaceId,
      eventType: 'airtable_compensation_flagged',
      entityType: 'publish_job',
      entityId: jobId,
      actorType: 'system',
      actorId: 'mcp_publish_worker',
      metadata: { error: errorMsg }
    });
  }
}
