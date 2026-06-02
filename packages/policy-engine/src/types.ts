export type PolicyBlockerCode =
  | "MISSING_APPROVAL"
  | "INVALID_CHANNEL_TOKEN"
  | "FORBIDDEN_TERM_DETECTED"
  | "PLATFORM_TEXT_CONSTRAINT_VIOLATED"
  | "MISSING_CTA_URL"
  | "AUTO_PUBLISH_DISABLED"
  | "AUTO_APPROVE_DISABLED"
  | "CHANNEL_ACCOUNT_INACTIVE";

export type PolicyWarningCode =
  | "MISSING_UTM"
  | "HASHTAG_COUNT_HIGH"
  | "CTA_URL_UNSAFE";

export type PolicySeverity = "blocker" | "warning";

export interface PolicyCheck {
  rule: string;
  passed: boolean;
  severity?: PolicySeverity;
  code?: PolicyBlockerCode | PolicyWarningCode;
  detail?: string;
  metadata?: Record<string, unknown>;
}

export interface PolicyBlocker {
  code: PolicyBlockerCode;
  detail: string;
}

export interface PolicyWarning {
  code: PolicyWarningCode;
  detail: string;
}

export interface PolicyVariantInput {
  approvalStatus: string;
  body: string;
  hashtags: string[];
  ctaUrl?: string | null;
  sourceCtaUrl?: string | null;
}

export interface PolicyChannelAccountInput {
  status?: string | null;
}

export interface PolicyTokenReferenceInput {
  tokenStatus?: string | null;
  expiresAt?: string | null;
}

export interface PolicyWorkspaceConfigInput {
  autoPublishEnabled?: boolean | null;
  autoApproveEnabled?: boolean | null;
  utmWarnOnly?: boolean | null;
  forbiddenTerms?: string[] | null;
}

export interface PolicyEvaluationInput {
  variant: PolicyVariantInput;
  channelAccount: PolicyChannelAccountInput | null;
  tokenReference: PolicyTokenReferenceInput | null;
  workspaceConfig: PolicyWorkspaceConfigInput;
}

export interface PolicyEvaluation {
  allowed: boolean;
  blockers: PolicyBlocker[];
  warnings: PolicyWarning[];
  checks: PolicyCheck[];
}

