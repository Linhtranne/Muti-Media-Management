import { z } from "zod";

// ============================================================================
// FORBIDDEN FIELD GUARD — US-014
// Enforced recursively on any canonical event envelope payload.
// No raw tokens, secrets, large raw bodies, or platform credentials in queue.
// ============================================================================

const FORBIDDEN_FIELDS = [
  "token",
  "access_token",
  "refresh_token",
  "secret",
  "secret_ref",
  "api_key",
  "authorization",
  "bearer",
  "raw_response",
  "raw_payload",
  "raw_body",
  "raw_graph_response",
  "large_content"
] as const;

type ForbiddenField = (typeof FORBIDDEN_FIELDS)[number];

function normalizeKey(key: string): string {
  // If it's all uppercase (like ACCESS_TOKEN or TOKEN), just lowercase it.
  if (key === key.toUpperCase() && !/[a-z]/.test(key)) {
    return key.toLowerCase();
  }
  // Convert first char to lowercase (PascalCase -> camelCase)
  const camel = key.replace(/^[A-Z]/, (m) => m.toLowerCase());
  // Convert camelCase to snake_case
  return camel.replace(/([A-Z])/g, "_$1").toLowerCase();
}

export function isForbiddenKey(key: string): boolean {
  return (FORBIDDEN_FIELDS as readonly string[]).includes(normalizeKey(key));
}

/**
 * Recursively checks a plain object for forbidden fields.
 * Returns list of paths that contain forbidden fields.
 */
export function findForbiddenFields(obj: unknown, path = ""): string[] {
  if (obj === null || typeof obj !== "object") return [];

  if (Array.isArray(obj)) {
    const violations: string[] = [];
    obj.forEach((item, index) => {
      const currentPath = path ? `${path}[${index}]` : `[${index}]`;
      violations.push(...findForbiddenFields(item, currentPath));
    });
    return violations;
  }

  const violations: string[] = [];
  const record = obj as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const currentPath = path ? `${path}.${key}` : key;
    if (isForbiddenKey(key)) {
      violations.push(currentPath);
    }
    // Recurse into nested objects
    if (record[key] !== null && typeof record[key] === "object") {
      violations.push(...findForbiddenFields(record[key], currentPath));
    }
  }
  return violations;
}

// ============================================================================
// CANONICAL EVENT ENVELOPE — US-014
// All events flowing through mediaops.events.topic MUST conform to this schema.
// Legacy queues may use their own schemas but should trend toward this envelope.
// ============================================================================

/**
 * Reference-only payload — any object with string keys.
 * No raw tokens or large blobs. Validation enforced via superRefine.
 */
const ReferencePayloadSchema = z.record(z.string(), z.unknown());

export const CanonicalEventEnvelopeSchema = z
  .object({
    /** Unique event ID (UUID) */
    event_id: z.string().uuid(),

    /**
     * Event type string, dot-separated namespace.
     * Existing contracts use `event_type`. We match that convention here.
     * Example: "airtable.post.approved.ingress", "publish.facebook.execute"
     */
    event_type: z.string().min(1),

    /** Schema version for forward compatibility */
    event_version: z.number().int().positive(),

    /** Workspace scoping — required for RLS + idempotency */
    workspace_id: z.string().min(1),

    /** Idempotency key — must be deterministic and unique per logical operation */
    idempotency_key: z.string().min(1),

    /** Correlation ID — tracks a root request across all events */
    correlation_id: z.string().min(1),

    /** Causation ID — the direct parent event that caused this one */
    causation_id: z.string().min(1).optional(),

    /**
     * Reference-only payload.
     * MUST NOT contain raw tokens, secrets, or large blobs.
     * Validated recursively in superRefine.
     */
    payload: ReferencePayloadSchema
  })
  .strict()
  .superRefine((value, ctx) => {
    // Check top-level forbidden fields
    const topLevelViolations = Object.keys(value).filter((key) => isForbiddenKey(key));
    for (const field of topLevelViolations) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Forbidden envelope field: ${field}`,
        path: [field]
      });
    }

    // Recursively check payload
    const payloadViolations = findForbiddenFields(value.payload, "payload");
    for (const fieldPath of payloadViolations) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Forbidden field in payload: ${fieldPath}`,
        path: [fieldPath]
      });
    }
  });

export type CanonicalEventEnvelope = z.infer<typeof CanonicalEventEnvelopeSchema>;

// ============================================================================
// HELPER: Build canonical event (validates on creation)
// ============================================================================

export function buildCanonicalEvent(
  input: Omit<CanonicalEventEnvelope, "event_version"> & { event_version?: number }
): CanonicalEventEnvelope {
  const data = {
    event_version: 1,
    ...input
  };
  return CanonicalEventEnvelopeSchema.parse(data);
}

// ============================================================================
// HELPER: Runtime check for forbidden fields (used in publisher)
// ============================================================================

export function assertNoForbiddenFields(obj: unknown, context = "payload"): void {
  const violations = findForbiddenFields(obj, context);
  if (violations.length > 0) {
    throw new Error(
      `Security violation: forbidden fields detected in queue message [${violations.join(", ")}]. ` +
        `Raw tokens, secrets, and large payloads must not be published to RabbitMQ.`
    );
  }

  // Also check top-level
  if (obj !== null && typeof obj === "object" && !Array.isArray(obj)) {
    const record = obj as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (isForbiddenKey(key)) {
        throw new Error(
          `Security violation: forbidden field "${key}" in queue message. ` +
            `Raw tokens, secrets, and large payloads must not be published to RabbitMQ.`
        );
      }
    }
  }
}

export { FORBIDDEN_FIELDS };
export type { ForbiddenField };
