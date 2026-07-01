import { z } from "zod";

export const SafeChannelAccountRefSchema = z
  .object({
    platform: z.literal("Facebook"),
    channel_account_id: z.string().min(1),
    airtable_channel_account_record_id: z.string().min(1),
    external_account_id: z.string().min(1).optional(),
    token_status: z.enum(["valid", "expired", "missing", "unknown"]).optional()
  })
  .strict();

export type SafeChannelAccountRef = z.infer<typeof SafeChannelAccountRefSchema>;

