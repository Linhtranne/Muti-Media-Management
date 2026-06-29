import crypto from "node:crypto";
import type { Request, Response, Router } from "express";
import express from "express";
import type pg from "pg";
import type { SlackSignatureVerifier } from "../services/slackSignatureVerifier.js";
import type { SlackCommandParser, ParsedSlackCommand, ParseError } from "../services/slackCommandParser.js";
import type { SlackCommandRepository } from "../ledger/slackCommandRepository.js";
import type { CommentActionRepository } from "../ledger/commentActionRepository.js";
import type { DirectMessageRepository } from "../ledger/directMessageRepository.js";
import type { QueuePublisher } from "../queue/rabbitmqPublisher.js";
import type { Logger } from "../lib/logger.js";
import type { Database } from "../ledger/postgres.js";
import type { SlackCommandActionEvent, SlackCommentActionEvent, DirectMessageReplyRequestedEvent } from "@mediaops/shared-contracts";

const SLACK_COMMAND_RESPONSES = {
  disabled: "Slack commands are currently disabled for this workspace.",
  verificationFailed: "Command verification failed. Please try again.",
  duplicateCommand: "This command has already been processed.",
  approveRejectUnauthorized: "You are not authorized to approve or reject posts.",
  commentUnauthorized: "You are not authorized to reply or escalate.",
  dmMemberMissing: "Slack user is not a member of this workspace.",
  dmReplyUnauthorized: "You are not authorized to reply to direct messages.",
  dmConversationNotFound: "Conversation not found.",
  duplicateDmReply: "This reply request has already been processed.",
  dmReplyQueued: "Processing your request..."
};
const SLACK_COMMAND_FAILURE_MESSAGES = {
  userNotAuthorized: "User not authorized",
  failedToEnqueueAction: "Failed to enqueue action",
  rabbitMqPublishingFailed: "RabbitMQ publishing failed"
};

type SlackRouteTxResult =
  | { type: "duplicate" | "invalid" | "unauthorized"; text: string }
  | { type: "success_approve_reject"; publishEvent: SlackCommandActionEvent; eventId: string }
  | { type: "success_comment_action"; publishEvent: SlackCommentActionEvent; eventId: string }
  | { type: "success_dm_reply"; publishEvent: DirectMessageReplyRequestedEvent; jobId: string };

interface SlackCommandRequestContext {
  workspaceId: string;
  command: string;
  text: string;
  slackUserId: string;
  slackTeamId: string;
  idempotencyKey: string;
  correlationId: string;
  parsed: ParsedSlackCommand | ParseError;
}

interface SlackCommandHandlerContext {
  repository: SlackCommandRepository;
  commentActionRepository: CommentActionRepository;
  logger: Logger;
}

export interface SlackCommandsRouterDependencies {
  verifier: SlackSignatureVerifier;
  parser: SlackCommandParser;
  repository: SlackCommandRepository;
  commentActionRepository: CommentActionRepository;
  directMessageRepository: DirectMessageRepository;
  publisher: QueuePublisher;
  database: Database;
  logger: Logger;
  workspaceId: string;
  slackCommandsEnabled: boolean;
}

