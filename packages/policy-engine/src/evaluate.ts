import type { PolicyBlocker, PolicyCheck, PolicyEvaluation, PolicyEvaluationInput, PolicyWarning } from "./types.js";
import { DEFAULT_FORBIDDEN_TERMS } from "./forbiddenTerms.js";
import { checkApprovalStatus } from "./rules/checkApprovalStatus.js";
import { checkAutoPublishConfig } from "./rules/checkAutoPublishConfig.js";
import { checkChannelAccountActive, checkChannelToken } from "./rules/checkChannel.js";
import { checkCtaUrl, checkUtmPresence } from "./rules/checkCta.js";
import { checkFacebookTextLength, checkHashtagCount } from "./rules/checkContent.js";
import { checkForbiddenTerms } from "./rules/checkForbiddenTerms.js";

export function aggregateRuleResults(checks: PolicyCheck[]): PolicyEvaluation {
  const blockers: PolicyBlocker[] = [];
  const warnings: PolicyWarning[] = [];

  for (const check of checks) {
    if (check.passed || !check.code) continue;
    if (check.severity === "warning") {
      warnings.push({ code: check.code as PolicyWarning["code"], detail: check.detail ?? check.code });
    } else {
      blockers.push({ code: check.code as PolicyBlocker["code"], detail: check.detail ?? check.code });
    }
  }

  return {
    allowed: blockers.length === 0,
    blockers,
    warnings,
    checks
  };
}

export function evaluateFacebookPolicy(input: PolicyEvaluationInput): PolicyEvaluation {
  const forbiddenTerms = [
    ...DEFAULT_FORBIDDEN_TERMS,
    ...(input.workspaceConfig.forbiddenTerms ?? [])
  ];

  return aggregateRuleResults([
    checkApprovalStatus(input.variant),
    checkChannelAccountActive(input.channelAccount),
    checkChannelToken(input.tokenReference),
    checkFacebookTextLength(input.variant),
    checkForbiddenTerms(input.variant, forbiddenTerms),
    checkCtaUrl(input.variant),
    checkUtmPresence(input.variant, { warnOnly: input.workspaceConfig.utmWarnOnly ?? true }),
    checkHashtagCount(input.variant),
    ...checkAutoPublishConfig(input.workspaceConfig)
  ]);
}

