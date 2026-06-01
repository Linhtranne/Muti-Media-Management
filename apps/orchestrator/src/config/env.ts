import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
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
  US006_EXECUTION_ENABLED: z.enum(["true", "false"]).default("false"),
  AIRTABLE_FIELD_MAP: z.string().optional().transform((val) => {
    if (!val) {
      return {
        variant_draft: "facebook_body",
        variant_hashtags: "facebook_hashtags",
        variant_cta_url: "facebook_cta_url",
        ai_generation_status: "ai_generation_status",
        ai_review_notes: "ai_review_notes",
        ledger_variant_id: "ledger_variant_id"
      };
    }
    try {
      const parsed = JSON.parse(val);
      return {
        variant_draft: parsed.variant_draft || "facebook_body",
        variant_hashtags: parsed.variant_hashtags || "facebook_hashtags",
        variant_cta_url: parsed.variant_cta_url || "facebook_cta_url",
        ai_generation_status: parsed.ai_generation_status || "ai_generation_status",
        ai_review_notes: parsed.ai_review_notes || "ai_review_notes",
        ledger_variant_id: parsed.ledger_variant_id || "ledger_variant_id"
      };
    } catch {
      return {
        variant_draft: "facebook_body",
        variant_hashtags: "facebook_hashtags",
        variant_cta_url: "facebook_cta_url",
        ai_generation_status: "ai_generation_status",
        ai_review_notes: "ai_review_notes",
        ledger_variant_id: "ledger_variant_id"
      };
    }
  }),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info")
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  return EnvSchema.parse(process.env);
}

