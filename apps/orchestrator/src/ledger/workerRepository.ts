import { randomUUID } from "node:crypto";
import type pg from "pg";
import { createWorkflowIdempotencyKey, type WebhookEventStatus } from "@mediaops/shared-contracts";
import { AuditLogRepository } from "./auditLogRepository.js";

/**
 * Finalized statuses that trigger fast-pass ACK on redelivery.
 * retryable_failed is NOT finalized — it remains eligible for bounded retry.
 */
const FINALIZED_STATUSES: ReadonlySet<WebhookEventStatus> = new Set([
  "workflow_stub_created",
  "duplicate_ignored",
  "unrelated_ignored",
  "already_advanced_ignored",
  "state_changed_ignored",
  "unknown_status_ignored",
  "invalid_after_reload_ignored",
  "approval_version_mismatch_ignored",
  "channel_account_missing",
  "channel_account_inactive",
  "channel_account_unresolved",
  "failed"
]);

export interface FastPassResult {
  isFinalized: boolean;
  currentStatus: WebhookEventStatus | null;
  webhookEventId: string | null;
}

export interface VersionAllocationResult {
  approvedVersion: number;
  idempotencyKey: string;
  workflowRunId: string;
  duplicate: boolean;
}

export class WorkerRepository {
  /**
   * Fast-pass check: Query Ledger for event_id finalization status.
   * Runs outside a transaction for minimal overhead.
   */
  async fastPassCheck(
    client: pg.PoolClient,
    eventId: string
  ): Promise<FastPassResult> {
    const result = await client.query<{ id: string; status: WebhookEventStatus }>(
      `SELECT id, status FROM webhook_events WHERE event_id = $1 LIMIT 1`,
      [eventId]
    );

    if (result.rows.length === 0) {
      return { isFinalized: false, currentStatus: null, webhookEventId: null };
    }

    const row = result.rows[0];
    return {
      isFinalized: FINALIZED_STATUSES.has(row.status),
      currentStatus: row.status,
      webhookEventId: row.id
    };
  }

  /**
   * Transaction A: Mark event as processing, increment queue attempts, append audit.
   * Must be called within an active transaction.
   */
  async markProcessing(
    client: pg.PoolClient,
    eventId: string,
    messageId: string,
    workspaceId: string
  ): Promise<{ webhookEventId: string }> {
    // Mark event as processing
    const result = await client.query<{ id: string }>(
      `UPDATE webhook_events
       SET status = 'processing', processed_at = NOW()
       WHERE event_id = $1
       RETURNING id`,
      [eventId]
    );

    const webhookEventId = result.rows[0]?.id;
    if (!webhookEventId) {
      throw new Error(`webhook_events row not found for event_id=${eventId}`);
    }

    // Increment queue attempts
    await client.query(
      `UPDATE queue_events
       SET status = 'consumed', attempt_count = attempt_count + 1, last_attempt_at = NOW()
       WHERE message_id = $1`,
      [messageId]
    );

    // Audit trail
    const auditRepo = new AuditLogRepository();
    await auditRepo.insertAuditLog(client, {
      workspaceId,
      eventType: 'worker_consumed',
      entityType: 'webhook_event',
      entityId: webhookEventId,
      actorType: 'system',
      actorId: 'queue_worker'
    });

    return { webhookEventId };
  }

  /**
   * Write an ignored/terminal classification without version allocation.
   * Also marks queue_events as acked and appends audit log.
   */
  async markIgnored(
    client: pg.PoolClient,
    webhookEventId: string,
    status: WebhookEventStatus,
    messageId: string,
    workspaceId: string,
    errorCode?: string,
    errorMessage?: string
  ): Promise<void> {
    await client.query(
      `UPDATE webhook_events
       SET status = $2, error_code = $3, error_message = $4, processed_at = NOW()
       WHERE id = $1`,
      [webhookEventId, status, errorCode ?? null, errorMessage ?? null]
    );

    await client.query(
      `UPDATE queue_events SET status = 'acked', updated_at = NOW() WHERE message_id = $1`,
      [messageId]
    );

    const auditRepo = new AuditLogRepository();
    await auditRepo.insertAuditLog(client, {
      workspaceId,
      eventType: 'worker_acked',
      entityType: 'webhook_event',
      entityId: webhookEventId,
      actorType: 'system',
      actorId: 'queue_worker',
      metadata: { classified_as: status }
    });
  }

