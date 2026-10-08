type LogLevel = "debug" | "info" | "warn" | "error";

interface LogPayload {
  [key: string]: unknown;
}

const REDACTED_KEYS = new Set([
  "authorization",
  "cookie",
  "token",
  "access_token",
  "refresh_token",
  "password",
  "secret",
  "service_role_key",
  "private_key",
  "plaintext",
  "message",
  "ciphertext",
  "disclosed_content",
]);

/**
 * Recursively sanitize metadata payloads to ensure no sensitive tokens,
 * passwords, plaintext, or private keys are written to system logs.
 */
export function sanitizeLogPayload(payload: unknown): unknown {
  if (payload === null || payload === undefined) {
    return payload;
  }

  if (typeof payload === "string") {
    return payload;
  }

  if (Array.isArray(payload)) {
    return payload.map(sanitizeLogPayload);
  }

  if (typeof payload === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      const lower = key.toLowerCase();
      if (REDACTED_KEYS.has(lower) || lower.includes("secret") || lower.includes("token") || lower.includes("key")) {
        sanitized[key] = "[REDACTED]";
      } else if (typeof value === "object" && value !== null) {
        sanitized[key] = sanitizeLogPayload(value);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  return payload;
}

function log(level: LogLevel, event: string, meta?: LogPayload) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...(meta ? { meta: sanitizeLogPayload(meta) } : {}),
  };

  const output = JSON.stringify(entry);

  switch (level) {
    case "error":
      console.error(output);
      break;
    case "warn":
      console.warn(output);
      break;
    case "info":
      console.info(output);
      break;
    case "debug":
      if (process.env.NODE_ENV !== "production") {
        console.debug(output);
      }
      break;
  }
}

export const logger = {
  debug: (event: string, meta?: LogPayload) => log("debug", event, meta),
  info: (event: string, meta?: LogPayload) => log("info", event, meta),
  warn: (event: string, meta?: LogPayload) => log("warn", event, meta),
  error: (event: string, meta?: LogPayload) => log("error", event, meta),
};
