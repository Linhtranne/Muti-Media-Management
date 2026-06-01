import { URL } from "node:url";
import { 
  StructuredComposerOutputSchema, 
  type StructuredComposerOutput,
  AiErrorCodeSchema,
  type AiErrorCode
} from "@mediaops/shared-contracts";

export class ValidationError extends Error {
  readonly errorCode: AiErrorCode;
  constructor(errorCode: AiErrorCode, message: string) {
    super(message);
    this.name = "ValidationError";
    this.errorCode = errorCode;
  }
}

export function extractJsonBlock(rawText: string): string {
  const startIdx = rawText.indexOf("{");
  const endIdx = rawText.lastIndexOf("}");

  if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) {
    throw new ValidationError("SCHEMA_PARSING_FAILED", "Response does not contain a valid JSON block");
  }

  return rawText.slice(startIdx, endIdx + 1);
}

export function normalizeHashtags(tags: any): string[] {
  if (!Array.isArray(tags)) {
    throw new ValidationError("SCHEMA_PARSING_FAILED", "Hashtags must be an array");
  }

  const normalized = tags.map((t) => {
    if (typeof t !== "string") {
      throw new ValidationError("SCHEMA_PARSING_FAILED", "Hashtags must be strings");
    }
    let tag = t.trim().toLowerCase();
    if (!tag.startsWith("#")) {
      tag = "#" + tag;
    }
    return tag;
  });

  // Deduplicate and limit to 10
  const unique = Array.from(new Set(normalized));
  return unique.slice(0, 10);
}

export function verifyCtaAndUtm(sourceCta: string | null | undefined, outputCta: string | null | undefined): void {
  // If no source CTA was provided, output CTA should also be empty/null/undefined or matching.
  // Wait, if source had no CTA but output has one, let's flag as drift or reject, unless allowed.
  // To be safe, if source had no CTA, output CTA should not be present.
  if (!sourceCta) {
    if (outputCta) {
      throw new ValidationError("CTA_URL_INVALID", "Output contains a CTA URL but none was specified in source");
    }
    return;
  }

  if (!outputCta) {
    throw new ValidationError("CTA_URL_MISSING", "Source Post specifies a CTA URL, but the output variant misses it");
  }

  let sourceUrl: URL;
  let outputUrl: URL;

  try {
    sourceUrl = new URL(sourceCta);
  } catch {
    throw new ValidationError("CTA_URL_INVALID", "Source CTA URL is malformed");
  }

  try {
    outputUrl = new URL(outputCta);
  } catch {
    throw new ValidationError("CTA_URL_INVALID", "Output CTA URL is malformed");
  }

  // Domain/Host and path checks (Intent Drift check)
  if (sourceUrl.hostname.toLowerCase() !== outputUrl.hostname.toLowerCase()) {
    throw new ValidationError("INTENT_DRIFT", `CTA URL hostname was changed from ${sourceUrl.hostname} to ${outputUrl.hostname}`);
  }

  if (sourceUrl.pathname !== outputUrl.pathname) {
    throw new ValidationError("INTENT_DRIFT", `CTA URL path was changed from ${sourceUrl.pathname} to ${outputUrl.pathname}`);
  }

  // UTM parameters checks
  const utmParams = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];
  for (const param of utmParams) {
    const sourceVal = sourceUrl.searchParams.get(param);
    const outputVal = outputUrl.searchParams.get(param);

    if (sourceVal !== outputVal) {
      throw new ValidationError(
        "CTA_UTM_MUTATED",
        `UTM parameter "${param}" was mutated or removed. Expected "${sourceVal}", got "${outputVal}"`
      );
    }
  }
}

export function detectPromptInjection(parsedObject: Record<string, any>): void {
  const dangerousKeys = ["approved", "publish", "platform_override", "policy_bypass"];
  for (const key of dangerousKeys) {
    if (Object.prototype.hasOwnProperty.call(parsedObject, key)) {
      throw new ValidationError(
        "PROMPT_INJECTION_DETECTED",
        `Dangerous override key "${key}" detected in AI structured output`
      );
    }
  }
}

export function validateStructuredOutput(
  rawText: string,
  sourceCtaUrl?: string | null
): StructuredComposerOutput {
  const jsonStr = extractJsonBlock(rawText);
  let parsed: any;

  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new ValidationError("SCHEMA_PARSING_FAILED", "Failed to parse extracted JSON block");
  }

  // 1. Detect Prompt Injection override keys
  detectPromptInjection(parsed);

  // 2. Validate against Zod schema
  const parsedResult = StructuredComposerOutputSchema.safeParse(parsed);
  if (!parsedResult.success) {
    throw new ValidationError("SCHEMA_PARSING_FAILED", `JSON does not match Structured Output Schema: ${parsedResult.error.message}`);
  }

  const { body, hashtags, cta_url } = parsedResult.data;

  // 3. Normalize hashtags
  const normalizedHashtags = normalizeHashtags(hashtags);

  // 4. Verify CTA URL & UTM parameters
  verifyCtaAndUtm(sourceCtaUrl, cta_url);

  return {
    body,
    hashtags: normalizedHashtags,
    cta_url
  };
}
