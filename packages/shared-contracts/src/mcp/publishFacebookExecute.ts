import { z } from "zod";

export const PublishFacebookExecuteEventSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.literal('publish.facebook.execute'),
  eventVersion: z.string(),
  workspaceId: z.string().min(1),
  jobId: z.string().uuid(),
  variantId: z.string().uuid(),
  channelAccountId: z.string().min(1),
  scheduledAt: z.string().datetime(),
  idempotencyKey: z.string().min(1),
  correlationId: z.string().uuid(),
  createdAt: z.string().datetime()
}).strict();

// Ensure the schema explicitly rejects forbidden fields
export type PublishFacebookExecuteEvent = z.infer<typeof PublishFacebookExecuteEventSchema>;
