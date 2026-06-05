import { redact } from "./redact.js";

/**
 * US-015: DM Alert Redaction Helper
 * - max 80 chars
 * - remove newlines/control chars
 * - do not include raw full body
 * - do not include token/secret fields
 */
export function redactDmBodyForSlack(body: string | undefined | null): string {
  if (!body) return "";
  
  // 1. Remove newlines, tabs, and carriage returns
  let sanitized = body.replace(/[\r\n\t]+/g, " ");
  
  // 2. Remove token/secret fields using existing redact helper
  const redacted = redact(sanitized) as string;
  
  // 3. Max 80 chars
  return redacted.slice(0, 80).trim();
}
