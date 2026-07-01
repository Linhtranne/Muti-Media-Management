import type { PolicyChannelAccountInput, PolicyCheck, PolicyTokenReferenceInput } from "../types.js";
import { blocked, passed } from "./helpers.js";

export function checkChannelAccountActive(channelAccount: PolicyChannelAccountInput | null): PolicyCheck {
  if (channelAccount?.status !== "active") {
    return blocked("checkChannelAccountActive", "CHANNEL_ACCOUNT_INACTIVE", "Facebook channel account is not active");
  }

  return passed("checkChannelAccountActive");
}

export function checkChannelToken(tokenReference: PolicyTokenReferenceInput | null, now: Date = new Date()): PolicyCheck {
  if (tokenReference?.tokenStatus !== "valid") {
    return blocked("checkChannelToken", "INVALID_CHANNEL_TOKEN", "Facebook token reference is missing or invalid");
  }

  if (tokenReference.expiresAt && Date.parse(tokenReference.expiresAt) <= now.getTime()) {
    return blocked("checkChannelToken", "INVALID_CHANNEL_TOKEN", "Facebook token reference is expired");
  }

  return passed("checkChannelToken");
}

