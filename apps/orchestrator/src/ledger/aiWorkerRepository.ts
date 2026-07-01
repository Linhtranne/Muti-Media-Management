import { randomUUID } from "node:crypto";
import type pg from "pg";
import { 
  type AiGenerationStatus, 
  type AiErrorCode, 
  createAiIdempotencyKey,
  type PolicyEvaluateRequestedEvent,
  type StructuredComposerOutput
} from "@mediaops/shared-contracts";
import { AuditLogRepository } from "./auditLogRepository.js";

export interface ClaimResult {
  success: boolean;
  alreadyCompleted: boolean;
  aiGenerationRunId?: string;
  approvedVersion?: number;
  airtableRecordId?: string;
  existingOutput?: StructuredComposerOutput;
}

export interface MarkAiCompletedInput {
  workspaceId: string;
  workflowRunId: string;
  aiGenerationRunId: string;
  airtableRecordId: string;
  campaignId: string | null;
  approvedVersion: number;
  promptVersion: string;
  output: StructuredComposerOutput;
  assetLinks: Array<{ url: string; filename?: string; mimeType?: string }>;
  correlationId: string;
  postId: string;
  syncRetryNeeded?: boolean;
}

export interface MarkAiFailedInput {
  workspaceId: string;
  workflowRunId: string;
  aiGenerationRunId: string;
  errorCode: AiErrorCode;
  errorMessage: string;
  status: AiGenerationStatus;
  outputSnapshot?: { rawOutputHash: string; sanitizedFailure: true; errorCode: AiErrorCode };
}

export interface MarkAiCompletedResult {
  variantId: string;
  policyEvent: PolicyEvaluateRequestedEvent;
}

