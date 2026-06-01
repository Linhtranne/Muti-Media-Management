import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { PolicyEvaluateRequestedEvent, PublishFacebookRequestedEvent } from "@mediaops/shared-contracts";
import { POLICY_VERSION, type PolicyEvaluation } from "@mediaops/policy-engine";

export type PolicyContext = {
  variant: {
    id: string;
    workspace_id: string;
    workflow_run_id: string;
    ai_generation_run_id: string;
    airtable_record_id: string;
    post_id: string;
    body: string;
    hashtags: string[];
    cta_url: string | null;
    approval_status: string;
    policy_status: string;
  };
  workflow: {
    id: string;
    status: string;
    approved_version: number;
  };
  channelAccount: {
    id: string;
    status: string;
    token_status: string;
  } | null;
  workspaceConfig: {
    autoPublishEnabled: boolean;
    autoApproveEnabled: boolean;
    utmWarnOnly: boolean;
    forbiddenTerms: string[];
  };
};

export type PersistPolicyResult = {
  status: "duplicate" | "ineligible" | "persisted";
  allowed?: boolean;
  resultId?: string;
  publishEvent?: PublishFacebookRequestedEvent;
  blockers?: Array<{ code: string; detail: string }>;
  warnings?: Array<{ code: string; detail: string }>;
};

export class PolicyWorkerRepository {
  async getExistingResult(
    client: pg.PoolClient,
    workspaceId: string,
    idempotencyKey: string
  ): Promise<{ id: string } | null> {
    const result = await client.query<{ id: string }>(
      `SELECT id FROM publish_rule_results
       WHERE workspace_id = $1 AND idempotency_key = $2
       LIMIT 1`,
      [workspaceId, idempotencyKey]
    );
    return result.rows[0] ?? null;
  }

  async loadAndLockContext(
    client: pg.PoolClient,
    workspaceId: string,
    message: PolicyEvaluateRequestedEvent
  ): Promise<PolicyContext | null> {
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
      [workspaceId, message.content_variant_id]
    );

    const variantResult = await client.query<PolicyContext["variant"]>(
      `SELECT id, workspace_id, workflow_run_id, ai_generation_run_id, airtable_record_id,
              post_id, body, hashtags, cta_url, approval_status, policy_status
       FROM content_variants
       WHERE id = $1 AND workspace_id = $2
       FOR UPDATE`,
      [message.content_variant_id, workspaceId]
    );
    const variant = variantResult.rows[0];
    if (!variant || variant.policy_status !== "pending_policy") {
      return null;
    }

    const workflowResult = await client.query<PolicyContext["workflow"]>(
      `SELECT id, status, approved_version
       FROM workflow_runs
       WHERE id = $1 AND workspace_id = $2
       FOR UPDATE`,
      [message.workflow_run_id, workspaceId]
    );
    const workflow = workflowResult.rows[0];
    if (!workflow || workflow.status !== "ai_generation_completed") {
      return null;
    }

    await client.query(
      `UPDATE content_variants
       SET policy_status = 'policy_evaluating'
       WHERE id = $1 AND workspace_id = $2`,
      [message.content_variant_id, workspaceId]
    );

    const channelResult = await client.query<{ id: string; status: string; token_status: string }>(
      `SELECT id, status, token_status
       FROM channel_accounts
       WHERE workspace_id = $1 AND platform = 'facebook'
       ORDER BY connected_at DESC
       LIMIT 1`,
      [workspaceId]
    );

