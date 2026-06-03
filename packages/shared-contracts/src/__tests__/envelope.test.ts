/**
 * US-014 Contract Tests — Canonical Event Envelope
 * Tests for envelope.ts using node:test (not vitest).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CanonicalEventEnvelopeSchema,
  buildCanonicalEvent,
  assertNoForbiddenFields,
  findForbiddenFields,
  FORBIDDEN_FIELDS
} from "../events/envelope.js";

const VALID_ENVELOPE = {
  event_id: "550e8400-e29b-41d4-a716-446655440000",
  event_type: "publish.facebook.execute",
  event_version: 1,
  workspace_id: "ws-001",
  idempotency_key: "publish.facebook.execute:ws-001:post-001:v1",
  correlation_id: "corr-001",
  causation_id: "caus-001",
  payload: {
    publish_job_id: "job-uuid-001",
    post_ref: "post-001",
    channel_account_id: "ca-001"
  }
};

describe("CanonicalEventEnvelopeSchema", () => {
  it("accepts a valid reference-only envelope", () => {
    const result = CanonicalEventEnvelopeSchema.safeParse(VALID_ENVELOPE);
    assert.equal(result.success, true, `Expected success but got: ${JSON.stringify(!result.success && "error" in result ? result.error?.flatten() : "")}`);
  });

  it("accepts envelope without optional causation_id", () => {
    const { causation_id: _c, ...noOpt } = VALID_ENVELOPE;
    const result = CanonicalEventEnvelopeSchema.safeParse(noOpt);
    assert.equal(result.success, true);
  });

  it("rejects missing event_id", () => {
    const { event_id: _id, ...noId } = VALID_ENVELOPE;
    const result = CanonicalEventEnvelopeSchema.safeParse(noId);
    assert.equal(result.success, false, "Expected rejection for missing event_id");
  });

  it("rejects invalid uuid for event_id", () => {
    const result = CanonicalEventEnvelopeSchema.safeParse({
      ...VALID_ENVELOPE,
      event_id: "not-a-uuid"
    });
    assert.equal(result.success, false, "Expected rejection for non-UUID event_id");
  });

  it("rejects missing workspace_id", () => {
    const { workspace_id: _ws, ...noWs } = VALID_ENVELOPE;
    const result = CanonicalEventEnvelopeSchema.safeParse(noWs);
    assert.equal(result.success, false, "Expected rejection for missing workspace_id");
  });

  it("rejects missing idempotency_key", () => {
    const { idempotency_key: _ik, ...noIk } = VALID_ENVELOPE;
    const result = CanonicalEventEnvelopeSchema.safeParse(noIk);
    assert.equal(result.success, false, "Expected rejection for missing idempotency_key");
  });

  it("rejects unknown top-level fields (strict mode)", () => {
    const result = CanonicalEventEnvelopeSchema.safeParse({
      ...VALID_ENVELOPE,
      unexpected_field: "value"
    });
    assert.equal(result.success, false, "Expected rejection for unknown field");
  });

  // ─── Forbidden field tests ────────────────────────────────────────────────

  for (const field of FORBIDDEN_FIELDS) {
    it(`rejects forbidden field '${field}' in payload`, () => {
      const result = CanonicalEventEnvelopeSchema.safeParse({
        ...VALID_ENVELOPE,
        payload: {
          ...VALID_ENVELOPE.payload,
          [field]: "forbidden-value"
        }
      });
      assert.equal(result.success, false, `Expected rejection when payload contains '${field}'`);
      if (!result.success) {
        const messages = result.error.issues.map((i: { message: string }) => i.message);
        assert.ok(
          messages.some((m: string) => m.includes(field) || m.includes("Forbidden")),
          `Expected error to mention '${field}' but got: ${messages.join(", ")}`
        );
      }
    });
  }

  it("rejects token at top level of envelope", () => {
    const result = CanonicalEventEnvelopeSchema.safeParse({
      ...VALID_ENVELOPE,
      token: "fb-token-xyz"
    });
    assert.equal(result.success, false, "Expected rejection for top-level token field");
  });

  it("rejects nested forbidden field inside payload object", () => {
    const result = CanonicalEventEnvelopeSchema.safeParse({
      ...VALID_ENVELOPE,
      payload: {
        job_ref: "job-001",
        meta: {
          access_token: "Bearer abc123"
        }
      }
    });
    assert.equal(result.success, false, "Expected rejection for nested access_token in payload");
  });
});

describe("findForbiddenFields", () => {
  it("returns empty array for clean object", () => {
    const violations = findForbiddenFields({ job_id: "x", ref: "y" });
    assert.deepEqual(violations, []);
  });

  it("finds top-level forbidden field", () => {
    const violations = findForbiddenFields({ token: "abc", post_id: "p1" });
    assert.ok(violations.includes("token"), `Expected 'token' in violations: ${violations.join(", ")}`);
  });

  it("finds nested forbidden field", () => {
    const violations = findForbiddenFields({ meta: { access_token: "abc" } }, "payload");
    assert.ok(violations.includes("payload.meta.access_token"), `Expected nested path in violations: ${violations.join(", ")}`);
  });

  it("finds deeply nested forbidden field", () => {
    const violations = findForbiddenFields({
      level1: { level2: { api_key: "secret" } }
    });
    assert.ok(violations.includes("level1.level2.api_key"), `Expected deep path in violations: ${violations.join(", ")}`);
  });
});

describe("assertNoForbiddenFields", () => {
  it("does not throw for clean payload", () => {
    assert.doesNotThrow(() => {
      assertNoForbiddenFields({ job_id: "x", post_ref: "p1" }, "payload");
    });
  });

  it("throws for payload with forbidden field", () => {
    assert.throws(
      () => assertNoForbiddenFields({ access_token: "Bearer xyz" }, "payload"),
      /forbidden/i
    );
  });

  it("throws for nested forbidden field", () => {
    assert.throws(
      () => assertNoForbiddenFields({ meta: { secret: "s3cr3t" } }, "payload"),
      /forbidden/i
    );
  });
});

describe("buildCanonicalEvent", () => {
  it("builds a valid event with version defaulting to 1", () => {
    const evt = buildCanonicalEvent({
      event_id: "550e8400-e29b-41d4-a716-446655440001",
      event_type: "alerts.slack.send",
      workspace_id: "ws-002",
      idempotency_key: "alerts.slack.send:ws-002:alert-001",
      correlation_id: "corr-002",
      payload: { alert_ref: "alert-001", severity: "warn" }
    });
    assert.equal(evt.event_version, 1);
    assert.equal(evt.event_type, "alerts.slack.send");
  });

  it("throws when payload contains forbidden field", () => {
    assert.throws(() =>
      buildCanonicalEvent({
        event_id: "550e8400-e29b-41d4-a716-446655440002",
        event_type: "publish.facebook.execute",
        workspace_id: "ws-003",
        idempotency_key: "key-003",
        correlation_id: "corr-003",
        payload: { token: "leaked-token-xyz" }
      })
    );
  });
});
