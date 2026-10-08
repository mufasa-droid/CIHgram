export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "RATE_LIMITED"
  | "CONFLICT"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly details?: unknown;

  constructor(
    message: string,
    code: ErrorCode = "INTERNAL_ERROR",
    statusCode = 500,
    isOperational = true,
    details?: unknown
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.details = details;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export class AuthenticationError extends AppError {
  constructor(message = "Authentication required to access this resource") {
    super(message, "UNAUTHENTICATED", 401);
  }
}

export class AuthorizationError extends AppError {
  constructor(message = "You do not have permission to perform this action") {
    super(message, "FORBIDDEN", 403);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = "Resource") {
    super(`${resource} not found`, "NOT_FOUND", 404);
  }
}

export class ValidationError extends AppError {
  constructor(message = "Invalid request parameters", details?: unknown) {
    super(message, "VALIDATION_ERROR", 400, true, details);
  }
}

export class RateLimitError extends AppError {
  constructor(message = "Too many requests. Please slow down and try again later.") {
    super(message, "RATE_LIMITED", 429);
  }
}

export class ConflictError extends AppError {
  constructor(message = "Resource conflict") {
    super(message, "CONFLICT", 409);
  }
}

export type SafeErrorResponse = {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
};

/**
 * Format any thrown error into a safe client response object.
 * Guarantees zero leakage of stack traces, database credentials, or SQL details.
 */
export function formatErrorResponse(error: unknown): SafeErrorResponse {
  if (error instanceof AppError && error.isOperational) {
    return {
      success: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    };
  }

  // Never leak unexpected or raw error internals
  return {
    success: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred. Please try again later.",
    },
  };
}
