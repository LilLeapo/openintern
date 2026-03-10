import { stdout, stderr } from "node:process";

type LogLevel = "INFO" | "WARN" | "ERROR";

function timestamp(): string {
  return new Date().toISOString();
}

function writeLine(level: LogLevel, scope: string, message: string): void {
  const line = `[${timestamp()}] [${level}] [${scope}] ${message}\n`;
  if (level === "ERROR") {
    stderr.write(line);
    return;
  }
  stdout.write(line);
}

function formatMessage(message: string, fields: Record<string, unknown>): string {
  const extras = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${String(value)}`);
  if (extras.length === 0) {
    return message;
  }
  return `${message} ${extras.join(" ")}`;
}

export interface Logger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export function createLogger(scope: string): Logger {
  return {
    info(message, fields = {}) {
      writeLine("INFO", scope, formatMessage(message, fields));
    },
    warn(message, fields = {}) {
      writeLine("WARN", scope, formatMessage(message, fields));
    },
    error(message, fields = {}) {
      writeLine("ERROR", scope, formatMessage(message, fields));
    },
  };
}
