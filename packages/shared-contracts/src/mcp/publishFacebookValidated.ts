import { z } from "zod";

const forbiddenPublishValidatedQueueFields = [
  "master_copy",
  "body",
  "hashtags",
  "cta_url",
  "asset_links",
  "prompt",
  "output",
  "access_token",
  "refresh_token",
  "secret_ref",
  "api_key",
  "token",
  "bearer",
  "validationDetail"
] as const;

export const PublishFacebookValidatedEventSchema = z
  .object({
    event_id: z.string().uuid(),
    event_type: z.literal("publish.facebook.validated"),
    event_version: z.literal(1),
    workspace_id: z.string().min(1),
    correlation_id: z.string().min(1),
    workflow_run_id: z.string().uuid(),
    job_id: z.string().uuid(),
    variant_id: z.string().uuid(),
    channel_account_id: z.string().min(1),
    scheduled_at: z.string().datetime(),
    idempotency_key: z.string().min(1),
    validated_at: z.string().datetime(),
    created_at: z.string().datetime()
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const field of forbiddenPublishValidatedQueueFields) {
      if (Object.prototype.hasOwnProperty.call(value, field)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Forbidden publish validated queue field: ${field}`,
          path: [field]
        });
      }
    }
  });

export type PublishFacebookValidatedEvent = z.infer<typeof PublishFacebookValidatedEventSchema>;
