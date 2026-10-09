import { z } from "zod";

/**
 * UUID validation schema for public user identifiers.
 */
export const publicIdSchema = z
  .string()
  .trim()
  .uuid("Invalid public profile identifier format.");

/**
 * UUID validation schema for message identifiers.
 */
export const messageIdSchema = z
  .string()
  .trim()
  .uuid("Invalid message identifier format.");
