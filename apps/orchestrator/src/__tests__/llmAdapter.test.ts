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
});
