import "dotenv/config";
import { z } from "zod";

const DEFAULT_HTTP_PORT = 3000;

const AirtableFieldMapSchema = z.object({
  variant_draft: z.string().default("facebook_body"),
  variant_hashtags: z.string().default("facebook_hashtags"),
  variant_cta_url: z.string().default("facebook_cta_url"),
  ai_generation_status: z.string().default("ai_generation_status"),
  ai_review_notes: z.string().default("ai_review_notes"),
  ledger_variant_id: z.string().default("ledger_variant_id")
}).partial().transform((value) => ({
  variant_draft: value.variant_draft ?? "facebook_body",
  variant_hashtags: value.variant_hashtags ?? "facebook_hashtags",
  variant_cta_url: value.variant_cta_url ?? "facebook_cta_url",
  ai_generation_status: value.ai_generation_status ?? "ai_generation_status",
  ai_review_notes: value.ai_review_notes ?? "ai_review_notes",
  ledger_variant_id: value.ledger_variant_id ?? "ledger_variant_id"
}));

const DEFAULT_AIRTABLE_FIELD_MAP = AirtableFieldMapSchema.parse({});

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(DEFAULT_HTTP_PORT),
  WORKSPACE_ID: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  RABBITMQ_URL: z.string().min(1),
  AIRTABLE_API_KEY: z.string().min(1),
  AIRTABLE_BASE_ID: z.string().min(1),
  AIRTABLE_WEBHOOK_SECRET: z.string().min(1).optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-2.5-pro"),
  AUTO_PUBLISH_ENABLED: z.enum(["true", "false"]).default("false"),
  AUTO_APPROVE_ENABLED: z.enum(["true", "false"]).default("false"),
  POLICY_UTM_WARN_ONLY: z.enum(["true", "false"]).default("true"),
  POLICY_FORBIDDEN_TERMS: z.string().optional(),
  POLICY_BLOCK_SLACK_CHANNEL_ID: z.string().optional(),
  VALIDATE_FAIL_SLACK_CHANNEL_ID: z.string().optional(),
  PUBLISH_SUCCESS_SLACK_CHANNEL_ID: z.string().optional(),
  SLACK_INBOX_CHANNEL_ID: z.string().optional(),
  SLACK_CRISIS_CHANNEL_ID: z.string().optional(),
  COMMENT_RISK_KEYWORDS: z.string().optional(),
  COMMENT_SYNC_SCHEDULER_ENABLED: z.enum(["true", "false"]).default("false"),
  US006_EXECUTION_ENABLED: z.enum(["true", "false"]).default("false"),
  DM_INBOX_ENABLED: z.enum(["true", "false"]).default("false"),
  DM_SLA_HOURS: z.coerce.number().int().positive().default(2),
  SLACK_SIGNING_SECRET: z.string().optional(),
  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_COMMANDS_ENABLED: z.enum(["true", "false"]).default("true"),
  SLACK_COMMAND_MAX_REASON_LENGTH: z.coerce.number().int().positive().default(500),
  FACEBOOK_PAGE_CONFIG_ENABLED: z.enum(["true", "false"]).default("false"),
  FACEBOOK_APP_ID: z.string().optional(),
  FACEBOOK_APP_SECRET: z.string().optional(),
  FACEBOOK_REDIRECT_URI: z.string().optional(),
  FACEBOOK_REQUIRED_SCOPES: z.string().default("pages_show_list,pages_read_engagement,pages_manage_posts,pages_manage_engagement"),
  FACEBOOK_MOCK_MODE: z.enum(["true", "false"]).default("false"),
  AIRTABLE_FIELD_MAP: z.string().optional().transform((val) => {
    if (!val) {
      return DEFAULT_AIRTABLE_FIELD_MAP;
    }
    try {
      return AirtableFieldMapSchema.parse(JSON.parse(val) as unknown);
    } catch {
      return DEFAULT_AIRTABLE_FIELD_MAP;
    }
  }),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info")
}).refine(data => data.SLACK_COMMANDS_ENABLED !== "true" || !!data.SLACK_SIGNING_SECRET, {
  message: "SLACK_SIGNING_SECRET is required when SLACK_COMMANDS_ENABLED is true",
  path: ["SLACK_SIGNING_SECRET"]
}).refine(data => data.FACEBOOK_PAGE_CONFIG_ENABLED !== "true" || (!!data.FACEBOOK_APP_ID && !!data.FACEBOOK_APP_SECRET && !!data.FACEBOOK_REDIRECT_URI), {
  message: "FACEBOOK_APP_ID, FACEBOOK_APP_SECRET, and FACEBOOK_REDIRECT_URI are required when FACEBOOK_PAGE_CONFIG_ENABLED is true",
  path: ["FACEBOOK_PAGE_CONFIG_ENABLED"]
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  return EnvSchema.parse(process.env);
}
