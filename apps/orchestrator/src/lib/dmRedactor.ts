import { redact } from "./redact.js";

const SLACK_DM_PREVIEW_MAX_LENGTH = 80;

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
  const sanitized = body.replace(/[\r\n\t]+/g, " ");
  
  // 2. Remove token/secret fields using existing redact helper
  const redacted = redact(sanitized) as string;
  
  // 3. Max 80 chars
  return redacted.slice(0, SLACK_DM_PREVIEW_MAX_LENGTH).trim();
}
