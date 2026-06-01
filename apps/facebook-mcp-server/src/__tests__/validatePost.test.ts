import { describe, it } from "node:test";
import assert from "node:assert";
import { validatePostHandler } from "../tools/validatePost.js";
import { SecretStore } from "../lib/secretStore.js";
import { ValidatePostInput } from "@mediaops/shared-contracts";

class MockSecretStore implements SecretStore {
  async resolveSecret(secretRef: string): Promise<string> {
    if (secretRef === "env:INVALID") {
      throw new Error("SECRET_NOT_FOUND");
    }
    return "valid-token";
  }
}

describe("validatePostHandler", () => {
  const store = new MockSecretStore();

  it("should pass valid post", async () => {
    const input: ValidatePostInput = {
      variantRef: {
        variantId: "123",
        bodyLength: 100,
        hashtagCount: 2,
        hasMedia: false
      },
      channelAccountId: "account-1",
      secretRef: "env:VALID"
    };

    const result = await validatePostHandler(input, store);
    assert.strictEqual(result.passed, true);
    assert.strictEqual(result.violations.length, 0);
    assert.strictEqual(result.warnings.length, 0);
  });

  it("should fail when body text is too long", async () => {
    const input: ValidatePostInput = {
      variantRef: {
        variantId: "123",
        bodyLength: 70000,
        hashtagCount: 2,
        hasMedia: false
      },
      channelAccountId: "account-1",
      secretRef: "env:VALID"
    };

    const result = await validatePostHandler(input, store);
    assert.strictEqual(result.passed, false);
    assert.strictEqual(result.violations[0].code, "PLATFORM_TEXT_TOO_LONG");
  });

  it("should issue warning when too many hashtags", async () => {
    const input: ValidatePostInput = {
      variantRef: {
        variantId: "123",
        bodyLength: 100,
        hashtagCount: 35,
        hasMedia: false
      },
      channelAccountId: "account-1",
      secretRef: "env:VALID"
    };

    const result = await validatePostHandler(input, store);
    assert.strictEqual(result.passed, true);
    assert.strictEqual(result.warnings[0].code, "HASHTAG_COUNT_HIGH");
  });

  it("should fail when credentials cannot be resolved", async () => {
    const input: ValidatePostInput = {
      variantRef: {
        variantId: "123",
        bodyLength: 100,
        hashtagCount: 2,
        hasMedia: false
      },
      channelAccountId: "account-1",
      secretRef: "env:INVALID"
    };

    const result = await validatePostHandler(input, store);
    assert.strictEqual(result.passed, false);
    assert.strictEqual(result.violations[0].code, "PLATFORM_TOKEN_INVALID");
  });
});