interface PolicyHandoffRow {
  event_id: string;
  workspace_id: string;
  correlation_id: string;
  workflow_run_id: string;
  ai_generation_run_id: string;
  content_variant_id: string;
  airtable_record_id: string;
  platform: "facebook";
  prompt_version: string;
  approved_version: number;
  idempotency_key: string;
  created_at: Date | string;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export class AiWorkerRepository {
  async findQueuedPolicyHandoff(
    client: pg.PoolClient,
    workspaceId: string,
    workflowRunId: string
  ): Promise<PolicyEvaluateRequestedEvent | null> {
    const result = await client.query<PolicyHandoffRow>(
      `SELECT event_id, workspace_id, correlation_id, workflow_run_id, ai_generation_run_id,
              content_variant_id, airtable_record_id, platform, prompt_version,
              approved_version, idempotency_key, created_at
       FROM policy_handoff_events
       WHERE workspace_id = $1
         AND workflow_run_id = $2
         AND event_type = 'policy.evaluate.requested'
         AND status = 'queued'
       ORDER BY created_at DESC
       LIMIT 1`,
      [workspaceId, workflowRunId]
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      event_id: row.event_id,
      event_type: "policy.evaluate.requested",
      event_version: 1,
      workspace_id: row.workspace_id,
      correlation_id: row.correlation_id,
      workflow_run_id: row.workflow_run_id,
      ai_generation_run_id: row.ai_generation_run_id,
      content_variant_id: row.content_variant_id,
      airtable_record_id: row.airtable_record_id,
      platform: row.platform,
      prompt_version: row.prompt_version,
      approved_version: row.approved_version,
      idempotency_key: row.idempotency_key,
      created_at: toIsoString(row.created_at)
    };
  }

  async findLatestQueuedPolicyHandoffForRecord(
    client: pg.PoolClient,
    workspaceId: string,
    airtableRecordId: string
  ): Promise<PolicyEvaluateRequestedEvent | null> {
    const result = await client.query<PolicyHandoffRow>(
      `SELECT event_id, workspace_id, correlation_id, workflow_run_id, ai_generation_run_id,
              content_variant_id, airtable_record_id, platform, prompt_version,
              approved_version, idempotency_key, created_at
       FROM policy_handoff_events
       WHERE workspace_id = $1
         AND airtable_record_id = $2
         AND event_type = 'policy.evaluate.requested'
         AND status = 'queued'
       ORDER BY approved_version DESC, created_at DESC
       LIMIT 1`,
      [workspaceId, airtableRecordId]
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      event_id: row.event_id,
      event_type: "policy.evaluate.requested",
      event_version: 1,
      workspace_id: row.workspace_id,
      correlation_id: row.correlation_id,
      workflow_run_id: row.workflow_run_id,
      ai_generation_run_id: row.ai_generation_run_id,
      content_variant_id: row.content_variant_id,
      airtable_record_id: row.airtable_record_id,
      platform: row.platform,
      prompt_version: row.prompt_version,
      approved_version: row.approved_version,
      idempotency_key: row.idempotency_key,
      created_at: toIsoString(row.created_at)
    };
  }

  /**
   * Atomically claims a workflow_run by ID and transitions it to 'ai_generation_processing',
   * and creates/resumes the ai_generation_runs record with the prompt version idempotency key.
   */
  async claimWorkflowRun(
    client: pg.PoolClient,
    workspaceId: string,
    workflowRunId: string,
    promptVersion: string,
    provider: string,
    model: string
  ): Promise<ClaimResult> {
    // 1. Advisory lock on (workspace_id, workflow_run_id)
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
      [workspaceId, workflowRunId]
    );

    // 2. Lock the specific workflow_runs row with RLS
    const wfResult = await client.query<{ id: string; status: string; approved_version: number; airtable_record_id: string }>(
      `SELECT id, status, approved_version, airtable_record_id 
       FROM workflow_runs 
       WHERE id = $1 AND workspace_id = $2 
       FOR UPDATE`,
      [workflowRunId, workspaceId]
    );

    if (wfResult.rows.length === 0) {
      return { success: false, alreadyCompleted: false };
    }

    const wf = wfResult.rows[0];

    // If workflow has already progressed past AI generation
    if (wf.status === "ai_generation_completed") {
      // Find the existing completed run
      const existingRun = await client.query<{ id: string; output_snapshot: StructuredComposerOutput }>(
        `SELECT id, output_snapshot 
         FROM ai_generation_runs 
         WHERE workflow_run_id = $1 AND workspace_id = $2 AND status = 'completed'
         LIMIT 1`,
        [workflowRunId, workspaceId]
      );

      return {
        success: false,
        alreadyCompleted: true,
        aiGenerationRunId: existingRun.rows[0]?.id,
        approvedVersion: wf.approved_version,
        airtableRecordId: wf.airtable_record_id,
        existingOutput: existingRun.rows[0]?.output_snapshot
      };
    }

    // 3. Compute prompt version idempotency key
    const idempotencyKey = createAiIdempotencyKey({
      workspaceId,
      workflowRunId,
      promptVersion
    });

    // 4. Check for existing run by idempotency key
    const runResult = await client.query<{ id: string; status: string; output_snapshot: StructuredComposerOutput }>(
      `SELECT id, status, output_snapshot 
       FROM ai_generation_runs 
       WHERE idempotency_key = $1 AND workspace_id = $2
       LIMIT 1`,
      [idempotencyKey, workspaceId]
    );

    let aiGenerationRunId: string;

    if (runResult.rows.length > 0) {
      const run = runResult.rows[0];
      aiGenerationRunId = run.id;

      if (run.status === "completed") {
        // Fast-pass duplicate redelivery: mark parent completed if it wasn't already
        if (wf.status !== "ai_generation_completed") {
          await client.query(
            `UPDATE workflow_runs 
             SET status = 'ai_generation_completed', updated_at = NOW() 
             WHERE id = $1 AND workspace_id = $2`,
            [workflowRunId, workspaceId]
          );
        }

        return {
          success: false,
          alreadyCompleted: true,
          aiGenerationRunId,
          approvedVersion: wf.approved_version,
          airtableRecordId: wf.airtable_record_id,
          existingOutput: run.output_snapshot
        };
      }

      // Resume: update run status to processing
      await client.query(
        `UPDATE ai_generation_runs 
         SET status = 'processing', completed_at = NULL, error_code = NULL, error_message = NULL
         WHERE id = $1 AND workspace_id = $2`,
        [aiGenerationRunId, workspaceId]
      );
    } else {
      // Create new generation run
      aiGenerationRunId = randomUUID();
      await client.query(
        `INSERT INTO ai_generation_runs (
          id, workspace_id, workflow_run_id, airtable_record_id, approved_version, 
          platform, idempotency_key, provider, model, prompt_version, input_snapshot, status
         ) VALUES ($1, $2, $3, $4, $5, 'facebook', $6, $7, $8, $9, $10::jsonb, 'processing')`,
        [
          aiGenerationRunId,
          workspaceId,
          workflowRunId,
          wf.airtable_record_id,
          wf.approved_version,
          idempotencyKey,
          provider,
          model,
          promptVersion,
          JSON.stringify({ airtable_record_id: wf.airtable_record_id, approved_version: wf.approved_version })
        ]
      );
    }

    // 5. Update workflow status to processing
    await client.query(
      `UPDATE workflow_runs 
       SET status = 'ai_generation_processing', updated_at = NOW() 
       WHERE id = $1 AND workspace_id = $2`,
      [workflowRunId, workspaceId]
    );

    // 6. Audit log
    const auditRepo = new AuditLogRepository();
    await auditRepo.insertAuditLog(client, {
      workspaceId,
      eventType: 'ai_run_claimed',
      entityType: 'workflow_run',
      entityId: workflowRunId,
      actorType: 'system',
      actorId: 'ai_composer'
    });

    return {
      success: true,
      alreadyCompleted: false,
      aiGenerationRunId,
      approvedVersion: wf.approved_version,
      airtableRecordId: wf.airtable_record_id
    };
  }

