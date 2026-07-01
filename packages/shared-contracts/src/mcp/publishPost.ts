import { z } from "zod";

export const PublishPostInputSchema = z.object({
  jobRef: z.object({
    jobId: z.string().uuid()
  }),
  channelAccountId: z.string().min(1),
  secretRef: z.string().min(1),
  content: z.object({
    body: z.string(),
    hashtags: z.array(z.string()).optional(),
    link: z.string().url().optional()
  })
}).strict();

export type PublishPostInput = z.infer<typeof PublishPostInputSchema>;

export const McpPublishErrorCodeSchema = z.enum([
  'PLATFORM_AUTH_FAILED',
  'PLATFORM_PERMISSION_DENIED',
  'PLATFORM_RATE_LIMIT',
  'PLATFORM_VALIDATION_ERROR',
  'PLATFORM_TRANSIENT_ERROR',
  'SECRET_UNAVAILABLE',
  'UNKNOWN_ERROR'
]);

export type McpPublishErrorCode = z.infer<typeof McpPublishErrorCodeSchema>;

export const McpPublishErrorSchema = z.object({
  code: McpPublishErrorCodeSchema,
  detail: z.string()
});

export type McpPublishError = z.infer<typeof McpPublishErrorSchema>;

export const McpPublishWarningSchema = z.object({
  code: z.string(),
  detail: z.string()
});

export type McpPublishWarning = z.infer<typeof McpPublishWarningSchema>;

export const PublishPostResultSchema = z.object({
  passed: z.boolean(),
  externalPostId: z.string().optional(),
  platformResponseSummary: z.record(z.any()).optional(),
  errors: z.array(McpPublishErrorSchema).optional(),
  warnings: z.array(McpPublishWarningSchema).optional(),
  publishedAt: z.string().datetime().optional()
}).strict();

export type PublishPostResult = z.infer<typeof PublishPostResultSchema>;