    return {
      variant: {
        ...variant,
        hashtags: Array.isArray(variant.hashtags) ? variant.hashtags : []
      },
      workflow,
      channelAccount: channelResult.rows[0] ?? null,
      workspaceConfig: {
        autoPublishEnabled: process.env.AUTO_PUBLISH_ENABLED === "true",
        autoApproveEnabled: process.env.AUTO_APPROVE_ENABLED === "true",
        utmWarnOnly: process.env.POLICY_UTM_WARN_ONLY !== "false",
        forbiddenTerms: process.env.POLICY_FORBIDDEN_TERMS
          ? process.env.POLICY_FORBIDDEN_TERMS.split(",").map((term) => term.trim()).filter(Boolean)
          : []
      }
    };
  }

  async markIneligible(
    client: pg.PoolClient,
    workspaceId: string,
    message: PolicyEvaluateRequestedEvent,
    reason: string
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_logs (id, workspace_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
       VALUES ($1, $2, 'system', 'policy_worker', 'policy_ineligible', 'content_variant', $3, $4::jsonb)`,
      [randomUUID(), workspaceId, message.content_variant_id, JSON.stringify({ reason, correlation_id: message.correlation_id })]
    );
  }

  async persistEvaluation(
    client: pg.PoolClient,
    workspaceId: string,
    message: PolicyEvaluateRequestedEvent,
    context: PolicyContext,
    evaluation: PolicyEvaluation
  ): Promise<PersistPolicyResult> {
    const resultId = randomUUID();
    const allowed = evaluation.allowed;
    const policyStatus = allowed ? "policy_approved" : "policy_rejected";
    const workflowStatus = allowed ? "policy_evaluation_completed" : "policy_evaluation_blocked";

    await client.query(
      `INSERT INTO publish_rule_results (
        id, workspace_id, post_id, variant_id, workflow_run_id, ai_generation_run_id,
        allowed, blockers, warnings, checks, policy_version, idempotency_key
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12)`,
      [
        resultId,
        workspaceId,
        context.variant.post_id,
        context.variant.id,
        context.variant.workflow_run_id,
        context.variant.ai_generation_run_id,
        allowed,
        JSON.stringify(evaluation.blockers),
        JSON.stringify(evaluation.warnings),
        JSON.stringify(evaluation.checks),
        POLICY_VERSION,
        message.idempotency_key
      ]
    );

    await client.query(
      `UPDATE content_variants
       SET policy_status = $3
       WHERE id = $1 AND workspace_id = $2`,
      [context.variant.id, workspaceId, policyStatus]
    );

    await client.query(
      `UPDATE workflow_runs
       SET status = $3, updated_at = NOW()
       WHERE id = $1 AND workspace_id = $2`,
      [context.workflow.id, workspaceId, workflowStatus]
    );

    await client.query(
      `INSERT INTO audit_logs (id, workspace_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
       VALUES ($1, $2, 'system', 'policy_worker', 'policy_check_completed', 'publish_rule_result', $3, $4::jsonb)`,
      [
        randomUUID(),
        workspaceId,
        resultId,
        JSON.stringify({
          allowed,
          blocker_codes: evaluation.blockers.map((blocker) => blocker.code),
          warning_codes: evaluation.warnings.map((warning) => warning.code),
          correlation_id: message.correlation_id
        })
      ]
    );

    if (!allowed || !context.channelAccount || context.workspaceConfig.autoPublishEnabled !== true || context.workspaceConfig.autoApproveEnabled !== true) {
      return {
        status: "persisted",
        allowed,
        resultId,
        blockers: evaluation.blockers,
        warnings: evaluation.warnings
      };
    }

    const jobId = randomUUID();
    const jobIdempotencyKey = `publish.facebook.job:${workspaceId}:${context.variant.post_id}:${context.workflow.approved_version}:${POLICY_VERSION}`;
    const scheduledAt = new Date().toISOString();

    await client.query(
      `INSERT INTO publish_jobs (
        id, workspace_id, post_id, variant_id, channel_account_id, scheduled_at, status, idempotency_key
       ) VALUES ($1, $2, $3, $4, $5, $6, 'queued', $7)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [jobId, workspaceId, context.variant.post_id, context.variant.id, context.channelAccount.id, scheduledAt, jobIdempotencyKey]
    );

    const eventId = randomUUID();
    const handoffIdempotencyKey = `publish.facebook.handoff:${workspaceId}:${jobId}`;
    await client.query(
      `INSERT INTO publish_handoff_events (
        id, event_id, event_type, event_version, workspace_id, correlation_id, workflow_run_id,
        job_id, variant_id, channel_account_id, scheduled_at, idempotency_key, status
       ) VALUES ($1, $2, 'publish.facebook.requested', 1, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        randomUUID(),
        eventId,
        workspaceId,
        message.correlation_id,
        context.workflow.id,
        jobId,
        context.variant.id,
        context.channelAccount.id,
        scheduledAt,
        handoffIdempotencyKey
      ]
    );

    await client.query(
      `INSERT INTO audit_logs (id, workspace_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
       VALUES ($1, $2, 'system', 'policy_worker', 'publish_job_stub_created', 'publish_job', $3, $4::jsonb)`,
      [randomUUID(), workspaceId, jobId, JSON.stringify({ result_id: resultId, correlation_id: message.correlation_id })]
    );

    return {
      status: "persisted",
      allowed,
      resultId,
      blockers: evaluation.blockers,
      warnings: evaluation.warnings,
      publishEvent: {
        event_id: eventId,
        event_type: "publish.facebook.requested",
        event_version: 1,
        workspace_id: workspaceId,
        correlation_id: message.correlation_id,
        workflow_run_id: context.workflow.id,
        job_id: jobId,
        variant_id: context.variant.id,
        channel_account_id: context.channelAccount.id,
        scheduled_at: scheduledAt,
        idempotency_key: handoffIdempotencyKey,
        created_at: new Date().toISOString()
      }
    };
  }

  async markAirtableSyncRetryNeeded(
    client: pg.PoolClient,
    workspaceId: string,
    resultId: string,
    errorMessage: string
  ): Promise<void> {
    await client.query(
      `UPDATE publish_rule_results
       SET airtable_sync_retry_needed = true
       WHERE id = $1 AND workspace_id = $2`,
      [resultId, workspaceId]
    );

    await client.query(
      `INSERT INTO audit_logs (id, workspace_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
       VALUES ($1, $2, 'system', 'policy_worker', 'policy_airtable_sync_failed', 'publish_rule_result', $3, $4::jsonb)`,
      [randomUUID(), workspaceId, resultId, JSON.stringify({ error_message: errorMessage })]
    );
  }
}