  /**
   * Persists successful AI composer output in ContentVariant, transitioning parent runs.
   * Also enqueues transactional outbox event.
   */
  async markCompleted(
    client: pg.PoolClient,
    input: MarkAiCompletedInput
  ): Promise<MarkAiCompletedResult> {
    const variantId = randomUUID();
    const syncRetryNeeded = input.syncRetryNeeded ?? false;

    // 1. Insert/upsert variant (Facebook unique variant per workflow)
    await client.query(
      `INSERT INTO content_variants (
        id, workspace_id, ai_generation_run_id, workflow_run_id, airtable_record_id, 
        post_id, platform, body, hashtags, cta_url, asset_links, approval_status, policy_status, sync_retry_needed, campaign_id
       ) VALUES ($1, $2, $3, $4, $5, $6, 'facebook', $7, $8::jsonb, $9, $10::jsonb, 'needs_review', 'pending_policy', $11, $12)
       ON CONFLICT (workspace_id, workflow_run_id, platform)
       DO UPDATE SET 
         ai_generation_run_id = EXCLUDED.ai_generation_run_id,
         body = EXCLUDED.body,
         hashtags = EXCLUDED.hashtags,
         cta_url = EXCLUDED.cta_url,
         asset_links = EXCLUDED.asset_links,
         sync_retry_needed = EXCLUDED.sync_retry_needed,
         campaign_id = COALESCE(EXCLUDED.campaign_id, content_variants.campaign_id),
         created_at = NOW()`,
      [
        variantId,
        input.workspaceId,
        input.aiGenerationRunId,
        input.workflowRunId,
        input.airtableRecordId,
        input.postId,
        input.output.body,
        JSON.stringify(input.output.hashtags),
        input.output.cta_url || null,
        JSON.stringify(input.assetLinks),
        syncRetryNeeded,
        input.campaignId
      ]
    );

    // 2. Transition ai_generation_runs
    await client.query(
      `UPDATE ai_generation_runs 
       SET status = 'completed', output_snapshot = $3::jsonb, completed_at = NOW()
       WHERE id = $1 AND workspace_id = $2`,
      [input.aiGenerationRunId, input.workspaceId, JSON.stringify(input.output)]
    );

    // 3. Transition parent workflow status
    await client.query(
      `UPDATE workflow_runs 
       SET status = 'ai_generation_completed', updated_at = NOW() 
       WHERE id = $1 AND workspace_id = $2`,
      [input.workflowRunId, input.workspaceId]
    );

    // 4. Create Transactional Outbox Event
    const eventId = randomUUID();
    const idempotencyKey = createAiIdempotencyKey({
      workspaceId: input.workspaceId,
      workflowRunId: input.workflowRunId,
      promptVersion: input.promptVersion
    });
    const policyEvent: PolicyEvaluateRequestedEvent = {
      event_id: eventId,
      event_type: "policy.evaluate.requested",
      event_version: 1,
      workspace_id: input.workspaceId,
      correlation_id: input.correlationId,
      workflow_run_id: input.workflowRunId,
      ai_generation_run_id: input.aiGenerationRunId,
      content_variant_id: variantId,
      airtable_record_id: input.airtableRecordId,
      platform: "facebook",
      prompt_version: input.promptVersion,
      approved_version: input.approvedVersion,
      idempotency_key: idempotencyKey,
      created_at: new Date().toISOString()
    };

    await client.query(
      `INSERT INTO policy_handoff_events (
        id, event_id, event_type, event_version, workspace_id, correlation_id, 
        workflow_run_id, ai_generation_run_id, content_variant_id, airtable_record_id, 
        platform, prompt_version, approved_version, idempotency_key, metadata, status
       ) VALUES ($1, $2, 'policy.evaluate.requested', 1, $3, $4, $5, $6, $7, $8, 'facebook', $9, $10, $11, $12::jsonb, 'queued')
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        randomUUID(),
        policyEvent.event_id,
        policyEvent.workspace_id,
        policyEvent.correlation_id,
        policyEvent.workflow_run_id,
        policyEvent.ai_generation_run_id,
        policyEvent.content_variant_id,
        policyEvent.airtable_record_id,
        policyEvent.prompt_version,
        policyEvent.approved_version,
        policyEvent.idempotency_key,
        JSON.stringify({ sync_retry_needed: syncRetryNeeded })
      ]
    );

    // 5. Audit log
    const auditRepo = new AuditLogRepository();
    await auditRepo.insertAuditLog(client, {
      workspaceId: input.workspaceId,
      eventType: 'ai_run_completed',
      entityType: 'ai_generation_run',
      entityId: input.aiGenerationRunId,
      actorType: 'system',
      actorId: 'ai_composer'
    });

    return { variantId, policyEvent };
  }

  /**
   * Persists failure in AI composer run.
   */
  async markFailed(
    client: pg.PoolClient,
    input: MarkAiFailedInput
  ): Promise<void> {
    // 1. Transition ai_generation_runs
    await client.query(
      `UPDATE ai_generation_runs 
       SET status = $3, error_code = $4, error_message = $5, output_snapshot = COALESCE($6::jsonb, output_snapshot), completed_at = NOW()
       WHERE id = $1 AND workspace_id = $2`,
      [
        input.aiGenerationRunId,
        input.workspaceId,
        input.status,
        input.errorCode,
        input.errorMessage,
        input.outputSnapshot ? JSON.stringify(input.outputSnapshot) : null
      ]
    );

    // 2. Transition parent workflow status
    const parentStatus = input.status === "retryable_failed" ? "pending_ai_generation" : "ai_generation_failed";
    await client.query(
      `UPDATE workflow_runs 
       SET status = $3, updated_at = NOW() 
       WHERE id = $1 AND workspace_id = $2`,
      [input.workflowRunId, input.workspaceId, parentStatus]
    );

    // 3. Audit log
    const auditRepo = new AuditLogRepository();
    await auditRepo.insertAuditLog(client, {
      workspaceId: input.workspaceId,
      eventType: 'ai_run_failed',
      entityType: 'ai_generation_run',
      entityId: input.aiGenerationRunId,
      actorType: 'system',
      actorId: 'ai_composer',
      metadata: { error_code: input.errorCode, error_message: input.errorMessage, classified_status: input.status }
    });
  }

  /**
   * Updates Airtable sync state on a variant.
   */
  async updateVariantSyncStatus(
    client: pg.PoolClient,
    workspaceId: string,
    variantId: string,
    syncRetryNeeded: boolean
  ): Promise<void> {
    await client.query(
      `UPDATE content_variants 
       SET sync_retry_needed = $3 
       WHERE id = $1 AND workspace_id = $2`,
      [variantId, workspaceId, syncRetryNeeded]
    );

    const auditRepo = new AuditLogRepository();
    await auditRepo.insertAuditLog(client, {
      workspaceId,
      eventType: 'airtable_sync_status_updated',
      entityType: 'content_variant',
      entityId: variantId,
      actorType: 'system',
      actorId: 'ai_composer',
      metadata: { sync_retry_needed: syncRetryNeeded }
    });
  }

  /**
   * Fetches all variants with sync_retry_needed = true.
   */
  async getPendingSyncVariants(
    client: pg.PoolClient,
    workspaceId: string
  ): Promise<{ id: string; airtable_record_id: string; body: string; hashtags: string[]; cta_url: string | null }[]> {
    const res = await client.query<{ id: string; airtable_record_id: string; body: string; hashtags: string[]; cta_url: string | null }>(
      `SELECT id, airtable_record_id, body, hashtags, cta_url 
       FROM content_variants 
       WHERE workspace_id = $1 AND sync_retry_needed = true`,
      [workspaceId]
    );
    return res.rows;
  }
}
