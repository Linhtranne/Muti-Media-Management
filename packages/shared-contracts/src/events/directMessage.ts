import { z } from "zod";
import { findForbiddenFields, isForbiddenKey } from "./envelope.js";

const DM_BODY_PREVIEW_MAX_LENGTH = 80;

// ============================================================================
// CONVERSATION STATUS SCHEMA
// ============================================================================
export const ConversationStatusSchema = z.enum([
  "new",
  "assigned",
  "waiting",
  "resolved",
  "escalated"
]);

export type ConversationStatus = z.infer<typeof ConversationStatusSchema>;

// Helper to refine and block forbidden fields recursively
function refineForbiddenFields<T extends z.ZodTypeAny>(schema: T) {
  return schema.superRefine((value, ctx) => {
    // Check top-level
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      for (const key of Object.keys(record)) {
        if (isForbiddenKey(key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Forbidden field: ${key}`,
            path: [key]
          });
        }
      }
    }
    // Check recursively
    const violations = findForbiddenFields(value);
    for (const fieldPath of violations) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Forbidden field in payload/object: ${fieldPath}`,
        path: fieldPath.split(".")
      });
    }
  });
}

// ============================================================================
// EVENT SCHEMAS
// ============================================================================

export const DirectMessageIngestEventSchema = refineForbiddenFields(
  z.object({
    event_id: z.string().uuid(),
    event_type: z.enum(["dm.facebook.ingest", "dm.instagram.ingest", "dm.zalo.ingest"]),
    event_version: z.literal(1),
    workspace_id: z.string().min(1),
    idempotency_key: z.string().min(1),
    correlation_id: z.string().uuid(),
    causation_id: z.string().uuid().optional(),
    created_at: z.string().datetime(),
    payload: z.object({
      platform: z.enum(["facebook", "instagram", "zalo"]),
      channel_account_id: z.string().uuid(),
      external_thread_id: z.string().min(1),
      external_message_id: z.string().min(1),
      customer_ref: z.object({
        name: z.string().min(1),
        external_user_id: z.string().optional()
      }),
      body_preview: z.string().max(DM_BODY_PREVIEW_MAX_LENGTH),
      created_at_platform: z.string().datetime(),
      has_attachments: z.boolean()
    }).strict()
  }).strict()
);

export interface DirectMessageIngestEvent {
  event_id: string;
  event_type: "dm.facebook.ingest" | "dm.instagram.ingest" | "dm.zalo.ingest";
  event_version: 1;
  workspace_id: string;
  idempotency_key: string;
  correlation_id: string;
  causation_id?: string;
  created_at: string;
  payload: {
    platform: "facebook" | "instagram" | "zalo";
    channel_account_id: string;
    external_thread_id: string;
    external_message_id: string;
    customer_ref: {
      name: string;
      external_user_id?: string;
    };
    body_preview: string;
    created_at_platform: string;
    has_attachments: boolean;
  };
}

export const DirectMessageReplyRequestedEventSchema = refineForbiddenFields(
  z.object({
    event_id: z.string().uuid(),
    event_type: z.literal("dm.reply.requested"),
    event_version: z.literal(1),
    workspace_id: z.string().min(1),
    idempotency_key: z.string().min(1),
    correlation_id: z.string().uuid(),
    causation_id: z.string().uuid().optional(),
    created_at: z.string().datetime(),
    payload: z.object({
      reply_job_id: z.string().uuid(),
      actor_id: z.string().uuid()
    }).strict()
  }).strict()
);

export interface DirectMessageReplyRequestedEvent {
  event_id: string;
  event_type: "dm.reply.requested";
  event_version: 1;
  workspace_id: string;
  idempotency_key: string;
  correlation_id: string;
  causation_id?: string;
  created_at: string;
  payload: {
    reply_job_id: string;
    actor_id: string;
  };
}

// ============================================================================
// MCP TOOL SCHEMAS
// These are NOT queue events — they are internal MCP tool call contracts.
// secret_ref is an opaque DB pointer (not a raw secret), so forbidden field
// validation is NOT applied here. Queue event schemas above enforce the policy.
// ============================================================================

export const GetDirectMessageInputSchema = z.object({
  channel_account_id: z.string().uuid(),
  external_thread_id: z.string().min(1),
  external_message_id: z.string().min(1),
  secret_ref: z.string().min(1)
}).strict();

export interface GetDirectMessageInput {
  channel_account_id: string;
  external_thread_id: string;
  external_message_id: string;
  secret_ref: string;
}

export const GetDirectMessageResultSchema = refineForbiddenFields(
  z.object({
    body: z.string(),
    body_redacted: z.string(),
    attachments_ref: z.array(
      z.object({
        type: z.string(),
        url_ref: z.string(),
        id: z.string().optional()
      }).strict()
    ),
    sender_metadata: z.object({
      name: z.string(),
      external_user_id: z.string().optional()
    }).strict(),
    created_at_platform: z.string().datetime()
  }).strict()
);

export interface GetDirectMessageResult {
  body: string;
  body_redacted: string;
  attachments_ref: Array<{
    type: string;
    url_ref: string;
    id?: string;
  }>;
  sender_metadata: {
    name: string;
    external_user_id?: string;
  };
  created_at_platform: string;
}

export const SendDirectMessageInputSchema = z.object({
  channel_account_id: z.string().uuid(),
  external_thread_id: z.string().min(1),
  reply_body: z.string().min(1),
  idempotency_key: z.string().min(1),
  secret_ref: z.string().min(1)
}).strict();

export interface SendDirectMessageInput {
  channel_account_id: string;
  external_thread_id: string;
  reply_body: string;
  idempotency_key: string;
  secret_ref: string;
}

export const SendDirectMessageResultSchema = refineForbiddenFields(
  z.object({
    success: z.boolean(),
    external_message_id: z.string().optional(),
    error: z.string().optional()
  }).strict()
);

export interface SendDirectMessageResult {
  success: boolean;
  external_message_id?: string;
  error?: string;
}
