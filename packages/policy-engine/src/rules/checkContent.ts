import type { PolicyCheck, PolicyVariantInput } from "../types.js";
import { blocked, passed, warned } from "./helpers.js";

export const FACEBOOK_TEXT_LIMIT = 63_206;
export const TIKTOK_TEXT_LIMIT = 2200;

export function checkFacebookTextLength(variant: Pick<PolicyVariantInput, "body">): PolicyCheck {
  if (variant.body.length > FACEBOOK_TEXT_LIMIT) {
    return blocked("checkFacebookTextLength", "PLATFORM_TEXT_CONSTRAINT_VIOLATED", "Facebook body exceeds platform text limit", {
      limit: FACEBOOK_TEXT_LIMIT,
      length: variant.body.length
    });
  }

  return passed("checkFacebookTextLength");
}

export function checkTiktokTextLength(variant: Pick<PolicyVariantInput, "body">): PolicyCheck {
  if (variant.body.length > TIKTOK_TEXT_LIMIT) {
    return blocked("checkTiktokTextLength", "PLATFORM_TEXT_CONSTRAINT_VIOLATED", "TikTok body exceeds platform text limit", {
      limit: TIKTOK_TEXT_LIMIT,
      length: variant.body.length
    });
  }

  return passed("checkTiktokTextLength");
}

export function checkHashtagCount(variant: Pick<PolicyVariantInput, "hashtags">, maxHashtags = 10): PolicyCheck {
  if (variant.hashtags.length > maxHashtags) {
    return warned("checkHashtagCount", "HASHTAG_COUNT_HIGH", "Hashtag count is higher than recommended", {
      limit: maxHashtags,
      count: variant.hashtags.length
    });
  }

  return passed("checkHashtagCount");
}

