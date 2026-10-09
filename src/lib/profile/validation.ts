import { z } from "zod";
import { usernameSchema, displayNameSchema } from "@/lib/validation/common";

/**
 * Bio constraints:
 * - Nullable/optional string
 * - Maximum 250 characters (matches profiles_bio_length_check constraint)
 * - Empty string sanitized to null
 */
export const bioSchema = z
  .string()
  .max(250, "Bio must not exceed 250 characters")
  .transform((val) => {
    const trimmed = val.trim();
    return trimmed.length === 0 ? null : trimmed;
  })
  .nullable()
  .optional();

/**
 * Avatar URL constraints:
 * - Optional / nullable HTTP or HTTPS URL
 * - Maximum 2048 characters
 * - Strictly rejects javascript:, data:, or malformed protocols
 * - Empty string sanitized to null
 */
export const avatarUrlSchema = z
  .string()
  .trim()
  .max(2048, "Avatar URL must not exceed 2048 characters")
  .refine(
    (val) => {
      if (!val || val.length === 0) return true;
      try {
        const url = new URL(val);
        return url.protocol === "https:" || url.protocol === "http:";
      } catch {
        return false;
      }
    },
    { message: "Avatar URL must be a valid HTTP or HTTPS address" }
  )
  .transform((val) => {
    const trimmed = val.trim();
    return trimmed.length === 0 ? null : trimmed;
  })
  .nullable()
  .optional();

/**
 * Complete schema for updating a user's public profile.
 * Only allows editing fields supported by the product design and database schema.
 */
export const updateProfileSchema = z.object({
  displayName: displayNameSchema,
  username: usernameSchema,
  bio: bioSchema,
  avatarUrl: avatarUrlSchema,
});

export type UpdateProfileSchemaType = z.infer<typeof updateProfileSchema>;
