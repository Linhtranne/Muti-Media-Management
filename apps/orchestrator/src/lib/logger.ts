import { redact } from "./redact.js";

type LogLevel = "debug" | "info" | "warn" | "error";

export class Logger {
  constructor(private readonly minLevel: LogLevel = "info") {}

  debug(message: string, metadata?: Record<string, unknown>): void {
    this.write("debug", message, metadata);
  }

  info(message: string, metadata?: Record<string, unknown>): void {
    this.write("info", message, metadata);
  }

  warn(message: string, metadata?: Record<string, unknown>): void {
    this.write("warn", message, metadata);
  }

  error(message: string, metadata?: Record<string, unknown>): void {
    this.write("error", message, metadata);
  }

  private write(level: LogLevel, message: string, metadata?: Record<string, unknown>): void {
    const order: LogLevel[] = ["debug", "info", "warn", "error"];
    if (order.indexOf(level) < order.indexOf(this.minLevel)) return;

    const payload = {
      level,
      message,
      metadata: redact(metadata ?? {}),
      timestamp: new Date().toISOString()
    };

    const line = JSON.stringify(payload);
    if (level === "error") {
      console.error(line);
      return;
    }
    if (level === "warn") {
      console.warn(line);
      return;
    }
    process.stdout.write(`${line}\n`);
  }
}
