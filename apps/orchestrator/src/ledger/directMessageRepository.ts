import type pg from "pg";
import { AuditLogRepository } from "./auditLogRepository.js";

export type ConversationPlatform = "facebook" | "instagram" | "zalo";
export type ConversationStatus = "new" | "assigned" | "waiting" | "resolved" | "escalated";
export type MessageDirection = "inbound" | "outbound";
export type MessageSenderType = "customer" | "agent" | "bot";
export type ReplyJobStatus = "received" | "queued" | "processing" | "succeeded" | "failed" | "rejected";

export interface Conversation {
  id: string;
  workspace_id: string;
  platform: ConversationPlatform;
  channel_account_id: string;
  external_thread_id: string;
  customer_ref: Record<string, unknown>;
  customer_display_name: string | null;
  status: ConversationStatus;
  assigned_to_member_id: string | null;
  assigned_slack_user_id: string | null;
  last_message_at: Date;
  sla_due_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface ConversationMessage {
  id: string;
  workspace_id: string;
  conversation_id: string;
  external_message_id: string;
  direction: MessageDirection;
  sender_type: MessageSenderType;
  body: string | null;
  body_redacted: string | null;
  attachments_ref: unknown[];
  created_at_platform: Date;
  created_at: Date;
}

export interface ReplyJob {
  id: string;
  workspace_id: string;
  conversation_id: string;
  message_id: string | null;
  actor_id: string;
  reply_body: string;
  status: ReplyJobStatus;
  idempotency_key: string;
  platform_result_ref: Record<string, unknown>;
  error_code: string | null;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
}

export class DirectMessageRepository {
  private auditLogRepo = new AuditLogRepository();

  /** Set session context for RLS policy check */
  async setWorkspaceContext(client: pg.PoolClient | pg.Pool, workspaceId: string): Promise<void> {
    await client.query(`SELECT set_config('app.current_workspace_id', $1, true)`, [workspaceId]);
  }

  /** Upsert conversation */
  async upsertConversation(
    client: pg.PoolClient,
    workspaceId: string,
    data: {
      platform: ConversationPlatform;
      channelAccountId: string;
      externalThreadId: string;
      customerRef: Record<string, unknown>;
      customerDisplayName: string | null;
      status?: ConversationStatus;
      assignedToMemberId?: string | null;
      assignedSlackUserId?: string | null;
      lastMessageAt?: Date;
      slaDueAt?: Date | null;
    }
  ): Promise<Conversation> {
    const result = await client.query<Conversation>(
      `INSERT INTO conversations (
        workspace_id, platform, channel_account_id, external_thread_id,
        customer_ref, customer_display_name, status, assigned_to_member_id,
        assigned_slack_user_id, last_message_at, sla_due_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, COALESCE($7, 'new'::text), $8, $9, COALESCE($10, NOW()), $11, NOW()
      )
      ON CONFLICT (workspace_id, platform, external_thread_id) DO UPDATE SET
        customer_ref = EXCLUDED.customer_ref,
        customer_display_name = COALESCE(EXCLUDED.customer_display_name, conversations.customer_display_name),
        last_message_at = EXCLUDED.last_message_at,
        status = CASE WHEN EXCLUDED.status IS NOT NULL THEN EXCLUDED.status ELSE conversations.status END,
        assigned_to_member_id = CASE WHEN EXCLUDED.assigned_to_member_id IS NOT NULL THEN EXCLUDED.assigned_to_member_id ELSE conversations.assigned_to_member_id END,
        assigned_slack_user_id = CASE WHEN EXCLUDED.assigned_slack_user_id IS NOT NULL THEN EXCLUDED.assigned_slack_user_id ELSE conversations.assigned_slack_user_id END,
        sla_due_at = CASE WHEN EXCLUDED.sla_due_at IS NOT NULL THEN EXCLUDED.sla_due_at ELSE conversations.sla_due_at END,
        updated_at = NOW()
      RETURNING *`,
      [
        workspaceId,
        data.platform,
        data.channelAccountId,
        data.externalThreadId,
        data.customerRef,
        data.customerDisplayName,
        data.status || null,
        data.assignedToMemberId || null,
        data.assignedSlackUserId || null,
        data.lastMessageAt || null,
        data.slaDueAt || null
      ]
    );
    return result.rows[0];
  }

