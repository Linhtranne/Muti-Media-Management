/**
 * @file redact.test.ts
 * US-002 Redaction Tests — orchestrator
 *
 * Tests (no network, no DB, no RabbitMQ):
 * 1. Bearer token is redacted from strings.
 * 2. api_key / access_token / secret / password key-value pairs are redacted.
 * 3. Nested objects have sensitive keys redacted.
 * 4. Non-sensitive data passes through unchanged.
 * 5. Arrays are handled recursively.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Direct relative import — no alias needed
import { redact } from "../lib/redact.js";

// ---------------------------------------------------------------------------
// 1. Bearer token in strings
// ---------------------------------------------------------------------------
describe("redact — Bearer token", () => {
  it("redacts Bearer token from a plain string", () => {
    const input = "Authorization: Bearer EAAlongtoken123";
    const result = redact(input) as string;
    assert.ok(!result.includes("EAAlongtoken123"), "Bearer token value should be redacted");
    assert.ok(result.includes("[REDACTED]"), "Should contain [REDACTED]");
  });

  it("redacts Bearer token embedded in JSON-like string", () => {
    const input = `{"auth": "Bearer eyJhbGciOiJSUzI1NiJ9.payload.signature"}`;
    const result = redact(input) as string;
    assert.ok(!result.includes("eyJhbGciOiJSUzI1NiJ9"), "JWT should be redacted");
    assert.ok(result.includes("[REDACTED]"), "Should contain [REDACTED]");
  });
});

// ---------------------------------------------------------------------------
// 2. Key-value redaction in strings (api_key, access_token, secret, password)
// ---------------------------------------------------------------------------
describe("redact — key=value patterns in strings", () => {
  it("redacts api_key value in string", () => {
    const input = "api_key=supersecret123";
    const result = redact(input) as string;
    assert.ok(!result.includes("supersecret123"), "api_key value should be redacted");
  });

  it("redacts provider key query parameter in URLs", () => {
    const input = "https://provider.example/generate?key=provider-secret-123&model=test";
    const result = redact(input) as string;
    assert.equal(result.includes("provider-secret-123"), false);
    assert.ok(result.includes("key=[REDACTED]"));
  });

  it("redacts access_token value in string", () => {
    const input = "access_token: EAAxxxxxx";
    const result = redact(input) as string;
    assert.ok(!result.includes("EAAxxxxxx"), "access_token value should be redacted");
  });

  it("redacts secret value in string", () => {
    const input = "secret=my_signing_secret_abc";
    const result = redact(input) as string;
    assert.ok(!result.includes("my_signing_secret_abc"), "secret value should be redacted");
  });

  it("redacts password value in string", () => {
    const input = "password: hunter2";
    const result = redact(input) as string;
    assert.ok(!result.includes("hunter2"), "password value should be redacted");
  });
});

// ---------------------------------------------------------------------------
// 3. Object-level key redaction
// ---------------------------------------------------------------------------
describe("redact — object key redaction", () => {
  it("redacts token key in object", () => {
    const input = { token: "EAAxxxxxx", event_id: "evt_001" };
    const result = redact(input) as Record<string, unknown>;
    assert.equal(result.token, "[REDACTED]", "token key should be redacted");
    assert.equal(result.event_id, "evt_001", "non-sensitive key should pass through");
  });

  it("redacts secret key in object", () => {
    const input = { secret: "signing_secret_xyz", workspace_id: "ws_001" };
    const result = redact(input) as Record<string, unknown>;
    assert.equal(result.secret, "[REDACTED]", "secret key should be redacted");
    assert.equal(result.workspace_id, "ws_001", "workspace_id should be unchanged");
  });

  it("redacts api_key key in object", () => {
    const input = { api_key: "key_xyz123456789", record_ref: "recABC" };
    const result = redact(input) as Record<string, unknown>;
    assert.equal(result.api_key, "[REDACTED]", "api_key should be redacted");
    assert.equal(result.record_ref, "recABC", "record_ref should be unchanged");
  });

  it("redacts access_token key in object", () => {
    const input = { access_token: "EAAxxxxxx", correlation_id: "corr_001" };
    const result = redact(input) as Record<string, unknown>;
    assert.equal(result.access_token, "[REDACTED]", "access_token should be redacted");
    assert.equal(result.correlation_id, "corr_001", "correlation_id should be unchanged");
  });

  it("redacts password key in object", () => {
    const input = { password: "P@ssw0rd!", username: "admin" };
    const result = redact(input) as Record<string, unknown>;
    assert.equal(result.password, "[REDACTED]", "password should be redacted");
    assert.equal(result.username, "admin", "username should be unchanged");
  });
});

// ---------------------------------------------------------------------------
// 4. Nested object redaction
// ---------------------------------------------------------------------------
describe("redact — nested object redaction", () => {
  it("redacts token in nested object", () => {
    const input = {
      event_id: "evt_001",
      credentials: {
        access_token: "EAAxxxxxx",
        page_id: "123456789"
      }
    };
    const result = redact(input) as {
      event_id: string;
      credentials: { access_token: string; page_id: string };
    };
    assert.equal(result.credentials.access_token, "[REDACTED]", "Nested access_token should be redacted");
    assert.equal(result.credentials.page_id, "123456789", "Nested non-sensitive value should be unchanged");
    assert.equal(result.event_id, "evt_001", "Top-level event_id should be unchanged");
  });

  it("redacts token in deeply nested object", () => {
    const input = {
      outer: {
        middle: {
          secret: "deep_secret_value"
        }
      },
      safe_field: "safe"
    };
    const result = redact(input) as {
      outer: { middle: { secret: string } };
      safe_field: string;
    };
    assert.equal(result.outer.middle.secret, "[REDACTED]", "Deeply nested secret should be redacted");
    assert.equal(result.safe_field, "safe", "Top-level safe field should be unchanged");
  });

  it("does not redact safe metadata object that has no sensitive keys", () => {
    const input = {
      event_id: "evt_001",
      workspace_id: "ws_test",
      record_ref: "recXXX",
      correlation_id: "corr_001"
    };
    const result = redact(input) as typeof input;
    assert.equal(result.event_id, "evt_001");
    assert.equal(result.workspace_id, "ws_test");
    assert.equal(result.record_ref, "recXXX");
    assert.equal(result.correlation_id, "corr_001");
  });
});

// ---------------------------------------------------------------------------
// 5. Array handling
// ---------------------------------------------------------------------------
describe("redact — array handling", () => {
  it("redacts sensitive items in an array of objects", () => {
    const input = [
      { token: "tok_abc", id: "1" },
      { id: "2", safe: "value" }
    ];
    const result = redact(input) as Array<{ token?: string; id: string; safe?: string }>;
    assert.equal(result[0]?.token, "[REDACTED]", "Array item token should be redacted");
    assert.equal(result[0]?.id, "1", "Array item id should be unchanged");
    assert.equal(result[1]?.safe, "value", "Second array item safe field should be unchanged");
  });

  it("redacts Bearer token in array of strings", () => {
    const input = ["normal string", "Authorization: Bearer secrettoken123"];
    const result = redact(input) as string[];
    assert.equal(result[0], "normal string", "Non-sensitive string should be unchanged");
    assert.ok(!result[1]?.includes("secrettoken123"), "Bearer token should be redacted in array string");
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------
describe("redact — edge cases", () => {
  it("returns null as-is", () => {
    assert.equal(redact(null), null);
  });

  it("returns undefined as-is", () => {
    assert.equal(redact(undefined), undefined);
  });

  it("returns number as-is", () => {
    assert.equal(redact(42), 42);
  });

  it("returns boolean as-is", () => {
    assert.equal(redact(true), true);
  });

  it("returns empty string as-is", () => {
    assert.equal(redact(""), "");
  });

  it("returns empty object as-is", () => {
    const result = redact({}) as Record<string, never>;
    assert.deepEqual(result, {});
  });
});
