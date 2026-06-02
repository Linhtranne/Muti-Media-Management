export const FORBIDDEN_AUDIT_KEYS = new Set([
  "token",
  "access_token",
  "accesstoken",
  "refresh_token",
  "refreshtoken",
  "secret",
  "secret_ref",
  "secretref",
  "api_key",
  "apikey",
  "x-api-key",
  "authorization",
  "bearer",
  "password",
  "raw_graph_response",
  "rawgraphresponse",
  "raw_provider_response",
  "rawproviderresponse",
  "credential",
]);

type AuditMetadata = Record<string, unknown>;

export function sanitizeAuditMetadata(metadata: AuditMetadata): AuditMetadata {
  const redactedKeys = new Set<string>();
  let hasRedacted = false;

  function redactValue(value: unknown, currentKey?: string): unknown {
    if (value == null) return value;

    if (typeof value === "string") {
      // Check for token markers in string
      if (value.toLowerCase().includes("bearer ") || (/^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.exec(value))) {
        hasRedacted = true;
        if (currentKey) redactedKeys.add(currentKey);
        return "[REDACTED_TOKEN_MARKER]";
      }
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item) => redactValue(item, currentKey));
    }

    if (typeof value === "object") {
      const result: AuditMetadata = {};
      for (const [k, v] of Object.entries(value)) {
        if (FORBIDDEN_AUDIT_KEYS.has(k.toLowerCase())) {
          hasRedacted = true;
          redactedKeys.add(k);
          result[k] = "[REDACTED]";
        } else {
          result[k] = redactValue(v, k);
        }
      }
      return result;
    }

    return value;
  }

  const sanitized = redactValue(metadata);

  if (hasRedacted && typeof sanitized === "object" && sanitized !== null && !Array.isArray(sanitized)) {
    return {
      ...(sanitized as AuditMetadata),
      metadata_redacted: true,
      redacted_keys: Array.from(redactedKeys),
    };
  }

  return typeof sanitized === "object" && sanitized !== null && !Array.isArray(sanitized)
    ? sanitized as AuditMetadata
    : { value: sanitized };
}
