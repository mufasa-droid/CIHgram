"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/session";
import { isDevMockAuthEnabled } from "@/lib/auth/dev-mock";
import {
  sendMessagePayloadSchema,
  getInboxInputSchema,
  messageIdSchema,
  setMessageStarredSchema,
} from "./validation";
import { logger } from "@/lib/logger";
import type {
  SendMessageInput,
  SendMessageResult,
  GetInboxInput,
  GetInboxResult,
  RecipientInboxMessage,
  MarkMessageReadResult,
  SetMessageStarredResult,
  DeleteMessageResult,
  GetUnreadCountResult,
} from "./types";

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

    if (isDevMockAuthEnabled()) {
      return {
        success: true,
        messageId: "00000000-0000-4000-d000-000000000001",
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

/**
 * Server Action: Retrieves recipient inbox messages with bounded pagination.
 *
 * PRIVACY & ANONYMITY INVARIANTS:
 * 1. Derives recipient identity strictly from verified session auth.uid().
 * 2. Database stored procedure returns ONLY recipient-safe columns.
 * 3. sender_id and organization_id are NEVER selected or returned.
 * 4. Deleted messages are excluded at the database level.
 */
export async function getInboxMessagesAction(
  input?: GetInboxInput
): Promise<GetInboxResult> {
  try {
    const parsed = getInboxInputSchema.safeParse(input || {});
    if (!parsed.success) {
      return {
        success: false,
        messages: [],
        hasMore: false,
        nextCursor: null,
        error: parsed.error.issues[0]?.message || "Invalid inbox query parameters",
      };
    }

    const recipient = await getCurrentUser();
    if (!recipient) {
      return {
        success: false,
        messages: [],
        hasMore: false,
        nextCursor: null,
        error: "You must be signed in to view your inbox.",
      };
    }

    if (isDevMockAuthEnabled()) {
      return {
        success: true,
        messages: [],
        hasMore: false,
        nextCursor: null,
      };
    }

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("get_recipient_inbox", {
      p_cursor: parsed.data.cursor || null,
      p_limit: parsed.data.limit || 20,
    });

    if (error || !data) {
      logger.error("inbox_fetch_failed", {
        reason: error?.message || "Unknown error",
      });

      return {
        success: false,
        messages: [],
        hasMore: false,
        nextCursor: null,
        error: "Unable to load inbox messages at this time. Please try again.",
      };
    }

    const result = data as {
      success: boolean;
      messages: Array<{
        id: string;
        ciphertext: string;
        key_id: string;
        protocol_version: number;
        created_at: string;
        is_read: boolean;
        is_starred: boolean;
      }>;
      has_more: boolean;
      next_cursor: string | null;
    };

    const messages: RecipientInboxMessage[] = (result.messages || []).map((m) => ({
      id: m.id,
      ciphertext: m.ciphertext,
      keyId: m.key_id,
      protocolVersion: m.protocol_version,
      createdAt: m.created_at,
      isRead: m.is_read,
      isStarred: m.is_starred,
    }));

    logger.info("inbox_retrieved", {
      count: messages.length,
      hasMore: result.has_more,
    });

    return {
      success: true,
      messages,
      hasMore: result.has_more,
      nextCursor: result.next_cursor,
    };
  } catch (err: unknown) {
    logger.error("inbox_fetch_unexpected_error", {
      error: err instanceof Error ? err.message : "Unknown error",
    });

    return {
      success: false,
      messages: [],
      hasMore: false,
      nextCursor: null,
      error: "An unexpected error occurred while loading your inbox.",
    };
  }
}

/**
 * Server Action: Marks a recipient message as read.
 * Idempotent, recipient-authorized.
 */
export async function markMessageReadAction(
  messageId: string
): Promise<MarkMessageReadResult> {
  try {
    const parsed = messageIdSchema.safeParse(messageId);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message || "Invalid message identifier",
      };
    }

    const user = await getCurrentUser();
    if (!user) {
      return {
        success: false,
        error: "You must be signed in to perform this action.",
      };
    }

    if (isDevMockAuthEnabled()) {
      return {
        success: true,
        updated: true,
      };
    }

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("mark_message_read", {
      p_message_id: parsed.data,
    });

    if (error || !data) {
      return {
        success: false,
        error: "Failed to mark message as read.",
      };
    }

    const result = data as { success: boolean; updated: boolean };
    return {
      success: true,
      updated: result.updated,
    };
  } catch (err: unknown) {
    logger.error("mark_read_unexpected_error", {
      error: err instanceof Error ? err.message : "Unknown error",
    });

    return {
      success: false,
      error: "An unexpected error occurred.",
    };
  }
}

