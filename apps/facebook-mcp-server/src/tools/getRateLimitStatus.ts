import { type GetRateLimitStatusInput, type RateLimitStatusResult } from "@mediaops/shared-contracts";
import { type SecretStore } from "../lib/secretStore.js";

// MVP implementation: Since Facebook doesn't return quota easily until we hit it,
// we just assume a daily limit from an env var or a hardcoded default (e.g., 25).
// In the future this will actually fetch real headers from Facebook Graph API.

export async function getRateLimitStatusHandler(
  input: GetRateLimitStatusInput,
  secretStore: SecretStore
): Promise<RateLimitStatusResult> {
  // Resolve secret
  await secretStore.resolveSecret(input.secretRef);

  const limitToday = Number.parseInt(process.env.MAX_DAILY_POSTS_PER_PAGE || "25", 10);
  
  // For MVP, we don't have a database tracking in the MCP server, 
  // so we just return the max and assume Orchestrator's Ledger handles the current count.
  // We'll simulate 0 used if we can't track it locally.
  const remainingToday = limitToday;

  const now = new Date();
  const resetAt = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString(); // midnight next day

  return {
    remainingToday,
    limitToday,
    resetAt,
    quotaExceeded: false
  };
}
