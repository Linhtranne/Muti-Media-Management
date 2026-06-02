import { z } from "zod";

const forbiddenPayloadFields = [
  "access_token",
  "secret_ref",
  "raw_payload",
  "large_content",
  "raw_graph_response"
] as const;

export const CommentSyncRequestedEventSchema = z.object({
  event_id:             z.string().uuid(),
  event_type:           z.literal('comments.facebook.sync.requested'),
  event_version:        z.literal(1),
  workspace_id:         z.string().min(1),
  job_id:               z.string().uuid(),
  channel_account_id:   z.string().min(1),
  external_post_id:     z.string().min(1),
  idempotency_key:      z.string().min(1),
  correlation_id:       z.string().uuid(),
  created_at:           z.string().datetime(),
}).strict().superRefine((value, ctx) => {
  for (const field of forbiddenPayloadFields) {
    if (Object.hasOwn(value as any, field)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Forbidden queue field: ${field}`,
        path: [field]
      });
    }
  }
});

export type CommentSyncRequestedEvent = z.infer<typeof CommentSyncRequestedEventSchema>;

export const CommentIngestEventSchema = z.object({
  event_id:               z.string().uuid(),
  event_type:             z.literal('comments.facebook.ingest'),
  event_version:          z.literal(1),
  workspace_id:           z.string().min(1),
  job_id:                 z.string().uuid(),
  external_post_id:       z.string().min(1),
  external_comment_id:    z.string().min(1),
  author_ref:             z.object({
                            name:             z.string().max(255),
                            external_user_id: z.string().optional()
                          }),
  comment_preview:        z.string().max(80),
  permalink:              z.string().url(),
  created_at_platform:    z.string().datetime(),
  correlation_id:         z.string().uuid(),
  causation_id:           z.string().uuid(),
  created_at:             z.string().datetime(),
}).strict().superRefine((value, ctx) => {
  for (const field of forbiddenPayloadFields) {
    if (Object.hasOwn(value as any, field)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Forbidden queue field: ${field}`,
        path: [field]
      });
    }
  }
  
  if (Object.hasOwn(value as any, "body")) {
     ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Forbidden queue field: body`,
        path: ["body"]
      });
  }
});

export type CommentIngestEvent = z.infer<typeof CommentIngestEventSchema>;
