import type pg from "pg";
import { AuditLogRepository } from "./auditLogRepository.js";

export type CommentActionEventStatus = "received" | "queued" | "processing" | "succeeded" | "rejected" | "failed";

export interface CommentActionEvent {
  id: string;
  workspace_id: string;
  interaction_id: string;
  slack_user_id: string;
  slack_team_id: string;
  command: string;
  action: "reply" | "escalate";
  message: string | null;
  reason: string | null;
  status: CommentActionEventStatus;
  role: string | null;
  external_reply_id: string | null;
  idempotency_key: string;
  correlation_id: string;
  error_code: string | null;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface Interaction {
  id: string;
  workspace_id: string;
  platform: string;
  external_id: string;
  external_post_id: string | null;
  status: string;
  permalink: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface InsertCommentActionEventInput {
  workspaceId: string;
  interactionId: string;
  slackUserId: string;
  slackTeamId: string;
  command: string;
  action: "reply" | "escalate";
  message: string | null;
  reason: string | null;
  idempotencyKey: string;
  correlationId: string;
}

export interface InsertCommentAuditLogInput {
  workspaceId: string;
  eventType: string;
  entityType: string;
  entityId: string;
  actorId: string | null;
  metadata: Record<string, unknown>;
  correlationId: string;
}

export class CommentActionRepository {
  async getEventByIdempotencyKey(
    client: pg.PoolClient,
    workspaceId: string,
    idempotencyKey: string
  ): Promise<CommentActionEvent | null> {
    const result = await client.query<CommentActionEvent>(
      `SELECT * FROM comment_action_events WHERE workspace_id = $1 AND idempotency_key = $2 LIMIT 1`,
      [workspaceId, idempotencyKey]
    );
    return result.rows[0] || null;
  }

  async insertReceivedEvent(
    client: pg.PoolClient,
    input: InsertCommentActionEventInput
  ): Promise<CommentActionEvent> {
    const result = await client.query<CommentActionEvent>(
      `INSERT INTO comment_action_events (
        workspace_id, interaction_id, slack_user_id, slack_team_id, command, action, message, reason, status, idempotency_key, correlation_id
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, 'received', $9, $10
      ) RETURNING *`,
      [
        input.workspaceId,
        input.interactionId,
        input.slackUserId,
        input.slackTeamId,
        input.command,
        input.action,
        input.message,
        input.reason,
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
    status: CommentActionEventStatus,
    errorCode: string | null = null,
    errorMessage: string | null = null,
    role: string | null = null,
    externalReplyId: string | null = null
  ): Promise<void> {
    await client.query(
      `UPDATE comment_action_events 
       SET status = $2, 
           error_code = COALESCE($3, error_code), 
           error_message = COALESCE($4, error_message), 
           role = COALESCE($5, role), 
           external_reply_id = COALESCE($6, external_reply_id),
           updated_at = NOW() 
       WHERE id = $1`,
      [eventId, status, errorCode, errorMessage, role, externalReplyId]
    );
  }

  async getEventById(
    client: pg.PoolClient,
    workspaceId: string,
    eventId: string
  ): Promise<CommentActionEvent | null> {
    const result = await client.query<CommentActionEvent>(
      `SELECT * FROM comment_action_events WHERE workspace_id = $1 AND id = $2 LIMIT 1`,
      [workspaceId, eventId]
    );
    return result.rows[0] || null;
  }

  async getInteractionById(
    client: pg.PoolClient,
    workspaceId: string,
    interactionId: string
  ): Promise<Interaction | null> {
    const result = await client.query<Interaction>(
      `SELECT * FROM interactions WHERE workspace_id = $1 AND id = $2 LIMIT 1`,
      [workspaceId, interactionId]
    );
    return result.rows[0] || null;
  }

  async updateInteractionStatus(
    client: pg.PoolClient,
    workspaceId: string,
    interactionId: string,
    status: string
  ): Promise<void> {
    await client.query(
      `UPDATE interactions 
       SET status = $3, 
           updated_at = NOW(), 
           resolved_at = CASE WHEN $3 = 'resolved' THEN COALESCE(resolved_at, NOW()) ELSE resolved_at END 
       WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, interactionId, status]
    );
  }

  async insertAuditLog(
    client: pg.PoolClient,
    input: InsertCommentAuditLogInput
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

  async resolveFacebookChannelAccountForInteraction(
    client: pg.PoolClient,
    workspaceId: string,
    interactionId: string
  ): Promise<string | null> {
    // Attempt 1: Join via publish_jobs if available
    const jobRes = await client.query<{ channel_account_id: string }>(
      `SELECT pj.channel_account_id 
       FROM interactions i
       JOIN publish_jobs pj ON i.publish_job_id = pj.id
       WHERE i.id = $1 AND i.workspace_id = $2 AND i.platform = 'facebook'`,
      [interactionId, workspaceId]
    );
    if (jobRes.rows.length > 0 && jobRes.rows[0].channel_account_id) {
      return jobRes.rows[0].channel_account_id;
    }

    // Attempt 2: Extract page_id from external_post_id (e.g. "pageId_postId")
    const extRes = await client.query<{ external_post_id: string }>(
      `SELECT external_post_id FROM interactions WHERE id = $1 AND workspace_id = $2 AND platform = 'facebook'`,
      [interactionId, workspaceId]
    );
    
    if (extRes.rows.length > 0 && extRes.rows[0].external_post_id) {
      const parts = extRes.rows[0].external_post_id.split('_');
      if (parts.length > 1) {
        const pageId = parts[0];
        const accountRes = await client.query<{ id: string }>(
          `SELECT id FROM channel_accounts 
           WHERE workspace_id = $1 AND platform = 'facebook' AND external_account_id = $2 AND status = 'active' LIMIT 1`,
          [workspaceId, pageId]
        );
        if (accountRes.rows.length > 0) {
          return accountRes.rows[0].id;
        }
      }
    }

    return null;
  }
}
