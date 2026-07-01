import { z } from "zod";

export const ValidatePostInputSchema = z.object({
  variantRef: z.object({
    variantId: z.string().uuid(),
    bodyLength: z.number().int().nonnegative(),
    hashtagCount: z.number().int().nonnegative(),
    hasMedia: z.boolean(),
    ctaUrl: z.string().optional()
  }),
  channelAccountId: z.string().min(1),
  secretRef: z.string().min(1)
}).strict();

export type ValidatePostInput = z.infer<typeof ValidatePostInputSchema>;

export const McpViolationCodeSchema = z.enum([
  'PLATFORM_TEXT_TOO_LONG',
  'PLATFORM_LINK_INVALID',
  'PLATFORM_MEDIA_UNSUPPORTED',
  'PLATFORM_PERMISSION_MISSING',
  'PLATFORM_TOKEN_INVALID',
  'PLATFORM_TOKEN_EXPIRED',
  'QUOTA_EXCEEDED'
]);

export type McpViolationCode = z.infer<typeof McpViolationCodeSchema>;

export const McpWarningCodeSchema = z.enum([
  'LINK_PREVIEW_UNAVAILABLE',
  'HASHTAG_COUNT_HIGH',
  'CTA_URL_REDIRECT'
]);

export type McpWarningCode = z.infer<typeof McpWarningCodeSchema>;

export const McpValidationViolationSchema = z.object({
  code: McpViolationCodeSchema,
  detail: z.string()
});

export type McpValidationViolation = z.infer<typeof McpValidationViolationSchema>;

export const McpValidationWarningSchema = z.object({
  code: McpWarningCodeSchema,
  detail: z.string()
});

export type McpValidationWarning = z.infer<typeof McpValidationWarningSchema>;

export const ValidatePostResultSchema = z.object({
  passed: z.boolean(),
  violations: z.array(McpValidationViolationSchema),
  warnings: z.array(McpValidationWarningSchema),
  checkedAt: z.string().datetime()
}).strict();

export type ValidatePostResult = z.infer<typeof ValidatePostResultSchema>;
