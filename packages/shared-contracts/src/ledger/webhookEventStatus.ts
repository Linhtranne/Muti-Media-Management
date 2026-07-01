import { z } from "zod";

export const WebhookEventStatusSchema = z.enum([
  "received",
  "queued",
  "processing",
  "workflow_stub_created",
  "duplicate_ignored",
  "unrelated_ignored",
  "already_advanced_ignored",
  "state_changed_ignored",
  "unknown_status_ignored",
  "invalid_after_reload_ignored",
  "approval_version_mismatch_ignored",
  "channel_account_missing",
  "channel_account_inactive",
  "channel_account_unresolved",
  "retryable_failed",
  "failed"
]);

export type WebhookEventStatus = z.infer<typeof WebhookEventStatusSchema>;