export function createSlackCommandsRouter(deps: SlackCommandsRouterDependencies): Router {
  const {
    verifier,
    parser,
    repository,
    commentActionRepository,
    directMessageRepository,
    database,
    logger,
    workspaceId,
    slackCommandsEnabled
  } = deps;
  const router = express.Router();

  // Use raw body parser only for this route so we can verify the signature
  router.post(
    "/slack/commands",
    express.raw({ type: "application/x-www-form-urlencoded" }),
    (req: Request, res: Response) => {
      void (async () => {
      if (!slackCommandsEnabled) {
        res.status(200).send(SLACK_COMMAND_RESPONSES.disabled);
        return;
      }

      const rawBody: Buffer<ArrayBuffer> = req.body instanceof Buffer ? Buffer.from(req.body) : Buffer.from("");
      const signatureHeader = req.headers["x-slack-signature"];
      const timestampHeader = req.headers["x-slack-request-timestamp"];

      const correlationId = crypto.randomUUID();

      // 1. Verify Signature
      const verification = verifier.verify(rawBody, signatureHeader, timestampHeader);
      if (!verification.valid) {
        logger.warn("Slack command signature verification failed", {
          errorCode: verification.errorCode,
          correlationId
        });

        // Audit the rejection asynchronously
        database.transaction(workspaceId, async (client) => {
          await repository.insertAuditLog(client, {
            workspaceId,
            eventType: "SLACK_SIGNATURE_REJECTED",
            entityType: "slack_command",
            entityId: "unknown",
            actorId: null,
            metadata: { reason: verification.message },
            correlationId
          });
        }).catch((err) => { logger.error("Failed to audit slack signature rejection", { error: String(err) }); });

        res.status(200).send(SLACK_COMMAND_RESPONSES.verificationFailed);
        return;
      }

      // 2. Parse body manually since we used raw middleware
      const bodyString = rawBody.toString("utf8");
      const parsedBody = new URLSearchParams(bodyString);
      const command = parsedBody.get("command") || "";
      const text = parsedBody.get("text") || "";
      const slackUserId = parsedBody.get("user_id") || "";
      const slackTeamId = parsedBody.get("team_id") || "";

      // 3. Parse command arguments
      const parsed = parser.parse(command, text);
      if (parsed.error) {
        res.status(200).send(parsed.message);
        return;
      }

      // We need an idempotency key to prevent double processing
      const requestTs = Array.isArray(timestampHeader) ? timestampHeader[0] : timestampHeader || "";
      const idempotencyKey = crypto
        .createHash("sha256")
        .update(`${workspaceId}:${slackUserId}:${command}:${text}:${requestTs}`)
        .digest("hex");

      // Slack requires acknowledgement within 3 seconds. Persist and enqueue
      // asynchronously after returning the immediate acknowledgement.
      res.status(200).send(SLACK_COMMAND_RESPONSES.dmReplyQueued);

      try {
        const txResult = await database.transaction(workspaceId, async (client): Promise<SlackRouteTxResult> => {
          const requestContext: SlackCommandRequestContext = {
            workspaceId,
            command,
            text,
            slackUserId,
            slackTeamId,
            idempotencyKey,
            correlationId,
            parsed
          };
          const handlerContext: SlackCommandHandlerContext = {
            repository,
            commentActionRepository,
            logger
          };

          if (command === "/approve_post" || command === "/reject_post") {
            return handleApproveRejectCommand(client, requestContext, handlerContext);

          } else if (command === "/reply_comment" || command === "/escalate") {
            return handleCommentActionCommand(client, requestContext, handlerContext);

          } else if (command === "/reply_dm") {
            return handleDirectMessageReplyCommand(client, requestContext, directMessageRepository);

          } else {
            return { type: "invalid", text: "Unknown command." };
          }
        });

        if (txResult.type === "success_approve_reject") {
          void publishApproveRejectAction(txResult, deps, correlationId, slackUserId);
        } else if (txResult.type === "success_comment_action") {
          void publishCommentAction(txResult, deps, correlationId, slackUserId);
        } else if (txResult.type === "success_dm_reply") {
          void publishDmReplyAction(txResult, deps, correlationId);
        } else {
          logger.info("Slack command completed without enqueue", {
            correlationId,
            resultType: txResult.type,
            resultText: txResult.text
          });
        }

      } catch (error) {
        logger.error("Slack command processing failed", {
          error: error instanceof Error ? error.message : String(error),
          correlationId
        });
      }
      })();
    }
  );

  return router;
}

