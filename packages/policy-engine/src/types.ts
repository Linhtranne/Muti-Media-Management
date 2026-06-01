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

export type PolicyCheck = {
  rule: string;
  passed: boolean;
  severity?: PolicySeverity;
  code?: PolicyBlockerCode | PolicyWarningCode;
  detail?: string;
  metadata?: Record<string, unknown>;
};

export type PolicyBlocker = {
  code: PolicyBlockerCode;
  detail: string;
};

export type PolicyWarning = {
  code: PolicyWarningCode;
  detail: string;
};

export type PolicyVariantInput = {
  approvalStatus: string;
  body: string;
  hashtags: string[];
  ctaUrl?: string | null;
  sourceCtaUrl?: string | null;
};

export type PolicyChannelAccountInput = {
  status?: string | null;
};

export type PolicyTokenReferenceInput = {
  tokenStatus?: string | null;
  expiresAt?: string | null;
};

export type PolicyWorkspaceConfigInput = {
  autoPublishEnabled?: boolean | null;
  autoApproveEnabled?: boolean | null;
  utmWarnOnly?: boolean | null;
  forbiddenTerms?: string[] | null;
};

export type PolicyEvaluationInput = {
  variant: PolicyVariantInput;
  channelAccount: PolicyChannelAccountInput | null;
  tokenReference: PolicyTokenReferenceInput | null;
  workspaceConfig: PolicyWorkspaceConfigInput;
};

export type PolicyEvaluation = {
  allowed: boolean;
  blockers: PolicyBlocker[];
  warnings: PolicyWarning[];
  checks: PolicyCheck[];
};

