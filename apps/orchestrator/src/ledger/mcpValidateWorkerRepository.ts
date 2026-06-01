import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { PublishFacebookRequestedEvent, PublishFacebookValidatedEvent } from "@mediaops/shared-contracts";
import type { ValidatePostResult, ValidatePostInput } from "@mediaops/shared-contracts";

export type McpValidateContext = {
  job: {
    id: string;
    workspace_id: string;
    status: string;
  };
  input: ValidatePostInput;
};

export type PersistValidationResult = {
  status: "duplicate" | "ineligible" | "persisted";
  passed?: boolean;
  publishEvent?: PublishFacebookValidatedEvent;
};

export class McpValidateWorkerRepository {
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
    message: PublishFacebookRequestedEvent
  ): Promise<McpValidateContext | null> {
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
    if (!job || job.status !== "queued") {
      return null;
    }

    const variantResult = await client.query<{ id: string; body: string; hashtags: any[]; cta_url: string | null }>(
      `SELECT id, body, hashtags, cta_url FROM content_variants
       WHERE id = $1 AND workspace_id = $2`,
      [message.variant_id, workspaceId]
    );
    
    const variant = variantResult.rows[0];
    if (!variant) return null;

    const accountResult = await client.query<{ id: string; secret_ref: string }>(
      `SELECT id, secret_ref FROM channel_accounts
       WHERE id = $1 AND workspace_id = $2`,
      [message.channel_account_id, workspaceId]
    );

    const account = accountResult.rows[0];
    if (!account) return null;

    // Update job status
    await client.query(
      `UPDATE publish_jobs SET status = 'mcp_validating'
       WHERE id = $1 AND workspace_id = $2`,
      [job.id, workspaceId]
    );

    const hashtags = Array.isArray(variant.hashtags) ? variant.hashtags : [];
    
    const input: ValidatePostInput = {
      variantRef: {
        variantId: variant.id,
        bodyLength: variant.body.length,
        hashtagCount: hashtags.length,
        hasMedia: false, // MVP constraint
        ...(variant.cta_url ? { ctaUrl: variant.cta_url } : {})
      },
      channelAccountId: account.id,
      secretRef: account.secret_ref
    };

    return { job, input };
  }

  async persistValidation(
    client: pg.PoolClient,
    workspaceId: string,
    message: PublishFacebookRequestedEvent,
    context: McpValidateContext,
    result: ValidatePostResult
  ): Promise<PersistValidationResult> {
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

    await client.query(
      `INSERT INTO audit_logs (id, workspace_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
       VALUES ($1, $2, 'system', 'mcp_validate_worker', 'mcp_validation_completed', 'publish_job', $3, $4::jsonb)`,
      [
        randomUUID(),
        workspaceId,
        context.job.id,
        JSON.stringify({ passed: result.passed, correlation_id: message.correlation_id })
      ]
    );

    if (!result.passed) {
      return { status: "persisted", passed: false };
    }

    const eventId = randomUUID();
    const validatedIdempotencyKey = `publish.facebook.validated:${workspaceId}:${context.job.id}`;
    
    await client.query(
      `INSERT INTO mcp_validation_events (
        id, event_id, event_type, event_version, workspace_id, correlation_id, workflow_run_id,
        job_id, variant_id, channel_account_id, scheduled_at, idempotency_key, status, validated_at
       ) VALUES ($1, $2, 'publish.facebook.validated', 1, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', NOW())
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
        event_type: "publish.facebook.validated",
        event_version: 1,
        workspace_id: workspaceId,
        correlation_id: message.correlation_id,
        workflow_run_id: message.workflow_run_id,
        job_id: context.job.id,
        variant_id: message.variant_id,
        channel_account_id: message.channel_account_id,
        scheduled_at: message.scheduled_at,
        idempotency_key: validatedIdempotencyKey,
        validated_at: new Date().toISOString(),
        created_at: new Date().toISOString()
      }
    };
  }

  async markIneligible(
    client: pg.PoolClient,
    workspaceId: string,
    message: PublishFacebookRequestedEvent,
    reason: string
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_logs (id, workspace_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
       VALUES ($1, $2, 'system', 'mcp_validate_worker', 'validation_ineligible', 'publish_job', $3, $4::jsonb)`,
      [randomUUID(), workspaceId, message.job_id, JSON.stringify({ reason, correlation_id: message.correlation_id })]
    );
  }
}
