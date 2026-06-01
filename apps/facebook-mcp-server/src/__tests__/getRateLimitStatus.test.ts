import { describe, it } from "node:test";
import assert from "node:assert";
import { getRateLimitStatusHandler } from "../tools/getRateLimitStatus.js";
import { SecretStore } from "../lib/secretStore.js";
import { GetRateLimitStatusInput } from "@mediaops/shared-contracts";

class MockSecretStore implements SecretStore {
  async resolveSecret(secretRef: string): Promise<string> {
    if (secretRef === "env:INVALID") {
      throw new Error("SECRET_NOT_FOUND");
    }
    return "valid-token";
  }
}

describe("getRateLimitStatusHandler", () => {
  const store = new MockSecretStore();

  it("should return default limit when env not set", async () => {
    delete process.env.MAX_DAILY_POSTS_PER_PAGE;
    
    const input: GetRateLimitStatusInput = {
      channelAccountId: "account-1",
      secretRef: "env:VALID"
    };

    const result = await getRateLimitStatusHandler(input, store);
    assert.strictEqual(result.limitToday, 25);
    assert.strictEqual(result.remainingToday, 25);
    assert.strictEqual(result.quotaExceeded, false);
    assert.ok(result.resetAt);
  });

  it("should return configured limit from env", async () => {
    process.env.MAX_DAILY_POSTS_PER_PAGE = "50";
    
    const input: GetRateLimitStatusInput = {
      channelAccountId: "account-1",
      secretRef: "env:VALID"
    };

    const result = await getRateLimitStatusHandler(input, store);
    assert.strictEqual(result.limitToday, 50);
    assert.strictEqual(result.remainingToday, 50);
    assert.strictEqual(result.quotaExceeded, false);
  });

  it("should throw if secret is invalid", async () => {
    const input: GetRateLimitStatusInput = {
      channelAccountId: "account-1",
      secretRef: "env:INVALID"
    };

    await assert.rejects(
      async () => await getRateLimitStatusHandler(input, store),
      (err: Error) => err.message === "SECRET_NOT_FOUND"
    );
  });
});
