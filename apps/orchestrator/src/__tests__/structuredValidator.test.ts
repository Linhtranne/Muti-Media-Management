import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { 
  validateStructuredOutput, 
  extractJsonBlock, 
  normalizeHashtags, 
  verifyCtaAndUtm, 
  detectPromptInjection,
  ValidationError 
} from "../ai/structuredValidator.js";

describe("structuredValidator — extractJsonBlock", () => {
  it("extracts JSON block successfully from surrounding text", () => {
    const raw = `
      Some introduction text.
      --- BEGIN CHAIN OF THOUGHT ---
      Planning...
      --- END CHAIN OF THOUGHT ---
      {
        "body": "Post body text",
        "hashtags": ["tech"]
      }
      Some trailing text.
    `;
    const block = extractJsonBlock(raw);
    assert.deepEqual(JSON.parse(block), {
      body: "Post body text",
      hashtags: ["tech"]
    });
  });

  it("throws ValidationError when no JSON block is found", () => {
    assert.throws(
      () => extractJsonBlock("Just some plain text without braces"),
      (err: any) => err instanceof ValidationError && err.errorCode === "SCHEMA_PARSING_FAILED"
    );
  });
});

describe("structuredValidator — normalizeHashtags", () => {
  it("normalizes, lowercases, prefixes with #, deduplicates and caps hashtags at 10", () => {
    const rawTags = ["  innovation ", "Innovation", "secure", "#SECURE", "#innovation", "tag1", "tag2", "tag3", "tag4", "tag5", "tag6", "tag7", "tag8", "tag9", "tag10", "tag11"];
    const normalized = normalizeHashtags(rawTags);
    
    // Lowercased, prepended with #, deduplicated, and limited to 10 items
    assert.deepEqual(normalized, [
      "#innovation",
      "#secure",
      "#tag1",
      "#tag2",
      "#tag3",
      "#tag4",
      "#tag5",
      "#tag6",
      "#tag7",
      "#tag8"
    ]);
  });

  it("throws ValidationError for non-array hashtags", () => {
    assert.throws(
      () => normalizeHashtags("not an array"),
      (err: any) => err instanceof ValidationError && err.errorCode === "SCHEMA_PARSING_FAILED"
    );
  });
});

describe("structuredValidator — verifyCtaAndUtm", () => {
  const sourceCta = "https://mediaops.com/launch?utm_source=fb&utm_medium=post&utm_campaign=c1";

  it("succeeds if output CTA matches source CTA exactly", () => {
    assert.doesNotThrow(() => verifyCtaAndUtm(sourceCta, sourceCta));
  });

  it("succeeds if output CTA matches source but has safe extra query params or rearranged params", () => {
    const outputCta = "https://mediaops.com/launch?utm_medium=post&utm_source=fb&utm_campaign=c1&extra=safe";
    assert.doesNotThrow(() => verifyCtaAndUtm(sourceCta, outputCta));
  });

  it("throws CTA_UTM_MUTATED if any UTM parameter is changed or missing", () => {
    const mutatedCta = "https://mediaops.com/launch?utm_source=linkedin&utm_medium=post&utm_campaign=c1";
    assert.throws(
      () => verifyCtaAndUtm(sourceCta, mutatedCta),
      (err: any) => err instanceof ValidationError && err.errorCode === "CTA_UTM_MUTATED"
    );
  });

  it("throws INTENT_DRIFT if the host or path differs", () => {
    const differentHost = "https://evil.com/launch?utm_source=fb&utm_medium=post&utm_campaign=c1";
    assert.throws(
      () => verifyCtaAndUtm(sourceCta, differentHost),
      (err: any) => err instanceof ValidationError && err.errorCode === "INTENT_DRIFT"
    );
  });

  it("throws CTA_URL_MISSING if source has CTA but output lacks it", () => {
    assert.throws(
      () => verifyCtaAndUtm(sourceCta, null),
      (err: any) => err instanceof ValidationError && err.errorCode === "CTA_URL_MISSING"
    );
  });

  it("throws CTA_URL_INVALID if output CTA is malformed", () => {
    assert.throws(
      () => verifyCtaAndUtm(sourceCta, "not a url"),
      (err: any) => err instanceof ValidationError && err.errorCode === "CTA_URL_INVALID"
    );
  });
});

describe("structuredValidator — detectPromptInjection", () => {
  it("throws PROMPT_INJECTION_DETECTED if injection keys are present", () => {
    const badObject = {
      body: "Normal post",
      hashtags: [],
      policy_bypass: true
    };
    assert.throws(
      () => detectPromptInjection(badObject),
      (err: any) => err instanceof ValidationError && err.errorCode === "PROMPT_INJECTION_DETECTED"
    );
  });

  it("does not throw for clean objects", () => {
    const cleanObject = {
      body: "Normal post",
      hashtags: ["safe"],
      cta_url: "https://mediaops.com"
    };
    assert.doesNotThrow(() => detectPromptInjection(cleanObject));
  });
});
