import { z } from "zod";

/**
 * Standard UUID v4 validator
 */
export const uuidSchema = z.string().uuid("Invalid unique identifier format");

/**
 * Username constraints:
 * - 3 to 30 characters
 * - lowercase alphanumeric, underscores, dots, hyphens
 * - cannot start or end with delimiter
 */
export const usernameSchema = z
  .string()
  .min(3, "Username must be at least 3 characters")
  .max(30, "Username must not exceed 30 characters")
  .regex(
    /^[a-z0-9](?:[a-z0-9_.-]*[a-z0-9])?$/,
    "Username may only contain lowercase letters, numbers, hyphens, dots, and underscores"
  );

/**
 * Public display name constraints:
 * - 1 to 50 characters
 * - trimmed, non-empty
 */
export const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Display name is required")
  .max(50, "Display name must not exceed 50 characters");

/**
 * Standard pagination parameters with safe defaults and upper bounds
 */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationParams = z.infer<typeof paginationSchema>;

/**
 * Sanitized bounded string helper
 */
export function createBoundedStringSchema(min: number, max: number, fieldName = "Text") {
  return z
    .string()
    .trim()
    .min(min, `${fieldName} must be at least ${min} character${min === 1 ? "" : "s"}`)
    .max(max, `${fieldName} must not exceed ${max} characters`);
}
