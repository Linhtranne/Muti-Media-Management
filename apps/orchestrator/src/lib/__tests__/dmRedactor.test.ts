import { describe, it } from "node:test";
import assert from "node:assert";
import { redactDmBodyForSlack } from "../dmRedactor.js";

describe("redactDmBodyForSlack", () => {
  it("returns empty string if body is undefined or null", () => {
    assert.strictEqual(redactDmBodyForSlack(undefined as any), "");
    assert.strictEqual(redactDmBodyForSlack(null as any), "");
    assert.strictEqual(redactDmBodyForSlack(""), "");
  });

  it("removes newlines and control characters", () => {
    const input = "Hello\r\nThis is a\nmulti-line\tmessage.";
    assert.strictEqual(redactDmBodyForSlack(input), "Hello This is a multi-line message.");
  });

  it("limits length to 80 characters max and trims", () => {
    const input = "This is a very long message that definitely exceeds eighty characters. In fact, it just keeps going and going and going without ever stopping or taking a breath.";
    const result = redactDmBodyForSlack(input);
    assert.ok(result.length <= 80);
    assert.strictEqual(result, "This is a very long message that definitely exceeds eighty characters. In fact,");
  });

  it("removes tokens and secret fields", () => {
    const input = "Here is my secret password: \"hunter2\". Also my access_token=abc123xyz. Do not tell anyone.";
    const result = redactDmBodyForSlack(input);
    assert.ok(!result.includes("hunter2"));
    assert.ok(!result.includes("abc123xyz"));
    assert.ok(result.includes("[REDACTED]"));
  });

  it("handles complex cases with newlines, secrets, and long length together", () => {
    const input = "User: \"Hello\"\nSupport: \"Hi\"\nUser: \"My api_key=1234567890 and access_token=abcdefg. Can you help me with my account? I have been waiting for a long time.\"";
    const result = redactDmBodyForSlack(input);
    assert.ok(result.length <= 80);
    assert.ok(!result.includes("1234567890"));
    assert.ok(!result.includes("abcdefg"));
    assert.ok(result.includes("[REDACTED]"));
  });
});
