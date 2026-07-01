import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GeminiLlmAdapter, LlmTimeoutError, LlmRateLimitError } from "../ai/llmAdapter.js";

describe("GeminiLlmAdapter Tests", () => {
  const adapter = new GeminiLlmAdapter("mock-key");

  it("handles mock happy path successfully", async () => {
    const res = await adapter.generateContent("sys", "user", { mockScenario: "happy" });
    assert.ok(res.includes("--- BEGIN CHAIN OF THOUGHT ---"));
    assert.ok(res.includes('"body"'));
    assert.ok(res.includes('"hashtags"'));
  });

  it("handles mock drift path successfully", async () => {
    const res = await adapter.generateContent("sys", "user", { mockScenario: "drift" });
    assert.ok(res.includes("mismatched-domain.com"));
  });

  it("handles mock injection path successfully", async () => {
    const res = await adapter.generateContent("sys", "user", { mockScenario: "injection" });
    assert.ok(res.includes('"policy_bypass"'));
  });

  it("throws LlmTimeoutError on timeout scenario", async () => {
    await assert.rejects(
      adapter.generateContent("sys", "user", { mockScenario: "timeout" }),
      LlmTimeoutError
    );
  });

  it("throws LlmRateLimitError on rate limit scenario", async () => {
    await assert.rejects(
      adapter.generateContent("sys", "user", { mockScenario: "rate_limit" }),
      LlmRateLimitError
    );
  });

  it("normalizes Gemini model names that include the models/ prefix", async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";
    globalThis.fetch = async (input) => {
      if (typeof input === "string") {
        requestedUrl = input;
      } else if (input instanceof URL) {
        requestedUrl = input.toString();
      } else {
        requestedUrl = input.url;
      }
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: "OK" }] } }]
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    };

    try {
      const prefixedAdapter = new GeminiLlmAdapter("real-looking-key", "models/gemini-2.5-pro");
      const result = await prefixedAdapter.generateContent("sys", "user", { maxRetries: 0 });

      assert.equal(result, "OK");
      assert.ok(requestedUrl.includes("/models/gemini-2.5-pro:generateContent"));
      assert.ok(!requestedUrl.includes("/models/models/"));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
