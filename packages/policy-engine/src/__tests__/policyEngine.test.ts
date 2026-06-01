import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  checkApprovalStatus,
  checkChannelAccountActive,
  checkChannelToken,
  checkFacebookTextLength,
  checkForbiddenTerms,
  checkCtaUrl,
  checkUtmPresence,
  evaluateFacebookPolicy,
  FACEBOOK_TEXT_LIMIT,
  POLICY_VERSION
} from "../index.js";

describe("policy-engine rules", () => {
  it("exports a stable policy version", () => {
    assert.equal(POLICY_VERSION, "policy-facebook-v1");
  });

  it("blocks missing approval state", () => {
    const check = checkApprovalStatus({ approvalStatus: "draft" });
    assert.equal(check.passed, false);
    assert.equal(check.code, "MISSING_APPROVAL");
  });

  it("blocks inactive channel and invalid token", () => {
    assert.equal(checkChannelAccountActive({ status: "inactive" }).code, "CHANNEL_ACCOUNT_INACTIVE");
    assert.equal(checkChannelToken({ tokenStatus: "expired" }).code, "INVALID_CHANNEL_TOKEN");
    assert.equal(checkChannelToken({ tokenStatus: "valid", expiresAt: "2000-01-01T00:00:00.000Z" }).code, "INVALID_CHANNEL_TOKEN");
  });

  it("enforces Facebook text limit", () => {
    assert.equal(checkFacebookTextLength({ body: "a".repeat(FACEBOOK_TEXT_LIMIT) }).passed, true);
    assert.equal(checkFacebookTextLength({ body: "a".repeat(FACEBOOK_TEXT_LIMIT + 1) }).code, "PLATFORM_TEXT_CONSTRAINT_VIOLATED");
  });

  it("detects forbidden terms in body and hashtags case-insensitively without exposing raw term", () => {
    const bodyCheck = checkForbiddenTerms({ body: "Nội dung CỜ BẠC", hashtags: [] }, ["cờ bạc"]);
    assert.equal(bodyCheck.code, "FORBIDDEN_TERM_DETECTED");
    assert.equal((bodyCheck.detail ?? "").includes("cờ bạc"), false);

    const hashtagCheck = checkForbiddenTerms({ body: "clean", hashtags: ["#LỪA ĐẢO"] }, ["lừa đảo"]);
    assert.equal(hashtagCheck.code, "FORBIDDEN_TERM_DETECTED");
  });

  it("handles CTA and UTM warning mode", () => {
    assert.equal(checkCtaUrl({ sourceCtaUrl: "https://example.com", ctaUrl: null }).code, "MISSING_CTA_URL");
    assert.equal(checkCtaUrl({ sourceCtaUrl: "https://example.com", ctaUrl: "https://example.com?a=1" }).passed, true);
    assert.equal(checkUtmPresence({ ctaUrl: "https://example.com?a=1" }, { warnOnly: true }).code, "MISSING_UTM");
  });

  it("aggregates blockers and warnings into final decision", () => {
    const result = evaluateFacebookPolicy({
      variant: {
        approvalStatus: "needs_review",
        body: "Clean body",
        hashtags: ["#brand"],
        ctaUrl: "https://example.com/path",
        sourceCtaUrl: "https://example.com/path"
      },
      channelAccount: { status: "active" },
      tokenReference: { tokenStatus: "valid" },
      workspaceConfig: {
        autoPublishEnabled: true,
        autoApproveEnabled: true,
        utmWarnOnly: true
      }
    });

    assert.equal(result.allowed, true);
    assert.deepEqual(result.blockers, []);
    assert.equal(result.warnings[0].code, "MISSING_UTM");
  });
});
