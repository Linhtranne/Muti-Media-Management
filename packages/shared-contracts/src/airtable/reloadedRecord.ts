import { z } from "zod";

export const AirtableChannelAccountStubSchema = z.object({
  id: z.string().min(1),
  fields: z.object({
    platform: z.string().min(1),
    display_name: z.string().min(1),
    status: z.string().min(1)
  })
});

export type AirtableChannelAccountStub = z.infer<typeof AirtableChannelAccountStubSchema>;

export const AirtablePostFieldsSchema = z.object({
  status: z.string().min(1).optional(),
  is_valid_for_approval: z.union([z.literal(0), z.literal(1)]).optional(),
  approved_at: z.string().datetime().optional().nullable(),
  master_copy: z.string().optional().nullable(),
  target_channels: z.array(z.string()).optional().nullable(),
  connected_channel_accounts: z.array(z.string()).optional().nullable(),
  scheduled_at: z.string().datetime().optional().nullable(),
  title: z.string().optional().nullable(),
  post_id: z.string().optional().nullable(),
  campaign_id: z.array(z.string()).optional().nullable(),
  cta_url: z.string().optional().nullable(),
  asset_links: z.union([z.string(), z.array(z.string())]).optional().nullable()
});

export type AirtablePostFields = z.infer<typeof AirtablePostFieldsSchema>;

export const AirtableReloadedRecordSchema = z.object({
  id: z.string().min(1),
  fields: AirtablePostFieldsSchema
});

export type AirtableReloadedRecord = z.infer<typeof AirtableReloadedRecordSchema>;

export const VALID_POST_STATUSES = [
  "Draft", "Review", "Approved", "Scheduled", "Published", "Failed"
] as const;

export type AirtablePostStatus = typeof VALID_POST_STATUSES[number];

export function isKnownPostStatus(status: string): status is AirtablePostStatus {
  return (VALID_POST_STATUSES as readonly string[]).includes(status);
}

export const AirtableAccountStubSchema = z.object({
  airtable_channel_account_record_id: z.string().min(1),
  platform: z.string().min(1),
  display_name: z.string().min(1),
  status: z.string().min(1)
});

export type AirtableAccountStub = z.infer<typeof AirtableAccountStubSchema>;
