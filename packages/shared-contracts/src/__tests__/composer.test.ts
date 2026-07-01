import { describe, test as it } from "node:test";
import assert from "node:assert/strict";
import { NotionContextRefSchema} from "../ai/composer.js";

describe("NotionContextRefSchema", () => {
  it("should accept valid payload with URL and load_status", () => {
    const valid = {
      notion_brief_url: "https://www.notion.so/my-campaign-brief-123",
      load_status: "success",
      ai_ready: true
    };
    assert.equal(NotionContextRefSchema.safeParse(valid).success, true);
  });

  it("should accept fallback status with error code and short message", () => {
    const fallback = {
      load_status: "fallback",
      ai_ready: false,
      fallback_source: "campaign_objective",
      error_code: "CONTEXT_UNREACHABLE",
      error_message: "Notion brief fetch failed due to 404"
    };
    assert.equal(NotionContextRefSchema.safeParse(fallback).success, true);
  });

  it("should reject forbidden fields like raw response or tokens", () => {
    const invalid = {
      notion_brief_url: "https://www.notion.so/test",
      load_status: "success",
      ai_ready: true,
      raw_response: { blocks: [] }, // Should fail due to .strict()
      secret_ref: "secret-123",
      token: "secret-token"
    };
    assert.equal(NotionContextRefSchema.safeParse(invalid).success, false);
  });

  it("should reject error_message longer than 255 chars", () => {
    const invalid = {
      load_status: "failed",
      ai_ready: false,
      error_code: "NOTION_NOT_ALLOWLISTED",
      error_message: "a".repeat(256)
    };
    assert.equal(NotionContextRefSchema.safeParse(invalid).success, false);
  });
});