  /**
   * Record redelivery acknowledgment for already-finalized events.
   */
  async markRedeliveryAcked(
    client: pg.PoolClient,
    webhookEventId: string,
    messageId: string,
    workspaceId: string
  ): Promise<void> {
    await client.query(
      `UPDATE queue_events SET status = 'acked', updated_at = NOW() WHERE message_id = $1`,
      [messageId]
    );

    const auditRepo = new AuditLogRepository();
    await auditRepo.insertAuditLog(client, {
      workspaceId,
      eventType: 'worker_redelivery_acked',
      entityType: 'webhook_event',
      entityId: webhookEventId,
      actorType: 'system',
      actorId: 'queue_worker'
    });
  }

  /**
   * Write retryable_failed status for transient errors (429, 503, deadlock).
   */
  async markRetryableFailed(
    client: pg.PoolClient,
    webhookEventId: string,
    messageId: string,
    workspaceId: string,
    errorCode: string,
    errorMessage: string
  ): Promise<void> {
    await client.query(
      `UPDATE webhook_events
       SET status = 'retryable_failed', error_code = $2, error_message = $3, processed_at = NOW()
       WHERE id = $1`,
      [webhookEventId, errorCode, errorMessage]
    );

    await client.query(
      `UPDATE queue_events SET status = 'failed', updated_at = NOW() WHERE message_id = $1`,
      [messageId]
    );

    const auditRepo = new AuditLogRepository();
    await auditRepo.insertAuditLog(client, {
      workspaceId,
      eventType: 'worker_retryable_failed',
      entityType: 'webhook_event',
      entityId: webhookEventId,
      actorType: 'system',
      actorId: 'queue_worker',
      metadata: { error_code: errorCode }
    });
  }

  /**
   * Transaction B: Advisory lock, version allocation, workflow stub, and final ACK.
   * This is the critical path that creates the handoff for US-003.
   */
  async allocateVersionAndCreateWorkflow(
    client: pg.PoolClient,
    params: {
      workspaceId: string;
      recordRef: string;
      webhookEventId: string;
      messageId: string;
    }
  ): Promise<VersionAllocationResult> {
    // 1. Advisory lock on (workspace_id, record_ref) to prevent concurrent version allocation
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
      [params.workspaceId, params.recordRef]
    );

    // 2. Allocate approved_version
    const versionResult = await client.query<{ current_version: number }>(
      `INSERT INTO approval_versions (workspace_id, airtable_record_id, current_version)
       VALUES ($1, $2, 1)
       ON CONFLICT (workspace_id, airtable_record_id)
       DO UPDATE SET current_version = approval_versions.current_version + 1, updated_at = NOW()
       RETURNING current_version`,
      [params.workspaceId, params.recordRef]
    );

    const approvedVersion = versionResult.rows[0].current_version;
    const idempotencyKey = createWorkflowIdempotencyKey({
      workspaceId: params.workspaceId,
      airtableRecordId: params.recordRef,
      approvedVersion
    });
    const workflowRunId = randomUUID();

    // 3. Check for duplicate via idempotency key
    try {
      // 4. Update webhook_events
      await client.query(
        `UPDATE webhook_events
         SET status = 'workflow_stub_created', approved_version = $2, idempotency_key = $3, processed_at = NOW()
         WHERE id = $1`,
        [params.webhookEventId, approvedVersion, idempotencyKey]
      );

      // 5. Insert workflow_runs stub
      await client.query(
        `INSERT INTO workflow_runs (id, workspace_id, airtable_record_id, approved_version, idempotency_key, status, created_from_webhook_event_id)
         VALUES ($1, $2, $3, $4, $5, 'pending_ai_generation', $6)`,
        [workflowRunId, params.workspaceId, params.recordRef, approvedVersion, idempotencyKey, params.webhookEventId]
      );
    } catch (error: unknown) {
      // Handle unique constraint violation (duplicate)
      if (error instanceof Error && "code" in error && (error as { code: string }).code === "23505") {
        return { approvedVersion, idempotencyKey, workflowRunId, duplicate: true };
      }
      throw error;
    }

    // 6. Mark queue as acked
    await client.query(
      `UPDATE queue_events SET status = 'acked', updated_at = NOW() WHERE message_id = $1`,
      [params.messageId]
    );

    // 7. Audit log
    const auditRepo = new AuditLogRepository();
    await auditRepo.insertAuditLog(client, {
      workspaceId: params.workspaceId,
      eventType: 'worker_acked',
      entityType: 'webhook_event',
      entityId: params.webhookEventId,
      actorType: 'system',
      actorId: 'queue_worker',
      metadata: { approved_version: approvedVersion, idempotency_key: idempotencyKey }
    });

    return { approvedVersion, idempotencyKey, workflowRunId, duplicate: false };
  }
}
