import { z } from "zod";

const COMMENT_AUTHOR_NAME_MAX_LENGTH = 255;

export const SyncCommentsInputSchema = z.object({
  postRef: z.object({
    jobId: z.string().uuid()
  }),
  channelAccountId: z.string().min(1),
  secretRef: z.string().min(1),
  externalPostId: z.string().min(1)
}).strict();

export type SyncCommentsInput = z.infer<typeof SyncCommentsInputSchema>;

export const CommentSyncErrorCodeSchema = z.enum([
  'PLATFORM_AUTH_FAILED',
  'PLATFORM_PERMISSION_DENIED',
  'PLATFORM_RATE_LIMIT',
  'PLATFORM_TRANSIENT_ERROR',
  'SECRET_UNAVAILABLE',
  'UNKNOWN_ERROR'
]);

export type CommentSyncErrorCode = z.infer<typeof CommentSyncErrorCodeSchema>;

export const CommentSyncErrorSchema = z.object({
  code: CommentSyncErrorCodeSchema,
  detail: z.string()
});

export type CommentSyncError = z.infer<typeof CommentSyncErrorSchema>;

export const SanitizedCommentSchema = z.object({
  externalId: z.string().min(1),
  authorName: z.string().max(COMMENT_AUTHOR_NAME_MAX_LENGTH),
  externalUserId: z.string().optional(),
  body: z.string(),
  permalink: z.string().url(),
  createdAtPlatform: z.string().datetime()
}).strict();

export type SanitizedComment = z.infer<typeof SanitizedCommentSchema>;

export const SyncCommentsResultSchema = z.object({
  passed: z.boolean(),
  comments: z.array(SanitizedCommentSchema).optional(),
  errors: z.array(CommentSyncErrorSchema).optional(),
}).strict().superRefine((value, ctx) => {
  const forbidden = ["access_token", "raw_response", "raw_payload"];
  for (const field of forbidden) {
    if (Object.hasOwn(value, field)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Forbidden field in result: ${field}`,
        path: [field]
      });
    }
  }
});

export type SyncCommentsResult = z.infer<typeof SyncCommentsResultSchema>;
