import type { PolicyCheck, PolicyVariantInput } from "../types.js";
import { blocked, passed, warned } from "./helpers.js";

function hasUtm(url: URL): boolean {
  return Array.from(url.searchParams.keys()).some((key) => key.toLowerCase().startsWith("utm_"));
}

export function checkCtaUrl(variant: Pick<PolicyVariantInput, "ctaUrl" | "sourceCtaUrl">): PolicyCheck {
  if (variant.sourceCtaUrl && !variant.ctaUrl) {
    return blocked("checkCtaUrl", "MISSING_CTA_URL", "Source post has CTA URL but variant is missing CTA URL");
  }

  if (!variant.ctaUrl) {
    return passed("checkCtaUrl");
  }

  try {
    new URL(variant.ctaUrl);
  } catch {
    return blocked("checkCtaUrl", "MISSING_CTA_URL", "Variant CTA URL is invalid");
  }

  return passed("checkCtaUrl");
}

export function checkUtmPresence(
  variant: Pick<PolicyVariantInput, "ctaUrl">,
  config: { warnOnly?: boolean | null } = { warnOnly: true }
): PolicyCheck {
  if (!variant.ctaUrl) {
    return passed("checkUtmPresence");
  }

  try {
    const url = new URL(variant.ctaUrl);
    if (!hasUtm(url)) {
      if (config.warnOnly !== false) {
        return warned("checkUtmPresence", "MISSING_UTM", "CTA URL is missing UTM parameters");
      }
      return blocked("checkUtmPresence", "MISSING_CTA_URL", "CTA URL is missing required UTM parameters");
    }
  } catch {
    return passed("checkUtmPresence");
  }

  return passed("checkUtmPresence");
}