  /** Find conversation by ID */
  async getConversationById(
    client: pg.PoolClient,
    workspaceId: string,
    conversationId: string
  ): Promise<Conversation | null> {
    const result = await client.query<Conversation>(
      `SELECT * FROM conversations WHERE workspace_id = $1 AND id = $2 LIMIT 1`,
      [workspaceId, conversationId]
    );
    return result.rows[0] || null;
  }

  /** Find conversation by external ID */
  async getConversationByExternalId(
    client: pg.PoolClient,
    workspaceId: string,
    platform: ConversationPlatform,
    externalThreadId: string
  ): Promise<Conversation | null> {
    const result = await client.query<Conversation>(
      `SELECT * FROM conversations WHERE workspace_id = $1 AND platform = $2 AND external_thread_id = $3 LIMIT 1`,
      [workspaceId, platform, externalThreadId]
    );
    return result.rows[0] || null;
  }

  /** Update conversation status */
  async updateConversationStatus(
    client: pg.PoolClient,
    workspaceId: string,
    conversationId: string,
    status: ConversationStatus
  ): Promise<void> {
    await client.query(
      `UPDATE conversations 
       SET status = $3, updated_at = NOW() 
       WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, conversationId, status]
    );
  }

  /** Insert message idempotently */
  async insertMessageIdempotently(
    client: pg.PoolClient,
    workspaceId: string,
    data: {
      conversationId: string;
      externalMessageId: string;
      direction: MessageDirection;
      senderType: MessageSenderType;
      body: string | null;
      bodyRedacted: string | null;
      attachmentsRef: unknown[];
      createdAtPlatform: Date;
    }
  ): Promise<ConversationMessage | null> {
    const result = await client.query<ConversationMessage>(
      `INSERT INTO conversation_messages (
        workspace_id, conversation_id, external_message_id, direction,
        sender_type, body, body_redacted, attachments_ref, created_at_platform, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW()
      )
      ON CONFLICT (workspace_id, conversation_id, external_message_id) DO NOTHING
      RETURNING *`,
      [
        workspaceId,
        data.conversationId,
        data.externalMessageId,
        data.direction,
        data.senderType,
        data.body,
        data.bodyRedacted,
        JSON.stringify(data.attachmentsRef),
        data.createdAtPlatform
      ]
    );
    return result.rows[0] || null;
  }

  /** Create reply job idempotently */
  async createReplyJobIdempotently(
    client: pg.PoolClient,
    workspaceId: string,
    data: {
      conversationId: string;
      actorId: string;
      replyBody: string;
      idempotencyKey: string;
    }
  ): Promise<ReplyJob | null> {
    const result = await client.query<ReplyJob>(
      `INSERT INTO direct_message_reply_jobs (
        workspace_id, conversation_id, actor_id, reply_body, status, idempotency_key, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, 'received', $5, NOW(), NOW()
      )
      ON CONFLICT (workspace_id, idempotency_key) DO NOTHING
      RETURNING *`,
      [
        workspaceId,
        data.conversationId,
        data.actorId,
        data.replyBody,
        data.idempotencyKey
      ]
    );
    return result.rows[0] || null;
  }

  /** Find reply job by idempotency key */
  async getReplyJobByIdempotencyKey(
    client: pg.PoolClient,
    workspaceId: string,
    idempotencyKey: string
  ): Promise<ReplyJob | null> {
    const result = await client.query<ReplyJob>(
      `SELECT * FROM direct_message_reply_jobs WHERE workspace_id = $1 AND idempotency_key = $2 LIMIT 1`,
      [workspaceId, idempotencyKey]
    );
    return result.rows[0] || null;
  }

  /** Claim reply job — Bug #3 fix: accept 'received' or 'queued' status */
  async claimReplyJob(
    client: pg.PoolClient,
    workspaceId: string,
    jobId: string
  ): Promise<ReplyJob | null> {
    const result = await client.query<ReplyJob>(
      `UPDATE direct_message_reply_jobs
       SET status = 'processing', updated_at = NOW()
       WHERE workspace_id = $1 AND id = $2 AND status IN ('received', 'queued')
       RETURNING *`,
      [workspaceId, jobId]
    );
    return result.rows[0] || null;
  }

  /** Find reply job by ID (for status check after failed claim) */
  async getReplyJobById(
    client: pg.PoolClient,
    workspaceId: string,
    jobId: string
  ): Promise<ReplyJob | null> {
    const result = await client.query<ReplyJob>(
      `SELECT * FROM direct_message_reply_jobs WHERE workspace_id = $1 AND id = $2 LIMIT 1`,
      [workspaceId, jobId]
    );
    return result.rows[0] || null;
  }

  /** Mark reply job succeeded — Bug #4 fix: message_id is nullable when insert conflicted */
  async markReplyJobSucceeded(
    client: pg.PoolClient,
    workspaceId: string,
    jobId: string,
    messageId: string | null,
    platformResultRef: Record<string, unknown>
  ): Promise<void> {
    await client.query(
      `UPDATE direct_message_reply_jobs
       SET status = 'succeeded', message_id = $3, platform_result_ref = $4, updated_at = NOW()
       WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, jobId, messageId, platformResultRef]
    );
  }

