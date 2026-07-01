import { describe, it } from "node:test";
import assert from "node:assert";
import { ValidatePostInputSchema, ValidatePostResultSchema } from "../mcp/validatePost.js";
import { GetRateLimitStatusInputSchema, RateLimitStatusResultSchema } from "../mcp/rateLimitStatus.js";
import { PublishFacebookValidatedEventSchema } from "../mcp/publishFacebookValidated.js";

describe("MCP Contracts", () => {
  describe("validatePost", () => {
    it("should accept valid input", () => {
      const valid = {
        variantRef: {
          variantId: "550e8400-e29b-41d4-a716-446655440000",
          bodyLength: 100,
          hashtagCount: 2,
          hasMedia: false,
          ctaUrl: "https://example.com"
        },
        channelAccountId: "account-1",
        secretRef: "env:FB_PAGE_TOKEN"
      };
      
      const result = ValidatePostInputSchema.safeParse(valid);
      assert.strictEqual(result.success, true);
    });

    it("should reject input with access token", () => {
      const invalid = {
        variantRef: {
          variantId: "550e8400-e29b-41d4-a716-446655440000",
          bodyLength: 100,
          hashtagCount: 2,
          hasMedia: false
        },
        channelAccountId: "account-1",
        secretRef: "env:FB_PAGE_TOKEN",
        access_token: "EAA..." // strictly forbidden by .strict()
      };
      
      const result = ValidatePostInputSchema.safeParse(invalid);
      assert.strictEqual(result.success, false);
    });

    it("should parse valid validation result", () => {
      const valid = {
        passed: false,
        violations: [
          {
            code: "PLATFORM_TEXT_TOO_LONG",
            detail: "Body text exceeds 63,206 characters"
          }
        ],
        warnings: [],
        checkedAt: new Date().toISOString()
      };
      
      const result = ValidatePostResultSchema.safeParse(valid);
      assert.strictEqual(result.success, true);
    });
  });

  describe("rateLimitStatus", () => {
    it("should accept valid input", () => {
      const result = GetRateLimitStatusInputSchema.safeParse({
        channelAccountId: "account-1",
        secretRef: "env:FB_PAGE_TOKEN"
      });
      assert.strictEqual(result.success, true);
    });

    it("should parse valid result", () => {
      const result = RateLimitStatusResultSchema.safeParse({
        remainingToday: 42,
        limitToday: 100,
        resetAt: new Date().toISOString(),
        quotaExceeded: false
      });
      assert.strictEqual(result.success, true);
    });
  });

  describe("publishFacebookValidatedEvent", () => {
    const validEvent = {
      event_id: "123e4567-e89b-12d3-a456-426614174000",
      event_type: "publish.facebook.validated",
      event_version: 1,
      workspace_id: "ws-1",
      correlation_id: "corr-1",
      workflow_run_id: "123e4567-e89b-12d3-a456-426614174000",
      job_id: "123e4567-e89b-12d3-a456-426614174000",
      variant_id: "123e4567-e89b-12d3-a456-426614174000",
      channel_account_id: "chan-1",
      scheduled_at: new Date().toISOString(),
      idempotency_key: "idem-1",
      validated_at: new Date().toISOString(),
      created_at: new Date().toISOString()
    };

    it("should accept valid references-only payload", () => {
      const result = PublishFacebookValidatedEventSchema.safeParse(validEvent);
      assert.strictEqual(result.success, true);
    });

    it("should reject payload containing token or body", () => {
      const invalidFields = ["body", "access_token", "secret_ref", "master_copy", "cta_url"];
      
      for (const field of invalidFields) {
        const event = { ...validEvent, [field]: "secret or content data" };
        const result = PublishFacebookValidatedEventSchema.safeParse(event);
        
        assert.strictEqual(result.success, false);
      }
    });
  });
});
