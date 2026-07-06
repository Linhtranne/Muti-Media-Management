/**
 * US-016 Contract Tests — Shared Media Asset Pipeline
 * Tests for mediaPipeline.ts using node:test.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MediaAssetIngestRequestedEventSchema,
  MediaAssetOptimizeRequestedEventSchema,
  MediaAssetStatusSchema,
  MediaAssetDerivativeKindSchema
} from "../index.js";

const VALID_INGEST_EVENT = {
  event_id: "550e8400-e29b-41d4-a716-446655440000",
  event_type: "media.asset.ingest.requested",
  event_version: 1,
  workspace_id: "ws-test-01",
  post_id: "post-123",
  airtable_record_id: "recABC123",
  content_variant_id: "880e8400-e29b-41d4-a716-446655440000",
  idempotency_key: "media.ingest:ws-test-01:post-123:hash123",
  correlation_id: "990e8400-e29b-41d4-a716-446655440000"
};

const VALID_OPTIMIZE_EVENT = {
  event_id: "550e8400-e29b-41d4-a716-446655440001",
  event_type: "media.asset.optimize.requested",
  event_version: 1,
  workspace_id: "ws-test-01",
  media_asset_id: "770e8400-e29b-41d4-a716-446655440000",
  post_id: "post-123",
  idempotency_key: "media.optimize:ws-test-01:asset-770e8400",
  correlation_id: "990e8400-e29b-41d4-a716-446655440000"
};

describe("US-016 Media Pipeline Contract Schemas", () => {
  describe("MediaAssetStatusSchema", () => {
    it("accepts valid statuses", () => {
      const valid = ["received", "downloading", "optimizing", "ready", "failed"];
      for (const status of valid) {
        const result = MediaAssetStatusSchema.safeParse(status);
        assert.equal(result.success, true, `Expected status '${status}' to be valid`);
      }
    });

    it("rejects invalid statuses", () => {
      const invalid = ["pending", "unknown", "processing", "COMPLETED"];
      for (const status of invalid) {
        const result = MediaAssetStatusSchema.safeParse(status);
        assert.equal(result.success, false, `Expected status '${status}' to be invalid`);
      }
    });
  });

  describe("MediaAssetDerivativeKindSchema", () => {
    it("accepts valid derivative kinds", () => {
      const valid = [
        "optimized_original",
        "tiktok_video",
        "tiktok_photo",
        "facebook_image",
        "facebook_link_preview"
      ];
      for (const kind of valid) {
        const result = MediaAssetDerivativeKindSchema.safeParse(kind);
        assert.equal(result.success, true, `Expected derivative kind '${kind}' to be valid`);
      }
    });

    it("rejects invalid derivative kinds", () => {
      const invalid = ["tiktok_mp4", "facebook_raw", "original", "youtube_video"];
      for (const kind of invalid) {
        const result = MediaAssetDerivativeKindSchema.safeParse(kind);
        assert.equal(result.success, false, `Expected derivative kind '${kind}' to be invalid`);
      }
    });
  });

  describe("MediaAssetIngestRequestedEventSchema", () => {
    it("accepts a valid ingest requested event", () => {
      const result = MediaAssetIngestRequestedEventSchema.safeParse(VALID_INGEST_EVENT);
      assert.equal(
        result.success,
        true,
        `Expected valid ingest requested event to pass, error: ${JSON.stringify(!result.success && "error" in result ? result.error?.flatten() : "")}`
      );
    });

    it("accepts content_variant_id as null", () => {
      const result = MediaAssetIngestRequestedEventSchema.safeParse({
        ...VALID_INGEST_EVENT,
        content_variant_id: null
      });
      assert.equal(result.success, true, "Expected content_variant_id to be nullable");
    });

    it("rejects non-1 event_version", () => {
      const result = MediaAssetIngestRequestedEventSchema.safeParse({
        ...VALID_INGEST_EVENT,
        event_version: 2
      });
      assert.equal(result.success, false, "Expected version 2 to be rejected");
    });

    it("rejects missing required fields", () => {
      const { post_id: _p, ...missing } = VALID_INGEST_EVENT;
      const result = MediaAssetIngestRequestedEventSchema.safeParse(missing);
      assert.equal(result.success, false, "Expected missing post_id to fail");
    });

    it("rejects unknown fields (strict mode)", () => {
      const result = MediaAssetIngestRequestedEventSchema.safeParse({
        ...VALID_INGEST_EVENT,
        unknown_field: "someValue"
      });
      assert.equal(result.success, false, "Expected unknown field to trigger validation error");
    });

    it("rejects forbidden credential fields", () => {
      const forbidden = ["access_token", "secret_ref", "api_key", "token", "raw_payload"];
      for (const field of forbidden) {
        const result = MediaAssetIngestRequestedEventSchema.safeParse({
          ...VALID_INGEST_EVENT,
          [field]: "sensitive-leaked-value"
        });
        assert.equal(result.success, false, `Expected event with field '${field}' to be rejected`);
      }
    });
  });

  describe("MediaAssetOptimizeRequestedEventSchema", () => {
    it("accepts a valid optimize requested event", () => {
      const result = MediaAssetOptimizeRequestedEventSchema.safeParse(VALID_OPTIMIZE_EVENT);
      assert.equal(
        result.success,
        true,
        `Expected valid optimize requested event to pass, error: ${JSON.stringify(!result.success && "error" in result ? result.error?.flatten() : "")}`
      );
    });

    it("rejects non-1 event_version", () => {
      const result = MediaAssetOptimizeRequestedEventSchema.safeParse({
        ...VALID_OPTIMIZE_EVENT,
        event_version: 2
      });
      assert.equal(result.success, false, "Expected version 2 to be rejected");
    });

    it("rejects missing required fields", () => {
      const { media_asset_id: _m, ...missing } = VALID_OPTIMIZE_EVENT;
      const result = MediaAssetOptimizeRequestedEventSchema.safeParse(missing);
      assert.equal(result.success, false, "Expected missing media_asset_id to fail");
    });

    it("rejects unknown fields (strict mode)", () => {
      const result = MediaAssetOptimizeRequestedEventSchema.safeParse({
        ...VALID_OPTIMIZE_EVENT,
        another_unknown: 123
      });
      assert.equal(result.success, false, "Expected unknown field to trigger validation error");
    });

    it("rejects forbidden credential fields", () => {
      const forbidden = ["access_token", "secret", "bearer", "authorization", "raw_body"];
      for (const field of forbidden) {
        const result = MediaAssetOptimizeRequestedEventSchema.safeParse({
          ...VALID_OPTIMIZE_EVENT,
          [field]: "sensitive"
        });
        assert.equal(result.success, false, `Expected event with field '${field}' to be rejected`);
      }
    });
  });
});
