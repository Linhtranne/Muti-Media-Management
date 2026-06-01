import { ValidatePostInput, ValidatePostResult, McpViolationCode, McpWarningCode } from "@mediaops/shared-contracts";
import { SecretStore } from "../lib/secretStore.js";

const FB_MAX_LENGTH = 63206;
const FB_MAX_HASHTAGS = 30;

export async function validatePostHandler(
  input: ValidatePostInput,
  secretStore: SecretStore
): Promise<ValidatePostResult> {
  const violations: { code: McpViolationCode; detail: string }[] = [];
  const warnings: { code: McpWarningCode; detail: string }[] = [];

  try {
    // Resolve token just to make sure the secret is available and valid
    // In MVP, we don't call Facebook Graph API directly for validate.
    // If we wanted to, we would call it here.
    await secretStore.resolveSecret(input.secretRef);
  } catch (error: any) {
    violations.push({
      code: "PLATFORM_TOKEN_INVALID",
      detail: `Failed to resolve credentials: ${error.message}`
    });
    return {
      passed: false,
      violations,
      warnings,
      checkedAt: new Date().toISOString()
    };
  }

  // 1. Text Length Validation
  if (input.variantRef.bodyLength > FB_MAX_LENGTH) {
    violations.push({
      code: "PLATFORM_TEXT_TOO_LONG",
      detail: `Body length ${input.variantRef.bodyLength} exceeds Facebook maximum of ${FB_MAX_LENGTH} characters.`
    });
  }

  // 2. Hashtag Warning
  if (input.variantRef.hashtagCount > FB_MAX_HASHTAGS) {
    warnings.push({
      code: "HASHTAG_COUNT_HIGH",
      detail: `Hashtag count ${input.variantRef.hashtagCount} exceeds recommended maximum of ${FB_MAX_HASHTAGS}.`
    });
  }

  return {
    passed: violations.length === 0,
    violations,
    warnings,
    checkedAt: new Date().toISOString()
  };
}
