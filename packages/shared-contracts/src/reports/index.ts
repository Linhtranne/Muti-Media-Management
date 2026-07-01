import { z } from "zod";

export const CampaignReportQuerySchema = z.object({
  campaign_id: z.string().optional(),
  date_from: z.string().datetime().optional(),
  date_to: z.string().datetime().optional(),
  channel_account_id: z.string().optional()
}).strict();

export const CampaignReportRowSchema = z.object({
  campaign_id: z.string().nullable(),
  posts_published: z.number().int().min(0),
  publish_failed: z.number().int().min(0),
  comments_total: z.number().int().min(0),
  risk_comments: z.number().int().min(0),
  avg_response_time: z.number().nullable(), // Nullable since there might not be any resolved comments
  last_updated_at: z.string().datetime().nullable()
}).strict();

export const CampaignReportResponseSchema = z.object({
  data: z.array(CampaignReportRowSchema)
}).strict();

export type CampaignReportQuery = z.infer<typeof CampaignReportQuerySchema>;
export type CampaignReportRow = z.infer<typeof CampaignReportRowSchema>;
export type CampaignReportResponse = z.infer<typeof CampaignReportResponseSchema>;
