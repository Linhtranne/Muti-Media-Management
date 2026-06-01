import { DEFAULT_FORBIDDEN_TERMS } from "../forbiddenTerms.js";
import type { PolicyCheck, PolicyVariantInput } from "../types.js";
import { blocked, normalizeText, passed } from "./helpers.js";

export function checkForbiddenTerms(
  variant: Pick<PolicyVariantInput, "body" | "hashtags">,
  configuredTerms: readonly string[] = DEFAULT_FORBIDDEN_TERMS
): PolicyCheck {
  const terms = configuredTerms.map((term) => normalizeText(term.trim())).filter(Boolean);
  if (terms.length === 0) {
    return passed("checkForbiddenTerms");
  }

  const haystack = normalizeText([variant.body, ...variant.hashtags].join(" "));
  const matchedCount = terms.reduce((count, term) => count + (haystack.includes(term) ? 1 : 0), 0);

  if (matchedCount > 0) {
    return blocked("checkForbiddenTerms", "FORBIDDEN_TERM_DETECTED", "Content contains forbidden policy terms", {
      matched_count: matchedCount
    });
  }

  return passed("checkForbiddenTerms");
}