async function publishApproveRejectAction(
  txResult: Extract<SlackRouteTxResult, { type: "success_approve_reject" }>,
  deps: SlackCommandsRouterDependencies,
  correlationId: string,
  slackUserId: string
) {
  const { publisher, database, repository, logger, workspaceId } = deps;
  try {
    await publisher.publishSlackCommandAction(txResult.publishEvent, txResult.publishEvent.event_id);
  } catch (pubErr) {
    logger.error("Failed to publish slack command action to RabbitMQ", { error: String(pubErr), correlationId });
    try {
      await database.transaction(workspaceId, async (client) => {
        await repository.updateEventStatus(client, txResult.eventId, "failed", "PUBLISH_FAILED", "Failed to enqueue action");
        await repository.insertAuditLog(client, {
          workspaceId,
          eventType: "SLACK_COMMAND_PUBLISH_FAILED",
          entityType: "slack_command",
          entityId: txResult.eventId,
          actorId: slackUserId,
          metadata: { error: String(pubErr) },
          correlationId
        });
      });
    } catch (dbErr) {
      logger.error("Failed to mark slack command as failed after publish error", { error: String(dbErr), correlationId });
    }
  }
}

async function publishCommentAction(
  txResult: Extract<SlackRouteTxResult, { type: "success_comment_action" }>,
  deps: SlackCommandsRouterDependencies,
  correlationId: string,
  slackUserId: string
) {
  const { publisher, database, commentActionRepository, logger, workspaceId } = deps;
  try {
    await publisher.publishSlackCommentAction(txResult.publishEvent, txResult.publishEvent.event_id);
  } catch (pubErr) {
    logger.error("Failed to publish comment action to RabbitMQ", { error: String(pubErr), correlationId });
    try {
      await database.transaction(workspaceId, async (client) => {
        await commentActionRepository.updateEventStatus(client, txResult.eventId, "failed", "PUBLISH_FAILED", "Failed to enqueue action");
        await commentActionRepository.insertAuditLog(client, {
          workspaceId,
          eventType: "SLACK_COMMENT_PUBLISH_FAILED",
          entityType: "slack_comment_action",
          entityId: txResult.eventId,
          actorId: slackUserId,
          metadata: { error: String(pubErr) },
          correlationId
        });
      });
    } catch (dbErr) {
      logger.error("Failed to mark comment action as failed after publish error", { error: String(dbErr), correlationId });
    }
  }
}

async function handleApproveRejectCommand(
  client: pg.PoolClient,
  request: SlackCommandRequestContext,
  handlers: SlackCommandHandlerContext
): Promise<SlackRouteTxResult> {
  const { repository, logger } = handlers;
  const {
    workspaceId,
    command,
    text,
    slackUserId,
    slackTeamId,
    idempotencyKey,
    correlationId,
    parsed
  } = request;

  const existing = await repository.getEventByIdempotencyKey(client, workspaceId, idempotencyKey);
  if (existing) {
    logger.info("Slack command duplicate retry ignored", { correlationId, idempotencyKey });
    return { type: "duplicate", text: SLACK_COMMAND_RESPONSES.duplicateCommand };
  }

  const parsedPost = parsed as Extract<ParsedSlackCommand, { action: "approve" | "reject" }> | ParseError;
  const actionForSchema = parsedPost.error ? "approve" : parsedPost.action;
  const targetPostIdForSchema = parsedPost.error ? "unknown" : parsedPost.postId;
  const rejectReasonForSchema = parsedPost.error ? "" : (parsedPost.reason ?? "");
  const parsedCommandPayload = actionForSchema === "approve"
    ? { error: false as const, action: "approve" as const, postId: targetPostIdForSchema, reason: null }
    : { error: false as const, action: "reject" as const, postId: targetPostIdForSchema, reason: rejectReasonForSchema };

  const event = await repository.insertReceivedEvent(client, {
    workspaceId,
    slackUserId,
    slackTeamId,
    rawCommand: command,
    args: text,
    parsed: parsedCommandPayload,
    idempotencyKey,
    correlationId,
    verified: true
  });

  if (parsedPost.error) {
    await repository.updateEventStatus(client, event.id, "rejected", parsedPost.errorCode, parsedPost.message);
    return { type: "invalid", text: parsedPost.message };
  }

  const role = await repository.getWorkspaceRole(client, workspaceId, slackUserId);
  if (!role || (role !== "manager" && role !== "admin")) {
    await repository.updateEventStatus(client, event.id, "rejected", "UNAUTHORIZED_ROLE", SLACK_COMMAND_FAILURE_MESSAGES.userNotAuthorized, role);
    return { type: "unauthorized", text: SLACK_COMMAND_RESPONSES.approveRejectUnauthorized };
  }

  await repository.updateEventStatus(client, event.id, "queued", null, null, role);

  return {
    type: "success_approve_reject",
    publishEvent: {
      event_id: crypto.randomUUID(),
      event_type: "slack.post_approval.requested",
      event_version: 1,
      workspace_id: workspaceId,
      command_event_id: event.id,
      action: parsedPost.action,
      target_post_id: parsedPost.postId,
      idempotency_key: idempotencyKey,
      correlation_id: correlationId,
      created_at: new Date().toISOString()
    },
    eventId: event.id
  };
}

