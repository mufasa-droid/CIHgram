import { z } from "zod";
import { CRYPTO_CONSTANTS } from "@/lib/crypto/types";

/**
 * Message text input constraints:
 * - Must be non-empty after trimming
 * - Maximum 2,000 characters (sufficient for rich anonymous feedback)
 */
export const messageTextSchema = z
  .string()
  .trim()
  .min(1, "Message cannot be empty")
  .max(2000, "Message cannot exceed 2,000 characters");

/**
 * Server-side send message mutation validation schema.
 * Rejects oversized ciphertexts, unsupported versions, and invalid UUIDs.
 */
export const sendMessagePayloadSchema = z.object({
  recipientId: z.string().uuid("Invalid recipient identifier"),
  keyId: z.string().uuid("Invalid encryption key identifier"),
  ciphertext: z
    .string()
    .trim()
    .min(CRYPTO_CONSTANTS.SEAL_OVERHEAD_BYTES, "Ciphertext payload is too short")
    .max(32768, "Ciphertext payload exceeds 32KB size limit")
    .regex(/^[A-Za-z0-9+/=]+$/, "Ciphertext payload must be a valid Base64 string"),
  protocolVersion: z.literal(CRYPTO_CONSTANTS.PROTOCOL_VERSION),
  alg: z.literal(CRYPTO_CONSTANTS.ALGORITHM),
});

export type SendMessagePayload = z.infer<typeof sendMessagePayloadSchema>;

/**
 * Inbox pagination query validation schema.
 */
export const getInboxInputSchema = z.object({
  cursor: z
    .string()
    .datetime({ offset: true, message: "Invalid cursor timestamp format" })
    .optional()
    .nullable(),
  limit: z.number().int().min(1).max(50).default(20).optional(),
});

export type GetInboxInputPayload = z.infer<typeof getInboxInputSchema>;

/**
 * Message action identifier validation schema.
 */
export const messageIdSchema = z.string().uuid("Invalid message identifier");

/**
 * Message star state update validation schema.
 */
export const setMessageStarredSchema = z.object({
  messageId: z.string().uuid("Invalid message identifier"),
  isStarred: z.boolean(),
});
