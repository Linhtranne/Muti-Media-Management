import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { CommentRiskClassifier } from "../services/commentRiskClassifier.js";

describe("CommentRiskClassifier", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.CRISIS_KEYWORDS;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.CRISIS_KEYWORDS;
    } else {
      process.env.CRISIS_KEYWORDS = originalEnv;
    }
  });

  it("should use default keywords when env is not set", () => {
    delete process.env.CRISIS_KEYWORDS;
    const classifier = new CommentRiskClassifier();
    
    assert.equal(classifier.classify("This is a total scam!"), "CRISIS");
    assert.equal(classifier.classify("I want a refund right now"), "CRISIS");
    assert.equal(classifier.classify("Great product!"), "NORMAL");
  });

  it("should use configured keywords from env", () => {
    process.env.CRISIS_KEYWORDS = "terrible,awful,bad";
    const classifier = new CommentRiskClassifier();
    
    assert.equal(classifier.classify("This is awful"), "CRISIS");
    assert.equal(classifier.classify("scam"), "NORMAL"); // 'scam' is no longer a keyword
    assert.equal(classifier.classify("It's not bad"), "CRISIS");
  });

  it("should handle empty or whitespace comment bodies safely", () => {
    const classifier = new CommentRiskClassifier();
    
    assert.equal(classifier.classify(""), "NORMAL");
    assert.equal(classifier.classify("   "), "NORMAL");
  });

  it("should be case-insensitive", () => {
    const classifier = new CommentRiskClassifier();
    
    assert.equal(classifier.classify("I will SUE you!"), "CRISIS");
    assert.equal(classifier.classify("SCAM alert!"), "CRISIS");
    assert.equal(classifier.classify("fRaUd"), "CRISIS");
  });
});
