import { createClient } from "@/lib/supabase/server";
import { getUserAdmissionStatus } from "@/lib/auth/onboarding";
import { isDevMockAuthEnabled, DEV_MOCK_BLOCKED_USERS, DEV_MOCK_DIRECTORY_MEMBERS, DEV_MOCK_PUBLIC_ID } from "@/lib/auth/dev-mock";
import { publicIdSchema, messageIdSchema } from "./validation";
import { AuthorizationError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { BlockedUser, BlockUserResult, UnblockUserResult } from "./types";

/**
 * Blocks a target member using their public profile identifier.
 *
 * CRITICAL SECURITY & PRODUCT INVARIANTS:
 * - Actor is derived strictly from server session (auth.uid()).
 * - Target public ID is validated via Zod UUID schema.
 * - Enforces same active organization boundary in PostgreSQL.
 * - Prevents self-blocking.
 * - Idempotent via ON CONFLICT DO NOTHING.
 */
export async function blockUser(targetPublicId: string): Promise<BlockUserResult> {
  const status = await getUserAdmissionStatus();
  if (status.state !== "admitted") {
    throw new AuthorizationError("You must be an active member to block users.");
  }

  const parsed = publicIdSchema.safeParse(targetPublicId);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message || "Invalid target public identifier.");
  }

  const cleanPublicId = parsed.data;

  if (isDevMockAuthEnabled()) {
    if (cleanPublicId === DEV_MOCK_PUBLIC_ID) {
      return { success: false, error: "You cannot block yourself." };
    }
    const existing = DEV_MOCK_BLOCKED_USERS.find((b) => b.publicId === cleanPublicId);
    if (existing) {
      return { success: true, alreadyBlocked: true };
    }
    const member = DEV_MOCK_DIRECTORY_MEMBERS.find((m) => m.id === cleanPublicId);
    if (member) {
      DEV_MOCK_BLOCKED_USERS.push({
        publicId: member.id,
        username: member.username,
        displayName: member.displayName,
        avatarUrl: member.avatarUrl,
        blockedAt: new Date().toISOString(),
      });
    }
    return { success: true, alreadyBlocked: false };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("block_user", {
    p_target_public_id: cleanPublicId,
  });

  if (error) {
    const msg = error.message || "Failed to block user";
    logger.warn("block_user_rejected", {
      actorId: status.user.id,
      targetPublicId: cleanPublicId,
      reason: msg,
    });

    if (msg.includes("CANNOT_BLOCK_SELF")) {
      return { success: false, error: "You cannot block yourself." };
    }
    if (msg.includes("FORBIDDEN")) {
      return { success: false, error: "You can only block members within your active organization." };
    }
    if (msg.includes("USER_NOT_FOUND")) {
      return { success: false, error: "The selected member could not be found." };
    }

    throw new Error("Unable to block user. Please try again later.");
  }

  const result = data as { success: boolean; already_blocked: boolean };
  return {
    success: true,
    alreadyBlocked: result.already_blocked,
  };
}

/**
 * Blocks the anonymous sender of a received message.
 *
 * CRITICAL PRIVACY & ANONYMITY INVARIANT:
 * - The sender's identity is resolved strictly within PostgreSQL.
 * - Zero sender identity bits or internal UUIDs are ever returned or exposed to the client.
 * - Only the authorized recipient of the message can execute this operation.
 */
export async function blockMessageSender(messageId: string): Promise<BlockUserResult> {
  const status = await getUserAdmissionStatus();
  if (status.state !== "admitted") {
    throw new AuthorizationError("You must be an active member to block senders.");
  }

  const parsed = messageIdSchema.safeParse(messageId);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message || "Invalid message identifier.");
  }

  const cleanMessageId = parsed.data;

  if (isDevMockAuthEnabled()) {
    // In mock mode, pretend we blocked the mock peer
    return { success: true, alreadyBlocked: false };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("block_message_sender", {
    p_message_id: cleanMessageId,
  });

  if (error) {
    const msg = error.message || "Failed to block message sender";
    logger.warn("block_message_sender_rejected", {
      actorId: status.user.id,
      messageId: cleanMessageId,
      reason: msg,
    });

    if (msg.includes("MESSAGE_NOT_FOUND")) {
      return { success: false, error: "Message not found or you are not authorized to block its sender." };
    }
    if (msg.includes("CANNOT_BLOCK_SELF")) {
      return { success: false, error: "You cannot block yourself." };
    }

    throw new Error("Unable to block sender. Please try again later.");
  }

  const result = data as { success: boolean; already_blocked: boolean };
  return {
    success: true,
    alreadyBlocked: result.already_blocked,
  };
}

/**
 * Removes a block placed by the authenticated user against a target user.
 */
export async function unblockUser(targetPublicId: string): Promise<UnblockUserResult> {
  const status = await getUserAdmissionStatus();
  if (status.state !== "admitted") {
    throw new AuthorizationError("You must be an active member to unblock users.");
  }

  const parsed = publicIdSchema.safeParse(targetPublicId);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message || "Invalid target public identifier.");
  }

  const cleanPublicId = parsed.data;

  if (isDevMockAuthEnabled()) {
    const index = DEV_MOCK_BLOCKED_USERS.findIndex((b) => b.publicId === cleanPublicId);
    if (index >= 0) {
      DEV_MOCK_BLOCKED_USERS.splice(index, 1);
      return { success: true, unblocked: true };
    }
    return { success: true, unblocked: false };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("unblock_user", {
    p_target_public_id: cleanPublicId,
  });

  if (error) {
    logger.error("unblock_user_failed", {
      actorId: status.user.id,
      targetPublicId: cleanPublicId,
      error: error.message,
    });
    throw new Error("Unable to unblock member. Please try again later.");
  }

  const result = data as { success: boolean; unblocked: boolean };
  return {
    success: true,
    unblocked: result.unblocked,
  };
}

/**
 * Retrieves the authenticated user's blocked accounts list.
 * Exposes only safe public profile attributes; zero internal auth UUIDs.
 */
export async function getBlockedUsers(): Promise<BlockedUser[]> {
  const status = await getUserAdmissionStatus();
  if (status.state !== "admitted") {
    throw new AuthorizationError("You must be an active member to view blocked accounts.");
  }

  if (isDevMockAuthEnabled()) {
    return [...DEV_MOCK_BLOCKED_USERS];
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_blocked_users");

  if (error) {
    logger.error("get_blocked_users_failed", {
      actorId: status.user.id,
      error: error.message,
    });
    throw new Error("Unable to load blocked accounts. Please try again later.");
  }

  return (data || []).map((row) => ({
    publicId: row.public_id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    blockedAt: row.blocked_at,
  }));
}
