import { randomUUID } from "node:crypto";
import type pg from "pg";
import { 
  type AiGenerationStatus, 
  type AiErrorCode, 
  createAiIdempotencyKey,
  type StructuredComposerOutput
} from "@mediaops/shared-contracts";

export type ClaimResult = {
  success: boolean;
  alreadyCompleted: boolean;
  aiGenerationRunId?: string;
  approvedVersion?: number;
  airtableRecordId?: string;
  existingOutput?: StructuredComposerOutput;
};

export class AiWorkerRepository {
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
      const existingRun = await client.query<{ id: string; output_snapshot: any }>(
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
    const runResult = await client.query<{ id: string; status: string; output_snapshot: any }>(
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
    await client.query(
      `INSERT INTO audit_logs (id, workspace_id, actor_type, actor_id, action, entity_type, entity_id)
       VALUES ($1, $2, 'system', 'ai_composer', 'ai_run_claimed', 'workflow_run', $3)`,
      [randomUUID(), workspaceId, workflowRunId]
    );

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
    workspaceId: string,
    workflowRunId: string,
    aiGenerationRunId: string,
    airtableRecordId: string,
    approvedVersion: number,
    promptVersion: string,
    output: StructuredComposerOutput,
    correlationId: string,
    postId: string,
    syncRetryNeeded: boolean = false
  ): Promise<string> {
    const variantId = randomUUID();

    // 1. Insert/upsert variant (Facebook unique variant per workflow)
    await client.query(
      `INSERT INTO content_variants (
        id, workspace_id, ai_generation_run_id, workflow_run_id, airtable_record_id, 
        post_id, platform, body, hashtags, cta_url, approval_status, policy_status, sync_retry_needed
       ) VALUES ($1, $2, $3, $4, $5, $6, 'facebook', $7, $8::jsonb, $9, 'needs_review', 'pending_policy', $10)
       ON CONFLICT (workspace_id, workflow_run_id, platform)
       DO UPDATE SET 
         ai_generation_run_id = EXCLUDED.ai_generation_run_id,
         body = EXCLUDED.body,
         hashtags = EXCLUDED.hashtags,
         cta_url = EXCLUDED.cta_url,
         sync_retry_needed = EXCLUDED.sync_retry_needed,
         created_at = NOW()`,
      [
        variantId,
        workspaceId,
        aiGenerationRunId,
        workflowRunId,
        airtableRecordId,
        postId,
        output.body,
        JSON.stringify(output.hashtags),
        output.cta_url || null,
        syncRetryNeeded
      ]
    );

    // 2. Transition ai_generation_runs
    await client.query(
      `UPDATE ai_generation_runs 
       SET status = 'completed', output_snapshot = $3::jsonb, completed_at = NOW()
       WHERE id = $1 AND workspace_id = $2`,
      [aiGenerationRunId, workspaceId, JSON.stringify(output)]
    );

    // 3. Transition parent workflow status
    await client.query(
      `UPDATE workflow_runs 
       SET status = 'ai_generation_completed', updated_at = NOW() 
       WHERE id = $1 AND workspace_id = $2`,
      [workflowRunId, workspaceId]
    );

    // 4. Create Transactional Outbox Event
    const eventId = randomUUID();
    const idempotencyKey = createAiIdempotencyKey({
      workspaceId,
      workflowRunId,
      promptVersion
    });

    await client.query(
      `INSERT INTO policy_handoff_events (
        id, event_id, event_type, event_version, workspace_id, correlation_id, 
        workflow_run_id, ai_generation_run_id, content_variant_id, airtable_record_id, 
        platform, prompt_version, approved_version, idempotency_key, metadata, status
       ) VALUES ($1, $2, 'policy.evaluate.requested', 1, $3, $4, $5, $6, $7, $8, 'facebook', $9, $10, $11, $12::jsonb, 'queued')
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        randomUUID(),
        eventId,
        workspaceId,
        correlationId,
        workflowRunId,
        aiGenerationRunId,
        variantId,
        airtableRecordId,
        promptVersion,
        approvedVersion,
        idempotencyKey,
        JSON.stringify({ sync_retry_needed: syncRetryNeeded })
      ]
    );

    // 5. Audit log
    await client.query(
      `INSERT INTO audit_logs (id, workspace_id, actor_type, actor_id, action, entity_type, entity_id)
       VALUES ($1, $2, 'system', 'ai_composer', 'ai_run_completed', 'ai_generation_run', $3)`,
      [randomUUID(), workspaceId, aiGenerationRunId]
    );

    return variantId;
  }

  /**
   * Persists failure in AI composer run.
   */
  async markFailed(
    client: pg.PoolClient,
    workspaceId: string,
    workflowRunId: string,
    aiGenerationRunId: string,
    errorCode: AiErrorCode,
    errorMessage: string,
    status: AiGenerationStatus,
    outputSnapshot?: { rawOutputHash: string; sanitizedFailure: true; errorCode: AiErrorCode }
  ): Promise<void> {
    // 1. Transition ai_generation_runs
    await client.query(
      `UPDATE ai_generation_runs 
       SET status = $3, error_code = $4, error_message = $5, output_snapshot = COALESCE($6::jsonb, output_snapshot), completed_at = NOW()
       WHERE id = $1 AND workspace_id = $2`,
      [aiGenerationRunId, workspaceId, status, errorCode, errorMessage, outputSnapshot ? JSON.stringify(outputSnapshot) : null]
    );

    // 2. Transition parent workflow status
    const parentStatus = status === "retryable_failed" ? "pending_ai_generation" : "ai_generation_failed";
    await client.query(
      `UPDATE workflow_runs 
       SET status = $3, updated_at = NOW() 
       WHERE id = $1 AND workspace_id = $2`,
      [workflowRunId, workspaceId, parentStatus]
    );

    // 3. Audit log
    await client.query(
      `INSERT INTO audit_logs (id, workspace_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
       VALUES ($1, $2, 'system', 'ai_composer', 'ai_run_failed', 'ai_generation_run', $3, $4::jsonb)`,
      [randomUUID(), workspaceId, aiGenerationRunId, JSON.stringify({ error_code: errorCode, error_message: errorMessage, classified_status: status })]
    );
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

    await client.query(
      `INSERT INTO audit_logs (id, workspace_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
       VALUES ($1, $2, 'system', 'ai_composer', 'airtable_sync_status_updated', 'content_variant', $3, $4::jsonb)`,
      [randomUUID(), workspaceId, variantId, JSON.stringify({ sync_retry_needed: syncRetryNeeded })]
    );
  }

  /**
   * Fetches all variants with sync_retry_needed = true.
   */
  async getPendingSyncVariants(
    client: pg.PoolClient,
    workspaceId: string
  ): Promise<Array<{ id: string; airtable_record_id: string; body: string; hashtags: any; cta_url: string | null }>> {
    const res = await client.query<{ id: string; airtable_record_id: string; body: string; hashtags: any; cta_url: string | null }>(
      `SELECT id, airtable_record_id, body, hashtags, cta_url 
       FROM content_variants 
       WHERE workspace_id = $1 AND sync_retry_needed = true`,
      [workspaceId]
    );
    return res.rows;
  }
}
