import { z } from "zod";

export const SlackCommandActionEventSchema = z.object({
  event_id: z.string().uuid(),
  event_type: z.literal("slack.post_approval.requested"),
  event_version: z.number().int().default(1),
  workspace_id: z.string().min(1),
  command_event_id: z.string().uuid(),
  action: z.enum(["approve", "reject"]),
  target_post_id: z.string().min(1),
  idempotency_key: z.string().min(1),
  correlation_id: z.string().min(1),
  created_at: z.string().datetime(),
}).strict();

export type SlackCommandActionEvent = z.infer<typeof SlackCommandActionEventSchema>;

export const SlackCommentActionEventSchema = z.object({
  event_id: z.string().uuid(),
  event_type: z.literal("slack.comment_action.requested"),
  event_version: z.number().int().default(1),
  workspace_id: z.string().min(1),
  action_event_id: z.string().uuid(),
  action: z.enum(["reply", "escalate"]),
  idempotency_key: z.string().min(1),
  correlation_id: z.string().min(1),
  created_at: z.string().datetime(),
}).strict();

export type SlackCommentActionEvent = z.infer<typeof SlackCommentActionEventSchema>;
