import { z } from "zod";

const REPLY_COMMENT_MESSAGE_MAX_LENGTH = 2000;

export const ReplyCommentInputSchema = z.object({
  external_comment_id: z.string().min(1).describe("The external ID of the comment to reply to (e.g. Facebook comment ID)"),
  message: z.string().min(1).max(REPLY_COMMENT_MESSAGE_MAX_LENGTH).describe("The reply message content"),
  channelAccountId: z.string().min(1),
}).strict();

export type ReplyCommentInput = z.infer<typeof ReplyCommentInputSchema>;

export const ReplyCommentResultSchema = z.object({
  success: z.boolean(),
  external_reply_id: z.string().optional(),
  error: z.string().optional(),
}).strict();

export type ReplyCommentResult = z.infer<typeof ReplyCommentResultSchema>;
