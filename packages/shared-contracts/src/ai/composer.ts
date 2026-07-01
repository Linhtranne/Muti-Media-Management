import { z } from "zod";

const NOTION_CONTEXT_ERROR_MESSAGE_MAX_LENGTH = 255;

export const AiGenerationStatusSchema = z.enum([
  "queued",
  "processing",
  "completed",
  "needs_manual_review",
  "retryable_failed",
  "failed"
]);

export type AiGenerationStatus = z.infer<typeof AiGenerationStatusSchema>;

export const AiErrorCodeSchema = z.enum([
  "PROVIDER_RATE_LIMIT",
  "PROVIDER_TIMEOUT",
  "CONTEXT_UNREACHABLE",
  "SCHEMA_PARSING_FAILED",
  "INTENT_DRIFT",
  "CTA_UTM_MUTATED",
  "CTA_URL_INVALID",
  "CTA_URL_MISSING",
  "PROMPT_INJECTION_DETECTED",
  "INVALID_MODEL_CONFIG",
  "AIRTABLE_CONTEXT_UNREACHABLE",
  "AIRTABLE_CONTEXT_INVALID",
  "STALE_SOURCE_STATUS_CHANGED",
  "NOTION_NOT_ALLOWLISTED",
  "NOTION_NOT_AI_READY"
]);

export type AiErrorCode = z.infer<typeof AiErrorCodeSchema>;

export const NotionContextRefSchema = z.object({
  notion_page_id: z.string().optional(),
  notion_brief_url: z.string().url().optional(),
  load_status: z.enum(["success", "failed", "fallback"]),
  ai_ready: z.boolean(),
  error_code: AiErrorCodeSchema.optional(),
  error_message: z.string().max(NOTION_CONTEXT_ERROR_MESSAGE_MAX_LENGTH).optional(),
  fallback_source: z.string().optional()
}).strict();

export type NotionContextRef = z.infer<typeof NotionContextRefSchema>;


export const StructuredComposerOutputSchema = z.object({
  body: z.string(),
  hashtags: z.array(z.string()),
  cta_url: z.string().optional()
});

export type StructuredComposerOutput = z.infer<typeof StructuredComposerOutputSchema>;

export const ContentVariantSchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.string(),
  ai_generation_run_id: z.string().uuid(),
  workflow_run_id: z.string().uuid(),
  airtable_record_id: z.string(),
  post_id: z.string(),
  platform: z.literal("facebook"),
  body: z.string(),
  hashtags: z.array(z.string()),
  cta_url: z.string().nullable(),
  approval_status: z.literal("needs_review"),
  policy_status: z.literal("pending_policy"),
  sync_retry_needed: z.boolean(),
  created_at: z.string().datetime()
});

export type ContentVariant = z.infer<typeof ContentVariantSchema>;

export const AiGenerationRunSchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.string(),
  workflow_run_id: z.string().uuid(),
  airtable_record_id: z.string(),
  approved_version: z.number().int().positive(),
  platform: z.literal("facebook"),
  idempotency_key: z.string(),
  provider: z.string(),
  model: z.string(),
  prompt_version: z.string(),
  input_snapshot: z.record(z.any()),
  notion_context_refs: z.array(NotionContextRefSchema),
  output_snapshot: z.union([
    StructuredComposerOutputSchema,
    z.object({
      rawOutputHash: z.string(),
      sanitizedFailure: z.literal(true),
      errorCode: AiErrorCodeSchema
    })
  ]).nullable(),
  status: AiGenerationStatusSchema,
  error_code: AiErrorCodeSchema.nullable(),
  error_message: z.string().nullable(),
  created_at: z.string().datetime(),
  completed_at: z.string().datetime().nullable()
});

export type AiGenerationRun = z.infer<typeof AiGenerationRunSchema>;

export const PolicyHandoffEventSchema = z.object({
  event_id: z.string().uuid(),
  event_type: z.literal("policy.evaluate.requested"),
  event_version: z.literal(1),
  workspace_id: z.string(),
  correlation_id: z.string(),
  workflow_run_id: z.string().uuid(),
  ai_generation_run_id: z.string().uuid(),
  content_variant_id: z.string().uuid(),
  airtable_record_id: z.string(),
  platform: z.literal("facebook"),
  prompt_version: z.string(),
  approved_version: z.number().int().positive(),
  idempotency_key: z.string(),
  metadata: z.record(z.any())
});

export type PolicyHandoffEvent = z.infer<typeof PolicyHandoffEventSchema>;

const forbiddenAiQueueFields = [
  "master_copy",
  "cta_url",
  "asset_links",
  "prompt",
  "system_prompt",
  "user_prompt",
  "output",
  "body",
  "hashtags",
  "access_token",
  "refresh_token",
  "secret_ref",
  "api_key",
  "token"
] as const;

export const AiComposerQueueMessageSchema = z
  .object({
    event_id: z.string().min(1),
    event_type: z.literal("ai.compose.facebook.requested"),
    event_version: z.literal(1),
    source: z.literal("orchestrator.workflow_runs"),
    workspace_id: z.string().min(1),
    workflow_run_id: z.string().min(1),
    prompt_version: z.string().min(1),
    idempotency_key: z.string().min(1),
    correlation_id: z.string().min(1),
    causation_id: z.string().min(1)
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const field of forbiddenAiQueueFields) {
      if (Object.hasOwn(value, field)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Forbidden AI queue field: ${field}`,
          path: [field]
        });
      }
    }
  });

export type AiComposerQueueMessage = z.infer<typeof AiComposerQueueMessageSchema>;

export function createAiIdempotencyKey(input: {
  workspaceId: string;
  workflowRunId: string;
  promptVersion: string;
}): string {
  return `ai.compose.facebook:${input.workspaceId}:${input.workflowRunId}:${input.promptVersion}`;
}
