import { describe, it } from "node:test";
import assert from "node:assert";
import { EnvSecretStore } from "../lib/secretStore.js";

describe("EnvSecretStore", () => {
  it("should resolve valid env secret", async () => {
    process.env.TEST_SECRET = "test-value";
    const store = new EnvSecretStore();
    const val = await store.resolveSecret("env:TEST_SECRET");
    assert.strictEqual(val, "test-value");
  });

  it("should reject vault:// with specific error", async () => {
    const store = new EnvSecretStore();
    await assert.rejects(
      async () => await store.resolveSecret("vault://some-path"),
      (err: Error) => err.message.includes("SECRET_PROVIDER_UNSUPPORTED")
    );
  });

  it("should reject missing env variables", async () => {
    const store = new EnvSecretStore();
    await assert.rejects(
      async () => await store.resolveSecret("env:NON_EXISTENT_VAR"),
      (err: Error) => err.message.includes("SECRET_NOT_FOUND")
    );
  });

  it("should reject unknown format", async () => {
    const store = new EnvSecretStore();
    await assert.rejects(
      async () => await store.resolveSecret("unknown:format"),
      (err: Error) => err.message.includes("SECRET_REF_INVALID")
    );
  });
});
