import { z } from "zod";

const forbiddenIngressFields = [
  "master_copy",
  "cta_url",
  "asset_links",
  "access_token",
  "refresh_token",
  "secret_ref",
  "api_key",
  "token"
] as const;

export const AirtableApprovedWebhookSchema = z
  .object({
    event_id: z.string().min(1),
    record_id: z.string().min(1),
    table_name: z.literal("Posts"),
    change_type: z.literal("update"),
    approved_at: z.string().datetime()
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const field of forbiddenIngressFields) {
      if (Object.prototype.hasOwnProperty.call(value, field)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Forbidden webhook field: ${field}`,
          path: [field]
        });
      }
    }
  });

export type AirtableApprovedWebhook = z.infer<typeof AirtableApprovedWebhookSchema>;

export const AirtableApprovedQueueMessageSchema = z
  .object({
    event_id: z.string().min(1),
    event_type: z.literal("airtable.post.approved.ingress"),
    event_version: z.literal(1),
    source: z.literal("airtable.webhook_receiver"),
    workspace_id: z.string().min(1),
    record_ref: z.string().min(1),
    approval_ref: z.string().datetime(),
    idempotency_key: z.string().min(1),
    correlation_id: z.string().min(1),
    causation_id: z.string().min(1)
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const field of [...forbiddenIngressFields, "approved_version"]) {
      if (Object.prototype.hasOwnProperty.call(value, field)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Forbidden queue field: ${field}`,
          path: [field]
        });
      }
    }
  });

export type AirtableApprovedQueueMessage = z.infer<typeof AirtableApprovedQueueMessageSchema>;

export function createIngressIdempotencyKey(eventId: string): string {
  return `airtable.webhook.ingress:${eventId}`;
}

export function createWorkflowIdempotencyKey(input: {
  workspaceId: string;
  airtableRecordId: string;
  approvedVersion: number;
}): string {
  return `airtable.post.approved:${input.workspaceId}:${input.airtableRecordId}:${input.approvedVersion}`;
}