async function handleCommentActionCommand(
  client: pg.PoolClient,
  request: SlackCommandRequestContext,
  handlers: SlackCommandHandlerContext
): Promise<SlackRouteTxResult> {
  const { commentActionRepository, logger } = handlers;
  const {
    workspaceId,
    command,
    slackUserId,
    slackTeamId,
    idempotencyKey,
    correlationId,
    parsed
  } = request;

  const existing = await commentActionRepository.getEventByIdempotencyKey(client, workspaceId, idempotencyKey);
  if (existing) {
    logger.info("Slack command duplicate retry ignored", { correlationId, idempotencyKey });
    return { type: "duplicate", text: SLACK_COMMAND_RESPONSES.duplicateCommand };
  }

  const parsedComment = parsed as Extract<ParsedSlackCommand, { action: "reply" | "escalate" }> | ParseError;
  const actionForSchema = parsedComment.error ? "reply" : parsedComment.action;
  const interactionIdForSchema = parsedComment.error ? "00000000-0000-0000-0000-000000000000" : parsedComment.interactionId;
  const eventMessage = !parsedComment.error && parsedComment.action === "reply" ? parsedComment.message : null;
  const eventReason = !parsedComment.error && parsedComment.action === "escalate" ? parsedComment.reason : null;

  const event = await commentActionRepository.insertReceivedEvent(client, {
    workspaceId,
    interactionId: interactionIdForSchema,
    slackUserId,
    slackTeamId,
    command,
    action: actionForSchema,
    message: eventMessage,
    reason: eventReason,
    idempotencyKey,
    correlationId
  });

  if (parsedComment.error) {
    await commentActionRepository.updateEventStatus(client, event.id, "rejected", parsedComment.errorCode, parsedComment.message);
    return { type: "invalid", text: parsedComment.message };
  }

  const role = await commentActionRepository.getWorkspaceRole(client, workspaceId, slackUserId);
  if (!role || (role !== "manager" && role !== "admin" && role !== "support")) {
    await commentActionRepository.updateEventStatus(client, event.id, "rejected", "UNAUTHORIZED_ROLE", SLACK_COMMAND_FAILURE_MESSAGES.userNotAuthorized, role);
    return { type: "unauthorized", text: SLACK_COMMAND_RESPONSES.commentUnauthorized };
  }

  await commentActionRepository.updateEventStatus(client, event.id, "queued", null, null, role);

  return {
    type: "success_comment_action",
    publishEvent: {
      event_id: crypto.randomUUID(),
      event_type: "slack.comment_action.requested",
      event_version: 1,
      workspace_id: workspaceId,
      action_event_id: event.id,
      action: parsedComment.action,
      idempotency_key: idempotencyKey,
      correlation_id: correlationId,
      created_at: new Date().toISOString()
    },
    eventId: event.id
  };
}

