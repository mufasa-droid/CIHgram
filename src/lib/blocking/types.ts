/**
 * Blocking Domain Types & DTOs (Prompt 010B)
 *
 * Safe public projections for blocked users and action results.
 * Strictly shields internal authentication UUIDs, emails, and credentials.
 */

export interface BlockedUser {
  publicId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  blockedAt: string;
}

export interface BlockUserResult {
  success: boolean;
  alreadyBlocked?: boolean;
  error?: string;
}

export interface UnblockUserResult {
  success: boolean;
  unblocked?: boolean;
  error?: string;
}

export interface GetBlockedUsersResult {
  success: boolean;
  blockedUsers?: BlockedUser[];
  error?: string;
}