  /** Get conversation message by external ID — Bug #4: for conflict resolution */
  async getMessageByExternalId(
    client: pg.PoolClient,
    workspaceId: string,
    conversationId: string,
    externalMessageId: string
  ): Promise<ConversationMessage | null> {
    const result = await client.query<ConversationMessage>(
      `SELECT * FROM conversation_messages
       WHERE workspace_id = $1 AND conversation_id = $2 AND external_message_id = $3 LIMIT 1`,
      [workspaceId, conversationId, externalMessageId]
    );
    return result.rows[0] || null;
  }

  /** Mark reply job failed */
  async markReplyJobFailed(
    client: pg.PoolClient,
    workspaceId: string,
    jobId: string,
    errorCode: string,
    errorMessage: string
  ): Promise<void> {
    await client.query(
      `UPDATE direct_message_reply_jobs
       SET status = 'failed', error_code = $3, error_message = $4, updated_at = NOW()
       WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, jobId, errorCode, errorMessage]
    );
  }

  /** Validate workspace member exist */
  async validateWorkspaceMember(
    client: pg.PoolClient,
    memberId: string,
    workspaceId: string
  ): Promise<boolean> {
    const result = await client.query(
      `SELECT id FROM workspace_members WHERE id = $1 AND workspace_id = $2 LIMIT 1`,
      [memberId, workspaceId]
    );
    return result.rows.length > 0;
  }

  /** Look up member ID and Role by Slack user ID */
  async getWorkspaceMemberBySlackUser(
    client: pg.PoolClient,
    workspaceId: string,
    slackUserId: string
  ): Promise<{ id: string; role: string } | null> {
    const result = await client.query<{ id: string; role: string }>(
      `SELECT id, role FROM workspace_members WHERE workspace_id = $1 AND slack_user_id = $2 LIMIT 1`,
      [workspaceId, slackUserId]
    );
    return result.rows[0] || null;
  }

  /** Write structured audit log */
  async insertAuditLog(
    client: pg.PoolClient | pg.Pool,
    input: {
      workspaceId: string;
      eventType: string;
      entityId: string;
      metadata: Record<string, unknown>;
      correlationId: string;
      actorId?: string;
    }
  ): Promise<void> {
    await this.auditLogRepo.insertAuditLog(client, {
      workspaceId: input.workspaceId,
      eventType: input.eventType,
      entityType: "direct_message",
      entityId: input.entityId,
      actorType: input.actorId ? "user" : "system",
      actorId: input.actorId || "system",
      metadata: input.metadata,
      correlationId: input.correlationId
    });
  }
}
