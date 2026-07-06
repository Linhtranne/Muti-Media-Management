import { z } from "zod";

const FORBIDDEN_FIELDS = [
  "token",
  "access_token",
  "refresh_token",
  "secret",
  "secret_ref",
  "api_key",
  "authorization",
  "bearer",
  "raw_response",
  "raw_payload",
  "raw_body",
  "raw_graph_response",
  "large_content",
  "body",
  "hashtags",
  "cta_url",
  "asset_links",
  "prompt",
  "output",
  "validationDetail"
] as const;

function checkForbiddenFields(value: Record<string, unknown>, ctx: z.RefinementCtx) {
  for (const field of FORBIDDEN_FIELDS) {
    if (Object.hasOwn(value, field)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Forbidden event field: ${field}`,
        path: [field]
      });
    }
  }
}

export const PublishTiktokRequestedEventSchema = z
  .object({
    event_id: z.string().uuid(),
    event_type: z.literal("publish.tiktok.requested"),
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
  .superRefine(checkForbiddenFields);

export const PublishTiktokValidatedEventSchema = z
  .object({
    event_id: z.string().uuid(),
    event_type: z.literal("publish.tiktok.validated"),
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
  .superRefine(checkForbiddenFields);

export const PublishTiktokExecuteEventSchema = z
  .object({
    event_id: z.string().uuid(),
    event_type: z.literal("publish.tiktok.execute"),
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
  .superRefine(checkForbiddenFields);

export const PublishTiktokStatusCheckEventSchema = z
  .object({
    event_id: z.string().uuid(),
    event_type: z.literal("publish.tiktok.status_check"),
    event_version: z.literal(1),
    workspace_id: z.string().min(1),
    correlation_id: z.string().min(1),
    workflow_run_id: z.string().uuid(),
    job_id: z.string().uuid(),
    variant_id: z.string().uuid(),
    channel_account_id: z.string().min(1),
    scheduled_at: z.string().datetime(),
    idempotency_key: z.string().min(1),
    tiktok_request_id: z.string().min(1),
    check_attempt_count: z.number().int().nonnegative(),
    created_at: z.string().datetime()
  })
  .strict()
  .superRefine(checkForbiddenFields);

export type PublishTiktokRequestedEvent = z.infer<typeof PublishTiktokRequestedEventSchema>;
export type PublishTiktokValidatedEvent = z.infer<typeof PublishTiktokValidatedEventSchema>;
export type PublishTiktokExecuteEvent = z.infer<typeof PublishTiktokExecuteEventSchema>;
export type PublishTiktokStatusCheckEvent = z.infer<typeof PublishTiktokStatusCheckEventSchema>;
