import { z } from "zod";

const forbiddenPolicyQueueFields = [
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
  "bearer"
] as const;

export const PolicyEvaluateRequestedEventSchema = z
  .object({
    event_id: z.string().uuid(),
    event_type: z.literal("policy.evaluate.requested"),
    event_version: z.literal(1),
    workspace_id: z.string().min(1),
    correlation_id: z.string().min(1),
    workflow_run_id: z.string().uuid(),
    ai_generation_run_id: z.string().uuid(),
    content_variant_id: z.string().uuid(),
    airtable_record_id: z.string().min(1),
    platform: z.literal("facebook"),
    prompt_version: z.string().min(1),
    approved_version: z.number().int().positive(),
    idempotency_key: z.string().min(1),
    created_at: z.string().datetime()
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const field of forbiddenPolicyQueueFields) {
      if (Object.prototype.hasOwnProperty.call(value, field)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Forbidden policy queue field: ${field}`,
          path: [field]
        });
      }
    }
  });

export type PolicyEvaluateRequestedEvent = z.infer<typeof PolicyEvaluateRequestedEventSchema>;

export const PublishFacebookRequestedEventSchema = z
  .object({
    event_id: z.string().uuid(),
    event_type: z.literal("publish.facebook.requested"),
    event_version: z.literal(1),
    workspace_id: z.string().min(1),
    correlation_id: z.string().min(1),
    workflow_run_id: z.string().uuid(),
    job_id: z.string().uuid(),
    variant_id: z.string().uuid(),
    channel_account_id: z.string().min(1),
    scheduled_at: z.string().datetime(),
    idempotency_key: z.string().min(1),
    created_at: z.string().datetime()
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const field of forbiddenPolicyQueueFields) {
      if (Object.prototype.hasOwnProperty.call(value, field)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Forbidden publish queue field: ${field}`,
          path: [field]
        });
      }
    }
  });

export type PublishFacebookRequestedEvent = z.infer<typeof PublishFacebookRequestedEventSchema>;
