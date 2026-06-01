import type { PolicyBlockerCode, PolicyCheck, PolicyWarningCode } from "../types.js";

export function passed(rule: string, detail?: string): PolicyCheck {
  return { rule, passed: true, detail };
}

export function blocked(rule: string, code: PolicyBlockerCode, detail: string, metadata?: Record<string, unknown>): PolicyCheck {
  return { rule, passed: false, severity: "blocker", code, detail, metadata };
}

export function warned(rule: string, code: PolicyWarningCode, detail: string, metadata?: Record<string, unknown>): PolicyCheck {
  return { rule, passed: false, severity: "warning", code, detail, metadata };
}

export function normalizeText(value: string): string {
  return value.normalize("NFC").toLocaleLowerCase("vi-VN");
}