/**
 * Server Action: Updates recipient star/favorite state for a message.
 * Recipient-authorized, idempotent.
 */
export async function setMessageStarredAction(
  messageId: string,
  isStarred: boolean
): Promise<SetMessageStarredResult> {
  try {
    const parsed = setMessageStarredSchema.safeParse({ messageId, isStarred });
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message || "Invalid parameters",
      };
    }

    const user = await getCurrentUser();
    if (!user) {
      return {
        success: false,
        error: "You must be signed in to perform this action.",
      };
    }

    if (isDevMockAuthEnabled()) {
      return {
        success: true,
        isStarred: parsed.data.isStarred,
      };
    }

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("set_message_starred", {
      p_message_id: parsed.data.messageId,
      p_is_starred: parsed.data.isStarred,
    });

    if (error || !data) {
      return {
        success: false,
        error: "Failed to update star state.",
      };
    }

    const result = data as { success: boolean; is_starred?: boolean; error?: string };
    if (!result.success) {
      return {
        success: false,
        error: result.error || "Message not found or not accessible.",
      };
    }

    return {
      success: true,
      isStarred: result.is_starred,
    };
  } catch (err: unknown) {
    logger.error("set_starred_unexpected_error", {
      error: err instanceof Error ? err.message : "Unknown error",
    });

    return {
      success: false,
      error: "An unexpected error occurred.",
    };
  }
}

/**
 * Server Action: Soft-deletes a message from the recipient's inbox.
 * Recipient-authorized. Preserves sender accountability data and purge retention.
 */
export async function deleteMessageAction(
  messageId: string
): Promise<DeleteMessageResult> {
  try {
    const parsed = messageIdSchema.safeParse(messageId);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message || "Invalid message identifier",
      };
    }

    const user = await getCurrentUser();
    if (!user) {
      return {
        success: false,
        error: "You must be signed in to perform this action.",
      };
    }

    if (isDevMockAuthEnabled()) {
      return {
        success: true,
        deleted: true,
      };
    }

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("delete_message_for_recipient", {
      p_message_id: parsed.data,
    });

    if (error || !data) {
      return {
        success: false,
        error: "Failed to delete message.",
      };
    }

    const result = data as { success: boolean; deleted: boolean };
    return {
      success: true,
      deleted: result.deleted,
    };
  } catch (err: unknown) {
    logger.error("delete_message_unexpected_error", {
      error: err instanceof Error ? err.message : "Unknown error",
    });

    return {
      success: false,
      error: "An unexpected error occurred.",
    };
  }
}

/**
 * Server Action: Retrieves recipient unread message count.
 */
export async function getInboxUnreadCountAction(): Promise<GetUnreadCountResult> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return {
        success: false,
        unreadCount: 0,
        error: "Unauthenticated",
      };
    }

    if (isDevMockAuthEnabled()) {
      return {
        success: true,
        unreadCount: 0,
      };
    }

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("get_inbox_unread_count");

    if (error) {
      return {
        success: false,
        unreadCount: 0,
        error: "Failed to retrieve unread count",
      };
    }

    return {
      success: true,
      unreadCount: Number(data) || 0,
    };
  } catch {
    return {
      success: false,
      unreadCount: 0,
      error: "Unexpected error",
    };
  }
}
