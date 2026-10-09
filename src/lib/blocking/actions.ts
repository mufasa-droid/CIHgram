"use server";

import {
  blockUser,
  blockMessageSender,
  unblockUser,
  getBlockedUsers,
} from "./service";
import { AppError } from "@/lib/errors";
import type {
  BlockUserResult,
  UnblockUserResult,
  GetBlockedUsersResult,
} from "./types";

/**
 * Server Action: Blocks a user via their public profile identifier.
 */
export async function blockUserAction(
  targetPublicId: string
): Promise<BlockUserResult> {
  try {
    return await blockUser(targetPublicId);
  } catch (err: unknown) {
    if (err instanceof AppError) {
      return { success: false, error: err.message };
    }
    const message =
      err instanceof Error ? err.message : "Failed to block user";
    return { success: false, error: message };
  }
}

/**
 * Server Action: Blocks the anonymous sender of a received message.
 * Strictly guarantees zero sender identity leakage.
 */
export async function blockMessageSenderAction(
  messageId: string
): Promise<BlockUserResult> {
  try {
    return await blockMessageSender(messageId);
  } catch (err: unknown) {
    if (err instanceof AppError) {
      return { success: false, error: err.message };
    }
    const message =
      err instanceof Error ? err.message : "Failed to block sender";
    return { success: false, error: message };
  }
}

/**
 * Server Action: Unblocks a user via their public profile identifier.
 */
export async function unblockUserAction(
  targetPublicId: string
): Promise<UnblockUserResult> {
  try {
    return await unblockUser(targetPublicId);
  } catch (err: unknown) {
    if (err instanceof AppError) {
      return { success: false, error: err.message };
    }
    const message =
      err instanceof Error ? err.message : "Failed to unblock user";
    return { success: false, error: message };
  }
}

/**
 * Server Action: Fetches the caller's list of blocked users.
 */
export async function getBlockedUsersAction(): Promise<GetBlockedUsersResult> {
  try {
    const blockedUsers = await getBlockedUsers();
    return { success: true, blockedUsers };
  } catch (err: unknown) {
    if (err instanceof AppError) {
      return { success: false, error: err.message };
    }
    const message =
      err instanceof Error ? err.message : "Failed to load blocked accounts";
    return { success: false, error: message };
  }
}
