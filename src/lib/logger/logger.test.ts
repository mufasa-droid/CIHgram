import { describe, it, expect } from "vitest";
import { sanitizeLogPayload } from "./index";

describe("Logger Foundation", () => {
  it("sanitizes sensitive tokens, passwords, keys, and message plaintext", () => {
    const sensitivePayload = {
      user_id: "user-123",
      token: "secret-bearer-token",
      password: "user-password",
      authorization: "Bearer eyJhbGciOi...",
      plaintext: "Confidential message body",
      nested: {
        private_key: "abc-xyz-secret",
        normal_data: "public-value",
      },
    };

    const sanitized = sanitizeLogPayload(sensitivePayload) as Record<string, unknown>;

    expect(sanitized.user_id).toBe("user-123");
    expect(sanitized.token).toBe("[REDACTED]");
    expect(sanitized.password).toBe("[REDACTED]");
    expect(sanitized.authorization).toBe("[REDACTED]");
    expect(sanitized.plaintext).toBe("[REDACTED]");

    const nested = sanitized.nested as Record<string, unknown>;
    expect(nested.private_key).toBe("[REDACTED]");
    expect(nested.normal_data).toBe("public-value");
  });
});
