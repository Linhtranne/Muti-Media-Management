import type pg from "pg";
import type { ParsedSlackCommand } from "../services/slackCommandParser.js";
import { AuditLogRepository } from "./auditLogRepository.js";

export type SlackCommandEventStatus = "received" | "queued" | "succeeded" | "rejected" | "failed" | "duplicate_ignored";

export interface SlackCommandEvent {
  id: string;
  workspace_id: string;
  slack_user_id: string;
  slack_team_id: string;
  command: string;
  action: "approve" | "reject";
  args: string;
  target_post_id: string;
  reason: string | null;
  verified: boolean;
  role: string | null;
  status: SlackCommandEventStatus;
  idempotency_key: string;
  correlation_id: string;
  error_code: string | null;
  error_message: string | null;
}

export interface InsertSlackCommandEventInput {
  workspaceId: string;
  slackUserId: string;
  slackTeamId: string;
  rawCommand: string;
  args: string;
  parsed: Extract<ParsedSlackCommand, { action: "approve" | "reject" }>;
  idempotencyKey: string;
  correlationId: string;
  verified: boolean;
}

export interface InsertSlackAuditLogInput {
  workspaceId: string;
  eventType: string;
  entityType: string;
  entityId: string;
  actorId: string | null;
  metadata: Record<string, unknown>;
  correlationId: string;
}

export class SlackCommandRepository {
  async getEventByIdempotencyKey(
    client: pg.PoolClient,
    workspaceId: string,
    idempotencyKey: string
  ): Promise<SlackCommandEvent | null> {
    const result = await client.query<SlackCommandEvent>(
      `SELECT * FROM slack_command_events WHERE workspace_id = $1 AND idempotency_key = $2 LIMIT 1`,
      [workspaceId, idempotencyKey]
    );
    return result.rows[0] || null;
  }

  async insertReceivedEvent(
    client: pg.PoolClient,
    input: InsertSlackCommandEventInput
  ): Promise<SlackCommandEvent> {
    const result = await client.query<SlackCommandEvent>(
      `INSERT INTO slack_command_events (
        workspace_id, slack_user_id, slack_team_id, command, action, args, target_post_id, reason, verified, status, idempotency_key, correlation_id
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, 'received', $10, $11
      ) RETURNING *`,
      [
        input.workspaceId,
        input.slackUserId,
        input.slackTeamId,
        input.rawCommand,
        input.parsed.action,
        input.args,
        input.parsed.postId,
        input.parsed.reason,
        input.verified,
        input.idempotencyKey,
        input.correlationId
      ]
    );
    return result.rows[0];
  }

  async getWorkspaceRole(
    client: pg.PoolClient,
    workspaceId: string,
    slackUserId: string
  ): Promise<string | null> {
    const result = await client.query<{ role: string }>(
      `SELECT role FROM workspace_members WHERE workspace_id = $1 AND slack_user_id = $2 LIMIT 1`,
      [workspaceId, slackUserId]
    );
    return result.rows[0]?.role || null;
  }

  async updateEventStatus(
    client: pg.PoolClient,
    eventId: string,
    status: SlackCommandEventStatus,
    errorCode: string | null = null,
    errorMessage: string | null = null,
    role: string | null = null
  ): Promise<void> {
    await client.query(
      `UPDATE slack_command_events 
       SET status = $2, error_code = COALESCE($3, error_code), error_message = COALESCE($4, error_message), role = COALESCE($5, role), updated_at = NOW() 
       WHERE id = $1`,
      [eventId, status, errorCode, errorMessage, role]
    );
  }

  async insertAuditLog(
    client: pg.PoolClient,
    input: InsertSlackAuditLogInput
  ): Promise<void> {
    const auditRepo = new AuditLogRepository();
    await auditRepo.insertAuditLog(client, {
      workspaceId: input.workspaceId,
      eventType: input.eventType,
      entityType: input.entityType,
      entityId: input.entityId,
      actorId: input.actorId,
      metadata: input.metadata,
      correlationId: input.correlationId
    });
  }

  async markAirtableSyncRetryNeeded(
    client: pg.PoolClient,
    eventId: string
  ): Promise<void> {
    await client.query(
      `UPDATE slack_command_events SET airtable_sync_retry_needed = true, updated_at = NOW() WHERE id = $1`,
      [eventId]
    );
  }

  async getEventById(
    client: pg.PoolClient,
    workspaceId: string,
    eventId: string
  ): Promise<SlackCommandEvent | null> {
    const result = await client.query<SlackCommandEvent>(
      `SELECT * FROM slack_command_events WHERE workspace_id = $1 AND id = $2 LIMIT 1`,
      [workspaceId, eventId]
    );
    return result.rows[0] || null;
  }
}
