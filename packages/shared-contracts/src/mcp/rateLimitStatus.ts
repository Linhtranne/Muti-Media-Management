import { z } from "zod";

export const GetRateLimitStatusInputSchema = z.object({
  channelAccountId: z.string().min(1),
  secretRef: z.string().min(1)
}).strict();

export type GetRateLimitStatusInput = z.infer<typeof GetRateLimitStatusInputSchema>;

export const RateLimitStatusResultSchema = z.object({
  remainingToday: z.number().int().nonnegative(),
  limitToday: z.number().int().positive(),
  resetAt: z.string().datetime(),
  quotaExceeded: z.boolean()
}).strict();

export type RateLimitStatusResult = z.infer<typeof RateLimitStatusResultSchema>;
