import { z } from "zod";

/**
 * Validation schema for directory search input.
 * Enforces maximum size bounds and trims leading/trailing whitespace.
 */
export const searchQuerySchema = z
  .string()
  .max(100, "Search query must be at most 100 characters")
  .transform((val) => val.trim());

export type SearchQueryInput = z.infer<typeof searchQuerySchema>;
