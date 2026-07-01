import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  createAirtableClient,
  AirtableRecordNotFoundError,
  AirtableRateLimitError,
  AirtableServiceError,
  AirtableNetworkError
} from "../airtable/airtableClient.js";

describe("AirtableClient", () => {
  const apiKey = "key_test_api";
  const baseId = "app_test_base";
  const client = createAirtableClient(apiKey, baseId);

  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("happy path: returns parsed reloaded record on HTTP 200", async () => {
    const mockRecord = {
      id: "recPost123",
      fields: {
        status: "Approved",
        is_valid_for_approval: 1,
        scheduled_at: "2030-06-01T12:00:00.000Z",
        master_copy: "Hello world copy",
        approved_at: "2026-05-27T08:00:00.000Z",
        target_channels: ["Facebook"],
        connected_channel_accounts: ["recAcc123"]
      }
    };

    globalThis.fetch = async (url, options) => {
      assert.equal(url, `https://api.airtable.com/v0/${baseId}/Posts/recPost123`);
      assert.equal(options?.method, "GET");
      assert.equal((options?.headers as Record<string, string>)?.Authorization, `Bearer ${apiKey}`);
      
      return {
        status: 200,
        ok: true,
        json: async () => mockRecord
      } as Response;
    };

    const record = await client.getPostRecord("recPost123");
    assert.deepEqual(record, mockRecord);
  });

  it("handles HTTP 404: throws AirtableRecordNotFoundError", async () => {
    globalThis.fetch = async () => {
      return {
        status: 404,
        ok: false,
        json: async () => ({})
      } as Response;
    };

    await assert.rejects(
      client.getPostRecord("recMissing"),
      (err: Error) => {
        assert.ok(err instanceof AirtableRecordNotFoundError);
        assert.equal(err.message, "Airtable record not found: recMissing");
        assert.equal((err as any).retryable, false);
        return true;
      }
    );
  });

  it("handles HTTP 429: throws AirtableRateLimitError", async () => {
    globalThis.fetch = async () => {
      return {
        status: 429,
        ok: false
      } as Response;
    };

    await assert.rejects(
      client.getPostRecord("recPost123"),
      (err: Error) => {
        assert.ok(err instanceof AirtableRateLimitError);
        assert.equal(err.message, "Airtable API rate limit exceeded (HTTP 429)");
        assert.equal((err as any).retryable, true);
        return true;
      }
    );
  });

  it("handles HTTP 502/503: throws AirtableServiceError", async () => {
    globalThis.fetch = async () => {
      return {
        status: 503,
        ok: false
      } as Response;
    };

    await assert.rejects(
      client.getPostRecord("recPost123"),
      (err: Error) => {
        assert.ok(err instanceof AirtableServiceError);
        assert.equal(err.message, "Airtable service unavailable (HTTP 503)");
        assert.equal((err as any).retryable, true);
        return true;
      }
    );
  });

  it("handles timeout AbortError: throws AirtableNetworkError", async () => {
    globalThis.fetch = async () => {
      const abortError = new DOMException("The user aborted a request.", "AbortError");
      throw abortError;
    };

    await assert.rejects(
      client.getPostRecord("recPost123"),
      (err: Error) => {
        assert.ok(err instanceof AirtableNetworkError);
        assert.equal(err.message, "Airtable API request timed out");
        assert.equal((err as any).retryable, true);
        return true;
      }
    );
  });

  it("updates post status using the lowercase Airtable field name", async () => {
    let capturedBody: unknown;

    globalThis.fetch = async (url, options) => {
      assert.equal(url, `https://api.airtable.com/v0/${baseId}/Posts/recPost123`);
      assert.equal(options?.method, "PATCH");
      const body = options?.body;
      if (typeof body !== "string") {
        throw new Error("Expected string request body");
      }
      capturedBody = JSON.parse(body);

      return {
        status: 200,
        ok: true,
        json: async () => ({})
      } as Response;
    };

    await client.updateRecordStatus("ws-1", "recPost123", "Published");

    assert.deepEqual(capturedBody, {
      fields: {
        status: "Published"
      }
    });
  });

  it("retries draft sync without select fields when Airtable lacks select options", async () => {
    const capturedBodies: unknown[] = [];

    globalThis.fetch = async (url, options) => {
      assert.equal(url, `https://api.airtable.com/v0/${baseId}/Posts/recPost123`);
      assert.equal(options?.method, "PATCH");
      const body = options?.body;
      if (typeof body !== "string") {
        throw new Error("Expected string request body");
      }
      capturedBodies.push(JSON.parse(body));

      if (capturedBodies.length === 1) {
        return {
          status: 422,
          ok: false,
          clone() {
            return this;
          },
          json: async () => ({
            error: {
              type: "INVALID_MULTIPLE_CHOICE_OPTIONS",
              message: "Insufficient permissions to create new select option"
            }
          })
        } as unknown as Response;
      }

      return {
        status: 200,
        ok: true,
        json: async () => ({})
      } as Response;
    };

    await client.updateVariantDraft(
      "recPost123",
      "variant-1",
      {
        variant_draft: "Generated draft",
        variant_hashtags: ["#one", "#two"],
        variant_cta_url: "https://example.com",
        ai_generation_status: "needs_review",
        ai_review_notes: "Review before publishing"
      },
      {
        variant_draft: "facebook_body",
        variant_hashtags: "facebook_hashtags",
        variant_cta_url: "facebook_cta_url",
        ai_generation_status: "ai_generation_status",
        ai_review_notes: "ai_review_notes",
        ledger_variant_id: "ledger_variant_id"
      }
    );

    assert.equal(capturedBodies.length, 2);
    assert.deepEqual(capturedBodies[0], {
      fields: {
        facebook_body: "Generated draft",
        facebook_hashtags: "#one #two",
        ai_generation_status: "needs_review",
        ledger_variant_id: "variant-1",
        facebook_cta_url: "https://example.com",
        ai_review_notes: "Review before publishing"
      }
    });
    assert.deepEqual(capturedBodies[1], {
      fields: {
        facebook_body: "Generated draft",
        facebook_hashtags: "#one #two",
        ledger_variant_id: "variant-1",
        facebook_cta_url: "https://example.com",
        ai_review_notes: "Review before publishing"
      }
    });
  });
});