async function publishDmReplyAction(
  txResult: Extract<SlackRouteTxResult, { type: "success_dm_reply" }>,
  deps: SlackCommandsRouterDependencies,
  correlationId: string
) {
  const { publisher, database, directMessageRepository, logger, workspaceId } = deps;
  try {
    await publisher.publishDirectMessageReplyRequested(txResult.publishEvent, txResult.publishEvent.event_id);
    await database.transaction(workspaceId, async (client) => {
      await client.query(
        `UPDATE direct_message_reply_jobs SET status = 'queued', updated_at = NOW() WHERE id = $1`,
        [txResult.jobId]
      );
    });
  } catch (pubErr) {
    logger.error("Failed to publish DM reply requested event to RabbitMQ", { error: String(pubErr), correlationId });
    try {
      await database.transaction(workspaceId, async (client) => {
        await directMessageRepository.markReplyJobFailed(
          client,
          workspaceId,
          txResult.jobId,
          "PUBLISH_FAILED",
          SLACK_COMMAND_FAILURE_MESSAGES.failedToEnqueueAction
        );
        await directMessageRepository.insertAuditLog(client, {
          workspaceId,
          eventType: "DM_REPLY_FAILED",
          entityId: txResult.jobId,
          metadata: { error: String(pubErr), reason: SLACK_COMMAND_FAILURE_MESSAGES.rabbitMqPublishingFailed },
          correlationId
        });
      });
    } catch (dbErr) {
      logger.error("Failed to mark DM reply job as failed after publish error", { error: String(dbErr), correlationId });
    }
  }
}

async function handleDirectMessageReplyCommand(
  client: pg.PoolClient,
  request: SlackCommandRequestContext,
  directMessageRepository: DirectMessageRepository
): Promise<SlackRouteTxResult> {
  const {
    workspaceId,
    slackUserId,
    idempotencyKey,
    correlationId,
    parsed
  } = request;

  if (parsed.error) {
    return { type: "invalid", text: parsed.message };
  }

  const parsedDm = parsed as Extract<ParsedSlackCommand, { action: "reply_dm" }>;

  // 1. Resolve Slack user in workspace_members
  const member = await directMessageRepository.getWorkspaceMemberBySlackUser(client, workspaceId, slackUserId);
  if (!member) {
    return { type: "unauthorized", text: SLACK_COMMAND_RESPONSES.dmMemberMissing };
  }

  // 2. Validate member role: support/manager/admin allowed, creator/viewer blocked
  if (member.role !== "support" && member.role !== "manager" && member.role !== "admin") {
    return { type: "unauthorized", text: SLACK_COMMAND_RESPONSES.dmReplyUnauthorized };
  }

  // 3. Find the conversation by ID
  const conversation = await directMessageRepository.getConversationById(client, workspaceId, parsedDm.conversationId);
  if (!conversation) {
    return { type: "invalid", text: SLACK_COMMAND_RESPONSES.dmConversationNotFound };
  }

  // 4. Create reply job idempotently
  const job = await directMessageRepository.createReplyJobIdempotently(client, workspaceId, {
    conversationId: conversation.id,
    actorId: member.id,
    replyBody: parsedDm.message,
    idempotencyKey: idempotencyKey
  });

  if (!job) {
    return { type: "duplicate", text: SLACK_COMMAND_RESPONSES.duplicateDmReply };
  }

  // 5. Audit DM_REPLY_QUEUED
  await directMessageRepository.insertAuditLog(client, {
    workspaceId,
    eventType: "DM_REPLY_QUEUED",
    entityId: job.id,
    metadata: { conversationId: conversation.id, actorId: member.id },
    correlationId
  });

  return {
    type: "success_dm_reply",
    publishEvent: {
      event_id: crypto.randomUUID(),
      event_type: "dm.reply.requested",
      event_version: 1,
      workspace_id: workspaceId,
      idempotency_key: idempotencyKey,
      correlation_id: correlationId,
      created_at: new Date().toISOString(),
      payload: {
        reply_job_id: job.id,
        actor_id: member.id
      }
    },
    jobId: job.id
  };
}
