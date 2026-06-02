import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { SlackSignatureVerifier } from "../services/slackSignatureVerifier.js";
import type { Logger } from "../lib/logger.js";

describe("SlackSignatureVerifier", () => {
  const secret = "8f742231b10e8888abcd99yyyzzz85a5";
  const rawBody = Buffer.from("command=/approve_post&text=POST-123", "utf8");
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const validSignature = `v0=${crypto
    .createHmac("sha256", secret)
    .update(`v0:${timestamp}:${rawBody.toString("utf8")}`, "utf8")
    .digest("hex")}`;

  let logger: Logger;
  let verifier: SlackSignatureVerifier;

  beforeEach(() => {
    logger = {
      info: mock.fn(),
      error: mock.fn(),
      warn: mock.fn(),
      debug: mock.fn(),
    } as any;
    verifier = new SlackSignatureVerifier(secret, logger);
  });

  it("SIG-001: should accept valid signature", () => {
    const result = verifier.verify(rawBody, validSignature, timestamp);
    assert.deepEqual(result, { valid: true });
  });

  it("SIG-002: should reject invalid signature (HMAC mismatch)", () => {
    const invalidSignature = "v0=a1b2c3d4e5f6";
    const result = verifier.verify(rawBody, invalidSignature, timestamp);
    assert.deepEqual(result, { valid: false, errorCode: "SIGNATURE_MISMATCH", message: "Signature mismatch" });
  });

  it("SIG-003: should reject stale timestamp (> 300s old)", () => {
    const staleTimestamp = (Math.floor(Date.now() / 1000) - 301).toString();
    const staleSignature = `v0=${crypto
      .createHmac("sha256", secret)
      .update(`v0:${staleTimestamp}:${rawBody.toString("utf8")}`, "utf8")
      .digest("hex")}`;

    const result = verifier.verify(rawBody, staleSignature, staleTimestamp);
    assert.deepEqual(result, { valid: false, errorCode: "STALE_TIMESTAMP", message: "Request timestamp is too old or too far in the future" });
  });

  it("SIG-004: should reject future timestamp (> 300s ahead)", () => {
    const futureTimestamp = (Math.floor(Date.now() / 1000) + 301).toString();
    const futureSignature = `v0=${crypto
      .createHmac("sha256", secret)
      .update(`v0:${futureTimestamp}:${rawBody.toString("utf8")}`, "utf8")
      .digest("hex")}`;

    const result = verifier.verify(rawBody, futureSignature, futureTimestamp);
    assert.deepEqual(result, { valid: false, errorCode: "STALE_TIMESTAMP", message: "Request timestamp is too old or too far in the future" });
  });

  it("SIG-005: should reject missing signature header", () => {
    const result = verifier.verify(rawBody, undefined, timestamp);
    assert.deepEqual(result, { valid: false, errorCode: "MISSING_HEADERS", message: "Missing Slack signature headers" });
  });

  it("SIG-006: should reject missing timestamp header", () => {
    const result = verifier.verify(rawBody, validSignature, undefined);
    assert.deepEqual(result, { valid: false, errorCode: "MISSING_HEADERS", message: "Missing Slack signature headers" });
  });

  it("SIG-008: should fail cleanly and log error if secret is not configured", () => {
    const badVerifier = new SlackSignatureVerifier("", logger as any);
    const result = badVerifier.verify(rawBody, validSignature, timestamp);
    assert.deepEqual(result, { valid: false, errorCode: "MISSING_SECRET", message: "Server configuration error" });
    assert.strictEqual((logger.error as any).mock.calls.length, 1);
  });
});
