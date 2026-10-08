"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/session";
import { sendMessagePayloadSchema } from "./validation";
import { logger } from "@/lib/logger";
import type { SendMessageInput, SendMessageResult } from "./types";

/**
 * Server Action: Submits an end-to-end encrypted message for delivery.
 *
 * SECURITY INVARIANTS:
 * 1. Plaintext is NEVER received by this endpoint.
 * 2. Sender identity is derived strictly from the verified session (never client input).
 * 3. Rate limiting and organization boundaries are enforced by PostgreSQL.
 * 4. Zero plaintext or raw ciphertext is ever logged.
 */
export async function sendMessageAction(
  input: SendMessageInput
): Promise<SendMessageResult> {
  try {
    // 1. Validate structure of payload
    const parsed = sendMessagePayloadSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message || "Invalid message submission payload",
      };
    }

    const payload = parsed.data;

    // 2. Derive sender identity from session
    const sender = await getCurrentUser();
    if (!sender) {
      return {
        success: false,
        error: "You must be signed in to send messages.",
      };
    }

    // 3. Prohibit self-messaging
    if (sender.id === payload.recipientId) {
      return {
        success: false,
        error: "You cannot send an anonymous message to yourself.",
      };
    }

    // 4. Submit to database procedure
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("send_anonymous_message", {
      p_recipient_id: payload.recipientId,
      p_key_id: payload.keyId,
      p_ciphertext: payload.ciphertext,
      p_protocol_version: payload.protocolVersion,
    });

    if (error || !data) {
      const errMsg = error?.message || "Unknown database error";

      logger.warn("message_send_rejected", {
        recipientId: payload.recipientId,
        keyId: payload.keyId,
        reason: errMsg,
      });

      if (errMsg.includes("RATE_LIMITED")) {
        return {
          success: false,
          error: errMsg.includes("Daily")
            ? "Daily sending limit reached (50 messages/day). Please try again tomorrow."
            : "You are sending messages too quickly. Please wait a moment before sending another.",
        };
      }

      if (errMsg.includes("RECIPIENT_KEY_MISMATCH")) {
        return {
          success: false,
          error: "The recipient's encryption key is unavailable or has changed. Please refresh and try again.",
        };
      }

      if (errMsg.includes("FORBIDDEN")) {
        return {
          success: false,
          error: "You can only message verified members within your active organization.",
        };
      }

      return {
        success: false,
        error: "Unable to deliver your message at this time. Please try again.",
      };
    }

    const result = data as { success: boolean; message_id: string };

    logger.info("message_delivered", {
      recipientId: payload.recipientId,
      keyId: payload.keyId,
    });

    return {
      success: true,
      messageId: result.message_id,
    };
  } catch (err: unknown) {
    logger.error("message_send_unexpected_error", {
      error: err instanceof Error ? err.message : "Unknown error",
    });

    return {
      success: false,
      error: "An unexpected error occurred while delivering your message.",
    };
  }
}
