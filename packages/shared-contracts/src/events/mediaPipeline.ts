import { z } from "zod";
import { findForbiddenFields } from "./envelope.js";

export const MediaAssetStatusSchema = z.enum([
  "received",
  "downloading",
  "optimizing",
  "ready",
  "failed"
]);
export type MediaAssetStatus = z.infer<typeof MediaAssetStatusSchema>;

export const MediaAssetDerivativeKindSchema = z.enum([
  "optimized_original",
  "tiktok_video",
  "tiktok_photo",
  "facebook_image",
  "facebook_link_preview"
]);
export type MediaAssetDerivativeKind = z.infer<typeof MediaAssetDerivativeKindSchema>;

// Helper to refine event objects and block forbidden credential/sensitive fields.
function assertCleanPayload(value: Record<string, unknown>, ctx: z.RefinementCtx) {
  const violations = findForbiddenFields(value);
  for (const field of violations) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Forbidden queue field: ${field}`,
      path: field.split(".")
    });
  }
}

export const MediaAssetIngestRequestedEventSchema = z
  .object({
    event_id: z.string().uuid(),
    event_type: z.literal("media.asset.ingest.requested"),
    event_version: z.literal(1),
    workspace_id: z.string().min(1),
    post_id: z.string().min(1),
    airtable_record_id: z.string().min(1),
    content_variant_id: z.string().uuid().nullable(),
    idempotency_key: z.string().min(1),
    correlation_id: z.string().uuid(),
    causation_id: z.string().uuid().optional()
  })
  .strict()
  .superRefine((val, ctx) => { assertCleanPayload(val, ctx); });

export type MediaAssetIngestRequestedEvent = z.infer<
  typeof MediaAssetIngestRequestedEventSchema
>;

export const MediaAssetOptimizeRequestedEventSchema = z
  .object({
    event_id: z.string().uuid(),
    event_type: z.literal("media.asset.optimize.requested"),
    event_version: z.literal(1),
    workspace_id: z.string().min(1),
    media_asset_id: z.string().uuid(),
    post_id: z.string().min(1),
    idempotency_key: z.string().min(1),
    correlation_id: z.string().uuid(),
    causation_id: z.string().uuid().optional()
  })
  .strict()
  .superRefine((val, ctx) => { assertCleanPayload(val, ctx); });

export type MediaAssetOptimizeRequestedEvent = z.infer<
  typeof MediaAssetOptimizeRequestedEventSchema
>;
