import { z } from "zod";

/**
 * Payload to exchange the auth code for a token and list available pages.
 */
export const ExchangeCodePayloadSchema = z.object({
  workspaceId: z.string().min(1),
  authCode: z.string().min(1),
  redirectUri: z.string().url(),
});

export type ExchangeCodePayload = z.infer<typeof ExchangeCodePayloadSchema>;

export const FacebookPageSchema = z.object({
  pageId: z.string(),
  displayName: z.string(),
});

export type FacebookPage = z.infer<typeof FacebookPageSchema>;

export const ExchangeCodeResultSchema = z.object({
  pages: z.array(FacebookPageSchema),
  // Explicitly disallowing raw tokens or auth codes in the result
}).passthrough(); // We'll test that the omit works at the orchestrator side, but typically we just don't include them.

// To strictly prevent token leak, we can use z.object(...).strict() or refine.
// Let's use strict.
export const StrictExchangeCodeResultSchema = z.object({
  pages: z.array(FacebookPageSchema),
  userTokenRef: z.string(), // We store the short-lived user token temporarily in SecretStore, return the ref
}).strict();

export type ExchangeCodeResult = z.infer<typeof StrictExchangeCodeResultSchema>;

/**
 * Payload to connect a specific page using the userTokenRef.
 */
export const ConnectPagePayloadSchema = z.object({
  workspaceId: z.string().min(1),
  pageId: z.string().min(1),
  userTokenRef: z.string().min(1),
});

export type ConnectPagePayload = z.infer<typeof ConnectPagePayloadSchema>;

export const ConnectPageResultSchema = z.object({
  externalAccountId: z.string(),
  displayName: z.string(),
  scopes: z.array(z.string()),
  expiresAt: z.string().datetime().nullable(), // ISO string or null for never expires
  secretRef: z.string(),
}).strict(); // strict prevents returning extra fields like raw token

export type ConnectPageResult = z.infer<typeof ConnectPageResultSchema>;

/**
 * Payload to health check a token.
 */
export const TokenHealthCheckPayloadSchema = z.object({
  workspaceId: z.string().min(1),
  secretRef: z.string().min(1),
  requiredScopes: z.array(z.string()).min(1),
});

export type TokenHealthCheckPayload = z.infer<typeof TokenHealthCheckPayloadSchema>;

export const TokenHealthCheckResultSchema = z.object({
  status: z.enum(["valid", "expired", "missing_permissions", "unknown"]),
  missingScopes: z.array(z.string()).optional(),
  lastCheckedAt: z.string().datetime(),
  permissionErrorCode: z.number().optional(),
}).strict();

export type TokenHealthCheckResult = z.infer<typeof TokenHealthCheckResultSchema>;
