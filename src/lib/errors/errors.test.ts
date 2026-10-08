import { describe, it, expect } from "vitest";
import {
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ValidationError,
  RateLimitError,
  formatErrorResponse,
} from "./index";

describe("Error Foundation", () => {
  it("instantiates distinct error subclasses with correct status codes", () => {
    const authErr = new AuthenticationError();
    expect(authErr.statusCode).toBe(401);
    expect(authErr.code).toBe("UNAUTHENTICATED");

    const forbiddenErr = new AuthorizationError();
    expect(forbiddenErr.statusCode).toBe(403);
    expect(forbiddenErr.code).toBe("FORBIDDEN");

    const notFoundErr = new NotFoundError("User");
    expect(notFoundErr.statusCode).toBe(404);
    expect(notFoundErr.message).toBe("User not found");

    const valErr = new ValidationError("Missing input", { field: "name" });
    expect(valErr.statusCode).toBe(400);
    expect(valErr.details).toEqual({ field: "name" });

    const rateErr = new RateLimitError();
    expect(rateErr.statusCode).toBe(429);
  });

  it("safely formats operational AppErrors without leaking internals", () => {
    const err = new ValidationError("Invalid parameters", { key: "bad" });
    const formatted = formatErrorResponse(err);

    expect(formatted).toEqual({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid parameters",
        details: { key: "bad" },
      },
    });
  });

  it("redacts unexpected non-operational errors into generic safe message", () => {
    const rawError = new Error("FATAL: postgres connection string password=secret");
    const formatted = formatErrorResponse(rawError);

    expect(formatted).toEqual({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred. Please try again later.",
      },
    });
    // Ensure raw error message is not in formatted response
    expect(JSON.stringify(formatted)).not.toContain("postgres");
    expect(JSON.stringify(formatted)).not.toContain("password");
  });
});
