const secretPatterns = [
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password)\s*[:=]\s*["']?[^"',\s}]+/gi,
  /pat[a-z0-9_-]{10,}/gi,
  /key_[A-Za-z0-9_-]{10,}/gi
];

export function redact(value: unknown): unknown {
  if (typeof value === "string") {
    return secretPatterns.reduce((current, pattern) => current.replace(pattern, "[REDACTED]"), value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redact(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
        if (/token|secret|password|api[_-]?key/i.test(key)) {
          return [key, "[REDACTED]"];
        }
        return [key, redact(entry)];
      })
    );
  }

  return value;
}

